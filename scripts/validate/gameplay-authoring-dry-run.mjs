#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBehaviorStateMachineRuntimeInstallPlan,
  createBehaviorStateMachineStateCommandPlan,
  dryRunSceneBehaviorRecipes,
  instantiateSceneFragment,
  preflightBehaviorStateMachineStateCommands,
  resolveBehaviorRecipeDocument,
  resolveBehaviorStateMachineDocument,
  resolveGameplayBehaviorRuntimeIds,
  resolveSceneCompositionSpec,
  resolveShooterGameSpec,
} from "../../packages/ferrum-web/dist/index.js";
import { diagnosticReport } from "../../packages/ferrum-web/dist/diagnostics.js";
import {
  readJsonSchemaContract,
  validateJsonSchemaContract,
} from "./json-schema-contract.mjs";

const REPORT_FORMAT = "ferrum2d.gameplay-authoring.dry-run-report";
const REPORT_VERSION = 1;
const VARIANT_FORMAT = "ferrum2d.topdown-shooter.authored-behavior-variant";
const VARIANT_VERSION = 1;
const REPLAY_MANIFEST_FORMAT = "ferrum2d.gameplay-replay.scenarios";
const REPLAY_FIXTURE_INDEX_FORMAT = "ferrum2d.gameplay-replay.fixture-index";
const REPLAY_COVERAGE_TAGS_FORMAT = "ferrum2d.gameplay-replay.coverage-tags";
const REPLAY_COVERAGE_TAGS_VERSION = 1;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_VARIANT_PATH = "examples/topdown-shooter/public/authored-behavior.variant.json";
const DEFAULT_REPLAY_MANIFEST_PATH = "tests/fixtures/gameplay-golden/scenarios.json";
const DEFAULT_ARTIFACT_REPORT_NAME = "gameplay-authoring-dry-run-report.json";
const REPORT_SCHEMA_PATH = resolve(REPO_ROOT, "schemas/gameplay-authoring-dry-run-report.schema.json");

const GAMEPLAY_STATE_COMMAND_PREFLIGHT_ENGINE = {
  set_gameplay_health: () => true,
  clear_gameplay_health: () => true,
  set_gameplay_damage: () => true,
  clear_gameplay_damage: () => true,
  set_gameplay_damage_reaction: () => true,
  set_gameplay_faction: () => true,
  clear_gameplay_faction: () => true,
  set_gameplay_lifetime: () => true,
  clear_gameplay_lifetime: () => true,
  set_gameplay_score_reward: () => true,
  clear_gameplay_score_reward: () => true,
  set_gameplay_pickup: () => true,
  clear_gameplay_pickup: () => true,
  set_gameplay_interaction: () => true,
  clear_gameplay_interaction: () => true,
  set_gameplay_timer_trigger: () => true,
  set_gameplay_timer_action_trigger: () => true,
  clear_gameplay_timer_trigger: () => true,
  set_gameplay_action_projectile: () => true,
  set_gameplay_action_projectile_with_target: () => true,
  set_gameplay_action_spawn_prefab: () => true,
  set_gameplay_action_dash: () => true,
  set_gameplay_action_dash_with_aim: () => true,
  set_gameplay_action_melee: () => true,
  set_gameplay_action_melee_with_target: () => true,
  clear_gameplay_actions: () => true,
  set_gameplay_movement_chase_player: () => true,
  set_gameplay_movement_chase_entity: () => true,
  clear_gameplay_movement: () => true,
  clear_gameplay_collision_reactions: () => true,
  add_gameplay_collision_damage: () => true,
  add_gameplay_collision_pickup: () => true,
  add_gameplay_collision_sound: () => true,
  add_gameplay_collision_sound_with_cooldown: () => true,
  add_gameplay_collision_sound_with_policy: () => true,
  add_gameplay_collision_sound_with_trigger: () => true,
  add_gameplay_collision_particle: () => true,
  add_gameplay_collision_particle_with_cooldown: () => true,
  add_gameplay_collision_particle_with_policy: () => true,
  add_gameplay_collision_particle_with_trigger: () => true,
  add_gameplay_collision_despawn: () => true,
};

