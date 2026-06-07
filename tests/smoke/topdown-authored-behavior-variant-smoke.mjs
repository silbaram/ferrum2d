#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  behaviorStateMachineCommandsForState,
  createBehaviorStateMachineRuntimeInstallPlan,
  dryRunSceneBehaviorRecipes,
  instantiateSceneFragment,
  resolveGameplayBehaviorRuntimeIds,
  resolveBehaviorRecipeDocument,
  resolveBehaviorStateMachineDocument,
  resolveSceneCompositionSpec,
  resolveShooterGameSpec,
} from "../../packages/ferrum-web/dist/index.js";
import {
  readJsonSchemaContract,
  validateJsonSchemaContract,
} from "../../scripts/validate/json-schema-contract.mjs";

const VARIANT_FORMAT = "ferrum2d.topdown-shooter.authored-behavior-variant";
const VARIANT_VERSION = 1;
const DEFAULT_VARIANT_PATH = "examples/topdown-shooter/public/authored-behavior.variant.json";
const DEFAULT_REPLAY_MANIFEST_PATH = "tests/fixtures/gameplay-golden/scenarios.json";
const VARIANT_SCHEMA_PATH = "schemas/topdown-authored-behavior-variant.schema.json";
const REPLAY_MANIFEST_FORMAT = "ferrum2d.gameplay-replay.scenarios";
const REPLAY_FIXTURE_INDEX_FORMAT = "ferrum2d.gameplay-replay.fixture-index";
const REPLAY_COVERAGE_TAGS_FORMAT = "ferrum2d.gameplay-replay.coverage-tags";
const REPLAY_COVERAGE_TAGS_VERSION = 1;

const options = parseArgs(process.argv.slice(2));
const variantPath = resolve(options.variantPath ?? DEFAULT_VARIANT_PATH);
const replayManifestPath = resolve(options.replayManifestPath ?? DEFAULT_REPLAY_MANIFEST_PATH);
const variantSchema = await readJsonSchemaContract(resolve(VARIANT_SCHEMA_PATH));
validateVariantSchemaContract(variantSchema);
const variant = await readJson(variantPath);
validateJsonSchemaContract(variantSchema, variant, "topdown-authored-behavior-variant");
validateVariantEnvelope(variant, variantPath);

const baseGameSpecPath = resolve(dirname(variantPath), variant.extendsGameSpec);
const baseGameSpec = await readJson(baseGameSpecPath);
const resolvedGameSpec = resolveShooterGameSpec(baseGameSpec, { path: "authoredBehaviorVariant.extendsGameSpec" });
const ids = resolveGameplayBehaviorRuntimeIds(variant.ids, {
  path: "authoredBehaviorVariant.ids",
  requiredItems: ["score"],
  requiredActions: ["primary", "dash", "collect-score", "summon-enemy"],
  requiredTimers: ["wake"],
});

const recipes = resolveBehaviorRecipeDocument(variant.behaviorRecipes, {
  path: "authoredBehaviorVariant.behaviorRecipes",
});
const composition = resolveSceneCompositionSpec(variant.sceneComposition, {
  path: "authoredBehaviorVariant.sceneComposition",
});
const dryRun = dryRunSceneBehaviorRecipes(composition, recipes, {
  path: "authoredBehaviorVariant.gameplayAuthoring",
  missingBehavior: "error",
});
assert.equal(dryRun.ok, true, "authored behavior variant gameplay authoring dry-run must pass");
const instances = instantiateSceneFragment(composition);
assert.ok(
  instances.some((instance) => instance.props?.replayBody === variant.semantics.browserPlacement.anchorReplayBody),
  `browserPlacement anchorReplayBody '${variant.semantics.browserPlacement.anchorReplayBody}' must match a scene instance replayBody`,
);
assert.ok(
  instances.some((instance) => instance.id === "builtin-player" && instance.props?.runtimeEntity === "builtinShooterPlayer"),
  "authored behavior variant must bind a virtual scene instance to the built-in Shooter player runtime entity",
);

