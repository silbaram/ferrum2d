import "./nativeRuntimeTestHelper.js";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import { createEngine } from "../src/createEngine.js";
import { applyDataSceneAuthoringDocument } from "../src/authoring.js";
import { nativeFileEngineOwner } from "../src/nativeFileEngineOwner.js";
import { activateLegacySpatialDataScene } from "../src/physicsDefaults.js";
import type { CreateEngineOptions } from "../src/engineTypes.js";

/** Physics-omitted HD-2D documents (hd2d-movement, ai-combat and the
 * data-scene-native spatial recipe) use the heightSpan/AABB actor path. */
const actorComponents = (layer: string) => ({
  visual: { kind: "sprite", texture: 0, width: 24, height: 32, originY: 1 },
  collider: { type: "aabb", halfWidth: 4, halfHeight: 4, isTrigger: false },
  layer,
  body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 24 } },
});
const camera = {
  projection: "orthographic", position: { x: 240, y: -320, elevation: 420 },
  target: { x: 0, y: 0, elevation: 16 }, height: 250, near: 0.1, far: 2000,
};
function hd2dMovement() {
  return {
    format: "ferrum2d.consumer.scene-authoring", version: 1,
    sceneComposition: { initialFragment: "lab", prefabs: { object: {} }, fragments: { lab: { instances: [
      { id: "actor", prefab: "object", x: 0, y: -64, props: { components: actorComponents("player") } },
    ] } } },
    behaviorRecipes: { entities: {} },
    gameplay: { primaryActor: "actor" },
    spatial: {
      camera,
      terrain: [
        { id: "ground", x: -64, y: -96, width: 128, depth: 64, elevation: 0 },
        { id: "ramp", x: -64, y: -32, width: 128, depth: 64, elevation: 0, endElevation: 48, kind: "ramp" },
        { id: "upper", x: -64, y: 32, width: 128, depth: 64, elevation: 48, baseElevation: 40, floorId: 1, kind: "bridge" },
      ],
      connections: [{ from: "ramp", to: "upper" }],
      billboards: { actor: {} },
      actor: { instanceId: "actor", speed: 72, maxStepHeight: 12, maxDropHeight: 52 },
    },
  };
}
function aiCombat() {
  return {
    format: "ferrum2d.consumer.scene-authoring", version: 1,
    sceneComposition: { initialFragment: "lab", prefabs: { object: {} }, fragments: { lab: { instances: [
      { id: "actor", prefab: "object", x: 88, y: 0, props: { components: actorComponents("player") } },
      { id: "enemy", prefab: "object", x: -88, y: 0, props: { components: actorComponents("enemy") } },
      { id: "wall", prefab: "object", x: 0, y: 0, props: { components: {
        visual: { kind: "sprite", texture: 0, width: 24, height: 60 },
        collider: { type: "aabb", halfWidth: 12, halfHeight: 30, isTrigger: false }, layer: "wall",
        body: { type: "static", heightSpan: { floorId: 0, elevation: 0, height: 40 } },
      } } },
    ] } } },
    behaviorRecipes: { entities: {
      actor: { recipes: [{ kind: "health", max: 1000 }, { kind: "faction", faction: "player", damages: ["enemy"] }] },
      enemy: { recipes: [{ kind: "health", max: 100 }, { kind: "faction", faction: "enemy", damages: ["player"] },
        { kind: "chase", target: "primaryActor", speed: 64, stopDistance: 16 }] },
    } },
    gameplay: { primaryActor: "actor", combat: true, combatNavigation: { maxAgents: 4, arrivalRadius: 0 } },
    spatial: {
      camera,
      terrain: [
        { id: "ground", x: -160, y: -100, width: 320, depth: 200, elevation: 0 },
        { id: "obstacle", x: -12, y: -30, width: 24, depth: 60, elevation: 40, baseElevation: 0, floorId: 1, walkable: false },
      ],
      billboards: { actor: {}, enemy: {} },
      actor: { instanceId: "actor", speed: 72, maxStepHeight: 8, maxDropHeight: 8 },
    },
  };
}
function planar2d() {
  return {
    format: "ferrum2d.consumer.scene-authoring", version: 1,
    sceneComposition: { initialFragment: "lab", prefabs: { object: {} }, fragments: { lab: { instances: [
      { id: "actor", prefab: "object", x: 0, y: 0, props: { components: {
        visual: { kind: "sprite", texture: 0, width: 16, height: 16 },
        collider: { type: "aabb", halfWidth: 4, halfHeight: 4, isTrigger: false }, layer: "player",
        body: { type: "kinematic" },
      } } },
    ] } } },
    behaviorRecipes: { entities: {} },
  };
}

