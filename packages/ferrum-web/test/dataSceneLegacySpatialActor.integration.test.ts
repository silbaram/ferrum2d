import "./nativeRuntimeTestHelper.js";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import { createEngine } from "../src/createEngine.js";
import { applyDataSceneAuthoringDocument } from "../src/authoring.js";
import { captureGameStateSnapshot, hashGameStateSnapshot, restoreGameStateSnapshot, type GameStateSnapshot } from "../src/gameStateSnapshot.js";
import { inspectDataSceneAuthoringMetadata } from "../src/dataSceneProgress.js";
import { usesLegacySpatialActorPath } from "../src/dataSceneRuntimeTarget.js";
import { createSceneInstanceHandleRegistry } from "../src/sceneInstanceHandles.js";
import { nativeFileEngineOwner } from "../src/nativeFileEngineOwner.js";
import { activateLegacySpatialDataScene, legacySpatialDataSceneAvailable } from "../src/physicsDefaults.js";
import { resolveSceneAuthoringDocument } from "../src/sceneAuthoringDocument.js";
import type { CreateEngineOptions, FerrumEngine } from "../src/engineTypes.js";
import type { SceneCompositionJsonValue } from "../src/sceneComposition.js";

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
  let active = true, legacyCalls = 0, plainCalls = 0, queries = 0, accepted = true;
  const native = {
    physics_spec_backend_active: () => active,
    use_legacy_data_scene: () => { legacyCalls++; if (accepted) active = false; return accepted; },
    can_use_legacy_data_scene: () => { queries++; return accepted; },
    use_data_scene: () => { plainCalls++; },
  } as unknown as Engine;
  const activate = (options: CreateEngineOptions) => activateLegacySpatialDataScene(native, options);
  const available = (options: CreateEngineOptions) => legacySpatialDataSceneAvailable(native, options);
  // The read-only twin applies the same explicit-unified exclusion before Rust.
  equal(available({ physicsBackend: "unified" }), false); equal(queries, 0);
  equal(activate({ physicsBackend: "unified" }), false); deepEqual([legacyCalls, plainCalls, active], [0, 1, true]);
  accepted = false;
  equal(available({}), false); equal(queries, 1);
  equal(activate({}), false); deepEqual([legacyCalls, plainCalls, active], [1, 2, true]);
  accepted = true;
  equal(available({}), true); equal(available({ physicsBackend: "legacy" }), true);
  // The query never activates anything.
  deepEqual([queries, legacyCalls, plainCalls, active], [3, 1, 2, true]);
  equal(activate({}), true); deepEqual([legacyCalls, plainCalls, active], [2, 2, false]);
  equal(activate({ physicsBackend: "legacy" }), true); deepEqual([legacyCalls, plainCalls], [3, 2]);
  // A core without the exports keeps the existing activation and native rejection.
  const old = { use_data_scene: () => { plainCalls++; } } as unknown as Engine;
  equal(legacySpatialDataSceneAvailable(old, {}), false);
  equal(activateLegacySpatialDataScene(old, {}), false); equal(plainCalls, 3);
});

test("apply and JSON progress restore share the physics-omitted HD-2D actor predicate", () => {
  const legacy = (document: unknown) => usesLegacySpatialActorPath(resolveSceneAuthoringDocument(document));
  equal(legacy(hd2dMovement()), true);
  equal(legacy(aiCombat()), true);
  equal(legacy(planar2d()), false);
  // combatNavigation alone selects the path once a spatial scene exists.
  const navigation: { spatial: { actor?: unknown } } = aiCombat();
  delete navigation.spatial.actor;
  equal(legacy(navigation), true);
  // A spatial scene without an actor or navigation keeps the native default.
  const camera: { spatial: { actor?: unknown }; gameplay?: unknown } = hd2dMovement();
  delete camera.spatial.actor;
  delete camera.gameplay;
  equal(legacy(camera), false);
});

function save(engine: FerrumEngine, document: unknown): GameStateSnapshot {
  const saved = captureGameStateSnapshot(engine, {
    includeDataSceneState: true, includeDataSceneProgress: true,
    dataSceneAuthoringDocument: document as SceneCompositionJsonValue,
  });
  return JSON.parse(JSON.stringify(saved)) as GameStateSnapshot;
}
function pose(engine: FerrumEngine, handle: Parameters<FerrumEngine["getPhysicsEntity"]>[0]) {
  const entity = engine.getPhysicsEntity(handle)!;
  return { x: entity.x, y: entity.y, heightSpan: entity.heightSpan };
}
/** Native file bytes and SDK metadata that a rejected restore must not change. */
function engineState(engine: FerrumEngine) {
  const owner = nativeFileEngineOwner(engine), native = owner.native;
  const metadata = inspectDataSceneAuthoringMetadata(engine);
  return {
    file: native.capture_native_file(new TextEncoder().encode("{}{}{}{}{}{}"), new Uint32Array([2, 2, 2, 2, 2, 2]), 0, 0, new Uint32Array()),
    backend: engine.physicsBackend(), policy: native.default_physics_policy_scene(),
    scene: owner.frame.physicsSpecScene, spec: structuredClone(owner.frame.physicsSpec),
    progress: structuredClone(metadata.progress), revision: metadata.revision, epoch: metadata.epoch,
  };
}

