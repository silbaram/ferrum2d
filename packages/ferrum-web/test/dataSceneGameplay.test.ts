import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { resolveDataSceneGameplaySpec, resolveDataSceneNavigationSpec, resolveSceneAuthoringDocument } from "../src/authoring.js";
import { preflightDataSceneGameplay } from "../src/dataSceneGameplayAuthoring.js";
import { bindSceneBehaviorRecipes } from "../src/gameplayAuthoring.js";
import type { GameplayBehaviorRuntimeIds } from "../src/gameplayAuthoring.js";
import { applyDataSceneAuthoringDocument, attachDataSceneRuntimeEngineAdapter } from "../src/dataSceneRuntimeTarget.js";
import type { FerrumEngine } from "../src/engineTypes.js";

const grid = { columns: 3, rows: 1, cellWidth: 24, cellHeight: 24, costs: [1, 0, 7] };
test("navigation validates complete bounded numeric grids before runtime mutation", () => {
  deepEqual(resolveDataSceneNavigationSpec(grid), { ...grid, originX: 0, originY: 0 });
  for (const change of [{ costs: [1] }, { costs: [1, -1, 2] }, { costs: [1, 65536, 2] }, { costs: new Array(3) }, { columns: 4097 }, { rows: 2048 }, { cellWidth: 1e-100 }, { originX: null }, { floor: 1 }]) {
    throws(() => resolveDataSceneNavigationSpec({ ...grid, ...change }));
  }
  const resolved = resolveDataSceneNavigationSpec(grid);
  equal(resolved.costs === grid.costs, false);
});

test("gameplay actor reference and input gate are explicit", () => {
  deepEqual(resolveDataSceneGameplaySpec({}), {});
  deepEqual(resolveDataSceneGameplaySpec({ primaryActor: "player", interactionInputActionId: 91 }), { primaryActor: "player", interactionInputActionId: 91 });
  for (const value of [{ primaryActor: "" }, { interactionInputActionId: 91 }, { primaryActor: "player", interactionInputActionId: 0 }, { primaryActor: "player", interactionInputActionId: 0x100000000 }, { typo: true }]) {
    throws(() => resolveDataSceneGameplaySpec(value));
  }
});

function document(gameplay?: unknown, recipe: unknown = { kind: "interaction", action: "discover", radius: 79 }, overrides: Record<string, unknown> = {}) {
  return resolveSceneAuthoringDocument({
    format: "ferrum2d.consumer.scene-authoring", version: 1,
    sceneComposition: { initialFragment: "island", prefabs: { actor: { props: { behaviorRecipes: ["site"] } } }, fragments: { island: { instances: [{ id: "player", prefab: "actor", x: 0, y: 0 }] } } },
    behaviorRecipes: { entities: { site: { recipes: [recipe] } } }, ids: { actions: { discover: 17 }, items: { shell: 2 } },
    ...(gameplay === undefined ? {} : { gameplay }), navigation: grid,
    ...overrides,
  });
}

test("Data Scene gameplay preflight rejects missing actors and unsupported executors", () => {
  const engine = { configureDataSceneGameplay() { return true; }, configureDataSceneNavigation() { return true; } } as unknown as FerrumEngine;
  const check = (resolved: ReturnType<typeof document>) => preflightDataSceneGameplay(engine, resolved, bindSceneBehaviorRecipes(resolved.sceneComposition, resolved.behaviorRecipes), resolved.ids, "scene");
  check(document({ primaryActor: "player" }));
  check(document({}, { kind: "pickup", item: "shell", despawn: true }));
  throws(() => check(document()), /declare gameplay/);
  throws(() => check(document({})), /primaryActor/);
  throws(() => check(document({ primaryActor: "missing" })), /applied fragment/);
  throws(() => check(document({}, { kind: "chase", speed: 20 })), /no generic Data Scene executor/);
  throws(() => check(document({}, { kind: "pickup", item: "missing" })), /must resolve pickup/);
  throws(() => check(document({}, { kind: "pickup", item: "shell", despawn: false })), /persistent pickup/);
});