function walkRight(native: Engine, read: () => number): void {
  const start = read();
  native.set_input(false, false, false, true, false, false, false, 0, 0);
  for (let i = 0; i < 10; i++) native.update(1 / 60);
  native.set_input(false, false, false, false, false, false, false, 0, 0);
  ok(read() > start + 5, `${read()} <= ${start} + 5`);
}

test("omitted creation runs physics-omitted HD-2D actor documents on the legacy path", async () => {
  for (const document of [hd2dMovement(), aiCombat()]) {
    const engine = await createEngine();
    try {
      const owner = nativeFileEngineOwner(engine), native = owner.native;
      equal(engine.physicsBackend(), "unified-3d");
      const applied = applyDataSceneAuthoringDocument(engine, document);
      equal(engine.physicsBackend(), "legacy");
      equal(native.default_physics_policy_scene(), 0);
      // The facade now reports the same metadata as a legacy-created Engine.
      equal(owner.frame.physicsSpecScene, undefined);
      equal(owner.frame.physicsSpec.solver.fixedTimestep, false);
      const actor = applied.entityHandles.actor;
      walkRight(native, () => engine.getPhysicsEntity(actor)!.x);
      // Re-applying on the same Engine (a lab reset) keeps the selected path.
      const again = applyDataSceneAuthoringDocument(engine, document);
      equal(engine.physicsBackend(), "legacy");
      walkRight(native, () => engine.getPhysicsEntity(again.entityHandles.actor)!.x);
    } finally { engine.destroy(); }
  }
});

test("explicit unified policy and used native worlds reject the legacy actor and stay native", async () => {
  const unified = await createEngine(undefined, undefined, undefined, undefined, { physicsBackend: "unified", fixedTimestep: false });
  try {
    throws(() => applyDataSceneAuthoringDocument(unified, hd2dMovement()), /runtime rejected spatial scene configuration/);
    equal(unified.physicsBackend(), "unified-3d");
    equal(nativeFileEngineOwner(unified).native.default_physics_policy_scene(), 1);
  } finally { unified.destroy(); }
  const engine = await createEngine();
  try {
    const native = nativeFileEngineOwner(engine).native;
    // A planar Data Scene keeps the default native world and its imported bodies.
    const planar = applyDataSceneAuthoringDocument(engine, planar2d());
    native.update(1 / 60);
    equal(engine.physicsBackend(), "unified-3d");
    equal(native.default_physics_policy_scene(), 4);
    // The active Data Scene owns that world, so the next HD-2D apply keeps it, is rejected and rolls back.
    throws(() => applyDataSceneAuthoringDocument(engine, hd2dMovement()), /runtime rejected spatial scene configuration/);
    equal(engine.physicsBackend(), "unified-3d");
    ok(engine.gameplayEntityExists(planar.entityHandles.actor));
  } finally { engine.destroy(); }
});

test("legacy HD-2D activation is limited to the implicit native creation policy", () => {
  let active = true, legacyCalls = 0, plainCalls = 0, accepted = true;
  const native = {
    physics_spec_backend_active: () => active,
    use_legacy_data_scene: () => { legacyCalls++; if (accepted) active = false; return accepted; },
    use_data_scene: () => { plainCalls++; },
  } as unknown as Engine;
  const activate = (options: CreateEngineOptions) => activateLegacySpatialDataScene(native, options);
  equal(activate({ physicsBackend: "unified" }), false); deepEqual([legacyCalls, plainCalls, active], [0, 1, true]);
  accepted = false;
  equal(activate({}), false); deepEqual([legacyCalls, plainCalls, active], [1, 2, true]);
  accepted = true;
  equal(activate({}), true); deepEqual([legacyCalls, plainCalls, active], [2, 2, false]);
  equal(activate({ physicsBackend: "legacy" }), true); deepEqual([legacyCalls, plainCalls], [3, 2]);
  // A core without the export keeps the existing activation.
  const old = { use_data_scene: () => { plainCalls++; } } as unknown as Engine;
  equal(activateLegacySpatialDataScene(old, {}), false); equal(plainCalls, 3);
});
