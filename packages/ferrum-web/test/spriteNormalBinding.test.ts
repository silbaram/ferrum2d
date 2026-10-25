import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createEngine } from "../src/core.js";
import {
  createSpriteNormalAssetBinding,
  resolveSpriteNormalAssetBinding,
  diagnoseSpriteNormalAssetBinding,
  createSceneSpriteNormalPatch,
  createScenePlacementViewer,
  createScenePlacementAgentHandoff,
  mergeScenePlacementPatch,
  resolveSceneAuthoringDocument,
  applyDataSceneAuthoringDocument,
  resolveDataSceneSpatialSpec,
  type SceneAuthoringDocumentSpec,
  type SpriteNormalAssetBinding,
  type SpriteNormalTextureAsset,
} from "../src/authoring.js";
import { applySceneSpatialPatch } from "../src/sceneSpatialPatch.js";
import { resolveSpatialNormalTextures } from "../src/dataSceneSpatial.js";

const digest = (letter: string) => letter.repeat(64);
function staticOptions() {
  return {
    colorAsset: "hero.color",
    normalAsset: "hero.normal",
    report: {
      format: "ferrum2d.sprite-normals.report",
      version: 1,
      ok: true,
      normalFormat: "opengl",
      colorSpace: "none",
      generator: {
        repository: "https://example.test/generator.git",
        revision: "a".repeat(40),
        binarySha256: digest("f"),
      },
      config: { sha256: digest("e") },
      settings: { normalStrength: 1.5, frameSize: { width: 2, height: 2 } },
      results: [
        {
          input: { path: "source/hero.png", sha256: digest("a") },
          width: 2,
          height: 2,
          color: "source/hero.png",
          normal: "hero_n.png",
          outputs: [{ path: "hero_n.png", sha256: digest("b") }],
        },
      ],
    },
  };
}
function animatedOptions() {
  const options = staticOptions(),
    source = options.report.results[0];
  const first = { u0: 0, v0: 0, u1: 0.5, v1: 1 },
    second = { u0: 0.5, v0: 0, u1: 1, v1: 1 };
  const color = "hero_n.ferrum.color.png",
    normal = "hero_n.ferrum.normal.png",
    descriptor = "hero_n.ferrum.json";
  return {
    ...options,
    descriptorSha256: digest("f"),
    report: {
      ...options.report,
      results: [
        {
          ...source,
          width: 4,
          color: "hero_n.color.png",
          frames: "hero_n.frames.json",
          ferrumAnimation: { color, normal, descriptor },
          outputs: [
            ...source.outputs,
            { path: "hero_n.color.png", sha256: digest("a") },
            { path: color, sha256: digest("c") },
            { path: normal, sha256: digest("d") },
            { path: descriptor, sha256: digest("f") },
          ],
        },
      ],
    },
    descriptor: {
      format: "ferrum2d.sprite-normal.animation",
      version: 1,
      textures: {
        color: { path: color, colorSpace: "srgb" },
        normal: { path: normal, colorSpace: "none" },
      },
      atlas: {
        format: "ferrum-texture-atlas-pack",
        version: 1,
        texture: "color",
        image: color,
        width: 4,
        height: 2,
        frames: {
          "frame-000": {
            texture: "color",
            uv: first,
            size: { width: 2, height: 2 },
          },
          "frame-001": {
            texture: "color",
            uv: second,
            size: { width: 2, height: 2 },
          },
        },
      },
      animationSet: {
        initialClip: 5,
        clips: [{ id: 5, fps: 10, loop: true, frames: [first, first, second] }],
      },
      source: { colorSha256: digest("a"), normalSha256: digest("b") },
    },
  };
}
function assets(binding: SpriteNormalAssetBinding): SpriteNormalTextureAsset[] {
  return (["color", "normal"] as const).map((kind) => ({
    id: binding.textures[kind].asset,
    width: binding.width,
    height: binding.height,
    colorSpace: binding.textures[kind].colorSpace,
    sha256: binding.textures[kind].sha256,
    frames: binding.frames,
  }));
}
function document(): SceneAuthoringDocumentSpec {
  return {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    behaviorRecipes: { entities: {} },
    sceneComposition: {
      initialFragment: "main",
      prefabs: {
        object: {
          props: {
            components: {
              visual: {
                kind: "sprite",
                texture: 0,
                width: 32,
                height: 48,
                originX: 0.25,
                originY: 1,
                tint: "#ffffff",
              },
              collider: "none",
              layer: "player",
            },
            custom: "keep",
          },
        },
      },
      fragments: {
        main: { instances: [{ id: "hero", prefab: "object", x: 5, y: 7 }] },
      },
    },
    spatial: {
      camera: {
        projection: "orthographic",
        position: { x: 0, y: -100, elevation: 60 },
        target: { x: 0, y: 0, elevation: 0 },
        height: 120,
      },
      terrain: [],
      billboards: { hero: { normalTextureId: 9, castShadow: false } },
    },
  };
}