const commands = dryRun.plan.commands.map((command) => `${command.entity}:${command.type}`);
assert.deepEqual(commands, [
  "builtin-player:configureProjectileAction",
  "builtin-player:configureDashAction",
  "builtin-player:configureSpawnPrefabAction",
  "score-pickup:configurePickup",
  "interaction-source:configureInteraction",
  "test-projectile:configureDamage",
  "rewarded-enemy:configureHealth",
  "rewarded-enemy:configureScoreReward",
  "neutral-projectile:configureDamage",
  "neutral-projectile:configureFaction",
  "neutral-projectile:configureLifetime",
  "neutral-enemy:configureHealth",
  "neutral-enemy:configureFaction",
  "timer-source:configureSpawnPrefabAction",
  "timer-source:configureTimerTrigger",
], "authored behavior variant must bind expected gameplay commands");
const neutralProjectileFaction = dryRun.plan.commands.find((command) =>
  command.entity === "neutral-projectile" && command.type === "configureFaction"
);
assert.equal(neutralProjectileFaction?.faction, "neutral", "neutral projectile must use neutral faction recipe");
assert.deepEqual(neutralProjectileFaction?.damages, [], "neutral projectile must default to an empty damage mask");
const neutralProjectileLifetime = dryRun.plan.commands.find((command) =>
  command.entity === "neutral-projectile" && command.type === "configureLifetime"
);
assert.equal(neutralProjectileLifetime?.seconds, 0.02, "neutral projectile lifetime must keep replay denial telemetry one-shot");
const neutralEnemyFaction = dryRun.plan.commands.find((command) =>
  command.entity === "neutral-enemy" && command.type === "configureFaction"
);
assert.equal(neutralEnemyFaction?.faction, "enemy", "neutral target must use enemy faction recipe");
assert.deepEqual(neutralEnemyFaction?.damages, ["player"], "neutral target enemy faction must keep the default player damage mask");

const machines = resolveBehaviorStateMachineDocument(variant.behaviorStateMachines, {
  path: "authoredBehaviorVariant.behaviorStateMachines",
  behaviorRecipes: recipes,
});
const interactionPlan = createBehaviorStateMachineRuntimeInstallPlan(
  machines,
  "interaction-source",
  { behaviorRecipes: recipes, ids, path: "authoredBehaviorVariant.behaviorStateMachines.machines.interaction-source" },
);
const projectilePlan = createBehaviorStateMachineRuntimeInstallPlan(
  machines,
  "test-projectile",
  { behaviorRecipes: recipes, ids, path: "authoredBehaviorVariant.behaviorStateMachines.machines.test-projectile" },
);
const timerPlan = createBehaviorStateMachineRuntimeInstallPlan(
  machines,
  "timer-source",
  { behaviorRecipes: recipes, ids, path: "authoredBehaviorVariant.behaviorStateMachines.machines.timer-source" },
);
assert.deepEqual(interactionPlan.transitions.map((transition) => [transition.event, transition.tokenId]), [
  ["interaction", 7],
]);
assert.deepEqual(projectilePlan.transitions.map((transition) => [transition.event, transition.tokenId]), [
  ["collisionDamage", 0],
]);
assert.deepEqual(timerPlan.transitions.map((transition) => [transition.event, transition.tokenId]), [
  ["timer", 13],
]);
assert.equal(
  stateIdFor(interactionPlan, variant.expected.states["interaction-source"]),
  2,
  "interaction expected state must map to replay numeric FSM state",
);
assert.equal(
  stateIdFor(projectilePlan, variant.expected.states["test-projectile"]),
  2,
  "projectile expected state must map to replay numeric FSM state",
);
assert.equal(
  stateIdFor(timerPlan, variant.expected.states["timer-source"]),
  1,
  "timer expected state must map to replay numeric FSM state",
);

