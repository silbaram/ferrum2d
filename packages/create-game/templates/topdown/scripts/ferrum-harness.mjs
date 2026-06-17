#!/usr/bin/env node
import {
  HARNESS_REPLAY_COVERAGE_TAGS_PATH,
  HARNESS_REPLAY_FIXTURE_FORMAT,
  HARNESS_REPLAY_FIXTURE_VERSION,
  inspectShooterGameSpec,
  runFerrumHarnessCli,
  sceneCompositionAuthoringSurface,
  sceneAuthoringError,
} from "./ferrum-harness-core.mjs";

const REPLAY_SCENARIO = "topdown-template-game-spec";
const TOPDOWN_REPLAY_COVERAGE_TAGS = Object.freeze([
  "template-game-spec",
  "topdown-scene-composition-authoring",
]);

await runFerrumHarnessCli({
  root: process.cwd(),
  requireGameSpec: true,
  replayScenario: REPLAY_SCENARIO,
  replayCoverageTags: TOPDOWN_REPLAY_COVERAGE_TAGS,
  inspectGameSpec: ({ root }) => inspectShooterGameSpec(root, topdownGameSpecSummary),
  inspectAuthoringSurface: inspectTemplateAuthoringSurface,
  createSceneAuthoringMockEngine,
  spawnSceneInstance,
  createTemplateReplayRun: (result) => createTopdownTemplateReplayRun(result.gameSpec.summary, result.authoringSurface),
  createReplayFixture: topdownReplayFixture,
  authoringStatus,
  replayFixtureReportExpected: "valid Ferrum2D replay fixture matching the current Game Spec replay contract",
  replayFixtureReportSuggestion: "Confirm the Game Spec change is intentional, then rerun npm run ferrum:update-replay-fixture.",
  replayMismatchMessage: "Top-down template replay fixture does not match the current Game Spec contract.",
  replayMismatchSuggestion: "Update public/game.json intentionally, then regenerate public/gameplay-replay.fixture.json from the same replay contract.",
  replayPatchMessage: "Current Game Spec replay contract can be promoted to the top-down template replay fixture.",
  replayPatchSuggestion: "If the Game Spec change is intentional, run npm run ferrum:update-replay-fixture and rerun npm run ferrum:replay-report.",
});

function inspectTemplateAuthoringSurface({ sceneAuthoring }) {
  return {
    publicApis: {
      applySceneBehaviorRecipes: sceneAuthoring?.publicApis?.applySceneBehaviorRecipes === true,
      classifySceneInstance: sceneAuthoring?.publicApis?.classifySceneInstance === true,
      dryRunSceneBehaviorRecipes: sceneAuthoring?.publicApis?.dryRunSceneBehaviorRecipes === true,
      previewScenePlacementBindingMigration: sceneAuthoring?.publicApis?.previewScenePlacementBindingMigration === true,
      resolveSceneCompositionSpec: sceneAuthoring?.publicApis?.resolveSceneCompositionSpec === true,
      resolveBehaviorRecipeDocument: sceneAuthoring?.publicApis?.resolveBehaviorRecipeDocument === true,
    },
    runtimeHooks: {
      resolveShooterGameSpec: true,
      builtinShooterPlayerHandle: false,
    },
    sceneComposition: sceneCompositionAuthoringSurface(sceneAuthoring),
  };
}

function createSceneAuthoringMockEngine() {
  const calls = [];
  return {
    calls,
    set_gameplay_action_projectile(
      entityId,
      entityGeneration,
      actionId,
      cooldownSeconds,
      speed,
      damage,
      lifetimeSeconds,
    ) {
      calls.push([
        "set_gameplay_action_projectile",
        entityId,
        entityGeneration,
        actionId,
        cooldownSeconds,
        speed,
        damage,
        lifetimeSeconds,
      ]);
      return true;
    },
  };
}