const options = parseArgs(process.argv.slice(2));
const report = await createDryRunReport(options);
await validateReportSchema(report);
if (options.artifactDir !== undefined) {
  await writeReportArtifact(options.artifactDir, report);
}
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  process.exitCode = 1;
}

async function createDryRunReport(options) {
  const diagnostics = [];
  const reports = [];
  const errors = [];
  let dryRunSummary;
  try {
    dryRunSummary = await runGameplayAuthoringDryRun(options, diagnostics, reports);
  } catch (error) {
    const diagnostic = diagnosticReport(error);
    errors.push(errorSummary(error));
    diagnostics.push(diagnostic);
    reports.push(reportFromDiagnostic(diagnostic));
  }

  return {
    format: REPORT_FORMAT,
    version: REPORT_VERSION,
    ok: errors.length === 0 && diagnostics.length === 0,
    gameplayAuthoringDryRun: dryRunSummary ?? {
      variantPath: options.variantPath ?? resolve(REPO_ROOT, DEFAULT_VARIANT_PATH),
      diagnostics,
      reports,
    },
    ...(diagnostics.length === 0 ? {} : { diagnostics }),
    ...(reports.length === 0 ? {} : { reports }),
    ...(errors.length === 0 ? {} : { errors }),
  };
}

async function runGameplayAuthoringDryRun(options, diagnostics, reports) {
  const variantPath = options.variantPath ?? resolve(REPO_ROOT, DEFAULT_VARIANT_PATH);
  const replayManifestPath = options.replayManifestPath ?? resolve(REPO_ROOT, DEFAULT_REPLAY_MANIFEST_PATH);
  const variant = await readJson(variantPath);
  validateVariantEnvelope(variant, variantPath, diagnostics, reports);

  const baseGameSpecPath = resolve(dirname(variantPath), variant.extendsGameSpec);
  const baseGameSpec = await readJson(baseGameSpecPath);
  const resolvedGameSpec = resolveShooterGameSpec(baseGameSpec, {
    path: "gameplayAuthoring.variant.extendsGameSpec",
  });
  const ids = resolveGameplayBehaviorRuntimeIds(variant.ids, {
    path: "gameplayAuthoring.variant.ids",
    requiredItems: ["score"],
    requiredActions: ["primary", "dash", "collect-score", "summon-enemy"],
    requiredTimers: ["wake"],
  });
  const recipes = resolveBehaviorRecipeDocument(variant.behaviorRecipes, {
    path: "gameplayAuthoring.variant.behaviorRecipes",
  });
  const composition = resolveSceneCompositionSpec(variant.sceneComposition, {
    path: "gameplayAuthoring.variant.sceneComposition",
  });
  const dryRun = dryRunSceneBehaviorRecipes(composition, recipes, {
    path: "gameplayAuthoring.variant.binding",
    missingBehavior: "error",
  });
  diagnostics.push(...dryRun.diagnostics);
  reports.push(...dryRun.diagnostics.map(reportFromDiagnostic));
  const instances = dryRun.ok ? dryRun.plan.instances : instantiateSceneFragment(composition);
  const commands = dryRun.ok ? dryRun.plan.commands : [];
  const machines = resolveBehaviorStateMachineDocument(variant.behaviorStateMachines, {
    path: "gameplayAuthoring.variant.behaviorStateMachines",
    behaviorRecipes: recipes,
  });
  const installPlans = {};
  const machineSummaries = Object.keys(machines.machines).map((machineId) => {
    const plan = createBehaviorStateMachineRuntimeInstallPlan(machines, machineId, {
      behaviorRecipes: recipes,
      ids,
      path: `gameplayAuthoring.variant.behaviorStateMachines.machines.${machineId}`,
    });
    installPlans[machineId] = plan;
    return {
      id: machineId,
      initialState: plan.initial,
      initialStateId: plan.initialStateId,
      stateCount: plan.states.length,
      states: plan.states.map((state) => ({
        state: state.state,
        stateId: state.stateId,
        behaviorProfiles: state.behaviorProfiles,
      })),
      transitionCount: plan.transitions.length,
      transitions: plan.transitions.map((transition) => ({
        from: transition.from,
        to: transition.to,
        event: transition.event,
        tokenId: transition.tokenId,
      })),
    };
  });
  const stateCommandPreflight = createStateCommandPreflightSummary(
    variant,
    machines,
    recipes,
    ids,
    instances,
    installPlans,
    diagnostics,
    reports,
  );

  const replay = await validateReplayManifestLink(variant, replayManifestPath, diagnostics, reports);
  const commandsByType = countBy(commands.map((command) => command.type));
  return {
    variantPath,
    baseGameSpecPath,
    replayManifestPath,
    world: {
      width: resolvedGameSpec.worldWidth,
      height: resolvedGameSpec.worldHeight,
    },
    ids,
    instanceCount: instances.length,
    instances: instances.map((instance) => ({
      id: instance.id,
      prefab: instance.prefab,
      ...(instance.variant === undefined ? {} : { variant: instance.variant }),
      ...(instance.props?.behaviorRecipes === undefined ? {} : { behaviorRecipes: instance.props.behaviorRecipes }),
      ...(instance.props?.behaviorStateMachine === undefined ? {} : { behaviorStateMachine: instance.props.behaviorStateMachine }),
      ...(instance.props?.replayBody === undefined ? {} : { replayBody: instance.props.replayBody }),
      ...(instance.props?.runtimeEntity === undefined ? {} : { runtimeEntity: instance.props.runtimeEntity }),
    })),
    commandCount: commands.length,
    commandsByType,
    commands: commands.map((command) => ({
      entity: command.entity,
      type: command.type,
      recipe: command.recipe,
    })),
    machines: machineSummaries,
    stateCommandPreflight,
    replay,
    diagnostics,
    reports,
  };
}