assert.deepEqual(
  behaviorStateMachineCommandsForState(machines, recipes, "interaction-source", "idle").map((command) => command.type),
  ["configureInteraction"],
);
assert.deepEqual(
  behaviorStateMachineCommandsForState(machines, recipes, "test-projectile", "armed").map((command) => command.type),
  ["configureDamage"],
);
assert.deepEqual(
  behaviorStateMachineCommandsForState(machines, recipes, "timer-source", "idle").map((command) => command.type),
  ["configureSpawnPrefabAction", "configureTimerTrigger"],
);
assert.deepEqual(
  behaviorStateMachineCommandsForState(machines, recipes, "interaction-source", "triggered").map((command) => command.type),
  [],
  "interaction triggered state must be empty so replaceSupported clears the interaction component",
);
assert.deepEqual(
  behaviorStateMachineCommandsForState(machines, recipes, "test-projectile", "spent").map((command) => command.type),
  ["configureLifetime"],
  "projectile spent state must apply a non-empty state profile after clearing damage/collision reaction components",
);
assert.deepEqual(
  behaviorStateMachineCommandsForState(machines, recipes, "timer-source", "awake").map((command) => command.type),
  [],
  "timer awake state must be empty so replaceSupported clears timer/action components without auto-resetting it",
);

const replayManifest = await readReplayManifestWithCoverageTags(replayManifestPath);
assert.equal(replayManifest.format, REPLAY_MANIFEST_FORMAT, `${replayManifestPath}.format must match`);
const replayScenario = replayManifest.scenarios?.find((scenario) => scenario.id === variant.replayScenario);
assert.ok(replayScenario, `${replayManifestPath} must include variant replayScenario '${variant.replayScenario}'`);
const replayFixture = await readReplayFixtureIndexEntry(replayManifest, replayManifestPath, variant.replayScenario);
assert.equal(replayFixture.fixturePath, replayScenario.fixturePath, "variant replay fixture path must match replay manifest");
assert.equal(replayFixture.description, replayScenario.description, "variant replay fixture description must match replay manifest");
assert.deepEqual(replayFixture.coverageTags, replayScenario.coverageTags, "variant replay fixture coverage tags must match replay manifest");
assert.equal(replayFixture.replayHash, replayScenario.expected?.replayHash, "variant replay fixture hash must match replay manifest");
const authoringEvent = replayScenario.input?.events?.find((event) => event.type === "authoring");
assert.ok(authoringEvent, `${replayManifestPath} scenario '${variant.replayScenario}' must include an authoring event`);
validateSceneBindings(instances, machines, authoringEvent);
assert.equal(replayScenario.expected?.replayHash, variant.expected.replayHash, "variant replay hash must match replay manifest");
assert.equal(replayScenario.expected?.finalScore, variant.expected.finalScore, "variant final score must match replay manifest");
assert.equal(replayScenario.expected?.eventFrame, variant.expected.eventFrame, "variant event frame must match replay manifest");
assert.deepEqual(replayScenario.expected?.eventKinds, variant.expected.eventKinds, "variant event kinds must match replay manifest");
assert.equal(replayScenario.expected?.actionFailureFrame, variant.expected.actionFailureFrame, "variant action failure frame must match replay manifest");
assert.deepEqual(replayScenario.expected?.actionFailureEventKinds, variant.expected.actionFailureEventKinds, "variant action failure event kinds must match replay manifest");
assert.equal(replayScenario.expected?.timerFrame, variant.expected.timerFrame, "variant timer frame must match replay manifest");
assert.deepEqual(replayScenario.expected?.timerEventKinds, variant.expected.timerEventKinds, "variant timer event kinds must match replay manifest");
const timerSpawnPrefab = commandByEntityAndType(dryRun.plan.commands, "timer-source", "configureSpawnPrefabAction");
const timerTrigger = commandByEntityAndType(dryRun.plan.commands, "timer-source", "configureTimerTrigger");
assert.equal(authoringEvent.components?.timerSpawnPrefab?.actionId, ids.actions?.[timerSpawnPrefab.action], "timer spawnPrefab action id must match runtime id registry");
assert.equal(authoringEvent.components?.timerSpawnPrefab?.cooldownSeconds, timerSpawnPrefab.cooldownSeconds, "timer spawnPrefab cooldown must match recipe");
assert.equal(authoringEvent.components?.timerSpawnPrefab?.prefabId, timerSpawnPrefab.prefabId, "timer spawnPrefab prefab id must match recipe");
assert.equal(authoringEvent.components?.timerSpawnPrefab?.offsetX, timerSpawnPrefab.offsetX, "timer spawnPrefab offsetX must match recipe");
assert.equal(authoringEvent.components?.timerSpawnPrefab?.offsetY, timerSpawnPrefab.offsetY, "timer spawnPrefab offsetY must match recipe");
assert.equal(authoringEvent.components?.timer?.timerId, ids.timers?.[timerTrigger.timer], "timer trigger id must match runtime id registry");
assert.equal(authoringEvent.components?.timer?.actionId, ids.actions?.[timerTrigger.action], "timer trigger action id must match runtime id registry");
assert.equal(authoringEvent.components?.timer?.actionId, authoringEvent.components?.timerSpawnPrefab?.actionId, "timer action id must target timer spawnPrefab action");
assert.notEqual(authoringEvent.components?.timer?.timerId, authoringEvent.components?.timer?.actionId, "timer id and action id must stay separate");
assert.equal(
  replayScenario.expected?.fsmState,
  stateIdFor(interactionPlan, variant.expected.states["interaction-source"]),
  "variant interaction expected state must map to replay manifest FSM state",
);
assert.equal(
  replayScenario.expected?.fsmState,
  stateIdFor(projectilePlan, variant.expected.states["test-projectile"]),
  "variant projectile expected state must map to replay manifest FSM state",
);
assert.equal(
  replayScenario.expected?.timerFsmState,
  stateIdFor(timerPlan, variant.expected.states["timer-source"]),
  "variant timer expected state must map to replay manifest timer FSM state",
);

