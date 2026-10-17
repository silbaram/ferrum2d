import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { captureGameStateSnapshot, createEngine, restoreGameStateSnapshot, hashGameStateSnapshot, parseGameStateSnapshot, stringifyGameStateSnapshot } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry } from "@ferrum2d/ferrum-web/authoring";

const original = { fetch: globalThis.fetch, raf: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
const events = [];
let tick, time = 0, engine;
const input = { w: false, a: false, s: false, d: false, space: false, enter: false, mouseLeft: false, mouseX: 0, mouseY: 0 };
const components = (layer, body = "static") => ({ visual: { kind: "sprite", texture: 1, width: 16, height: 16 }, collider: { type: "aabb", halfWidth: 8, halfHeight: 8, isTrigger: layer !== "player" }, layer, body: { type: body, heightSpan: { floorId: 0, elevation: 0, height: 1 } } });
const costs = Array(25).fill(1); costs[12] = 0;
const document = {
  format: "ferrum2d.consumer.scene-authoring", version: 1,
  gameplay: { primaryActor: "player", interactionInputActionId: 91 },
  navigation: { columns: 5, rows: 5, cellWidth: 24, cellHeight: 24, costs },
  variables: [{ name: "shells", scope: "scene", type: "integer", default: 0 }],
  ids: { actions: { discover: 17 }, items: { shell: 2 } },
  sceneComposition: { initialFragment: "island", prefabs: {
    player: { props: { components: components("player", "kinematic"), behaviorRecipes: ["collector"] } },
    site: { props: { components: components("enemy"), behaviorRecipes: ["site"] } },
    shell: { props: { components: components("pickup"), behaviorRecipes: ["shell"] } },
  }, fragments: { island: { instances: [
    { id: "player", prefab: "player", x: 12, y: 60 },
    { id: "site", prefab: "site", x: 36, y: 60 },
    { id: "shell", prefab: "shell", x: 60, y: 84 },
  ] } } },
  behaviorRecipes: { entities: {
    collector: { recipes: [{ kind: "collisionPickup", target: "other" }, { kind: "incrementVariable", variable: "shells", amount: 1, when: { type: "gameplayEvent", event: "pickupCollected", item: "shell" } }] },
    site: { recipes: [{ kind: "interaction", action: "discover", radius: 30, once: false }] },
    shell: { recipes: [{ kind: "pickup", item: "shell", count: 3, despawn: true }] },
  } },
};
const cases = [];
try {
  globalThis.fetch = async (url, options) => String(url).startsWith("file:")
    ? new Response(await readFile(new URL(url)), { headers: { "Content-Type": "application/wasm" } }) : original.fetch(url, options);
  globalThis.requestAnimationFrame = fn => (tick = fn, 1);
  globalThis.cancelAnimationFrame = () => {};
  engine = await createEngine(frame => events.push(...structuredClone(frame.gameplayEvents)), () => input);
  const live = applyDataSceneAuthoringDocument(engine, document);
  assert(live.behaviorApplyResult.results.every(Boolean));
  assert.equal(engine.dataSceneState(), "playing");
  const query = { fromX: 12, fromY: 60, toX: 108, toY: 60, heightSpan: { floorId: 0, elevation: 0, height: 1 } };
  const path = () => engine.queryTilemapNavigationPath(query)?.points;
  const requirePath = () => {
    const points = path();
    assert(points && points.length > 0, "A successful route must contain waypoints");
    assert(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    assert.deepEqual(points.at(-1), { x: query.toX, y: query.toY, heightSpan: query.heightSpan });
    return points;
  };
  const assertInteraction = (actor, site) => {
    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event.kind, "interaction");
    assert.equal(event.tokenId, 17);
    assert.equal(event.actorId, actor.entityId);
    assert.equal(event.actorGeneration, actor.entityGeneration);
    assert.equal(event.sourceId, site.entityId);
    assert.equal(event.sourceGeneration, site.entityGeneration);
    events.length = 0;
  };
  assert(requirePath().some(point => point.y !== 60));
  assert(engine.setDataSceneNavigationCost(2, 2, 1));
  assert(requirePath().every(point => point.y === 60));
  assert(engine.setDataSceneNavigationCost(2, 2, 20));
  const costlyPath = structuredClone(requirePath());
  assert(costlyPath.some(point => point.y !== 60));
  const waypoint = engine.queryTilemapNavigationWaypoint(query);
  assert(waypoint);
  assert.deepEqual({ x: waypoint.x, y: waypoint.y, heightSpan: waypoint.heightSpan }, costlyPath[0]);
  assert.equal(waypoint.distance, Math.hypot(waypoint.x - query.fromX, waypoint.y - query.fromY));
  assert.equal(engine.setDataSceneNavigationCost(2, 2, 20), false);
  assert.equal(engine.setDataSceneNavigationCost(5, 5, 1), false);
  for (const coordinate of ["fromX", "fromY", "toX", "toY"]) {
    for (const value of [NaN, Infinity, -Infinity]) {
      const invalidQuery = { ...query, [coordinate]: value };
      assert.equal(engine.queryTilemapNavigationPath(invalidQuery), undefined);
      assert.equal(engine.queryTilemapNavigationWaypoint(invalidQuery), undefined);
    }
  }
  assert.deepEqual(requirePath(), costlyPath);
  cases.push("nonempty navigation paths, exact waypoint, cost edits and nonfinite query rejection");

  assert(engine.setDataSceneGroundYScale(0.6));
  assert.equal(engine.setShooterTilemapNavigationCost(0, 1, 1, 2), false);
  assert.equal(engine.dataSceneState(), "playing");
  assert(engine.gameplayEntityExists(live.entityHandles.player));
  assert.deepEqual(requirePath(), costlyPath);
  cases.push("rejected Shooter setter preserves Data Scene and exact navigation path");

  assert(engine.setInputActionBinding(91, 0, { control: "space", activation: "pressed" }));
  live.variables.set("shells", 7);
  assert(engine.pauseDataScene());
  const preservedState = () => ({
    state: engine.dataSceneState(), entities: engine.entityCount(), shells: live.variables.get("shells"),
    actor: engine.getPhysicsEntity(live.entityHandles.player), path: structuredClone(requirePath()),
    centerPath: engine.queryTilemapNavigationPath({ ...query, toX: 60, toY: 60 })?.points,
  });
  const beforeInvalid = preservedState();
  assert(beforeInvalid.centerPath?.length, "Cost 20 keeps the center accessible, unlike the original blocked cell");
  const invalidDocuments = [
    ["actor", candidate => { candidate.gameplay.primaryActor = "missing"; }, /applied fragment/],
    ["grid", candidate => { candidate.navigation.costs.pop(); }, /exactly columns/],
    ["executor", candidate => { candidate.behaviorRecipes.entities.site.recipes = [{ kind: "chase", speed: 20 }]; }, /no generic Data Scene executor/],
    ["health", candidate => { candidate.behaviorRecipes.entities.site.recipes = [{ kind: "health", max: 2, start: 1 }]; }, /must equal max/],
    ["damage", candidate => { candidate.behaviorRecipes.entities.site.recipes = [{ kind: "damage", amount: 1, cooldownSeconds: 0.5 }]; }, /damage cooldown storage/],
    ["timer action", candidate => { candidate.behaviorRecipes.entities.site.recipes = [{ kind: "timerTrigger", timer: "probe", timerId: 5, action: "discover", seconds: 0.1 }]; }, /timer actions have no generic Data Scene executor/],
  ];
  for (const [label, invalidate, diagnostic] of invalidDocuments) {
    const invalid = structuredClone(document);
    invalidate(invalid);
    assert.throws(() => applyDataSceneAuthoringDocument(engine, invalid), diagnostic, label);
    assert.deepEqual(preservedState(), beforeInvalid, label + " must preserve the existing paused scene");
    assert.equal(engine.setDataSceneNavigationCost(2, 2, 20), false, label + " must preserve the exact cost");
    for (const handle of Object.values(live.entityHandles)) assert(engine.gameplayEntityExists(handle), label);
  }
  cases.push("actor/grid/executor/health/damage/timer rejection preserves paused state, variables, cost, paths and handles");

  assert(engine.resumeDataScene());
  live.variables.set("shells", 0);
  engine.start(); tick(time);
  const step = (count = 1) => { for (let i = 0; i < count; i++) tick(time += 17); };
  step(); assert.equal(events.length, 0);
  input.space = true; step(); assertInteraction(live.entityHandles.player, live.entityHandles.site);
  step(5); assert.equal(events.length, 0);
  input.space = false; step(); assert.equal(events.length, 0);
  assert(engine.pauseDataScene()); input.space = true; step();
  assert.equal(events.length, 0);
  assert(engine.resumeDataScene()); step(); assert.equal(events.length, 0);
  input.space = false; step(); input.space = true; step();
  assertInteraction(live.entityHandles.player, live.entityHandles.site);
  input.space = false; step(); assert.equal(events.length, 0);
  cases.push("pressed interaction uses the preserved actor/input binding and suppresses hold and pause edges");

  assert(engine.setInputActionBinding(91, 0, { control: "space", activation: "down" }));
  engine.configureFixedTimestep({ enabled: true, stepSeconds: 0.005, maxFrameSeconds: 0.1, maxStepsPerUpdate: 8 });
  input.space = true;
  for (let frame = 0; frame < 3; frame++) {
    step(); assertInteraction(live.entityHandles.player, live.entityHandles.site);
  }
  input.space = false; step(3); assert.equal(events.length, 0);
  engine.configureFixedTimestep(false);
  assert(engine.setInputActionBinding(91, 0, { control: "space", activation: "pressed" }));
  cases.push("down interaction repeats once per output frame across fixed substeps and stops on release");

  assert(engine.setPhysicsBodyPosition(live.entityHandles.player, 60, 84));
  assert(engine.queryAabbBodies({ x: 60, y: 84, halfWidth: 8, halfHeight: 8, queryMaskBits: 16 }).some(hit => hit.entityId === live.entityHandles.shell.entityId));
  step(60);
  assert.equal(events.length, 1);
  const [pickup] = events;
  assert.equal(pickup.kind, "pickupCollected"); assert.equal(pickup.tokenId, 2); assert.equal(pickup.payloadBits, 3);
  assert.equal(pickup.actorId, live.entityHandles.player.entityId);
  assert.equal(pickup.actorGeneration, live.entityHandles.player.entityGeneration);
  assert.equal(pickup.sourceId, live.entityHandles.shell.entityId);
  assert.equal(pickup.sourceGeneration, live.entityHandles.shell.entityGeneration);
  assert.equal(pickup.targetRemoved, true);
  assert.equal(engine.gameplayEntityExists(live.entityHandles.shell), false);
  assert.equal(live.variables.get("shells"), 1); assert.equal(engine.score(), 0);
  events.length = 0;
  cases.push("generic item pickup once, removal and variable event without collision telemetry");

  const again = applyDataSceneAuthoringDocument(engine, document);
  assert.equal(engine.gameplayEntityExists(live.entityHandles.player), false);
  assert(engine.gameplayEntityExists(again.entityHandles.shell));
  assert.equal(again.variables.get("shells"), 0);
  assert.equal(engine.setDataSceneNavigationCost(2, 2, 0), false, "Reapply reinstalls the document cost");
  input.space = true; step(); assertInteraction(again.entityHandles.player, again.entityHandles.site);
  input.space = false; step();
  assert.equal(engine.configureDataSceneGameplay({ primaryActor: live.entityHandles.player }), false);
  input.space = true; step(); assertInteraction(again.entityHandles.player, again.entityHandles.site);
  input.space = false; step(); assert.equal(events.length, 0);
  cases.push("reapply executes interactions with new generations and stale actor rejection preserves that binding");

  assert(engine.setDataSceneNavigationCost(2, 2, 20));
  const incrementalPath = structuredClone(requirePath());
  assert(engine.pauseDataScene());
  const incremental = applyDataSceneAuthoringDocument(engine, {
    format: document.format, version: document.version, variables: document.variables,
    sceneComposition: { initialFragment: "empty", prefabs: {}, fragments: { empty: { instances: [] } } },
    behaviorRecipes: { entities: {} },
  }, { activateDataScene: false });
  assert.equal(engine.dataSceneState(), "paused");
  assert.equal(engine.entityCount(), 3);
  assert(engine.gameplayEntityExists(again.entityHandles.player));
  assert.deepEqual(requirePath(), incrementalPath);
  assert.equal(engine.setDataSceneNavigationCost(2, 2, 20), false);
  assert(engine.resumeDataScene());
  input.space = true; step(); assertInteraction(again.entityHandles.player, again.entityHandles.site);
  input.space = false; step(); assert.equal(events.length, 0);
  cases.push("inactive authoring apply preserves omitted gameplay/navigation and paused lifecycle");

  incremental.variables.set("shells", 41);
  assert(engine.pauseDataScene());
  const snapshot = captureGameStateSnapshot(engine, { includeDataSceneState: true, dataSceneAuthoringDocument: document });
  assert.deepEqual(snapshot.dataScene.authoringDocument.gameplay, document.gameplay);
  assert.deepEqual(snapshot.dataScene.authoringDocument.navigation, document.navigation);
  incremental.variables.set("shells", 99);
  assert(engine.setDataSceneNavigationCost(2, 2, 1));
  const restored = restoreGameStateSnapshot(engine, snapshot);
  assert.equal(restored.dataSceneAuthoringDocumentApplied, true);
  assert.equal(restored.sceneVariablesApplied, true);
  assert.equal(restored.dataSceneVariables.get("shells"), 41);
  assert.equal(engine.dataSceneState(), "paused");
  assert.equal(engine.gameplayEntityExists(again.entityHandles.player), false);
  assert.equal(engine.setDataSceneNavigationCost(2, 2, 0), false, "Restore uses static document costs, not runtime cost edits");
  assert(requirePath().some(point => point.y !== 60));
  const restoredActorHits = engine.queryAabbBodies({ x: 12, y: 60, halfWidth: 1, halfHeight: 1, queryMaskBits: 1 });
  const restoredSiteHits = engine.queryAabbBodies({ x: 36, y: 60, halfWidth: 1, halfHeight: 1, queryMaskBits: 2 });
  assert.equal(restoredActorHits.length, 1); assert.equal(restoredSiteHits.length, 1);
  assert(engine.resumeDataScene());
  input.space = true; step(); assertInteraction(restoredActorHits[0], restoredSiteHits[0]);
  input.space = false; step(); assert.equal(events.length, 0);
  cases.push("snapshot restore reapplies gameplay/static navigation, restores variables/paused state and executes the new binding");

  const completeLive = applyDataSceneAuthoringDocument(engine, document);
  assert(engine.completeDataScene());
  assert.equal(engine.dataSceneState(), "levelComplete");
  assert.equal(engine.resumeDataScene(), false);
  assert(engine.setPhysicsBodyPosition(completeLive.entityHandles.shell, 12, 60));
  assert(engine.queryAabbBodies({ x: 12, y: 60, halfWidth: 1, halfHeight: 1, queryMaskBits: 16 }).some(hit => hit.entityId === completeLive.entityHandles.shell.entityId));
  input.space = true; step(3);
  assert.equal(events.length, 0);
  assert(engine.gameplayEntityExists(completeLive.entityHandles.shell));
  assert.equal(completeLive.variables.get("shells"), 0);
  engine.resetGame();
  assert.equal(engine.dataSceneState(), "playing");
  assert.equal(engine.entityCount(), 0); assert.equal(path(), undefined);
  for (const handle of Object.values(completeLive.entityHandles)) assert.equal(engine.gameplayEntityExists(handle), false);
  assert.equal(engine.configureDataSceneGameplay({ primaryActor: completeLive.entityHandles.player }), false);
  step(); assert.equal(events.length, 0);
  input.space = false; step();
  cases.push("complete suppresses interaction and overlapping pickup; resetGame clears entities, actor and navigation");

  applyDataSceneAuthoringDocument(engine, document);
  assert(requirePath().length > 0);
  assert.equal(engine.clearDataSceneNavigation(), true);
  assert.equal(path(), undefined);
  assert.equal(engine.clearDataSceneNavigation(), true);
  assert.equal(path(), undefined);
  assert.equal(engine.dataSceneState(), "playing");
  applyDataSceneAuthoringDocument(engine, document);
  const empty = { ...document, gameplay: {}, navigation: undefined, sceneComposition: { initialFragment: "empty", prefabs: {}, fragments: { empty: { instances: [] } } }, behaviorRecipes: { entities: {} } };
  applyDataSceneAuthoringDocument(engine, empty);
  assert.equal(path(), undefined); assert.equal(engine.entityCount(), 0);
  cases.push("clear navigation is idempotent and an empty document transition removes the grid");
  const progressDocument = structuredClone(document);
  progressDocument.behaviorRecipes.entities.site.recipes[0].once = true;
  const progressOptions = { includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: progressDocument };
  const progressLive = applyDataSceneAuthoringDocument(engine, progressDocument);
  input.space = true; step(); assertInteraction(progressLive.entityHandles.player, progressLive.entityHandles.site);
  input.space = false; step();
  assert(engine.setPhysicsBodyPosition(progressLive.entityHandles.player, 60, 84));
  step();
  assert(events.some(event => event.kind === "pickupCollected")); events.length = 0;
  assert.equal(engine.gameplayEntityExists(progressLive.entityHandles.shell), false);
  assert(engine.setDataSceneNavigationCost(2, 2, 20));
  assert(engine.pauseDataScene());
  const savedProgress = parseGameStateSnapshot(stringifyGameStateSnapshot(captureGameStateSnapshot(engine, progressOptions)));
  assert.equal(savedProgress.dataScene.version, 5);
  assert.deepEqual(savedProgress.dataScene.progress.instances, [
    { id: "player", removed: false, interactionConsumed: false, bodyEnabled: true, colliderEnabled: true },
    { id: "shell", removed: true, interactionConsumed: false },
    { id: "site", removed: false, interactionConsumed: true, bodyEnabled: true, colliderEnabled: true },
  ]);
  assert.equal(savedProgress.dataScene.progress.navigation.costs[12], 20);
  assert.throws(() => captureGameStateSnapshot(engine, { ...progressOptions, dataSceneAuthoringDocument: document }), /same authoringDocument/);
  const preservedProgress = () => ({ count: engine.entityCount(), state: engine.dataSceneState(), path: structuredClone(requirePath()), progress: captureGameStateSnapshot(engine, progressOptions).dataScene.progress });
  const progressBeforeInvalid = preservedProgress();
  for (const corrupt of [
    snap => snap.dataScene.progress.instances.push(snap.dataScene.progress.instances[0]),
    snap => snap.dataScene.progress.instances[0].id = "wrong-player",
    snap => snap.dataScene.progress.navigation.costs[0] = 65536,
    snap => snap.dataScene.progress.instances[0].interactionConsumed = true,
    snap => snap.dataScene.version = 2,
  ]) {
    const invalid = structuredClone(savedProgress); corrupt(invalid); invalid.snapshotHash = hashGameStateSnapshot(invalid);
    assert.throws(() => restoreGameStateSnapshot(engine, invalid));
    assert.deepEqual(preservedProgress(), progressBeforeInvalid);
  }
  for (const options of [
    { restoreDataSceneAuthoringDocument: false },
    { dataSceneAuthoringApplyOptions: { fragment: "island" } },
    { dataSceneAuthoringApplyOptions: { activateDataScene: false } },
  ]) {
    assert.throws(() => restoreGameStateSnapshot(engine, savedProgress, options));
    assert.deepEqual(preservedProgress(), progressBeforeInvalid);
  }
  cases.push("progress malformed IDs/flags/grid/version/options are rejected before mutation even with a recomputed hash");

  engine.destroy();
  engine = await createEngine(frame => events.push(...structuredClone(frame.gameplayEvents)), () => input);
  engine.setInputActionBinding(91, 0, { control: "space", activation: "pressed" });
  const progressRestored = restoreGameStateSnapshot(engine, savedProgress, {
    applyDataSceneCustomState: () => assert.equal(engine.dataSceneState(), "paused"),
  });
  assert.equal(progressRestored.dataSceneVariables.get("shells"), 1);
  assert.equal(engine.dataSceneState(), "paused");
  assert.equal(engine.entityCount(), 2);
  assert.equal(engine.setDataSceneNavigationCost(2, 2, 20), false);
  assert.deepEqual(captureGameStateSnapshot(engine, progressOptions).dataScene.progress, savedProgress.dataScene.progress);
  assert(engine.resumeDataScene()); engine.start(); step();
  input.space = true; step(); input.space = false; step();
  assert.equal(events.length, 0, "Consumed once interaction must not repeat after restoring to a new engine");
  assert.equal(engine.queryAabbBodies({ x: 60, y: 84, halfWidth: 1, halfHeight: 1, queryMaskBits: 16 }).length, 0);
  cases.push("JSON progress restores collected item, once interaction, variables, costs and paused state into a fresh engine");

  assert(engine.configureDataSceneNavigation({ columns: 2, rows: 1, cellWidth: 12.5, cellHeight: 8, originX: -4, originY: 7, costs: [0, 65535] }));
  const replacementSnapshot = captureGameStateSnapshot(engine, progressOptions);
  restoreGameStateSnapshot(engine, replacementSnapshot);
  assert.deepEqual(captureGameStateSnapshot(engine, progressOptions).dataScene.progress.navigation, replacementSnapshot.dataScene.progress.navigation);
  assert(engine.clearDataSceneNavigation());
  const clearedSnapshot = captureGameStateSnapshot(engine, progressOptions);
  assert.equal(clearedSnapshot.dataScene.progress.navigation, null);
  restoreGameStateSnapshot(engine, clearedSnapshot);
  assert.equal(path(), undefined);
  assert.equal(captureGameStateSnapshot(engine, progressOptions).dataScene.progress.navigation, null);
  cases.push("replacement grid dimensions/origin/cost extremes and explicit clear survive restore");

  engine.resetGame();
  assert.throws(() => captureGameStateSnapshot(engine, progressOptions), /fresh, complete authoring apply/);
  applyDataSceneAuthoringDocument(engine, progressDocument, { fragment: "island" });
  assert.throws(() => captureGameStateSnapshot(engine, progressOptions), /fresh, complete authoring apply/);
  applyDataSceneAuthoringDocument(engine, progressDocument);
  applyDataSceneAuthoringDocument(engine, empty, { activateDataScene: false });
  assert.throws(() => captureGameStateSnapshot(engine, progressOptions), /fresh, complete authoring apply/);
  cases.push("reset, custom binding options and incremental apply invalidate progress metadata");
  const specialDocument = structuredClone(document);
  specialDocument.gameplay.primaryActor = "__proto__";
  specialDocument.sceneComposition.fragments.island.instances[0].id = "__proto__";
  const special = applyDataSceneAuthoringDocument(engine, specialDocument);
  assert(Object.hasOwn(special.entityHandles, "__proto__"));
  const specialOptions = { ...progressOptions, dataSceneAuthoringDocument: specialDocument };
  const specialSnapshot = captureGameStateSnapshot(engine, specialOptions);
  restoreGameStateSnapshot(engine, specialSnapshot);
  assert.deepEqual(captureGameStateSnapshot(engine, specialOptions).dataScene.progress, specialSnapshot.dataScene.progress);
  cases.push("prototype-like authored IDs retain own handles through progress capture and restore");

  const movementDocument = structuredClone(document);
  const movementInstances = movementDocument.sceneComposition.fragments.island.instances;
  movementInstances.splice(1, 1);
  movementInstances.find(instance => instance.id === "shell").x = 108;
  movementInstances.find(instance => instance.id === "shell").y = 60;
  const wallComponents = components("wall");
  wallComponents.collider = { type: "aabb", halfWidth: 12, halfHeight: 12, isTrigger: false };
  movementDocument.sceneComposition.prefabs.wall = { props: { components: wallComponents } };
  movementInstances.push({ id: "wall", prefab: "wall", x: 60, y: 60 });
  let movementLive = applyDataSceneAuthoringDocument(engine, movementDocument);
  const actorPosition = () => {
    const actor = engine.getPhysicsEntity(movementLive.entityHandles.player);
    assert(actor); return { x: actor.x, y: actor.y };
  };
  events.length = 0;
  assert.equal(engine.dataSceneMoveStatus(), "idle");
  assert(engine.moveDataSceneActorTo({ x: 108, y: 60, speed: 120, arrivalRadius: 0 }));
  let detoured = false;
  for (let frame = 0; frame < 180 && engine.dataSceneMoveStatus() === "moving"; frame++) {
    step(); const at = actorPosition();
    detoured ||= at.y !== 60;
    assert(!(at.x > 40 && at.x < 80 && at.y > 40 && at.y < 80), "Actor AABB must not enter the wall");
  }
  assert(detoured);
  assert.equal(engine.dataSceneMoveStatus(), "arrived");
  assert.deepEqual(actorPosition(), { x: 108, y: 60 });
  assert.equal(movementLive.variables.get("shells"), 1);
  assert.equal(events.filter(event => event.kind === "pickupCollected").length, 1);
  assert.equal(engine.gameplayEntityExists(movementLive.entityHandles.shell), false);
  step(5); assert.deepEqual(actorPosition(), { x: 108, y: 60 });
  cases.push("public destination movement detours around a solid wall, arrives exactly, and collects once");

  movementLive = applyDataSceneAuthoringDocument(engine, movementDocument);
  assert(engine.moveDataSceneActorTo({ x: 108, y: 60, speed: 24 }));
  assert.equal(engine.moveDataSceneActorTo({ x: 1000, y: 60, speed: 24 }), false);
  assert.throws(() => engine.moveDataSceneActorTo({ x: NaN, y: 60, speed: 24 }), /float32/);
  assert.equal(engine.dataSceneMoveStatus(), "moving");
  assert(engine.pauseDataScene()); const pausedPosition = actorPosition(); step(10);
  assert.deepEqual(actorPosition(), pausedPosition);
  assert.equal(engine.dataSceneMoveStatus(), "moving");
  assert(engine.resumeDataScene()); step(5);
  assert.notDeepEqual(actorPosition(), pausedPosition);
  input.d = true; step(); input.d = false;
  assert.equal(engine.dataSceneMoveStatus(), "cancelled");
  assert.equal(engine.cancelDataSceneMove(), false);
  assert(engine.moveDataSceneActorTo({ x: 108, y: 60, speed: 24, cancelOnInput: false }));
  input.d = true; step(); input.d = false;
  assert.equal(engine.dataSceneMoveStatus(), "moving");
  assert(engine.cancelDataSceneMove());
  const cancelledPosition = actorPosition(); step(5);
  assert.deepEqual(actorPosition(), cancelledPosition);
  cases.push("invalid destinations preserve movement; pause, manual handoff, opt-out and cancellation preserve lifecycle");

  movementLive = applyDataSceneAuthoringDocument(engine, movementDocument);
  assert(engine.moveDataSceneActorTo({ x: 108, y: 60, speed: 240 }));
  assert(engine.setDataSceneNavigationCost(4, 2, 0)); step();
  assert.equal(engine.dataSceneMoveStatus(), "blocked");
  assert.deepEqual(actorPosition(), { x: 12, y: 60 });
  assert(engine.setDataSceneNavigationCost(4, 2, 1));
  assert(engine.setDataSceneNavigationCost(2, 2, 1));
  for (let attempt = 0; attempt < 2; attempt++) {
    assert(engine.moveDataSceneActorTo({ x: 108, y: 60, speed: 240 }));
    for (let frame = 0; frame < 60 && engine.dataSceneMoveStatus() === "moving"; frame++) step();
    assert.equal(engine.dataSceneMoveStatus(), "blocked");
    assert.deepEqual(actorPosition(), { x: 40, y: 60 });
  }
  assert(engine.moveDataSceneActorTo({ x: 12, y: 60, speed: 240 }));
  assert(engine.clearDataSceneNavigation()); step();
  assert.equal(engine.dataSceneMoveStatus(), "blocked");
  assert.deepEqual(actorPosition(), { x: 40, y: 60 });
  cases.push("grid edits and removal stop stale routes; repeated requests cannot cross a touching solid");

  movementLive = applyDataSceneAuthoringDocument(engine, movementDocument);
  assert(engine.moveDataSceneActorTo({ x: 108, y: 60, speed: 24 })); step(5);
  assert.notDeepEqual(actorPosition(), { x: 12, y: 60 });
  const movingSnapshot = captureGameStateSnapshot(engine, {
    includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: movementDocument,
  });
  restoreGameStateSnapshot(engine, parseGameStateSnapshot(stringifyGameStateSnapshot(movingSnapshot)));
  assert.equal(engine.dataSceneMoveStatus(), "idle");
  const restoredActors = engine.queryAabbBodies({ x: 12, y: 60, halfWidth: 1, halfHeight: 1, queryMaskBits: 1 });
  assert.equal(restoredActors.length, 1);
  assert(engine.moveDataSceneActorTo({ x: 108, y: 60, speed: 24 }));
  assert(engine.completeDataScene());
  assert.equal(engine.dataSceneMoveStatus(), "cancelled");
  assert.equal(engine.moveDataSceneActorTo({ x: 108, y: 60, speed: 24 }), false);
  engine.resetGame(); assert.equal(engine.dataSceneMoveStatus(), "idle");
  const staticDocument = structuredClone(movementDocument);
  staticDocument.sceneComposition.prefabs.player.props.components.body.type = "static";
  applyDataSceneAuthoringDocument(engine, staticDocument);
  assert.equal(engine.moveDataSceneActorTo({ x: 108, y: 60, speed: 24 }), false);
  assert.equal(engine.dataSceneMoveStatus(), "idle");
  cases.push("progress restore discards active route and pose; completion, reset and unsupported actor are safe");

  movementLive = applyDataSceneAuthoringDocument(engine, movementDocument);
  const cell = 2 ** -14;
  assert(engine.configureDataSceneNavigation({ columns: 3, rows: 3, cellWidth: cell, cellHeight: cell, costs: [1, 1, 1, 1, 0, 1, 1, 1, 1] }));
  assert(engine.setPhysicsBodyPosition(movementLive.entityHandles.player, 0.5 * cell, 1.5 * cell));
  assert(engine.moveDataSceneActorTo({ x: 2.5 * cell, y: 1.5 * cell, speed: cell * 4, arrivalRadius: 0, solidMaskBits: 0 }));
  for (let frame = 0; frame < 120 && engine.dataSceneMoveStatus() === "moving"; frame++) {
    step(); const at = actorPosition();
    assert(!(at.x > cell && at.x < 2 * cell && at.y > cell && at.y < 2 * cell), "Small-grid movement entered a blocked cell");
  }
  assert.equal(engine.dataSceneMoveStatus(), "arrived");
  assert.deepEqual(actorPosition(), { x: 2.5 * cell, y: 1.5 * cell });
  assert(engine.configureDataSceneNavigation({ columns: 1, rows: 1, cellWidth: 1, cellHeight: 1, costs: [1] }));
  assert(engine.setPhysicsBodyPosition(movementLive.entityHandles.player, 0, 0));
  const tinyGoal = { x: 0.00008830292063066736, y: 0.000046931803808547556 };
  assert(engine.moveDataSceneActorTo({ ...tinyGoal, speed: 1, arrivalRadius: 0, solidMaskBits: 0 })); step();
  assert.equal(engine.dataSceneMoveStatus(), "arrived");
  assert.deepEqual(actorPosition(), tinyGoal);
  const largeOrigin = 2 ** 24;
  assert(engine.configureDataSceneNavigation({ columns: 3, rows: 2, cellWidth: 2, cellHeight: 2, originX: largeOrigin, costs: [1, 1, 1, 1, 1, 0] }));
  assert(engine.setPhysicsBodyPosition(movementLive.entityHandles.player, largeOrigin, 1));
  assert(engine.moveDataSceneActorTo({ x: largeOrigin, y: 3, speed: 2, arrivalRadius: 0, solidMaskBits: 0 }));
  for (const goal of [{ x: largeOrigin + 2, y: 3 }, { x: largeOrigin + 4, y: 1 }]) {
    assert.equal(engine.moveDataSceneActorTo({ ...goal, speed: 2, arrivalRadius: 0, solidMaskBits: 0 }), false);
  }
  step(70);
  assert.equal(engine.dataSceneMoveStatus(), "arrived");
  assert.deepEqual(actorPosition(), { x: largeOrigin, y: 3 });
  assert(engine.configureDataSceneNavigation({ columns: 1, rows: 1, cellWidth: 200000000, cellHeight: 1, originX: 1, costs: [1] }));
  assert(engine.setPhysicsBodyPosition(movementLive.entityHandles.player, 100000000, 0.5));
  assert(engine.moveDataSceneActorTo({ x: 1, y: 0.5, speed: 1e10, arrivalRadius: 0, solidMaskBits: 0 })); step();
  assert(actorPosition().x >= 1, "Rounded displacement must not pass the waypoint or grid boundary");
  step(); assert.equal(engine.dataSceneMoveStatus(), "arrived");
  assert.deepEqual(actorPosition(), { x: 1, y: 0.5 });
  cases.push("float32 precision preserves tiny-grid corners, finishes tiny moves, bounds large displacements and rejects rounded centers without replacing a route");
  const animatedDocument = structuredClone(movementDocument);
  animatedDocument.sceneComposition.prefabs.player.props.components.visual.animationSet = {
    clips: Array.from({ length: 8 }, (_, id) => ({ id, fps: 4, loop: true, frames: [
      { u0: 0, v0: 0, u1: 0.5, v1: 1 }, { u0: 0.5, v0: 0, u1: 1, v1: 1 },
    ] })), initialClip: 0,
  };
  const movementAnimation = {
    idle: { up: { clip: 0 }, down: { clip: 1 }, left: { clip: 2, flipX: true }, right: { clip: 2 } },
    walk: { up: { clip: 4 }, down: { clip: 5 }, left: { clip: 7, flipX: true }, right: { clip: 7 } },
  };
  movementLive = applyDataSceneAuthoringDocument(engine, animatedDocument);
  const animationState = () => {
    const value = engine.dataSceneSpriteAnimationState(movementLive.entityHandles.player);
    assert(value); return value;
  };
  assert(engine.configureDataSceneMovementAnimation(movementAnimation));
  assert.equal(animationState().clip, 1);
  assert(engine.moveDataSceneActorTo({ x: 36, y: 60, speed: 24, arrivalRadius: 0 })); step(2);
  assert.equal(animationState().clip, 7);
  assert(animationState().elapsedSeconds > 0);
  assert(engine.pauseDataScene()); const pausedAnimation = animationState(); step(5);
  assert.deepEqual(animationState(), pausedAnimation);
  assert(engine.resumeDataScene());
  for (let frame = 0; frame < 80 && engine.dataSceneMoveStatus() === "moving"; frame++) step();
  assert.equal(engine.dataSceneMoveStatus(), "arrived");
  assert.equal(animationState().clip, 2); assert.equal(animationState().flipX, false);
  assert(engine.moveDataSceneActorTo({ x: 12, y: 60, speed: 24, arrivalRadius: 0 })); step(2);
  assert.equal(animationState().clip, 7); assert.equal(animationState().flipX, true);
  const leftElapsed = animationState().elapsedSeconds;
  assert(engine.moveDataSceneActorTo({ x: 108, y: 60, speed: 24, arrivalRadius: 0 })); step();
  assert.equal(animationState().clip, 7); assert.equal(animationState().flipX, false);
  assert(animationState().elapsedSeconds > leftElapsed, "Flipping a shared clip must not restart it");
  cases.push("movement animation selects idle/walk and facing, preserves shared-clip time and freezes while paused");

  const invalidAnimation = structuredClone(movementAnimation); invalidAnimation.walk.right.clip = 65535;
  const beforeInvalidAnimation = animationState();
  assert.equal(engine.configureDataSceneMovementAnimation(invalidAnimation), false);
  assert.deepEqual(animationState(), beforeInvalidAnimation);
  assert(engine.cancelDataSceneMove());
  assert(animationState().clip < 4, "Invalid configuration must preserve binding for the next idle transition");
  assert(engine.moveDataSceneActorTo({ x: 108, y: 60, speed: 24, arrivalRadius: 0 })); step(2);
  assert(animationState().clip >= 4);
  assert.equal(engine.updateDataSceneSpriteAnimations([
    { entity: movementLive.entityHandles.player, clip: 0 },
    { entity: movementLive.entityHandles.wall, clip: 0 },
  ]), false);
  assert(engine.cancelDataSceneMove());
  assert(animationState().clip < 4, "Failed manual batch must preserve binding for the next idle transition");
  assert(engine.moveDataSceneActorTo({ x: 108, y: 60, speed: 24, arrivalRadius: 0 })); step(2);
  assert(animationState().clip >= 4);
  assert(engine.updateDataSceneSpriteAnimations([{ entity: movementLive.entityHandles.player, clip: 0, paused: true }]));
  step(5); assert.equal(animationState().clip, 0); assert.equal(animationState().paused, true);
  assert(engine.configureDataSceneMovementAnimation(movementAnimation)); step();
  assert(animationState().clip >= 4); assert.equal(animationState().paused, false);
  const beforeDisable = animationState();
  assert(engine.configureDataSceneMovementAnimation(false));
  assert.deepEqual(animationState(), beforeDisable);
  assert(engine.cancelDataSceneMove());
  assert.equal(animationState().clip, beforeDisable.clip);
  cases.push("invalid animation settings and batches preserve binding; explicit playback and disabling hand control to the game");

  assert(engine.configureDataSceneMovementAnimation(movementAnimation));
  assert(engine.moveDataSceneActorTo({ x: 108, y: 60, speed: 24 })); step(2);
  assert(engine.pauseDataScene());
  const expectedAnimationState = animationState();
  const animationSnapshot = captureGameStateSnapshot(engine, {
    includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: animatedDocument,
  });
  restoreGameStateSnapshot(engine, animationSnapshot);
  assert.equal(engine.dataSceneState(), "paused");
  const restoredAnimationActor = engine.queryAabbBodies({ x: 12, y: 60, halfWidth: 1, halfHeight: 1, queryMaskBits: 1 })[0];
  assert(restoredAnimationActor);
  assert.deepEqual(engine.dataSceneSpriteAnimationState(restoredAnimationActor), expectedAnimationState);
  assert(engine.resumeDataScene());
  assert(engine.moveDataSceneActorTo({ x: 36, y: 60, speed: 24 })); step(2);
  assert.equal(engine.dataSceneSpriteAnimationState(restoredAnimationActor).clip, 7, "Snapshot restores native movement animation binding");
  step();
  assert.equal(engine.dataSceneSpriteAnimationState(restoredAnimationActor).clip, 7);
  assert(engine.completeDataScene());
  assert.equal(engine.dataSceneSpriteAnimationState(restoredAnimationActor).clip, 2);
  cases.push("restore preserves authored clip playback and native movement binding with fresh handles; complete selects idle immediately");
  const doorDocument = structuredClone(document);
  doorDocument.navigation = { columns: 3, rows: 1, cellWidth: 24, cellHeight: 24, costs: [1, 9, 1],
    obstacles: [{ instanceId: "site", cells: [{ column: 1, row: 0 }] }] };
  doorDocument.sceneComposition.fragments.island.instances = [
    { id: "player", prefab: "player", x: 12, y: 12 }, { id: "site", prefab: "site", x: 36, y: 12 },
  ];
  doorDocument.sceneComposition.prefabs.site.props.components.collider.isTrigger = false;
  const doorOptions = { includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: doorDocument };
  const doorQuery = { fromX: 12, fromY: 12, toX: 60, toY: 12 };
  const doorPath = () => engine.queryTilemapNavigationPath(doorQuery);
  input.space = false;
  const boundaryDoor = applyDataSceneAuthoringDocument(engine, doorDocument);
  boundaryDoor.variables.set("shells", 7);
  assert(engine.pauseDataScene());
  const preservedDoor = () => ({
    state: engine.dataSceneState(), count: engine.entityCount(),
    player: engine.getPhysicsEntity(boundaryDoor.entityHandles.player),
    door: engine.getPhysicsEntity(boundaryDoor.entityHandles.site),
    snapshot: captureGameStateSnapshot(engine, doorOptions),
    path: engine.queryTilemapNavigationPath({ ...doorQuery, toX: 12, toY: 12 })?.points,
  });
  const beforeBoundary = preservedDoor();
  for (const cells of [new Array(1), [, { column: 1, row: 0 }], [{ column: 1, row: 0 }, ,]]) {
    const sparse = structuredClone(doorDocument);
    sparse.navigation.obstacles[0].cells = cells;
    assert.throws(() => applyDataSceneAuthoringDocument(engine, sparse), /cells\.\d.*must be an object/);
    assert.deepEqual(preservedDoor(), beforeBoundary);
  }
  const sparseObstacles = structuredClone(doorDocument);
  sparseObstacles.navigation.obstacles = new Array(1);
  assert.throws(() => applyDataSceneAuthoringDocument(engine, sparseObstacles), /obstacles\.0.*must be an object/);
  assert.deepEqual(preservedDoor(), beforeBoundary);
  const colliderVariant = structuredClone(doorDocument);
  const visualDoor = structuredClone(colliderVariant.sceneComposition.prefabs.site.props.components);
  delete visualDoor.body;
  visualDoor.collider = { type: "none" };
  colliderVariant.sceneComposition.fragments.visual = { instances: [
    colliderVariant.sceneComposition.fragments.island.instances[0],
    { id: "site", prefab: "site", x: 36, y: 12, props: { components: visualDoor } },
  ] };
  assert.throws(() => applyDataSceneAuthoringDocument(engine, colliderVariant, { fragment: "visual" }), /requires an inline collider/);
  assert.deepEqual(preservedDoor(), beforeBoundary);
  cases.push("sparse obstacle arrays and selected-fragment collider rejection preserve paused state, handles, variables, grid and progress context");

  const alternateDoor = structuredClone(doorDocument);
  alternateDoor.sceneComposition.initialFragment = "empty";
  alternateDoor.sceneComposition.fragments.empty = { instances: [] };
  const selectedDoor = applyDataSceneAuthoringDocument(engine, alternateDoor, { fragment: "island" });
  assert.equal(engine.entityCount(), 2);
  assert(engine.getPhysicsEntity(selectedDoor.entityHandles.site));
  assert.equal(doorPath(), undefined);
  assert(engine.setPhysicsColliderEnabled(selectedDoor.entityHandles.site, false));
  assert(doorPath()?.points.length > 0);
  cases.push("explicit alternate fragment validates and binds its door even when the initial fragment is empty");

  for (const mode of ["body", "collider", "removed"]) {
    const liveDoor = applyDataSceneAuthoringDocument(engine, doorDocument).entityHandles.site;
    assert.equal(doorPath(), undefined, "Closed solid door must block the one-cell-wide corridor");
    const closed = captureGameStateSnapshot(engine, doorOptions);
    assert.equal(closed.dataScene.progress.navigation.costs[1], 9, "Save terrain cost, not the temporary blocked cost");
    const open = () => mode === "body" ? engine.setPhysicsBodyEnabled(liveDoor, false)
      : mode === "collider" ? engine.setPhysicsColliderEnabled(liveDoor, false) : engine.despawnPhysicsEntity(liveDoor);
    assert(open());
    assert(doorPath()?.points.length > 0, "Opening a bound door needs no setDataSceneNavigationCost call");
    assert(engine.moveDataSceneActorTo({ x: 60, y: 12, speed: 60, arrivalRadius: 0 }));
    engine.start(); step(80);
    assert.equal(engine.dataSceneMoveStatus(), "arrived", "Native sweep must cross disabled/removed door");
    assert(engine.pauseDataScene());
    const opened = parseGameStateSnapshot(stringifyGameStateSnapshot(captureGameStateSnapshot(engine, doorOptions)));
    const site = opened.dataScene.progress.instances.find(instance => instance.id === "site");
    assert.equal(site.removed, mode === "removed");
    if (mode !== "removed") {
      assert.equal(site.bodyEnabled, mode !== "body");
      assert.equal(site.colliderEnabled, mode !== "collider");
    }
    for (const corrupt of [
      snap => snap.dataScene.progress.instances[0].bodyEnabled = "false",
      snap => snap.dataScene.progress.navigation.obstacles[0].instanceId = "missing",
      snap => snap.dataScene.progress.navigation.obstacles[0].cells[0].column = 3,
      snap => snap.dataScene.version = 3,
    ]) {
      const invalid = structuredClone(opened); corrupt(invalid); invalid.snapshotHash = hashGameStateSnapshot(invalid);
      assert.throws(() => restoreGameStateSnapshot(engine, invalid));
      assert.equal(engine.dataSceneState(), "paused");
      assert.deepEqual(captureGameStateSnapshot(engine, doorOptions).dataScene.progress, opened.dataScene.progress);
    }
    engine.destroy();
    engine = await createEngine(frame => events.push(...structuredClone(frame.gameplayEvents)), () => input);
    const registry = createSceneInstanceHandleRegistry();
    restoreGameStateSnapshot(engine, opened, { dataSceneAuthoringApplyOptions: { instanceHandleRegistry: registry } });
    assert.equal(engine.dataSceneState(), "paused");
    assert(doorPath()?.points.length > 0);
    assert.deepEqual(captureGameStateSnapshot(engine, doorOptions).dataScene.progress, opened.dataScene.progress);
    const restoredDoor = registry.get("site");
    if (mode !== "removed") {
      assert.equal(engine.getPhysicsEntity(restoredDoor).bodyEnabled, mode !== "body");
      assert.equal(engine.getPhysicsEntity(restoredDoor).colliderEnabled, mode !== "collider");
      assert(mode === "body" ? engine.setPhysicsBodyEnabled(restoredDoor, true) : engine.setPhysicsColliderEnabled(restoredDoor, true));
      assert.equal(doorPath(), undefined, "Reclosing restores the obstacle after fresh-engine restore");
    } else assert.equal(engine.gameplayEntityExists(restoredDoor), false);
    assert(engine.resumeDataScene());
    restoreGameStateSnapshot(engine, closed);
    assert.equal(doorPath(), undefined, "Closed progress restores both flags and obstacle bindings");
    cases.push(`bound door ${mode}: automatic path/sweep, base costs, paused JSON fresh-engine restore and malformed-state preservation`);
  }
  const colliderOnlyDocument = structuredClone(doorDocument);
  delete colliderOnlyDocument.sceneComposition.prefabs.site.props.components.body;
  const colliderOnlyOptions = { ...doorOptions, dataSceneAuthoringDocument: colliderOnlyDocument };
  const colliderOnlyDoor = applyDataSceneAuthoringDocument(engine, colliderOnlyDocument).entityHandles.site;
  assert.equal(engine.getPhysicsEntity(colliderOnlyDoor), undefined);
  assert.equal(doorPath(), undefined);
  assert(engine.setPhysicsColliderEnabled(colliderOnlyDoor, false));
  assert(doorPath()?.points.length > 0);
  assert(engine.pauseDataScene());
  const colliderOnlySnapshot = parseGameStateSnapshot(stringifyGameStateSnapshot(captureGameStateSnapshot(engine, colliderOnlyOptions)));
  const colliderOnlyState = colliderOnlySnapshot.dataScene.progress.instances.find(instance => instance.id === "site");
  assert.equal(colliderOnlyState.bodyEnabled, undefined);
  assert.equal(colliderOnlyState.colliderEnabled, false);
  engine.destroy();
  engine = await createEngine(frame => events.push(...structuredClone(frame.gameplayEvents)), () => input);
  const colliderOnlyRegistry = createSceneInstanceHandleRegistry();
  restoreGameStateSnapshot(engine, colliderOnlySnapshot, { dataSceneAuthoringApplyOptions: { instanceHandleRegistry: colliderOnlyRegistry } });
  assert.equal(engine.dataSceneState(), "paused");
  assert(doorPath()?.points.length > 0);
  assert.deepEqual(captureGameStateSnapshot(engine, colliderOnlyOptions).dataScene.progress, colliderOnlySnapshot.dataScene.progress);
  const restoredColliderOnly = colliderOnlyRegistry.get("site");
  assert.equal(engine.getPhysicsEntity(restoredColliderOnly), undefined);
  assert(engine.setPhysicsColliderEnabled(restoredColliderOnly, true));
  assert.equal(doorPath(), undefined);
  assert.equal(engine.setPhysicsColliderEnabled({ ...restoredColliderOnly, entityGeneration: restoredColliderOnly.entityGeneration + 1 }, false), false);
  assert.equal(doorPath(), undefined);
  cases.push("collider-only door toggle returns true, saves without a body flag, restores to a fresh engine and rejects stale handles");
  const legacyDoor = applyDataSceneAuthoringDocument(engine, doorDocument).entityHandles.site;
  assert(engine.setPhysicsBodyEnabled(legacyDoor, false));
  const legacyV3 = captureGameStateSnapshot(engine, doorOptions);
  legacyV3.dataScene.version = 3;
  for (const instance of legacyV3.dataScene.progress.instances) { delete instance.bodyEnabled; delete instance.colliderEnabled; }
  delete legacyV3.dataScene.progress.navigation.obstacles;
  // A real v3 authoring document has no obstacle field; keep its independent grid contract.
  delete legacyV3.dataScene.authoringDocument.navigation.obstacles;
  legacyV3.dataScene.progress.navigation.costs[1] = 0;
  legacyV3.snapshotHash = hashGameStateSnapshot(legacyV3);
  const legacyParsed = parseGameStateSnapshot(stringifyGameStateSnapshot(legacyV3));
  assert.equal(legacyParsed.snapshotHash, legacyV3.snapshotHash);
  const registry = createSceneInstanceHandleRegistry();
  restoreGameStateSnapshot(engine, legacyParsed, { dataSceneAuthoringApplyOptions: { instanceHandleRegistry: registry } });
  assert.equal(engine.getPhysicsEntity(registry.get("site")).bodyEnabled, true);
  assert.equal(doorPath(), undefined);
  cases.push("legacy v3 hash and independent grid restore retain authored physics defaults");

  const automaticDoorDocument = structuredClone(doorDocument);
  automaticDoorDocument.navigation.obstacles = [{ instanceId: "site", collider: true }];
  const automaticOptions = { ...doorOptions, dataSceneAuthoringDocument: automaticDoorDocument };
  let autoLive = applyDataSceneAuthoringDocument(engine, automaticDoorDocument);
  assert.equal(doorPath(), undefined);
  assert(engine.setPhysicsBodyPosition(autoLive.entityHandles.site, 200, 12));
  assert(doorPath()?.pointCount > 0);
  assert(engine.setPhysicsBodyPosition(autoLive.entityHandles.site, 36, 12));
  assert.equal(doorPath(), undefined);
  assert(engine.setPhysicsBodyEnabled(autoLive.entityHandles.site, false));
  assert(engine.pauseDataScene());
  const autoSaved = parseGameStateSnapshot(stringifyGameStateSnapshot(captureGameStateSnapshot(engine, automaticOptions)));
  assert.deepEqual(autoSaved.dataScene.progress.navigation.obstacles, [{ instanceId: "site", collider: true }]);
  engine.destroy(); engine = await createEngine(frame => events.push(...structuredClone(frame.gameplayEvents)), () => input);
  const autoRegistry = createSceneInstanceHandleRegistry();
  restoreGameStateSnapshot(engine, autoSaved, { dataSceneAuthoringApplyOptions: { instanceHandleRegistry: autoRegistry } });
  assert.equal(engine.dataSceneState(), "paused"); assert(doorPath()?.pointCount > 0);
  assert(engine.setPhysicsBodyEnabled(autoRegistry.require("site"), true));
  assert.equal(doorPath(), undefined);
  cases.push("automatic collider coverage follows native position and restores its source plus disabled-body overlay in a fresh engine");

  const playbackDocument = structuredClone(animatedDocument);
  playbackDocument.sceneComposition.prefabs.player.props.components.visual.animationSet.clips[7].loop = false;
  const playbackOptions = { includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: playbackDocument };
  for (const finished of [false, true]) {
    const applied = applyDataSceneAuthoringDocument(engine, playbackDocument);
    const actor = applied.entityHandles.player;
    assert(engine.updateDataSceneSpriteAnimations([{ entity: actor, clip: 7, flipX: true, flipY: true }]));
    engine.start(); step(finished ? 40 : 2);
    assert(engine.updateDataSceneSpriteAnimations([{ entity: actor, paused: true }]));
    assert(engine.pauseDataScene());
    const expected = engine.dataSceneSpriteAnimationState(actor);
    assert.equal(expected.finished, finished);
    const saved = parseGameStateSnapshot(stringifyGameStateSnapshot(captureGameStateSnapshot(engine, playbackOptions)));
    for (const mutate of [
      value => value.dataScene.progress.instances.find(item => item.id === "player").animation.clip = 9999,
      value => value.dataScene.progress.instances.find(item => item.id === "player").animation.elapsedSeconds = -1,
      value => value.dataScene.progress.instances.find(item => item.id === "player").animation.paused = 1,
      value => value.dataScene.version = 4,
    ]) {
      const invalid = structuredClone(saved); mutate(invalid); invalid.snapshotHash = hashGameStateSnapshot(invalid);
      assert.throws(() => restoreGameStateSnapshot(engine, invalid));
      assert.deepEqual(engine.dataSceneSpriteAnimationState(actor), expected);
      assert.equal(engine.dataSceneState(), "paused");
    }
    engine.destroy(); engine = await createEngine(frame => events.push(...structuredClone(frame.gameplayEvents)), () => input);
    const registry = createSceneInstanceHandleRegistry();
    restoreGameStateSnapshot(engine, saved, { dataSceneAuthoringApplyOptions: { instanceHandleRegistry: registry } });
    assert.deepEqual(engine.dataSceneSpriteAnimationState(registry.require("player")), expected);
    assert(engine.resumeDataScene()); engine.start(); step(2);
    assert.deepEqual(engine.dataSceneSpriteAnimationState(registry.require("player")), expected);
    cases.push(`atlas ${finished ? "finished" : "fractional"} playback JSON restores to fresh engine with pause/flips and atomic corruption rejection`);
  }

  // Beacon lab: authored dynamics retain the obstacle/save identity without a raw-body proxy.
  engine.destroy(); engine = await createEngine();
  const dynamicDocument = {
    format: "ferrum2d.consumer.scene-authoring", version: 1,
    sceneComposition: { initialFragment: "lab", prefabs: { box: { props: { components: {
      visual: { kind: "sprite", texture: 23, width: 40, height: 40, originY: 1 },
      collider: { type: "aabb", halfWidth: 8, halfHeight: 8, isTrigger: false }, layer: "wall",
      body: { type: "dynamic" },
    } } } }, fragments: { lab: { instances: [{ id: "box", prefab: "box", x: 30, y: 10 }] } } },
    behaviorRecipes: { entities: {} },
    navigation: { columns: 3, rows: 1, cellWidth: 20, cellHeight: 20, costs: [1, 7, 1], obstacles: [{ instanceId: "box", collider: true }] },
  };
  const geometries = [
    { type: "aabb", halfWidth: 8, halfHeight: 8 },
    { type: "circle", radius: 8 },
    { type: "capsule", startX: -4, startY: 0, endX: 4, endY: 0, radius: 3 },
    { type: "orientedBox", halfWidth: 8, halfHeight: 8 },
    { type: "convexPolygon", vertices: [{ x: -8, y: -8 }, { x: 8, y: -8 }, { x: 8, y: 8 }, { x: -8, y: 8 }] },
  ];
  for (const collider of geometries) {
    const shapeDocument = structuredClone(dynamicDocument);
    shapeDocument.sceneComposition.prefabs.box.props.components.collider = collider;
    for (const scale of [1, 2]) {
      shapeDocument.sceneComposition.fragments.lab.instances[0].scale = scale;
      const box = applyDataSceneAuthoringDocument(engine, shapeDocument).entityHandles.box;
      const body = engine.getPhysicsEntity(box);
      assert.equal(body.bodyType, "dynamic"); assert.equal(body.mass, 1);
      assert.equal(body.gravityScale, 1); assert.equal(body.linearDamping, 0);
      assert(body.inertia > 0 && Number.isFinite(body.inertia));
      const baseInertia = body.inertia / (scale * scale);
      if (collider.type === "aabb" || collider.type === "orientedBox" || collider.type === "convexPolygon") assert(Math.abs(baseInertia - 128 / 3) < 0.001);
      if (collider.type === "circle") assert(Math.abs(baseInertia - 32) < 0.001);
    }
  }
  cases.push("authored dynamic AABB/circle/capsule/oriented box/polygon use native inertia and explicit mass independent of scale");
  const box = applyDataSceneAuthoringDocument(engine, dynamicDocument).entityHandles.box;
  const labPath = () => engine.queryTilemapNavigationPath({ fromX: 10, fromY: 10, toX: 50, toY: 10 });
  const labRay = () => engine.raycastBodies({ originX: 0, originY: 10, directionX: 1, directionY: 0, maxDistance: 70, queryMaskBits: 8 });
  assert.equal(labPath(), undefined); assert.equal(labRay().length, 1);
  engine.configureAutoRigidBodyStep({ gravityX: 0, gravityY: 0 });
  assert(engine.setPhysicsBodyVelocity(box, 60, 0));
  const dynamicStartTime = time;
  engine.start(); tick(time); step(60);
  assert(Math.abs(engine.getPhysicsEntity(box).x - (30 + 60 * (time - dynamicStartTime) / 1000)) < 0.01);
  assert(labPath());
  engine.pauseDataScene(); const pausedX = engine.getPhysicsEntity(box).x;
  step(60); assert.equal(engine.getPhysicsEntity(box).x, pausedX);
  engine.stop(); engine.configureAutoRigidBodyStep(false);
  cases.push("authored dynamic auto step moves once per frame, updates its collider obstacle and freezes on pause");
  assert(engine.setPhysicsBodyPosition(box, 30, 10));
  assert(engine.setPhysicsBodyEnabled(box, false)); assert.equal(labRay().length, 0);
  assert.equal(engine.getPhysicsEntity(box).colliderEnabled, true); assert(labPath());
  const savedDynamic = parseGameStateSnapshot(stringifyGameStateSnapshot(captureGameStateSnapshot(engine, {
    includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: dynamicDocument,
  })));
  assert.deepEqual(savedDynamic.dataScene.progress.navigation.obstacles, [{ instanceId: "box", collider: true }]);
  engine.destroy(); engine = await createEngine();
  const dynamicRegistry = createSceneInstanceHandleRegistry();
  restoreGameStateSnapshot(engine, savedDynamic, { dataSceneAuthoringApplyOptions: { instanceHandleRegistry: dynamicRegistry } });
  const restoredBox = dynamicRegistry.require("box");
  assert.equal(engine.getPhysicsEntity(restoredBox).bodyType, "dynamic");
  assert.equal(engine.getPhysicsEntity(restoredBox).bodyEnabled, false);
  assert.equal(labRay().length, 0); assert(labPath());
  assert(engine.setPhysicsBodyEnabled(restoredBox, true)); assert.equal(labRay().length, 1);
  assert.equal(labPath(), undefined);
  cases.push("authored dynamic identity, disabled-body raycast exclusion and collider obstacle flags survive JSON/fresh-engine progress restore");

  const report = { format: "ferrum2d.data-scene-gameplay.consumer-smoke", version: 1, status: "passed", cases };
  await writeFile(new URL("./result.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  engine?.destroy(); globalThis.fetch = original.fetch;
  globalThis.requestAnimationFrame = original.raf; globalThis.cancelAnimationFrame = original.cancel;
}
