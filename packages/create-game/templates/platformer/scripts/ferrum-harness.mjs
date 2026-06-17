#!/usr/bin/env node
import {
  HARNESS_REPLAY_COVERAGE_TAGS_PATH,
  HARNESS_REPLAY_FIXTURE_FORMAT,
  HARNESS_REPLAY_FIXTURE_VERSION,
  createTemplateSurfaceReplayRun,
  runFerrumHarnessCli,
  sceneCompositionAuthoringSurface,
  sceneAuthoringError,
} from "./ferrum-harness-core.mjs";

const REPLAY_SCENARIO = "platformer-template-surface";
const REPLAY_COVERAGE_TAGS = Object.freeze([
  "platformer-template",
  "platformer-scene-composition-authoring",
]);

await runFerrumHarnessCli({
  root: process.cwd(),
  replayScenario: REPLAY_SCENARIO,
  replayCoverageTags: REPLAY_COVERAGE_TAGS,
  inspectAuthoringSurface: inspectTemplateAuthoringSurface,
  createSceneAuthoringMockEngine,
  spawnSceneInstance,
  createTemplateReplayRun: (result) => createTemplateSurfaceReplayRun({
    scenario: REPLAY_SCENARIO,
    phases: ["template-loaded", "platformer-ready"],
    summary: templateSummary(result),
  }),
  createReplayFixture: templateReplayFixture,
  replayMismatchMessage: "Platformer template replay fixture does not match the current template contract.",
  replayMismatchSuggestion: "Update the template intentionally, then regenerate public/gameplay-replay.fixture.json.",
  replayPatchMessage: "Current platformer template contract can be promoted to the replay fixture.",
  replayPatchSuggestion: "If the template change is intentional, run npm run ferrum:update-replay-fixture and rerun npm run ferrum:replay-report.",
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
      usePlatformerGame: true,
      builtInPlatformerPlayerHandle: false,
    },
    sceneComposition: sceneCompositionAuthoringSurface(sceneAuthoring),
  };
}

function createSceneAuthoringMockEngine() {
  const calls = [];
  return {
    calls,
    set_gameplay_health(entityId, entityGeneration, current) {
      calls.push([
        "set_gameplay_health",
        entityId,
        entityGeneration,
        current,
      ]);
      return true;
    },
  };
}

function spawnSceneInstance(instance) {
  if (instance.props.runtimeEntity !== "builtinPlatformerPlayer") {
    throw sceneAuthoringError(
      `sceneAuthoring.sceneComposition.instances.${instance.id}.props.runtimeEntity`,
      "platformer template scene authoring supports builtinPlatformerPlayer runtime entity only",
    );
  }
  return { entityId: 1, entityGeneration: 0 };
}

function templateSummary(result) {
  return {
    template: "platformer",
    scene: "builtin-platformer",
    hasFerrumDependency: result.hasFerrumDependency,
    hasMainSource: result.hasMainSource,
    authoringSurface: result.authoringSurface,
    scripts: ["ferrum:placement-viewer", "ferrum:validate", "ferrum:authoring-report", "ferrum:replay-report", "ferrum:update-replay-fixture"],
  };
}

function templateReplayFixture(replay) {
  return {
    format: HARNESS_REPLAY_FIXTURE_FORMAT,
    version: HARNESS_REPLAY_FIXTURE_VERSION,
    scenario: REPLAY_SCENARIO,
    description: "Generated platformer template surface replay contract. This fixture validates public replay helper hashing and template surface drift; it is not a browser frame runner.",
    coverageTagDefinitionsPath: HARNESS_REPLAY_COVERAGE_TAGS_PATH,
    coverageTags: REPLAY_COVERAGE_TAGS,
    replay,
  };
}