console.log(JSON.stringify({
  topdownAuthoredBehaviorVariantSmoke: {
    variantPath,
    baseGameSpecPath,
    worldWidth: resolvedGameSpec.worldWidth,
    worldHeight: resolvedGameSpec.worldHeight,
    commandCount: dryRun.plan.commands.length,
    instanceCount: instances.length,
    machines: Object.keys(machines.machines),
    replayScenario: variant.replayScenario,
    replayHash: variant.expected.replayHash,
    ids,
    fsmStateEntryMode: variant.semantics.fsmStateEntryMode,
    browserPlacement: variant.semantics.browserPlacement,
  },
}, null, 2));

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readReplayFixtureIndexEntry(replayManifest, replayManifestPath, scenarioId) {
  assert.equal(typeof replayManifest.fixtureIndexPath, "string", `${replayManifestPath}.fixtureIndexPath must be a string`);
  const fixtureIndexPath = resolveReplayManifestPath(dirname(replayManifestPath), replayManifest.fixtureIndexPath);
  const fixtureIndex = await readReplayFixtureIndexWithCoverageTags(fixtureIndexPath);
  assert.equal(fixtureIndex.format, REPLAY_FIXTURE_INDEX_FORMAT, `${fixtureIndexPath}.format must match`);
  assert.equal(
    fixtureIndex.coverageTagDefinitionsPath,
    replayManifest.coverageTagDefinitionsPath,
    `${fixtureIndexPath}.coverageTagDefinitionsPath must match replay manifest`,
  );
  assert.deepEqual(
    fixtureIndex.coverageTagDefinitions,
    replayManifest.coverageTagDefinitions,
    `${fixtureIndexPath}.coverageTagDefinitions must match replay manifest`,
  );
  assert.deepEqual(
    fixtureIndex.coverageTagGroups,
    replayManifest.coverageTagGroups,
    `${fixtureIndexPath}.coverageTagGroups must match replay manifest`,
  );
  assert.deepEqual(
    fixtureIndex.deprecatedCoverageTags,
    replayManifest.deprecatedCoverageTags,
    `${fixtureIndexPath}.deprecatedCoverageTags must match replay manifest`,
  );
  const fixture = fixtureIndex.fixtures?.find((candidate) => candidate.id === scenarioId);
  assert.ok(fixture, `${fixtureIndexPath} must include replay scenario '${scenarioId}'`);
  return fixture;
}

async function readReplayManifestWithCoverageTags(replayManifestPath) {
  const replayManifest = await readJson(replayManifestPath);
  const coverage = await readCoverageTagDefinitions(
    replayManifest,
    dirname(replayManifestPath),
    replayManifestPath,
  );
  assertReplayCoverageTags(
    replayManifest.scenarios,
    `${replayManifestPath}.scenarios`,
    coverage.definitions,
    coverage.deprecatedTags,
  );
  return {
    ...replayManifest,
    coverageTagDefinitionsPath: coverage.path,
    coverageTagDefinitions: coverage.definitions,
    ...(coverage.groups === undefined ? {} : { coverageTagGroups: coverage.groups }),
    ...(coverage.deprecatedTags === undefined ? {} : { deprecatedCoverageTags: coverage.deprecatedTags }),
  };
}

