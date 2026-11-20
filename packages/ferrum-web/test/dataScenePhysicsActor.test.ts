import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createEngine, initializeFerrumWasm, UNIFIED_PHYSICS_STATE_LAYOUT as B,
  UNIFIED_PHYSICS_CHARACTER_LAYOUT as C } from "../src/core.js";
import { applyDataSceneAuthoringDocument, resolveSceneAuthoringDocument,
  type SceneAuthoringDocumentSpec } from "../src/authoring.js";

async function fixture(): Promise<SceneAuthoringDocumentSpec> {
  return JSON.parse(new TextDecoder().decode(await readFile(new URL("../../../../docs/engine/samples/data-scene-constraints.scene-authoring.json", import.meta.url))));
}
test("native spatial actor resolves world-unit traversal defaults without mutating the document", async () => {
  const doc = await fixture(), original = structuredClone(doc);
  const resolved = resolveSceneAuthoringDocument(doc);
  equal(resolved.spatial!.actor!.maxStepHeight, 0.3);
  equal(resolved.spatial!.actor!.maxDropHeight, 0.2);
  deepEqual(doc, original);
  doc.spatial!.actor!.maxStepHeight = 0;
  doc.spatial!.actor!.maxDropHeight = 0.05;
  equal(resolveSceneAuthoringDocument(doc).spatial!.actor!.maxStepHeight, 0);
  equal(resolveSceneAuthoringDocument(doc).spatial!.actor!.maxDropHeight, 0.05);
});
test("authored native actor supports swept cold movement and path requests through actual Wasm", async () => {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
  const e = await createEngine();
  try {
    const doc = await fixture(), result = applyDataSceneAuthoringDocument(e, doc, { textureId: () => 11 });
    const actor = result.entityHandles.actor, ids = new Uint32Array([actor.entityId, actor.entityGeneration]);
    for (let i = 0; i < 200; i++) e.stepRigidBodies(Math.fround(0.01));
    ok(e.queryUnifiedPhysicsCharacterStates(ids).words[C.flags] & C.groundedFlag);
    ok(e.moveDataSceneSpatialBody(actor, 0.5, 0.25, { maxStepHeight: 0.3, maxDropHeight: 0.2 }));
    const position = [...e.queryUnifiedPhysicsBodyStates(ids).floats.slice(B.position, B.position + 3)];
    ok(Math.abs(position[0] - 0.5) < 0.002 && Math.abs(position[2] + 0.25) < 0.002);
    ok(e.moveDataSceneSpatialActorTo({ x: -1, y: 1, floorId: 0, speed: 2, cellSize: 0.5 }));
    equal(e.dataSceneSpatialMoveStatus(), "moving");
    ok(e.dataSceneSpatialMoveStats()!.edgeProbeCount > 0);
    equal(e.dataSceneSpatialMoveStats()!.lastRequest!.status, "accepted");
    ok(e.cancelDataSceneSpatialMove());
    equal(e.dataSceneSpatialMoveStatus(), "cancelled");
    e.setUnifiedPhysicsCharacterInputs(ids, new Float32Array([0, 0, 0, 0.5]));
    e.stepRigidBodies(Math.fround(0.01));
    const verticalSpeed = e.queryUnifiedPhysicsCharacterStates(ids).floats[C.verticalSpeed];
    ok(verticalSpeed > 0);
    ok(e.moveDataSceneSpatialBody(actor, 0.01, 0, { maxStepHeight: 0.3, maxDropHeight: 0.2 }));
    const rising = e.queryUnifiedPhysicsCharacterStates(ids);
    equal(rising.floats[C.verticalSpeed], verticalSpeed);
    equal(rising.words[C.flags] & C.groundedFlag, 0);
  } finally { e.destroy(); }
});
test("invalid native actor configuration is rejected before replacing the live scene", async () => {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
  const e = await createEngine();
  try {
    const doc = await fixture(), result = applyDataSceneAuthoringDocument(e, doc, { textureId: () => 11 });
    const actor = result.entityHandles.actor, ids = new Uint32Array([actor.entityId, actor.entityGeneration]);
    const before = [...e.queryUnifiedPhysicsBodyStates(ids).floats];
    for (const edit of [
      (d: SceneAuthoringDocumentSpec) => { d.physics!.space = "planar-xy"; },
      (d: SceneAuthoringDocumentSpec) => { d.spatial!.actor!.maxStepHeight = 10001; },
      (d: SceneAuthoringDocumentSpec) => { d.spatial!.actor!.speed = 1e7; },
    ]) {
      const bad = structuredClone(doc); edit(bad);
      throws(() => applyDataSceneAuthoringDocument(e, bad, { textureId: () => 11 }), /spatial.actor/);
      equal(e.entityCount(), 3);
      deepEqual([...e.queryUnifiedPhysicsBodyStates(ids).floats], before);
    }
  } finally { e.destroy(); }
});