test("static and animation bindings preserve report provenance and round-trip without runtime IDs", () => {
  for (const options of [staticOptions(), animatedOptions()]) {
    const before = JSON.stringify(options),
      binding = createSpriteNormalAssetBinding(options);
    equal(JSON.stringify(options), before);
    deepEqual(
      resolveSpriteNormalAssetBinding(JSON.parse(JSON.stringify(binding))),
      binding,
    );
    equal(binding.textures.color.asset, "hero.color");
    equal(binding.textures.normal.asset, "hero.normal");
    equal(binding.generation.input.sha256, digest("a"));
    equal(binding.generation.settings.normalStrength, 1.5);
    equal(binding.generation.configSha256, digest("e"));
    equal(binding.generation.binarySha256, digest("f"));
    deepEqual(diagnoseSpriteNormalAssetBinding(binding, assets(binding)), []);
    ok(!JSON.stringify(binding).includes("textureId"));
  }
});

test("invalid report/descriptor/hash/UV and incompatible persisted bindings fail", () => {
  const original = animatedOptions();
  for (const edit of [
    (o: typeof original) => {
      o.report.ok = false;
    },
    (o: typeof original) => {
      o.descriptorSha256 = digest("a");
    },
    (o: typeof original) => {
      o.descriptor.source.normalSha256 = digest("e");
    },
    (o: typeof original) => {
      o.descriptor.textures.normal.colorSpace = "srgb";
    },
    (o: typeof original) => {
      o.descriptor.atlas.frames["frame-000"].size.width = 1;
    },
    (o: typeof original) => {
      o.descriptor.animationSet.clips[0].frames[0] = {
        u0: 0,
        v0: 0,
        u1: 1,
        v1: 1,
      };
    },
  ]) {
    const options = structuredClone(original);
    edit(options);
    throws(() => createSpriteNormalAssetBinding(options));
  }
  const b = createSpriteNormalAssetBinding(staticOptions());
  for (const bad of [
    { ...b, version: 2 },
    { ...b, width: 0 },
    {
      ...b,
      textures: {
        ...b.textures,
        normal: { ...b.textures.normal, asset: b.textures.color.asset },
      },
    },
    { ...b, frames: [{ u0: 0.1, v0: 0, u1: 1, v1: 1 }] },
    { ...b, generation: { ...b.generation, configSha256: "bad" } },
  ])
    throws(() => resolveSpriteNormalAssetBinding(bad));
});

test("asset diagnostics distinguish missing, duplicate, sRGB, dimensions, content and UV layout", () => {
  const binding = createSpriteNormalAssetBinding(animatedOptions()),
    good = assets(binding);
  equal(
    diagnoseSpriteNormalAssetBinding(binding, [good[0]])[0].code,
    "missingTexture",
  );
  equal(
    diagnoseSpriteNormalAssetBinding(binding, [...good, good[1]])[0].code,
    "duplicateTexture",
  );
  for (const [changes, code] of [
    [{ colorSpace: "srgb" }, "colorSpaceMismatch"],
    [{ width: 8 }, "dimensionsMismatch"],
    [{ sha256: digest("e") }, "contentHashMismatch"],
    [{ frames: [{ u0: 0, v0: 0, u1: 1, v1: 1 }] }, "frameLayoutMismatch"],
  ] as const)
    equal(
      diagnoseSpriteNormalAssetBinding(binding, [
        good[0],
        { ...good[1], ...changes },
      ])[0].code,
      code,
    );
  deepEqual(
    diagnoseSpriteNormalAssetBinding(binding, [
      good[0],
      { ...good[1], colorSpace: "linear" },
    ]),
    [],
  );
});