function createStateCommandPreflightSummary(
  variant,
  machines,
  recipes,
  ids,
  instances,
  installPlans,
  diagnostics,
  reports,
) {
  const mode = variant.semantics?.fsmStateEntryMode === "manualReplaceSupported"
    ? "replaceSupported"
    : "overlay";
  const machineBindings = instances
    .map((instance, index) => ({
      instance,
      machineId: optionalString(instance.props?.behaviorStateMachine),
      handle: { entityId: index + 1, entityGeneration: 0 },
    }))
    .filter((binding) => binding.machineId !== undefined);
  const machinesSummary = machineBindings.map((binding) =>
    createMachineStateCommandPreflightSummary(
      binding.machineId,
      binding.instance.id,
      binding.handle,
      mode,
      machines,
      recipes,
      ids,
      installPlans[binding.machineId],
      variant.expected?.states?.[binding.machineId],
      diagnostics,
      reports,
    ),
  );
  return {
    mode,
    machineCount: machinesSummary.length,
    machines: machinesSummary,
  };
}

function createMachineStateCommandPreflightSummary(
  machineId,
  targetEntity,
  handle,
  mode,
  machines,
  recipes,
  ids,
  installPlan,
  expectedState,
  diagnostics,
  reports,
) {
  if (installPlan === undefined) {
    pushGameplayAuthoringReport(
      diagnostics,
      reports,
      `gameplayAuthoring.variant.stateCommandPreflight.${machineId}.installPlan`,
      `must have an FSM install plan for machine '${machineId}'`,
      "existing FSM install plan",
      undefined,
      "Fix the scene instance behaviorStateMachine reference or behaviorStateMachines document.",
    );
    return {
      id: machineId,
      targetEntity,
      entityHandle: handle,
      ok: false,
      states: [],
    };
  }
  const states = installPlan.states.map((state) =>
    createStateCommandPreflightEntry(
      machineId,
      targetEntity,
      handle,
      state,
      mode,
      machines,
      recipes,
      ids,
      installPlan,
      diagnostics,
      reports,
    ),
  );
  return {
    id: machineId,
    targetEntity,
    entityHandle: handle,
    initialState: installPlan.initial,
    initialStateId: installPlan.initialStateId,
    expectedState,
    ok: states.every((state) => state.ok),
    states,
  };
}

