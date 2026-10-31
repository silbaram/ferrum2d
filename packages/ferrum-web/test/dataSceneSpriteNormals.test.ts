import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  resolveDataSceneComponentsSpec,
  type DataSceneComponentsSpec,
  type DataSceneTextureRefSpec,
} from "../src/dataSceneComponents.js";
import {
  applyDataSceneAuthoringDocument,
  attachDataSceneRuntimeEngineAdapter,
  createDataSceneRuntimeTarget,
  type DataSceneRuntimeEngineAdapter,
  type DataSceneRuntimeSpawnRequest,
} from "../src/dataSceneRuntimeTarget.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import type { SceneAuthoringDocumentSpec } from "../src/sceneAuthoringDocument.js";
import type { ResolvedSceneCompositionInstance } from "../src/sceneComposition.js";
import { attachMemoryDataSceneVariableRuntime } from "./dataSceneVariableRuntimeTestAdapter.js";

type NormalUpdate = Parameters<FerrumEngine["configureSpriteNormalMaterials"]>[0][number];

function sprite(normalTexture?: DataSceneTextureRefSpec): DataSceneComponentsSpec {
  return {
    sprite: { texture: "color", width: 16, height: 24, frame: { u0: 0.25, v0: 0, u1: 0.5, v1: 1 },
      ...(normalTexture === undefined ? {} : { normalTexture }) },
    collider: "none",
    layer: "wall",
  };
}

function visual(normalTexture: DataSceneTextureRefSpec): DataSceneComponentsSpec {
  return {
    visual: { kind: "sprite", asset: "color", normalTexture, width: 16, height: 24,
      frame: { u0: 0.25, v0: 0, u1: 0.5, v1: 1 }, originX: 0, originY: 1 },
    collider: "none",
    layer: "wall",
  };
}

function componentProps(components: DataSceneComponentsSpec): ResolvedSceneCompositionInstance["props"] {
  // Composition props cross the consumer JSON boundary rather than retaining typed spec objects.
  return JSON.parse(JSON.stringify({ components }));
}

function document(components: Readonly<Record<string, DataSceneComponentsSpec>>): SceneAuthoringDocumentSpec {
  return {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    sceneComposition: {
      initialFragment: "main",
      prefabs: Object.fromEntries(Object.entries(components).map(([id, value]) => [id, { props: componentProps(value) }])),
      fragments: { main: { instances: Object.keys(components).map((id, index) => ({ id, prefab: id, x: index * 32, y: 12 })) } },
    },
    behaviorRecipes: { entities: {} },
  };
}

function instance(components: DataSceneComponentsSpec, id = "single"): ResolvedSceneCompositionInstance {
  return { id, sourceId: id, prefab: "sprite", x: 12, y: 24, rotationRadians: 0.5,
    scale: 2, layer: 3, props: componentProps(components) };
}

function runtime(options: { supported?: boolean; accept?: boolean; textureId?: (name: string) => number } = {}) {
  const events: string[] = [];
  const requests: DataSceneRuntimeSpawnRequest[] = [];
  const batches: (readonly NormalUpdate[])[] = [];
  const behaviorCounts: number[] = [];
  const facade: Pick<FerrumEngine, "applyGameplayBehaviorCommands" | "configureSpriteNormalMaterials"> = {
    applyGameplayBehaviorCommands: commands => {
      events.push("behaviors");
      behaviorCounts.push(commands.length);
      return { commands, results: commands.map(() => true) };
    },
    configureSpriteNormalMaterials: updates => {
      events.push("normals");
      batches.push(updates);
      return options.accept !== false;
    },
  };
  const adapter: DataSceneRuntimeEngineAdapter = {
    supportsSpriteNormalMaterials: () => options.supported !== false,
    useDataScene: () => { events.push("activate"); },
    textureId: name => {
      events.push("texture:" + name);
      if (options.textureId) return options.textureId(name);
      if (name === "color") return 3;
      if (name === "normal") return 9;
      throw Error("Texture not loaded: " + name);
    },
    spawnDataSceneEntity: request => {
      requests.push(request);
      events.push("spawn:" + requests.length);
      return { entityId: 100 + requests.length, entityGeneration: 10 + requests.length };
    },
  };
  // Only the two facade methods and registered test adapters participate in these contracts.
  const engine = attachMemoryDataSceneVariableRuntime(attachDataSceneRuntimeEngineAdapter(facade as FerrumEngine, adapter));
  return { engine, adapter, events, requests, batches, behaviorCounts };
}