async function readReplayFixtureIndexWithCoverageTags(fixtureIndexPath) {
  const fixtureIndex = await readJson(fixtureIndexPath);
  const coverage = await readCoverageTagDefinitions(
    fixtureIndex,
    dirname(fixtureIndexPath),
    fixtureIndexPath,
  );
  assertReplayCoverageTags(
    fixtureIndex.fixtures,
    `${fixtureIndexPath}.fixtures`,
    coverage.definitions,
    coverage.deprecatedTags,
  );
  return {
    ...fixtureIndex,
    coverageTagDefinitionsPath: coverage.path,
    coverageTagDefinitions: coverage.definitions,
    ...(coverage.groups === undefined ? {} : { coverageTagGroups: coverage.groups }),
    ...(coverage.deprecatedTags === undefined ? {} : { deprecatedCoverageTags: coverage.deprecatedTags }),
  };
}

async function readCoverageTagDefinitions(document, documentDir, documentPath) {
  assert.equal(typeof document.coverageTagDefinitionsPath, "string", `${documentPath}.coverageTagDefinitionsPath must be a string`);
  const coveragePath = resolveReplayManifestPath(documentDir, document.coverageTagDefinitionsPath);
  const coverage = await readJson(coveragePath);
  assert.equal(coverage.format, REPLAY_COVERAGE_TAGS_FORMAT, `${coveragePath}.format must match`);
  assert.equal(coverage.version, REPLAY_COVERAGE_TAGS_VERSION, `${coveragePath}.version must match`);
  assertCoverageTagDefinitions(coverage.coverageTagDefinitions, `${coveragePath}.coverageTagDefinitions`);
  assertCoverageTagGroups(
    coverage.coverageTagGroups,
    `${coveragePath}.coverageTagGroups`,
    coverage.coverageTagDefinitions,
  );
  assertDeprecatedCoverageTags(
    coverage.deprecatedCoverageTags,
    `${coveragePath}.deprecatedCoverageTags`,
    coverage.coverageTagDefinitions,
  );
  return {
    path: coveragePath,
    definitions: coverage.coverageTagDefinitions,
    groups: coverage.coverageTagGroups,
    deprecatedTags: coverage.deprecatedCoverageTags,
  };
}

function assertCoverageTagDefinitions(value, label) {
  assertPlainObject(value, label);
  const entries = Object.entries(value);
  assert.ok(entries.length > 0, `${label} must not be empty`);
  for (const [tag, description] of entries) {
    assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag), `${label}.${tag} key must be kebab-case`);
    assertNonEmptyString(description, `${label}.${tag}`);
  }
}

function assertCoverageTags(value, label) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.ok(value.length > 0, `${label} must not be empty`);
  const seen = new Set();
  for (const [index, tag] of value.entries()) {
    assertNonEmptyString(tag, `${label}[${index}]`);
    assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag), `${label}[${index}] must be kebab-case`);
    assert.ok(!seen.has(tag), `${label} must not include duplicate coverage tag '${tag}'`);
    seen.add(tag);
  }
}

function assertCoverageTagGroups(value, label, definitions) {
  assertPlainObject(value, label);
  const entries = Object.entries(value);
  assert.ok(entries.length > 0, `${label} must not be empty`);
  const groupedTags = new Set();
  for (const [group, spec] of entries) {
    const groupLabel = `${label}.${group}`;
    assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group), `${groupLabel} key must be kebab-case`);
    assertPlainObject(spec, groupLabel);
    assertNonEmptyString(spec.description, `${groupLabel}.description`);
    assertCoverageTags(spec.tags, `${groupLabel}.tags`);
    for (const tag of spec.tags) {
      assert.ok(
        definitions[tag] !== undefined,
        `${groupLabel}.tags must reference defined coverage tag '${tag}'`,
      );
      groupedTags.add(tag);
    }
  }
  for (const tag of Object.keys(definitions)) {
    assert.ok(groupedTags.has(tag), `${label} must include active coverage tag '${tag}' in at least one group`);
  }
}

