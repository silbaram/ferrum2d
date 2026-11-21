import assert from "node:assert/strict";

export async function probeUnifiedCombatMovement(page) {
  const results = await page.evaluate(async () => {
    const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: B, UNIFIED_PHYSICS_CHARACTER_LAYOUT: C } = await import("@ferrum2d/ferrum-web/core");
    const { applyDataSceneAuthoringDocument } = await import("@ferrum2d/ferrum-web/authoring");
    const results = [];
    for (const mode of ["planar-xy", "spatial", "character"]) {
      const character = mode === "character", spatial = mode !== "planar-xy";
      let elapsed = 0, consumed = 0, duration = 0, finish, timer, frames = 0, steps = 0, maxRustMs = 0, vertices = 0;
      const e = await createEngine(frame => {
        frames++; steps += frame.unifiedPhysics?.frame.backendSteps ?? 0;
        elapsed += frame.physics.fixedConsumedSeconds; consumed += frame.physics.fixedConsumedSeconds;
        maxRustMs = Math.max(maxRustMs, frame.rustUpdateTimeMs);
        const spatialBuffer = frame.renderCommandBuffer.spatial;
        if (spatialBuffer) vertices = Math.max(vertices, spatialBuffer.billboards.length / spatialBuffer.vertexStride);
        if (elapsed >= duration) { e.pause(); finish(); }
      }, undefined, undefined, () => ({ width: 320, height: 180 }));
      const run = async (seconds, start = false) => {
        elapsed = 0; duration = seconds;
        const done = new Promise((resolve, reject) => {
          finish = resolve;
          timer = setTimeout(() => reject(new Error("Native combat movement RAF timed out")), 45000);
        });
        try { if (start) e.start(); else e.resume(); await done; }
        finally { clearTimeout(timer); e.pause(); }
      };
      const instance = (id, x, layer, body, recipe) => ({ id, prefab: "object", x, y: spatial ? 0 : 1, props: {
        behaviorRecipes: recipe ? [recipe] : [],
        components: { visual: { kind: "primitive", shape: "circle", radius: 0.25 }, collider: "none", layer, body },
      } });
      const instances = [
        instance("player", -90, "player", { kind: "fixed", elevation: spatial ? 1 : 0, renderOffset: [-100,0,0], collider: { shape: { type: "sphere", radius: 0.25 }, sensor: true } }),
        instance("enemy", 100, "enemy", { kind: character ? "kinematic-position" : "kinematic-velocity", elevation: spatial ? 1 : 0, renderOffset: [100,0,0],
          collider: { shape: character ? { type: "capsule", halfHeight: 0.5, radius: 0.25 } : { type: "sphere", radius: 0.25 }, sensor: !character },
          ...(character ? { character: {} } : {}),
        }, "chaser"),
      ];
      if (character) instances.push(instance("wall", 2, "wall", { kind: "fixed", elevation: 2, collider: { shape: { type: "box", halfExtents: [0.1,2,2] } } }));
      const doc = {
        format: "ferrum2d.consumer.scene-authoring", version: 1,
        physics: { space: spatial ? "spatial" : "planar-xy", gravity: [0,character ? -10 : 0,0], lengthUnit: 1, stepSeconds: 0.01 },
        gameplay: { primaryActor: "player", combat: true },
        sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances } } },
        behaviorRecipes: { entities: { chaser: { recipes: [{ kind: "chase", target: "primaryActor", speed: 2, stopDistance: 0 }] } } },
        ...(spatial ? { spatial: {
          camera: { projection: "orthographic", position: { x: 0, y: -100, elevation: 100 }, target: { x: 0, y: 0, elevation: 10 }, height: 300 },
          terrain: [{ id: "floor", x: -20, y: -10, width: 40, depth: 20, elevation: 0, baseElevation: -1, kind: "flat", color: [0.3,0.45,0.35,1] }],
          billboards: Object.fromEntries(instances.map(i => [i.id, {}])),
        } } : {}),
      };
      try {
        const applied = applyDataSceneAuthoringDocument(e, doc, { textureId: () => 11 });
        const a = applied.entityHandles.enemy;
        const ids = new Uint32Array([a.entityId, a.entityGeneration]);
        const position = () => [...e.queryUnifiedPhysicsBodyStates(ids).floats.slice(B.position, B.position + 3)];
        if (character) for (let i = 0; i < 120; i++) e.stepRigidBodies(Math.fround(0.01));
        const initial = position();
        if (character) e.setUnifiedPhysicsCharacterInputs(ids, new Float32Array([0,0,0,4]));
        await run(0.03, true);
        const first = position();
        const jumped = character ? e.queryUnifiedPhysicsCharacterStates(ids).floats[C.verticalSpeed] : null;
        await run(1.2);
        const final = position();
        const grounded = character ? Boolean(e.queryUnifiedPhysicsCharacterStates(ids).words[C.flags] & C.groundedFlag) : null;
        results.push({ mode, initial, first, final, jumped, grounded, consumed, frames, steps, maxRustMs, vertices, playing: e.dataSceneState(), entities: e.entityCount() });
      } finally { clearTimeout(timer); e.destroy(); }
    }
    return results;
  });
  for (const r of results) {
    assert.equal(r.playing, "playing");
    assert.equal(r.entities, r.mode === "character" ? 3 : 2);
    assert(r.steps >= 123 && r.frames > 0 && Number.isFinite(r.maxRustMs), JSON.stringify(r));
    assert(Math.abs(r.initial[0]) < 0.001 && r.first[0] > 0.03, JSON.stringify(r));
    if (r.mode === "character") {
      assert(r.jumped > 2.8 && r.first[1] > r.initial[1] + 0.05, JSON.stringify(r));
      assert(r.final[0] > 1.60 && r.final[0] < 1.66 && r.grounded, JSON.stringify(r));
    } else assert(Math.abs(r.final[0] - 2 * r.consumed) < 0.004, JSON.stringify(r));
    if (r.mode !== "planar-xy") assert(r.vertices >= 12, JSON.stringify(r));
  }
  return results;
}