function createStateCommandPreflightEntry(
  machineId,
  targetEntity,
  handle,
  state,
  mode,
  machines,
  recipes,
  ids,
  installPlan,
  diagnostics,
  reports,
) {
  const path = `gameplayAuthoring.variant.stateCommandPreflight.${machineId}.${state.state}`;
  try {
    const plan = createBehaviorStateMachineStateCommandPlan(
      machines,
      recipes,
      installPlan,
      state.stateId,
      {
        path,
        entity: targetEntity,
      },
    );
    const preflight = preflightBehaviorStateMachineStateCommands(
      GAMEPLAY_STATE_COMMAND_PREFLIGHT_ENGINE,
      plan,
      handle,
      {
        path,
        entity: targetEntity,
        ids,
        mode,
      },
    );
    return {
      state: state.state,
      stateId: state.stateId,
      behaviorProfiles: preflight.plan.behaviorProfiles,
      targetEntity: preflight.plan.targetEntity,
      ok: true,
      commandCount: preflight.commands.length,
      commandTypes: preflight.commands.map((command) => command.type),
      resultCount: preflight.results.length,
      clearOperations: preflight.clearOperations,
    };
  } catch (error) {
    const diagnostic = diagnosticReport(error);
    diagnostics.push(diagnostic);
    reports.push(reportFromDiagnostic(diagnostic));
    return {
      state: state.state,
      stateId: state.stateId,
      targetEntity,
      ok: false,
      diagnostics: [diagnostic],
    };
  }
}

async function validateReplayManifestLink(variant, replayManifestPath, diagnostics, reports) {
  const replayManifest = await readReplayManifestWithCoverageTags(replayManifestPath);
  if (replayManifest.format !== REPLAY_MANIFEST_FORMAT) {
    pushGameplayAuthoringReport(diagnostics, reports,
      "gameplayAuthoring.replayManifest.format",
      `must be '${REPLAY_MANIFEST_FORMAT}'`,
      REPLAY_MANIFEST_FORMAT,
      replayManifest.format,
      "Use a gameplay replay scenarios manifest generated by the replay smoke workflow.",
    );
    return { replayManifestPath, linked: false };
  }
  const replayScenario = replayManifest.scenarios?.find((scenario) => scenario.id === variant.replayScenario);
  if (replayScenario === undefined) {
    pushGameplayAuthoringReport(diagnostics, reports,
      "gameplayAuthoring.variant.replayScenario",
      `references missing replay scenario '${variant.replayScenario}'`,
      "existing replay scenario id",
      variant.replayScenario,
      "Add the scenario to tests/fixtures/gameplay-golden/scenarios.json or update variant.replayScenario.",
    );
    return { replayManifestPath, linked: false, scenario: variant.replayScenario };
  }
  const fixtureIndexLink = await validateReplayFixtureIndexLink(
    replayManifest,
    replayManifestPath,
    replayScenario,
    variant,
    diagnostics,
    reports,
  );
  compareReplayExpected(
    replayScenario.expected?.replayHash,
    variant.expected?.replayHash,
    "gameplayAuthoring.variant.expected.replayHash",
    diagnostics,
    reports,
  );
  compareReplayExpected(
    replayScenario.expected?.finalScore,
    variant.expected?.finalScore,
    "gameplayAuthoring.variant.expected.finalScore",
    diagnostics,
    reports,
  );
  compareReplayExpected(
    replayScenario.expected?.eventFrame,
    variant.expected?.eventFrame,
    "gameplayAuthoring.variant.expected.eventFrame",
    diagnostics,
    reports,
  );
  compareReplayExpected(
    replayScenario.expected?.timerFrame,
    variant.expected?.timerFrame,
    "gameplayAuthoring.variant.expected.timerFrame",
    diagnostics,
    reports,
  );
  compareReplayExpected(
    replayScenario.expected?.eventKinds,
    variant.expected?.eventKinds,
    "gameplayAuthoring.variant.expected.eventKinds",
    diagnostics,
    reports,
  );
  compareReplayExpected(
    replayScenario.expected?.actionFailureFrame,
    variant.expected?.actionFailureFrame,
    "gameplayAuthoring.variant.expected.actionFailureFrame",
    diagnostics,
    reports,
  );
  compareReplayExpected(
    replayScenario.expected?.actionFailureEventKinds,
    variant.expected?.actionFailureEventKinds,
    "gameplayAuthoring.variant.expected.actionFailureEventKinds",
    diagnostics,
    reports,
  );
  compareReplayExpected(
    replayScenario.expected?.timerEventKinds,
    variant.expected?.timerEventKinds,
    "gameplayAuthoring.variant.expected.timerEventKinds",
    diagnostics,
    reports,
  );
  return {
    replayManifestPath,
    linked: true,
    scenario: variant.replayScenario,
    replayHash: replayScenario.expected?.replayHash,
    fixtureIndex: fixtureIndexLink,
  };
}

