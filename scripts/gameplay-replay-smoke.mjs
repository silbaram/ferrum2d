#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import initWasm, {
  Engine,
  frame_telemetry_bytes,
  frame_telemetry_f64s,
  gameplay_event_bytes,
  gameplay_event_u32s,
  wasm_memory,
} from "../packages/ferrum-web/pkg/ferrum_core.js";
import { applyShooterGameSpec } from "../packages/ferrum-web/dist/gameSpec.js";
import {
  createBehaviorStateMachineRuntimeInstallPlan,
  applyGameplayBehaviorCommands,
  bindSceneBehaviorRecipes,
  dryRunSceneBehaviorRecipes,
  gameplayActionDiagnosticReports,
  gameplaySpawnDiagnosticReports,
  gameplayActionsForEvents,
  instantiateSceneFragment,
  resolveBehaviorRecipeDocument,
  resolveBehaviorStateMachineDocument,
  resolveGameplayBehaviorRuntimeIds,
  resolveSceneCompositionSpec,
} from "../packages/ferrum-web/dist/index.js";
import {
  compareGameplayReplayRuns,
  createGameplayReplayRun,
} from "../packages/ferrum-web/dist/gameplayReplay.js";
import {
  readJsonSchemaContract,
  validateJsonSchemaContract,
} from "./json-schema-contract.mjs";
import {
  decodeGameplayEvents,
  GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE,
  GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT,
  GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE,
  GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET,
  GAMEPLAY_EVENT_FLAG_CONSUMED_THIS_FRAME,
  GAMEPLAY_EVENT_FLAG_ONCE,
  GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
  GAMEPLAY_EVENT_FLAG_TILE_IMPACT_BOUNCED,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_X,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_X,
  GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT,
  GAMEPLAY_EVENT_KIND_ACTION_FAILED,
  GAMEPLAY_EVENT_KIND_BEHAVIOR_STATE_CHANGED,
  GAMEPLAY_EVENT_KIND_COLLISION_DAMAGE,
  GAMEPLAY_EVENT_KIND_COLLISION_DESPAWN,
  GAMEPLAY_EVENT_KIND_FACTION_DAMAGE_DENIED,
  GAMEPLAY_EVENT_KIND_INTERACTION,
  GAMEPLAY_EVENT_KIND_PICKUP_COLLECTED,
  GAMEPLAY_EVENT_KIND_PREFAB_SPAWNED,
  GAMEPLAY_EVENT_KIND_PRESENTATION_EFFECT,
  GAMEPLAY_EVENT_KIND_TILE_IMPACT,
  GAMEPLAY_EVENT_KIND_TIMER,
  GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE,
  U32S_PER_GAMEPLAY_EVENT,
} from "../packages/ferrum-web/dist/gameplayEventDecoder.js";
import { hashGameStateSnapshot } from "../packages/ferrum-web/dist/gameStateSnapshot.js";
import {
  buildActionFrameDiagnostics,
  buildSpawnFrameDiagnostics,
} from "../packages/ferrum-web/dist/engineFrameState.js";
import { F64S_PER_FRAME_TELEMETRY } from "../packages/ferrum-web/dist/wasmBridgeAbi.js";
import {
  BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY,
  BUILT_IN_SHOOTER_STATE_HEADER_FLOATS,
  BUILT_IN_SHOOTER_STATE_HEADER_U32S,
  BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY,
  BUILT_IN_SHOOTER_STATE_VERSION,
} from "../packages/ferrum-web/dist/builtInShooterStateSnapshot.js";

const GOLDEN_FIXTURE_FORMAT = "ferrum2d.gameplay-replay.golden";
const GOLDEN_FIXTURE_VERSION = 1;
const SMOKE_REPORT_FORMAT = "ferrum2d.gameplay-replay.smoke-report";
const SMOKE_REPORT_VERSION = 1;
const SCENARIO_MANIFEST_FORMAT = "ferrum2d.gameplay-replay.scenarios";
const SCENARIO_MANIFEST_VERSION = 1;
const FIXTURE_INDEX_FORMAT = "ferrum2d.gameplay-replay.fixture-index";
const FIXTURE_INDEX_VERSION = 1;
const COVERAGE_TAGS_FORMAT = "ferrum2d.gameplay-replay.coverage-tags";
const COVERAGE_TAGS_VERSION = 1;
const TOPDOWN_AUTHORED_BEHAVIOR_VARIANT_FORMAT = "ferrum2d.topdown-shooter.authored-behavior-variant";
const TOPDOWN_AUTHORED_BEHAVIOR_VARIANT_VERSION = 1;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SCENARIO_MANIFEST_PATH = "tests/fixtures/gameplay-golden/scenarios.json";
const DEFAULT_ARTIFACT_REPORT_NAME = "gameplay-replay-smoke-report.json";
const SMOKE_REPORT_SCHEMA_PATH = resolve(REPO_ROOT, "schemas/gameplay-replay-smoke-report.schema.json");
const FIXED_DELTA_SECONDS = 1 / 60;
const PHYSICS_BODY_STATIC = 0;
const PHYSICS_BODY_DYNAMIC = 2;
const PHYSICS_LAYER_ENEMY = 1;
const PHYSICS_LAYER_BULLET = 2;
const PHYSICS_LAYER_WALL = 3;
const PHYSICS_LAYER_PICKUP = 4;
const COLLISION_TARGET_OTHER = 1;
const GAMEPLAY_PICKUP_SCORE = 1;
const INPUT_ACTION_CONTROL_ENTER = 2;
const INPUT_ACTION_ACTIVATION_PRESSED = 2;
const DASH_AIM_INPUT = 0;
const DASH_AIM_TARGET_PLAYER = 1;
const PROJECTILE_AIM_INPUT = 0;
const PROJECTILE_AIM_TARGET_PLAYER = 1;
const PROJECTILE_COLLISION_TARGET_ENEMIES = 0;
const PROJECTILE_COLLISION_TARGET_PLAYER = 1;
const MELEE_TARGET_ENEMIES = 0;
const MELEE_TARGET_PLAYER = 1;
const SPAWN_DIAGNOSTIC_METRICS = Object.freeze([
  "commandsDrained",
  "projectileSpawns",
  "projectileArcsApplied",
  "projectileShootAudioEventsPushed",
  "prefabSpawns",
  "prefabSpawnedPayloads",
  "prefabSpawnedEventsPushed",
]);
const TEXTURE_IDS = Object.freeze({
  player: 1,
  enemy: 2,
  bullet: 3,
});
const SOUND_IDS = Object.freeze({
  shoot: 1,
  hit: 2,
  gameOver: 3,
});
const TOPDOWN_GOLDEN_SPEC = Object.freeze({
  world: { width: 800, height: 480 },
  player: { speed: 180 },
  enemies: {
    speed: 1,
    spawnInterval: 0.05,
    behavior: "static",
    spawnPattern: "edge",
    health: 1,
    scoreReward: 1,
    waves: [{ duration: 4, spawnInterval: 0.05, enemyCount: 1, spawnPattern: "edge" }],
  },
  weapons: {
    bulletSpeed: 900,
    cooldown: 0.5,
    lifetime: 2,
    damage: 1,
  },
  prefabs: {
    player: { width: 32, height: 32 },
    enemy: { width: 120, height: 120 },
    bullet: { width: 48, height: 48 },
  },
  camera: { preset: "follow" },
});
const TOPDOWN_AUTHORED_SPEC = Object.freeze({
  world: { width: 800, height: 480 },
  player: { speed: 180 },
  enemies: {
    speed: 1,
    spawnInterval: 999,
    behavior: "static",
    spawnPattern: "edge",
    health: 1,
    scoreReward: 1,
    waves: [{ duration: 4, spawnInterval: 999, enemyCount: 1, spawnPattern: "edge" }],
  },
  weapons: {
    bulletSpeed: 900,
    cooldown: 10,
    lifetime: 2,
    damage: 1,
  },
  prefabs: {
    player: { width: 32, height: 32 },
    enemy: { width: 32, height: 32 },
    bullet: { width: 16, height: 16 },
  },
  camera: { preset: "follow" },
});
const SCENARIO_RUNNERS = Object.freeze({
  exampleTopdownBasic: {
    run: runTopdownGoldenReplay,
    validateFixture: validateTopdownGoldenFixture,
    validateOutcome: validateBasicScenarioOutcome,
  },
  exampleTopdownAuthoredBehavior: {
    run: runTopdownAuthoredBehaviorReplay,
    validateFixture: validateTopdownAuthoredFixture,
    validateOutcome: validateAuthoredScenarioOutcome,
  },
  playerDamageCollision: {
    run: runTopdownAuthoredPlayerDamageCollisionReplay,
    validateFixture: validateTopdownAuthoredPlayerDamageCollisionFixture,
    validateOutcome: validateAuthoredPlayerDamageCollisionScenarioOutcome,
  },
  projectileTileImpactFsmAuthored: {
    run: runTopdownAuthoredProjectileTileImpactFsmReplay,
    validateFixture: validateTopdownAuthoredProjectileTileImpactFsmFixture,
    validateOutcome: validateAuthoredProjectileTileImpactFsmScenarioOutcome,
  },
  projectileHomingNearestTag: {
    run: runTopdownHomingMissileReplay,
    validateFixture: validateTopdownHomingMissileFixture,
    validateOutcome: validateHomingMissileScenarioOutcome,
  },
  projectileAreaDamageEntityImpact: {
    run: runTopdownExplosiveProjectileReplay,
    validateFixture: validateTopdownExplosiveProjectileFixture,
    validateOutcome: validateExplosiveProjectileScenarioOutcome,
  },
  projectileAreaDamageTileImpact: {
    run: runTopdownTileImpactAreaDamageReplay,
    validateFixture: validateTopdownTileImpactAreaDamageFixture,
    validateOutcome: validateTileImpactAreaDamageScenarioOutcome,
  },
  waveActionSpawnPrefab: {
    run: runTopdownWaveActionTriggerReplay,
    validateFixture: validateTopdownWaveActionFixture,
    validateOutcome: validateWaveActionScenarioOutcome,
  },
  fsmStateEnterSpawnPrefab: {
    run: runTopdownStateEnterActionTriggerReplay,
    validateFixture: validateTopdownStateEnterActionFixture,
    validateOutcome: validateStateEnterActionScenarioOutcome,
  },
  fsmStateEnterDashAction: {
    run: runTopdownStateEnterDashActionTriggerReplay,
    validateFixture: validateTopdownStateEnterDashActionFixture,
    validateOutcome: validateStateEnterDashActionScenarioOutcome,
  },
  fsmStateEnterProjectileAction: {
    run: runTopdownStateEnterProjectileActionTriggerReplay,
    validateFixture: validateTopdownStateEnterProjectileActionFixture,
    validateOutcome: validateStateEnterProjectileActionScenarioOutcome,
  },
  fsmStateEnterMeleeAction: {
    run: runTopdownStateEnterMeleeActionTriggerReplay,
    validateFixture: validateTopdownStateEnterMeleeActionFixture,
    validateOutcome: validateStateEnterMeleeActionScenarioOutcome,
  },
});

const options = parseArgs(process.argv.slice(2));
const scenarioRuns = [];
const errors = [];
try {
  const scenarioManifest = await readScenarioManifest(options.manifestPath, {
    allowMissingFixtureIndex: options.update,
  });
  await initSmokeWasm();
  for (const scenarioDraft of scenariosToRun(options, scenarioManifest)) {
    const scenario = await materializeScenarioVariant(scenarioDraft);
    const actual = runDeterministicScenario(scenario);
    const fixturePath = options.fixturePath ?? scenario.fixturePath;
    const runSummary = createScenarioRunSummary(actual, fixturePath, {
      phase: options.update ? "fixture-update" : "fixture-read",
      passed: false,
    });
    scenarioRuns.push(runSummary);
    assertSpawnExpectationPatchCount(runSummary, scenario);

    if (options.update) {
      await writeGoldenFixture(fixturePath, actual);
      Object.assign(runSummary, {
        frames: actual.run.snapshots.map((snapshot) => snapshot.frame),
        updated: true,
        passed: true,
      });
      delete runSummary.phase;
      continue;
    }

    runSummary.phase = "fixture-read";
    const expected = await readGoldenFixture(fixturePath, scenario);
    runSummary.phase = "manifest-fixture-hash";
    assert.equal(
      expected.run.replayHash,
      scenario.expected.replayHash,
      `${scenario.manifestPath}.scenarios[${scenario.manifestIndex}].expected.replayHash must match fixture replay`,
    );
    runSummary.phase = "golden-compare";
    const comparison = compareGameplayReplayRuns(expected.run, actual.run);
    if (!comparison.passed) {
      Object.assign(runSummary, {
        expectedHash: expected.run.replayHash,
        comparison,
        passed: false,
      });
      throw new Error(`gameplay replay golden mismatch:\n${JSON.stringify(runSummary, null, 2)}`);
    }
    runSummary.phase = "manifest-actual-hash";
    assert.equal(
      actual.run.replayHash,
      scenario.expected.replayHash,
      `${scenario.manifestPath}.scenarios[${scenario.manifestIndex}].expected.replayHash must match actual replay`,
    );
    Object.assign(runSummary, {
      passed: true,
    });
    delete runSummary.phase;
  }
  if (options.update && scenarioManifest.fixtureIndexPath !== undefined) {
    await writeScenarioFixtureIndex(scenarioManifest.fixtureIndexPath, scenarioManifest);
  }
} catch (error) {
  const scenarioRun = errorScenarioRun(error);
  if (scenarioRun !== undefined) {
    scenarioRuns.push(scenarioRun);
  }
  errors.push(errorSummary(error));
  process.exitCode = 1;
}
const smokeReport = createSmokeReport(scenarioRuns, errors);
if (scenarioRuns.length === 0 && errors.length > 0) {
  console.error(errors[0].message);
  process.exit(process.exitCode ?? 1);
}
await validateSmokeReportSchema(smokeReport);
if (options.artifactDir !== undefined) {
  await writeSmokeReportArtifact(options.artifactDir, smokeReport);
}
console.log(JSON.stringify(smokeReport, null, 2));
if (errors.length > 0) {
  console.error(errors[0].message);
}

async function initSmokeWasm() {
  const wasmBytes = await readFile(new URL("../packages/ferrum-web/pkg/ferrum_core_bg.wasm", import.meta.url));
  await initWasm({ module_or_path: wasmBytes });
  assert.equal(gameplay_event_u32s(), U32S_PER_GAMEPLAY_EVENT, "gameplay event ABI u32 stride must match TS decoder");
  assert.equal(gameplay_event_bytes(), U32S_PER_GAMEPLAY_EVENT * Uint32Array.BYTES_PER_ELEMENT, "gameplay event ABI byte stride must match TS decoder");
  assert.equal(frame_telemetry_f64s(), F64S_PER_FRAME_TELEMETRY, "frame telemetry ABI f64 stride must match TS decoder");
  assert.equal(frame_telemetry_bytes(), F64S_PER_FRAME_TELEMETRY * Float64Array.BYTES_PER_ELEMENT, "frame telemetry ABI byte stride must match TS decoder");
}

function runDeterministicScenario(scenario) {
  const first = scenario.run(scenario);
  const firstWithScenarioMetadata = replayWithScenarioMetadata(first, scenario);
  scenario.validateOutcome(first, "actual replay");
  assertSpawnDiagnosticExpectations(first, "actual replay");
  const second = scenario.run(scenario);
  scenario.validateOutcome(second, "repeat actual replay");
  assertSpawnDiagnosticExpectations(second, "repeat actual replay");
  const comparison = compareGameplayReplayRuns(first.run, second.run);
  if (!comparison.passed) {
    const runSummary = createScenarioRunSummary(firstWithScenarioMetadata, undefined, {
      phase: "determinism-compare",
      repeatHash: second.run.replayHash,
      comparison,
      passed: false,
    });
    throw gameplayReplaySmokeError(
      `gameplay replay scenario is not deterministic within the same build:\n${JSON.stringify({
        scenario: first.scenario,
        firstHash: first.run.replayHash,
        secondHash: second.run.replayHash,
        comparison,
      }, null, 2)}`,
      runSummary,
    );
  }
  return firstWithScenarioMetadata;
}

function replayWithScenarioMetadata(replay, scenario) {
  return {
    ...replay,
    manifestPath: relativeManifestPath(scenario.manifestPath),
    manifestIndex: scenario.manifestIndex,
  };
}

function runTopdownGoldenReplay(scenario) {
  const engine = new Engine();
  try {
    engine.set_viewport_size(800, 480);
    engine.set_texture_ids(TEXTURE_IDS.player, TEXTURE_IDS.enemy, TEXTURE_IDS.bullet);
    engine.set_sound_ids(SOUND_IDS.shoot, SOUND_IDS.hit, SOUND_IDS.gameOver);
    applyShooterGameSpec(engine, TOPDOWN_GOLDEN_SPEC);
    engine.reset_game();

    const snapshots = [];
    const actionDiagnostics = [];
    const spawnDiagnostics = createSpawnDiagnosticsCollector(scenario);
    appendSnapshot(engine, snapshots, 0, { actionDiagnostics, spawnDiagnostics });
    for (let frame = 0; frame < scenario.frameCount; frame += 1) {
      applyFrameInput(engine, frame, scenario.input.events);
      engine.update_frame(FIXED_DELTA_SECONDS, false, true, false);
      const nextFrame = frame + 1;
      if (scenario.captureFrames.includes(nextFrame)) {
        appendSnapshot(engine, snapshots, nextFrame, { actionDiagnostics, spawnDiagnostics });
      }
    }
    return {
      format: GOLDEN_FIXTURE_FORMAT,
      version: GOLDEN_FIXTURE_VERSION,
      scenario: scenario.id,
      input: {
        frameCount: scenario.frameCount,
        fixedDeltaSeconds: FIXED_DELTA_SECONDS,
        captureFrames: scenario.captureFrames,
        events: scenario.input.events,
      },
      run: createGameplayReplayRun(snapshots),
      actionDiagnostics,
      spawnDiagnostics,
    };
  } finally {
    engine.free();
  }
}

function runTopdownAuthoredBehaviorReplay(scenario) {
  const engine = new Engine();
  try {
    engine.set_viewport_size(800, 480);
    engine.set_texture_ids(TEXTURE_IDS.player, TEXTURE_IDS.enemy, TEXTURE_IDS.bullet);
    engine.set_sound_ids(SOUND_IDS.shoot, SOUND_IDS.hit, SOUND_IDS.gameOver);
    applyShooterGameSpec(engine, TOPDOWN_AUTHORED_SPEC);
    engine.reset_game();

    const snapshots = [];
    const actionDiagnostics = [];
    const spawnDiagnostics = createSpawnDiagnosticsCollector(scenario);
    let handles;
    appendSnapshot(engine, snapshots, 0, { actionDiagnostics, spawnDiagnostics });
    for (let frame = 0; frame < scenario.frameCount; frame += 1) {
      applyFrameInput(engine, frame, scenario.input.events);
      engine.update_frame(FIXED_DELTA_SECONDS, false, true, false);
      const nextFrame = frame + 1;
      const authoringEvent = authoringEventForFrame(scenario, nextFrame, "afterFrameUpdate");
      if (authoringEvent !== undefined) {
        handles = installAuthoredBehaviorScenario(engine, {
          bodies: authoringEvent.bodies,
          components: authoringEvent.components,
        }, scenario.variant);
      }
      if (scenario.captureFrames.includes(nextFrame)) {
        appendSnapshot(engine, snapshots, nextFrame, withActionDiagnostics(
          authoredSnapshotOptions(engine, handles),
          actionDiagnostics,
          spawnDiagnostics,
        ));
      }
    }
    setEngineInput(engine, emptyInputState());

    return {
      format: GOLDEN_FIXTURE_FORMAT,
      version: GOLDEN_FIXTURE_VERSION,
      scenario: scenario.id,
      input: {
        frameCount: scenario.frameCount,
        fixedDeltaSeconds: FIXED_DELTA_SECONDS,
        captureFrames: scenario.captureFrames,
        events: scenario.input.events,
      },
      run: createGameplayReplayRun(snapshots),
      actionDiagnostics,
      spawnDiagnostics,
    };
  } finally {
    engine.free();
  }
}

function runTopdownAuthoredPlayerDamageCollisionReplay(scenario) {
  const engine = new Engine();
  try {
    engine.set_viewport_size(800, 480);
    engine.set_texture_ids(TEXTURE_IDS.player, TEXTURE_IDS.enemy, TEXTURE_IDS.bullet);
    engine.set_sound_ids(SOUND_IDS.shoot, SOUND_IDS.hit, SOUND_IDS.gameOver);
    applyShooterGameSpec(engine, TOPDOWN_AUTHORED_SPEC);
    engine.reset_game();

    const snapshots = [];
    const actionDiagnostics = [];
    const spawnDiagnostics = createSpawnDiagnosticsCollector(scenario);
    let handles;
    appendSnapshot(engine, snapshots, 0, { actionDiagnostics, spawnDiagnostics });
    for (let frame = 0; frame < scenario.frameCount; frame += 1) {
      applyFrameInput(engine, frame, scenario.input.events);
      engine.update_frame(FIXED_DELTA_SECONDS, false, true, false);
      const nextFrame = frame + 1;
      const authoringEvent = authoringEventForFrame(scenario, nextFrame, "afterFrameUpdate");
      if (authoringEvent !== undefined) {
        handles = installAuthoredPlayerDamageCollisionScenario(engine, {
          bodies: authoringEvent.bodies,
          components: authoringEvent.components,
        });
      }
      if (scenario.captureFrames.includes(nextFrame)) {
        appendSnapshot(engine, snapshots, nextFrame, withActionDiagnostics(
          authoredPlayerDamageCollisionSnapshotOptions(engine, handles),
          actionDiagnostics,
          spawnDiagnostics,
        ));
      }
    }
    setEngineInput(engine, emptyInputState());

    return {
      format: GOLDEN_FIXTURE_FORMAT,
      version: GOLDEN_FIXTURE_VERSION,
      scenario: scenario.id,
      input: {
        frameCount: scenario.frameCount,
        fixedDeltaSeconds: FIXED_DELTA_SECONDS,
        captureFrames: scenario.captureFrames,
        events: scenario.input.events,
      },
      run: createGameplayReplayRun(snapshots),
      actionDiagnostics,
      spawnDiagnostics,
    };
  } finally {
    engine.free();
  }
}

function runTopdownAuthoredProjectileTileImpactFsmReplay(scenario) {
  const engine = new Engine();
  try {
    engine.set_viewport_size(800, 480);
    engine.set_texture_ids(TEXTURE_IDS.player, TEXTURE_IDS.enemy, TEXTURE_IDS.bullet);
    engine.set_sound_ids(SOUND_IDS.shoot, SOUND_IDS.hit, SOUND_IDS.gameOver);
    applyShooterGameSpec(engine, TOPDOWN_AUTHORED_SPEC);
    engine.reset_game();

    const snapshots = [];
    const actionDiagnostics = [];
    const spawnDiagnostics = createSpawnDiagnosticsCollector(scenario);
    let projectile;
    appendSnapshot(engine, snapshots, 0, { actionDiagnostics, spawnDiagnostics });
    for (let frame = 0; frame < scenario.frameCount; frame += 1) {
      applyFrameInput(engine, frame, scenario.input.events);
      engine.update_frame(FIXED_DELTA_SECONDS, false, true, false);
      const nextFrame = frame + 1;
      const authoringEvent = authoringEventForFrame(scenario, nextFrame, "afterFrameUpdate");
      if (authoringEvent !== undefined) {
        projectile = installAuthoredProjectileTileImpactFsmScenario(engine, scenario.authoredProjectileTileImpactFsm);
      }
      if (scenario.captureFrames.includes(nextFrame)) {
        appendSnapshot(engine, snapshots, nextFrame, withActionDiagnostics(
          authoredProjectileTileImpactFsmSnapshotOptions(engine, projectile),
          actionDiagnostics,
          spawnDiagnostics,
        ));
      }
    }
    setEngineInput(engine, emptyInputState());

    return {
      format: GOLDEN_FIXTURE_FORMAT,
      version: GOLDEN_FIXTURE_VERSION,
      scenario: scenario.id,
      input: {
        frameCount: scenario.frameCount,
        fixedDeltaSeconds: FIXED_DELTA_SECONDS,
        captureFrames: scenario.captureFrames,
        events: scenario.input.events,
      },
      run: createGameplayReplayRun(snapshots),
      actionDiagnostics,
      spawnDiagnostics,
    };
  } finally {
    engine.free();
  }
}

function runTopdownHomingMissileReplay(scenario) {
  const engine = new Engine();
  try {
    engine.set_viewport_size(800, 480);
    engine.set_texture_ids(TEXTURE_IDS.player, TEXTURE_IDS.enemy, TEXTURE_IDS.bullet);
    engine.set_sound_ids(SOUND_IDS.shoot, SOUND_IDS.hit, SOUND_IDS.gameOver);
    applyShooterGameSpec(engine, TOPDOWN_AUTHORED_SPEC);
    engine.reset_game();

    const snapshots = [];
    const actionDiagnostics = [];
    const spawnDiagnostics = createSpawnDiagnosticsCollector(scenario);
    let homing;
    appendSnapshot(engine, snapshots, 0, { actionDiagnostics, spawnDiagnostics });
    for (let frame = 0; frame < scenario.frameCount; frame += 1) {
      applyFrameInput(engine, frame, scenario.input.events);
      engine.update_frame(FIXED_DELTA_SECONDS, false, true, false);
      const nextFrame = frame + 1;
      const authoringEvent = authoringEventForFrame(scenario, nextFrame, "afterFrameUpdate");
      if (authoringEvent !== undefined) {
        homing = installHomingMissileScenario(engine, scenario.homingMissile);
      }
      if (scenario.captureFrames.includes(nextFrame)) {
        appendSnapshot(engine, snapshots, nextFrame, withActionDiagnostics(
          homingMissileSnapshotOptions(engine, homing),
          actionDiagnostics,
          spawnDiagnostics,
        ));
      }
    }
    setEngineInput(engine, emptyInputState());

    return {
      format: GOLDEN_FIXTURE_FORMAT,
      version: GOLDEN_FIXTURE_VERSION,
      scenario: scenario.id,
      input: {
        frameCount: scenario.frameCount,
        fixedDeltaSeconds: FIXED_DELTA_SECONDS,
        captureFrames: scenario.captureFrames,
        events: scenario.input.events,
      },
      run: createGameplayReplayRun(snapshots),
      actionDiagnostics,
      spawnDiagnostics,
    };
  } finally {
    engine.free();
  }
}

