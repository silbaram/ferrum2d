import type { SceneCompositionJsonValue } from "../src/sceneComposition.js";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createEngine, captureGameStateSnapshot, initializeFerrumWasm, createUnifiedPhysicsQueryBatch, UNIFIED_PHYSICS_STATE_LAYOUT as L, UNIFIED_PHYSICS_QUERY_LAYOUT as Q } from "../src/core.js";
import { applyDataSceneAuthoringDocument, createScenePlacementViewer, mergeScenePlacementPatch, resolveSceneAuthoringDocument } from "../src/authoring.js";
import type { SceneAuthoringDocumentSpec } from "../src/authoring.js";
import type { DataScenePhysicsBodySpec } from "../src/dataScenePhysics.js";
function document(space: "planar-xy" | "spatial" = "spatial", body: DataScenePhysicsBodySpec = { collider: { shape: { type: "sphere", radius: 0.5 } } }): SceneAuthoringDocumentSpec {
  return { format: "ferrum2d.consumer.scene-authoring", version: 1,
    physics: { space, gravity: [0,0,0], lengthUnit: 1, stepSeconds: 0.01 },
    sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances: [{
      id: "ball", prefab: "object", x: 2, y: 4, props: { components: {
        visual: { kind: "primitive", shape: "circle", radius: 0.5 }, collider: "none", layer: "wall", body: JSON.parse(JSON.stringify(body)) as SceneCompositionJsonValue,
      } },
    }] } } }, behaviorRecipes: { entities: {} } };
}
async function engine() {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
  return createEngine();
}
test("physics scene authoring binds the same rendered entities and runs planar/XYZ dynamics in actual Wasm", async () => {
  for (const space of ["planar-xy", "spatial"] as const) {
    const e = await engine();
    try {
      const doc = document(space, { elevation: space === "spatial" ? 3 : 0, linearVelocity: [1,2,space === "spatial" ? 3 : 0], collider: { shape: { type: "sphere", radius: 0.5 } } });
      const applied = applyDataSceneAuthoringDocument(e, doc, { textureId: () => 11 });
      const h = applied.entityHandles.ball, handles = new Uint32Array([h.entityId,h.entityGeneration]);
      equal(e.entityCount(),1);
      throws(() => captureGameStateSnapshot(e, {includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:JSON.parse(JSON.stringify(doc)) as SceneCompositionJsonValue}), /native physics snapshots/);
      const before = e.queryUnifiedPhysicsBodyStates(handles);
      deepEqual([...before.floats.slice(L.position,L.position+3)], space === "spatial" ? [2,3,-4] : [2,4,0]);
      e.stepRigidBodies(Math.fround(0.01));
      const after = e.queryUnifiedPhysicsBodyStates(handles);
      ok(Math.abs(after.floats[L.position]-2.01)<1e-5);
      ok(Math.abs(after.floats[L.position+2]-(space === "spatial" ? -3.97 : 0))<1e-5);
    } finally { e.destroy(); }
  }
});
test("native geometry and aggregate body capacity preflight preserve the previous live scene on failure", async () => {
  const e=await engine();
  try {
    const current=applyDataSceneAuthoringDocument(e,document(),{textureId:()=>11});
    const h=current.entityHandles.ball, handles=new Uint32Array([h.entityId,h.entityGeneration]);
    for (const bad of [
      document("spatial",{collider:{shape:{type:"sphere",radius:-1}}}),
      document("planar-xy",{linearVelocity:[0,0,1],collider:{shape:{type:"sphere",radius:1}}}),
      document("spatial",{kind:"dynamic",collider:{shape:{type:"triangleMesh",vertices:[0,0,0,1,0,0,0,0,1],triangles:[0,1,2]}}}),
    ]) {
      throws(()=>applyDataSceneAuthoringDocument(e,bad,{textureId:()=>11}),/physics|body/i);
      equal(e.entityCount(),1); equal(e.queryUnifiedPhysicsBodyStates(handles).count,1);
    }
    const tooMany=document();tooMany.physics!.maxBodies=1;
    const main=tooMany.sceneComposition.fragments!.main; main.instances=[...main.instances!, {...main.instances![0],id:"second"}];
    throws(()=>applyDataSceneAuthoringDocument(e,tooMany,{textureId:()=>11}),/capacity/i);
    equal(e.queryUnifiedPhysicsBodyStates(handles).count,1);
  } finally {e.destroy();}
});
test("placement patches retain physics data and transform actual body position, size and planar rotation",async()=>{
  const e=await engine();
  try {
    const source=document("planar-xy",{kind:"fixed",collider:{shape:{type:"box",halfExtents:[2,0.5,0.5]}}});
    const viewer=createScenePlacementViewer({document:source,viewport:{cssWidth:320,cssHeight:180}});
    viewer.updateInstanceTransform("ball",{x:10,y:20,scale:2,rotationRadians:Math.PI/2});
    const merged=mergeScenePlacementPatch(source,viewer.exportPatch()!).document;
    deepEqual(merged.physics,source.physics);
    const applied=applyDataSceneAuthoringDocument(e,merged,{textureId:()=>11}),h=applied.entityHandles.ball;
    const state=e.queryUnifiedPhysicsBodyStates(new Uint32Array([h.entityId,h.entityGeneration]));
    deepEqual([...state.floats.slice(L.position,L.position+3)],[10,20,0]);
    ok(Math.abs(state.floats[L.rotation+2]-Math.SQRT1_2)<1e-5);
    const inside=createUnifiedPhysicsQueryBatch([{type:"point",point:[10,23,0]}]);
    const outside=createUnifiedPhysicsQueryBatch([{type:"point",point:[13,20,0]}]);
    equal(e.queryUnifiedPhysics(inside).hitCount,1);equal(e.queryUnifiedPhysics(outside).hitCount,0);
    viewer.undo();equal(viewer.exportPatch(),undefined);
  }finally{e.destroy();}
});
test("physics authoring rejects unknown nested fields, missing worlds and mixed collider ownership",()=>{
  const valid=document();
  const resolved=resolveSceneAuthoringDocument(valid,{validateComponents:true});
  deepEqual(resolved.physics,valid.physics);
  const missing=structuredClone(valid);delete missing.physics;
  throws(()=>resolveSceneAuthoringDocument(missing,{validateComponents:true}),/physics/);
  const unknown=structuredClone(valid) as unknown as Record<string,unknown>;
  (unknown.physics as Record<string,unknown>).gravityTypo=1;
  throws(()=>resolveSceneAuthoringDocument(unknown,{validateComponents:true}),/gravityTypo/);
  const bodyUnknown=document("spatial",{collider:{shape:{type:"sphere",radius:1,typo:2} as unknown as {type:"sphere";radius:number}}});
  throws(()=>resolveSceneAuthoringDocument(bodyUnknown,{validateComponents:true}),/typo/);
  const mixed=structuredClone(valid);
  const components=mixed.sceneComposition.fragments!.main.instances![0].props!.components as Record<string,unknown>;
  components.collider={type:"circle",radius:1};
  throws(()=>resolveSceneAuthoringDocument(mixed,{validateComponents:true}),/collider/);
});

