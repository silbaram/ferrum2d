import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";
import { initSync, Engine, wasm_memory } from "../../packages/ferrum-web/pkg/ferrum_core.js";
import * as nativeApi from "../../packages/ferrum-web/pkg/ferrum_core.js";
import { WasmBridge } from "../../packages/ferrum-web/dist/wasmBridge.js";
import { runFrame } from "../../packages/ferrum-web/dist/engineFramePipeline.js";
import { resolvePhysicsSpec } from "../../packages/ferrum-web/dist/physicsSpec.js";
import { resolvePresentationEffectRegistry } from "../../packages/ferrum-web/dist/presentationEffects.js";
import { QuestLog, DialogueSession } from "../../packages/ferrum-web/dist/dialogueQuest.js";
import { PixelMaskTerrain } from "../../packages/ferrum-web/dist/pixelMaskTerrain.js";
import { configureSpriteLighting } from "../../packages/ferrum-web/dist/spriteLighting.js";
import { configureSpriteSurface } from "../../packages/ferrum-web/dist/spriteSurface.js";

// Run only after building the current Rust pkg and SDK dist. This intentionally
// uses internal modules: the assertions concern the engine's own frame boundary.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifactDir = resolve(root, "artifacts/language-boundaries");
const wasm = await readFile(resolve(root, "packages/ferrum-web/pkg/ferrum_core_bg.wasm"));
const wasmExports = initSync({ module: wasm });
const report = {
  format: "ferrum2d.language-boundaries.native",
  version: 1,
  status: "running",
  scope: {
    calls: "Flat Data Scene frame with input and telemetry; all Engine method calls through the frame engine and bridge, including buffer accessors; excludes setup and module-level ABI exports.",
    lifetime: "Render precedes effect callbacks; the effect callback's frame remains owned and readable after native entity creation grows Wasm memory.",
    diagnostics: "The actual native diagnostics Vec must grow memory under bounded allocator pressure before this frame's render/event/telemetry views are borrowed; no injected memory.grow.",
    limitation: "A scoped regression gate, not a proof that arbitrary callbacks or all engine features have constant dispatch cost or keep every gameplay state in Rust.",
  },
  provenance: {
    wasmSha256: hash(wasm),
    rustSourceSha256: await hashSources("crates/ferrum-core", [".rs", ".toml", ".lock"], new Set(["target"])),
    sdkSourceSha256: await hashSources("packages/ferrum-web/src", [".ts"]),
    sdkDistSha256: await hashSources("packages/ferrum-web/dist", [".js", ".ts"]),
    harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))),
  },
  cases: [],
};
try {
  // Run first: earlier native scenarios can change allocator fragmentation and
  // make the bounded pressure required for this real allocation less predictable.
  checkDiagnosticsAllocationBeforeBorrows();
  checkAbi();
  checkConstantFrameCalls();
  checkEffectCallbackLifetime();
  checkNativeGameplayOwnership();
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  for (const result of report.cases) if (result.status === "running") result.status = "failed";
  report.error = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
  process.exitCode = 1;
} finally {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(resolve(artifactDir, "native-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}

function checkDiagnosticsAllocationBeforeBorrows() {
  const native = new Engine();
  const memory = wasm_memory();
  const allocations = [];
  const maxFrames = 65_536;
  let currentBorrows = {};
  const result = {
    name: "native-diagnostics-growth-before-frame-borrows", status: "running",
    forcedMemoryGrow: false, maxFrames, pressureBlockBytes: 8,
    pressureAllocations: 0, releasedPressureAllocations: 0, pressureGrowths: 0, queryCalls: 0,
    pressureScope: "Held raw native allocator blocks exercise the real Vec allocation; this is a deterministic boundary stress test, not representative gameplay load.",
  };
  report.cases.push(result);
  try {
    assert.equal(typeof wasmExports.__wbindgen_malloc, "function");
    assert.equal(typeof wasmExports.__wbindgen_free, "function");
    configure(native);
    native.configure_physics_diagnostics(true);
    spawn(native);
    const bridge = new WasmBridge(native, memory);
    // Audio is already drained into owned data. These are the borrowed views
    // retained by FrameState and passed to the renderer after diagnostics.
    for (const name of ["readRenderCommandBuffer", "readFrameTelemetryBuffer", "readCollisionEventBuffer",
      "readGameplayEventBuffer", "readEffectEventBuffer", "readPhysicsDebugLineBuffer"]) {
      const original = bridge[name].bind(bridge);
      bridge[name] = (...args) => currentBorrows[name] = original(...args);
    }
    const query = native.query_physics_diagnostics.bind(native);
    native.query_physics_diagnostics = () => {
      result.queryCalls++;
      assert.deepEqual(Object.keys(currentBorrows), [], "diagnostics must run before this frame borrows any render/event/telemetry views");
      const before = memory.buffer;
      const beforeBytes = before.byteLength;
      const values = query(); // Unchanged native Vec allocation; observation only.
      if (memory.buffer !== before) {
        result.queryGrowth = { beforeBytes, afterBytes: memory.buffer.byteLength, values: Array.from(values) };
      }
      return values;
    };
    const context = {
      bridge, rustEngine: native, physicsSpec: resolvePhysicsSpec({}), needsFrameState: true,
      options: { includeCollisionEvents: true, includeGameplayEvents: false, includeEffectEvents: false },
      onRenderFrame(frame) {
        assert.equal(frame.renderCommandBuffer.commandCount, 1);
        assert.equal(frame.renderCommandBuffer.buffer.length, 15, "diagnostics detached the rendered command packet");
        assert.ok(frame.renderCommandBuffer.buffer.every(Number.isFinite));
        assert.equal(frame.renderCommandBuffer.buffer.buffer, memory.buffer);
        const telemetry = currentBorrows.readFrameTelemetryBuffer;
        assert.equal(telemetry.buffer.length, 62, "diagnostics detached the frame telemetry packet");
        assert.equal(telemetry.buffer.buffer, memory.buffer);
        assert.equal(telemetry.buffer[2], 1);
        assert.equal(telemetry.buffer[4], 1);
        assert.equal(frame.frameState.entityCount, 1);
        assert.equal(frame.frameState.spriteCount, 1);
        assert.ok(Number.isFinite(frame.frameState.timeSeconds));
        assert.deepEqual(frame.frameState.physicsDiagnostics, { dropped: 0, ccdLimits: [], joints: [] });
        if (result.queryGrowth) result.renderAfterGrowth = { commandCount: 1, renderFloats: 15, telemetryFloats: 62, entityCount: 1 };
      },
    };
    for (let frame = 0; frame < maxFrames && !result.queryGrowth; frame++) {
      if (frame > 0) {
        const before = memory.buffer;
        const ptr = wasmExports.__wbindgen_malloc(8, 8);
        assert.ok(ptr, "native pressure allocation failed");
        allocations.push(ptr);
        result.pressureAllocations++;
        if (before !== memory.buffer) result.pressureGrowths++;
      }
      currentBorrows = {};
      runFrame(context, 1 / 60);
    }
    assert.ok(result.queryGrowth, `actual query_physics_diagnostics memory growth was not observed within ${maxFrames} frames; no lifetime coverage was obtained`);
    assert.ok(result.renderAfterGrowth, "the native growth frame must reach its renderer with valid buffers");
    result.status = "passed";
  } catch (error) {
    result.status = "failed";
    throw error;
  } finally {
    try { native.free(); }
    finally {
      for (const ptr of allocations) {
        wasmExports.__wbindgen_free(ptr, 8, 8);
        result.releasedPressureAllocations++;
      }
    }
  }
}

function checkAbi() {
  const native = new Engine();
  try {
    // Construction invokes the SDK's checks against the current actual Wasm ABI.
    new WasmBridge(native, wasm_memory());
    const badStride = new Proxy(native, { get(target, key) {
      if (key === "shooter_snapshot_entity_floats") return () => target.shooter_snapshot_entity_floats() + 1;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    assert.throws(() => new WasmBridge(badStride, wasm_memory()), /ABI mismatch/,
      "the ABI validator must reject an incompatible native stride, not merely initialize");
    report.cases.push({ name: "current-wasm-abi-and-negative-stride", status: "passed" });
  } finally { native.free(); }
}

function checkConstantFrameCalls() {
  const baseBudget = 21;
  const volumeReads = ["ground_shadow_volume_abi_version", "ground_shadow_volume_vertex_stride",
    "ground_shadow_volume_ptr", "ground_shadow_volume_len", "ground_shadow_volume_caster_count"];
  const groups = [
    { key: "volumes", reads: volumeReads, writes: ["configure_data_scene_ground_shadow_volume"] },
    { key: "lighting", reads: ["sprite_lighting_material_abi_version", "sprite_lighting_material_size",
      "sprite_lighting_material_len", "sprite_lighting_material_ptr"], writes: ["configure_sprite_lighting_materials"] },
    { key: "surface", reads: ["sprite_surface_material_abi_version", "sprite_surface_material_size",
      "sprite_surface_material_len", "sprite_surface_material_ptr"], writes: ["configure_sprite_surface_materials"] },
    { key: "masks", reads: ["sprite_light_mask_abi_version", "sprite_light_mask_size",
      "sprite_light_mask_len", "sprite_light_mask_ptr"], writes: ["configure_sprite_lighting_materials_v2"] },
  ];
  const bulkReads = new Set(groups.flatMap(group => group.reads));
  const lightingSidecars = { lighting: true, surface: true, masks: true };
  const cases = [];
  const result = { name: "constant-native-frame-dispatch", status: "running", cases };
  // Retain method counts even when a new dispatch violates the budget.
  report.cases.push(result);
  for (const scenario of [
    { name: "legacy-exports", volumes: false, cast: false },
    { name: "empty-volume-sidecar", volumes: true, cast: false },
    { name: "active-volume-sidecar", volumes: true, cast: true },
    { name: "active-lighting-only", lighting: true, active: true },
    { name: "active-lighting-surface", lighting: true, surface: true, active: true },
    { name: "active-lighting-masks", lighting: true, masks: true, active: true },
    { name: "empty-lighting-sidecars", ...lightingSidecars },
    { name: "active-lighting-sidecars", ...lightingSidecars, active: true },
    { name: "empty-current-sidecars", ...lightingSidecars, volumes: true },
    { name: "active-current-sidecars", ...lightingSidecars, volumes: true, cast: true, active: true },
  ]) {
    const scenarioCases = [];
    const hiddenExports = new Set(groups.filter(group => !scenario[group.key])
      .flatMap(group => [...group.reads, ...group.writes]));
    for (const entities of [1, 128, 1024]) {
      const native = new Engine();
      const calls = new Map();
      const engine = new Proxy(native, { get(target, key) {
        // Exercise the optional-export fallback using the actual native engine.
        if (hiddenExports.has(key)) return undefined;
        const value = Reflect.get(target, key);
        return typeof value === "function" ? (...args) => {
          calls.set(String(key), (calls.get(String(key)) ?? 0) + 1);
          return Reflect.apply(value, target, args);
        } : value;
      } });
      try {
        configure(engine);
        if (scenario.cast) assert.ok(engine.configure_data_scene_sun(1, 0, 0.6, 1, 10000));
        const handles = [];
        for (let i = 0; i < entities; i++) {
          spawn(engine);
          const entity = { entityId: engine.data_scene_entity_id(), entityGeneration: engine.data_scene_entity_generation() };
          handles.push(entity);
          if (scenario.cast) assert.ok(engine.configure_data_scene_ground_shadow_volume(
            entity.entityId, entity.entityGeneration,
            16, 8, 8, 4, 0, -4, 1, false, 0));
        }
        if (scenario.active) {
          assert.ok(configureSpriteLighting(engine, handles.map(entity => ({ entity,
            lighting: { mode: "opaque", ...(scenario.masks ? { lightMask: 1, shadowMask: 2 } : {}) } }))));
          if (scenario.surface) assert.ok(configureSpriteSurface(engine, handles.map(entity => ({ entity,
            surface: { emission: [1, 0.5, 0.25], specular: 0.25, roughness: 0.5 } }))));
        }
        const bridge = new WasmBridge(engine, wasm_memory());
        // Setup/ABI calls are outside the measured frame, while all reads and
        // writes performed by both runFrame and its bridge remain instrumented.
        calls.clear();
        let renders = 0, volumeCasterCount = 0, volumeVertexCount = 0;
        runFrame({ bridge, rustEngine: engine, physicsSpec: resolvePhysicsSpec({}),
          needsFrameState: true, options: {}, inputProvider: neutralInput,
          onRenderFrame(frame) {
            renders++;
            assert.equal(frame.renderCommandBuffer.commandCount, entities);
            assert.equal(frame.renderCommandBuffer.buffer.length, entities * 15);
            assert.ok(frame.renderCommandBuffer.buffer.every(Number.isFinite));
            const { spriteLightingMaterials: lighting, spriteSurfaceMaterials: surface,
              spriteLightMasks: masks } = frame.renderCommandBuffer;
            if (scenario.active) {
              assert.equal(lighting.words.length, entities * 2);
              for (let i = 0; i < entities; i++) assert.equal(lighting.words[i * 2], 1);
            } else assert.equal(lighting, undefined);
            if (scenario.active && scenario.surface) {
              assert.equal(surface.words.length, entities * 10);
              for (let i = 0; i < entities; i++) {
                assert.equal(surface.words[i * 10 + 3], 1);
                assert.deepEqual(Array.from(surface.values.subarray(i * 10 + 4, i * 10 + 9)),
                  [1, 0.5, 0.25, 0.25, 0.5]);
              }
            } else assert.equal(surface, undefined);
            if (scenario.active && scenario.masks) {
              assert.equal(masks.buffer.length, entities * 2);
              for (let i = 0; i < entities; i++) assert.deepEqual(Array.from(masks.buffer.subarray(i * 2, i * 2 + 2)), [1, 2]);
            } else assert.equal(masks, undefined);
            const volumes = frame.renderCommandBuffer.groundShadowVolumes;
            if (scenario.cast) {
              assert.ok(volumes, "active volume geometry must reach the renderer");
              volumeCasterCount = volumes.casterCount; volumeVertexCount = volumes.vertexCount;
              assert.equal(volumeCasterCount, entities);
              assert.ok(volumeVertexCount >= entities * 3 && volumeVertexCount <= entities * 24);
              assert.equal(volumes.buffer.length, volumeVertexCount * 3);
              assert.ok(volumes.buffer.every(Number.isFinite));
            } else assert.equal(volumes, undefined);
          },
        }, 1 / 60);
        assert.equal(renders, 1);
        assert.equal(calls.get("set_input"), 1);
        assert.equal(calls.get("update_frame"), 1);
        const counts = Object.fromEntries([...calls].sort(([a], [b]) => a.localeCompare(b)));
        const total = [...calls.values()].reduce((a, b) => a + b, 0);
        const expectedBulkCalls = Object.fromEntries(groups.flatMap(group => group.reads.map(name => [name,
          scenario[group.key] && (group.key === "volumes" || !name.endsWith("_ptr") || scenario.active) ? 1 : 0])));
        // Only named bulk getters receive an allowance. Empty lighting sidecars
        // read version/size/length; active ones also read one pointer, never one per entity.
        const extensionBudget = Object.values(expectedBulkCalls).reduce((sum, n) => sum + n, 0);
        const baseCalls = [...calls].filter(([name]) => !bulkReads.has(name)).reduce((sum, [, n]) => sum + n, 0);
        const budget = baseBudget + extensionBudget;
        const row = { scenario: scenario.name, entities, totalNativeMethodCalls: total, baseNativeMethodCalls: baseCalls,
          budget, extensionBudget, expectedBulkCalls, volumeCasterCount, volumeVertexCount, counts };
        cases.push(row); scenarioCases.push(row);
        for (const [name, expected] of Object.entries(expectedBulkCalls)) assert.equal(calls.get(name) ?? 0, expected,
          `${name} must use fixed bulk reads, independently of entity/caster count (${scenario.name})`);
        assert.ok(baseCalls <= baseBudget, `base frame dispatch budget exceeded: ${baseCalls} > ${baseBudget} (${entities} entities)`);
        assert.ok(total <= budget, `frame dispatch budget exceeded: ${total} > ${budget} (${entities} entities)`);
      } finally { native.free(); }
    }
    assert.deepEqual(scenarioCases[1].counts, scenarioCases[0].counts, `${scenario.name}: 128 entities changed frame dispatches`);
    assert.deepEqual(scenarioCases[2].counts, scenarioCases[0].counts, `${scenario.name}: 1024 entities changed frame dispatches`);
  }
  for (const entities of [1, 128, 1024]) assert.deepEqual(
    cases.find(row => row.scenario === "active-volume-sidecar" && row.entities === entities).counts,
    cases.find(row => row.scenario === "empty-volume-sidecar" && row.entities === entities).counts,
    "active volume casters must not add per-caster native calls");
  result.status = "passed";
}

function checkEffectCallbackLifetime() {
  const native = new Engine();
  const memory = wasm_memory();
  const order = [];
  const result = { name: "render-before-effect-and-owned-callback-frame" };
  let callbackFrame;
  let expectedCommands;
  try {
    configure(native);
    spawn(native);
    const bridge = new WasmBridge(native, memory);
    runFrame({ bridge, rustEngine: native, physicsSpec: resolvePhysicsSpec({}), needsFrameState: true,
      options: { effectEvents: { registry: resolvePresentationEffectRegistry({}),
        onDispatchSummary(_summary, frame) {
          order.push("effect-summary");
          assert.deepEqual(order, ["render", "effect-summary"], "render must finish before effect callbacks can mutate Wasm");
          callbackFrame = frame;
          assert.equal(frame.renderCommandBuffer.commandCount, 1);
          assert.equal(frame.renderCommandBuffer.buffer.length, 15);
          expectedCommands = Array.from(frame.renderCommandBuffer.buffer);
          const before = memory.buffer;
          let spawned = 0;
          while (memory.buffer === before && spawned < 20_000) { spawn(native); spawned++; }
          assert.notEqual(memory.buffer, before, "the regression must exercise real native memory.grow");
          assert.equal(frame.renderCommandBuffer.commandCount, 1);
          assert.equal(frame.renderCommandBuffer.buffer.length, 15, "effect callback received a detached borrowed buffer");
          assert.deepEqual(Array.from(frame.renderCommandBuffer.buffer), expectedCommands);
          result.spawnedToGrowMemory = spawned;
          result.memoryBytesAfter = memory.buffer.byteLength;
        },
      } },
      onRenderFrame(frame) {
        order.push("render");
        assert.equal(frame.renderCommandBuffer.commandCount, 1);
        assert.equal(frame.renderCommandBuffer.buffer.length, 15);
        assert.ok(frame.renderCommandBuffer.buffer.every(Number.isFinite));
        result.rendered = { count: frame.renderCommandBuffer.commandCount, length: frame.renderCommandBuffer.buffer.length };
      },
    }, 1 / 60);
    assert.deepEqual(order, ["render", "effect-summary"]);
    assert.deepEqual(Array.from(callbackFrame.renderCommandBuffer.buffer), expectedCommands);
    report.cases.push({ ...result, status: "passed" });
  } finally { native.free(); }
}

function configure(engine) {
  engine.use_data_scene();
  engine.set_viewport_size(512, 512);
  assert.ok(engine.configure_data_scene_camera(0, 0, 0xffffffff, 0, false, 0, 0, 0, 0, 0));
}

function checkNativeGameplayOwnership() {
  for (const name of ["NativeQuestLog", "NativeDialogueSession", "NativePixelMaskTerrain"]) {
    assert.equal(typeof nativeApi[name], "function", `${name} is missing from the current Wasm build`);
  }
  const questCalls = instrument(nativeApi.NativeQuestLog, ["apply", "snapshot", "restore"]);
  const dialogueCalls = instrument(nativeApi.NativeDialogueSession, ["choose", "snapshot", "restore"]);
  const terrainCalls = instrument(nativeApi.NativePixelMaskTerrain, ["set_pixel", "carve_rect", "carve_circle", "alpha_data"]);
  let quests, dialogue, terrain;
  try {
    quests = new QuestLog({ quests: { delivery: { title: "Delivery", stages: { collect: { title: "Collect" } } } } });
    assert.equal(quests.apply({ quest: "delivery", action: "start" }).status, "active");
    assert.equal(questCalls.calls.apply, 1);
    dialogue = new DialogueSession({ initialNode: "offer", nodes: {
      offer: { text: "Deliver", choices: [{ id: "finish", label: "Done", to: "done", setFlags: ["delivered"],
        questUpdates: [{ quest: "delivery", action: "complete" }] }] },
      done: { text: "Finished", end: true },
    } }, quests);
    const chosen = dialogue.choose("finish");
    assert.equal(chosen.node.id, "done");
    assert.equal(chosen.ended, true);
    assert.equal(dialogueCalls.calls.choose, 1);
    assert.equal(quests.snapshot().quests[0].status, "completed");
    assert.equal(questCalls.calls.apply, 1, "linked dialogue quest updates must execute inside Rust, without a second TS quest mutation");
    const questSnapshot = quests.snapshot();
    questSnapshot.quests[0].status = "inactive";
    assert.equal(quests.snapshot().quests[0].status, "completed", "returned quest snapshots must not own live progress");
    const dialogueSnapshot = dialogue.snapshot();
    dialogueSnapshot.flags.push("forged");
    dialogueSnapshot.nodeId = "offer";
    assert.deepEqual(dialogue.snapshot(), { nodeId: "done", flags: ["delivered"], ended: true });
    quests.restore({ quests: [{ id: "delivery", status: "active", stage: "collect", completedObjectives: [] }] });
    assert.equal(questCalls.calls.restore, 1);
    assert.equal(quests.snapshot().quests[0].status, "active");
    dialogue.restore({ nodeId: "offer", flags: [], ended: false });
    assert.equal(dialogueCalls.calls.restore, 1);
    assert.equal(dialogue.currentNode().id, "offer");

    terrain = new PixelMaskTerrain({ width: 8, height: 8, fill: "solid" });
    const alpha = terrain.data;
    assert.equal(alpha.length, 64);
    alpha.fill(0);
    assert.equal(terrain.alphaAt(0, 0), 255, "returned terrain alpha must be an owned snapshot");
    assert.equal(terrain.setPixel(0, 0, 0), true);
    assert.equal(terrainCalls.calls.set_pixel, 1);
    assert.equal(terrain.alphaAt(0, 0), 0);
    assert.equal(terrain.carveRect(1, 1, 2, 2), true);
    assert.equal(terrainCalls.calls.carve_rect, 1);
    assert.equal(terrain.carveCircle(5, 5, 1), true);
    assert.equal(terrainCalls.calls.carve_circle, 1);
    assert.equal(terrain.isSolid(5, 5), false);
    assert.ok(terrain.version > 0);
    assert.ok(terrain.dirtyRect());
    terrain.clearDirty();
    assert.equal(terrain.dirtyRect(), undefined);
    report.cases.push({ name: "native-quest-dialogue-terrain-ownership", status: "passed",
      questCalls: { ...questCalls.calls }, dialogueCalls: { ...dialogueCalls.calls }, terrainCalls: { ...terrainCalls.calls } });
  } finally {
    dialogue?.destroy(); quests?.destroy(); terrain?.destroy();
    questCalls.restore(); dialogueCalls.restore(); terrainCalls.restore();
  }
}

function instrument(Type, methods) {
  const calls = Object.fromEntries(methods.map(name => [name, 0]));
  const descriptors = methods.map(name => [name, Object.getOwnPropertyDescriptor(Type.prototype, name)]);
  for (const [name, descriptor] of descriptors) {
    assert.equal(typeof descriptor?.value, "function", `${Type.name}.${name} must be an actual native method`);
  }
  for (const [name, descriptor] of descriptors) {
    Object.defineProperty(Type.prototype, name, { ...descriptor, value(...args) {
      calls[name]++;
      return Reflect.apply(descriptor.value, this, args);
    } });
  }
  return { calls, restore() { for (const [name, descriptor] of descriptors) Object.defineProperty(Type.prototype, name, descriptor); } };
}

function spawn(engine) {
  assert.ok(engine.spawn_data_scene_entity(0, 0, 0, 0, 1, 16, 16, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0,
    false, false, 0, 0, 0, 0, 0, 0, 0, 0, new Float32Array()));
}

function neutralInput() {
  return { w: false, a: false, s: false, d: false, space: false, enter: false,
    mouseLeft: false, mouseX: 0, mouseY: 0 };
}

function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

async function hashSources(directory, extensions, ignored = new Set()) {
  const files = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory() && !ignored.has(entry.name)) await visit(child);
      else if (entry.isFile() && extensions.some(extension => entry.name.endsWith(extension))) files.push(child);
    }
  }
  await visit(resolve(root, directory));
  const digest = createHash("sha256");
  for (const file of files.sort()) digest.update(relative(root, file) + "\0" + hash(await readFile(file)) + "\n");
  return { files: files.length, sha256: digest.digest("hex") };
}