function runTopdownExplosiveProjectileReplay(scenario) {
  const engine = new Engine();
  try {
    engine.set_viewport_size(800, 480);
    engine.set_texture_ids(TEXTURE_IDS.player, TEXTURE_IDS.enemy, TEXTURE_IDS.bullet);
    engine.set_sound_ids(SOUND_IDS.shoot, SOUND_IDS.hit, SOUND_IDS.gameOver);
    applyShooterGameSpec(engine, TOPDOWN_AUTHORED_SPEC);
    engine.reset_game();

    const snapshots = [];
    const actionDiagnostics = [];
    const spawnDiagnostics = createSpawnDiagnosticsCollector(scenario);
    let explosive;
    appendSnapshot(engine, snapshots, 0, { actionDiagnostics, spawnDiagnostics });
    for (let frame = 0; frame < scenario.frameCount; frame += 1) {
      applyFrameInput(engine, frame, scenario.input.events);
      engine.update_frame(FIXED_DELTA_SECONDS, false, true, false);
      const nextFrame = frame + 1;
      const authoringEvent = authoringEventForFrame(scenario, nextFrame, "afterFrameUpdate");
      if (authoringEvent !== undefined) {
        explosive = installExplosiveProjectileScenario(engine, scenario.explosiveProjectile);
      }
      if (scenario.captureFrames.includes(nextFrame)) {
        appendSnapshot(engine, snapshots, nextFrame, withActionDiagnostics(
          explosiveProjectileSnapshotOptions(engine, explosive),
          actionDiagnostics,
          spawnDiagnostics,
        ));
      }
    }
    setEngineInput(engine, emptyInputState());

    return {
      format: GOLDEN_FIXTURE_FORMAT,
      version: GOLDEN_FIXTURE_VERSION,
      scenario: scenario.id,
      input: {
        frameCount: scenario.frameCount,
        fixedDeltaSeconds: FIXED_DELTA_SECONDS,
        captureFrames: scenario.captureFrames,
        events: scenario.input.events,
      },
      run: createGameplayReplayRun(snapshots),
      actionDiagnostics,
      spawnDiagnostics,
    };
  } finally {
    engine.free();
  }
}

function runTopdownTileImpactAreaDamageReplay(scenario) {
  const engine = new Engine();
  try {
    engine.set_viewport_size(800, 480);
    engine.set_texture_ids(TEXTURE_IDS.player, TEXTURE_IDS.enemy, TEXTURE_IDS.bullet);
    engine.set_sound_ids(SOUND_IDS.shoot, SOUND_IDS.hit, SOUND_IDS.gameOver);
    applyShooterGameSpec(engine, TOPDOWN_AUTHORED_SPEC);
    engine.reset_game();

    const snapshots = [];
    const actionDiagnostics = [];
    const spawnDiagnostics = createSpawnDiagnosticsCollector(scenario);
    let authored;
    appendSnapshot(engine, snapshots, 0, { actionDiagnostics, spawnDiagnostics });
    for (let frame = 0; frame < scenario.frameCount; frame += 1) {
      applyFrameInput(engine, frame, scenario.input.events);
      engine.update_frame(FIXED_DELTA_SECONDS, false, true, false);
      const nextFrame = frame + 1;
      const authoringEvent = authoringEventForFrame(scenario, nextFrame, "afterFrameUpdate");
      if (authoringEvent !== undefined) {
        authored = installTileImpactAreaDamageScenario(engine, scenario.tileImpactAreaDamage);
      }
      if (scenario.captureFrames.includes(nextFrame)) {
        appendSnapshot(engine, snapshots, nextFrame, withActionDiagnostics(
          tileImpactAreaDamageSnapshotOptions(engine, authored),
          actionDiagnostics,
          spawnDiagnostics,
        ));
      }
    }
    setEngineInput(engine, emptyInputState());

    return {
      format: GOLDEN_FIXTURE_FORMAT,
      version: GOLDEN_FIXTURE_VERSION,
      scenario: scenario.id,
      input: {
        frameCount: scenario.frameCount,
        fixedDeltaSeconds: FIXED_DELTA_SECONDS,
        captureFrames: scenario.captureFrames,
        events: scenario.input.events,
      },
      run: createGameplayReplayRun(snapshots),
      actionDiagnostics,
      spawnDiagnostics,
    };
  } finally {
    engine.free();
  }
}

function runTopdownWaveActionTriggerReplay(scenario) {
  const engine = new Engine();
  try {
    engine.set_viewport_size(800, 480);
    engine.set_texture_ids(TEXTURE_IDS.player, TEXTURE_IDS.enemy, TEXTURE_IDS.bullet);
    engine.set_sound_ids(SOUND_IDS.shoot, SOUND_IDS.hit, SOUND_IDS.gameOver);
    applyShooterGameSpec(engine, TOPDOWN_AUTHORED_SPEC);
    engine.reset_game();

    const source = {
      entityId: engine.built_in_shooter_player_entity_id(),
      entityGeneration: engine.built_in_shooter_player_entity_generation(),
    };
    installWaveActionTriggerScenario(engine, source, scenario.waveAction);

    const snapshots = [];
    const actionDiagnostics = [];
    const spawnDiagnostics = createSpawnDiagnosticsCollector(scenario);
    appendSnapshot(engine, snapshots, 0, withActionDiagnostics(
      waveActionSnapshotOptions(engine, source),
      actionDiagnostics,
      spawnDiagnostics,
    ));
    for (let frame = 0; frame < scenario.frameCount; frame += 1) {
      applyFrameInput(engine, frame, scenario.input.events);
      engine.update_frame(FIXED_DELTA_SECONDS, false, true, false);
      const nextFrame = frame + 1;
      if (scenario.captureFrames.includes(nextFrame)) {
        appendSnapshot(engine, snapshots, nextFrame, withActionDiagnostics(
          waveActionSnapshotOptions(engine, source),
          actionDiagnostics,
          spawnDiagnostics,
        ));
      }
    }
    setEngineInput(engine, emptyInputState());

    return {
      format: GOLDEN_FIXTURE_FORMAT,
      version: GOLDEN_FIXTURE_VERSION,
      scenario: scenario.id,
      input: {
        frameCount: scenario.frameCount,
        fixedDeltaSeconds: FIXED_DELTA_SECONDS,
        captureFrames: scenario.captureFrames,
        events: scenario.input.events,
      },
      run: createGameplayReplayRun(snapshots),
      actionDiagnostics,
      spawnDiagnostics,
    };
  } finally {
    engine.free();
  }
}

function runTopdownStateEnterActionTriggerReplay(scenario) {
  const engine = new Engine();
  try {
    engine.set_viewport_size(800, 480);
    engine.set_texture_ids(TEXTURE_IDS.player, TEXTURE_IDS.enemy, TEXTURE_IDS.bullet);
    engine.set_sound_ids(SOUND_IDS.shoot, SOUND_IDS.hit, SOUND_IDS.gameOver);
    applyShooterGameSpec(engine, TOPDOWN_AUTHORED_SPEC);
    engine.reset_game();

    const snapshots = [];
    const actionDiagnostics = [];
    const spawnDiagnostics = createSpawnDiagnosticsCollector(scenario);
    let source;
    appendSnapshot(engine, snapshots, 0, { actionDiagnostics, spawnDiagnostics });
    for (let frame = 0; frame < scenario.frameCount; frame += 1) {
      applyFrameInput(engine, frame, scenario.input.events);
      engine.update_frame(FIXED_DELTA_SECONDS, false, true, false);
      const nextFrame = frame + 1;
      const authoringEvent = authoringEventForFrame(scenario, nextFrame, "afterFrameUpdate");
      if (authoringEvent !== undefined) {
        source = installStateEnterActionScenario(engine, scenario.stateEnterAction);
      }
      if (scenario.captureFrames.includes(nextFrame)) {
        appendSnapshot(engine, snapshots, nextFrame, withActionDiagnostics(
          stateEnterActionSnapshotOptions(engine, source),
          actionDiagnostics,
          spawnDiagnostics,
        ));
      }
    }
    setEngineInput(engine, emptyInputState());

    return {
      format: GOLDEN_FIXTURE_FORMAT,
      version: GOLDEN_FIXTURE_VERSION,
      scenario: scenario.id,
      input: {
        frameCount: scenario.frameCount,
        fixedDeltaSeconds: FIXED_DELTA_SECONDS,
        captureFrames: scenario.captureFrames,
        events: scenario.input.events,
      },
      run: createGameplayReplayRun(snapshots),
      actionDiagnostics,
      spawnDiagnostics,
    };
  } finally {
    engine.free();
  }
}

function runTopdownStateEnterDashActionTriggerReplay(scenario) {
  const engine = new Engine();
  try {
    engine.set_viewport_size(800, 480);
    engine.set_texture_ids(TEXTURE_IDS.player, TEXTURE_IDS.enemy, TEXTURE_IDS.bullet);
    engine.set_sound_ids(SOUND_IDS.shoot, SOUND_IDS.hit, SOUND_IDS.gameOver);
    applyShooterGameSpec(engine, TOPDOWN_AUTHORED_SPEC);
    engine.reset_game();

    const snapshots = [];
    const actionDiagnostics = [];
    const spawnDiagnostics = createSpawnDiagnosticsCollector(scenario);
    let source;
    appendSnapshot(engine, snapshots, 0, { actionDiagnostics, spawnDiagnostics });
    for (let frame = 0; frame < scenario.frameCount; frame += 1) {
      applyFrameInput(engine, frame, scenario.input.events);
      engine.update_frame(FIXED_DELTA_SECONDS, false, true, false);
      const nextFrame = frame + 1;
      const authoringEvent = authoringEventForFrame(scenario, nextFrame, "afterFrameUpdate");
      if (authoringEvent !== undefined) {
        source = installStateEnterDashActionScenario(engine, scenario.stateEnterDashAction);
      }
      if (scenario.captureFrames.includes(nextFrame)) {
        appendSnapshot(engine, snapshots, nextFrame, withActionDiagnostics(
          stateEnterDashActionSnapshotOptions(engine, source),
          actionDiagnostics,
          spawnDiagnostics,
        ));
      }
    }
    setEngineInput(engine, emptyInputState());

    return {
      format: GOLDEN_FIXTURE_FORMAT,
      version: GOLDEN_FIXTURE_VERSION,
      scenario: scenario.id,
      input: {
        frameCount: scenario.frameCount,
        fixedDeltaSeconds: FIXED_DELTA_SECONDS,
        captureFrames: scenario.captureFrames,
        events: scenario.input.events,
      },
      run: createGameplayReplayRun(snapshots),
      actionDiagnostics,
      spawnDiagnostics,
    };
  } finally {
    engine.free();
  }
}

function runTopdownStateEnterProjectileActionTriggerReplay(scenario) {
  const engine = new Engine();
  try {
    engine.set_viewport_size(800, 480);
    engine.set_texture_ids(TEXTURE_IDS.player, TEXTURE_IDS.enemy, TEXTURE_IDS.bullet);
    engine.set_sound_ids(SOUND_IDS.shoot, SOUND_IDS.hit, SOUND_IDS.gameOver);
    applyShooterGameSpec(engine, TOPDOWN_AUTHORED_SPEC);
    engine.reset_game();

    const snapshots = [];
    const actionDiagnostics = [];
    const spawnDiagnostics = createSpawnDiagnosticsCollector(scenario);
    let source;
    appendSnapshot(engine, snapshots, 0, { actionDiagnostics, spawnDiagnostics });
    for (let frame = 0; frame < scenario.frameCount; frame += 1) {
      applyFrameInput(engine, frame, scenario.input.events);
      engine.update_frame(FIXED_DELTA_SECONDS, false, true, false);
      const nextFrame = frame + 1;
      const authoringEvent = authoringEventForFrame(scenario, nextFrame, "afterFrameUpdate");
      if (authoringEvent !== undefined) {
        source = installStateEnterProjectileActionScenario(engine, scenario.stateEnterProjectileAction);
      }
      if (scenario.captureFrames.includes(nextFrame)) {
        appendSnapshot(engine, snapshots, nextFrame, withActionDiagnostics(
          stateEnterProjectileActionSnapshotOptions(engine, source),
          actionDiagnostics,
          spawnDiagnostics,
        ));
      }
    }
    setEngineInput(engine, emptyInputState());

    return {
      format: GOLDEN_FIXTURE_FORMAT,
      version: GOLDEN_FIXTURE_VERSION,
      scenario: scenario.id,
      input: {
        frameCount: scenario.frameCount,
        fixedDeltaSeconds: FIXED_DELTA_SECONDS,
        captureFrames: scenario.captureFrames,
        events: scenario.input.events,
      },
      run: createGameplayReplayRun(snapshots),
      actionDiagnostics,
      spawnDiagnostics,
    };
  } finally {
    engine.free();
  }
}

function runTopdownStateEnterMeleeActionTriggerReplay(scenario) {
  const engine = new Engine();
  try {
    engine.set_viewport_size(800, 480);
    engine.set_texture_ids(TEXTURE_IDS.player, TEXTURE_IDS.enemy, TEXTURE_IDS.bullet);
    engine.set_sound_ids(SOUND_IDS.shoot, SOUND_IDS.hit, SOUND_IDS.gameOver);
    applyShooterGameSpec(engine, TOPDOWN_AUTHORED_SPEC);
    engine.reset_game();

    const snapshots = [];
    const actionDiagnostics = [];
    const spawnDiagnostics = createSpawnDiagnosticsCollector(scenario);
    let source;
    appendSnapshot(engine, snapshots, 0, { actionDiagnostics, spawnDiagnostics });
    for (let frame = 0; frame < scenario.frameCount; frame += 1) {
      applyFrameInput(engine, frame, scenario.input.events);
      engine.update_frame(FIXED_DELTA_SECONDS, false, true, false);
      const nextFrame = frame + 1;
      const authoringEvent = authoringEventForFrame(scenario, nextFrame, "afterFrameUpdate");
      if (authoringEvent !== undefined) {
        source = installStateEnterMeleeActionScenario(engine, scenario.stateEnterMeleeAction);
      }
      if (scenario.captureFrames.includes(nextFrame)) {
        appendSnapshot(engine, snapshots, nextFrame, withActionDiagnostics(
          stateEnterMeleeActionSnapshotOptions(engine, source),
          actionDiagnostics,
          spawnDiagnostics,
        ));
      }
    }
    setEngineInput(engine, emptyInputState());

    return {
      format: GOLDEN_FIXTURE_FORMAT,
      version: GOLDEN_FIXTURE_VERSION,
      scenario: scenario.id,
      input: {
        frameCount: scenario.frameCount,
        fixedDeltaSeconds: FIXED_DELTA_SECONDS,
        captureFrames: scenario.captureFrames,
        events: scenario.input.events,
      },
      run: createGameplayReplayRun(snapshots),
      actionDiagnostics,
      spawnDiagnostics,
    };
  } finally {
    engine.free();
  }
}

function authoringEventForFrame(scenario, frame, phase) {
  const events = scenario.input.events.filter((event) => (
    event.type === "authoring"
    && event.frame === frame
    && event.phase === phase
  ));
  assert.ok(events.length <= 1, `${scenario.id} must not install multiple authoring events in the same frame/phase`);
  return events[0];
}

function authoredSnapshotOptions(engine, handles) {
  return handles === undefined ? {} : { customState: authoredScenarioState(engine, handles) };
}

function installAuthoredBehaviorScenario(engine, authoring, variantMetadata) {
  const player = {
    entityId: engine.built_in_shooter_player_entity_id(),
    entityGeneration: engine.built_in_shooter_player_entity_generation(),
  };
  const interactionSource = spawnAuthoredAabbBody(engine, authoring.bodies.interactionSource);
  const pickup = spawnAuthoredAabbBody(engine, authoring.bodies.pickup);
  const bullet = spawnAuthoredAabbBody(engine, authoring.bodies.bullet);
  const enemy = spawnAuthoredAabbBody(engine, authoring.bodies.enemy);
  const timerSource = spawnAuthoredAabbBody(engine, authoring.bodies.timerSource);
  const neutralBullet = authoring.bodies.neutralBullet === undefined
    ? undefined
    : spawnAuthoredAabbBody(engine, authoring.bodies.neutralBullet);
  const neutralEnemy = authoring.bodies.neutralEnemy === undefined
    ? undefined
    : spawnAuthoredAabbBody(engine, authoring.bodies.neutralEnemy);

  assert.equal(
    engine.set_gameplay_pickup(
      pickup.entityId,
      pickup.entityGeneration,
      authoring.components.pickup.itemId,
      authoring.components.pickup.count,
      authoring.components.pickup.despawnOnCollect,
    ),
    true,
    "authored pickup component must install",
  );
  assert.equal(
    engine.set_gameplay_interaction(
      interactionSource.entityId,
      interactionSource.entityGeneration,
      authoring.components.interaction.actionId,
      authoring.components.interaction.radius,
      authoring.components.interaction.once,
    ),
    true,
    "authored interaction component must install",
  );
  installBehaviorFsm(engine, interactionSource, authoring.components.fsm, GAMEPLAY_EVENT_KIND_INTERACTION, authoring.components.interaction.actionId);
  assert.equal(
    engine.set_gameplay_damage(bullet.entityId, bullet.entityGeneration, authoring.components.collision.damage),
    true,
    "authored bullet damage component must install",
  );
  assert.equal(
    engine.set_gameplay_health(enemy.entityId, enemy.entityGeneration, authoring.components.collision.enemyHealth),
    true,
    "authored enemy health component must install",
  );
  assert.equal(
    engine.set_gameplay_score_reward(
      enemy.entityId,
      enemy.entityGeneration,
      authoring.components.collision.enemyScoreReward,
    ),
    true,
    "authored enemy score reward component must install",
  );
  assert.equal(
    engine.add_gameplay_collision_damage(
      bullet.entityId,
      bullet.entityGeneration,
      authoring.components.collision.target,
    ),
    true,
    "authored collision damage reaction must install",
  );
  installBehaviorFsm(engine, bullet, authoring.components.fsm, GAMEPLAY_EVENT_KIND_COLLISION_DAMAGE, 0);

  if (authoring.components.blockedSpawnPrefab !== undefined) {
    installBlockedSpawnPrefabScenario(engine, player, authoring.components.blockedSpawnPrefab);
  }
  if (authoring.components.timer !== undefined) {
    installTimerTriggerScenario(engine, timerSource, authoring.components.timer, authoring.components.timerSpawnPrefab);
  }
  if (neutralBullet !== undefined && neutralEnemy !== undefined) {
    applyNeutralFactionBehaviorCommands(engine, variantMetadata, {
      "neutral-projectile": neutralBullet,
      "neutral-enemy": neutralEnemy,
    });
  }

  return {
    player,
    interactionSource,
    pickup,
    bullet,
    enemy,
    timerSource,
    ...(neutralBullet === undefined ? {} : { neutralBullet }),
    ...(neutralEnemy === undefined ? {} : { neutralEnemy }),
  };
}

function applyNeutralFactionBehaviorCommands(engine, variantMetadata, entityHandles) {
  const commands = variantMetadata?.behaviorCommands?.filter((command) => (
    command.entity === "neutral-projectile" || command.entity === "neutral-enemy"
  ));
  assert.ok(commands?.length > 0, "neutral faction behavior commands must be present in variant dry-run metadata");
  const result = applyGameplayBehaviorCommands(engine, commands, entityHandles, {
    path: "authoredBehavior.neutralFaction",
  });
  assert.deepEqual(result.results, commands.map(() => true), "neutral faction behavior commands must apply through runtime adapter");
}

function installAuthoredPlayerDamageCollisionScenario(engine, authoring) {
  const player = {
    entityId: engine.built_in_shooter_player_entity_id(),
    entityGeneration: engine.built_in_shooter_player_entity_generation(),
  };
  const enemy = spawnAuthoredAabbBody(engine, authoring.bodies.enemy);
  assert.equal(
    engine.set_gameplay_health(
      player.entityId,
      player.entityGeneration,
      authoring.components.playerHealth,
    ),
    true,
    "authored player health component must install",
  );
  assert.equal(
    engine.set_gameplay_damage(enemy.entityId, enemy.entityGeneration, authoring.components.damage),
    true,
    "authored enemy contact damage component must install",
  );
  assert.equal(
    engine.add_gameplay_collision_damage(
      enemy.entityId,
      enemy.entityGeneration,
      authoring.components.target,
    ),
    true,
    "authored player damage collision reaction must install",
  );
  return {
    player,
    enemy,
  };
}

function installAuthoredProjectileTileImpactFsmScenario(engine, authored) {
  installProjectileBlockingTilemap(engine, authored.blockingTilemap);
  const projectile = spawnAuthoredAabbBody(engine, authored.projectileBody);
  assert.equal(
    engine.set_physics_body_velocity(
      projectile.entityId,
      projectile.entityGeneration,
      authored.velocity.x,
      authored.velocity.y,
    ),
    true,
    "authored projectile velocity must install",
  );
  assert.equal(
    engine.set_gameplay_projectile_tile_impact(
      projectile.entityId,
      projectile.entityGeneration,
      authored.tileImpactCode,
    ),
    true,
    "authored projectile tile impact policy must install",
  );
  installBehaviorFsm(
    engine,
    projectile,
    {
      initialState: authored.fsm.initialState,
      transitionedState: authored.fsm.transitionedState,
    },
    GAMEPLAY_EVENT_KIND_TILE_IMPACT,
    authored.tileImpactCode,
  );
  return projectile;
}

function installHomingMissileScenario(engine, authored) {
  const handles = {};
  for (const [id, body] of Object.entries(authored.bodies)) {
    handles[id] = spawnAuthoredAabbBody(engine, body);
  }
  const composition = resolveSceneCompositionSpec(authored.sceneComposition, {
    path: "homingMissile.sceneComposition",
  });
  const recipes = resolveBehaviorRecipeDocument(authored.behaviorRecipes, {
    path: "homingMissile.behaviorRecipes",
  });
  const plan = bindSceneBehaviorRecipes(composition, recipes, {
    path: "homingMissile.gameplayAuthoring",
    missingBehavior: "error",
  });
  const result = applyGameplayBehaviorCommands(engine, plan.commands, handles, {
    ids: authored.ids,
    path: "homingMissile.apply",
  });
  assert.deepEqual(
    result.results,
    plan.commands.map(() => true),
    "homing missile behavior commands must apply through the runtime adapter",
  );
  return {
    handles,
    commandSummary: plan.commands.map((command) => ({
      entity: command.entity,
      type: command.type,
      recipe: command.recipe,
    })),
  };
}

function installExplosiveProjectileScenario(engine, authored) {
  const handles = {};
  for (const [id, body] of Object.entries(authored.bodies)) {
    handles[id] = spawnAuthoredAabbBody(engine, body);
  }
  const composition = resolveSceneCompositionSpec(authored.sceneComposition, {
    path: "explosiveProjectile.sceneComposition",
  });
  const recipes = resolveBehaviorRecipeDocument(authored.behaviorRecipes, {
    path: "explosiveProjectile.behaviorRecipes",
  });
  const plan = bindSceneBehaviorRecipes(composition, recipes, {
    path: "explosiveProjectile.gameplayAuthoring",
    missingBehavior: "error",
  });
  const result = applyGameplayBehaviorCommands(engine, plan.commands, handles, {
    path: "explosiveProjectile.apply",
  });
  assert.deepEqual(
    result.results,
    plan.commands.map(() => true),
    "explosive projectile behavior commands must apply through the runtime adapter",
  );
  return {
    handles,
    commandSummary: plan.commands.map((command) => ({
      entity: command.entity,
      type: command.type,
      recipe: command.recipe,
    })),
  };
}

function installTileImpactAreaDamageScenario(engine, authored) {
  installProjectileBlockingTilemap(engine, authored.blockingTilemap);
  const handles = {};
  for (const [id, body] of Object.entries(authored.bodies)) {
    handles[id] = spawnAuthoredAabbBody(engine, body);
  }
  const composition = resolveSceneCompositionSpec(authored.sceneComposition, {
    path: "tileImpactAreaDamage.sceneComposition",
  });
  const recipes = resolveBehaviorRecipeDocument(authored.behaviorRecipes, {
    path: "tileImpactAreaDamage.behaviorRecipes",
  });
  const plan = bindSceneBehaviorRecipes(composition, recipes, {
    path: "tileImpactAreaDamage.gameplayAuthoring",
    missingBehavior: "error",
  });
  const result = applyGameplayBehaviorCommands(engine, plan.commands, handles, {
    path: "tileImpactAreaDamage.apply",
  });
  assert.deepEqual(
    result.results,
    plan.commands.map(() => true),
    "tile impact area damage behavior commands must apply through the runtime adapter",
  );
  const projectile = handles["tile-projectile"];
  assert.equal(
    engine.set_physics_body_velocity(
      projectile.entityId,
      projectile.entityGeneration,
      authored.velocity.x,
      authored.velocity.y,
    ),
    true,
    "tile impact area damage projectile velocity must install",
  );
  assert.equal(
    engine.set_gameplay_projectile_tile_impact(
      projectile.entityId,
      projectile.entityGeneration,
      authored.tileImpactCode,
    ),
    true,
    "tile impact area damage projectile tile impact policy must install",
  );
  return {
    handles,
    commandSummary: plan.commands.map((command) => ({
      entity: command.entity,
      type: command.type,
      recipe: command.recipe,
    })),
  };
}

function installTimerTriggerScenario(engine, timerSource, timer, spawnPrefab) {
  if (spawnPrefab !== undefined) {
    assert.equal(
      engine.set_gameplay_action_spawn_prefab(
        timerSource.entityId,
        timerSource.entityGeneration,
        spawnPrefab.actionId,
        spawnPrefab.cooldownSeconds,
        spawnPrefab.prefabId,
        spawnPrefab.anchorCode,
        spawnPrefab.phaseCode,
        spawnPrefab.offsetX,
        spawnPrefab.offsetY,
      ),
      true,
      "authored timer spawn prefab action must install",
    );
  }
  if (timer.actionId !== undefined) {
    assert.equal(
      engine.set_gameplay_timer_action_trigger(
        timerSource.entityId,
        timerSource.entityGeneration,
        timer.timerId,
        timer.durationSeconds,
        timer.actionId,
      ),
      true,
      "authored timer action trigger component must install",
    );
  } else {
    assert.equal(
      engine.set_gameplay_timer_trigger(
        timerSource.entityId,
        timerSource.entityGeneration,
        timer.timerId,
        timer.durationSeconds,
      ),
      true,
      "authored timer trigger component must install",
    );
  }
  installBehaviorFsm(
    engine,
    timerSource,
    {
      initialState: timer.initialState,
      transitionedState: timer.transitionedState,
    },
    GAMEPLAY_EVENT_KIND_TIMER,
    timer.timerId,
  );
}

function installWaveActionTriggerScenario(engine, source, authored) {
  assert.equal(
    engine.set_gameplay_action_spawn_prefab(
      source.entityId,
      source.entityGeneration,
      authored.spawnPrefab.actionId,
      authored.spawnPrefab.cooldownSeconds,
      authored.spawnPrefab.prefabId,
      authored.spawnPrefab.anchorCode,
      authored.spawnPrefab.phaseCode,
      authored.spawnPrefab.offsetX,
      authored.spawnPrefab.offsetY,
    ),
    true,
    "authored wave spawn prefab action must install",
  );
  engine.clear_shooter_waves();
  for (const wave of authored.waves) {
    engine.set_shooter_wave(
      wave.index,
      wave.durationSeconds,
      wave.spawnIntervalSeconds,
      wave.enemyCount,
      wave.enemySpeed,
      wave.enemyBehaviorCode,
      wave.enemySpawnPatternCode,
      wave.enemyHealth,
      wave.scoreReward,
    );
  }
  assert.equal(
    engine.set_shooter_wave_action_trigger(
      authored.waveIndex,
      source.entityId,
      source.entityGeneration,
      authored.spawnPrefab.actionId,
    ),
    true,
    "authored wave action trigger must install",
  );
}