function assertDeprecatedCoverageTags(value, label, definitions) {
  assertPlainObject(value, label);
  for (const [tag, description] of Object.entries(value)) {
    assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag), `${label}.${tag} key must be kebab-case`);
    assert.ok(
      definitions[tag] === undefined,
      `${label}.${tag} must not also be an active coverage tag`,
    );
    assertNonEmptyString(description, `${label}.${tag}`);
  }
}

function assertReplayCoverageTags(items, label, definitions, deprecatedTags) {
  assert.ok(Array.isArray(items), `${label} must be an array`);
  for (const [index, item] of items.entries()) {
    assertPlainObject(item, `${label}[${index}]`);
    assertCoverageTags(item.coverageTags, `${label}[${index}].coverageTags`);
    for (const tag of item.coverageTags) {
      assert.ok(
        definitions[tag] !== undefined,
        `${label}[${index}].coverageTags must reference defined coverage tag '${tag}'`,
      );
      assert.ok(
        deprecatedTags?.[tag] === undefined,
        `${label}[${index}].coverageTags must not use deprecated coverage tag '${tag}'`,
      );
    }
  }
}

function resolveReplayManifestPath(manifestDir, relativeOrAbsolutePath) {
  if (relativeOrAbsolutePath.startsWith("./") || relativeOrAbsolutePath.startsWith("../")) {
    return resolve(manifestDir, relativeOrAbsolutePath);
  }
  return resolve(relativeOrAbsolutePath);
}

function validateVariantSchemaContract(schema) {
  const sample = {
    format: VARIANT_FORMAT,
    version: VARIANT_VERSION,
    extendsGameSpec: "./game.json",
    replayScenario: "example-topdown-authored-behavior",
    semantics: {
      fsmStateEntryMode: "manualReplaceSupported",
      browserPlacement: {
        anchorReplayBody: "sample",
        target: "worldCenter",
        scale: 1,
      },
    },
    ids: {
      items: { score: 1 },
      actions: {
        primary: 1,
        dash: 2,
        "collect-score": 7,
        "summon-enemy": 11,
      },
      timers: { wake: 13 },
    },
    sceneComposition: {
      prefabs: {},
      fragments: {},
    },
    behaviorRecipes: {
      entities: {
        custom: {
          recipes: [
            { kind: "faction", faction: 31, damages: [31] },
          ],
        },
      },
    },
    behaviorStateMachines: {
      machines: {
        sample: {},
      },
    },
    expected: {
      replayHash: "00000000",
      finalScore: 0,
      eventFrame: 1,
      eventKinds: ["interaction"],
      actionFailureFrame: 2,
      actionFailureEventKinds: ["actionFailed"],
      timerFrame: 1,
      timerEventKinds: ["timer", "behaviorStateChanged"],
      states: {
        sample: "idle",
      },
    },
  };
  validateJsonSchemaContract(schema, sample, "topdown-authored-behavior-variant.schema.customFaction31");
  assert.throws(
    () => validateJsonSchemaContract(
      schema,
      {
        ...sample,
        behaviorRecipes: {
          entities: {
            custom: {
              recipes: [
                { kind: "faction", faction: 32, damages: [31] },
              ],
            },
          },
        },
      },
      "topdown-authored-behavior-variant.schema.customFaction32",
    ),
    /<= 31/,
    "topdown authored behavior variant schema must reject numeric faction ids above 31",
  );
  assert.throws(
    () => validateJsonSchemaContract(
      schema,
      {
        ...sample,
        behaviorRecipes: {
          recipes: {
            baseFaction: { kind: "faction", faction: "player" },
          },
          entities: {
            custom: {
              recipes: [
                { use: "baseFaction", overrides: { faction: 32, damages: [31] } },
              ],
            },
          },
        },
      },
      "topdown-authored-behavior-variant.schema.customFactionOverride32",
    ),
    /<= 31/,
    "topdown authored behavior variant schema must reject numeric faction ids above 31 in recipe overrides",
  );
  assert.throws(
    () => validateJsonSchemaContract(
      schema,
      {
        ...sample,
        behaviorRecipes: {
          recipes: {
            baseFaction: { kind: "faction", faction: "player" },
          },
          entities: {
            custom: {
              recipes: [
                { use: "baseFaction", overrides: { faction: 31, damages: [32] } },
              ],
            },
          },
        },
      },
      "topdown-authored-behavior-variant.schema.customFactionDamageOverride32",
    ),
    /<= 31/,
    "topdown authored behavior variant schema must reject numeric damage faction ids above 31 in recipe overrides",
  );
  assert.throws(
    () => validateJsonSchemaContract(
      schema,
      {
        ...sample,
        behaviorRecipes: {
          entities: {
            custom: {
              recipes: [
                { kind: "faction", damages: [31] },
              ],
            },
          },
        },
      },
      "topdown-authored-behavior-variant.schema.missingFaction",
    ),
    /\.faction is required/,
    "topdown authored behavior variant schema must require faction on faction recipes",
  );
  assert.throws(
    () => validateJsonSchemaContract(
      schema,
      {
        ...sample,
        behaviorRecipes: {
          recipes: {
            baseFaction: { kind: "faction", faction: "player" },
          },
          entities: {
            custom: {
              recipes: [
                { use: "baseFaction", kind: "faction", overrides: { faction: 31 } },
              ],
            },
          },
        },
      },
      "topdown-authored-behavior-variant.schema.referenceWithKind",
    ),
    /must not match forbidden schema/,
    "topdown authored behavior variant schema must reject recipe references that also carry kind",
  );
}

