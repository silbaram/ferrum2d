import assert from "node:assert/strict";

// Executed from the packed consumer through public imports and the real RAF loop.
export async function probeUnifiedMelee(page) {
  const results = await page.evaluate(async () => {
    const { createEngine } = await import("@ferrum2d/ferrum-web/core");
    const { applyDataSceneAuthoringDocument } = await import("@ferrum2d/ferrum-web/authoring");
    const results = [];
    for (const space of ["planar-xy", "spatial"]) {
      const spatial = space === "spatial";
      const input = { w: false, a: false, s: false, d: false, space: false, enter: false, mouseLeft: false, mouseX: 0, mouseY: 0 };
      let elapsed = 0, consumed = 0, duration = 0, finish, timer, frames = 0, steps = 0, maxRustMs = 0, billboardVertices = 0;
      const events = [];
      const e = await createEngine(frame => {
        frames++; steps += frame.unifiedPhysics?.frame.backendSteps ?? 0;
        elapsed += frame.physics.fixedConsumedSeconds; consumed += frame.physics.fixedConsumedSeconds;
        maxRustMs = Math.max(maxRustMs, frame.rustUpdateTimeMs);
        const packet = frame.renderCommandBuffer.spatial;
        if (packet) billboardVertices = Math.max(billboardVertices, packet.billboards.length / packet.vertexStride);
        events.push(...frame.gameplayEvents.map(event => ({ ...event })));
        if (elapsed >= duration) { e.pause(); finish(); }
      }, () => input, undefined, () => ({ width: 320, height: 180 }));
      const run = async (seconds, start = false) => {
        elapsed = 0; duration = seconds;
        const done = new Promise((resolve, reject) => {
          finish = resolve;
          timer = setTimeout(() => reject(new Error("Native melee RAF timed out")), 45000);
        });
        try { if (start) e.start(); else e.resume(); await done; }
        finally { clearTimeout(timer); e.pause(); }
      };
      const object = (id, x, y, layer, recipe, offset = [0, 0, 0]) => ({
        id, prefab: "object", x: x + offset[0], y: spatial ? 0 : y + offset[1],
        props: { behaviorRecipes: recipe ? [recipe] : [], components: {
          visual: { kind: "primitive", shape: "circle", radius: 0.2 }, collider: "none", layer,
          body: { kind: "fixed", elevation: spatial ? y + offset[1] : 0, renderOffset: offset,
            collider: { shape: id === "wall" ? { type: "box", halfExtents: [0.1, 0.4, 0.4] } : { type: "sphere", radius: 0.2 },
              sensor: id !== "wall" } },
        } },
      });
      const document = {
        format: "ferrum2d.consumer.scene-authoring", version: 1,
        physics: { space, gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: 0.01 },
        gameplay: { primaryActor: "actor", combat: true },
        ids: { actions: { melee: 77, counter: 78 }, timers: { counter: 9 } },
        sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances: [
          object("actor", 0, 1, "player", "actor", [100, 20, 0]),
          object("near", 1, 1, "enemy", "counter", [-100, 10, 0]),
          object("high", 0, 8, "enemy", "health"),
          object("blocked", -2, 1, "enemy", "health"),
          object("wall", -1, 1, "wall"),
        ] } } },
        behaviorRecipes: { entities: {
          actor: { recipes: [{ kind: "health", max: 20 }, { kind: "meleeAction", action: "melee", range: 3, damage: 2, cooldownSeconds: 1 }] },
          health: { recipes: [{ kind: "health", max: 10 }] },
          counter: { recipes: [{ kind: "health", max: 10 }, { kind: "meleeAction", action: "counter", target: "player", range: 3, damage: 2, cooldownSeconds: 1 },
            { kind: "timerTrigger", timer: "counter", action: "counter", seconds: 1 }] },
        } },
      };
      try {
        if (spatial) document.spatial = {
          camera: { projection: "orthographic", position: { x: 0, y: -100, elevation: 100 }, target: { x: 0, y: 0, elevation: 10 }, height: 300 },
          terrain: [{ id: "floor", x: -10, y: -10, width: 20, depth: 20, elevation: 0, baseElevation: -1, kind: "flat", color: [0.3, 0.45, 0.35, 1] }],
          billboards: { actor: {}, near: {}, high: {}, blocked: {}, wall: {} },
        };
        const handles = applyDataSceneAuthoringDocument(e, document, { textureId: () => 11 }).entityHandles;
        if (!e.setInputActionBinding(77, 0, { control: "mouseLeft", activation: "pressed" })) throw new Error("Melee binding rejected");
        const state = () => Object.fromEntries(["actor", "near", "high", "blocked"].map(id => [id, e.gameplayEntityDiagnostics(handles[id])]));
        input.mouseLeft = true; await run(0.03, true); const first = state();
        input.mouseLeft = false; await run(0.03);
        input.mouseLeft = true; await run(0.03); const cooldown = state();
        input.mouseLeft = false; await run(Math.max(0.01, 1.05 - consumed)); const counter = state();
        results.push({ space, first, cooldown, counter, handles, events, playing: e.dataSceneState(), entities: e.entityCount(), frames, steps, maxRustMs, billboardVertices });
      } finally { clearTimeout(timer); e.destroy(); }
    }
    return results;
  });
  for (const r of results) {
    assert.equal(r.playing, "playing"); assert.equal(r.entities, 5);
    assert(r.frames > 0 && r.steps >= 105 && Number.isFinite(r.maxRustMs));
    if (r.space === "spatial") assert(r.billboardVertices >= 30, JSON.stringify(r));
    assert.equal(r.first.near.health, 8); assert.equal(r.first.high.health, 10); assert.equal(r.first.blocked.health, 10);
    assert(r.first.actor.actions.find(a => a.id === 77).remainingSeconds > 0.8);
    assert.equal(r.cooldown.near.health, 8); assert.equal(r.counter.near.health, 8); assert.equal(r.counter.actor.health, 18);
    assert(!r.events.some(event => event.kind === "actionFailed"), JSON.stringify(r.events));
    const damage = r.events.filter(event => event.kind === "collisionDamage");
    assert.equal(damage.length, 2);
    assert(damage.some(event => event.sourceId === r.handles.actor.entityId && event.actorId === r.handles.near.entityId));
    assert(damage.some(event => event.sourceId === r.handles.near.entityId && event.actorId === r.handles.actor.entityId));
  }
  return results;
}