test("JSON progress of a physics-omitted HD-2D actor scene restores into a fresh no-options Engine", async () => {
  for (const document of [hd2dMovement(), aiCombat()]) {
    const source = await createEngine();
    let saved: GameStateSnapshot, expected: ReturnType<typeof pose>;
    try {
      const applied = applyDataSceneAuthoringDocument(source, document);
      equal(source.physicsBackend(), "legacy");
      walkRight(nativeFileEngineOwner(source).native, () => source.getPhysicsEntity(applied.entityHandles.actor)!.x);
      expected = pose(source, applied.entityHandles.actor);
      saved = save(source, document);
    } finally { source.destroy(); }
    const fresh = await createEngine();
    try {
      const owner = nativeFileEngineOwner(fresh), native = owner.native;
      equal(fresh.physicsBackend(), "unified-3d");
      equal(native.default_physics_policy_scene(), 1);
      const registry = createSceneInstanceHandleRegistry();
      const restored = restoreGameStateSnapshot(fresh, saved, { dataSceneAuthoringApplyOptions: { instanceHandleRegistry: registry } });
      ok(restored.dataSceneStateApplied && restored.dataSceneAuthoringDocumentApplied);
      // The restore's own apply took the same legacy path as the saved Engine.
      equal(fresh.physicsBackend(), "legacy");
      equal(native.default_physics_policy_scene(), 0);
      equal(owner.frame.physicsSpecScene, undefined);
      const actor = registry.get("actor")!;
      deepEqual(pose(fresh, actor), expected);
      // Saving again yields the same authored progress, and the actor still runs.
      deepEqual(save(fresh, document).dataScene!.progress, saved.dataScene!.progress);
      walkRight(native, () => fresh.getPhysicsEntity(actor)!.x);
    } finally { fresh.destroy(); }
  }
});

test("JSON progress restore of an HD-2D actor scene rejects Engines that cannot take the legacy path", async () => {
  const source = await createEngine();
  let saved: GameStateSnapshot;
  try {
    applyDataSceneAuthoringDocument(source, hd2dMovement());
    saved = save(source, hd2dMovement());
  } finally { source.destroy(); }
  const rejected = (engine: FerrumEngine, label: string): void => {
    try {
      const before = engineState(engine);
      throws(() => restoreGameStateSnapshot(engine, structuredClone(saved)),
        /physics-omitted HD-2D actor document requires an Engine that applies it on the legacy path/);
      deepEqual(engineState(engine), before, label);
      equal(engine.physicsBackend(), "unified-3d", label);
    } finally { engine.destroy(); }
  };
  // Explicit unified creation never leaves native, although Rust would admit the switch.
  const unified = await createEngine(undefined, undefined, undefined, undefined, { physicsBackend: "unified", fixedTimestep: false });
  equal(nativeFileEngineOwner(unified).native.can_use_legacy_data_scene(), true);
  rejected(unified, "explicit unified");
  // A user-owned native setting replaced the engine-owned defaults.
  const changed = await createEngine();
  changed.configureAutoRigidBodyStep(false);
  rejected(changed, "changed native settings");
  // An active native Data Scene owns its world.
  const planar = await createEngine();
  applyDataSceneAuthoringDocument(planar, planar2d());
  equal(planar.physicsBackend(), "unified-3d");
  rejected(planar, "native Data Scene");
  // Documents with physics keep the existing native snapshot rejection. With
  // physics this AABB actor is invalid, so the case has no spatial.actor.
  const native = await createEngine();
  try {
    const before = engineState(native);
    const withPhysics = structuredClone(saved) as GameStateSnapshot & { dataScene: { authoringDocument: { physics?: unknown; spatial: { actor?: unknown } } } };
    withPhysics.dataScene.authoringDocument.physics = { space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1 };
    delete withPhysics.dataScene.authoringDocument.spatial.actor;
    const signed = { ...withPhysics, snapshotHash: hashGameStateSnapshot(withPhysics) };
    throws(() => restoreGameStateSnapshot(native, signed), /native physics snapshots, which are not yet supported/);
    deepEqual(engineState(native), before);
  } finally { native.destroy(); }
});

test("a failed restore apply after the legacy activation rolls the fresh Engine back to native", async () => {
  const source = await createEngine();
  let saved: GameStateSnapshot;
  try {
    applyDataSceneAuthoringDocument(source, hd2dMovement());
    saved = save(source, hd2dMovement());
  } finally { source.destroy(); }
  const fresh = await createEngine(), reference = await createEngine();
  try {
    const native = nativeFileEngineOwner(fresh).native, revision = native.runtime_checkpoint_revision();
    // The registry sync runs after the legacy activation inside the apply.
    const failing = createSceneInstanceHandleRegistry();
    let backendAtFailure: string | undefined;
    failing.sync = () => { backendAtFailure = fresh.physicsBackend(); throw new Error("registry sync failed"); };
    throws(() => restoreGameStateSnapshot(fresh, structuredClone(saved), { dataSceneAuthoringApplyOptions: { instanceHandleRegistry: failing } }), /registry sync failed/);
    equal(backendAtFailure, "legacy");
    // The apply's native authoring rollback is one runtime checkpoint restore,
    // which counts the rollback by design. Everything else equals an untouched
    // fresh Engine after the same count, including the native default policy.
    equal(native.runtime_checkpoint_revision(), revision + 1);
    reference.restoreRuntimeCheckpoint(reference.captureRuntimeCheckpoint());
    deepEqual(engineState(fresh), engineState(reference));
    equal(fresh.physicsBackend(), "unified-3d");
    // The same Engine then restores normally.
    restoreGameStateSnapshot(fresh, structuredClone(saved));
    equal(fresh.physicsBackend(), "legacy");
  } finally { fresh.destroy(); reference.destroy(); }
});
