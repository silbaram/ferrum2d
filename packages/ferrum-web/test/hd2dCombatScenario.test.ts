import "./nativeRuntimeTestHelper.js";
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { fakeWebGL2, ONE_PIXEL_PNG, pngImageBitmap } from "./fakeWebGL2TestHelper.js";

// Logic half of smoke:hd2d-combat and smoke:village-game-quality. The browser fixtures run
// unchanged under Node with a WebGL2 stand-in and a virtual clock, so the native combat, AI,
// projectiles, ramp movement, pause, checkpoints and reset are checked on every PR. GPU timing,
// pixels, spatial audio output and frame budgets stay in the browser smokes.

const repository = new URL("../../../../", import.meta.url);
const sdk = (name: string) => new URL(`../src/${name}.js`, import.meta.url).href;
const files: Record<string, string> = {
  "/rock.glb": "examples/data-scene-native/assets/rock.glb",
  "/village.scene.json": "apps/studio/public/placement.village.scene-authoring.json",
};

async function fixtureModule(file: string, imports: readonly [string, string][] = []): Promise<string> {
  let code = new TextDecoder().decode(await readFile(new URL(`tests/smoke/${file}`, repository)));
  for (const [from, to] of [
    ["@ferrum2d/ferrum-web/core", sdk("core")],
    ["@ferrum2d/ferrum-web/authoring", sdk("authoring")],
    ["@ferrum2d/ferrum-web/quality", sdk("quality")],
    ...imports,
  ]) code = code.split(`"${from}"`).join(JSON.stringify(to)).split(`'${from}'`).join(JSON.stringify(to));
  return "data:text/javascript;charset=utf-8," + encodeURIComponent(code);
}

type Globals = Record<string, unknown>;

/** Browser globals for the fixtures: files instead of HTTP, a virtual frame clock and image sizes. */
async function withBrowserStandIns(run: () => Promise<void>): Promise<void> {
  const globals = globalThis as unknown as Globals;
  const names = ["document", "window", "createImageBitmap", "fetch", "requestAnimationFrame", "cancelAnimationFrame"];
  const previous = Object.fromEntries(names.map(name => [name, globals[name]]));
  const previousNow = performance.now;
  let clock = 1000;
  let nextFrame = 0;
  const pending = new Map<number, FrameRequestCallback>();
  let flushing = false;
  const flush = () => {
    flushing = false;
    clock += 1000 / 60;
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks) callback(clock);
  };
  performance.now = () => clock;
  globals.requestAnimationFrame = (callback: FrameRequestCallback) => {
    pending.set(++nextFrame, callback);
    if (!flushing) { flushing = true; setTimeout(flush, 0); }
    return nextFrame;
  };
  globals.cancelAnimationFrame = (id: number) => { pending.delete(id); };
  globals.document = {
    createElement: () => ({
      width: 0, height: 0, toDataURL: () => ONE_PIXEL_PNG,
      // GLB textures decode through an isolated WebGL2 readback; the stand-in returns zero texels.
      getContext: (kind: string) => kind === "webgl2" ? fakeWebGL2().gl : { fillRect() {}, fillStyle: "" },
    }),
  };
  globals.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  globals.createImageBitmap = pngImageBitmap;
  const nativeFetch = previous.fetch as typeof fetch;
  globals.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("data:")) return nativeFetch(url, init);
    const path = url.startsWith("/village/") ? "apps/studio/public/assets/rpg-village/" + url.slice(9) : files[url];
    if (!path) throw new Error(`Unexpected fixture request ${url}`);
    return new Response(new Blob([(await readFile(new URL(path, repository))).slice()]));
  };
  try {
    await run();
  } finally {
    performance.now = previousNow;
    for (const name of names) globals[name] = previous[name];
  }
}

const canvas = () => {
  const fake = fakeWebGL2();
  Object.assign(fake.canvas, { width: 960, height: 640, clientWidth: 960, clientHeight: 640 });
  return fake.canvas;
};

