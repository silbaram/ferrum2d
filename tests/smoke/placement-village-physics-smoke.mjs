import assert from "node:assert/strict";

/** Exercise native character collision in the actual village Play workspace. */
export async function smokeVillagePhysics(page) {
  const document = await page.evaluate(() => JSON.stringify(window.ferrumPlacementSpatialExportDocument()));
  await page.evaluate(() => window.ferrumPlacementViewerUpdateTransform("village_hero", { x: -90, y: 25 }));
  let report;
  try {
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === "game");
    await page.locator("canvas.demo-canvas").focus();
    assert.equal(await page.evaluate(() => {
      const well = window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "village_well");
      return window.ferrumEngine.getPhysicsEntity(well.entity).colliderType;
    }), "circle");
    await page.keyboard.down("d");
    await page.waitForFunction(() => {
      const actor = window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "village_hero");
      return window.ferrumEngine.getPhysicsEntity(actor.entity).x > -45;
    }, undefined, { timeout: 10000 });
    await page.waitForTimeout(250);
    await page.keyboard.up("d");
    const wellStop = await page.evaluate(() => {
      const actor = window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "village_hero");
      const p = window.ferrumEngine.getPhysicsEntity(actor.entity);
      return { x: p.x, y: p.y, heightSpan: p.heightSpan };
    });
    assert(Math.abs(wellStop.x + 44) < 0.02, `WASD walked through circular well: ${wellStop.x}`);

    const native = await page.evaluate(() => {
      const engine = window.ferrumEngine;
      const actor = window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "village_hero").entity;
      const actorSpan = engine.getPhysicsEntity(actor).heightSpan;
      const circle = { type: "circle", radius: 6 };
      const definitions = [
        { name: "circle", collider: circle, x: -50 },
        { name: "capsule", collider: { type: "capsule", startX: 0, startY: -3, endX: 0, endY: 3, radius: 3 }, x: -47 },
        { name: "convex", collider: { type: "convexPolygon", vertices: [-6, -6, 6, -6, 6, 6, -6, 6] }, x: -50 },
        { name: "later-chain-segment", collider: { type: "chain", vertices: [0, 18, 0, 12, 0, -6], looped: false }, x: -44 },
        { name: "secondary-circle-mask-override", collider: circle, secondary: true, x: -50 },
        { name: "secondary-circle-primary-sensor", collider: circle, secondary: true, primarySensor: true, x: -50 },
        { name: "sensor", collider: circle, sensor: true, x: 0 },
        { name: "disabled-collider", collider: circle, disabled: true, x: 0 },
        { name: "disabled-body", collider: circle, bodyDisabled: true, x: 0 },
        { name: "filtered-secondary", collider: circle, secondary: true, filtered: true, x: 0 },
        { name: "other-floor", collider: circle, floor: 1, x: 0 },
        { name: "above-actor", collider: circle, elevation: 100, x: 0 },
      ];
      const cases = definitions.map(test => {
        const wall = engine.spawnRigidBody({
          x: -40, y: -40, bodyType: "static", layer: "wall",
          collider: test.secondary ? { type: "aabb", halfWidth: 2, halfHeight: 2, offsetY: 60 } : test.collider,
          categoryBits: test.secondary ? 0 : 8, maskBits: test.secondary ? 0 : 0xffffffff,
          isTrigger: test.sensor || test.primarySensor,
          colliderEnabled: !test.disabled, bodyEnabled: !test.bodyDisabled,
          heightSpan: { floorId: test.floor ?? 0, elevation: test.elevation ?? 0, height: 16 },
        });
        try {
          if (test.secondary && !engine.addPhysicsBodyCollider(wall, {
            collider: test.collider, layer: "wall", categoryBits: 8, maskBits: test.filtered ? 0 : 0xffffffff,
          })) throw new Error(`Failed to add ${test.name}`);
          if (!engine.setPhysicsBodyPosition(actor, -100, -40) || !engine.setPhysicsBodyHeightSpan(actor, actorSpan))
            throw new Error("Failed to restore actor test pose");
          // The village has narrow authored surfaces; respect the native 128-substep bound.
          // Repeated attempts also verify that touching obstacles cannot be pushed through.
          for (let attempt = 0; attempt < 5; attempt++) {
            if (!engine.moveDataSceneSpatialBody(actor, 20, 0, { maxStepHeight: 4, maxDropHeight: 4 }))
              throw new Error(`Native move rejected ${test.name}`);
          }
          const p = engine.getPhysicsEntity(actor);
          return { name: test.name, expectedX: test.x, x: p.x, y: p.y, floor: p.heightSpan.floorId, elevation: p.heightSpan.elevation };
        } finally { engine.despawnPhysicsEntity(wall); }
      });
      const pose = () => {
        const p = engine.getPhysicsEntity(actor);
        return { x: p.x, y: p.y, heightSpan: p.heightSpan };
      };
      const reset = (x, y) => {
        if (!engine.setPhysicsBodyPosition(actor, x, y) || !engine.setPhysicsBodyHeightSpan(actor, actorSpan))
          throw new Error("Failed to restore surface test pose");
      };
      const move = dx => {
        if (!engine.moveDataSceneSpatialBody(actor, dx, 0, { maxStepHeight: 4, maxDropHeight: 4 }))
          throw new Error("Native village surface move rejected");
      };
      reset(150, -12);
      move(20); move(20);
      const bridge = pose();
      move(20); move(20);
      const crossed = pose();
      reset(150, -80);
      for (let attempt = 0; attempt < 5; attempt++) move(20);
      const river = pose();
      reset(8, -192);
      move(-20); move(-20); move(-20);
      const ramp = pose();
      move(-20); move(-20);
      const terrace = pose();
      for (let attempt = 0; attempt < 5; attempt++) move(20);
      return { cases, surfaces: { bridge, crossed, river, ramp, terrace, ground: pose() } };
    });
    for (const item of native.cases) {
      assert(Math.abs(item.x - item.expectedX) < 0.02, `${item.name}: expected ${item.expectedX}, got ${item.x}`);
      assert.equal(item.y, -40);
      assert.equal(item.floor, 0);
      assert.equal(item.elevation, 0);
    }
    const { bridge, crossed, river, ramp, terrace, ground } = native.surfaces;
    assert.equal(bridge.x, 190); assert.equal(bridge.heightSpan.elevation, 2);
    assert.equal(crossed.x, 230); assert.equal(crossed.heightSpan.elevation, 0);
    assert(river.x >= 160 && river.x <= 170.1, `Crossed the river away from the bridge: ${river.x}`);
    assert(Math.abs(ramp.heightSpan.elevation - (-16 - ramp.x) * 24 / 64) < 0.01);
    assert.equal(terrace.heightSpan.elevation, 24);
    assert.equal(ground.x, 8); assert.equal(ground.heightSpan.elevation, 0);
    for (const p of Object.values(native.surfaces)) assert.equal(p.heightSpan.floorId, 0);
    report = { wellStop, ...native };
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