test("deterministic combined patch preserves source/behavior/collider/pose and survives document reopening", () => {
  const source = document(),
    before = JSON.stringify(source),
    binding = createSpriteNormalAssetBinding(animatedOptions());
  const generated = createSceneSpriteNormalPatch(source, binding, {
    instanceId: "hero",
    assets: assets(binding),
  });
  deepEqual(
    createSceneSpriteNormalPatch(source, binding, {
      instanceId: "hero",
      assets: assets(binding),
    }),
    generated,
  );
  const merged = mergeScenePlacementPatch(source, generated.patch).document;
  equal(JSON.stringify(source), before);
  deepEqual(merged.behaviorRecipes, source.behaviorRecipes);
  equal(merged.spatial!.billboards.hero.normalTexture, "hero.normal");
  equal(merged.spatial!.billboards.hero.normalTextureId, undefined);
  equal(merged.spatial!.billboards.hero.castShadow, false);
  const reopened = resolveSceneAuthoringDocument(
      JSON.parse(JSON.stringify(merged)),
      { validateBindings: true },
    ),
    instance = reopened.bindingPlan!.instances[0];
  const components = instance.props.components as {
    visual: {
      texture: string;
      originX: number;
      width: number;
      height: number;
      animationSet: unknown;
    };
    collider: string;
  };
  equal(components.visual.texture, "hero.color");
  equal(components.visual.width, 32);
  equal(components.visual.height, 48);
  equal(components.visual.originX, 0.25);
  equal(components.collider, "none");
  equal(instance.x, 5);
  equal(instance.y, 7);
  equal(instance.props.custom, "keep");
  deepEqual(components.visual.animationSet, binding.animationSet);
  throws(
    () =>
      createSceneSpriteNormalPatch(source, binding, {
        instanceId: "hero",
        assets: assets(binding).map((a) => ({ ...a, sha256: digest("e") })),
      }),
    /contentHashMismatch/,
  );
  equal(JSON.stringify(source), before);
});

test("normal spatial patch v4 replaces legacy IDs, detaches and rejects older versions atomically", () => {
  const spatial = document().spatial!,
    before = JSON.stringify(spatial);
  const patch = {
    format: "ferrum2d.scene-spatial.patch",
    version: 4,
    operations: [
      {
        kind: "setBillboardNormalTexture",
        id: "hero",
        changes: { normalTexture: "hero.normal" },
      },
    ],
  } as const;
  equal(
    applySceneSpatialPatch(spatial, patch).billboards.hero.normalTexture,
    "hero.normal",
  );
  throws(
    () => applySceneSpatialPatch(spatial, { ...patch, version: 3 }),
    /version 4/,
  );
  const detached = applySceneSpatialPatch(spatial, {
    ...patch,
    operations: [
      {
        kind: "setBillboardNormalTexture",
        id: "hero",
        changes: { normalTexture: null },
      },
    ],
  });
  equal(detached.billboards.hero.normalTextureId, undefined);
  equal(detached.billboards.hero.normalTexture, undefined);
  equal(JSON.stringify(spatial), before);
  for (const value of [null, "", " bad ", 42])
    throws(() =>
      resolveDataSceneSpatialSpec({
        ...spatial,
        billboards: { hero: { normalTexture: value } },
      }),
    );
  throws(
    () =>
      resolveDataSceneSpatialSpec({
        ...spatial,
        billboards: { hero: { normalTexture: "normal", normalTextureId: 3 } },
      }),
    /exclusive/,
  );
});

test("handoff includes owned generation evidence and rejects stale references or animation", () => {
  const source = document(),
    binding = createSpriteNormalAssetBinding(animatedOptions());
  const { patch, evidence } = createSceneSpriteNormalPatch(source, binding, {
    instanceId: "hero",
    assets: assets(binding),
  });
  const state = createScenePlacementViewer({
    document: source,
    viewport: { cssWidth: 320, cssHeight: 240 },
  }).state();
  const handoff = createScenePlacementAgentHandoff({
    document: source,
    state,
    patch,
    normalBindings: [evidence],
  });
  deepEqual(handoff.normalBindings, [evidence]);
  binding.generation.settings.normalStrength = 7;
  equal(
    handoff.normalBindings![0].binding.generation.settings.normalStrength,
    1.5,
  );
  const changed = mergeScenePlacementPatch(source, patch).document;
  changed.spatial!.billboards.hero.normalTexture = "another";
  throws(
    () =>
      createScenePlacementAgentHandoff({
        document: changed,
        state,
        normalBindings: [evidence],
      }),
    /references differ/,
  );
});

