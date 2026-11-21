import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createEngine, initializeFerrumWasm, UNIFIED_PHYSICS_STATE_LAYOUT as L } from "../src/core.js";
import { createDataSceneRuntimeTarget } from "../src/authoring.js";
const collider = { shape: { type: "sphere" as const, radius: 0.5 } };
async function visual(options: Parameters<typeof createEngine>[4] = {}) {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
  const e = await createEngine(undefined, undefined, undefined, undefined, options);
  const target = createDataSceneRuntimeTarget(e, { textureId: () => 11 });
  const h = target.spawnSceneInstance({
    id: "sprite", sourceId: "sprite", prefab: "prop", x: 17, y: 23, rotationRadians: 0, scale: 1, layer: 0,
    props: { components: { sprite: { texture: "sprite", width: 2, height: 3 }, collider: "none", layer: "wall" } },
  });
  return { e, h };
}
test("authored visual entities bind planar and spatial physics without replacement, and survive detachment", async () => {
  for (const space of ["planar-xy", "spatial"] as const) {
    const { e, h } = await visual();
    const handles = new Uint32Array([h.entityId, h.entityGeneration]);
    try {
      const z = space === "spatial" ? 4 : 0;
      e.configureUnifiedPhysics({ space, gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: 0.01 });
      e.bindUnifiedPhysicsBody(h, { collider, pose: { position: [2, 3, z] }, linearVelocity: [1, 2, z] });
      equal(e.entityCount(), 1);
      e.stepRigidBodies(Math.fround(0.01));
      const state = e.queryUnifiedPhysicsBodyStates(handles);
      deepEqual([...state.words.slice(0, 2)], [...handles]);
      ok(Math.abs(state.floats[L.position] - 2.01) < 1e-5);
      if (space === "spatial") ok(Math.abs(e.getPhysicsBodyHeightSpan(h)!.elevation - 3.02) < 1e-5);
      e.unbindUnifiedPhysicsBody(h);
      equal(e.entityCount(), 1);
      throws(() => e.queryUnifiedPhysicsBodyStates(handles));
      e.stepRigidBodies(Math.fround(0.01));
      // Render projection and absence of legacy drift are checked by the packed RAF probe.
      e.bindUnifiedPhysicsBody(h, { collider });
      equal(e.entityCount(), 1);
      e.removeUnifiedPhysicsBody(h);
      equal(e.entityCount(), 0);
      throws(() => e.bindUnifiedPhysicsBody(h, { collider }));
    } finally { e.destroy(); }
    throws(() => e.unbindUnifiedPhysicsBody(h), /destroyed/i);
  }
});
test("failed binding preserves the authored visual and cannot take over imported component physics", async () => {
  // The first rejection needs an unconfigured engine; native setup follows below.
  const { e, h } = await visual({ physicsBackend: "legacy" });
  try {
    throws(() => e.bindUnifiedPhysicsBody(h, { collider }));
    e.configureUnifiedPhysics({ space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1 });
    throws(() => e.bindUnifiedPhysicsBody(h, { collider: { shape: { type: "sphere", radius: -1 } } }));
    throws(() => e.bindUnifiedPhysicsBody(h, { collider, pose: { position: [1, 2, 3] } }));
    equal(e.entityCount(), 1);
    const imported = e.spawnRigidBody({ x: 10, y: 0, mass: 1, collider: { type: "circle", radius: 1 } });
    throws(() => e.bindUnifiedPhysicsBody(imported, { collider }), /BodyOwnershipConflict/);
    e.stepRigidBodies(Math.fround(1 / 60));
    throws(() => e.unbindUnifiedPhysicsBody(imported), /BodyOwnershipConflict/);
    e.bindUnifiedPhysicsBody(h, { collider });
    const handles = new Uint32Array([h.entityId, h.entityGeneration]);
    const before = e.queryUnifiedPhysicsBodyStates(handles).words.slice();
    throws(() => e.bindUnifiedPhysicsBody(h, { collider, pose: { position: [9, 9, 0] } }), /BodyOwnershipConflict/);
    deepEqual(e.queryUnifiedPhysicsBodyStates(handles).words, before);
  } finally { e.destroy(); }
});