test("HD-2D combat with 216 models keeps AI, repeat fire, hits, kills and checkpoints on the native engine", async () => {
  await withBrowserStandIns(async () => {
    const { startCombatProbe } = await import(await fixtureModule("hd2d-combat-browser-fixture.mjs"));
    for (const enemyCount of [0, 32]) {
      const scene = await startCombatProbe(canvas(), enemyCount);
      try {
        const result = await scene.sample({ warmupMs: 500, durationMs: 1500 });
        result.pauseFrozen = await scene.pauseCheck();
        result.checkpoint = scene.saveCheck();
        result.resetClean = await scene.resetCheck();
        deepEqual(result.errors, []);
        ok(result.frames >= 10, "insufficient live combat frames");
        ok(result.rows.every((row: { models: number; modelDrawCalls: number; triangles: number }) =>
          row.models === 216 && row.modelDrawCalls > 0 && row.triangles === 216 * 8), "background models disappeared");
        ok(result.pauseFrozen && result.checkpoint.version === 9 && result.resetClean);
        equal(result.checkpoint.actors, 217 + enemyCount - Math.min(enemyCount, 4));
        for (const field of ["bufferCount", "textureCount", "programCount"])
          equal(result.resources[field], result.resourceBaseline[field], `steady combat GPU ${field} grew`);
        ok(result.resources.bufferBytes <= 2 * 1024 * 1024, "combat GPU buffers exceeded 2 MiB capacity budget");
        if (enemyCount > 0) {
          ok(result.after.aiSteps > result.before.aiSteps && result.after.spawned > result.before.spawned, "AI or repeat fire stopped");
          ok(result.after.hits > result.before.hits && result.after.kills >= 1
            && result.after.particlesSpawned > result.before.particlesSpawned && result.maxParticles > 0,
          `combat did not produce hits, kills and particles: ${JSON.stringify({ before: result.before, after: result.after })}`);
          ok(Math.hypot(result.aiAfter.x - result.aiBefore.x, result.aiAfter.y - result.aiBefore.y) > 0.1, "native AI counted steps without moving");
          ok(result.actorHitEvents > 0, "projectiles did not damage the primary actor");
          equal(result.after.capped, 0, "native combat capacity was exceeded");
          ok(result.maxBillboards > enemyCount + 1, "dynamic projectiles never reached spatial billboards");
        } else equal(result.after.spawned, 0);
      } finally {
        scene.destroy();
      }
    }
  });
});

test("the native village keeps 32 enemies fighting, the actor climbing the ramp and checkpoints exact", async () => {
  await withBrowserStandIns(async () => {
    const combat = await fixtureModule("hd2d-combat-browser-fixture.mjs");
    const { startVillageQuality } = await import(await fixtureModule("village-game-quality-fixture.mjs", [["./hd2d-combat-browser-fixture.mjs", combat]]));
    const demo = await startVillageQuality(canvas(), { effects: true, audio: false, lod: false });
    // Spatial audio owns the fixture's pose trace in the browser; here the frame clock samples it.
    const elevations: number[] = [];
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = callback => raf(time => {
      callback(time);
      const actor = demo.handles?.actor;
      if (!actor) return;
      const pose = demo.engine.queryAudioPoseBuffer(new Uint32Array([actor.entityId, actor.entityGeneration]));
      if (pose.words[0]) elevations.push(pose.floats[6]);
    });
    try {
      const result = await demo.sample({ warmupMs: 1000, durationMs: 2500 });
      deepEqual(result.errors, []);
      ok(result.frames >= 10);
      equal(result.modelCount, 42);
      equal(result.enemyCount, 32);
      equal(result.before.actors, 32);
      ok(result.after.aiSteps > result.before.aiSteps, "native AI must continue during sampling");
      ok(result.after.spawned > result.before.spawned, "native combat must fire");
      ok(result.maxParticles > 0, "native combat VFX missing");
      ok(Math.max(...elevations) >= 20 && Math.abs(Math.min(...elevations)) <= 1.1,
        `live input must traverse the village ramp: ${Math.min(...elevations)}..${Math.max(...elevations)}`);
      for (const field of ["bufferCount", "textureCount", "programCount"])
        equal(result.resources[field], result.resourceBaseline[field], `warm resource growth: ${field}`);
      ok(result.wasmMemoryBytes > 0 && result.wasmMemoryBytes <= 128 * 1024 * 1024, "village Wasm memory budget exceeded");
      const saved = await demo.saveCheck();
      equal(saved.restoredTime, result.checkpointTime, "the checkpoint uses the stopped village frame");
      ok(saved.resumedTime > saved.restoredTime, "the restored village must advance");
    } finally {
      globalThis.requestAnimationFrame = raf;
      const cleanup = demo.destroy();
      for (const field of ["bufferCount", "textureCount", "programCount", "renderTargetCount"])
        equal(cleanup.gpu[field], 0, `owned GPU resource leaked: ${field}`);
    }
  });
});