function spawnSceneInstance(instance) {
  if (instance.props.runtimeEntity !== "builtinShooterPlayer") {
    throw sceneAuthoringError(
      `sceneAuthoring.sceneComposition.instances.${instance.id}.props.runtimeEntity`,
      "topdown template scene authoring supports builtinShooterPlayer runtime entity only",
    );
  }
  return { entityId: 1, entityGeneration: 0 };
}

function authoringStatus(result) {
  if (result.gameSpec === undefined) return "missing";
  if (result.gameSpec.ok === false || result.sceneAuthoring?.ok === false) return "invalid";
  return "validated";
}

async function createTopdownTemplateReplayRun(specSummary, authoringSurface) {
  const {
    GAME_STATE_SNAPSHOT_FORMAT,
    GAME_STATE_SNAPSHOT_VERSION,
    createGameplayReplayRun,
    hashGameStateSnapshot,
  } = await import("@ferrum2d/ferrum-web/quality");
  const snapshots = [
    templateReplaySnapshot({
      frame: 0,
      scene: { score: 0, gameState: 0, entityCount: 0, spriteCount: 0, cameraX: 0, cameraY: 0 },
      phase: "spec-loaded",
      specSummary,
      authoringSurface,
      format: GAME_STATE_SNAPSHOT_FORMAT,
      version: GAME_STATE_SNAPSHOT_VERSION,
      hashGameStateSnapshot,
    }),
    templateReplaySnapshot({
      frame: 1,
      scene: {
        score: 0,
        gameState: 1,
        entityCount: 1,
        spriteCount: 1,
        cameraX: specSummary.world.width / 2,
        cameraY: specSummary.world.height / 2,
      },
      phase: "playable-baseline",
      specSummary,
      authoringSurface,
      format: GAME_STATE_SNAPSHOT_FORMAT,
      version: GAME_STATE_SNAPSHOT_VERSION,
      hashGameStateSnapshot,
    }),
  ];
  return createGameplayReplayRun(snapshots);
}

function topdownReplayFixture(replay) {
  return {
    format: HARNESS_REPLAY_FIXTURE_FORMAT,
    version: HARNESS_REPLAY_FIXTURE_VERSION,
    scenario: REPLAY_SCENARIO,
    description: "Generated topdown template Game Spec replay contract. This fixture validates public replay helper hashing and template Game Spec drift; it is not a browser frame runner.",
    coverageTagDefinitionsPath: HARNESS_REPLAY_COVERAGE_TAGS_PATH,
    coverageTags: TOPDOWN_REPLAY_COVERAGE_TAGS,
    replay,
  };
}

function templateReplaySnapshot({ frame, scene, phase, specSummary, authoringSurface, format, version, hashGameStateSnapshot }) {
  const snapshot = {
    format,
    version,
    frame,
    source: "ferrum-runtime",
    scene,
    custom: {
      templateReplay: {
        version: 1,
        scenario: REPLAY_SCENARIO,
        phase,
        spec: specSummary,
        authoringSurface,
      },
    },
  };
  return {
    ...snapshot,
    snapshotHash: hashGameStateSnapshot(snapshot),
  };
}

function topdownGameSpecSummary(spec) {
  return {
    world: { width: spec.worldWidth, height: spec.worldHeight },
    player: { speed: spec.playerSpeed, width: spec.playerWidth, height: spec.playerHeight },
    enemies: {
      speed: spec.enemySpeed,
      spawnInterval: spec.enemySpawnInterval,
      behavior: spec.enemyBehavior,
      spawnPattern: spec.enemySpawnPattern,
      health: spec.enemyHealth,
      scoreReward: spec.scoreReward,
      waveCount: spec.waves.length,
    },
    weapons: {
      bulletSpeed: spec.bulletSpeed,
      cooldown: spec.fireCooldown,
      damage: spec.bulletDamage,
      lifetime: spec.bulletLifetime,
    },
    camera: { preset: spec.cameraPreset },
  };
}
