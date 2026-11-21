import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  applyDataSceneAuthoringDocument, createDataSceneRuntimeTarget, createSceneInstanceHandleRegistry, resolveSceneAuthoringDocument,
  type DataSceneComponentsSpec, type SceneAuthoringDocumentSpec,
} from "../src/authoring.js";
import { createEngine, initializeFerrumWasm, UNIFIED_PHYSICS_STATE_LAYOUT as B,
  UNIFIED_PHYSICS_CHARACTER_LAYOUT as C, UNIFIED_PHYSICS_JOINT_LAYOUT as J } from "../src/core.js";
import { attachDataSceneRuntimeEngineAdapter, type DataSceneRuntimeSpawnRequest } from "../src/dataSceneRuntimeTarget.js";
import type { CompiledDataScenePhysicsBody } from "../src/dataScenePhysicsPreflight.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import type { ResolvedSceneCompositionInstance, SceneCompositionJsonValue } from "../src/sceneComposition.js";
import { attachMemoryDataSceneVariableRuntime } from "./dataSceneVariableRuntimeTestAdapter.js";
import type { FlatLightingAsset } from "../src/flatLit.js";

const solid: DataSceneComponentsSpec = {
  visual: { kind: "sprite", texture: 11, width: 2, height: 3 }, collider: "none", layer: "enemy",
  body: { kind: "dynamic", gravityScale: 0, linearDamping: 0.2, angularDamping: 0.3,
    renderOffset: [0.25, 0.5, 0], linearVelocity: [1, 2, 0],
    collider: { shape: { type: "sphere", radius: 0.5 }, density: 3, friction: 0.2, restitution: 0.4,
      mask: 15, surfaceVelocity: [0.1, 0, 0], contactCorrection: { velocityRate: 0.1, maxVelocity: 10,
        positionRate: 0.2, positionSlop: 0.001, velocitySlop: 0.01, splitImpulse: false } } },
};
const controller: DataSceneComponentsSpec = {
  visual: { kind: "sprite", texture: 11, width: 1, height: 2 }, collider: "none", layer: "player",
  body: { kind: "kinematic-position", elevation: 2, collider: { shape: { type: "capsule", halfHeight: 0.5, radius: 0.25 } },
    character: { stepHeight: 0.12, snapDistance: 0.08 } },
};
function document(space: "planar-xy" | "spatial" = "spatial", ids = ["a", "b"]): SceneAuthoringDocumentSpec {
  return { format: "ferrum2d.consumer.scene-authoring", version: 1,
    physics: { space, gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: 0.01 },
    sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances:
      ids.map((id, i) => ({ id, prefab: "object", x: i * 3, y: 4, scale: i + 1,
        props: { components: { template: "solid" } } })),
    } } }, behaviorRecipes: { entities: {} } };
}
async function engine() {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
  return createEngine();
}
function facade() {
  const requests: DataSceneRuntimeSpawnRequest[] = [], preflight: CompiledDataScenePhysicsBody[][] = [], bindings: unknown[] = [], controllers: unknown[] = [];
  let activations = 0;
  const e = attachMemoryDataSceneVariableRuntime(attachDataSceneRuntimeEngineAdapter({
    configureUnifiedPhysics() {}, bindUnifiedPhysicsBody(handle: unknown, options: unknown) { bindings.push({handle, options}); },
    configureUnifiedPhysicsCharacter() {},
    configureDataSceneKinematicController(handle: unknown, options: unknown) { controllers.push({handle, options}); return true; },
  } as unknown as FerrumEngine, {
    textureId: () => 11, useDataScene() { activations++; },
    preflightPhysics(_world, bodies) { preflight.push([...bodies]); },
    spawnDataSceneEntity(request) { requests.push(request); return { entityId: requests.length, entityGeneration: 1 }; },
  }));
  return { e, requests, preflight, bindings, controllers, activations: () => activations };
}