test("sprite and visual normal references resolve without changing frame, dimensions or color texture", () => {
  for (const normalTexture of ["normal", 0, 12]) {
    for (const components of [sprite(normalTexture), visual(normalTexture)]) {
      const resolved = resolveDataSceneComponentsSpec(components);
      if (resolved.mode !== "inline" || resolved.visual.kind !== "sprite") throw Error("expected sprite visual");
      const expected = typeof normalTexture === "string"
        ? { kind: "asset", value: normalTexture, name: normalTexture }
        : { kind: "id", value: normalTexture, id: normalTexture };
      deepEqual(resolved.sprite.normalTexture, expected);
      deepEqual(resolved.visual.normalTexture, expected);
      deepEqual(resolved.sprite.texture, { kind: "asset", value: "color", name: "color" });
      deepEqual(resolved.sprite.frame, { u0: 0.25, v0: 0, u1: 0.5, v1: 1 });
      equal(resolved.sprite.width, 16);
      equal(resolved.sprite.height, 24);
    }
  }
  const plain = resolveDataSceneComponentsSpec(sprite());
  if (plain.mode !== "inline") throw Error("expected inline sprite");
  equal("normalTexture" in plain.sprite, false);
});

test("invalid authored normal references carry the component path instead of being discarded", () => {
  for (const normalTexture of [null, "", -1, 0.5, NaN, Infinity, 0x100000000, {}]) {
    for (const key of ["sprite", "visual"]) {
      const descriptor = { texture: "color", normalTexture, width: 16, height: 24,
        ...(key === "visual" ? { kind: "sprite" } : {}) };
      throws(() => resolveDataSceneComponentsSpec({ [key]: descriptor, collider: "none", layer: "wall" }, { path: "normalScene.components" }),
        /normalScene\.components\.(sprite|visual)\.normalTexture/);
    }
  }
});

test("normal capability and facade preflight reject before activating or spawning a scene", () => {
  for (const missing of ["unsupported", "adapter", "facade"]) {
    const fixture = runtime({ supported: missing !== "unsupported" });
    if (missing === "adapter") delete fixture.adapter.supportsSpriteNormalMaterials;
    if (missing === "facade") Reflect.deleteProperty(fixture.engine, "configureSpriteNormalMaterials");
    throws(() => applyDataSceneAuthoringDocument(fixture.engine, document({ plain: sprite(), mapped: sprite("normal") }), { path: "normalScene" }),
      /normalScene\.components\.normalTexture.*native v1 support/);
    equal(fixture.requests.length, 0);
    equal(fixture.events.includes("activate"), false);
    equal(fixture.batches.length, 0);
  }
});

test("every named normal texture is resolved before destructive scene activation", () => {
  const fixture = runtime();
  throws(() => applyDataSceneAuthoringDocument(fixture.engine, document({ first: sprite("normal"), late: visual("missing-normal") })),
    /Texture not loaded: missing-normal/);
  deepEqual(fixture.events, ["texture:normal", "texture:missing-normal"]);
  equal(fixture.requests.length, 0);
  equal(fixture.batches.length, 0);
});

test("oversized normal batches reject before replacing the previous scene", () => {
  const fixture = runtime();
  const source = document({ mapped: sprite(9) });
  source.sceneComposition.fragments = { main: { instances: Array.from({ length: 65_537 }, (_, index) => ({
    id: `mapped_${index}`, prefab: "mapped", x: 0, y: 0,
  })) } };
  throws(() => applyDataSceneAuthoringDocument(fixture.engine, source, { path: "largeScene" }),
    /largeScene\.components\.normalTexture.*at most 65536 sprite normal materials/);
  deepEqual(fixture.events, []);
  equal(fixture.requests.length, 0);
  equal(fixture.batches.length, 0);
});

test("unregistered normal IDs and the NONE sentinel fail before activation", () => {
  for (const normalId of [-1, 0.5, NaN, Infinity, 16_777_215, 16_777_216, 0xffffffff]) {
    const fixture = runtime({ textureId: name => name === "normal" ? normalId : 3 });
    throws(() => applyDataSceneAuthoringDocument(fixture.engine, document({ mapped: sprite("normal") })),
      /normalTexture.*registered texture ID below 16777215/);
    equal(fixture.events.includes("activate"), false);
    equal(fixture.requests.length, 0);
    equal(fixture.batches.length, 0);
  }
  const numeric = runtime();
  throws(() => applyDataSceneAuthoringDocument(numeric.engine, document({ mapped: sprite(16_777_215) })), /normalTexture/);
  equal(numeric.events.length, 0);
});