test("unsupported Data Scene command values fail before activation or spawning", () => {
  let mutations = 0;
  const engine = attachDataSceneRuntimeEngineAdapter({
    configureDataSceneGameplay() { mutations++; return true; },
    configureDataSceneNavigation() { mutations++; return true; },
  } as unknown as FerrumEngine, {
    useDataScene() { mutations++; },
    textureId() { mutations++; return 1; },
    spawnDataSceneEntity() { mutations++; return { entityId: 1, entityGeneration: 1 }; },
  });
  const cases: readonly [unknown, RegExp][] = [
    [{ kind: "health", max: 2, start: 1 }, /current.*must equal max/],
    [{ kind: "health", max: 2, onZero: "event" }, /onZero.*must be despawn/],
    [{ kind: "damage", amount: 1, cooldownSeconds: 1 }, /cooldownSeconds.*must be 0/],
    [{ kind: "timerTrigger", timer: "alarm", timerId: 5, actionId: 17 }, /timer actions.*no generic Data Scene executor/],
    [{ kind: "timerTrigger", timer: "alarm", timerId: 5, action: "discover" }, /timer actions.*no generic Data Scene executor/],
    [{ kind: "timerTrigger", timer: "missing" }, /must resolve timer/],
    [{ kind: "timerTrigger", timer: "alarm", timerId: 0x100000000 }, /positive safe u32/],
    [{ kind: "health", max: 1e39 }, /float32/],
    [{ kind: "damage", amount: 1e-100 }, /float32/],
    [{ kind: "lifetime", seconds: 1e39 }, /float32/],
    [{ kind: "interaction", action: "discover", radius: 1e-100 }, /float32/],
    [{ kind: "timerTrigger", timer: "alarm", timerId: 5, seconds: 1e-100 }, /float32/],
    [{ kind: "scoreReward", reward: 0x100000000 }, /uint32/],
  ];
  for (const [recipe, error] of cases) {
    throws(() => applyDataSceneAuthoringDocument(engine,
      document({ primaryActor: "player" }, recipe),
      { validateComponents: false },
    ), error);
    equal(mutations, 0);
  }
});

const preflightEngine = {
  configureDataSceneGameplay() { return true; },
  configureDataSceneNavigation() { return true; },
} as unknown as FerrumEngine;

function checkPreflight(resolved: ReturnType<typeof document>, ids = resolved.ids): void {
  preflightDataSceneGameplay(preflightEngine, resolved,
    bindSceneBehaviorRecipes(resolved.sceneComposition, resolved.behaviorRecipes), ids, "scene");
}

test("Data Scene preflight resolves effective ids and event or guard references", () => {
  const timer = document({}, { kind: "timerTrigger", timer: "alarm" });
  checkPreflight(timer, { timers: { alarm: 0xffffffff } });
  for (const value of [0, 1.5, 0x100000000, "5", NaN]) {
    throws(() => checkPreflight(timer, { timers: { alarm: value } } as unknown as GameplayBehaviorRuntimeIds));
  }

  const mutation = document({}, {
    kind: "incrementVariable", variable: "coins", amount: 1,
    when: { type: "gameplayEvent", event: "pickupCollected", item: "shell", itemId: 2 },
  }, { variables: [{ name: "coins", type: "integer", scope: "scene", default: 0 }] });
  checkPreflight(mutation);
  throws(() => checkPreflight(mutation, { ...mutation.ids, items: {} }), /must resolve.*shell/);
  throws(() => checkPreflight(mutation, { ...mutation.ids, items: { shell: 3 } }), /same runtime id/);

  const guarded = document({ primaryActor: "player" }, {
    kind: "interaction", action: "discover", radius: 2,
    guard: { variable: "coins", variableId: 1, op: ">", value: 0 },
  }, { variables: [{ name: "coins", type: "integer", scope: "scene", default: 0 }] });
  checkPreflight(guarded);
  throws(() => checkPreflight(guarded, { ...guarded.ids, variables: { coins: 2 } }), /undeclared variable slot|same runtime slot/);

  const tagged = document({}, undefined, {
    behaviorRecipes: { entities: { site: { tags: ["friend"], recipes: [{ kind: "health", max: 1 }] } } },
  });
  checkPreflight(tagged, { tags: { friend: 31 } });
  throws(() => checkPreflight(tagged), /must resolve gameplay tag/);
});