async function validateReplayFixtureIndexLink(replayManifest, replayManifestPath, replayScenario, variant, diagnostics, reports) {
  if (typeof replayManifest.fixtureIndexPath !== "string" || replayManifest.fixtureIndexPath.length === 0) {
    pushGameplayAuthoringReport(diagnostics, reports,
      "gameplayAuthoring.replayManifest.fixtureIndexPath",
      "must reference a fixture index",
      "tests/fixtures/gameplay-golden/fixture-index.json",
      replayManifest.fixtureIndexPath,
      "Add fixtureIndexPath to the replay scenario manifest so agents can inspect committed golden fixtures.",
    );
    return { linked: false };
  }

  const fixtureIndexPath = resolveReplayManifestPath(dirname(replayManifestPath), replayManifest.fixtureIndexPath);
  const fixtureIndex = await readReplayFixtureIndexWithCoverageTags(fixtureIndexPath);
  if (fixtureIndex.format !== REPLAY_FIXTURE_INDEX_FORMAT) {
    pushGameplayAuthoringReport(diagnostics, reports,
      "gameplayAuthoring.replayManifest.fixtureIndex.format",
      `must be '${REPLAY_FIXTURE_INDEX_FORMAT}'`,
      REPLAY_FIXTURE_INDEX_FORMAT,
      fixtureIndex.format,
      "Use the fixture index generated for tests/fixtures/gameplay-golden/scenarios.json.",
    );
    return { linked: false, fixtureIndexPath };
  }
  compareReplayExpected(
    fixtureIndex.coverageTagDefinitionsPath,
    replayManifest.coverageTagDefinitionsPath,
    "gameplayAuthoring.replayManifest.fixtureIndex.coverageTagDefinitionsPath",
    diagnostics,
    reports,
  );
  compareReplayExpected(
    fixtureIndex.coverageTagDefinitions,
    replayManifest.coverageTagDefinitions,
    "gameplayAuthoring.replayManifest.fixtureIndex.coverageTagDefinitions",
    diagnostics,
    reports,
  );
  compareReplayExpected(
    fixtureIndex.coverageTagGroups,
    replayManifest.coverageTagGroups,
    "gameplayAuthoring.replayManifest.fixtureIndex.coverageTagGroups",
    diagnostics,
    reports,
  );
  compareReplayExpected(
    fixtureIndex.deprecatedCoverageTags,
    replayManifest.deprecatedCoverageTags,
    "gameplayAuthoring.replayManifest.fixtureIndex.deprecatedCoverageTags",
    diagnostics,
    reports,
  );

  const fixture = fixtureIndex.fixtures?.find((candidate) => candidate.id === variant.replayScenario);
  if (fixture === undefined) {
    pushGameplayAuthoringReport(diagnostics, reports,
      "gameplayAuthoring.replayManifest.fixtureIndex.fixtures",
      `must include replay scenario '${variant.replayScenario}'`,
      variant.replayScenario,
      fixtureIndex.fixtures?.map((candidate) => candidate.id),
      "Add the scenario fixture to tests/fixtures/gameplay-golden/fixture-index.json.",
    );
    return { linked: false, fixtureIndexPath };
  }

  compareReplayExpected(
    fixture.fixturePath,
    replayScenario.fixturePath,
    "gameplayAuthoring.replayManifest.fixtureIndex.fixturePath",
    diagnostics,
    reports,
  );
  compareReplayExpected(
    fixture.description,
    replayScenario.description,
    "gameplayAuthoring.replayManifest.fixtureIndex.description",
    diagnostics,
    reports,
  );
  compareReplayExpected(
    fixture.coverageTags,
    replayScenario.coverageTags,
    "gameplayAuthoring.replayManifest.fixtureIndex.coverageTags",
    diagnostics,
    reports,
  );
  compareReplayExpected(
    fixture.replayHash,
    replayScenario.expected?.replayHash,
    "gameplayAuthoring.replayManifest.fixtureIndex.replayHash",
    diagnostics,
    reports,
  );
  return {
    linked: true,
    fixtureIndexPath,
    fixturePath: fixture.fixturePath,
    description: fixture.description,
    coverageTags: fixture.coverageTags,
    coverageTagDefinitionsPath: fixtureIndex.coverageTagDefinitionsPath,
    coverageTagDefinitions: fixtureIndex.coverageTagDefinitions,
    replayHash: fixture.replayHash,
  };
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
  if (typeof document.coverageTagDefinitionsPath === "string" && document.coverageTagDefinitionsPath.length > 0) {
    const coveragePath = resolveReplayManifestPath(documentDir, document.coverageTagDefinitionsPath);
    const coverage = await readJson(coveragePath);
    if (coverage.format !== REPLAY_COVERAGE_TAGS_FORMAT) {
      throw new Error(`${coveragePath}.format must be '${REPLAY_COVERAGE_TAGS_FORMAT}'`);
    }
    if (coverage.version !== REPLAY_COVERAGE_TAGS_VERSION) {
      throw new Error(`${coveragePath}.version must be ${REPLAY_COVERAGE_TAGS_VERSION}`);
    }
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
  assertCoverageTagDefinitions(document.coverageTagDefinitions, `${documentPath}.coverageTagDefinitions`);
  return {
    path: undefined,
    definitions: document.coverageTagDefinitions,
    groups: undefined,
    deprecatedTags: undefined,
  };
}

function assertCoverageTagDefinitions(value, label) {
  if (!isPlainRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  for (const [tag, description] of entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) {
      throw new Error(`${label}.${tag} key must be kebab-case`);
    }
    assertNonEmptyString(description, `${label}.${tag}`);
  }
}

function assertCoverageTags(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  const seen = new Set();
  for (const [index, tag] of value.entries()) {
    assertNonEmptyString(tag, `${label}[${index}]`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) {
      throw new Error(`${label}[${index}] must be kebab-case`);
    }
    if (seen.has(tag)) {
      throw new Error(`${label} must not include duplicate coverage tag '${tag}'`);
    }
    seen.add(tag);
  }
}

function assertCoverageTagGroups(value, label, definitions) {
  if (!isPlainRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  const groupedTags = new Set();
  for (const [group, spec] of entries) {
    const groupLabel = `${label}.${group}`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group)) {
      throw new Error(`${groupLabel} key must be kebab-case`);
    }
    if (!isPlainRecord(spec)) {
      throw new Error(`${groupLabel} must be an object`);
    }
    assertNonEmptyString(spec.description, `${groupLabel}.description`);
    assertCoverageTags(spec.tags, `${groupLabel}.tags`);
    for (const tag of spec.tags) {
      if (definitions[tag] === undefined) {
        throw new Error(`${groupLabel}.tags must reference defined coverage tag '${tag}'`);
      }
      groupedTags.add(tag);
    }
  }
  for (const tag of Object.keys(definitions)) {
    if (!groupedTags.has(tag)) {
      throw new Error(`${label} must include active coverage tag '${tag}' in at least one group`);
    }
  }
}

