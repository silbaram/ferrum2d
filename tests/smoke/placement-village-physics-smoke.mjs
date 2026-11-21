import assert from "node:assert/strict";

// The audio pose ABI reads the spatial presentation anchor, including the
// collider-to-sprite offset and authored XY conversion, for native bodies.
export function readVillageActorPose() {
  const engine = window.ferrumEngine;
  const actor = window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "village_hero").entity;
  const { words, floats } = engine.queryAudioPoseBuffer(new Uint32Array([actor.entityId, actor.entityGeneration]));
  if (words[0] !== 1) throw new Error("Missing village actor pose");
  return { x: floats[4], y: floats[5], elevation: floats[6], floor: words[3], animation: engine.dataSceneSpriteAnimationState(actor) };
}

/** Exercise native character collision in the actual village Play workspace. */
export async function smokeVillagePhysics(page) {
  const document = await page.evaluate(() => JSON.stringify(window.ferrumPlacementSpatialExportDocument()));
  await page.evaluate(() => window.ferrumPlacementViewerUpdateTransform("village_hero", { x: -90, y: 25 }));
  let report;
  try {
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === "game");
    await page.locator("canvas.demo-canvas").focus();
    assert.deepEqual(await page.evaluate(() => {
      const well = window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "village_well");
      const engine = window.ferrumEngine;
      return { backend: engine.physicsBackend(), wellColliders: engine.queryUnifiedPhysicsColliders(well.entity).length };
    }), { backend: "unified-3d", wellColliders: 1 });
    await page.keyboard.down("d");
    await page.waitForFunction(() => {
      const actor = window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "village_hero").entity;
      return window.ferrumEngine.queryAudioPoseBuffer(new Uint32Array([actor.entityId, actor.entityGeneration])).floats[4] > -45.5;
    }, undefined, { timeout: 15000 });
    await page.waitForTimeout(350);
    await page.keyboard.up("d");
    const wellStop = await page.evaluate(readVillageActorPose);
    assert(Math.abs(wellStop.x + 44.75) <= .1, `WASD walked through the well: ${wellStop.x}`);
    assert(Math.abs(wellStop.elevation) <= 1.1);

    const cases = await page.evaluate(() => {
      const engine = window.ferrumEngine;
      const actor = window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "village_hero").entity;
      const ids = new Uint32Array([actor.entityId, actor.entityGeneration]);
      const sphere = { type: "sphere", radius: 6 };
      const capsule = { type: "capsule", halfHeight: 5, radius: 3 };
      const hull = { type: "convexHull", points: [-6, 6].flatMap(x => [-8, 8].flatMap(y => [-6, 6].map(z => [x, y, z]))) };
      const mesh = {
        type: "triangleMesh",
        vertices: [0, -8, 18, 0, 8, 18, 0, -8, 12, 0, 8, 12, 0, -8, -6, 0, 8, -6],
        triangles: [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4],
      };
      const definitions = [
        { name: "sphere", shape: sphere, expectedX: -50.75 },
        { name: "capsule", shape: capsule, expectedX: -47.75 },
        { name: "convex", shape: hull, expectedX: -50.75 },
        { name: "later-mesh-face", shape: mesh, expectedX: -44.75 },
        { name: "secondary-mask-override", shape: sphere, secondary: true, expectedX: -50.75 },
        { name: "secondary-after-primary-sensor", shape: sphere, secondary: true, primarySensor: true, expectedX: -50.75 },
        { name: "sensor", shape: sphere, sensor: true, expectedX: 0 },
        { name: "removed-collider", shape: sphere, removed: true, expectedX: 0 },
        { name: "disabled-body", shape: sphere, disabled: true, expectedX: 0 },
        { name: "filtered-secondary", shape: sphere, secondary: true, filtered: true, expectedX: 0 },
        { name: "below-ground", shape: sphere, elevation: -10, expectedX: 0 },
        { name: "above-actor", shape: sphere, elevation: 100, expectedX: 0 },
      ];
      return definitions.map(test => {
        const fixture = { shape: test.shape, category: 8, mask: test.filtered ? 0 : 0xffffffff, sensor: test.sensor ?? false };
        const primary = test.secondary || test.removed
          ? { shape: { type: "box", halfExtents: [2, 2, 2] }, pose: { position: [0, 0, 60] }, category: 0, mask: 0, sensor: test.primarySensor ?? false }
          : fixture;
        const obstacle = engine.spawnUnifiedPhysicsBody({
          kind: "fixed", pose: { position: [-40, test.elevation ?? 8, 40] }, collider: primary,
        });
        try {
          if (test.secondary || test.removed) {
            const shape = engine.addUnifiedPhysicsCollider(obstacle, fixture);
            if (test.removed) engine.removeUnifiedPhysicsCollider(obstacle, shape);
          }
          if (test.disabled) engine.setUnifiedPhysicsBodyOptions(obstacle, {
            kind: "fixed", enabled: false, gravityScale: 1, linearDamping: 0, angularDamping: 0,
            canSleep: true, ccd: false, lockRotation: false,
          });
          engine.setUnifiedPhysicsPoses(ids, new Float32Array([-100, 11.25, 40, 0, 0, 0, 1]));
          for (let attempt = 0; attempt < 5; attempt++) {
            if (!engine.moveDataSceneSpatialBody(actor, 20, 0, { maxStepHeight: 4, maxDropHeight: 4 }))
              throw new Error(`Native move rejected ${test.name}`);
          }
          const { floats, words } = engine.queryAudioPoseBuffer(ids);
          return { name: test.name, expectedX: test.expectedX, x: floats[4], y: floats[5], elevation: floats[6], floor: words[3] };
        } finally { engine.removeUnifiedPhysicsBody(obstacle); }
      });
    });
    for (const item of cases) {
      assert(Math.abs(item.x - item.expectedX) <= .1, `${item.name}: expected ${item.expectedX}, got ${item.x}`);
      assert(Math.abs(item.y + 40) <= .03, JSON.stringify(item));
      assert.equal(item.floor, 0);
      assert(Math.abs(item.elevation) <= 1.1, JSON.stringify(item));
    }
    report = { wellStop, cases };
  } finally {
    await page.keyboard.up("d");
    if (await page.evaluate(() => window.ferrumPlacementWorkspaceMode === "game")) {
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === "spatial");
    }
    await page.evaluate(() => window.ferrumPlacementViewerUndo());
  }
  assert.equal(await page.evaluate(() => JSON.stringify(window.ferrumPlacementSpatialExportDocument())), document,
    "Physics runtime checks changed the authoring document");
  return report;
}