test("native template bodies compile exactly like inline bodies without changing authored JSON", () => {
  const source = document(), before = structuredClone(source), catalog = { solid: structuredClone(solid) }, catalogBefore = structuredClone(catalog);
  let resolutions = 0;
  const templated = facade();
  const applied = applyDataSceneAuthoringDocument(templated.e, source, {
    componentTemplates: name => { resolutions++; return catalog[name as keyof typeof catalog]; },
  });
  const inline = structuredClone(source);
  for (const instance of inline.sceneComposition.fragments!.main.instances!) {
    instance.props = { ...instance.props, components: structuredClone(solid) as unknown as SceneCompositionJsonValue };
  }
  const expanded = facade();
  applyDataSceneAuthoringDocument(expanded.e, inline);
  deepEqual(templated.preflight, expanded.preflight);
  deepEqual(templated.bindings, expanded.bindings);
  deepEqual(templated.requests, expanded.requests);
  equal(templated.preflight[0].length, 2);
  equal(templated.preflight[0][0].options.collider.category, 2);
  equal(templated.preflight[0][1].options.collider.friction, 0.2);
  deepEqual(templated.preflight[0][1].options.renderOffset, [0.5, 1, 0]);
  equal(resolutions, 1);
  deepEqual(applied.document.sceneComposition.fragments.main.instances[0].props.components, { template: "solid" });
  deepEqual(source, before); deepEqual(catalog, catalogBefore);
});

test("native template references admit real bodies and named joints in both world modes", async () => {
  const e = await engine();
  try {
    for (const space of ["planar-xy", "spatial"] as const) {
      const doc = document(space);
      doc.physics!.joints = Object.fromEntries([["__proto__", { bodyA: "a", bodyB: "b", kind: { type: "distance", length: 3 } }]]);
      const result = applyDataSceneAuthoringDocument(e, doc, { componentTemplates: { solid } });
      equal(e.entityCount(), 2);
      for (const id of ["a", "b"]) {
        const h = result.entityHandles[id], state = e.queryUnifiedPhysicsBodyStates(new Uint32Array([h.entityId, h.entityGeneration]));
        equal(state.count, 1);
        equal(state.floats[B.position + 2], space === "spatial" ? -4 : 0);
      }
      const joint = result.physicsJoints!["__proto__"];
      const state = e.queryUnifiedPhysicsJointStates(new Uint32Array([joint.slot, joint.generation]));
      equal(state.count, 1); equal(state.words[J.entityA], result.entityHandles.a.entityId); equal(state.words[J.entityB], result.entityHandles.b.entityId);
    }
  } finally { e.destroy(); }
});

test("native template controllers inherit spatial actor limits and remain live in actual Wasm", async () => {
  const e = await engine();
  try {
    const doc = document("spatial", ["actor"]);
    doc.spatial = {
      camera: { projection: "orthographic", position: { x: 0, y: -10, elevation: 10 }, target: { x: 0, y: 0, elevation: 0 }, height: 20 },
      terrain: [{id:"floor",x:0,y:0,width:20,depth:20,elevation:0}], billboards: { actor: {} }, actor: { instanceId: "actor", speed: 2 },
    };
    const result = applyDataSceneAuthoringDocument(e, doc, { componentTemplates: { solid: controller } });
    equal(result.document.spatial!.actor!.maxStepHeight, 0.12);
    equal(result.document.spatial!.actor!.maxDropHeight, 0.08);
    const actor = result.entityHandles.actor, ids = new Uint32Array([actor.entityId, actor.entityGeneration]);
    equal(e.queryUnifiedPhysicsCharacterStates(ids).count, 1);
    equal(e.queryUnifiedPhysicsCharacterStates(ids).words[C.flags] & C.groundedFlag, 0);
    e.setUnifiedPhysicsCharacterInputs(ids, new Float32Array([1, 0, 0, 0]));
    for (let i = 0; i < 10; i++) e.stepRigidBodies(Math.fround(0.01));
    ok(e.queryUnifiedPhysicsBodyStates(ids).floats[B.position] > 0.05);
  } finally { e.destroy(); }
});

test("template visual materials retain map references and bind alongside the same native body", async () => {
  const e = await engine();
  try {
    const doc = document("planar-xy", ["a"]);
    doc.lighting = { profile: "lit", ambientIrradiance: [1, 1, 1] };
    const material: DataSceneComponentsSpec = { ...solid, visual: { kind: "sprite", texture: "base", width: 2, height: 3,
      normalTexture: "normal", lighting: {mode:"opaque"},
      nineSlice: {sourceWidth:16,sourceHeight:12,left:2,right:4,top:3,bottom:1},
      surface: { emission: [4, 2, 1], specular: 0, roughness: 0, emissionTexture: "glow", specularTexture: "specular", roughnessTexture: "roughness" },
    } };
    const assets: FlatLightingAsset[] = [], ids: Record<string, number> = {base:11,normal:12,glow:13,specular:14,roughness:15};
    const result = applyDataSceneAuthoringDocument(e, doc, {
      componentTemplates: {solid:material}, textureId: name => ids[name],
      flatLightingPreparer: {prepareFlatLighting(_lighting, prepared) { assets.push(...prepared); }},
    });
    equal(assets.length, 1);
    deepEqual(assets[0].surface, {emission:[4,2,1],specular:0,roughness:0,emissionTextureId:13,specularTextureId:14,roughnessTextureId:15});
    equal(assets[0].normalTextureId, 12);
    const h = result.entityHandles.a;
    equal(e.queryUnifiedPhysicsBodyStates(new Uint32Array([h.entityId,h.entityGeneration])).count, 1);
    equal(e.entityCount(), 1);
    deepEqual(doc.sceneComposition.fragments!.main.instances![0].props!.components, {template:"solid"});
    equal((material.visual as {surface:{emissionTexture:string}}).surface.emissionTexture, "glow");
  } finally { e.destroy(); }
});