function assertDeprecatedCoverageTags(value, label, definitions) {
  if (!isPlainRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const [tag, description] of Object.entries(value)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) {
      throw new Error(`${label}.${tag} key must be kebab-case`);
    }
    if (definitions[tag] !== undefined) {
      throw new Error(`${label}.${tag} must not also be an active coverage tag`);
    }
    assertNonEmptyString(description, `${label}.${tag}`);
  }
}

function assertReplayCoverageTags(items, label, definitions, deprecatedTags) {
  if (!Array.isArray(items)) {
    throw new Error(`${label} must be an array`);
  }
  for (const [index, item] of items.entries()) {
    if (!isPlainRecord(item)) {
      throw new Error(`${label}[${index}] must be an object`);
    }
    assertCoverageTags(item.coverageTags, `${label}[${index}].coverageTags`);
    for (const tag of item.coverageTags) {
      if (definitions[tag] === undefined) {
        throw new Error(`${label}[${index}].coverageTags must reference defined coverage tag '${tag}'`);
      }
      if (deprecatedTags?.[tag] !== undefined) {
        throw new Error(`${label}[${index}].coverageTags must not use deprecated coverage tag '${tag}'`);
      }
    }
  }
}

function resolveReplayManifestPath(manifestDir, relativeOrAbsolutePath) {
  if (relativeOrAbsolutePath.startsWith("./") || relativeOrAbsolutePath.startsWith("../")) {
    return resolve(manifestDir, relativeOrAbsolutePath);
  }
  return resolve(REPO_ROOT, relativeOrAbsolutePath);
}