function installStateEnterActionScenario(engine, authored) {
  const source = spawnAuthoredAabbBody(engine, authored.sourceBody);
  assert.equal(
    engine.set_gameplay_action_spawn_prefab(
      source.entityId,
      source.entityGeneration,
      authored.spawnPrefab.actionId,
      authored.spawnPrefab.cooldownSeconds,
      authored.spawnPrefab.prefabId,
      authored.spawnPrefab.anchorCode,
      authored.spawnPrefab.phaseCode,
      authored.spawnPrefab.offsetX,
      authored.spawnPrefab.offsetY,
    ),
    true,
    "authored state-enter spawn prefab action must install",
  );
  assert.equal(
    engine.set_gameplay_timer_trigger(
      source.entityId,
      source.entityGeneration,
      authored.timer.timerId,
      authored.timer.durationSeconds,
    ),
    true,
    "authored state-enter timer trigger must install",
  );
  installBehaviorFsm(
    engine,
    source,
    {
      initialState: authored.fsm.initialState,
      transitionedState: authored.fsm.transitionedState,
    },
    GAMEPLAY_EVENT_KIND_TIMER,
    authored.timer.timerId,
  );
  assert.equal(
    engine.add_gameplay_behavior_state_enter_action(
      source.entityId,
      source.entityGeneration,
      authored.fsm.transitionedState,
      authored.spawnPrefab.actionId,
      authored.stateEnter.phaseCode,
    ),
    true,
    "authored behavior state-enter action must install",
  );
  return source;
}

function installStateEnterDashActionScenario(engine, authored) {
  const source = spawnAuthoredAabbBody(engine, authored.sourceBody);
  assert.equal(
    engine.set_gameplay_action_dash_with_aim(
      source.entityId,
      source.entityGeneration,
      authored.dashAction.actionId,
      authored.dashAction.cooldownSeconds,
      authored.dashAction.distance,
      authored.dashAction.aimCode,
    ),
    true,
    "authored state-enter dash action must install",
  );
  assert.equal(
    engine.set_gameplay_timer_trigger(
      source.entityId,
      source.entityGeneration,
      authored.timer.timerId,
      authored.timer.durationSeconds,
    ),
    true,
    "authored state-enter dash timer trigger must install",
  );
  installBehaviorFsm(
    engine,
    source,
    {
      initialState: authored.fsm.initialState,
      transitionedState: authored.fsm.transitionedState,
    },
    GAMEPLAY_EVENT_KIND_TIMER,
    authored.timer.timerId,
  );
  assert.equal(
    engine.add_gameplay_behavior_state_enter_action(
      source.entityId,
      source.entityGeneration,
      authored.fsm.transitionedState,
      authored.dashAction.actionId,
      authored.stateEnter.phaseCode,
    ),
    true,
    "authored behavior state-enter dash action must install",
  );
  return source;
}

function installStateEnterProjectileActionScenario(engine, authored) {
  const source = spawnAuthoredAabbBody(engine, authored.sourceBody);
  if (authored.blockingTilemap !== undefined) {
    installProjectileBlockingTilemap(engine, authored.blockingTilemap);
  }
  assert.equal(
    engine.set_gameplay_action_projectile_with_target(
      source.entityId,
      source.entityGeneration,
      authored.projectileAction.actionId,
      authored.projectileAction.cooldownSeconds,
      authored.projectileAction.speed,
      authored.projectileAction.damage,
      authored.projectileAction.lifetimeSeconds,
      authored.projectileAction.aimCode,
      authored.projectileAction.collisionTargetCode,
      authored.projectileAction.tileImpactCode ?? 0,
    ),
    true,
    "authored state-enter projectile action must install",
  );
  assert.equal(
    engine.set_gameplay_timer_trigger(
      source.entityId,
      source.entityGeneration,
      authored.timer.timerId,
      authored.timer.durationSeconds,
    ),
    true,
    "authored state-enter projectile timer trigger must install",
  );
  installBehaviorFsm(
    engine,
    source,
    {
      initialState: authored.fsm.initialState,
      transitionedState: authored.fsm.transitionedState,
    },
    GAMEPLAY_EVENT_KIND_TIMER,
    authored.timer.timerId,
  );
  assert.equal(
    engine.add_gameplay_behavior_state_enter_action(
      source.entityId,
      source.entityGeneration,
      authored.fsm.transitionedState,
      authored.projectileAction.actionId,
      authored.stateEnter.phaseCode,
    ),
    true,
    "authored behavior state-enter projectile action must install",
  );
  return source;
}

function installProjectileBlockingTilemap(engine, tilemap) {
  engine.clear_shooter_tilemap();
  engine.set_shooter_tile(1, TEXTURE_IDS.enemy, 0, 0, 1, 1, 1, 1, 1, 1);
  engine.set_shooter_tilemap_layer(
    tilemap.layerIndex,
    tilemap.columns,
    tilemap.rows,
    tilemap.tileWidth,
    tilemap.tileHeight,
    tilemap.originX,
    tilemap.originY,
    true,
    Uint32Array.from(tilemap.data),
  );
}

function installStateEnterMeleeActionScenario(engine, authored) {
  const source = spawnAuthoredAabbBody(engine, authored.sourceBody);
  if (authored.targetBody !== undefined) {
    spawnAuthoredAabbBody(engine, authored.targetBody);
  }
  assert.equal(
    engine.set_gameplay_action_melee_with_target(
      source.entityId,
      source.entityGeneration,
      authored.meleeAction.actionId,
      authored.meleeAction.cooldownSeconds,
      authored.meleeAction.range,
      authored.meleeAction.damage,
      authored.meleeAction.targetCode,
    ),
    true,
    "authored state-enter melee action must install",
  );
  assert.equal(
    engine.set_gameplay_timer_trigger(
      source.entityId,
      source.entityGeneration,
      authored.timer.timerId,
      authored.timer.durationSeconds,
    ),
    true,
    "authored state-enter melee timer trigger must install",
  );
  installBehaviorFsm(
    engine,
    source,
    {
      initialState: authored.fsm.initialState,
      transitionedState: authored.fsm.transitionedState,
    },
    GAMEPLAY_EVENT_KIND_TIMER,
    authored.timer.timerId,
  );
  assert.equal(
    engine.add_gameplay_behavior_state_enter_action(
      source.entityId,
      source.entityGeneration,
      authored.fsm.transitionedState,
      authored.meleeAction.actionId,
      authored.stateEnter.phaseCode,
    ),
    true,
    "authored behavior state-enter melee action must install",
  );
  return source;
}

function installBlockedSpawnPrefabScenario(engine, player, authored) {
  assert.equal(
    engine.set_gameplay_action_spawn_prefab(
      player.entityId,
      player.entityGeneration,
      authored.actionId,
      authored.cooldownSeconds,
      authored.prefabId,
      authored.anchorCode,
      authored.phaseCode,
      authored.offsetX,
      authored.offsetY,
    ),
    true,
    "authored blocked spawn prefab action must install",
  );
  assert.equal(
    engine.set_input_action_binding(
      authored.actionId,
      authored.input.bindingIndex,
      authored.input.controlCode,
      authored.input.activationCode,
    ),
    true,
    "authored blocked spawn input binding must install",
  );
  engine.clear_shooter_tilemap();
  const tilemap = authored.blockedTilemap;
  engine.set_shooter_tile(1, TEXTURE_IDS.enemy, 0, 0, 1, 1, 1, 1, 1, 1);
  engine.set_shooter_tilemap_layer(
    tilemap.layerIndex,
    tilemap.columns,
    tilemap.rows,
    tilemap.tileWidth,
    tilemap.tileHeight,
    tilemap.originX,
    tilemap.originY,
    true,
    Uint32Array.from(tilemap.data),
  );
}

function installBehaviorFsm(engine, handle, fsm, eventKind, tokenId) {
  assert.equal(
    engine.set_gameplay_behavior_state_machine(
      handle.entityId,
      handle.entityGeneration,
      fsm.initialState,
    ),
    true,
    "authored FSM initial state must install",
  );
  assert.equal(
    engine.add_gameplay_behavior_event_transition(
      handle.entityId,
      handle.entityGeneration,
      fsm.initialState,
      fsm.transitionedState,
      eventKind,
      tokenId,
    ),
    true,
    "authored FSM transition must install",
  );
}

function spawnAuthoredAabbBody(
  engine,
  {
    x,
    y,
    halfWidth,
    halfHeight,
    layer,
    isTrigger = false,
    bodyType = PHYSICS_BODY_STATIC,
    massOrDensity = 1,
    useDensity = false,
    canSleep = false,
  },
) {
  assert.equal(
    engine.spawn_physics_aabb_body(
      x,
      y,
      halfWidth,
      halfHeight,
      bodyType,
      massOrDensity,
      useDensity,
      layer,
      1 << layer,
      0xffffffff,
      isTrigger,
      true,
      true,
      canSleep,
    ),
    true,
    "authored scenario physics body must spawn",
  );
  return {
    entityId: engine.physics_entity_id(),
    entityGeneration: engine.physics_entity_generation(),
  };
}

function authoredScenarioState(engine, handles) {
  return {
    handles,
    interactionFsmState: engine.gameplay_behavior_state(
      handles.interactionSource.entityId,
      handles.interactionSource.entityGeneration,
    ),
    collisionFsmState: engine.gameplay_behavior_state(
      handles.bullet.entityId,
      handles.bullet.entityGeneration,
    ),
    timerFsmState: engine.gameplay_behavior_state(
      handles.timerSource.entityId,
      handles.timerSource.entityGeneration,
    ),
    gameplayEvents: readGameplayEventSummary(engine),
  };
}

function authoredPlayerDamageCollisionSnapshotOptions(engine, handles) {
  return handles === undefined
    ? {}
    : {
        customState: {
          handles,
          gameplayEvents: readGameplayEventSummary(engine),
        },
      };
}

function authoredProjectileTileImpactFsmSnapshotOptions(engine, projectile) {
  return projectile === undefined
    ? {}
    : {
        customState: {
          projectile,
          projectilePhysics: physicsEntityState(engine, projectile),
          fsmState: engine.gameplay_behavior_state(
            projectile.entityId,
            projectile.entityGeneration,
          ),
          gameplayEvents: readGameplayEventSummary(engine),
        },
      };
}

function homingMissileSnapshotOptions(engine, homing) {
  if (homing === undefined) {
    return {};
  }
  const missilePhysics = optionalPhysicsEntityState(engine, homing.handles.missile);
  const hostileEnemyPhysics = optionalPhysicsEntityState(engine, homing.handles["hostile-enemy"]);
  const decoyEnemyPhysics = optionalPhysicsEntityState(engine, homing.handles["decoy-enemy"]);
  return {
    customState: {
      handles: homing.handles,
      commandSummary: homing.commandSummary,
      ...(missilePhysics === undefined ? {} : { missilePhysics }),
      ...(hostileEnemyPhysics === undefined ? {} : { hostileEnemyPhysics }),
      ...(decoyEnemyPhysics === undefined ? {} : { decoyEnemyPhysics }),
      gameplayEvents: readGameplayEventSummary(engine),
    },
  };
}

function explosiveProjectileSnapshotOptions(engine, explosive) {
  if (explosive === undefined) {
    return {};
  }
  const projectilePhysics = optionalPhysicsEntityState(engine, explosive.handles["explosive-projectile"]);
  const directEnemyPhysics = optionalPhysicsEntityState(engine, explosive.handles["blast-direct"]);
  const splashEnemyPhysics = optionalPhysicsEntityState(engine, explosive.handles["blast-splash"]);
  const farEnemyPhysics = optionalPhysicsEntityState(engine, explosive.handles["blast-far"]);
  return {
    customState: {
      handles: explosive.handles,
      commandSummary: explosive.commandSummary,
      ...(projectilePhysics === undefined ? {} : { projectilePhysics }),
      ...(directEnemyPhysics === undefined ? {} : { directEnemyPhysics }),
      ...(splashEnemyPhysics === undefined ? {} : { splashEnemyPhysics }),
      ...(farEnemyPhysics === undefined ? {} : { farEnemyPhysics }),
      gameplayEvents: readGameplayEventSummary(engine),
    },
  };
}

function tileImpactAreaDamageSnapshotOptions(engine, authored) {
  if (authored === undefined) {
    return {};
  }
  const projectilePhysics = optionalPhysicsEntityState(engine, authored.handles["tile-projectile"]);
  const directEnemyPhysics = optionalPhysicsEntityState(engine, authored.handles["tile-blast-direct"]);
  const splashEnemyPhysics = optionalPhysicsEntityState(engine, authored.handles["tile-blast-splash"]);
  const farEnemyPhysics = optionalPhysicsEntityState(engine, authored.handles["tile-blast-far"]);
  return {
    customState: {
      handles: authored.handles,
      commandSummary: authored.commandSummary,
      ...(projectilePhysics === undefined ? {} : { projectilePhysics }),
      ...(directEnemyPhysics === undefined ? {} : { directEnemyPhysics }),
      ...(splashEnemyPhysics === undefined ? {} : { splashEnemyPhysics }),
      ...(farEnemyPhysics === undefined ? {} : { farEnemyPhysics }),
      gameplayEvents: readGameplayEventSummary(engine),
    },
  };
}

function waveActionSnapshotOptions(engine, source) {
  return {
    customState: {
      source,
      gameplayEvents: readGameplayEventSummary(engine),
    },
  };
}

function stateEnterActionSnapshotOptions(engine, source) {
  return source === undefined
    ? {}
    : {
        customState: {
          source,
          fsmState: engine.gameplay_behavior_state(
            source.entityId,
            source.entityGeneration,
          ),
          gameplayEvents: readGameplayEventSummary(engine),
        },
      };
}

function stateEnterDashActionSnapshotOptions(engine, source) {
  return source === undefined
    ? {}
    : {
        customState: {
          source,
          sourcePhysics: physicsEntityState(engine, source),
          fsmState: engine.gameplay_behavior_state(
            source.entityId,
            source.entityGeneration,
          ),
          gameplayEvents: readGameplayEventSummary(engine),
        },
      };
}

function stateEnterProjectileActionSnapshotOptions(engine, source) {
  return source === undefined
    ? {}
    : {
        customState: {
          source,
          fsmState: engine.gameplay_behavior_state(
            source.entityId,
            source.entityGeneration,
          ),
          gameplayEvents: readGameplayEventSummary(engine),
        },
      };
}

function stateEnterMeleeActionSnapshotOptions(engine, source) {
  return source === undefined
    ? {}
    : {
        customState: {
          source,
          fsmState: engine.gameplay_behavior_state(
            source.entityId,
            source.entityGeneration,
          ),
          gameplayEvents: readGameplayEventSummary(engine),
        },
      };
}

function withActionDiagnostics(options, actionDiagnostics, spawnDiagnostics) {
  return {
    ...options,
    actionDiagnostics,
    spawnDiagnostics,
  };
}

function physicsEntityState(engine, handle) {
  assert.equal(
    engine.query_physics_entity(handle.entityId, handle.entityGeneration),
    true,
    "authored scenario physics entity must be queryable",
  );
  return {
    entityId: handle.entityId,
    entityGeneration: handle.entityGeneration,
    x: engine.physics_entity_x(),
    y: engine.physics_entity_y(),
    velocityX: engine.physics_entity_velocity_x(),
    velocityY: engine.physics_entity_velocity_y(),
  };
}

function optionalPhysicsEntityState(engine, handle) {
  if (!engine.query_physics_entity(handle.entityId, handle.entityGeneration)) {
    return undefined;
  }
  return {
    entityId: handle.entityId,
    entityGeneration: handle.entityGeneration,
    x: engine.physics_entity_x(),
    y: engine.physics_entity_y(),
    velocityX: engine.physics_entity_velocity_x(),
    velocityY: engine.physics_entity_velocity_y(),
  };
}

function readGameplayEventSummary(engine) {
  return readGameplayEvents(engine).map((event) => ({
    kind: event.kind,
    kindCode: event.kindCode,
    actorId: event.actorId,
    actorGeneration: event.actorGeneration,
    sourceId: event.sourceId,
    sourceGeneration: event.sourceGeneration,
    tokenId: event.tokenId,
    flags: event.flags,
    targetRemoved: event.targetRemoved,
    payloadBits: event.payloadBits,
  }));
}

function readGameplayEvents(engine) {
  const eventCount = engine.gameplay_event_len();
  if (eventCount === 0) {
    return [];
  }
  const u32sPerEvent = gameplay_event_u32s();
  assert.equal(u32sPerEvent, U32S_PER_GAMEPLAY_EVENT, "gameplay event ABI u32 stride must match TS decoder");
  return decodeGameplayEvents({
    buffer: copyU32TypedBuffer(engine.gameplay_event_ptr(), eventCount * u32sPerEvent),
    eventCount,
    u32sPerEvent,
  });
}

function appendActionDiagnostics(engine, frame, decodedGameplayEvents, actionDiagnostics) {
  if (actionDiagnostics === undefined) {
    return;
  }
  const diagnostics = readActionFrameDiagnostics(engine);
  const actionFailures = gameplayActionsForEvents(decodedGameplayEvents, {
    unknownEvent: "ignore",
  }).filter((action) => action.type === "actionFailed");
  const reports = gameplayActionDiagnosticReports(diagnostics, {
    path: `gameplayReplay.frames.${frame}.actionDiagnostics`,
    actionFailures,
  });
  if (reports.length === 0) {
    return;
  }
  actionDiagnostics.push({
    frame,
    diagnostics,
    reports,
  });
}

function appendSpawnDiagnostics(engine, frame, spawnDiagnostics) {
  if (spawnDiagnostics === undefined) {
    return;
  }
  const diagnostics = readSpawnFrameDiagnostics(engine);
  const expectations = spawnDiagnostics.expectationsByFrame?.get(frame) ?? [];
  const expectedMetrics = new Set(expectations.map((expectation) => expectation.metric));
  const reports = gameplaySpawnDiagnosticReports(diagnostics, {
    path: `gameplayReplay.frames.${frame}.spawnDiagnostics`,
    expectations,
    includeActivity: true,
  }).filter((report) => (
    report.code !== "FERRUM_GAMEPLAY_SPAWN_FLUSH_ACTIVITY"
    || !expectedMetrics.has(report.metric)
  ));
  if (reports.length === 0 && expectations.length === 0) {
    return;
  }
  spawnDiagnostics.push({
    frame,
    diagnostics,
    reports,
  });
}

function createSpawnDiagnosticsCollector(scenario) {
  const collector = [];
  Object.defineProperty(collector, "expectationsByFrame", {
    enumerable: false,
    value: spawnDiagnosticExpectationsByFrame(scenario),
  });
  return collector;
}

function spawnDiagnosticExpectationsByFrame(scenario) {
  const expectationsByFrame = new Map();
  for (const expectedFrame of scenario.expected.spawnDiagnostics ?? []) {
    const expectations = Object.entries(expectedFrame.metrics).map(([metric, expected]) => ({
      metric,
      expected,
      suggestion: `Check ${scenario.id} expected.spawnDiagnostics frame ${expectedFrame.frame} metric '${metric}' and the authored action that should produce it.`,
    }));
    expectationsByFrame.set(expectedFrame.frame, expectations);
  }
  return expectationsByFrame;
}

function assertSpawnDiagnosticExpectations(actual, label) {
  const mismatches = [];
  for (const entry of actual.spawnDiagnostics ?? []) {
    for (const report of entry.reports ?? []) {
      if (report.code === "FERRUM_GAMEPLAY_SPAWN_FLUSH_EXPECTATION_MISMATCH") {
        mismatches.push({ frame: entry.frame, report });
      }
    }
  }
  if (mismatches.length === 0) {
    return;
  }
  const runSummary = createScenarioRunSummary(actual, undefined, {
    phase: "spawn-diagnostics",
    spawnDiagnosticMismatches: mismatches,
    passed: false,
  });
  throw gameplayReplaySmokeError(
    `${label} spawn diagnostic expectations failed:\n${JSON.stringify(runSummary, null, 2)}`,
    runSummary,
  );
}

function readActionFrameDiagnostics(engine) {
  return buildActionFrameDiagnostics(readFrameTelemetryBuffer(engine));
}

function readSpawnFrameDiagnostics(engine) {
  return buildSpawnFrameDiagnostics(readFrameTelemetryBuffer(engine));
}

function readFrameTelemetryBuffer(engine) {
  const f64sPerFrame = frame_telemetry_f64s();
  return {
    buffer: new Float64Array(wasm_memory().buffer, engine.frame_telemetry_ptr(), f64sPerFrame),
    f64sPerFrame,
  };
}

function applyFrameInput(engine, frame, events) {
  const input = inputForFrame(frame, events);
  setEngineInput(engine, input);
}

function setEngineInput(engine, input) {
  engine.set_input(
    input.w,
    input.a,
    input.s,
    input.d,
    input.space,
    input.enter,
    input.mouseLeft,
    input.mouseX,
    input.mouseY,
  );
}

function inputForFrame(frame, events) {
  const input = emptyInputState();
  for (const event of events) {
    if (event.frame !== frame || event.type !== "press") {
      continue;
    }
    if (!(event.control in input)) {
      throw new Error(`unsupported gameplay replay input control: ${event.control}`);
    }
    input[event.control] = true;
    if (Number.isFinite(event.x)) {
      input.mouseX = event.x;
    }
    if (Number.isFinite(event.y)) {
      input.mouseY = event.y;
    }
  }
  return input;
}

function emptyInputState() {
  return {
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
    enter: false,
    mouseLeft: false,
    mouseX: 0,
    mouseY: 0,
  };
}

function appendSnapshot(engine, snapshots, frame, options = {}) {
  const gameplayEvents = readGameplayEvents(engine);
  appendActionDiagnostics(engine, frame, gameplayEvents, options.actionDiagnostics);
  appendSpawnDiagnostics(engine, frame, options.spawnDiagnostics);
  const builtInShooter = captureShooterStateSnapshot(engine);
  const snapshot = {
    format: "ferrum2d.game-state.snapshot",
    version: 1,
    frame,
    source: "ferrum-runtime",
    scene: {
      score: engine.score(),
      gameState: engine.game_state(),
      entityCount: engine.entity_count(),
      spriteCount: engine.sprite_count(),
      cameraX: engine.camera_x(),
      cameraY: engine.camera_y(),
    },
    builtInShooter,
    ...(options.customState === undefined ? {} : { custom: options.customState }),
  };
  snapshots.push({
    ...snapshot,
    snapshotHash: hashGameStateSnapshot(snapshot),
  });
}

function captureShooterStateSnapshot(engine) {
  assert.equal(engine.capture_shooter_snapshot(), true, "shooter snapshot capture must succeed");
  assert.equal(engine.shooter_snapshot_header_floats(), BUILT_IN_SHOOTER_STATE_HEADER_FLOATS, "shooter header float stride must match built-in state snapshot ABI");
  assert.equal(engine.shooter_snapshot_header_u32s(), BUILT_IN_SHOOTER_STATE_HEADER_U32S, "shooter header u32 stride must match built-in state snapshot ABI");
  assert.equal(engine.shooter_snapshot_entity_floats(), BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY, "shooter entity float stride must match built-in state snapshot ABI");
  assert.equal(engine.shooter_snapshot_entity_u32s(), BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY, "shooter entity u32 stride must match built-in state snapshot ABI");
  const headerFloats = copyFloatBuffer(engine.shooter_snapshot_header_float_ptr(), engine.shooter_snapshot_header_float_len());
  const headerU32s = copyU32Buffer(engine.shooter_snapshot_header_u32_ptr(), engine.shooter_snapshot_header_u32_len());
  const entityFloats = copyFloatBuffer(engine.shooter_snapshot_entity_float_ptr(), engine.shooter_snapshot_entity_float_len());
  const entityU32s = copyU32Buffer(engine.shooter_snapshot_entity_u32_ptr(), engine.shooter_snapshot_entity_u32_len());
  return {
    format: "ferrum2d.builtin-shooter-state",
    version: BUILT_IN_SHOOTER_STATE_VERSION,
    headerFloats,
    headerU32s,
    entityFloats,
    entityU32s,
    entityCount: entityU32s.length / engine.shooter_snapshot_entity_u32s(),
    floatsPerEntity: engine.shooter_snapshot_entity_floats(),
    u32sPerEntity: engine.shooter_snapshot_entity_u32s(),
  };
}

function copyFloatBuffer(ptr, len) {
  return Array.from(new Float32Array(wasm_memory().buffer, ptr, len));
}

function copyU32Buffer(ptr, len) {
  return Array.from(new Uint32Array(wasm_memory().buffer, ptr, len));
}

function copyU32TypedBuffer(ptr, len) {
  return new Uint32Array(wasm_memory().buffer, ptr, len).slice();
}

async function readGoldenFixture(fixturePath, scenario) {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  scenario.validateFixture(fixture, fixturePath);
  return fixture;
}

async function writeGoldenFixture(fixturePath, fixture) {
  await mkdir(dirname(fixturePath), { recursive: true });
  const {
    actionDiagnostics: _actionDiagnostics,
    spawnDiagnostics: _spawnDiagnostics,
    ...goldenFixture
  } = fixture;
  await writeFile(fixturePath, `${JSON.stringify(goldenFixture, null, 2)}\n`);
}

function createSmokeReport(scenarioRuns, errors) {
  return {
    format: SMOKE_REPORT_FORMAT,
    version: SMOKE_REPORT_VERSION,
    ok: errors.length === 0,
    gameplayReplaySmoke: scenarioRuns,
    ...(errors.length === 0 ? {} : { errors }),
  };
}

function createScenarioRunSummary(actual, fixturePath, extra = {}) {
  const spawnExpectationPatches = spawnExpectationPatchCandidates(actual);
  return {
    ...(fixturePath === undefined ? {} : { fixturePath }),
    scenario: actual.scenario,
    replayHash: actual.run.replayHash,
    frameCount: actual.input.frameCount,
    fixedDeltaSeconds: actual.input.fixedDeltaSeconds,
    snapshots: actual.run.snapshots.length,
    actionDiagnostics: actual.actionDiagnostics,
    spawnDiagnostics: actual.spawnDiagnostics,
    ...(spawnExpectationPatches.length === 0 ? {} : { spawnExpectationPatches }),
    ...extra,
  };
}

function spawnExpectationPatchCandidates(actual) {
  const candidates = [];
  const manifestPath = manifestPatchPath(actual.manifestPath);
  for (const entry of actual.spawnDiagnostics ?? []) {
    const metrics = {};
    for (const report of entry.reports ?? []) {
      if (report.code !== "FERRUM_GAMEPLAY_SPAWN_FLUSH_ACTIVITY") {
        continue;
      }
      metrics[report.metric] = report.count ?? report.actual;
    }
    if (Object.keys(metrics).length === 0) {
      continue;
    }
    const expectedFrame = {
      frame: entry.frame,
      metrics,
    };
    candidates.push({
      kind: "gameplay-spawn-expectation",
      code: "FERRUM_GAMEPLAY_SPAWN_EXPECTATION_PATCH_CANDIDATE",
      path: `${manifestPath}.scenarios[id=${actual.scenario}].expected.spawnDiagnostics`,
      message: `Scenario '${actual.scenario}' observed spawn flush activity on frame ${entry.frame} without a matching manifest expectation.`,
      expected: expectedFrame,
      actual: "positive spawn diagnostics observed in replay smoke",
      suggestion: "If this spawn is intentional, add the expected object to the scenario manifest so future count drift fails as a structured diagnostic.",
    });
  }
  return candidates;
}

function manifestPatchPath(manifestPath) {
  if (manifestPath === undefined) {
    return DEFAULT_SCENARIO_MANIFEST_PATH;
  }
  const repoRelativePath = relative(REPO_ROOT, manifestPath);
  return repoRelativePath.startsWith("..") ? manifestPath : repoRelativePath;
}