test("template spatial model validation uses native body ownership and authored elevation", () => {
  const doc = document("spatial", ["a"]);
  doc.spatial = {
    camera: { projection: "orthographic", position: {x:0,y:-10,elevation:10}, target: {x:0,y:0,elevation:0}, height:20 },
    terrain: [], billboards: {}, models: {a:{asset:"mesh",contentId:"a".repeat(64)}},
  };
  const elevated: DataSceneComponentsSpec = {...solid,body:{kind:"dynamic",elevation:5,collider:{shape:{type:"sphere",radius:0.5}}}};
  const resolved = resolveSceneAuthoringDocument(doc, {componentTemplates:{solid:elevated}});
  equal(resolved.spatial!.models!.a.asset,"mesh");
  doc.physics!.space = "planar-xy";
  throws(() => resolveSceneAuthoringDocument(doc, {componentTemplates:{solid:elevated}}), /spatial.models/);
});

test("legacy planar template controller settings reach the same spawned handle with normalized defaults", () => {
  const doc = document("planar-xy", ["actor"]), f = facade();
  const legacy: DataSceneComponentsSpec = { ...solid, collider: { type: "circle", radius: 0.5, isTrigger: false },
    body: { type: "kinematic", kinematicController: { maxStepHeight: 0.1, solidMaskBits: 0, allowLedgeDrop: true } } };
  const result = applyDataSceneAuthoringDocument(f.e, doc, { componentTemplates: { solid: legacy } });
  equal(f.preflight[0].length, 0);
  deepEqual(f.controllers, [{ handle: result.entityHandles.actor, options: { maxStepHeight: Math.fround(0.1), solidMaskBits: 0,
    maxIterations: 4, maxDropHeight: 0, allowLedgeDrop: true } }]);
  deepEqual(f.requests[0].body, { type: "kinematic", kinematicController: (f.controllers[0] as {options: unknown}).options });
  delete doc.physics;
  const invalid = facade();
  throws(() => applyDataSceneAuthoringDocument(invalid.e, doc, { componentTemplates: { solid: legacy } }), /planar-xy/);
  equal(invalid.activations(), 0);
});

test("template shape/controller standalone spawn still requires a full authoring document", () => {
  const instance: ResolvedSceneCompositionInstance = { id: "a", sourceId: "a", prefab: "object", x: 0, y: 0, scale: 1,
    rotationRadians: 0, layer: 0, props: { components: { template: "solid" } } };
  for (const spec of [solid, { ...solid, collider: { type: "circle", radius: 0.5, isTrigger: false }, body: { type: "kinematic", kinematicController: {} } } as DataSceneComponentsSpec]) {
    const f = facade(), target = createDataSceneRuntimeTarget(f.e, { componentTemplates: { solid: spec } });
    throws(() => target.spawnSceneInstance(instance), /full planar-xy|applyDataSceneAuthoringDocument/);
    equal(f.activations(), 0); equal(f.requests.length, 0);
  }
});

test("missing, nested, invalid or mixed native template data rejects before any activation", () => {
  const doc = document();
  for (const catalog of [{}, { solid: { template: "nested" } },
    { solid: { ...solid, body: { ...solid.body, collider: { shape: { type: "sphere", radius: 1, typo: true } } } } },
    { solid: { ...solid, collider: { type: "circle", radius: 1 } } },
    { solid: { ...solid, body: { ...solid.body, typo: true } } },
  ]) {
    const f = facade();
    throws(() => applyDataSceneAuthoringDocument(f.e, doc, { componentTemplates: catalog as never,
      validateComponents: false, validateBindings: false }), /template|body|collider|physics/i);
    equal(f.activations(), 0); equal(f.requests.length, 0); equal(f.bindings.length, 0);
  }
  const f = facade();
  throws(() => applyDataSceneAuthoringDocument(f.e, doc, { allowComponentTemplates: true }), /componentTemplates/);
  equal(f.activations(), 0);
  const unresolved = structuredClone(doc); delete unresolved.physics;
  equal(resolveSceneAuthoringDocument(unresolved, {allowComponentTemplates:true,validateComponents:true}).format, doc.format);
});