function compareReplayExpected(actual, expected, path, diagnostics, reports) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    pushGameplayAuthoringReport(
      diagnostics,
      reports,
      path,
      "must match replay manifest expected metadata",
      expected,
      actual,
      "Update the variant expected metadata or the replay manifest together so dry-run and replay smoke agree.",
    );
  }
}

function validateVariantEnvelope(variant, variantPath, diagnostics, reports) {
  if (!isPlainRecord(variant)) {
    pushGameplayAuthoringReport(diagnostics, reports, variantPath, "must be an object");
    return;
  }
  if (variant.format !== VARIANT_FORMAT) {
    pushGameplayAuthoringReport(diagnostics, reports, `${variantPath}.format`, `must be '${VARIANT_FORMAT}'`, VARIANT_FORMAT, variant.format);
  }
  if (variant.version !== VARIANT_VERSION) {
    pushGameplayAuthoringReport(diagnostics, reports, `${variantPath}.version`, `must be ${VARIANT_VERSION}`, VARIANT_VERSION, variant.version);
  }
  if (typeof variant.extendsGameSpec !== "string" || variant.extendsGameSpec.length === 0) {
    pushGameplayAuthoringReport(diagnostics, reports, `${variantPath}.extendsGameSpec`, "must be a non-empty string", "non-empty relative path", variant.extendsGameSpec);
  }
  if (typeof variant.replayScenario !== "string" || variant.replayScenario.length === 0) {
    pushGameplayAuthoringReport(diagnostics, reports, `${variantPath}.replayScenario`, "must be a non-empty string", "non-empty replay scenario id", variant.replayScenario);
  }
}