function validateVariantEnvelope(variant, path) {
  assertPlainObject(variant, path);
  assert.equal(variant.format, VARIANT_FORMAT, `${path}.format must match`);
  assert.equal(variant.version, VARIANT_VERSION, `${path}.version must match`);
  assertNonEmptyString(variant.extendsGameSpec, `${path}.extendsGameSpec`);
  assertNonEmptyString(variant.replayScenario, `${path}.replayScenario`);
  assertPlainObject(variant.sceneComposition, `${path}.sceneComposition`);
  assertPlainObject(variant.behaviorRecipes, `${path}.behaviorRecipes`);
  assertPlainObject(variant.behaviorStateMachines, `${path}.behaviorStateMachines`);
  assertPlainObject(variant.semantics, `${path}.semantics`);
  assert.equal(
    variant.semantics.fsmStateEntryMode,
    "manualReplaceSupported",
    `${path}.semantics.fsmStateEntryMode must document the browser smoke state command apply mode`,
  );
  assertPlainObject(variant.semantics.browserPlacement, `${path}.semantics.browserPlacement`);
  assertNonEmptyString(
    variant.semantics.browserPlacement.anchorReplayBody,
    `${path}.semantics.browserPlacement.anchorReplayBody`,
  );
  assert.equal(
    variant.semantics.browserPlacement.target,
    "worldCenter",
    `${path}.semantics.browserPlacement.target must be worldCenter`,
  );
  assertFiniteNumber(variant.semantics.browserPlacement.scale, `${path}.semantics.browserPlacement.scale`);
  assert.ok(variant.semantics.browserPlacement.scale > 0, `${path}.semantics.browserPlacement.scale must be positive`);
  assertPlainObject(variant.expected, `${path}.expected`);
  assertReplayHash(variant.expected.replayHash, `${path}.expected.replayHash`);
  assertFiniteNumber(variant.expected.finalScore, `${path}.expected.finalScore`);
  assertFiniteNumber(variant.expected.eventFrame, `${path}.expected.eventFrame`);
  assert.ok(Array.isArray(variant.expected.eventKinds), `${path}.expected.eventKinds must be an array`);
  for (const [index, eventKind] of variant.expected.eventKinds.entries()) {
    assertNonEmptyString(eventKind, `${path}.expected.eventKinds[${index}]`);
  }
  assertPlainObject(variant.expected.states, `${path}.expected.states`);
  assertNonEmptyString(variant.expected.states["interaction-source"], `${path}.expected.states.interaction-source`);
  assertNonEmptyString(variant.expected.states["test-projectile"], `${path}.expected.states.test-projectile`);
  assertNonEmptyString(variant.expected.states["timer-source"], `${path}.expected.states.timer-source`);
  assertFiniteNumber(variant.expected.timerFrame, `${path}.expected.timerFrame`);
  assert.ok(Array.isArray(variant.expected.timerEventKinds), `${path}.expected.timerEventKinds must be an array`);
  assert.deepEqual(variant.expected.timerEventKinds, ["timer", "prefabSpawned", "behaviorStateChanged"], `${path}.expected.timerEventKinds must stay exact`);
}