test("instance scale changes every authored shape and collider/compound local offsets in native queries", async () => {
  const cases: {shape: import("../src/unifiedPhysicsAuthoring.js").UnifiedPhysicsShape; top: number}[] = [
    {shape: {type: "box", halfExtents: [1,1,1]}, top: 1},
    {shape: {type: "sphere", radius: 1}, top: 1},
    {shape: {type: "capsule", halfHeight: 1, radius: 0.5}, top: 1.5},
    {shape: {type: "convexHull", points: [[-1,-1,-1],[1,-1,-1],[-1,1,-1],[1,1,-1],[-1,-1,1],[1,-1,1],[-1,1,1],[1,1,1]]}, top: 1},
    {shape: {type: "triangleMesh", vertices: [-2,1,-2,2,1,-2,0,1,2], triangles: [0,2,1]}, top: 1},
    {shape: {type: "heightfield", rows: 2, columns: 2, heights: [1,1,1,1], size: [4,4]}, top: 1},
    {shape: {type: "compound", parts: [{pose: {position: [0,2,0]}, shape: {type: "sphere", radius: 0.5}}]}, top: 2.5},
  ];
  const e=await engine();
  try {
    for (const {shape,top} of cases) for (const scale of [1,2]) {
      const doc=document("spatial",{kind:"fixed",collider:{shape,pose:{position:[0,0.25,0]}}});
      doc.sceneComposition.fragments!.main.instances![0].scale=scale;
      applyDataSceneAuthoringDocument(e,doc,{textureId:()=>11});
      const result=e.queryUnifiedPhysics(createUnifiedPhysicsQueryBatch([{type:"ray",origin:[2,20,-4],direction:[0,-1,0],maxDistance:40}]));
      equal(result.hitCount,1,`${shape.type}, scale ${scale}`);
      ok(Math.abs(result.floats[Q.point+1]-(top+0.25)*scale)<1e-4,`${shape.type} actual scaled surface`);
    }
  } finally {e.destroy();}
});

test("authored native bodies inherit collision categories from layer while explicit categories win", async () => {
  const e = await engine();
  try {
    for (const space of ["planar-xy", "spatial"] as const) {
      for (const layer of ["player", "enemy", "bullet", "wall", "pickup"]) {
        for (const category of [undefined, 0, 32]) {
          const doc = document(space, { kind: "fixed", collider: { shape: { type: "sphere", radius: 0.5 }, ...(category === undefined ? {} : { category }) } });
          const components = doc.sceneComposition.fragments!.main.instances![0].props!.components as Record<string, SceneCompositionJsonValue>;
          components.layer = layer;
          const expected = category ?? (1 << ["player", "enemy", "bullet", "wall", "pickup"].indexOf(layer));
          applyDataSceneAuthoringDocument(e, doc, { textureId: () => 11 });
          const count = (mask: number) => e.queryUnifiedPhysics(createUnifiedPhysicsQueryBatch([
            { type: "point", point: space === "spatial" ? [2, 0, -4] : [2, 4, 0], filter: { mask, respectTargetMask: false } },
          ])).hitCount;
          equal(count(expected), expected === 0 ? 0 : 1, `${space} ${layer} explicit=${category}`);
          equal(count((~expected) >>> 0), 0);
        }
      }
    }
  } finally { e.destroy(); }
});