function pushGameplayAuthoringReport(diagnostics, reports, path, detail, expected, actual, suggestion) {
  const diagnostic = gameplayAuthoringDiagnostic(path, detail);
  diagnostics.push(diagnostic);
  reports.push({
    ...reportFromDiagnostic(diagnostic),
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
    suggestion,
  });
}

function gameplayAuthoringDiagnostic(path, detail) {
  return {
    code: "FERRUM_GAMEPLAY_AUTHORING_INVALID",
    message: `Invalid gameplay authoring data: kind=gameplay-authoring path=${JSON.stringify(path)} detail=${JSON.stringify(detail)}.`,
    context: {
      kind: "gameplay-authoring",
      path,
      detail,
    },
  };
}

function reportFromDiagnostic(diagnostic) {
  const path = diagnostic.context?.path ?? "gameplayAuthoring";
  const detail = diagnostic.context?.detail ?? diagnostic.message;
  return {
    kind: "gameplay-authoring",
    code: diagnostic.code,
    path,
    message: diagnostic.message,
    expected: "valid gameplay authoring data",
    actual: detail,
    suggestion: suggestionForDiagnostic(diagnostic),
  };
}

function suggestionForDiagnostic(diagnostic) {
  const detail = diagnostic.context?.detail ?? diagnostic.message;
  if (detail.includes("unknown behavior profile")) {
    return "Add the missing behavior profile under behaviorRecipes.entities or update the scene instance behaviorRecipes reference.";
  }
  if (detail.includes("must match replay manifest expected metadata")) {
    return "Update the variant expected metadata and replay manifest in the same change, then rerun gameplay replay smoke.";
  }
  if (detail.includes("missing replay scenario")) {
    return "Add the replay scenario to the manifest or update variant.replayScenario.";
  }
  return "Fix the JSON path reported by this diagnostic and rerun the dry-run report.";
}

function countBy(values) {
  const counts = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function errorSummary(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return {
    name: "Error",
    message: String(error),
  };
}

async function writeReportArtifact(artifactDir, report) {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    join(artifactDir, DEFAULT_ARTIFACT_REPORT_NAME),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

async function validateReportSchema(report) {
  const schema = await readJsonSchemaContract(REPORT_SCHEMA_PATH);
  validateJsonSchemaContract(schema, report, "gameplay-authoring-dry-run-report");
}

function parseArgs(args) {
  let variantPath;
  let replayManifestPath;
  let artifactDir = optionalEnvPath(process.env.FERRUM_GAMEPLAY_AUTHORING_ARTIFACT_DIR);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg.startsWith("--variant=")) {
      variantPath = arg.slice("--variant=".length);
      assertNonEmptyString(variantPath, "--variant");
      continue;
    }
    if (arg === "--variant") {
      variantPath = requiredArg(args, ++index, arg);
      continue;
    }
    if (arg.startsWith("--replay-manifest=")) {
      replayManifestPath = arg.slice("--replay-manifest=".length);
      assertNonEmptyString(replayManifestPath, "--replay-manifest");
      continue;
    }
    if (arg === "--replay-manifest") {
      replayManifestPath = requiredArg(args, ++index, arg);
      continue;
    }
    if (arg.startsWith("--artifact-dir=")) {
      artifactDir = arg.slice("--artifact-dir=".length);
      assertNonEmptyString(artifactDir, "--artifact-dir");
      continue;
    }
    if (arg === "--artifact-dir") {
      artifactDir = requiredArg(args, ++index, arg);
      continue;
    }
    throw new Error(`unsupported gameplay authoring dry-run option: ${arg}`);
  }
  return {
    variantPath: variantPath === undefined ? undefined : resolve(REPO_ROOT, variantPath),
    replayManifestPath: replayManifestPath === undefined ? undefined : resolve(REPO_ROOT, replayManifestPath),
    artifactDir: artifactDir === undefined ? undefined : resolve(REPO_ROOT, artifactDir),
  };
}

function requiredArg(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function optionalEnvPath(value) {
  return value === undefined || value.length === 0 ? undefined : value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
}

function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