function assertSpawnExpectationPatchCount(runSummary, scenario) {
  const expectedCount = scenario.expected.spawnExpectationPatchCount;
  if (expectedCount === undefined) {
    return;
  }
  const actualCount = runSummary.spawnExpectationPatches?.length ?? 0;
  assert.equal(
    actualCount,
    expectedCount,
    `${scenario.manifestPath}.scenarios[${scenario.manifestIndex}].expected.spawnExpectationPatchCount must match ${scenario.id} report`,
  );
}

function gameplayReplaySmokeError(message, scenarioRun) {
  const error = new Error(message);
  error.scenarioRun = scenarioRun;
  return error;
}

function errorScenarioRun(error) {
  return error instanceof Error && isPlainRecord(error.scenarioRun)
    ? error.scenarioRun
    : undefined;
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

async function writeSmokeReportArtifact(artifactDir, report) {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    join(artifactDir, DEFAULT_ARTIFACT_REPORT_NAME),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

async function validateSmokeReportSchema(report) {
  const schema = await readJsonSchemaContract(SMOKE_REPORT_SCHEMA_PATH);
  validateJsonSchemaContract(schema, report, "gameplay-replay-smoke-report");
}

function validateGoldenFixtureCommon(fixture, fixturePath, scenario, frameCount, captureFrames, events) {
  assert.equal(fixture.format, GOLDEN_FIXTURE_FORMAT, `${fixturePath}.format must match`);
  assert.equal(fixture.version, GOLDEN_FIXTURE_VERSION, `${fixturePath}.version must match`);
  assert.equal(fixture.scenario, scenario.id, `${fixturePath}.scenario must match`);
  assert.equal(fixture.input.frameCount, frameCount, `${fixturePath}.input.frameCount must match`);
  assert.equal(fixture.input.fixedDeltaSeconds, FIXED_DELTA_SECONDS, `${fixturePath}.input.fixedDeltaSeconds must match`);
  assert.deepEqual(fixture.input.captureFrames, captureFrames, `${fixturePath}.input.captureFrames must match`);
  assert.deepEqual(fixture.input.events, events, `${fixturePath}.input.events must match`);
  assert.equal(
    fixture.manifestPath,
    relativeManifestPath(scenario.manifestPath),
    `${fixturePath}.manifestPath must match scenario manifest`,
  );
  assert.equal(fixture.manifestIndex, scenario.manifestIndex, `${fixturePath}.manifestIndex must match scenario manifest index`);
}

function validateTopdownGoldenFixture(fixture, fixturePath) {
  validateGoldenFixtureCommon(
    fixture,
    fixturePath,
    this,
    this.frameCount,
    this.captureFrames,
    this.input.events,
  );
  validateBasicScenarioOutcome.call(this, fixture, fixturePath);
}

function validateTopdownAuthoredFixture(fixture, fixturePath) {
  validateGoldenFixtureCommon(
    fixture,
    fixturePath,
    this,
    this.frameCount,
    this.captureFrames,
    this.input.events,
  );
  validateAuthoredScenarioOutcome.call(this, fixture, fixturePath);
}

function validateTopdownAuthoredPlayerDamageCollisionFixture(fixture, fixturePath) {
  validateGoldenFixtureCommon(
    fixture,
    fixturePath,
    this,
    this.frameCount,
    this.captureFrames,
    this.input.events,
  );
  validateAuthoredPlayerDamageCollisionScenarioOutcome.call(this, fixture, fixturePath);
}

function validateTopdownAuthoredProjectileTileImpactFsmFixture(fixture, fixturePath) {
  validateGoldenFixtureCommon(
    fixture,
    fixturePath,
    this,
    this.frameCount,
    this.captureFrames,
    this.input.events,
  );
  validateAuthoredProjectileTileImpactFsmScenarioOutcome.call(this, fixture, fixturePath);
}

function validateTopdownHomingMissileFixture(fixture, fixturePath) {
  validateGoldenFixtureCommon(
    fixture,
    fixturePath,
    this,
    this.frameCount,
    this.captureFrames,
    this.input.events,
  );
  validateHomingMissileScenarioOutcome.call(this, fixture, fixturePath);
}

function validateTopdownExplosiveProjectileFixture(fixture, fixturePath) {
  validateGoldenFixtureCommon(
    fixture,
    fixturePath,
    this,
    this.frameCount,
    this.captureFrames,
    this.input.events,
  );
  validateExplosiveProjectileScenarioOutcome.call(this, fixture, fixturePath);
}

function validateTopdownTileImpactAreaDamageFixture(fixture, fixturePath) {
  validateGoldenFixtureCommon(
    fixture,
    fixturePath,
    this,
    this.frameCount,
    this.captureFrames,
    this.input.events,
  );
  validateTileImpactAreaDamageScenarioOutcome.call(this, fixture, fixturePath);
}

function validateTopdownWaveActionFixture(fixture, fixturePath) {
  validateGoldenFixtureCommon(
    fixture,
    fixturePath,
    this,
    this.frameCount,
    this.captureFrames,
    this.input.events,
  );
  validateWaveActionScenarioOutcome.call(this, fixture, fixturePath);
}

function validateTopdownStateEnterActionFixture(fixture, fixturePath) {
  validateGoldenFixtureCommon(
    fixture,
    fixturePath,
    this,
    this.frameCount,
    this.captureFrames,
    this.input.events,
  );
  validateStateEnterActionScenarioOutcome.call(this, fixture, fixturePath);
}

function validateTopdownStateEnterDashActionFixture(fixture, fixturePath) {
  validateGoldenFixtureCommon(
    fixture,
    fixturePath,
    this,
    this.frameCount,
    this.captureFrames,
    this.input.events,
  );
  validateStateEnterDashActionScenarioOutcome.call(this, fixture, fixturePath);
}

function validateTopdownStateEnterProjectileActionFixture(fixture, fixturePath) {
  validateGoldenFixtureCommon(
    fixture,
    fixturePath,
    this,
    this.frameCount,
    this.captureFrames,
    this.input.events,
  );
  validateStateEnterProjectileActionScenarioOutcome.call(this, fixture, fixturePath);
}

function validateTopdownStateEnterMeleeActionFixture(fixture, fixturePath) {
  validateGoldenFixtureCommon(
    fixture,
    fixturePath,
    this,
    this.frameCount,
    this.captureFrames,
    this.input.events,
  );
  validateStateEnterMeleeActionScenarioOutcome.call(this, fixture, fixturePath);
}

function validateBasicScenarioOutcome(fixture, label) {
  const finalSnapshot = fixture.run?.snapshots?.at(-1)?.snapshot;
  assert.equal(finalSnapshot?.frame, this.frameCount, `${label} final snapshot frame must match`);
  assert.equal(finalSnapshot?.scene?.score, this.expected.finalScore, `${label} must include score reward coverage`);
}

function validateAuthoredScenarioOutcome(fixture, label) {
  const snapshots = fixture.run?.snapshots ?? [];
  const setupFrame = this.input.events.find((event) => event.type === "authoring")?.frame;
  const setupSnapshot = snapshots.find((entry) => entry.frame === setupFrame)?.snapshot;
  const reactionSnapshot = snapshots.find((entry) => entry.frame === this.expected.eventFrame)?.snapshot;
  const actionFailureSnapshot = this.expected.actionFailureFrame === undefined
    ? undefined
    : snapshots.find((entry) => entry.frame === this.expected.actionFailureFrame)?.snapshot;
  const finalSnapshot = snapshots.at(-1)?.snapshot;
  assert.equal(finalSnapshot?.frame, this.frameCount, `${label} final snapshot frame must match`);
  assert.equal(finalSnapshot?.scene?.score, this.expected.finalScore, `${label} must include authored score coverage`);
  assert.equal(finalSnapshot?.custom?.interactionFsmState, this.expected.fsmState, `${label} must include authored interaction FSM transition`);
  assert.equal(finalSnapshot?.custom?.collisionFsmState, this.expected.fsmState, `${label} must include authored collision FSM transition`);
  if (this.expected.timerFsmState !== undefined) {
    assert.equal(finalSnapshot?.custom?.timerFsmState, this.expected.timerFsmState, `${label} must include authored timer FSM transition`);
  }
  assert.deepEqual(setupSnapshot?.custom?.gameplayEvents, [], `${label} setup frame must not emit gameplay events early`);
  assert.deepEqual(finalSnapshot?.custom?.gameplayEvents, [], `${label} final frame must clear gameplay event buffer`);
  const handles = reactionSnapshot?.custom?.handles;
  assert.deepEqual(reactionSnapshot?.custom?.gameplayEvents, [
    {
      kind: "collisionDamage",
      kindCode: GAMEPLAY_EVENT_KIND_COLLISION_DAMAGE,
      actorId: handles?.enemy?.entityId,
      actorGeneration: handles?.enemy?.entityGeneration,
      sourceId: handles?.bullet?.entityId,
      sourceGeneration: handles?.bullet?.entityGeneration,
      tokenId: 0,
      flags: GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
      targetRemoved: true,
      payloadBits: 0x3f800000,
    },
    {
      kind: "factionDamageDenied",
      kindCode: GAMEPLAY_EVENT_KIND_FACTION_DAMAGE_DENIED,
      actorId: handles?.neutralEnemy?.entityId,
      actorGeneration: handles?.neutralEnemy?.entityGeneration,
      sourceId: handles?.neutralBullet?.entityId,
      sourceGeneration: handles?.neutralBullet?.entityGeneration,
      tokenId: 0,
      flags: 0,
      targetRemoved: false,
      payloadBits: 2,
    },
    {
      kind: "pickupCollected",
      kindCode: GAMEPLAY_EVENT_KIND_PICKUP_COLLECTED,
      actorId: handles?.player?.entityId,
      actorGeneration: handles?.player?.entityGeneration,
      sourceId: handles?.pickup?.entityId,
      sourceGeneration: handles?.pickup?.entityGeneration,
      tokenId: this.authoring.components.pickup.itemId,
      flags: GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
      targetRemoved: true,
      payloadBits: this.authoring.components.pickup.count,
    },
    {
      kind: "interaction",
      kindCode: GAMEPLAY_EVENT_KIND_INTERACTION,
      actorId: 0,
      actorGeneration: 0,
      sourceId: handles?.interactionSource?.entityId,
      sourceGeneration: handles?.interactionSource?.entityGeneration,
      tokenId: this.authoring.components.interaction.actionId,
      flags: GAMEPLAY_EVENT_FLAG_ONCE | GAMEPLAY_EVENT_FLAG_CONSUMED_THIS_FRAME,
      targetRemoved: false,
      payloadBits: 0,
    },
    {
      kind: "behaviorStateChanged",
      kindCode: GAMEPLAY_EVENT_KIND_BEHAVIOR_STATE_CHANGED,
      actorId: handles?.interactionSource?.entityId,
      actorGeneration: handles?.interactionSource?.entityGeneration,
      sourceId: handles?.interactionSource?.entityId,
      sourceGeneration: handles?.interactionSource?.entityGeneration,
      tokenId: this.authoring.components.fsm.transitionedState,
      flags: 0,
      targetRemoved: false,
      payloadBits: this.authoring.components.fsm.initialState,
    },
    {
      kind: "behaviorStateChanged",
      kindCode: GAMEPLAY_EVENT_KIND_BEHAVIOR_STATE_CHANGED,
      actorId: handles?.bullet?.entityId,
      actorGeneration: handles?.bullet?.entityGeneration,
      sourceId: handles?.bullet?.entityId,
      sourceGeneration: handles?.bullet?.entityGeneration,
      tokenId: this.authoring.components.fsm.transitionedState,
      flags: 0,
      targetRemoved: false,
      payloadBits: this.authoring.components.fsm.initialState,
    },
  ], `${label} must include exact authored gameplay event payloads`);
  const eventKinds = (reactionSnapshot?.custom?.gameplayEvents ?? []).map((event) => event.kind);
  assert.deepEqual(
    eventKinds,
    this.expected.eventKinds,
    `${label} must include authored interaction, collision damage, and FSM state telemetry events`,
  );
  if (this.expected.actionFailureFrame !== undefined) {
    assert.deepEqual(actionFailureSnapshot?.custom?.gameplayEvents, [
      {
        kind: "actionFailed",
        kindCode: GAMEPLAY_EVENT_KIND_ACTION_FAILED,
        actorId: actionFailureSnapshot?.custom?.handles?.player?.entityId,
        actorGeneration: actionFailureSnapshot?.custom?.handles?.player?.entityGeneration,
        sourceId: actionFailureSnapshot?.custom?.handles?.player?.entityId,
        sourceGeneration: actionFailureSnapshot?.custom?.handles?.player?.entityGeneration,
        tokenId: this.expected.actionFailureActionId,
        flags: 0,
        targetRemoved: false,
        payloadBits: this.expected.actionFailureReason,
      },
    ], `${label} must include exact authored action failure telemetry`);
    assert.deepEqual(
      (actionFailureSnapshot?.custom?.gameplayEvents ?? []).map((event) => event.kind),
      this.expected.actionFailureEventKinds,
      `${label} must include authored action failure event kinds`,
    );
  }
  if (this.expected.timerFrame !== undefined) {
    const timerSnapshot = snapshots.find((entry) => entry.frame === this.expected.timerFrame)?.snapshot;
    const previousTimerSnapshot = snapshots
      .filter((entry) => entry.frame < this.expected.timerFrame)
      .at(-1)?.snapshot;
    const timerHandles = timerSnapshot?.custom?.handles;
    const timerEvents = timerSnapshot?.custom?.gameplayEvents ?? [];
    assert.deepEqual(timerSnapshot?.custom?.gameplayEvents, [
      {
        kind: "timer",
        kindCode: GAMEPLAY_EVENT_KIND_TIMER,
        actorId: timerHandles?.timerSource?.entityId,
        actorGeneration: timerHandles?.timerSource?.entityGeneration,
        sourceId: timerHandles?.timerSource?.entityId,
        sourceGeneration: timerHandles?.timerSource?.entityGeneration,
        tokenId: this.authoring.components.timer.timerId,
        flags: 0,
        targetRemoved: false,
        payloadBits: f32Bits(this.authoring.components.timer.durationSeconds),
      },
      {
        kind: "prefabSpawned",
        kindCode: GAMEPLAY_EVENT_KIND_PREFAB_SPAWNED,
        actorId: timerEvents[1]?.actorId,
        actorGeneration: timerEvents[1]?.actorGeneration,
        sourceId: timerHandles?.timerSource?.entityId,
        sourceGeneration: timerHandles?.timerSource?.entityGeneration,
        tokenId: this.authoring.components.timerSpawnPrefab.prefabId,
        flags: 0,
        targetRemoved: false,
        payloadBits: this.authoring.components.timerSpawnPrefab.actionId,
      },
      {
        kind: "behaviorStateChanged",
        kindCode: GAMEPLAY_EVENT_KIND_BEHAVIOR_STATE_CHANGED,
        actorId: timerHandles?.timerSource?.entityId,
        actorGeneration: timerHandles?.timerSource?.entityGeneration,
        sourceId: timerHandles?.timerSource?.entityId,
        sourceGeneration: timerHandles?.timerSource?.entityGeneration,
        tokenId: this.authoring.components.timer.transitionedState,
        flags: 0,
        targetRemoved: false,
        payloadBits: this.authoring.components.timer.initialState,
      },
    ], `${label} must include exact authored timer telemetry`);
    assert.notEqual(
      timerEvents[1]?.actorId,
      timerHandles?.timerSource?.entityId,
      `${label} timer prefab spawn actor must be the newly spawned entity, not the timer source`,
    );
    assert.ok(
      timerSnapshot?.scene?.entityCount > previousTimerSnapshot?.scene?.entityCount,
      `${label} timer frame entity count must increase after Rust-owned prefab spawn`,
    );
    assert.deepEqual(
      (timerSnapshot?.custom?.gameplayEvents ?? []).map((event) => event.kind),
      this.expected.timerEventKinds,
      `${label} must include authored timer event kinds`,
    );
  }
}

function validateAuthoredPlayerDamageCollisionScenarioOutcome(fixture, label) {
  const snapshots = fixture.run?.snapshots ?? [];
  const setupFrame = this.input.events.find((event) => event.type === "authoring")?.frame;
  const setupSnapshot = snapshots.find((entry) => entry.frame === setupFrame)?.snapshot;
  const eventSnapshot = snapshots.find((entry) => entry.frame === this.expected.eventFrame)?.snapshot;
  const finalSnapshot = snapshots.at(-1)?.snapshot;
  const handles = eventSnapshot?.custom?.handles;

  assert.equal(finalSnapshot?.frame, this.frameCount, `${label} final snapshot frame must match`);
  assert.equal(finalSnapshot?.scene?.score, this.expected.finalScore, `${label} score must stay unchanged`);
  assert.equal(finalSnapshot?.scene?.gameState, this.expected.finalGameState, `${label} final game state must match`);
  assert.equal(setupSnapshot?.scene?.entityCount, this.expected.entityCountAfterSetup, `${label} setup entity count must include player and authored enemy`);
  assert.equal(finalSnapshot?.scene?.entityCount, this.expected.entityCountAfterSetup, `${label} player damage must not despawn player or enemy`);
  assert.deepEqual(setupSnapshot?.custom?.gameplayEvents, [], `${label} setup frame must not emit gameplay events early`);
  assert.deepEqual(finalSnapshot?.custom?.gameplayEvents, [], `${label} final frame must clear gameplay event buffer`);
  assert.deepEqual(eventSnapshot?.custom?.gameplayEvents, [
    {
      kind: "collisionDamage",
      kindCode: GAMEPLAY_EVENT_KIND_COLLISION_DAMAGE,
      actorId: handles?.player?.entityId,
      actorGeneration: handles?.player?.entityGeneration,
      sourceId: handles?.enemy?.entityId,
      sourceGeneration: handles?.enemy?.entityGeneration,
      tokenId: 0,
      flags: 0,
      targetRemoved: false,
      payloadBits: f32Bits(this.authoring.components.damage),
    },
  ], `${label} must include exact player damage telemetry without target removal`);
  assert.deepEqual(
    (eventSnapshot?.custom?.gameplayEvents ?? []).map((event) => event.kind),
    this.expected.eventKinds,
    `${label} must include expected event kinds`,
  );
}

function validateAuthoredProjectileTileImpactFsmScenarioOutcome(fixture, label) {
  const snapshots = fixture.run?.snapshots ?? [];
  const authoringFrame = this.input.events.find((event) => event.type === "authoring")?.frame;
  const authoringSnapshot = snapshots.find((entry) => entry.frame === authoringFrame)?.snapshot;
  const impactSnapshot = snapshots.find((entry) => entry.frame === this.expected.eventFrame)?.snapshot;
  const finalSnapshot = snapshots.at(-1)?.snapshot;
  const projectile = impactSnapshot?.custom?.projectile;

  assert.equal(finalSnapshot?.frame, this.frameCount, `${label} final snapshot frame must match`);
  assert.equal(finalSnapshot?.scene?.score, this.expected.finalScore, `${label} authored projectile tile impact scenario score must stay stable`);
  assert.deepEqual(authoringSnapshot?.custom?.gameplayEvents, [], `${label} authoring frame must not emit gameplay events early`);
  assert.equal(impactSnapshot?.custom?.fsmState, this.expected.fsmState, `${label} tile impact FSM must transition`);
  assert.deepEqual(impactSnapshot?.custom?.gameplayEvents, [
    {
      kind: "tileImpact",
      kindCode: GAMEPLAY_EVENT_KIND_TILE_IMPACT,
      actorId: this.expected.tileImpact.projectileId,
      actorGeneration: this.expected.tileImpact.projectileGeneration,
      sourceId: this.expected.tileImpact.projectileId,
      sourceGeneration: this.expected.tileImpact.projectileGeneration,
      tokenId: this.expected.tileImpact.tileImpactCode,
      flags: this.expected.tileImpact.flags,
      targetRemoved: this.expected.tileImpact.targetRemoved,
      payloadBits: this.expected.tileImpact.payloadBits,
    },
    {
      kind: "behaviorStateChanged",
      kindCode: GAMEPLAY_EVENT_KIND_BEHAVIOR_STATE_CHANGED,
      actorId: projectile?.entityId,
      actorGeneration: projectile?.entityGeneration,
      sourceId: projectile?.entityId,
      sourceGeneration: projectile?.entityGeneration,
      tokenId: this.authoredProjectileTileImpactFsm.fsm.transitionedState,
      flags: 0,
      targetRemoved: false,
      payloadBits: this.authoredProjectileTileImpactFsm.fsm.initialState,
    },
  ], `${label} must include exact tile impact to FSM transition telemetry`);
  assert.deepEqual(
    (impactSnapshot?.custom?.gameplayEvents ?? []).map((event) => event.kind),
    this.expected.eventKinds,
    `${label} must include authored projectile tile impact FSM event kinds`,
  );
}

function validateHomingMissileScenarioOutcome(fixture, label) {
  const snapshots = fixture.run?.snapshots ?? [];
  const authoringFrame = this.input.events.find((event) => event.type === "authoring")?.frame;
  const setupSnapshot = snapshots.find((entry) => entry.frame === authoringFrame)?.snapshot;
  const movementSnapshot = snapshots.find((entry) => entry.frame === this.expected.movementFrame)?.snapshot;
  const eventSnapshot = snapshots.find((entry) => entry.frame === this.expected.eventFrame)?.snapshot;
  const finalSnapshot = snapshots.at(-1)?.snapshot;
  const handles = eventSnapshot?.custom?.handles;
  const missile = handles?.missile;
  const hostileEnemy = handles?.["hostile-enemy"];
  const decoyEnemy = handles?.["decoy-enemy"];

  assert.equal(finalSnapshot?.frame, this.frameCount, `${label} final snapshot frame must match`);
  assert.equal(finalSnapshot?.scene?.score, this.expected.finalScore, `${label} final score must include homing missile reward`);
  assert.deepEqual(
    setupSnapshot?.custom?.commandSummary.map((command) => `${command.entity}:${command.type}`),
    this.expected.boundCommands,
    `${label} must bind expected homing missile behavior commands`,
  );
  assert.deepEqual(setupSnapshot?.custom?.gameplayEvents, [], `${label} setup frame must not emit gameplay events early`);
  assert.equal(movementSnapshot?.scene?.score, 0, `${label} movement frame must occur before collision score`);
  assert.ok(
    movementSnapshot?.custom?.missilePhysics?.x > this.homingMissile.bodies.missile.x,
    `${label} missile must move toward the tagged hostile target before impact`,
  );
  assertApproximatelyEqual(
    movementSnapshot?.custom?.missilePhysics?.y,
    this.homingMissile.bodies.missile.y,
    `${label} missile should stay on the horizontal homing line before impact`,
  );
  assert.deepEqual(eventSnapshot?.custom?.gameplayEvents, [
    {
      kind: "collisionDamage",
      kindCode: GAMEPLAY_EVENT_KIND_COLLISION_DAMAGE,
      actorId: hostileEnemy?.entityId,
      actorGeneration: hostileEnemy?.entityGeneration,
      sourceId: missile?.entityId,
      sourceGeneration: missile?.entityGeneration,
      tokenId: 0,
      flags: GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
      targetRemoved: true,
      payloadBits: f32Bits(this.homingMissile.expected.damage),
    },
    {
      kind: "collisionDespawn",
      kindCode: GAMEPLAY_EVENT_KIND_COLLISION_DESPAWN,
      actorId: missile?.entityId,
      actorGeneration: missile?.entityGeneration,
      sourceId: missile?.entityId,
      sourceGeneration: missile?.entityGeneration,
      tokenId: 0,
      flags: GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
      targetRemoved: true,
      payloadBits: 0,
    },
    {
      kind: "presentationEffect",
      kindCode: GAMEPLAY_EVENT_KIND_PRESENTATION_EFFECT,
      actorId: missile?.entityId,
      actorGeneration: missile?.entityGeneration,
      sourceId: hostileEnemy?.entityId,
      sourceGeneration: hostileEnemy?.entityGeneration,
      tokenId: this.homingMissile.expected.particlePresetId,
      flags: 0,
      targetRemoved: false,
      payloadBits: GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE,
    },
  ], `${label} must include exact homing missile impact telemetry`);
  assert.deepEqual(
    (eventSnapshot?.custom?.gameplayEvents ?? []).map((event) => event.kind),
    this.expected.eventKinds,
    `${label} must include homing missile event kinds`,
  );
  assert.equal(eventSnapshot?.scene?.score, this.expected.finalScore, `${label} impact frame must apply score reward`);
  assert.equal(eventSnapshot?.custom?.missilePhysics, undefined, `${label} impact frame must despawn missile`);
  assert.equal(eventSnapshot?.custom?.hostileEnemyPhysics, undefined, `${label} impact frame must despawn hostile enemy`);
  assert.ok(eventSnapshot?.custom?.decoyEnemyPhysics !== undefined, `${label} nearestTag target must leave untagged decoy alive`);
  assert.equal(
    eventSnapshot?.custom?.decoyEnemyPhysics?.entityId,
    decoyEnemy?.entityId,
    `${label} surviving decoy physics state must match decoy handle`,
  );
  assert.deepEqual(finalSnapshot?.custom?.gameplayEvents, [], `${label} final frame must clear gameplay event buffer`);
}

function validateExplosiveProjectileScenarioOutcome(fixture, label) {
  const snapshots = fixture.run?.snapshots ?? [];
  const authoringFrame = this.input.events.find((event) => event.type === "authoring")?.frame;
  const setupSnapshot = snapshots.find((entry) => entry.frame === authoringFrame)?.snapshot;
  const movementSnapshot = snapshots.find((entry) => entry.frame === this.expected.movementFrame)?.snapshot;
  const eventSnapshot = snapshots.find((entry) => entry.frame === this.expected.eventFrame)?.snapshot;
  const finalSnapshot = snapshots.at(-1)?.snapshot;
  const handles = eventSnapshot?.custom?.handles;
  const projectile = handles?.["explosive-projectile"];
  const directEnemy = handles?.["blast-direct"];
  const splashEnemy = handles?.["blast-splash"];
  const farEnemy = handles?.["blast-far"];

  assert.equal(finalSnapshot?.frame, this.frameCount, `${label} final snapshot frame must match`);
  assert.equal(finalSnapshot?.scene?.score, this.expected.finalScore, `${label} final score must include explosive area reward`);
  assert.deepEqual(
    setupSnapshot?.custom?.commandSummary.map((command) => `${command.entity}:${command.type}`),
    this.expected.boundCommands,
    `${label} must bind expected explosive projectile behavior commands`,
  );
  assert.deepEqual(setupSnapshot?.custom?.gameplayEvents, [], `${label} setup frame must not emit gameplay events early`);
  assert.equal(movementSnapshot?.scene?.score, 0, `${label} movement frame must occur before explosive impact score`);
  assert.ok(
    movementSnapshot?.custom?.projectilePhysics?.x > this.explosiveProjectile.bodies["explosive-projectile"].x,
    `${label} explosive projectile must move before impact`,
  );
  assert.deepEqual(eventSnapshot?.custom?.gameplayEvents, [
    {
      kind: "collisionDamage",
      kindCode: GAMEPLAY_EVENT_KIND_COLLISION_DAMAGE,
      actorId: directEnemy?.entityId,
      actorGeneration: directEnemy?.entityGeneration,
      sourceId: projectile?.entityId,
      sourceGeneration: projectile?.entityGeneration,
      tokenId: 0,
      flags: GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
      targetRemoved: true,
      payloadBits: f32Bits(this.explosiveProjectile.expected.damage),
    },
    {
      kind: "collisionDamage",
      kindCode: GAMEPLAY_EVENT_KIND_COLLISION_DAMAGE,
      actorId: splashEnemy?.entityId,
      actorGeneration: splashEnemy?.entityGeneration,
      sourceId: projectile?.entityId,
      sourceGeneration: projectile?.entityGeneration,
      tokenId: 0,
      flags: GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
      targetRemoved: true,
      payloadBits: f32Bits(this.explosiveProjectile.expected.damage),
    },
    {
      kind: "collisionDespawn",
      kindCode: GAMEPLAY_EVENT_KIND_COLLISION_DESPAWN,
      actorId: projectile?.entityId,
      actorGeneration: projectile?.entityGeneration,
      sourceId: projectile?.entityId,
      sourceGeneration: projectile?.entityGeneration,
      tokenId: 0,
      flags: GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
      targetRemoved: true,
      payloadBits: 0,
    },
    {
      kind: "presentationEffect",
      kindCode: GAMEPLAY_EVENT_KIND_PRESENTATION_EFFECT,
      actorId: projectile?.entityId,
      actorGeneration: projectile?.entityGeneration,
      sourceId: directEnemy?.entityId,
      sourceGeneration: directEnemy?.entityGeneration,
      tokenId: this.explosiveProjectile.expected.effectId,
      flags: 0,
      targetRemoved: false,
      payloadBits: GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE,
    },
  ], `${label} must include exact explosive projectile impact telemetry`);
  assert.deepEqual(
    (eventSnapshot?.custom?.gameplayEvents ?? []).map((event) => event.kind),
    this.expected.eventKinds,
    `${label} must include explosive projectile event kinds`,
  );
  assert.equal(eventSnapshot?.scene?.score, this.expected.finalScore, `${label} impact frame must apply area score reward`);
  assert.equal(eventSnapshot?.custom?.projectilePhysics, undefined, `${label} impact frame must despawn explosive projectile`);
  assert.equal(eventSnapshot?.custom?.directEnemyPhysics, undefined, `${label} impact frame must despawn direct target`);
  assert.equal(eventSnapshot?.custom?.splashEnemyPhysics, undefined, `${label} impact frame must despawn splash target`);
  assert.ok(eventSnapshot?.custom?.farEnemyPhysics !== undefined, `${label} area damage radius must leave far target alive`);
  assert.equal(
    eventSnapshot?.custom?.farEnemyPhysics?.entityId,
    farEnemy?.entityId,
    `${label} surviving far enemy physics state must match far enemy handle`,
  );
  assert.deepEqual(finalSnapshot?.custom?.gameplayEvents, [], `${label} final frame must clear gameplay event buffer`);
}

function validateTileImpactAreaDamageScenarioOutcome(fixture, label) {
  const snapshots = fixture.run?.snapshots ?? [];
  const authoringFrame = this.input.events.find((event) => event.type === "authoring")?.frame;
  const setupSnapshot = snapshots.find((entry) => entry.frame === authoringFrame)?.snapshot;
  const eventSnapshot = snapshots.find((entry) => entry.frame === this.expected.eventFrame)?.snapshot;
  const finalSnapshot = snapshots.at(-1)?.snapshot;
  const handles = eventSnapshot?.custom?.handles;
  const projectile = handles?.["tile-projectile"];
  const directEnemy = handles?.["tile-blast-direct"];
  const splashEnemy = handles?.["tile-blast-splash"];
  const farEnemy = handles?.["tile-blast-far"];

  assert.equal(finalSnapshot?.frame, this.frameCount, `${label} final snapshot frame must match`);
  assert.equal(finalSnapshot?.scene?.score, this.expected.finalScore, `${label} final score must include tile impact area reward`);
  assert.deepEqual(
    setupSnapshot?.custom?.commandSummary.map((command) => `${command.entity}:${command.type}`),
    this.expected.boundCommands,
    `${label} must bind expected tile impact area damage commands`,
  );
  assert.deepEqual(setupSnapshot?.custom?.gameplayEvents, [], `${label} setup frame must not emit gameplay events early`);
  assert.deepEqual(eventSnapshot?.custom?.gameplayEvents, [
    {
      kind: "collisionDamage",
      kindCode: GAMEPLAY_EVENT_KIND_COLLISION_DAMAGE,
      actorId: directEnemy?.entityId,
      actorGeneration: directEnemy?.entityGeneration,
      sourceId: projectile?.entityId,
      sourceGeneration: projectile?.entityGeneration,
      tokenId: 0,
      flags: GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
      targetRemoved: true,
      payloadBits: f32Bits(this.tileImpactAreaDamage.expected.damage),
    },
    {
      kind: "collisionDamage",
      kindCode: GAMEPLAY_EVENT_KIND_COLLISION_DAMAGE,
      actorId: splashEnemy?.entityId,
      actorGeneration: splashEnemy?.entityGeneration,
      sourceId: projectile?.entityId,
      sourceGeneration: projectile?.entityGeneration,
      tokenId: 0,
      flags: GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
      targetRemoved: true,
      payloadBits: f32Bits(this.tileImpactAreaDamage.expected.damage),
    },
    {
      kind: "tileImpact",
      kindCode: GAMEPLAY_EVENT_KIND_TILE_IMPACT,
      actorId: projectile?.entityId,
      actorGeneration: projectile?.entityGeneration,
      sourceId: projectile?.entityId,
      sourceGeneration: projectile?.entityGeneration,
      tokenId: this.tileImpactAreaDamage.tileImpactCode,
      flags: this.expected.tileImpact.flags,
      targetRemoved: true,
      payloadBits: this.expected.tileImpact.payloadBits,
    },
  ], `${label} must include exact tile impact area damage telemetry`);
  assert.deepEqual(
    (eventSnapshot?.custom?.gameplayEvents ?? []).map((event) => event.kind),
    this.expected.eventKinds,
    `${label} must include tile impact area damage event kinds`,
  );
  assert.equal(eventSnapshot?.scene?.score, this.expected.finalScore, `${label} impact frame must apply tile impact area score reward`);
  assert.equal(eventSnapshot?.custom?.projectilePhysics, undefined, `${label} impact frame must despawn tile projectile`);
  assert.equal(eventSnapshot?.custom?.directEnemyPhysics, undefined, `${label} impact frame must despawn direct tile area target`);
  assert.equal(eventSnapshot?.custom?.splashEnemyPhysics, undefined, `${label} impact frame must despawn splash tile area target`);
  assert.ok(eventSnapshot?.custom?.farEnemyPhysics !== undefined, `${label} tile area radius must leave far target alive`);
  assert.equal(
    eventSnapshot?.custom?.farEnemyPhysics?.entityId,
    farEnemy?.entityId,
    `${label} surviving far enemy physics state must match far enemy handle`,
  );
  assert.deepEqual(finalSnapshot?.custom?.gameplayEvents, [], `${label} final frame must clear gameplay event buffer`);
}

function validateWaveActionScenarioOutcome(fixture, label) {
  const snapshots = fixture.run?.snapshots ?? [];
  const eventSnapshot = snapshots.find((entry) => entry.frame === this.expected.eventFrame)?.snapshot;
  const previousSnapshot = snapshots
    .filter((entry) => entry.frame < this.expected.eventFrame)
    .at(-1)?.snapshot;
  const finalSnapshot = snapshots.at(-1)?.snapshot;
  assert.equal(finalSnapshot?.frame, this.frameCount, `${label} final snapshot frame must match`);
  assert.equal(finalSnapshot?.scene?.score, this.expected.finalScore, `${label} wave action scenario score must stay stable`);
  assert.deepEqual(finalSnapshot?.custom?.gameplayEvents, [], `${label} final frame must clear gameplay event buffer`);
  const source = eventSnapshot?.custom?.source;
  const events = eventSnapshot?.custom?.gameplayEvents ?? [];
  assert.deepEqual(events, [
    {
      kind: "prefabSpawned",
      kindCode: GAMEPLAY_EVENT_KIND_PREFAB_SPAWNED,
      actorId: events[0]?.actorId,
      actorGeneration: events[0]?.actorGeneration,
      sourceId: source?.entityId,
      sourceGeneration: source?.entityGeneration,
      tokenId: this.waveAction.spawnPrefab.prefabId,
      flags: 0,
      targetRemoved: false,
      payloadBits: this.waveAction.spawnPrefab.actionId,
    },
  ], `${label} must include exact wave-enter prefab spawn telemetry`);
  assert.notEqual(
    events[0]?.actorId,
    source?.entityId,
    `${label} wave prefab spawn actor must be the newly spawned entity, not the source`,
  );
  assert.ok(
    eventSnapshot?.scene?.entityCount > previousSnapshot?.scene?.entityCount,
    `${label} wave event frame entity count must increase after Rust-owned prefab spawn`,
  );
  assert.deepEqual(
    events.map((event) => event.kind),
    this.expected.eventKinds,
    `${label} must include wave action trigger event kinds`,
  );
}

function validateStateEnterActionScenarioOutcome(fixture, label) {
  const snapshots = fixture.run?.snapshots ?? [];
  const authoringFrame = this.input.events.find((event) => event.type === "authoring")?.frame;
  const authoringSnapshot = snapshots.find((entry) => entry.frame === authoringFrame)?.snapshot;
  const transitionSnapshot = snapshots.find((entry) => entry.frame === this.expected.transitionFrame)?.snapshot;
  const eventSnapshot = snapshots.find((entry) => entry.frame === this.expected.eventFrame)?.snapshot;
  const previousSnapshot = snapshots
    .filter((entry) => entry.frame < this.expected.eventFrame)
    .at(-1)?.snapshot;
  const finalSnapshot = snapshots.at(-1)?.snapshot;
  assert.equal(finalSnapshot?.frame, this.frameCount, `${label} final snapshot frame must match`);
  assert.equal(finalSnapshot?.scene?.score, this.expected.finalScore, `${label} state-enter action scenario score must stay stable`);
  assert.equal(finalSnapshot?.custom?.fsmState, this.expected.fsmState, `${label} must keep final FSM state`);
  assert.deepEqual(authoringSnapshot?.custom?.gameplayEvents, [], `${label} authoring frame must not emit gameplay events early`);
  assert.deepEqual(finalSnapshot?.custom?.gameplayEvents, [], `${label} final frame must clear gameplay event buffer`);

  const source = transitionSnapshot?.custom?.source;
  assert.deepEqual(transitionSnapshot?.custom?.gameplayEvents, [
    {
      kind: "timer",
      kindCode: GAMEPLAY_EVENT_KIND_TIMER,
      actorId: source?.entityId,
      actorGeneration: source?.entityGeneration,
      sourceId: source?.entityId,
      sourceGeneration: source?.entityGeneration,
      tokenId: this.stateEnterAction.timer.timerId,
      flags: 0,
      targetRemoved: false,
      payloadBits: f32Bits(this.stateEnterAction.timer.durationSeconds),
    },
    {
      kind: "behaviorStateChanged",
      kindCode: GAMEPLAY_EVENT_KIND_BEHAVIOR_STATE_CHANGED,
      actorId: source?.entityId,
      actorGeneration: source?.entityGeneration,
      sourceId: source?.entityId,
      sourceGeneration: source?.entityGeneration,
      tokenId: this.stateEnterAction.fsm.transitionedState,
      flags: 0,
      targetRemoved: false,
      payloadBits: this.stateEnterAction.fsm.initialState,
    },
  ], `${label} must include exact state-enter transition telemetry`);
  assert.deepEqual(
    (transitionSnapshot?.custom?.gameplayEvents ?? []).map((event) => event.kind),
    this.expected.transitionEventKinds,
    `${label} must include state-enter transition event kinds`,
  );

  const events = eventSnapshot?.custom?.gameplayEvents ?? [];
  assert.deepEqual(events, [
    {
      kind: "prefabSpawned",
      kindCode: GAMEPLAY_EVENT_KIND_PREFAB_SPAWNED,
      actorId: events[0]?.actorId,
      actorGeneration: events[0]?.actorGeneration,
      sourceId: source?.entityId,
      sourceGeneration: source?.entityGeneration,
      tokenId: this.stateEnterAction.spawnPrefab.prefabId,
      flags: 0,
      targetRemoved: false,
      payloadBits: this.stateEnterAction.spawnPrefab.actionId,
    },
  ], `${label} must include exact state-enter prefab spawn telemetry`);
  assert.notEqual(
    events[0]?.actorId,
    source?.entityId,
    `${label} state-enter prefab spawn actor must be the newly spawned entity, not the source`,
  );
  assert.ok(
    eventSnapshot?.scene?.entityCount > previousSnapshot?.scene?.entityCount,
    `${label} state-enter event frame entity count must increase after Rust-owned prefab spawn`,
  );
  assert.deepEqual(
    events.map((event) => event.kind),
    this.expected.eventKinds,
    `${label} must include state-enter action trigger event kinds`,
  );
}

function validateStateEnterDashActionScenarioOutcome(fixture, label) {
  const snapshots = fixture.run?.snapshots ?? [];
  const authoringFrame = this.input.events.find((event) => event.type === "authoring")?.frame;
  const authoringSnapshot = snapshots.find((entry) => entry.frame === authoringFrame)?.snapshot;
  const transitionSnapshot = snapshots.find((entry) => entry.frame === this.expected.transitionFrame)?.snapshot;
  const dashSnapshot = snapshots.find((entry) => entry.frame === this.expected.dashFrame)?.snapshot;
  const previousSnapshot = snapshots
    .filter((entry) => entry.frame < this.expected.dashFrame)
    .at(-1)?.snapshot;
  const finalSnapshot = snapshots.at(-1)?.snapshot;
  assert.equal(finalSnapshot?.frame, this.frameCount, `${label} final snapshot frame must match`);
  assert.equal(finalSnapshot?.scene?.score, this.expected.finalScore, `${label} state-enter dash scenario score must stay stable`);
  assert.equal(finalSnapshot?.custom?.fsmState, this.expected.fsmState, `${label} must keep final FSM state`);
  assert.deepEqual(authoringSnapshot?.custom?.gameplayEvents, [], `${label} authoring frame must not emit gameplay events early`);
  assert.deepEqual(finalSnapshot?.custom?.gameplayEvents, [], `${label} final frame must clear gameplay event buffer`);

  const source = transitionSnapshot?.custom?.source;
  assert.deepEqual(transitionSnapshot?.custom?.gameplayEvents, [
    {
      kind: "timer",
      kindCode: GAMEPLAY_EVENT_KIND_TIMER,
      actorId: source?.entityId,
      actorGeneration: source?.entityGeneration,
      sourceId: source?.entityId,
      sourceGeneration: source?.entityGeneration,
      tokenId: this.stateEnterDashAction.timer.timerId,
      flags: 0,
      targetRemoved: false,
      payloadBits: f32Bits(this.stateEnterDashAction.timer.durationSeconds),
    },
    {
      kind: "behaviorStateChanged",
      kindCode: GAMEPLAY_EVENT_KIND_BEHAVIOR_STATE_CHANGED,
      actorId: source?.entityId,
      actorGeneration: source?.entityGeneration,
      sourceId: source?.entityId,
      sourceGeneration: source?.entityGeneration,
      tokenId: this.stateEnterDashAction.fsm.transitionedState,
      flags: 0,
      targetRemoved: false,
      payloadBits: this.stateEnterDashAction.fsm.initialState,
    },
  ], `${label} must include exact state-enter dash transition telemetry`);
  assert.deepEqual(
    (transitionSnapshot?.custom?.gameplayEvents ?? []).map((event) => event.kind),
    this.expected.transitionEventKinds,
    `${label} must include state-enter dash transition event kinds`,
  );
  assertPosition(
    transitionSnapshot?.custom?.sourcePhysics,
    this.expected.sourceBeforeDash,
    `${label} source must not move on the transition frame`,
  );

  if (this.expected.actionFailureReason === undefined) {
    assert.deepEqual(dashSnapshot?.custom?.gameplayEvents, [], `${label} dash success must not emit a success gameplay event yet`);
  } else {
    assert.deepEqual(dashSnapshot?.custom?.gameplayEvents, [
      {
        kind: "actionFailed",
        kindCode: GAMEPLAY_EVENT_KIND_ACTION_FAILED,
        actorId: source?.entityId,
        actorGeneration: source?.entityGeneration,
        sourceId: source?.entityId,
        sourceGeneration: source?.entityGeneration,
        tokenId: this.stateEnterDashAction.dashAction.actionId,
        flags: 0,
        targetRemoved: false,
        payloadBits: this.expected.actionFailureReason,
      },
    ], `${label} dash failure must emit exact action failure telemetry`);
  }
  assert.equal(
    dashSnapshot?.scene?.entityCount,
    previousSnapshot?.scene?.entityCount,
    `${label} dash action must not spawn or despawn entities`,
  );
  assertPosition(
    dashSnapshot?.custom?.sourcePhysics,
    this.expected.actionFailureReason === undefined
      ? this.expected.sourceAfterDash
      : transitionSnapshot?.custom?.sourcePhysics,
    this.expected.actionFailureReason === undefined
      ? `${label} source must dash toward the player on the next pre-physics frame`
      : `${label} source must stay in place when triggered dash aim is unsupported`,
  );
  assert.deepEqual(
    (dashSnapshot?.custom?.gameplayEvents ?? []).map((event) => event.kind),
    this.expected.dashEventKinds,
    `${label} must include state-enter dash event kinds`,
  );
}

function validateStateEnterProjectileActionScenarioOutcome(fixture, label) {
  const snapshots = fixture.run?.snapshots ?? [];
  const authoringFrame = this.input.events.find((event) => event.type === "authoring")?.frame;
  const authoringSnapshot = snapshots.find((entry) => entry.frame === authoringFrame)?.snapshot;
  const transitionSnapshot = snapshots.find((entry) => entry.frame === this.expected.transitionFrame)?.snapshot;
  const projectileSnapshot = snapshots.find((entry) => entry.frame === this.expected.projectileFrame)?.snapshot;
  const finalSnapshot = snapshots.at(-1)?.snapshot;
  const source = transitionSnapshot?.custom?.source;

  assert.equal(finalSnapshot?.frame, this.frameCount, `${label} final snapshot frame must match`);
  assert.equal(finalSnapshot?.scene?.score, this.expected.finalScore, `${label} state-enter projectile scenario score must stay stable`);
  assert.equal(finalSnapshot?.custom?.fsmState, this.expected.fsmState, `${label} must keep final FSM state`);
  assert.deepEqual(authoringSnapshot?.custom?.gameplayEvents, [], `${label} authoring frame must not emit gameplay events early`);
  assert.deepEqual(finalSnapshot?.custom?.gameplayEvents, [], `${label} final frame must clear gameplay event buffer`);
  assert.equal(projectileSnapshot?.scene?.gameState, this.expected.projectileFrameGameState, `${label} projectile frame game state must match`);

  assert.deepEqual(transitionSnapshot?.custom?.gameplayEvents, [
    {
      kind: "timer",
      kindCode: GAMEPLAY_EVENT_KIND_TIMER,
      actorId: source?.entityId,
      actorGeneration: source?.entityGeneration,
      sourceId: source?.entityId,
      sourceGeneration: source?.entityGeneration,
      tokenId: this.stateEnterProjectileAction.timer.timerId,
      flags: 0,
      targetRemoved: false,
      payloadBits: f32Bits(this.stateEnterProjectileAction.timer.durationSeconds),
    },
    {
      kind: "behaviorStateChanged",
      kindCode: GAMEPLAY_EVENT_KIND_BEHAVIOR_STATE_CHANGED,
      actorId: source?.entityId,
      actorGeneration: source?.entityGeneration,
      sourceId: source?.entityId,
      sourceGeneration: source?.entityGeneration,
      tokenId: this.stateEnterProjectileAction.fsm.transitionedState,
      flags: 0,
      targetRemoved: false,
      payloadBits: this.stateEnterProjectileAction.fsm.initialState,
    },
  ], `${label} must include exact state-enter projectile transition telemetry`);
  assert.deepEqual(
    (transitionSnapshot?.custom?.gameplayEvents ?? []).map((event) => event.kind),
    this.expected.transitionEventKinds,
    `${label} must include state-enter projectile transition event kinds`,
  );

  if (this.expected.actionFailureReason === undefined && this.expected.tileImpact === undefined) {
    assert.deepEqual(projectileSnapshot?.custom?.gameplayEvents, [], `${label} projectile success must not emit a success gameplay event`);
  } else if (this.expected.tileImpact !== undefined) {
    assert.deepEqual(projectileSnapshot?.custom?.gameplayEvents, [
      {
        kind: "tileImpact",
        kindCode: GAMEPLAY_EVENT_KIND_TILE_IMPACT,
        actorId: this.expected.tileImpact.projectileId,
        actorGeneration: this.expected.tileImpact.projectileGeneration,
        sourceId: this.expected.tileImpact.projectileId,
        sourceGeneration: this.expected.tileImpact.projectileGeneration,
        tokenId: this.expected.tileImpact.tileImpactCode,
        flags: this.expected.tileImpact.flags,
        targetRemoved: this.expected.tileImpact.targetRemoved,
        payloadBits: this.expected.tileImpact.payloadBits,
      },
    ], `${label} projectile blocking tile must emit exact tile impact telemetry`);
  } else {
    assert.deepEqual(projectileSnapshot?.custom?.gameplayEvents, [
      {
        kind: "actionFailed",
        kindCode: GAMEPLAY_EVENT_KIND_ACTION_FAILED,
        actorId: source?.entityId,
        actorGeneration: source?.entityGeneration,
        sourceId: source?.entityId,
        sourceGeneration: source?.entityGeneration,
        tokenId: this.stateEnterProjectileAction.projectileAction.actionId,
        flags: 0,
        targetRemoved: false,
        payloadBits: this.expected.actionFailureReason,
      },
    ], `${label} projectile failure must emit exact action failure telemetry`);
  }
  assert.deepEqual(
    (projectileSnapshot?.custom?.gameplayEvents ?? []).map((event) => event.kind),
    this.expected.projectileEventKinds,
    `${label} must include state-enter projectile event kinds`,
  );
}

function validateStateEnterMeleeActionScenarioOutcome(fixture, label) {
  const snapshots = fixture.run?.snapshots ?? [];
  const authoringFrame = this.input.events.find((event) => event.type === "authoring")?.frame;
  const authoringSnapshot = snapshots.find((entry) => entry.frame === authoringFrame)?.snapshot;
  const transitionSnapshot = snapshots.find((entry) => entry.frame === this.expected.transitionFrame)?.snapshot;
  const meleeSnapshot = snapshots.find((entry) => entry.frame === this.expected.meleeFrame)?.snapshot;
  const finalSnapshot = snapshots.at(-1)?.snapshot;
  const source = transitionSnapshot?.custom?.source;

  assert.equal(finalSnapshot?.frame, this.frameCount, `${label} final snapshot frame must match`);
  assert.equal(finalSnapshot?.scene?.score, this.expected.finalScore, `${label} state-enter melee scenario score must stay stable`);
  assert.equal(finalSnapshot?.custom?.fsmState, this.expected.fsmState, `${label} must keep final FSM state`);
  assert.deepEqual(authoringSnapshot?.custom?.gameplayEvents, [], `${label} authoring frame must not emit gameplay events early`);
  assert.deepEqual(finalSnapshot?.custom?.gameplayEvents, [], `${label} final frame must clear gameplay event buffer`);
  assert.equal(meleeSnapshot?.scene?.gameState, this.expected.meleeFrameGameState, `${label} melee frame game state must match`);

  assert.deepEqual(transitionSnapshot?.custom?.gameplayEvents, [
    {
      kind: "timer",
      kindCode: GAMEPLAY_EVENT_KIND_TIMER,
      actorId: source?.entityId,
      actorGeneration: source?.entityGeneration,
      sourceId: source?.entityId,
      sourceGeneration: source?.entityGeneration,
      tokenId: this.stateEnterMeleeAction.timer.timerId,
      flags: 0,
      targetRemoved: false,
      payloadBits: f32Bits(this.stateEnterMeleeAction.timer.durationSeconds),
    },
    {
      kind: "behaviorStateChanged",
      kindCode: GAMEPLAY_EVENT_KIND_BEHAVIOR_STATE_CHANGED,
      actorId: source?.entityId,
      actorGeneration: source?.entityGeneration,
      sourceId: source?.entityId,
      sourceGeneration: source?.entityGeneration,
      tokenId: this.stateEnterMeleeAction.fsm.transitionedState,
      flags: 0,
      targetRemoved: false,
      payloadBits: this.stateEnterMeleeAction.fsm.initialState,
    },
  ], `${label} must include exact state-enter melee transition telemetry`);
  assert.deepEqual(
    (transitionSnapshot?.custom?.gameplayEvents ?? []).map((event) => event.kind),
    this.expected.transitionEventKinds,
    `${label} must include state-enter melee transition event kinds`,
  );

  if (this.expected.actionFailureReason === undefined) {
    if (this.expected.meleeEventKinds.length === 0) {
      assert.deepEqual(meleeSnapshot?.custom?.gameplayEvents, [], `${label} melee success must not emit a success gameplay event`);
    }
  } else {
    assert.deepEqual(meleeSnapshot?.custom?.gameplayEvents, [
      {
        kind: "actionFailed",
        kindCode: GAMEPLAY_EVENT_KIND_ACTION_FAILED,
        actorId: source?.entityId,
        actorGeneration: source?.entityGeneration,
        sourceId: source?.entityId,
        sourceGeneration: source?.entityGeneration,
        tokenId: this.stateEnterMeleeAction.meleeAction.actionId,
        flags: 0,
        targetRemoved: false,
        payloadBits: this.expected.actionFailureReason,
      },
    ], `${label} melee failure must emit exact action failure telemetry`);
  }
  assert.deepEqual(
    (meleeSnapshot?.custom?.gameplayEvents ?? []).map((event) => event.kind),
    this.expected.meleeEventKinds,
    `${label} must include state-enter melee event kinds`,
  );
}

async function readScenarioManifest(manifestPath, options = {}) {
  const resolvedPath = manifestPath ?? resolve(REPO_ROOT, DEFAULT_SCENARIO_MANIFEST_PATH);
  const manifestDir = dirname(resolvedPath);
  const rawManifest = JSON.parse(await readFile(resolvedPath, "utf8"));
  const coverage = await readCoverageTagDefinitions(rawManifest, manifestDir, resolvedPath);
  const manifest = {
    ...rawManifest,
    ...(coverage.path === undefined ? {} : { coverageTagDefinitionsPath: coverage.path }),
    coverageTagDefinitions: coverage.definitions,
    ...(coverage.groups === undefined ? {} : { coverageTagGroups: coverage.groups }),
    ...(coverage.deprecatedTags === undefined ? {} : { deprecatedCoverageTags: coverage.deprecatedTags }),
  };
  validateScenarioManifest(manifest, resolvedPath);
  const fixtureIndexPath = manifest.fixtureIndexPath === undefined
    ? undefined
    : resolveManifestPath(manifestDir, manifest.fixtureIndexPath);
  const fixtureIndex = fixtureIndexPath === undefined || options.allowMissingFixtureIndex === true
    ? undefined
    : await readScenarioFixtureIndex(fixtureIndexPath, manifest, resolvedPath);
  return {
    ...manifest,
    manifestPath: resolvedPath,
    ...(coverage.path === undefined ? {} : { coverageTagDefinitionsPath: coverage.path }),
    ...(fixtureIndexPath === undefined ? {} : { fixtureIndexPath }),
    ...(fixtureIndex === undefined ? {} : { fixtureIndex }),
    scenarios: manifest.scenarios.map((scenario, index) => prepareScenario(scenario, index, resolvedPath, manifestDir)),
  };
}

async function readCoverageTagDefinitions(document, documentDir, documentPath) {
  if (document.coverageTagDefinitionsPath !== undefined) {
    assertNonEmptyString(document.coverageTagDefinitionsPath, `${documentPath}.coverageTagDefinitionsPath`);
    const coveragePath = resolveManifestPath(documentDir, document.coverageTagDefinitionsPath);
    const coverage = JSON.parse(await readFile(coveragePath, "utf8"));
    assertPlainObject(coverage, coveragePath);
    assert.equal(coverage.format, COVERAGE_TAGS_FORMAT, `${coveragePath}.format must match`);
    assert.equal(coverage.version, COVERAGE_TAGS_VERSION, `${coveragePath}.version must match`);
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

function validateScenarioManifest(manifest, manifestPath) {
  assertPlainObject(manifest, manifestPath);
  assert.equal(manifest.format, SCENARIO_MANIFEST_FORMAT, `${manifestPath}.format must match`);
  assert.equal(manifest.version, SCENARIO_MANIFEST_VERSION, `${manifestPath}.version must match`);
  assert.equal(manifest.fixedDeltaSeconds, FIXED_DELTA_SECONDS, `${manifestPath}.fixedDeltaSeconds must match`);
  if (manifest.fixtureIndexPath !== undefined) {
    assertNonEmptyString(manifest.fixtureIndexPath, `${manifestPath}.fixtureIndexPath`);
  }
  assertCoverageTagDefinitions(manifest.coverageTagDefinitions, `${manifestPath}.coverageTagDefinitions`);
  assert.ok(Array.isArray(manifest.scenarios), `${manifestPath}.scenarios must be an array`);
  assert.ok(manifest.scenarios.length > 0, `${manifestPath}.scenarios must not be empty`);

  const scenarioIds = new Set();
  const usedCoverageTags = new Set();
  manifest.scenarios.forEach((scenario, index) => {
    const label = `${manifestPath}.scenarios[${index}]`;
    assertPlainObject(scenario, label);
    assertNonEmptyString(scenario.id, `${label}.id`);
    assert.ok(!scenarioIds.has(scenario.id), `${label}.id must be unique`);
    scenarioIds.add(scenario.id);
    assertNonEmptyString(scenario.description, `${label}.description`);
    assertCoverageTags(scenario.coverageTags, `${label}.coverageTags`);
    for (const tag of scenario.coverageTags) {
      assert.ok(
        manifest.coverageTagDefinitions[tag] !== undefined,
        `${label}.coverageTags must reference defined coverage tag '${tag}'`,
      );
      assert.ok(
        manifest.deprecatedCoverageTags?.[tag] === undefined,
        `${label}.coverageTags must not use deprecated coverage tag '${tag}'`,
      );
      usedCoverageTags.add(tag);
    }
    assertNonEmptyString(scenario.runner, `${label}.runner`);
    assert.ok(SCENARIO_RUNNERS[scenario.runner] !== undefined, `${label}.runner must reference a known runner`);
    assertNonEmptyString(scenario.fixturePath, `${label}.fixturePath`);
    assertPositiveInteger(scenario.frameCount, `${label}.frameCount`);
    assertCaptureFrames(scenario.captureFrames, scenario.frameCount, `${label}.captureFrames`);
    assertPlainObject(scenario.input, `${label}.input`);
    assertInputEvents(scenario.input.events, scenario.frameCount, `${label}.input.events`);
    assertPlainObject(scenario.expected, `${label}.expected`);
    assertReplayHash(scenario.expected.replayHash, `${label}.expected.replayHash`);
    assertFiniteNumber(scenario.expected.finalScore, `${label}.expected.finalScore`);
    assertExpectedSpawnDiagnostics(scenario.expected.spawnDiagnostics, scenario.captureFrames, `${label}.expected.spawnDiagnostics`);
    assertScenarioCoverageTags(scenario, label);
    if (scenario.expected.spawnExpectationPatchCount !== undefined) {
      assertNonNegativeInteger(scenario.expected.spawnExpectationPatchCount, `${label}.expected.spawnExpectationPatchCount`);
    }

    if (scenario.runner === "exampleTopdownAuthoredBehavior") {
      assertAuthoredScenarioMetadata(scenario, label);
    }
    if (scenario.runner === "playerDamageCollision") {
      assertAuthoredPlayerDamageCollisionScenarioMetadata(scenario, label);
    }
    if (scenario.runner === "projectileTileImpactFsmAuthored") {
      assertAuthoredProjectileTileImpactFsmScenarioMetadata(scenario, label);
    }
    if (scenario.runner === "projectileHomingNearestTag") {
      assertHomingMissileScenarioMetadata(scenario, label);
    }
    if (scenario.runner === "projectileAreaDamageEntityImpact") {
      assertExplosiveProjectileScenarioMetadata(scenario, label);
    }
    if (scenario.runner === "projectileAreaDamageTileImpact") {
      assertTileImpactAreaDamageScenarioMetadata(scenario, label);
    }
    if (scenario.runner === "waveActionSpawnPrefab") {
      assertWaveActionScenarioMetadata(scenario, label);
    }
    if (scenario.runner === "fsmStateEnterSpawnPrefab") {
      assertStateEnterActionScenarioMetadata(scenario, label);
    }
    if (scenario.runner === "fsmStateEnterDashAction") {
      assertStateEnterDashActionScenarioMetadata(scenario, label);
    }
    if (scenario.runner === "fsmStateEnterProjectileAction") {
      assertStateEnterProjectileActionScenarioMetadata(scenario, label);
    }
    if (scenario.runner === "fsmStateEnterMeleeAction") {
      assertStateEnterMeleeActionScenarioMetadata(scenario, label);
    }
  });
  for (const tag of Object.keys(manifest.coverageTagDefinitions)) {
    assert.ok(usedCoverageTags.has(tag), `${manifestPath}.coverageTagDefinitions.${tag} must be used by at least one scenario`);
  }
}

async function readScenarioFixtureIndex(fixtureIndexPath, manifest, manifestPath) {
  const rawFixtureIndex = JSON.parse(await readFile(fixtureIndexPath, "utf8"));
  const coverage = await readCoverageTagDefinitions(rawFixtureIndex, dirname(fixtureIndexPath), fixtureIndexPath);
  const fixtureIndex = {
    ...rawFixtureIndex,
    coverageTagDefinitions: coverage.definitions,
  };
  validateScenarioFixtureIndex(fixtureIndex, fixtureIndexPath, manifest, manifestPath);
  return fixtureIndex;
}

async function writeScenarioFixtureIndex(fixtureIndexPath, scenarioManifest) {
  await mkdir(dirname(fixtureIndexPath), { recursive: true });
  await writeFile(
    fixtureIndexPath,
    `${JSON.stringify(createScenarioFixtureIndex(scenarioManifest), null, 2)}\n`,
  );
}

function createScenarioFixtureIndex(scenarioManifest) {
  return {
    format: FIXTURE_INDEX_FORMAT,
    version: FIXTURE_INDEX_VERSION,
    scenarioManifestPath: relativeManifestPath(scenarioManifest.manifestPath),
    ...(scenarioManifest.coverageTagDefinitionsPath === undefined
      ? { coverageTagDefinitions: scenarioManifest.coverageTagDefinitions }
      : { coverageTagDefinitionsPath: relativeManifestPath(scenarioManifest.coverageTagDefinitionsPath) }),
    fixtures: scenarioManifest.scenarios.map((scenario) => ({
      id: scenario.id,
      description: scenario.description,
      coverageTags: scenario.coverageTags,
      runner: scenario.runner,
      fixturePath: relativeManifestPath(scenario.fixturePath),
      replayHash: scenario.expected.replayHash,
      frameCount: scenario.frameCount,
      captureFrameCount: scenario.captureFrames.length,
    })),
  };
}

function validateScenarioFixtureIndex(fixtureIndex, fixtureIndexPath, manifest, manifestPath) {
  assertPlainObject(fixtureIndex, fixtureIndexPath);
  assert.equal(fixtureIndex.format, FIXTURE_INDEX_FORMAT, `${fixtureIndexPath}.format must match`);
  assert.equal(fixtureIndex.version, FIXTURE_INDEX_VERSION, `${fixtureIndexPath}.version must match`);
  assert.equal(
    fixtureIndex.scenarioManifestPath,
    relativeManifestPath(manifestPath),
    `${fixtureIndexPath}.scenarioManifestPath must match ${manifestPath}`,
  );
  if (manifest.coverageTagDefinitionsPath !== undefined) {
    assertNonEmptyString(
      fixtureIndex.coverageTagDefinitionsPath,
      `${fixtureIndexPath}.coverageTagDefinitionsPath`,
    );
    assert.equal(
      resolveManifestPath(dirname(fixtureIndexPath), fixtureIndex.coverageTagDefinitionsPath),
      manifest.coverageTagDefinitionsPath,
      `${fixtureIndexPath}.coverageTagDefinitionsPath must match ${manifestPath}.coverageTagDefinitionsPath`,
    );
  }
  assertCoverageTagDefinitions(fixtureIndex.coverageTagDefinitions, `${fixtureIndexPath}.coverageTagDefinitions`);
  assert.deepEqual(
    fixtureIndex.coverageTagDefinitions,
    manifest.coverageTagDefinitions,
    `${fixtureIndexPath}.coverageTagDefinitions must match ${manifestPath}.coverageTagDefinitions`,
  );
  assert.ok(Array.isArray(fixtureIndex.fixtures), `${fixtureIndexPath}.fixtures must be an array`);
  assert.equal(
    fixtureIndex.fixtures.length,
    manifest.scenarios.length,
    `${fixtureIndexPath}.fixtures.length must match ${manifestPath}.scenarios.length`,
  );

  const fixtureById = new Map();
  fixtureIndex.fixtures.forEach((fixture, index) => {
    const label = `${fixtureIndexPath}.fixtures[${index}]`;
    assertPlainObject(fixture, label);
    assertNonEmptyString(fixture.id, `${label}.id`);
    assert.ok(!fixtureById.has(fixture.id), `${label}.id must be unique`);
    assertNonEmptyString(fixture.description, `${label}.description`);
    assertCoverageTags(fixture.coverageTags, `${label}.coverageTags`);
    assertNonEmptyString(fixture.runner, `${label}.runner`);
    assertNonEmptyString(fixture.fixturePath, `${label}.fixturePath`);
    assertReplayHash(fixture.replayHash, `${label}.replayHash`);
    assertPositiveInteger(fixture.frameCount, `${label}.frameCount`);
    assertPositiveInteger(fixture.captureFrameCount, `${label}.captureFrameCount`);
    fixtureById.set(fixture.id, fixture);
  });

  for (const scenario of manifest.scenarios) {
    const fixture = fixtureById.get(scenario.id);
    assert.ok(fixture !== undefined, `${fixtureIndexPath}.fixtures must include scenario '${scenario.id}'`);
    assert.equal(
      fixture.description,
      scenario.description,
      `${fixtureIndexPath}.fixtures[id=${scenario.id}].description must match scenario`,
    );
    assert.deepEqual(
      fixture.coverageTags,
      scenario.coverageTags,
      `${fixtureIndexPath}.fixtures[id=${scenario.id}].coverageTags must match scenario`,
    );
    assert.equal(fixture.runner, scenario.runner, `${fixtureIndexPath}.fixtures[id=${scenario.id}].runner must match scenario`);
    assert.equal(
      fixture.fixturePath,
      scenario.fixturePath,
      `${fixtureIndexPath}.fixtures[id=${scenario.id}].fixturePath must match scenario`,
    );
    assert.equal(
      fixture.replayHash,
      scenario.expected.replayHash,
      `${fixtureIndexPath}.fixtures[id=${scenario.id}].replayHash must match scenario`,
    );
    assert.equal(
      fixture.frameCount,
      scenario.frameCount,
      `${fixtureIndexPath}.fixtures[id=${scenario.id}].frameCount must match scenario`,
    );
    assert.equal(
      fixture.captureFrameCount,
      scenario.captureFrames.length,
      `${fixtureIndexPath}.fixtures[id=${scenario.id}].captureFrameCount must match scenario`,
    );
  }
}

function assertScenarioCoverageTags(scenario, label) {
  const tags = new Set(scenario.coverageTags);
  if (scenario.expected.spawnDiagnostics !== undefined) {
    assert.ok(tags.has("spawn-diagnostics"), `${label}.coverageTags must include spawn-diagnostics when expected.spawnDiagnostics exists`);
  }
  if (scenario.expected.actionFailureReason !== undefined) {
    assert.ok(tags.has("action-failure"), `${label}.coverageTags must include action-failure when expected.actionFailureReason exists`);
  }
  if (scenario.variantPath !== undefined) {
    assert.ok(tags.has("variant"), `${label}.coverageTags must include variant when variantPath exists`);
  }
}

function relativeManifestPath(manifestPath) {
  const repoRelativePath = relative(REPO_ROOT, manifestPath);
  return repoRelativePath.startsWith("..") ? manifestPath : repoRelativePath;
}

function prepareScenario(scenario, index, manifestPath, manifestDir) {
  const runner = SCENARIO_RUNNERS[scenario.runner];
  const authoredEvent = scenario.input.events.find((event) => event.type === "authoring");
  if (scenario.variantPath !== undefined) {
    assertNonEmptyString(scenario.variantPath, `${manifestPath}.scenarios[${index}].variantPath`);
  }
  const fixturePath = resolveManifestPath(manifestDir, scenario.fixturePath);
  const variantPath = scenario.variantPath === undefined
    ? undefined
    : resolveManifestPath(manifestDir, scenario.variantPath);
  return {
    ...scenario,
    fixturePath,
    ...(variantPath === undefined ? {} : { variantPath }),
    manifestPath,
    manifestIndex: index,
    runnerId: scenario.runner,
    authoring: authoredEvent === undefined
      ? undefined
      : {
          bodies: authoredEvent.bodies,
          components: authoredEvent.components,
        },
    run: runner.run,
    validateFixture: runner.validateFixture,
    validateOutcome: runner.validateOutcome,
  };
}

async function materializeScenarioVariant(scenario) {
  if (scenario.variantPath === undefined) {
    return scenario;
  }
  const variant = await readAuthoredBehaviorVariant(
    scenario.variantPath,
    scenario,
    `${scenario.manifestPath}.scenarios[${scenario.manifestIndex}].variantPath`,
  );
  return {
    ...scenario,
    variant,
  };
}

function resolveManifestPath(manifestDir, relativeOrAbsolutePath) {
  if (relativeOrAbsolutePath.startsWith("./") || relativeOrAbsolutePath.startsWith("../")) {
    return resolve(manifestDir, relativeOrAbsolutePath);
  }
  return resolve(REPO_ROOT, relativeOrAbsolutePath);
}

async function readAuthoredBehaviorVariant(variantPath, scenario, label) {
  const variant = JSON.parse(await readFile(variantPath, "utf8"));
  assert.equal(variant.format, TOPDOWN_AUTHORED_BEHAVIOR_VARIANT_FORMAT, `${label}.format must match authored behavior variant format`);
  assert.equal(variant.version, TOPDOWN_AUTHORED_BEHAVIOR_VARIANT_VERSION, `${label}.version must match authored behavior variant version`);
  assert.equal(variant.replayScenario, scenario.id, `${label}.replayScenario must match scenario id`);
  assert.equal(variant.expected?.replayHash, scenario.expected.replayHash, `${label}.expected.replayHash must match scenario`);
  assert.equal(variant.expected?.finalScore, scenario.expected.finalScore, `${label}.expected.finalScore must match scenario`);
  assert.equal(variant.expected?.eventFrame, scenario.expected.eventFrame, `${label}.expected.eventFrame must match scenario`);
  assert.deepEqual(variant.expected?.eventKinds, scenario.expected.eventKinds, `${label}.expected.eventKinds must match scenario`);
  assert.equal(variant.expected?.timerFrame, scenario.expected.timerFrame, `${label}.expected.timerFrame must match scenario`);
  assert.deepEqual(variant.expected?.timerEventKinds, scenario.expected.timerEventKinds, `${label}.expected.timerEventKinds must match scenario`);
  const ids = resolveGameplayBehaviorRuntimeIds(variant.ids, {
    path: `${label}.ids`,
    requiredItems: ["score"],
    requiredActions: ["primary", "dash", "collect-score", "summon-enemy"],
    requiredTimers: ["wake"],
  });

  const recipes = resolveBehaviorRecipeDocument(variant.behaviorRecipes, {
    path: `${label}.behaviorRecipes`,
  });
  const composition = resolveSceneCompositionSpec(variant.sceneComposition, {
    path: `${label}.sceneComposition`,
  });
  const dryRun = dryRunSceneBehaviorRecipes(composition, recipes, {
    path: `${label}.gameplayAuthoring`,
    missingBehavior: "error",
  });
  assert.equal(dryRun.ok, true, `${label}.gameplayAuthoring dry-run must pass`);
  const instances = instantiateSceneFragment(composition);
  const machines = resolveBehaviorStateMachineDocument(variant.behaviorStateMachines, {
    path: `${label}.behaviorStateMachines`,
    behaviorRecipes: recipes,
  });
  validateVariantScenarioAuthoring(variant, scenario, instances, machines, dryRun.plan.commands, ids, label);
  return {
    path: variantPath,
    instanceCount: instances.length,
    commandCount: dryRun.plan.commands.length,
    behaviorCommands: dryRun.plan.commands,
    machines: Object.keys(machines.machines),
  };
}

function validateVariantScenarioAuthoring(variant, scenario, instances, machines, commands, ids, label) {
  const authoredEvent = scenario.input.events.find((event) => event.type === "authoring");
  assert.ok(authoredEvent !== undefined, `${label} requires scenario authoring event`);
  const machineIds = new Set(Object.keys(machines.machines));
  const boundMachineIds = new Set();
  for (const instance of instances) {
    const props = instance.props ?? {};
    const replayBody = props.replayBody;
    if (replayBody !== undefined) {
      assertNonEmptyString(replayBody, `${label}.sceneComposition.instances.${instance.id}.props.replayBody`);
      const expectedBody = authoredEvent.bodies?.[replayBody];
      assert.ok(expectedBody !== undefined, `${label} replay body '${replayBody}' must exist`);
      assert.equal(instance.x, expectedBody.x, `${label} instance '${instance.id}' x must match replay body`);
      assert.equal(instance.y, expectedBody.y, `${label} instance '${instance.id}' y must match replay body`);
      assert.deepEqual(normalizeVariantPhysicsBody(props.physicsBody), normalizeVariantPhysicsBody(expectedBody), `${label} instance '${instance.id}' physicsBody must match replay body`);
    }
    const machineId = props.behaviorStateMachine;
    if (machineId !== undefined) {
      assertNonEmptyString(machineId, `${label}.sceneComposition.instances.${instance.id}.props.behaviorStateMachine`);
      assert.equal(machineId, instance.id, `${label} FSM binding must match resolved instance id`);
      assert.ok(machineIds.has(machineId), `${label} FSM binding '${machineId}' must reference a machine`);
      boundMachineIds.add(machineId);
    }
  }
  assert.deepEqual([...boundMachineIds].sort(), [...machineIds].sort(), `${label} all FSM machines must be bound by scene instances`);
  assert.deepEqual(commands.map((command) => `${command.entity}:${command.type}`), [
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
  ], `${label} must bind expected authored behavior commands`);

  const interactionPlan = createBehaviorStateMachineRuntimeInstallPlan(machines, "interaction-source", {
    behaviorRecipes: variant.behaviorRecipes,
    ids,
    path: `${label}.behaviorStateMachines.machines.interaction-source`,
  });
  const projectilePlan = createBehaviorStateMachineRuntimeInstallPlan(machines, "test-projectile", {
    behaviorRecipes: variant.behaviorRecipes,
    ids,
    path: `${label}.behaviorStateMachines.machines.test-projectile`,
  });
  const timerPlan = createBehaviorStateMachineRuntimeInstallPlan(machines, "timer-source", {
    behaviorRecipes: variant.behaviorRecipes,
    ids,
    path: `${label}.behaviorStateMachines.machines.timer-source`,
  });
  assert.equal(stateIdFor(interactionPlan, variant.expected.states["interaction-source"]), authoredEvent.components.fsm.transitionedState, `${label} interaction expected state must match authored FSM transition`);
  assert.equal(stateIdFor(projectilePlan, variant.expected.states["test-projectile"]), authoredEvent.components.fsm.transitionedState, `${label} projectile expected state must match authored FSM transition`);
  assert.equal(stateIdFor(timerPlan, variant.expected.states["timer-source"]), authoredEvent.components.timer.transitionedState, `${label} timer expected state must match authored FSM transition`);
  assert.equal(authoredEvent.components.pickup.itemId, GAMEPLAY_PICKUP_SCORE, `${label} pickup item id must be score`);
  assert.equal(authoredEvent.components.pickup.count, commandByType(commands, "configurePickup").count, `${label} pickup count must match recipe`);
  assert.equal(authoredEvent.components.interaction.actionId, ids.actions?.[commandByType(commands, "configureInteraction").action], `${label} interaction action id must match runtime id registry`);
  assert.equal(authoredEvent.components.interaction.radius, commandByType(commands, "configureInteraction").radius, `${label} interaction radius must match recipe`);
  assert.equal(authoredEvent.components.interaction.once, commandByType(commands, "configureInteraction").once, `${label} interaction once flag must match recipe`);
  assert.equal(authoredEvent.components.collision.damage, commandByType(commands, "configureDamage").amount, `${label} damage amount must match recipe`);
  assert.equal(authoredEvent.components.collision.enemyHealth, commandByType(commands, "configureHealth").current, `${label} enemy health must match recipe`);
  assert.equal(authoredEvent.components.collision.enemyScoreReward, commandByType(commands, "configureScoreReward").reward, `${label} score reward must match recipe`);
  const neutralProjectileFaction = commandByEntityAndType(commands, "neutral-projectile", "configureFaction");
  const neutralProjectileLifetime = commandByEntityAndType(commands, "neutral-projectile", "configureLifetime");
  const neutralEnemyFaction = commandByEntityAndType(commands, "neutral-enemy", "configureFaction");
  assert.equal(neutralProjectileFaction.faction, "neutral", `${label} neutral projectile recipe must use neutral faction`);
  assert.deepEqual(neutralProjectileFaction.damages, [], `${label} neutral projectile recipe must default to empty damage mask`);
  assert.equal(neutralProjectileLifetime.seconds, 0.02, `${label} neutral projectile lifetime must keep denial telemetry one-shot`);
  assert.equal(neutralEnemyFaction.faction, "enemy", `${label} neutral target recipe must use enemy faction`);
  assert.deepEqual(neutralEnemyFaction.damages, ["player"], `${label} neutral target recipe must keep enemy default damage mask`);
  const blockedSpawnPrefab = commandByEntityAndType(commands, "builtin-player", "configureSpawnPrefabAction");
  assert.equal(authoredEvent.components.blockedSpawnPrefab.actionId, ids.actions?.[blockedSpawnPrefab.action], `${label} blocked spawn action id must match runtime id registry`);
  assert.equal(authoredEvent.components.blockedSpawnPrefab.cooldownSeconds, blockedSpawnPrefab.cooldownSeconds, `${label} blocked spawn cooldown must match recipe`);
  assert.equal(authoredEvent.components.blockedSpawnPrefab.prefabId, blockedSpawnPrefab.prefabId, `${label} blocked spawn prefab id must match recipe`);
  assert.equal(authoredEvent.components.blockedSpawnPrefab.offsetX, blockedSpawnPrefab.offsetX, `${label} blocked spawn offsetX must match recipe`);
  assert.equal(authoredEvent.components.blockedSpawnPrefab.offsetY, blockedSpawnPrefab.offsetY, `${label} blocked spawn offsetY must match recipe`);
  const timerSpawnPrefab = commandByEntityAndType(commands, "timer-source", "configureSpawnPrefabAction");
  assert.equal(authoredEvent.components.timerSpawnPrefab.actionId, ids.actions?.[timerSpawnPrefab.action], `${label} timer spawn action id must match runtime id registry`);
  assert.equal(authoredEvent.components.timerSpawnPrefab.cooldownSeconds, timerSpawnPrefab.cooldownSeconds, `${label} timer spawn cooldown must match recipe`);
  assert.equal(authoredEvent.components.timerSpawnPrefab.prefabId, timerSpawnPrefab.prefabId, `${label} timer spawn prefab id must match recipe`);
  assert.equal(authoredEvent.components.timerSpawnPrefab.offsetX, timerSpawnPrefab.offsetX, `${label} timer spawn offsetX must match recipe`);
  assert.equal(authoredEvent.components.timerSpawnPrefab.offsetY, timerSpawnPrefab.offsetY, `${label} timer spawn offsetY must match recipe`);
  const timerTrigger = commandByEntityAndType(commands, "timer-source", "configureTimerTrigger");
  assert.equal(authoredEvent.components.timer.timerId, ids.timers?.[timerTrigger.timer], `${label} timer id must match runtime id registry`);
  assert.equal(authoredEvent.components.timer.actionId, ids.actions?.[timerTrigger.action], `${label} timer action id must match runtime id registry`);
  assert.equal(authoredEvent.components.timer.actionId, authoredEvent.components.timerSpawnPrefab.actionId, `${label} timer action id must target timer spawnPrefab action`);
  assert.equal(authoredEvent.components.timer.durationSeconds, timerTrigger.seconds, `${label} timer duration must match recipe`);
  assert.deepEqual(variant.expected.states, {
    "interaction-source": "triggered",
    "test-projectile": "spent",
    "timer-source": "awake",
  }, `${label} expected states must stay string-based`);
}

function normalizeVariantPhysicsBody(body) {
  assertPlainObject(body, "physicsBody");
  return {
    halfWidth: body.halfWidth,
    halfHeight: body.halfHeight,
    layer: body.layer,
    isTrigger: body.isTrigger ?? false,
  };
}

function commandByType(commands, type) {
  const command = commands.find((candidate) => candidate.type === type);
  assert.ok(command !== undefined, `variant command ${type} must exist`);
  return command;
}

function commandByEntityAndType(commands, entity, type) {
  const command = commands.find((candidate) => candidate.entity === entity && candidate.type === type);
  assert.ok(command !== undefined, `variant command ${entity}:${type} must exist`);
  return command;
}

function stateIdFor(plan, state) {
  const resolvedState = plan.states.find((candidate) => candidate.state === state);
  assert.ok(resolvedState !== undefined, `FSM install plan must include state '${state}'`);
  return resolvedState.stateId;
}

function assertInputEvents(events, frameCount, label) {
  assert.ok(Array.isArray(events), `${label} must be an array`);
  for (const [index, event] of events.entries()) {
    const eventLabel = `${label}[${index}]`;
    assertPlainObject(event, eventLabel);
    assertNonNegativeInteger(event.frame, `${eventLabel}.frame`);
    assert.ok(event.frame <= frameCount, `${eventLabel}.frame must be within frameCount`);
    assertNonEmptyString(event.type, `${eventLabel}.type`);
    if (event.type === "press") {
      assert.ok(event.frame < frameCount, `${eventLabel}.frame must be less than frameCount for input events`);
      assertNonEmptyString(event.control, `${eventLabel}.control`);
      assert.ok(
        ["w", "a", "s", "d", "space", "enter", "mouseLeft"].includes(event.control),
        `${eventLabel}.control must be a supported input control`,
      );
      if (event.x !== undefined) {
        assertFiniteNumber(event.x, `${eventLabel}.x`);
      }
      if (event.y !== undefined) {
        assertFiniteNumber(event.y, `${eventLabel}.y`);
      }
      continue;
    }
    if (event.type === "authoring") {
      assert.ok(event.frame < frameCount, `${eventLabel}.frame must be less than frameCount for authoring events`);
      assert.equal(event.phase, "afterFrameUpdate", `${eventLabel}.phase must be afterFrameUpdate`);
      assertNonEmptyString(event.action, `${eventLabel}.action`);
      continue;
    }
    if (event.type === "expect") {
      assertNonEmptyString(event.action, `${eventLabel}.action`);
      continue;
    }
    throw new Error(`${eventLabel}.type is unsupported: ${event.type}`);
  }
}

function assertExpectedSpawnDiagnostics(expectedSpawnDiagnostics, captureFrames, label) {
  if (expectedSpawnDiagnostics === undefined) {
    return;
  }
  assert.ok(Array.isArray(expectedSpawnDiagnostics), `${label} must be an array`);
  const frames = new Set();
  for (const [index, expectedFrame] of expectedSpawnDiagnostics.entries()) {
    const frameLabel = `${label}[${index}]`;
    assertPlainObject(expectedFrame, frameLabel);
    assertNonNegativeInteger(expectedFrame.frame, `${frameLabel}.frame`);
    assert.ok(captureFrames.includes(expectedFrame.frame), `${frameLabel}.frame must be included in captureFrames`);
    assert.ok(!frames.has(expectedFrame.frame), `${frameLabel}.frame must be unique`);
    frames.add(expectedFrame.frame);
    assertPlainObject(expectedFrame.metrics, `${frameLabel}.metrics`);
    const metricEntries = Object.entries(expectedFrame.metrics);
    assert.ok(metricEntries.length > 0, `${frameLabel}.metrics must not be empty`);
    for (const [metric, expected] of metricEntries) {
      assert.ok(
        SPAWN_DIAGNOSTIC_METRICS.includes(metric),
        `${frameLabel}.metrics.${metric} must be a supported spawn diagnostic metric`,
      );
      assertNonNegativeInteger(expected, `${frameLabel}.metrics.${metric}`);
    }
  }
}

function assertAuthoredScenarioMetadata(scenario, label) {
  const authoredEvents = scenario.input.events.filter((event) => event.type === "authoring");
  assert.equal(authoredEvents.length, 1, `${label} must include exactly one authoring event`);
  const [authoredEvent] = authoredEvents;
  assertPlainObject(authoredEvent.bodies, `${label}.authoring.bodies`);
  assertPlainObject(authoredEvent.components, `${label}.authoring.components`);
  for (const bodyName of ["interactionSource", "pickup", "bullet", "enemy"]) {
    assertBodyMetadata(authoredEvent.bodies[bodyName], `${label}.authoring.bodies.${bodyName}`);
  }
  if (authoredEvent.bodies.neutralBullet !== undefined || authoredEvent.bodies.neutralEnemy !== undefined) {
    assertBodyMetadata(authoredEvent.bodies.neutralBullet, `${label}.authoring.bodies.neutralBullet`);
    assertBodyMetadata(authoredEvent.bodies.neutralEnemy, `${label}.authoring.bodies.neutralEnemy`);
  }
  assertBodyMetadata(authoredEvent.bodies.timerSource, `${label}.authoring.bodies.timerSource`);
  assertPlainObject(authoredEvent.components.pickup, `${label}.authoring.components.pickup`);
  assertFiniteNumber(authoredEvent.components.pickup.itemId, `${label}.authoring.components.pickup.itemId`);
  assertFiniteNumber(authoredEvent.components.pickup.count, `${label}.authoring.components.pickup.count`);
  assert.equal(typeof authoredEvent.components.pickup.despawnOnCollect, "boolean", `${label}.authoring.components.pickup.despawnOnCollect must be boolean`);
  assertPlainObject(authoredEvent.components.interaction, `${label}.authoring.components.interaction`);
  assertFiniteNumber(authoredEvent.components.interaction.actionId, `${label}.authoring.components.interaction.actionId`);
  assertFiniteNumber(authoredEvent.components.interaction.radius, `${label}.authoring.components.interaction.radius`);
  assert.equal(typeof authoredEvent.components.interaction.once, "boolean", `${label}.authoring.components.interaction.once must be boolean`);
  assertPlainObject(authoredEvent.components.collision, `${label}.authoring.components.collision`);
  assertFiniteNumber(authoredEvent.components.collision.damage, `${label}.authoring.components.collision.damage`);
  assertFiniteNumber(authoredEvent.components.collision.enemyHealth, `${label}.authoring.components.collision.enemyHealth`);
  assertFiniteNumber(authoredEvent.components.collision.enemyScoreReward, `${label}.authoring.components.collision.enemyScoreReward`);
  assertFiniteNumber(authoredEvent.components.collision.target, `${label}.authoring.components.collision.target`);
  assertPlainObject(authoredEvent.components.fsm, `${label}.authoring.components.fsm`);
  assertFiniteNumber(authoredEvent.components.fsm.initialState, `${label}.authoring.components.fsm.initialState`);
  assertFiniteNumber(authoredEvent.components.fsm.transitionedState, `${label}.authoring.components.fsm.transitionedState`);
  assertPlainObject(authoredEvent.components.timer, `${label}.authoring.components.timer`);
  assertFiniteNumber(authoredEvent.components.timer.timerId, `${label}.authoring.components.timer.timerId`);
  assertFiniteNumber(authoredEvent.components.timer.durationSeconds, `${label}.authoring.components.timer.durationSeconds`);
  if (authoredEvent.components.timer.actionId !== undefined) {
    assertFiniteNumber(authoredEvent.components.timer.actionId, `${label}.authoring.components.timer.actionId`);
    assertPlainObject(authoredEvent.components.timerSpawnPrefab, `${label}.authoring.components.timerSpawnPrefab`);
    assertSpawnPrefabActionMetadata(authoredEvent.components.timerSpawnPrefab, `${label}.authoring.components.timerSpawnPrefab`);
    assert.equal(
      authoredEvent.components.timer.actionId,
      authoredEvent.components.timerSpawnPrefab.actionId,
      `${label}.authoring.components.timer.actionId must explicitly reference timerSpawnPrefab.actionId`,
    );
    assert.notEqual(
      authoredEvent.components.timer.timerId,
      authoredEvent.components.timer.actionId,
      `${label}.authoring.components.timer.timerId must not be implicitly reused as actionId`,
    );
  }
  assertFiniteNumber(authoredEvent.components.timer.initialState, `${label}.authoring.components.timer.initialState`);
  assertFiniteNumber(authoredEvent.components.timer.transitionedState, `${label}.authoring.components.timer.transitionedState`);
  if (authoredEvent.components.blockedSpawnPrefab !== undefined) {
    assertBlockedSpawnPrefabMetadata(authoredEvent.components.blockedSpawnPrefab, `${label}.authoring.components.blockedSpawnPrefab`);
  }
  assertFiniteNumber(scenario.expected.eventFrame, `${label}.expected.eventFrame`);
  assert.ok(scenario.captureFrames.includes(authoredEvent.frame), `${label}.captureFrames must include the authoring frame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.eventFrame), `${label}.captureFrames must include expected.eventFrame`);
  assert.ok(Array.isArray(scenario.expected.eventKinds), `${label}.expected.eventKinds must be an array`);
  for (const [index, eventKind] of scenario.expected.eventKinds.entries()) {
    assertNonEmptyString(eventKind, `${label}.expected.eventKinds[${index}]`);
  }
  assertFiniteNumber(scenario.expected.fsmState, `${label}.expected.fsmState`);
  if (scenario.expected.actionFailureFrame !== undefined) {
    assert.ok(authoredEvent.components.blockedSpawnPrefab !== undefined, `${label}.expected.actionFailureFrame requires blockedSpawnPrefab authoring`);
    assertFiniteNumber(scenario.expected.actionFailureFrame, `${label}.expected.actionFailureFrame`);
    assert.ok(scenario.captureFrames.includes(scenario.expected.actionFailureFrame), `${label}.captureFrames must include expected.actionFailureFrame`);
    assertFiniteNumber(scenario.expected.actionFailureActionId, `${label}.expected.actionFailureActionId`);
    assert.equal(scenario.expected.actionFailureReason, GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT, `${label}.expected.actionFailureReason must be blocked placement`);
    assert.ok(Array.isArray(scenario.expected.actionFailureEventKinds), `${label}.expected.actionFailureEventKinds must be an array`);
    assert.deepEqual(scenario.expected.actionFailureEventKinds, ["actionFailed"], `${label}.expected.actionFailureEventKinds must stay exact`);
  }
  if (scenario.expected.timerFrame !== undefined) {
    assertFiniteNumber(scenario.expected.timerFrame, `${label}.expected.timerFrame`);
    assert.ok(scenario.captureFrames.includes(scenario.expected.timerFrame), `${label}.captureFrames must include expected.timerFrame`);
    assert.ok(Array.isArray(scenario.expected.timerEventKinds), `${label}.expected.timerEventKinds must be an array`);
    assert.deepEqual(scenario.expected.timerEventKinds, ["timer", "prefabSpawned", "behaviorStateChanged"], `${label}.expected.timerEventKinds must stay exact`);
    assertFiniteNumber(scenario.expected.timerFsmState, `${label}.expected.timerFsmState`);
  }
}

function assertAuthoredPlayerDamageCollisionScenarioMetadata(scenario, label) {
  const authoredEvents = scenario.input.events.filter((event) => event.type === "authoring");
  assert.equal(authoredEvents.length, 1, `${label} must include exactly one authoring event`);
  const [authoredEvent] = authoredEvents;
  assertPlainObject(authoredEvent.bodies, `${label}.authoring.bodies`);
  assertBodyMetadata(authoredEvent.bodies.enemy, `${label}.authoring.bodies.enemy`);
  assertPlainObject(authoredEvent.components, `${label}.authoring.components`);
  assertFiniteNumber(authoredEvent.components.playerHealth, `${label}.authoring.components.playerHealth`);
  assertFiniteNumber(authoredEvent.components.damage, `${label}.authoring.components.damage`);
  assertFiniteNumber(authoredEvent.components.target, `${label}.authoring.components.target`);
  assert.equal(authoredEvent.components.target, COLLISION_TARGET_OTHER, `${label}.authoring.components.target must be other for player damage coverage`);
  assert.ok(scenario.captureFrames.includes(authoredEvent.frame), `${label}.captureFrames must include the authoring frame`);
  assertFiniteNumber(scenario.expected.eventFrame, `${label}.expected.eventFrame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.eventFrame), `${label}.captureFrames must include expected.eventFrame`);
  assert.deepEqual(scenario.expected.eventKinds, ["collisionDamage"], `${label}.expected.eventKinds must stay exact`);
  assertFiniteNumber(scenario.expected.finalGameState, `${label}.expected.finalGameState`);
  assertFiniteNumber(scenario.expected.entityCountAfterSetup, `${label}.expected.entityCountAfterSetup`);
}

function assertAuthoredProjectileTileImpactFsmScenarioMetadata(scenario, label) {
  const authoredEvents = scenario.input.events.filter((event) => event.type === "authoring");
  assert.equal(authoredEvents.length, 1, `${label} must include exactly one authored projectile tile impact FSM event`);
  assertPlainObject(scenario.authoredProjectileTileImpactFsm, `${label}.authoredProjectileTileImpactFsm`);
  assertBodyMetadata(
    scenario.authoredProjectileTileImpactFsm.projectileBody,
    `${label}.authoredProjectileTileImpactFsm.projectileBody`,
  );
  assert.equal(
    scenario.authoredProjectileTileImpactFsm.projectileBody.layer,
    PHYSICS_LAYER_BULLET,
    `${label}.authoredProjectileTileImpactFsm.projectileBody.layer must be Bullet`,
  );
  assertPlainObject(scenario.authoredProjectileTileImpactFsm.velocity, `${label}.authoredProjectileTileImpactFsm.velocity`);
  assertFiniteNumber(scenario.authoredProjectileTileImpactFsm.velocity.x, `${label}.authoredProjectileTileImpactFsm.velocity.x`);
  assertFiniteNumber(scenario.authoredProjectileTileImpactFsm.velocity.y, `${label}.authoredProjectileTileImpactFsm.velocity.y`);
  assert.equal(scenario.authoredProjectileTileImpactFsm.tileImpactCode, 2, `${label}.authoredProjectileTileImpactFsm.tileImpactCode must be bounce`);
  assertPlainObject(scenario.authoredProjectileTileImpactFsm.blockingTilemap, `${label}.authoredProjectileTileImpactFsm.blockingTilemap`);
  assertBlockedTilemapMetadata(scenario.authoredProjectileTileImpactFsm.blockingTilemap, `${label}.authoredProjectileTileImpactFsm.blockingTilemap`);
  assertPlainObject(scenario.authoredProjectileTileImpactFsm.fsm, `${label}.authoredProjectileTileImpactFsm.fsm`);
  assertFiniteNumber(scenario.authoredProjectileTileImpactFsm.fsm.initialState, `${label}.authoredProjectileTileImpactFsm.fsm.initialState`);
  assertFiniteNumber(scenario.authoredProjectileTileImpactFsm.fsm.transitionedState, `${label}.authoredProjectileTileImpactFsm.fsm.transitionedState`);
  assert.ok(scenario.captureFrames.includes(authoredEvents[0].frame), `${label}.captureFrames must include the authoring frame`);
  assertFiniteNumber(scenario.expected.eventFrame, `${label}.expected.eventFrame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.eventFrame), `${label}.captureFrames must include expected.eventFrame`);
  assert.deepEqual(scenario.expected.eventKinds, ["tileImpact", "behaviorStateChanged"], `${label}.expected.eventKinds must stay exact`);
  assertTileImpactExpectation(scenario.expected.tileImpact, `${label}.expected.tileImpact`);
  assert.equal(scenario.expected.tileImpact.tileImpactCode, 2, `${label}.expected.tileImpact.tileImpactCode must be bounce`);
  assert.equal(
    scenario.expected.tileImpact.flags,
    GAMEPLAY_EVENT_FLAG_TILE_IMPACT_BOUNCED
      | (GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_X << GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT),
    `${label}.expected.tileImpact.flags must encode bounced negative-x tile impact`,
  );
  assert.equal(scenario.expected.tileImpact.targetRemoved, false, `${label}.expected.tileImpact.targetRemoved must be false for bounce`);
  assertFiniteNumber(scenario.expected.fsmState, `${label}.expected.fsmState`);
}

function assertHomingMissileScenarioMetadata(scenario, label) {
  const authoredEvents = scenario.input.events.filter((event) => event.type === "authoring");
  assert.equal(authoredEvents.length, 1, `${label} must include exactly one homing missile authoring event`);
  assertPlainObject(scenario.homingMissile, `${label}.homingMissile`);
  assertPlainObject(scenario.homingMissile.ids, `${label}.homingMissile.ids`);
  assertPlainObject(scenario.homingMissile.ids.tags, `${label}.homingMissile.ids.tags`);
  assertFiniteNumber(scenario.homingMissile.ids.tags.hostile, `${label}.homingMissile.ids.tags.hostile`);
  assertPlainObject(scenario.homingMissile.bodies, `${label}.homingMissile.bodies`);
  for (const bodyName of ["missile", "hostile-enemy", "decoy-enemy"]) {
    assertBodyMetadata(scenario.homingMissile.bodies[bodyName], `${label}.homingMissile.bodies.${bodyName}`);
  }
  assert.equal(scenario.homingMissile.bodies.missile.bodyType, PHYSICS_BODY_DYNAMIC, `${label}.homingMissile.bodies.missile.bodyType must be dynamic`);
  assert.equal(scenario.homingMissile.bodies.missile.layer, PHYSICS_LAYER_BULLET, `${label}.homingMissile.bodies.missile.layer must be Bullet`);
  assert.equal(scenario.homingMissile.bodies["hostile-enemy"].layer, PHYSICS_LAYER_ENEMY, `${label}.homingMissile.bodies.hostile-enemy.layer must be Enemy`);
  assert.equal(scenario.homingMissile.bodies["decoy-enemy"].layer, PHYSICS_LAYER_ENEMY, `${label}.homingMissile.bodies.decoy-enemy.layer must be Enemy`);
  assertPlainObject(scenario.homingMissile.expected, `${label}.homingMissile.expected`);
  assertFiniteNumber(scenario.homingMissile.expected.damage, `${label}.homingMissile.expected.damage`);
  assertFiniteNumber(scenario.homingMissile.expected.particlePresetId, `${label}.homingMissile.expected.particlePresetId`);

  const composition = resolveSceneCompositionSpec(scenario.homingMissile.sceneComposition, {
    path: `${label}.homingMissile.sceneComposition`,
  });
  const recipes = resolveBehaviorRecipeDocument(scenario.homingMissile.behaviorRecipes, {
    path: `${label}.homingMissile.behaviorRecipes`,
  });
  const plan = bindSceneBehaviorRecipes(composition, recipes, {
    path: `${label}.homingMissile.gameplayAuthoring`,
    missingBehavior: "error",
  });
  assert.deepEqual(
    plan.commands.map((command) => `${command.entity}:${command.type}`),
    scenario.expected.boundCommands,
    `${label}.expected.boundCommands must match homing missile bound command order`,
  );
  assert.equal(
    commandByEntityAndType(plan.commands, "missile", "configureSeekTarget").target,
    "nearestTag:hostile",
    `${label} missile must seek nearest hostile tag`,
  );
  assert.equal(
    commandByEntityAndType(plan.commands, "missile", "configureDamage").amount,
    scenario.homingMissile.expected.damage,
    `${label} missile damage command must match expected damage`,
  );
  assert.equal(
    commandByEntityAndType(plan.commands, "missile", "configureCollisionParticle").presetId,
    scenario.homingMissile.expected.particlePresetId,
    `${label} missile particle command must match expected preset`,
  );
  assert.deepEqual(
    commandByEntityAndType(plan.commands, "hostile-enemy", "configureTags").tags,
    ["hostile"],
    `${label} hostile enemy must install hostile tag`,
  );
  assertFiniteNumber(scenario.expected.movementFrame, `${label}.expected.movementFrame`);
  assertFiniteNumber(scenario.expected.eventFrame, `${label}.expected.eventFrame`);
  assert.ok(scenario.captureFrames.includes(authoredEvents[0].frame), `${label}.captureFrames must include the authoring frame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.movementFrame), `${label}.captureFrames must include expected.movementFrame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.eventFrame), `${label}.captureFrames must include expected.eventFrame`);
  assert.deepEqual(
    scenario.expected.eventKinds,
    ["collisionDamage", "collisionDespawn", "presentationEffect"],
    `${label}.expected.eventKinds must stay exact`,
  );
}

function assertExplosiveProjectileScenarioMetadata(scenario, label) {
  const authoredEvents = scenario.input.events.filter((event) => event.type === "authoring");
  assert.equal(authoredEvents.length, 1, `${label} must include exactly one explosive projectile authoring event`);
  assertPlainObject(scenario.explosiveProjectile, `${label}.explosiveProjectile`);
  assertPlainObject(scenario.explosiveProjectile.bodies, `${label}.explosiveProjectile.bodies`);
  for (const bodyName of ["explosive-projectile", "blast-direct", "blast-splash", "blast-far"]) {
    assertBodyMetadata(scenario.explosiveProjectile.bodies[bodyName], `${label}.explosiveProjectile.bodies.${bodyName}`);
  }
  assert.equal(
    scenario.explosiveProjectile.bodies["explosive-projectile"].bodyType,
    PHYSICS_BODY_DYNAMIC,
    `${label}.explosiveProjectile.bodies.explosive-projectile.bodyType must be dynamic`,
  );
  assert.equal(
    scenario.explosiveProjectile.bodies["explosive-projectile"].layer,
    PHYSICS_LAYER_BULLET,
    `${label}.explosiveProjectile.bodies.explosive-projectile.layer must be Bullet`,
  );
  for (const bodyName of ["blast-direct", "blast-splash", "blast-far"]) {
    assert.equal(
      scenario.explosiveProjectile.bodies[bodyName].layer,
      PHYSICS_LAYER_ENEMY,
      `${label}.explosiveProjectile.bodies.${bodyName}.layer must be Enemy`,
    );
  }
  assertPlainObject(scenario.explosiveProjectile.expected, `${label}.explosiveProjectile.expected`);
  assertFiniteNumber(scenario.explosiveProjectile.expected.damage, `${label}.explosiveProjectile.expected.damage`);
  assertFiniteNumber(scenario.explosiveProjectile.expected.radius, `${label}.explosiveProjectile.expected.radius`);
  assertFiniteNumber(scenario.explosiveProjectile.expected.effectId, `${label}.explosiveProjectile.expected.effectId`);

  const composition = resolveSceneCompositionSpec(scenario.explosiveProjectile.sceneComposition, {
    path: `${label}.explosiveProjectile.sceneComposition`,
  });
  const recipes = resolveBehaviorRecipeDocument(scenario.explosiveProjectile.behaviorRecipes, {
    path: `${label}.explosiveProjectile.behaviorRecipes`,
  });
  const plan = bindSceneBehaviorRecipes(composition, recipes, {
    path: `${label}.explosiveProjectile.gameplayAuthoring`,
    missingBehavior: "error",
  });
  assert.deepEqual(
    plan.commands.map((command) => `${command.entity}:${command.type}`),
    scenario.expected.boundCommands,
    `${label}.expected.boundCommands must match explosive projectile bound command order`,
  );
  const areaDamageCommand = commandByEntityAndType(plan.commands, "explosive-projectile", "configureCollisionAreaDamage");
  assert.equal(
    areaDamageCommand.amount,
    scenario.explosiveProjectile.expected.damage,
    `${label} explosive projectile area damage amount must match expected damage`,
  );
  assert.equal(
    areaDamageCommand.radius,
    scenario.explosiveProjectile.expected.radius,
    `${label} explosive projectile area damage radius must match expected radius`,
  );
  assert.equal(
    areaDamageCommand.targetLayer,
    "enemy",
    `${label} explosive projectile area damage must target enemy layer`,
  );
  const emitEffectCommand = commandByEntityAndType(plan.commands, "explosive-projectile", "configureCollisionEmitEffect");
  assert.equal(
    emitEffectCommand.effectId,
    scenario.explosiveProjectile.expected.effectId,
    `${label} explosive projectile effect id must match expected effect`,
  );
  assert.equal(
    emitEffectCommand.effectKind,
    "particle",
    `${label} explosive projectile effect kind must stay particle`,
  );
  assertFiniteNumber(scenario.expected.movementFrame, `${label}.expected.movementFrame`);
  assertFiniteNumber(scenario.expected.eventFrame, `${label}.expected.eventFrame`);
  assert.ok(scenario.captureFrames.includes(authoredEvents[0].frame), `${label}.captureFrames must include the authoring frame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.movementFrame), `${label}.captureFrames must include expected.movementFrame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.eventFrame), `${label}.captureFrames must include expected.eventFrame`);
  assert.deepEqual(
    scenario.expected.eventKinds,
    ["collisionDamage", "collisionDamage", "collisionDespawn", "presentationEffect"],
    `${label}.expected.eventKinds must stay exact`,
  );
}

function assertTileImpactAreaDamageScenarioMetadata(scenario, label) {
  const authoredEvents = scenario.input.events.filter((event) => event.type === "authoring");
  assert.equal(authoredEvents.length, 1, `${label} must include exactly one tile impact area damage authoring event`);
  assertPlainObject(scenario.tileImpactAreaDamage, `${label}.tileImpactAreaDamage`);
  assertPlainObject(scenario.tileImpactAreaDamage.bodies, `${label}.tileImpactAreaDamage.bodies`);
  for (const bodyName of ["tile-projectile", "tile-blast-direct", "tile-blast-splash", "tile-blast-far"]) {
    assertBodyMetadata(scenario.tileImpactAreaDamage.bodies[bodyName], `${label}.tileImpactAreaDamage.bodies.${bodyName}`);
  }
  assert.equal(
    scenario.tileImpactAreaDamage.bodies["tile-projectile"].bodyType,
    PHYSICS_BODY_DYNAMIC,
    `${label}.tileImpactAreaDamage.bodies.tile-projectile.bodyType must be dynamic`,
  );
  assert.equal(
    scenario.tileImpactAreaDamage.bodies["tile-projectile"].layer,
    PHYSICS_LAYER_BULLET,
    `${label}.tileImpactAreaDamage.bodies.tile-projectile.layer must be Bullet`,
  );
  for (const bodyName of ["tile-blast-direct", "tile-blast-splash", "tile-blast-far"]) {
    assert.equal(
      scenario.tileImpactAreaDamage.bodies[bodyName].layer,
      PHYSICS_LAYER_ENEMY,
      `${label}.tileImpactAreaDamage.bodies.${bodyName}.layer must be Enemy`,
    );
  }
  assertPlainObject(scenario.tileImpactAreaDamage.velocity, `${label}.tileImpactAreaDamage.velocity`);
  assertFiniteNumber(scenario.tileImpactAreaDamage.velocity.x, `${label}.tileImpactAreaDamage.velocity.x`);
  assertFiniteNumber(scenario.tileImpactAreaDamage.velocity.y, `${label}.tileImpactAreaDamage.velocity.y`);
  assert.equal(
    scenario.tileImpactAreaDamage.tileImpactCode,
    0,
    `${label}.tileImpactAreaDamage.tileImpactCode must be despawn for terminal tile area coverage`,
  );
  assertBlockedTilemapMetadata(scenario.tileImpactAreaDamage.blockingTilemap, `${label}.tileImpactAreaDamage.blockingTilemap`);
  assertPlainObject(scenario.tileImpactAreaDamage.expected, `${label}.tileImpactAreaDamage.expected`);
  assertFiniteNumber(scenario.tileImpactAreaDamage.expected.damage, `${label}.tileImpactAreaDamage.expected.damage`);
  assertFiniteNumber(scenario.tileImpactAreaDamage.expected.radius, `${label}.tileImpactAreaDamage.expected.radius`);

  const composition = resolveSceneCompositionSpec(scenario.tileImpactAreaDamage.sceneComposition, {
    path: `${label}.tileImpactAreaDamage.sceneComposition`,
  });
  const recipes = resolveBehaviorRecipeDocument(scenario.tileImpactAreaDamage.behaviorRecipes, {
    path: `${label}.tileImpactAreaDamage.behaviorRecipes`,
  });
  const plan = bindSceneBehaviorRecipes(composition, recipes, {
    path: `${label}.tileImpactAreaDamage.gameplayAuthoring`,
    missingBehavior: "error",
  });
  assert.deepEqual(
    plan.commands.map((command) => `${command.entity}:${command.type}`),
    scenario.expected.boundCommands,
    `${label}.expected.boundCommands must match tile impact area damage bound command order`,
  );
  const areaDamageCommand = commandByEntityAndType(plan.commands, "tile-projectile", "configureCollisionAreaDamage");
  assert.equal(
    areaDamageCommand.amount,
    scenario.tileImpactAreaDamage.expected.damage,
    `${label} tile impact area damage amount must match expected damage`,
  );
  assert.equal(
    areaDamageCommand.radius,
    scenario.tileImpactAreaDamage.expected.radius,
    `${label} tile impact area damage radius must match expected radius`,
  );
  assert.equal(
    areaDamageCommand.targetLayer,
    "enemy",
    `${label} tile impact area damage must target enemy layer`,
  );
  assertFiniteNumber(scenario.expected.eventFrame, `${label}.expected.eventFrame`);
  assert.ok(scenario.captureFrames.includes(authoredEvents[0].frame), `${label}.captureFrames must include the authoring frame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.eventFrame), `${label}.captureFrames must include expected.eventFrame`);
  assert.deepEqual(
    scenario.expected.eventKinds,
    ["collisionDamage", "collisionDamage", "tileImpact"],
    `${label}.expected.eventKinds must stay exact`,
  );
  assertTileImpactExpectation(scenario.expected.tileImpact, `${label}.expected.tileImpact`);
  assert.equal(
    scenario.expected.tileImpact.flags,
    GAMEPLAY_EVENT_FLAG_TARGET_REMOVED
      | (GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_X << GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT),
    `${label}.expected.tileImpact.flags must encode terminal positive-x tile impact`,
  );
}

