#!/usr/bin/env node
import {
  HARNESS_REPLAY_COVERAGE_TAGS_PATH,
  HARNESS_REPLAY_FIXTURE_FORMAT,
  HARNESS_REPLAY_FIXTURE_VERSION,
  createTemplateSurfaceReplayRun,
  inspectShooterGameSpec,
  runFerrumHarnessCli,
  sceneCompositionAuthoringSurface,
  sceneAuthoringError,
} from "./ferrum-harness-core.mjs";

const REPLAY_SCENARIO = "minimal-template-surface";
const REPLAY_COVERAGE_TAGS = Object.freeze([
  "starter-runtime-template",
  "template-weapon-authoring",
  "template-scene-composition-authoring",
]);

await runFerrumHarnessCli({
  root: process.cwd(),
  replayScenario: REPLAY_SCENARIO,
  replayCoverageTags: REPLAY_COVERAGE_TAGS,
  includePublicAssets: true,
  publicAssetsMode: "recursive",
  includePublicAssetsInReport: true,
  includePublicAssetsInAuthoringReport: true,
  printSkippedGameSpec: true,
  passSceneAuthoringIds: true,
  inspectGameSpec: ({ root }) => inspectShooterGameSpec(root),
  inspectAuthoringSurface: inspectTemplateAuthoringSurface,
  createSceneAuthoringMockEngine,
  spawnSceneInstance,
  createTemplateReplayRun: (result) => createTemplateSurfaceReplayRun({
    scenario: REPLAY_SCENARIO,
    phases: ["template-loaded", "runtime-ready"],
    summary: templateSummary(result),
  }),
  createReplayFixture: templateReplayFixture,
  replayMismatchMessage: "Minimal template replay fixture does not match the current template contract.",
  replayMismatchSuggestion: "Update the template intentionally, then regenerate public/gameplay-replay.fixture.json.",
  replayPatchMessage: "Current minimal template contract can be promoted to the replay fixture.",
  replayPatchSuggestion: "If the template change is intentional, run npm run ferrum:update-replay-fixture and rerun npm run ferrum:replay-report.",
});

function inspectTemplateAuthoringSurface({ mainSource, sceneAuthoring }) {
  return {
    weaponProfiles: ["standard", "piercing", "bounce"].filter((profile) => (
      mainSource.includes(`"${profile}"`)
    )),
    publicApis: {
      behaviorRecipeCommandsForEntity: mainSource.includes("behaviorRecipeCommandsForEntity"),
      compileWeaponProfiles: mainSource.includes("compileWeaponProfiles"),
      ProjectileDefinition: mainSource.includes("ProjectileDefinition"),
      WeaponDefinition: mainSource.includes("WeaponDefinition"),
      applySceneBehaviorRecipes: sceneAuthoring?.publicApis?.applySceneBehaviorRecipes === true,
      dryRunSceneBehaviorRecipes: sceneAuthoring?.publicApis?.dryRunSceneBehaviorRecipes === true,
      resolveSceneCompositionSpec: sceneAuthoring?.publicApis?.resolveSceneCompositionSpec === true,
      resolveBehaviorRecipeDocument: sceneAuthoring?.publicApis?.resolveBehaviorRecipeDocument === true,
    },
    runtimeHooks: {
      applyGameplayBehaviorCommands: mainSource.includes("applyGameplayBehaviorCommands"),
      builtInShooterPlayerHandle: mainSource.includes("builtInShooterPlayerHandle"),
      setInputActionBinding: mainSource.includes("setInputActionBinding"),
      profileQueryParam: mainSource.includes('searchParams.get("profile")'),
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
      "minimal template scene authoring supports builtinShooterPlayer runtime entity only",
    );
  }
  return { entityId: 1, entityGeneration: 0 };
}

function templateSummary(result) {
  return {
    template: "minimal",
    hasFerrumDependency: result.hasFerrumDependency,
    hasMainSource: result.hasMainSource,
    authoringSurface: result.authoringSurface,
    publicAssets: result.publicAssets,
    scripts: ["ferrum:validate", "ferrum:authoring-report", "ferrum:replay-report", "ferrum:update-replay-fixture"],
  };
}

function templateReplayFixture(replay) {
  return {
    format: HARNESS_REPLAY_FIXTURE_FORMAT,
    version: HARNESS_REPLAY_FIXTURE_VERSION,
    scenario: REPLAY_SCENARIO,
    description: "Generated minimal template surface replay contract. This fixture validates public replay helper hashing and template surface drift; it is not a browser frame runner.",
    coverageTagDefinitionsPath: HARNESS_REPLAY_COVERAGE_TAGS_PATH,
    coverageTags: REPLAY_COVERAGE_TAGS,
    replay,
  };
}