test("viewer normal reference edits export spatial v4 and retain Undo/Redo", () => {
  const source = document(),
    viewer = createScenePlacementViewer({
      document: source,
      viewport: { cssWidth: 320, cssHeight: 240 },
    });
  const state = viewer.updateSpatial([
    {
      kind: "setBillboardNormalTexture",
      id: "hero",
      changes: { normalTexture: "hero.normal" },
    },
  ]);
  equal(state.draftPatch!.spatial!.version, 4);
  equal(
    mergeScenePlacementPatch(source, state.draftPatch!).document.spatial!
      .billboards.hero.normalTexture,
    "hero.normal",
  );
  equal(viewer.undo().draftPatch, undefined);
  equal(viewer.redo().spatial!.billboards.hero.normalTexture, "hero.normal");
  const detached = viewer.updateSpatial([
    {
      kind: "setBillboardNormalTexture",
      id: "hero",
      changes: { normalTexture: null },
    },
  ]);
  equal(
    mergeScenePlacementPatch(source, detached.draftPatch!).document.spatial!
      .billboards.hero.normalTextureId,
    undefined,
  );
});

test("cold normal reference resolution checks every lookup without mutating authoring", () => {
  const source = document().spatial!;
  source.billboards = { hero: { normalTexture: "hero.normal" } };
  for (const id of [0, 7, 16777214]) {
    const next = resolveSpatialNormalTextures(source, () => id);
    equal(next.billboards.hero.normalTextureId, id);
    equal(next.billboards.hero.normalTexture, undefined);
  }
  equal(source.billboards.hero.normalTexture, "hero.normal");
  for (const id of [-1, NaN, 1.5, 16777215])
    throws(() => resolveSpatialNormalTextures(source, () => id));
  throws(
    () =>
      resolveSpatialNormalTextures(source, () => {
        throw new Error("missing");
      }),
    /not registered/,
  );
});

test("native authoring resolves names using the provided registry and missing normals preserve the live scene", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, options) =>
    String(input).startsWith("file:")
      ? new Response(
          Uint8Array.from(await readFile(new URL(String(input)))).buffer,
          { headers: { "Content-Type": "application/wasm" } },
        )
      : originalFetch(input, options)) as typeof fetch;
  const engine = await createEngine();
  try {
    const binding = createSpriteNormalAssetBinding(animatedOptions()),
      source = document();
    const patched = mergeScenePlacementPatch(
      source,
      createSceneSpriteNormalPatch(source, binding, {
        instanceId: "hero",
        assets: assets(binding),
      }).patch,
    ).document;
    const result = applyDataSceneAuthoringDocument(engine, patched, {
      textureId: (name) => (name === "hero.normal" ? 17 : 3),
    });
    equal(
      result.document.spatial!.billboards.hero.normalTexture,
      "hero.normal",
    );
    ok(engine.dataSceneSpriteAnimationState(result.entityHandles.hero));
    throws(
      () =>
        applyDataSceneAuthoringDocument(engine, patched, {
          textureId: (name) => {
            if (name === "hero.normal") throw new Error("missing");
            return 4;
          },
        }),
      /not registered/,
    );
    equal(engine.entityCount(), 1);
    ok(engine.dataSceneSpriteAnimationState(result.entityHandles.hero));
    const again = applyDataSceneAuthoringDocument(
      engine,
      JSON.parse(JSON.stringify(patched)),
      { textureId: (name) => (name === "hero.normal" ? 45 : 29) },
    );
    deepEqual(again.document, result.document);
    ok(engine.dataSceneSpriteAnimationState(again.entityHandles.hero));
  } finally {
    engine.destroy();
    globalThis.fetch = originalFetch;
  }
});