function assertWaveActionScenarioMetadata(scenario, label) {
  assertPlainObject(scenario.waveAction, `${label}.waveAction`);
  assertFiniteNumber(scenario.waveAction.waveIndex, `${label}.waveAction.waveIndex`);
  assertPlainObject(scenario.waveAction.spawnPrefab, `${label}.waveAction.spawnPrefab`);
  assertSpawnPrefabActionMetadata(scenario.waveAction.spawnPrefab, `${label}.waveAction.spawnPrefab`);
  assert.ok(Array.isArray(scenario.waveAction.waves), `${label}.waveAction.waves must be an array`);
  assert.ok(scenario.waveAction.waves.length >= 2, `${label}.waveAction.waves must include source and target waves`);
  for (const [index, wave] of scenario.waveAction.waves.entries()) {
    const waveLabel = `${label}.waveAction.waves[${index}]`;
    assertPlainObject(wave, waveLabel);
    for (const field of [
      "index",
      "durationSeconds",
      "spawnIntervalSeconds",
      "enemyCount",
      "enemySpeed",
      "enemyBehaviorCode",
      "enemySpawnPatternCode",
      "enemyHealth",
      "scoreReward",
    ]) {
      assertFiniteNumber(wave[field], `${waveLabel}.${field}`);
    }
  }
  assertFiniteNumber(scenario.expected.eventFrame, `${label}.expected.eventFrame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.eventFrame), `${label}.captureFrames must include expected.eventFrame`);
  assert.ok(Array.isArray(scenario.expected.eventKinds), `${label}.expected.eventKinds must be an array`);
  assert.deepEqual(scenario.expected.eventKinds, ["prefabSpawned"], `${label}.expected.eventKinds must stay exact`);
}

function assertStateEnterActionScenarioMetadata(scenario, label) {
  const authoredEvents = scenario.input.events.filter((event) => event.type === "authoring");
  assert.equal(authoredEvents.length, 1, `${label} must include exactly one state-enter authoring event`);
  assertPlainObject(scenario.stateEnterAction, `${label}.stateEnterAction`);
  assertBodyMetadata(scenario.stateEnterAction.sourceBody, `${label}.stateEnterAction.sourceBody`);
  assertPlainObject(scenario.stateEnterAction.timer, `${label}.stateEnterAction.timer`);
  assertFiniteNumber(scenario.stateEnterAction.timer.timerId, `${label}.stateEnterAction.timer.timerId`);
  assertFiniteNumber(scenario.stateEnterAction.timer.durationSeconds, `${label}.stateEnterAction.timer.durationSeconds`);
  assertPlainObject(scenario.stateEnterAction.fsm, `${label}.stateEnterAction.fsm`);
  assertFiniteNumber(scenario.stateEnterAction.fsm.initialState, `${label}.stateEnterAction.fsm.initialState`);
  assertFiniteNumber(scenario.stateEnterAction.fsm.transitionedState, `${label}.stateEnterAction.fsm.transitionedState`);
  assertPlainObject(scenario.stateEnterAction.stateEnter, `${label}.stateEnterAction.stateEnter`);
  assert.equal(scenario.stateEnterAction.stateEnter.phaseCode, 0, `${label}.stateEnterAction.stateEnter.phaseCode must be NextFramePrePhysics`);
  assertPlainObject(scenario.stateEnterAction.spawnPrefab, `${label}.stateEnterAction.spawnPrefab`);
  assertSpawnPrefabActionMetadata(scenario.stateEnterAction.spawnPrefab, `${label}.stateEnterAction.spawnPrefab`);
  assertFiniteNumber(scenario.expected.transitionFrame, `${label}.expected.transitionFrame`);
  assertFiniteNumber(scenario.expected.eventFrame, `${label}.expected.eventFrame`);
  assert.ok(scenario.captureFrames.includes(authoredEvents[0].frame), `${label}.captureFrames must include the authoring frame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.transitionFrame), `${label}.captureFrames must include expected.transitionFrame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.eventFrame), `${label}.captureFrames must include expected.eventFrame`);
  assert.deepEqual(scenario.expected.transitionEventKinds, ["timer", "behaviorStateChanged"], `${label}.expected.transitionEventKinds must stay exact`);
  assert.deepEqual(scenario.expected.eventKinds, ["prefabSpawned"], `${label}.expected.eventKinds must stay exact`);
  assertFiniteNumber(scenario.expected.fsmState, `${label}.expected.fsmState`);
}

function assertStateEnterDashActionScenarioMetadata(scenario, label) {
  const authoredEvents = scenario.input.events.filter((event) => event.type === "authoring");
  assert.equal(authoredEvents.length, 1, `${label} must include exactly one state-enter dash authoring event`);
  assertPlainObject(scenario.stateEnterDashAction, `${label}.stateEnterDashAction`);
  assertBodyMetadata(scenario.stateEnterDashAction.sourceBody, `${label}.stateEnterDashAction.sourceBody`);
  assertPlainObject(scenario.stateEnterDashAction.timer, `${label}.stateEnterDashAction.timer`);
  assertFiniteNumber(scenario.stateEnterDashAction.timer.timerId, `${label}.stateEnterDashAction.timer.timerId`);
  assertFiniteNumber(scenario.stateEnterDashAction.timer.durationSeconds, `${label}.stateEnterDashAction.timer.durationSeconds`);
  assertPlainObject(scenario.stateEnterDashAction.fsm, `${label}.stateEnterDashAction.fsm`);
  assertFiniteNumber(scenario.stateEnterDashAction.fsm.initialState, `${label}.stateEnterDashAction.fsm.initialState`);
  assertFiniteNumber(scenario.stateEnterDashAction.fsm.transitionedState, `${label}.stateEnterDashAction.fsm.transitionedState`);
  assertPlainObject(scenario.stateEnterDashAction.stateEnter, `${label}.stateEnterDashAction.stateEnter`);
  assert.equal(scenario.stateEnterDashAction.stateEnter.phaseCode, 0, `${label}.stateEnterDashAction.stateEnter.phaseCode must be NextFramePrePhysics`);
  assertDashActionMetadata(scenario.stateEnterDashAction.dashAction, `${label}.stateEnterDashAction.dashAction`);
  assertFiniteNumber(scenario.expected.transitionFrame, `${label}.expected.transitionFrame`);
  assertFiniteNumber(scenario.expected.dashFrame, `${label}.expected.dashFrame`);
  assert.ok(scenario.captureFrames.includes(authoredEvents[0].frame), `${label}.captureFrames must include the authoring frame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.transitionFrame), `${label}.captureFrames must include expected.transitionFrame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.dashFrame), `${label}.captureFrames must include expected.dashFrame`);
  assert.deepEqual(scenario.expected.transitionEventKinds, ["timer", "behaviorStateChanged"], `${label}.expected.transitionEventKinds must stay exact`);
  if (scenario.expected.actionFailureReason === undefined) {
    assert.deepEqual(scenario.expected.dashEventKinds, [], `${label}.expected.dashEventKinds must stay exact`);
    assert.equal(scenario.stateEnterDashAction.dashAction.aimCode, DASH_AIM_TARGET_PLAYER, `${label}.stateEnterDashAction.dashAction.aimCode must be targetPlayer for success coverage`);
  } else {
    assert.equal(scenario.expected.actionFailureReason, GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE, `${label}.expected.actionFailureReason must be unsupported aim source`);
    assert.deepEqual(scenario.expected.dashEventKinds, ["actionFailed"], `${label}.expected.dashEventKinds must stay exact`);
    assert.equal(scenario.stateEnterDashAction.dashAction.aimCode, DASH_AIM_INPUT, `${label}.stateEnterDashAction.dashAction.aimCode must be input for unsupported aim coverage`);
  }
  assertPlainObject(scenario.expected.sourceBeforeDash, `${label}.expected.sourceBeforeDash`);
  assertPlainObject(scenario.expected.sourceAfterDash, `${label}.expected.sourceAfterDash`);
  assertFiniteNumber(scenario.expected.sourceBeforeDash.x, `${label}.expected.sourceBeforeDash.x`);
  assertFiniteNumber(scenario.expected.sourceBeforeDash.y, `${label}.expected.sourceBeforeDash.y`);
  assertFiniteNumber(scenario.expected.sourceAfterDash.x, `${label}.expected.sourceAfterDash.x`);
  assertFiniteNumber(scenario.expected.sourceAfterDash.y, `${label}.expected.sourceAfterDash.y`);
  if (scenario.expected.actionFailureReason !== undefined) {
    assert.deepEqual(
      scenario.expected.sourceAfterDash,
      scenario.expected.sourceBeforeDash,
      `${label}.expected.sourceAfterDash must match sourceBeforeDash for failure coverage`,
    );
  }
  assertFiniteNumber(scenario.expected.fsmState, `${label}.expected.fsmState`);
}

function assertStateEnterProjectileActionScenarioMetadata(scenario, label) {
  const authoredEvents = scenario.input.events.filter((event) => event.type === "authoring");
  assert.equal(authoredEvents.length, 1, `${label} must include exactly one state-enter projectile authoring event`);
  assertPlainObject(scenario.stateEnterProjectileAction, `${label}.stateEnterProjectileAction`);
  assertBodyMetadata(scenario.stateEnterProjectileAction.sourceBody, `${label}.stateEnterProjectileAction.sourceBody`);
  assertPlainObject(scenario.stateEnterProjectileAction.timer, `${label}.stateEnterProjectileAction.timer`);
  assertFiniteNumber(scenario.stateEnterProjectileAction.timer.timerId, `${label}.stateEnterProjectileAction.timer.timerId`);
  assertFiniteNumber(scenario.stateEnterProjectileAction.timer.durationSeconds, `${label}.stateEnterProjectileAction.timer.durationSeconds`);
  assertPlainObject(scenario.stateEnterProjectileAction.fsm, `${label}.stateEnterProjectileAction.fsm`);
  assertFiniteNumber(scenario.stateEnterProjectileAction.fsm.initialState, `${label}.stateEnterProjectileAction.fsm.initialState`);
  assertFiniteNumber(scenario.stateEnterProjectileAction.fsm.transitionedState, `${label}.stateEnterProjectileAction.fsm.transitionedState`);
  assertPlainObject(scenario.stateEnterProjectileAction.stateEnter, `${label}.stateEnterProjectileAction.stateEnter`);
  assert.equal(scenario.stateEnterProjectileAction.stateEnter.phaseCode, 0, `${label}.stateEnterProjectileAction.stateEnter.phaseCode must be NextFramePrePhysics`);
  assertProjectileActionMetadata(scenario.stateEnterProjectileAction.projectileAction, `${label}.stateEnterProjectileAction.projectileAction`);
  assertFiniteNumber(scenario.expected.transitionFrame, `${label}.expected.transitionFrame`);
  assertFiniteNumber(scenario.expected.projectileFrame, `${label}.expected.projectileFrame`);
  assertFiniteNumber(scenario.expected.projectileFrameGameState, `${label}.expected.projectileFrameGameState`);
  assert.ok(scenario.captureFrames.includes(authoredEvents[0].frame), `${label}.captureFrames must include the authoring frame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.transitionFrame), `${label}.captureFrames must include expected.transitionFrame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.projectileFrame), `${label}.captureFrames must include expected.projectileFrame`);
  assert.deepEqual(scenario.expected.transitionEventKinds, ["timer", "behaviorStateChanged"], `${label}.expected.transitionEventKinds must stay exact`);
  if (scenario.expected.actionFailureReason === undefined) {
    if (scenario.expected.tileImpact === undefined) {
      assert.deepEqual(scenario.expected.projectileEventKinds, [], `${label}.expected.projectileEventKinds must stay exact`);
    } else {
      assert.deepEqual(scenario.expected.projectileEventKinds, ["tileImpact"], `${label}.expected.projectileEventKinds must stay exact`);
      assertTileImpactExpectation(scenario.expected.tileImpact, `${label}.expected.tileImpact`);
      assert.equal(
        scenario.expected.tileImpact.flags,
        GAMEPLAY_EVENT_FLAG_TARGET_REMOVED
          | (GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_X << GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT),
        `${label}.expected.tileImpact.flags must encode terminal negative-x tile impact`,
      );
      assertPlainObject(scenario.stateEnterProjectileAction.blockingTilemap, `${label}.stateEnterProjectileAction.blockingTilemap`);
      assertBlockedTilemapMetadata(scenario.stateEnterProjectileAction.blockingTilemap, `${label}.stateEnterProjectileAction.blockingTilemap`);
    }
    assert.equal(scenario.stateEnterProjectileAction.projectileAction.aimCode, PROJECTILE_AIM_TARGET_PLAYER, `${label}.stateEnterProjectileAction.projectileAction.aimCode must be targetPlayer for success coverage`);
    assert.equal(scenario.stateEnterProjectileAction.projectileAction.collisionTargetCode, PROJECTILE_COLLISION_TARGET_PLAYER, `${label}.stateEnterProjectileAction.projectileAction.collisionTargetCode must be player for success coverage`);
  } else {
    assert.equal(scenario.expected.actionFailureReason, GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET, `${label}.expected.actionFailureReason must be unsupported collision target`);
    assert.deepEqual(scenario.expected.projectileEventKinds, ["actionFailed"], `${label}.expected.projectileEventKinds must stay exact`);
  }
  assertFiniteNumber(scenario.expected.fsmState, `${label}.expected.fsmState`);
}

function assertStateEnterMeleeActionScenarioMetadata(scenario, label) {
  const authoredEvents = scenario.input.events.filter((event) => event.type === "authoring");
  assert.equal(authoredEvents.length, 1, `${label} must include exactly one state-enter melee authoring event`);
  assertPlainObject(scenario.stateEnterMeleeAction, `${label}.stateEnterMeleeAction`);
  assertBodyMetadata(scenario.stateEnterMeleeAction.sourceBody, `${label}.stateEnterMeleeAction.sourceBody`);
  assertPlainObject(scenario.stateEnterMeleeAction.timer, `${label}.stateEnterMeleeAction.timer`);
  assertFiniteNumber(scenario.stateEnterMeleeAction.timer.timerId, `${label}.stateEnterMeleeAction.timer.timerId`);
  assertFiniteNumber(scenario.stateEnterMeleeAction.timer.durationSeconds, `${label}.stateEnterMeleeAction.timer.durationSeconds`);
  assertPlainObject(scenario.stateEnterMeleeAction.fsm, `${label}.stateEnterMeleeAction.fsm`);
  assertFiniteNumber(scenario.stateEnterMeleeAction.fsm.initialState, `${label}.stateEnterMeleeAction.fsm.initialState`);
  assertFiniteNumber(scenario.stateEnterMeleeAction.fsm.transitionedState, `${label}.stateEnterMeleeAction.fsm.transitionedState`);
  assertPlainObject(scenario.stateEnterMeleeAction.stateEnter, `${label}.stateEnterMeleeAction.stateEnter`);
  assert.equal(scenario.stateEnterMeleeAction.stateEnter.phaseCode, 0, `${label}.stateEnterMeleeAction.stateEnter.phaseCode must be NextFramePrePhysics`);
  assertMeleeActionMetadata(scenario.stateEnterMeleeAction.meleeAction, `${label}.stateEnterMeleeAction.meleeAction`);
  assertFiniteNumber(scenario.expected.transitionFrame, `${label}.expected.transitionFrame`);
  assertFiniteNumber(scenario.expected.meleeFrame, `${label}.expected.meleeFrame`);
  assertFiniteNumber(scenario.expected.meleeFrameGameState, `${label}.expected.meleeFrameGameState`);
  assert.ok(scenario.captureFrames.includes(authoredEvents[0].frame), `${label}.captureFrames must include the authoring frame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.transitionFrame), `${label}.captureFrames must include expected.transitionFrame`);
  assert.ok(scenario.captureFrames.includes(scenario.expected.meleeFrame), `${label}.captureFrames must include expected.meleeFrame`);
  assert.deepEqual(scenario.expected.transitionEventKinds, ["timer", "behaviorStateChanged"], `${label}.expected.transitionEventKinds must stay exact`);
  if (scenario.expected.actionFailureReason === undefined) {
    if (scenario.stateEnterMeleeAction.meleeAction.targetCode === MELEE_TARGET_PLAYER) {
      assert.deepEqual(scenario.expected.meleeEventKinds, [], `${label}.expected.meleeEventKinds must stay exact`);
    } else {
      assert.equal(scenario.stateEnterMeleeAction.meleeAction.targetCode, MELEE_TARGET_ENEMIES, `${label}.stateEnterMeleeAction.meleeAction.targetCode must be enemies for enemy-target success coverage`);
      assertBodyMetadata(scenario.stateEnterMeleeAction.targetBody, `${label}.stateEnterMeleeAction.targetBody`);
      assert.deepEqual(scenario.expected.meleeEventKinds, ["collisionDamage"], `${label}.expected.meleeEventKinds must stay exact`);
    }
  } else {
    assert.equal(scenario.expected.actionFailureReason, GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET, `${label}.expected.actionFailureReason must be unsupported collision target`);
    assert.deepEqual(scenario.expected.meleeEventKinds, ["actionFailed"], `${label}.expected.meleeEventKinds must stay exact`);
    assert.equal(scenario.stateEnterMeleeAction.meleeAction.targetCode, MELEE_TARGET_ENEMIES, `${label}.stateEnterMeleeAction.meleeAction.targetCode must be enemies for failure coverage`);
  }
  assertFiniteNumber(scenario.expected.fsmState, `${label}.expected.fsmState`);
}