test("Data Scene preflight retains supported numeric boundaries and float64 variables", () => {
  for (const recipe of [
    { kind: "health", max: Math.fround(3.4e38) },
    { kind: "damage", amount: Math.fround(1e-40) },
    { kind: "lifetime", seconds: Math.fround(1e-40) },
    { kind: "scoreReward", reward: 0 },
    { kind: "scoreReward", reward: 0xffffffff },
    { kind: "pickup", item: "shell", itemId: 0xffffffff, count: 0xffffffff },
    { kind: "collisionPickup", target: "self" },
    { kind: "interaction", action: "discover", radius: Math.fround(1.4e-45) },
    { kind: "timerTrigger", timer: "alarm", timerId: 0xffffffff, seconds: Math.fround(1e-40) },
  ]) checkPreflight(document({ primaryActor: "player" }, recipe));

  checkPreflight(document({}, {
    kind: "setVariable", variable: "distance", value: 1e100,
    when: { type: "gameplayEvent", event: "pickupCollected", item: "shell" },
  }, { variables: [{ name: "distance", type: "real", scope: "scene", default: 0 }] }));
  checkPreflight(document({ primaryActor: "player" }, {
    kind: "interaction", action: "discover", radius: 1,
    guard: { variable: "distance", op: "<", value: 1e100 },
  }, { variables: [{ name: "distance", type: "real", scope: "scene", default: 0 }] }));
});

test("effective slot overrides preserve variable declaration and type contracts", () => {
  const variables = [
    { name: "aCoins", type: "integer", scope: "scene", default: 0 },
    { name: "bReady", type: "bool", scope: "scene", default: false },
  ];
  const guarded = document({ primaryActor: "player" }, {
    kind: "interaction", action: "discover", radius: 2,
    guard: { variableId: 1, op: ">", value: 0 },
  }, { variables });
  checkPreflight(guarded);
  throws(() => checkPreflight(guarded, {
    ...guarded.ids, variables: { aCoins: 2, bReady: 1 },
  }), /bool variables support only/);

  const mutation = document({}, {
    kind: "incrementVariable", variableId: 1, amount: 1,
    when: { type: "gameplayEvent", event: "pickupCollected", item: "shell" },
  }, { variables });
  checkPreflight(mutation);
  throws(() => checkPreflight(mutation, {
    ...mutation.ids, variables: { aCoins: 2, bReady: 1 },
  }), /bool/);
});

test("variable trigger capacity counts distinct Rust upsert keys per entity", () => {
  const recipes = Array.from({ length: 16 }, (_, index) => ({
    kind: "setVariable", variable: "coins", value: index,
    when: { type: "gameplayEvent", event: "timer", timerId: index + 1 },
  }));
  const fixture = (nextRecipes: readonly unknown[]) => document({}, undefined, {
    variables: [{ name: "coins", type: "integer", scope: "scene", default: 0 }],
    behaviorRecipes: { entities: { site: { recipes: nextRecipes } } },
  });
  checkPreflight(fixture(recipes));
  checkPreflight(fixture([...recipes, { ...recipes[0], value: 99 }]));
  throws(() => checkPreflight(fixture([
    ...recipes, { ...recipes[0], when: { type: "gameplayEvent", event: "timer", timerId: 17 } },
  ])), /at most 16 distinct variable mutation triggers/);
  throws(() => checkPreflight(fixture([
    ...recipes, { kind: "incrementVariable", variable: "coins", amount: 1, when: recipes[0]!.when },
  ])), /at most 16 distinct variable mutation triggers/);

  const twoEntities = fixture(recipes);
  const island = twoEntities.sceneComposition.fragments.island!;
  checkPreflight({
    ...twoEntities,
    sceneComposition: {
      ...twoEntities.sceneComposition,
      fragments: {
        ...twoEntities.sceneComposition.fragments,
        island: { ...island, instances: [...island.instances, { ...island.instances[0]!, id: "second" }] },
      },
    },
  });
});
