import "./nativeRuntimeTestHelper.js";
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { applyDataSceneAuthoringDocument, resolveSceneAuthoringDocument } from "../src/authoring.js";
import { createEngine } from "../src/createEngine.js";
import type { FerrumEngine, FrameState } from "../src/engineTypes.js";
import { loadSpatialGlb, type SpatialModelAsset } from "../src/spatialModel.js";
import { fakeWebGL2, installRendererGlobals, pngImageBitmap } from "./fakeWebGL2TestHelper.js";

// Logic half of smoke:feature-examples: every authored Data Scene feature runs on the native
// engine in Playing state within the lab budget, and two engines fed the same frames agree
// exactly. Pixels, tabs, the sidebar, audio and recovery stay in the browser smoke; feature
// controls (featureExtras.ts) and the three Game Spec shooter fixtures are not replayed here.

const repository = new URL("../../../../", import.meta.url);
const featureDir = new URL("examples/starter-runtime/public/features/", repository);
const read = async (url: URL) => new TextDecoder().decode(await readFile(url));
const catalog = JSON.parse(await read(new URL("examples/shared/featureCatalog.json", repository))) as { id: string }[];

type Feature = { id: string; source: Record<string, unknown> & { sceneComposition?: { initialFragment: string; fragments: Record<string, { instances: unknown[] }> }; spatial?: { models?: Record<string, { asset: string }> } } };

async function features(): Promise<Feature[]> {
  return Promise.all(catalog.map(async ({ id }) => ({ id, source: JSON.parse(await read(new URL(`${id}.json`, featureDir))) })));
}

async function spatialModels(feature: Feature): Promise<Map<string, SpatialModelAsset>> {
  const models = new Map<string, SpatialModelAsset>();
  const assets = new Set(Object.values(feature.source.spatial?.models ?? {}).map(model => model.asset));
  if (!assets.size) return models;
  const restore = installRendererGlobals();
  const globals = globalThis as unknown as { document: unknown; createImageBitmap: unknown };
  // GLB textures decode through an isolated WebGL2 readback; the stand-in returns opaque texels.
  globals.document = { createElement: () => ({ width: 1, height: 1, getContext: () => fakeWebGL2().gl }) };
  globals.createImageBitmap = pngImageBitmap;
  try {
    for (const asset of assets) {
      const bytes = await readFile(new URL(`spatial/${asset}.glb`, featureDir));
      models.set(asset, await loadSpatialGlb(bytes.slice().buffer, { materialProfile: "diffuse" }));
    }
  } finally {
    restore();
  }
  return models;
}

async function runFeature(feature: Feature, models: ReadonlyMap<string, SpatialModelAsset>, frames: number) {
  let last: FrameState | undefined;
  const textures = new Map<string, number>();
  const engine: FerrumEngine = await createEngine(frame => { last = frame; }, undefined, undefined, () => ({ width: 640, height: 384 }), {
    includeCollisionEvents: true, includeGameplayEvents: true,
    ...(feature.id === "physics" ? { fixedTimestep: { enabled: true, stepSeconds: 1 / 60 } } : {}),
    ...(feature.id === "save-load" ? { physicsBackend: "legacy" as const } : {}),
  });
  const request = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  let tick: FrameRequestCallback | undefined;
  globalThis.requestAnimationFrame = callback => { tick = callback; return 1; };
  globalThis.cancelAnimationFrame = () => { tick = undefined; };
  try {
    for (const [name, model] of models) equal(engine.registerDataSceneSpatialModel(name, model), true, `${feature.id} model ${name}`);
    applyDataSceneAuthoringDocument(engine, feature.source as never, {
      textureId: name => {
        const key = String(name);
        if (!textures.has(key)) textures.set(key, textures.size + 1);
        return textures.get(key)!;
      },
    });
    // The lab centers its 640x384 view on the scene.
    engine.setDataSceneCamera({ x: 320, y: 192 });
    engine.start();
    let clock = 0;
    // The loop's first callback only records its start time.
    tick?.(clock);
    const states: FrameState[] = [];
    for (let i = 0; i < frames; i += 1) {
      const callback = tick;
      if (!callback) throw new Error(`${feature.id}: missing scheduled frame`);
      tick = undefined;
      callback(clock += 1000 / 60);
      if (!last) throw new Error(`${feature.id}: missing frame state`);
      states.push(last);
    }
    const final = states[states.length - 1]!;
    return {
      first: { state: states[0]!.gameState, entities: states[0]!.entityCount, commands: states[0]!.renderCommandBuffer.commandCount,
        spatial: states[0]!.renderCommandBuffer.spatial !== undefined },
      final: {
        state: final.gameState, entities: final.entityCount, time: engine.time(),
        commands: Array.from(final.renderCommandBuffer.buffer.subarray(0, final.renderCommandBuffer.commandCount * final.renderCommandBuffer.floatsPerCommand)),
      },
    };
  } finally {
    engine.destroy();
    globalThis.requestAnimationFrame = request;
    globalThis.cancelAnimationFrame = cancel;
  }
}

test("every authored feature scene validates, plays natively within the lab budget and replays identically", async () => {
  const authored = (await features()).filter(feature => feature.source.sceneComposition);
  equal(catalog.length, 31);
  equal(authored.length, 28, "three feature fixtures are Game Spec shooters");
  for (const feature of authored) {
    resolveSceneAuthoringDocument(feature.source as never, { validateBindings: true, validateComponents: true });
    const models = await spatialModels(feature);
    const composition = feature.source.sceneComposition!;
    const instances = composition.fragments[composition.initialFragment]!.instances.length;
    const first = await runFeature(feature, models, 30);
    equal(first.first.state, 1, `${feature.id} must run in native Playing state`);
    equal(first.first.entities, instances, `${feature.id} spawns its authored instances`);
    // HD-2D scenes submit through the spatial packet; flat scenes through sprite commands.
    if (feature.source.spatial) ok(first.first.spatial, `${feature.id} must submit a spatial packet`);
    else ok(first.first.commands > 0, `${feature.id} must submit sprite commands`);
    ok(first.first.commands <= 400, `${feature.id} render commands ${first.first.commands}`);
    ok(first.first.entities <= 100, `${feature.id} initial scene budget`);
    equal(first.final.state, 1, `${feature.id} keeps playing`);
    const second = await runFeature(feature, models, 30);
    deepEqual(second.final, first.final, `${feature.id} must replay identically from the same frames`);
  }
});