function f32Bits(value) {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value, true);
  return view.getUint32(0, true);
}

function assertDashActionMetadata(value, label) {
  assertPlainObject(value, label);
  for (const field of ["actionId", "cooldownSeconds", "distance", "aimCode"]) {
    assertFiniteNumber(value[field], `${label}.${field}`);
  }
  assert.ok(
    value.aimCode === DASH_AIM_INPUT || value.aimCode === DASH_AIM_TARGET_PLAYER,
    `${label}.aimCode must be input or targetPlayer`,
  );
}

function assertProjectileActionMetadata(value, label) {
  assertPlainObject(value, label);
  for (const field of ["actionId", "cooldownSeconds", "speed", "damage", "lifetimeSeconds", "aimCode", "collisionTargetCode"]) {
    assertFiniteNumber(value[field], `${label}.${field}`);
  }
  assert.ok(
    value.aimCode === PROJECTILE_AIM_INPUT || value.aimCode === PROJECTILE_AIM_TARGET_PLAYER,
    `${label}.aimCode must be input or targetPlayer`,
  );
  assert.ok(
    value.collisionTargetCode === PROJECTILE_COLLISION_TARGET_ENEMIES
      || value.collisionTargetCode === PROJECTILE_COLLISION_TARGET_PLAYER,
    `${label}.collisionTargetCode must be enemies or player`,
  );
  if (value.tileImpactCode !== undefined) {
    assertFiniteNumber(value.tileImpactCode, `${label}.tileImpactCode`);
    assert.ok(
      value.tileImpactCode === 0 || value.tileImpactCode === 1 || value.tileImpactCode === 2,
      `${label}.tileImpactCode must be despawn, passThrough, or bounce`,
    );
  }
}