test("template native geometry and aggregate rejection preserve canonical live identities", async () => {
  const e = await engine();
  try {
    const doc = document("spatial", ["a"]), previous = applyDataSceneAuthoringDocument(e, doc, { componentTemplates: { solid } });
    const h = previous.entityHandles.a, ids = new Uint32Array([h.entityId, h.entityGeneration]);
    const before = [...e.queryUnifiedPhysicsBodyStates(ids).floats];
    const tooMany = document(); tooMany.physics!.maxBodies = 1;
    const invalidMesh: DataSceneComponentsSpec = { ...solid, body: { kind: "dynamic", collider: {
      shape: { type: "triangleMesh", vertices: [0, 0, 0, 1, 0, 0, 0, 0, 1], triangles: [0, 1, 2] },
    } } };
    throws(() => applyDataSceneAuthoringDocument(e, doc, { componentTemplates: { solid: invalidMesh } }), /body|physics/i);
    throws(() => applyDataSceneAuthoringDocument(e, tooMany, { componentTemplates: { solid } }), /capacity/i);
    equal(e.entityCount(), 1); deepEqual([...e.queryUnifiedPhysicsBodyStates(ids).floats], before);
  } finally { e.destroy(); }
});

test("late template controller failure rolls back canonical native state and handle registry", async () => {
  const e = await engine(), registry = createSceneInstanceHandleRegistry();
  const configure = e.configureUnifiedPhysicsCharacter;
  try {
    const doc = document("spatial", ["a"]);
    const previous = applyDataSceneAuthoringDocument(e, doc, {componentTemplates:{solid},instanceHandleRegistry:registry});
    const h = previous.entityHandles.a, ids = new Uint32Array([h.entityId,h.entityGeneration]);
    const before = [...e.queryUnifiedPhysicsBodyStates(ids).floats], entries = registry.entries();
    e.configureUnifiedPhysicsCharacter = () => { throw new Error("late controller rejection"); };
    throws(() => applyDataSceneAuthoringDocument(e, doc, {componentTemplates:{solid:controller},instanceHandleRegistry:registry}), /late controller rejection/);
    equal(e.entityCount(), 1);
    deepEqual([...e.queryUnifiedPhysicsBodyStates(ids).floats], before);
    deepEqual(registry.entries(), entries);
    throws(() => e.queryUnifiedPhysicsCharacterStates(ids), /no character controller/);
  } finally { e.configureUnifiedPhysicsCharacter = configure; e.destroy(); }
});

test("early authored controller setup retains the native aggregate capacity reason and old world", async () => {
  const e = await engine(), registry = createSceneInstanceHandleRegistry();
  try {
    const previous = applyDataSceneAuthoringDocument(e, document("planar-xy", ["a"]), {
      componentTemplates: { solid }, instanceHandleRegistry: registry,
    });
    const h = previous.entityHandles.a, ids = new Uint32Array([h.entityId, h.entityGeneration]);
    e.configureAutoRigidBodyStep(false); e.stepRigidBodies(Math.fround(0.01));
    const before = [...e.queryUnifiedPhysicsBodyStates(ids).floats], time = e.time(), entries = registry.entries();
    const candidate = document("planar-xy", ["native", "legacy"]);
    candidate.physics!.maxBodies = 1;
    candidate.sceneComposition.fragments!.main.instances![1].props = { components: { template: "legacy" } };
    const legacy: DataSceneComponentsSpec = { visual: { kind: "sprite", texture: 11, width: 1, height: 2 },
      collider: { type: "circle", radius: 0.25, isTrigger: false }, layer: "enemy",
      body: { type: "kinematic", kinematicController: {} } };
    throws(() => applyDataSceneAuthoringDocument(e, candidate, {
      componentTemplates: { solid, legacy }, instanceHandleRegistry: registry,
    }), /physics capacity exceeded/);
    deepEqual([...e.queryUnifiedPhysicsBodyStates(ids).floats], before);
    equal(e.time(), time); equal(e.entityCount(), 1); deepEqual(registry.entries(), entries);
  } finally { e.destroy(); }
});
