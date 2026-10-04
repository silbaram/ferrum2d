import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { captureGameStateSnapshot, createEngine, restoreGameStateSnapshot, hashGameStateSnapshot, parseGameStateSnapshot, stringifyGameStateSnapshot } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

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
  assert.equal(savedProgress.dataScene.version, 3);
  assert.deepEqual(savedProgress.dataScene.progress.instances, [
    { id: "player", removed: false, interactionConsumed: false },
    { id: "shell", removed: true, interactionConsumed: false },
    { id: "site", removed: false, interactionConsumed: true },
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
  const report = { format: "ferrum2d.data-scene-gameplay.consumer-smoke", version: 1, status: "passed", cases };
  await writeFile(new URL("./result.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  engine?.destroy(); globalThis.fetch = original.fetch;
  globalThis.requestAnimationFrame = original.raf; globalThis.cancelAnimationFrame = original.cancel;
}