function validateSceneBindings(instances, machines, authoringEvent) {
  const machineIds = new Set(Object.keys(machines.machines));
  const boundMachineIds = new Set();
  for (const instance of instances) {
    const props = instance.props ?? {};
    const machineId = props.behaviorStateMachine;
    if (machineId !== undefined) {
      assertNonEmptyString(machineId, `sceneComposition.instances.${instance.id}.props.behaviorStateMachine`);
      assert.ok(machineIds.has(machineId), `scene instance '${instance.id}' references unknown FSM '${machineId}'`);
      assert.equal(machineId, instance.id, `scene instance '${instance.id}' FSM binding must match instance id`);
      boundMachineIds.add(machineId);
    }

    const replayBody = props.replayBody;
    if (replayBody === undefined) {
      continue;
    }
    assertNonEmptyString(replayBody, `sceneComposition.instances.${instance.id}.props.replayBody`);
    const expectedBody = authoringEvent.bodies?.[replayBody];
    assert.ok(expectedBody, `replay body '${replayBody}' must exist for scene instance '${instance.id}'`);
    assert.equal(instance.x, expectedBody.x, `scene instance '${instance.id}' x must match replay body '${replayBody}'`);
    assert.equal(instance.y, expectedBody.y, `scene instance '${instance.id}' y must match replay body '${replayBody}'`);
    assert.deepEqual(normalizePhysicsBody(props.physicsBody), normalizePhysicsBody(expectedBody), `scene instance '${instance.id}' physicsBody must match replay body '${replayBody}'`);
  }
  assert.deepEqual([...boundMachineIds].sort(), [...machineIds].sort(), "all FSM machines must be bound by scene instances");
}

function normalizePhysicsBody(body) {
  assertPlainObject(body, "physicsBody");
  return {
    halfWidth: body.halfWidth,
    halfHeight: body.halfHeight,
    layer: body.layer,
    isTrigger: body.isTrigger ?? false,
  };
}

function stateIdFor(plan, state) {
  const resolvedState = plan.states.find((candidate) => candidate.state === state);
  assert.ok(resolvedState, `FSM install plan must include expected state '${state}'`);
  return resolvedState.stateId;
}

function commandByEntityAndType(commands, entity, type) {
  const command = commands.find((candidate) => candidate.entity === entity && candidate.type === type);
  assert.ok(command, `expected ${entity}:${type} command`);
  return command;
}

function parseArgs(args) {
  let variantPath;
  let replayManifestPath;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--variant=")) {
      variantPath = arg.slice("--variant=".length);
      continue;
    }
    if (arg === "--variant") {
      variantPath = requiredArg(args, ++index, arg);
      continue;
    }
    if (arg.startsWith("--replay-manifest=")) {
      replayManifestPath = arg.slice("--replay-manifest=".length);
      continue;
    }
    if (arg === "--replay-manifest") {
      replayManifestPath = requiredArg(args, ++index, arg);
      continue;
    }
    throw new Error(`unsupported topdown authored behavior variant smoke option: ${arg}`);
  }
  return { variantPath, replayManifestPath };
}

function requiredArg(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function assertPlainObject(value, label) {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function assertNonEmptyString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.length > 0, `${label} must not be empty`);
}

function assertReplayHash(value, label) {
  assertNonEmptyString(value, label);
  assert.match(value, /^[0-9a-f]{8}$/, `${label} must be an 8-character lowercase hex hash`);
}

function assertFiniteNumber(value, label) {
  assert.equal(typeof value, "number", `${label} must be a number`);
  assert.ok(Number.isFinite(value), `${label} must be finite`);
}