function assertMeleeActionMetadata(value, label) {
  assertPlainObject(value, label);
  for (const field of ["actionId", "cooldownSeconds", "range", "damage", "targetCode"]) {
    assertFiniteNumber(value[field], `${label}.${field}`);
  }
  assert.ok(
    value.targetCode === MELEE_TARGET_ENEMIES || value.targetCode === MELEE_TARGET_PLAYER,
    `${label}.targetCode must be enemies or player`,
  );
}

function assertPosition(actual, expected, label) {
  assertPlainObject(actual, label);
  assertApproximatelyEqual(actual.x, expected.x, `${label}.x`);
  assertApproximatelyEqual(actual.y, expected.y, `${label}.y`);
}

function assertApproximatelyEqual(actual, expected, label, epsilon = 0.001) {
  assertFiniteNumber(actual, label);
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${label} must be approximately ${expected}, got ${actual}`,
  );
}

function assertBlockedSpawnPrefabMetadata(value, label) {
  assertSpawnPrefabActionMetadata(value, label);
  assertPlainObject(value.input, `${label}.input`);
  assertFiniteNumber(value.input.bindingIndex, `${label}.input.bindingIndex`);
  assert.equal(value.input.controlCode, INPUT_ACTION_CONTROL_ENTER, `${label}.input.controlCode must bind Enter`);
  assert.equal(value.input.activationCode, INPUT_ACTION_ACTIVATION_PRESSED, `${label}.input.activationCode must be pressed`);
  assertBlockedTilemapMetadata(value.blockedTilemap, `${label}.blockedTilemap`);
}

function assertBlockedTilemapMetadata(value, label) {
  assertPlainObject(value, label);
  for (const field of ["layerIndex", "columns", "rows", "tileWidth", "tileHeight", "originX", "originY"]) {
    assertFiniteNumber(value[field], `${label}.${field}`);
  }
  assert.ok(Array.isArray(value.data), `${label}.data must be an array`);
  assert.ok(value.data.some((tileId) => tileId > 0), `${label}.data must contain an obstacle tile`);
}

function assertTileImpactExpectation(value, label) {
  assertPlainObject(value, label);
  for (const field of [
    "projectileId",
    "projectileGeneration",
    "tileImpactCode",
    "flags",
    "payloadBits",
  ]) {
    assertFiniteNumber(value[field], `${label}.${field}`);
  }
  assert.equal(typeof value.targetRemoved, "boolean", `${label}.targetRemoved must be boolean`);
}

function assertSpawnPrefabActionMetadata(value, label) {
  assertPlainObject(value, label);
  for (const field of ["actionId", "cooldownSeconds", "prefabId", "anchorCode", "phaseCode", "offsetX", "offsetY"]) {
    assertFiniteNumber(value[field], `${label}.${field}`);
  }
}

function assertBodyMetadata(body, label) {
  assertPlainObject(body, label);
  for (const field of ["x", "y", "halfWidth", "halfHeight", "layer"]) {
    assertFiniteNumber(body[field], `${label}.${field}`);
  }
  for (const field of ["bodyType", "massOrDensity"]) {
    if (body[field] !== undefined) {
      assertFiniteNumber(body[field], `${label}.${field}`);
    }
  }
  for (const field of ["useDensity", "canSleep"]) {
    if (body[field] !== undefined) {
      assert.equal(typeof body[field], "boolean", `${label}.${field} must be boolean`);
    }
  }
  if (body.isTrigger !== undefined) {
    assert.equal(typeof body.isTrigger, "boolean", `${label}.isTrigger must be boolean`);
  }
}

function assertCaptureFrames(captureFrames, frameCount, label) {
  assert.ok(Array.isArray(captureFrames), `${label} must be an array`);
  assert.ok(captureFrames.length > 0, `${label} must not be empty`);
  assert.equal(captureFrames[0], 0, `${label} must start at frame 0`);
  assert.equal(captureFrames.at(-1), frameCount, `${label} must end at frameCount`);
  let previous = -1;
  for (const [index, frame] of captureFrames.entries()) {
    assertNonNegativeInteger(frame, `${label}[${index}]`);
    assert.ok(frame > previous, `${label} must be strictly increasing`);
    previous = frame;
  }
}

function assertPlainObject(value, label) {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNonEmptyString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.length > 0, `${label} must not be empty`);
}

function assertCoverageTags(value, label) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.ok(value.length > 0, `${label} must not be empty`);
  const seen = new Set();
  value.forEach((tag, index) => {
    const tagLabel = `${label}[${index}]`;
    assertNonEmptyString(tag, tagLabel);
    assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag), `${tagLabel} must be kebab-case`);
    assert.ok(!seen.has(tag), `${tagLabel} must be unique`);
    seen.add(tag);
  });
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

function optionalEnvPath(value) {
  return value === undefined || value.length === 0 ? undefined : value;
}

function assertReplayHash(value, label) {
  assertNonEmptyString(value, label);
  assert.match(value, /^[0-9a-f]{8}$/, `${label} must be an 8-character lowercase hex hash`);
}

function assertFiniteNumber(value, label) {
  assert.equal(typeof value, "number", `${label} must be a number`);
  assert.ok(Number.isFinite(value), `${label} must be finite`);
}

function assertNonNegativeInteger(value, label) {
  assertFiniteNumber(value, label);
  assert.ok(Number.isInteger(value), `${label} must be an integer`);
  assert.ok(value >= 0, `${label} must be non-negative`);
}

function assertPositiveInteger(value, label) {
  assertNonNegativeInteger(value, label);
  assert.ok(value > 0, `${label} must be positive`);
}

function parseArgs(args) {
  let update = false;
  let fixturePath;
  let manifestPath;
  let artifactDir = optionalEnvPath(process.env.FERRUM_GAMEPLAY_REPLAY_ARTIFACT_DIR);
  let scenario = "all";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--update") {
      update = true;
      continue;
    }
    if (arg.startsWith("--fixture=")) {
      fixturePath = arg.slice("--fixture=".length);
      assertNonEmptyString(fixturePath, "--fixture");
      continue;
    }
    if (arg === "--fixture") {
      fixturePath = requiredArg(args, ++index, arg);
      continue;
    }
    if (arg.startsWith("--manifest=")) {
      manifestPath = arg.slice("--manifest=".length);
      assertNonEmptyString(manifestPath, "--manifest");
      continue;
    }
    if (arg === "--manifest") {
      manifestPath = requiredArg(args, ++index, arg);
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
    if (arg.startsWith("--scenario=")) {
      scenario = arg.slice("--scenario=".length);
      assertNonEmptyString(scenario, "--scenario");
      continue;
    }
    if (arg === "--scenario") {
      scenario = requiredArg(args, ++index, arg);
      continue;
    }
    throw new Error(`unsupported gameplay replay smoke option: ${arg}`);
  }
  if (fixturePath !== undefined && scenario === "all") {
    scenario = "example-topdown-basic";
  }
  return {
    update,
    fixturePath: fixturePath === undefined ? undefined : resolve(fixturePath),
    manifestPath: manifestPath === undefined ? undefined : resolve(manifestPath),
    artifactDir: artifactDir === undefined ? undefined : resolve(artifactDir),
    scenario,
  };
}

function scenariosToRun(options, manifest) {
  if (options.scenario === "all") {
    return manifest.scenarios;
  }
  const scenario = manifest.scenarios.find((candidate) => candidate.id === options.scenario);
  if (scenario === undefined) {
    throw new Error(`unknown gameplay replay scenario: ${options.scenario}`);
  }
  return [scenario];
}

function requiredArg(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}
