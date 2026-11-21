import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { probeNativeFileQuotas } from "./native-file-native-quota-boundaries.mjs";

/** Exercise the public file session against a real renderer, then each lowerable native quota. */
export async function probeNativeFileLimitAcceptance(page, wasmUrl) {
  const asset = name => readFile(new URL("../../examples/topdown-shooter/public/assets/" + name, import.meta.url));
  const [png, wav] = await Promise.all([asset("player.png"), asset("hit.wav")]);
  async function runCase({ wasmUrl, png, wav, resourceLimits, omitRole, runtimeFrames }) {
    const { createEngine, createFerrumRuntime, createNativeGameFileSession, NativeGameFileError, BrowserPlatformHost,
      WebGL2Renderer, UNIFIED_PHYSICS_STATE_LAYOUT } = await import("@ferrum2d/ferrum-web/core");
    const { resolvePresentationEffectRegistry } = await import("@ferrum2d/ferrum-web/authoring");
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    function equal(left, right, field) {
      check(JSON.stringify(left) === JSON.stringify(right), field + ": " + JSON.stringify([left, right]));
    }
    const wasm = new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer());
    function makeScope() {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      const renderer = new WebGL2Renderer(canvas);
      const host = new BrowserPlatformHost(renderer);
      const gl = canvas.getContext("webgl2");
      let cleanups = 0;
      return {
        canvas, renderer, host,
        cleanupCount: () => cleanups,
        assertReleased() {
          const stats = renderer.resourceStats();
          check(cleanups === 1 && ["textureCount", "bufferCount", "programCount", "renderTargetCount"]
            .every(key => stats[key] === 0), "target GPU resources or disposal count");
        },
        dispose() {
          cleanups++;
          host.destroy();
          renderer.destroy();
          gl.getExtension("WEBGL_lose_context")?.loseContext();
        },
      };
    }
    function assets(scope) {
      return [scope.host.textureId("hero"), scope.host.hasSound(scope.host.soundId("cue")),
        scope.host.getJsonAsset("settings").speed, scope.renderer.resourceStats().renderTargetCount];
    }
    const callbacks = {
      "frame.onFrame": () => {}, "frame.inputProvider": () => ({}),
      "frame.viewportProvider": () => ({ width: 32, height: 32 }),
    };
    const lifecycle = {}, effects = { registry: resolvePresentationEffectRegistry({}) };
    for (const name of ["onStart", "onPause", "onResume", "onStop", "onDestroy"]) {
      lifecycle[name] = callbacks["options.lifecycle." + name] = () => {};
    }
    for (const name of ["hasSoundEffect", "hasParticlePreset", "shakeCameraEffect", "applyCustomEffect", "onDispatchSummary"]) {
      effects[name] = callbacks["options.effectEvents." + name] = () => true;
    }
    effects.target = callbacks["options.effectEvents.target"] = { playSoundEffect() {} };
    const source = makeScope();
    let runtime;
    if (runtimeFrames) {
      delete callbacks["frame.onFrame"];
      callbacks["frame.onRenderFrame"] = () => {};
      runtime = await createFerrumRuntime({ canvas: source.canvas, renderer: source.renderer, assetHost: source.host,
        engine: { lifecycle, effectEvents: effects }, ui: false, debug: false, autostart: false });
    }
    const roles = Object.keys(callbacks).sort();
    const engine = runtime?.engine ?? await createEngine(callbacks["frame.onFrame"], callbacks["frame.inputProvider"],
      source.host, callbacks["frame.viewportProvider"], { lifecycle, effectEvents: effects });
    const urls = [];
    function url(blob) { const value = URL.createObjectURL(blob); urls.push(value); return value; }
    try {
      engine.useDataScene();
      engine.configureUnifiedPhysics({ space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: .01 });
      const handle = engine.spawnUnifiedPhysicsBody({ kind: "kinematic-velocity", linearVelocity: [2, 0, 0],
        collider: { shape: { type: "sphere", radius: .25 } } });
      const id = new Uint32Array([handle.entityId, handle.entityGeneration]);
      function pose(e) {
        const rows = e.queryUnifiedPhysicsBodyStates(id);
        check(rows.count === 1, "lost body");
        return Array.from(rows.floats);
      }
      await engine.loadAssets({
        textures: { hero: url(new Blob([Uint8Array.from(png)], { type: "image/png" })) },
        sounds: { cue: url(new Blob([Uint8Array.from(wav)], { type: "audio/wav" })) },
        json: { settings: url(new Blob(['{"speed":3}'], { type: "application/json" })) },
      });
      source.host.getJsonAsset("settings").speed = 7;
      source.renderer.createRenderTexture(17, { width: 8, height: 8 });
      const savedAssets = assets(source), savedPose = pose(engine);
      check(savedAssets[0] > 0 && savedAssets[1] && savedAssets[2] === 7 && savedAssets[3] === 1, "source resources incomplete");
      const sourceFile = await createNativeGameFileSession(engine, { wasm });
      let file;
      try { file = await sourceFile.capture(); } finally { await sourceFile.dispose(); }
      for (const value of urls.splice(0)) URL.revokeObjectURL(value);
      let session, budget, result, target, requiredRoles;
      try {
        session = await createNativeGameFileSession(engine, { wasm, resourceLimits,
          preparePlatform(context) {
            budget = context.budget;
            requiredRoles = [...context.requiredRoles].sort();
            equal(requiredRoles, roles, "saved adapter roles");
            target = makeScope();
            const bindings = { ...callbacks };
            if (omitRole) delete bindings[omitRole];
            return { assetHost: target.host, callbacks: bindings, dispose: target.dispose,
              validate(e) {
                equal(pose(e), savedPose, "restored body");
                equal(assets(target), savedAssets, "restored resources");
              },
            };
          },
        });
        const token = await session.prepare(file);
        const commit = await session.commit(token);
        equal(commit.cleanupErrors.length, 0, "commit cleanup");
        check(commit.epoch === 1 && session.current() !== engine, "unpublished prepared scope");
        result = { accepted: true, usage: budget.usage(), requiredRoles };
      } catch (error) {
        if (!(error instanceof NativeGameFileError)) throw error;
        if (session) check(session.epoch() === 0 && session.current() === engine, "failed restore changed source");
        result = { accepted: false, code: error.code, phase: error.phase, field: String(error.cause), usage: budget?.usage() };
      } finally {
        if (session) await session.dispose();
        target?.assertReleased();
        check(source.cleanupCount() === 0, "borrowed source destroyed");
        equal(pose(engine), savedPose, "source pose");
        equal(assets(source), savedAssets, "source resources");
      }
      engine.stepRigidBodies(.01);
      check(pose(engine)[UNIFIED_PHYSICS_STATE_LAYOUT.position] > savedPose[UNIFIED_PHYSICS_STATE_LAYOUT.position], "source did not advance");
      return { ...result, wasmBytes: wasm.byteLength, fileBytes: file.byteLength, restoredAssets: savedAssets };
    } finally {
      for (const value of urls) URL.revokeObjectURL(value);
      if (runtime) runtime.destroy(); else engine.destroy();
      source.dispose();
      source.assertReleased();
    }
  }

  // Publishing also advances the shared document font generation. Give every case
  // a fresh document with the same initial state on both sides of a quota boundary.
  const inputs = { wasmUrl, png: [...png], wav: [...wav] };
  async function attempt(options = {}) {
    await page.reload();
    return await page.evaluate(runCase, { ...inputs, ...options });
  }

  const baseline = await attempt();
  assert(baseline.accepted, JSON.stringify(baseline));
  const quotas = {}, missingRoles = {};
  const fields = { maxResources: "resources", maxWork: "work", maxMetadataBytes: "metadataBytes",
    maxSourceBytes: "sourceBytes", maxDecodedBytes: "decodedBytes", maxGpuBytes: "gpuBytes" };
  for (const [name, usageKey] of Object.entries(fields)) {
    // Creating the session copies the Wasm twice. Prepare and commit use a separate ledger.
    const exact = name === "maxSourceBytes" ? Math.max(baseline.wasmBytes * 2, baseline.usage.sourceBytes) : baseline.usage[usageKey];
    const accepted = await attempt({ resourceLimits: { [name]: exact } });
    assert(accepted.accepted, name + " exact " + JSON.stringify({ baseline, actual: accepted }));
    const rejected = await attempt({ resourceLimits: { [name]: exact - 1 } });
    assert(!rejected.accepted && rejected.code === "LIMIT", name + " below " + JSON.stringify(rejected));
    quotas[name] = { exact, below: { code: rejected.code, phase: rejected.phase, field: rejected.field } };
  }
  for (const role of baseline.requiredRoles) {
    const missing = await attempt({ omitRole: role });
    assert(!missing.accepted && missing.code === "CAPABILITY" && missing.phase === "prepare" && missing.field.includes(role),
      role + " " + JSON.stringify(missing));
    missingRoles[role] = { code: missing.code, phase: missing.phase };
  }
  // createFerrumRuntime also installs the internal render-frame callback.
  const runtime = await attempt({ runtimeFrames: true });
  assert(runtime.accepted && runtime.requiredRoles.includes("frame.onRenderFrame"), JSON.stringify(runtime));
  const missingRender = await attempt({ runtimeFrames: true, omitRole: "frame.onRenderFrame" });
  assert(!missingRender.accepted && missingRender.code === "CAPABILITY" && missingRender.phase === "prepare" &&
    missingRender.field.includes("frame.onRenderFrame"), JSON.stringify(missingRender));
  missingRoles["frame.onRenderFrame"] = { code: missingRender.code, phase: missingRender.phase };
  const resources = { wasmBytes: baseline.wasmBytes, fileBytes: baseline.fileBytes, restoredAssets: baseline.restoredAssets,
    restoreUsage: baseline.usage, quotas, missingRoles };
  const native = await probeNativeFileQuotas(page, wasmUrl);
  return { resources, native };
}