test("full authoring applies one normal batch after all spawns and behavior configuration", () => {
  const fixture = runtime();
  const source = document({ mapped: sprite("normal"), plain: sprite(), numeric: visual(0) });
  source.behaviorRecipes = { entities: { mapped: { recipes: [{ kind: "health", max: 20 }] } } };
  source.sceneComposition.prefabs = { ...source.sceneComposition.prefabs,
    mapped: { props: { ...componentProps(sprite("normal")), behaviorRecipes: "mapped" } } };
  const before = JSON.stringify(source);
  const result = applyDataSceneAuthoringDocument(fixture.engine, source);
  deepEqual(fixture.events.filter(event => !event.startsWith("texture:")),
    ["activate", "spawn:1", "spawn:2", "spawn:3", "behaviors", "normals"]);
  ok(fixture.events.indexOf("texture:normal") < fixture.events.indexOf("activate"));
  equal(fixture.requests.length, 3);
  for (const request of fixture.requests)
    equal("normalTextureId" in request, false, "full authoring defers per-entity normals to its atomic batch");
  deepEqual(fixture.batches, [[
    { entity: result.entityHandles.mapped, normalTextureId: 9 },
    { entity: result.entityHandles.numeric, normalTextureId: 0 },
  ]]);
  deepEqual(fixture.behaviorCounts, [1], "the ordering covers an actual authored behavior command");
  equal(JSON.stringify(source), before);
  equal(result.spawnResults.length, 3);
});

test("catalog and resolver templates retain normal materials in the same post-spawn batch", () => {
  for (const componentTemplates of [{ mapped: visual("normal") }, (name: string) => name === "mapped" ? sprite("normal") : undefined]) {
    const fixture = runtime();
    const result = applyDataSceneAuthoringDocument(fixture.engine, document({ templated: { template: "mapped" } }), { componentTemplates });
    deepEqual(fixture.batches, [[{ entity: result.entityHandles.templated, normalTextureId: 9 }]]);
    equal("normalTextureId" in fixture.requests[0], false);
    ok(fixture.events.indexOf("texture:normal") < fixture.events.indexOf("activate"));
  }
});

test("native normal batch rejection surfaces a diagnostic instead of silently accepting the scene", () => {
  const fixture = runtime({ accept: false });
  throws(() => applyDataSceneAuthoringDocument(fixture.engine, document({ first: sprite("normal"), second: visual(0) }), { path: "rejectedScene" }),
    /rejectedScene\.components\.normalTexture.*runtime rejected sprite normal material batch/);
  equal(fixture.requests.length, 2);
  equal(fixture.batches.length, 1);
  equal(fixture.batches[0].length, 2);
  equal(fixture.events[fixture.events.length - 1], "normals");
});

test("color-only authoring remains compatible with runtimes without any normal capability", () => {
  const fixture = runtime();
  delete fixture.adapter.supportsSpriteNormalMaterials;
  Reflect.deleteProperty(fixture.engine, "configureSpriteNormalMaterials");
  const result = applyDataSceneAuthoringDocument(fixture.engine, document({ plain: sprite() }));
  equal(result.spawnResults.length, 1);
  equal(fixture.requests[0].textureId, 3);
  equal("normalTextureId" in fixture.requests[0], false);
  equal(fixture.batches.length, 0);
});

test("standalone targets pass resolved normals to each spawn and activate only once", () => {
  const fixture = runtime();
  const target = createDataSceneRuntimeTarget(fixture.engine, { componentTemplates: { mapped: sprite("normal") } });
  const first = target.spawnSceneInstance(instance(sprite("normal"), "named"));
  target.spawnSceneInstance(instance(visual(0), "numeric"));
  target.spawnSceneInstance(instance({ template: "mapped" }, "templated"));
  deepEqual(first, { entityId: 101, entityGeneration: 11 });
  deepEqual(fixture.requests.map(request => request.normalTextureId), [9, 0, 9]);
  equal(fixture.events.filter(event => event === "activate").length, 1);
  equal(fixture.batches.length, 0, "the standalone adapter owns the per-spawn normal application");
  deepEqual([fixture.requests[0].spriteWidth, fixture.requests[0].spriteHeight], [32, 48]);
  deepEqual([fixture.requests[0].frameU0, fixture.requests[0].frameV0, fixture.requests[0].frameU1, fixture.requests[0].frameV1], [0.25, 0, 0.5, 1]);
});

test("standalone normal spawns respect activation opt-out and reject unsupported runtimes before mutation", () => {
  const supported = runtime();
  createDataSceneRuntimeTarget(supported.engine, { activateDataScene: false }).spawnSceneInstance(instance(visual("normal")));
  equal(supported.requests[0].normalTextureId, 9);
  equal(supported.events.includes("activate"), false);
  const unsupported = runtime({ supported: false });
  throws(() => createDataSceneRuntimeTarget(unsupported.engine, { path: "singleNormal" }).spawnSceneInstance(instance(sprite("normal"))),
    /singleNormal\.instances\.single.*native v1 support/);
  equal(unsupported.requests.length, 0);
  equal(unsupported.events.includes("activate"), false);
});
