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

const REPLAY_SCENARIO = "breakout-template-surface";
const REPLAY_COVERAGE_TAGS = Object.freeze([
  "breakout-template",
  "breakout-built-in-scene",
]);

await runFerrumHarnessCli({
  root: process.cwd(),
  replayScenario: REPLAY_SCENARIO,
  replayCoverageTags: REPLAY_COVERAGE_TAGS,
  includePublicAssets: true,
  publicAssetsMode: "flat",
  includePublicAssetsInReport: true,
  inspectProjectExtras: ({ mainSource }) => ({
    usesPublicRuntime: mainSource.includes("createFerrumRuntime") && mainSource.includes("useBreakoutGame"),
  }),
  projectChecks: (result) => ({
    usesPublicRuntime: result.usesPublicRuntime,
  }),
  extraDiagnostics: (result, { diagnostic }) => result.usesPublicRuntime
    ? []
    : [diagnostic("src/main.ts", "Breakout template must boot createFerrumRuntime(...) and useBreakoutGame().")],
  inspectAuthoringSurface: inspectTemplateAuthoringSurface,
  createSceneAuthoringMockEngine,
  spawnSceneInstance,
  createTemplateReplayRun: (result) => createTemplateSurfaceReplayRun({
    scenario: REPLAY_SCENARIO,
    phases: ["template-loaded", "breakout-ready"],
    summary: templateSummary(result),
  }),
  createReplayFixture: templateReplayFixture,
  diagnosticMessagePrefix: "Invalid Ferrum2D Breakout template",
  reportKind: "project-validation",
  reportCode: "FERRUM_CONSUMER_PROJECT_INVALID",
  reportExpected: "valid Ferrum2D Breakout template project",
  reportSuggestion: "Fix the reported generated project contract and rerun npm run ferrum:validate.",
  replayMismatchMessage: "Breakout template replay fixture does not match the current template contract.",
  replayMismatchSuggestion: "Update the template intentionally, then regenerate public/gameplay-replay.fixture.json.",
  replayPatchMessage: "Current Breakout template contract can be promoted to the replay fixture.",
  replayPatchSuggestion: "If the template change is intentional, run npm run ferrum:update-replay-fixture and rerun npm run ferrum:replay-report.",
});

function inspectTemplateAuthoringSurface({ mainSource, sceneAuthoring }) {
  return {
    publicApis: {
      applySceneBehaviorRecipes: sceneAuthoring?.publicApis?.applySceneBehaviorRecipes === true,
      dryRunSceneBehaviorRecipes: sceneAuthoring?.publicApis?.dryRunSceneBehaviorRecipes === true,
      resolveSceneCompositionSpec: sceneAuthoring?.publicApis?.resolveSceneCompositionSpec === true,
      resolveBehaviorRecipeDocument: sceneAuthoring?.publicApis?.resolveBehaviorRecipeDocument === true,
    },
    runtimeHooks: {
      useBreakoutGame: mainSource.includes("useBreakoutGame"),
      resetGame: mainSource.includes("resetGame"),
      runtimeMetrics: mainSource.includes("rendererStats.renderCommandCount"),
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
    set_gameplay_lifetime(entityId, entityGeneration, seconds) {
      calls.push([
        "set_gameplay_lifetime",
        entityId,
        entityGeneration,
        seconds,
      ]);
      return true;
    },
  };
}

function spawnSceneInstance(instance) {
  if (instance.props.runtimeEntity === "builtinBreakoutPaddle") {
    return { entityId: 1, entityGeneration: 0 };
  }
  if (instance.props.runtimeEntity === "builtinBreakoutBall") {
    return { entityId: 2, entityGeneration: 0 };
  }
  throw sceneAuthoringError(
    `sceneAuthoring.sceneComposition.instances.${instance.id}.props.runtimeEntity`,
    "breakout template scene authoring supports builtinBreakoutPaddle and builtinBreakoutBall runtime entities only",
  );
}

function templateSummary(result) {
  return {
    template: "breakout",
    scene: "builtin-breakout",
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
    description: "Generated Breakout template surface replay contract. This fixture validates public replay helper hashing and template surface drift; it is not a browser frame runner.",
    coverageTagDefinitionsPath: HARNESS_REPLAY_COVERAGE_TAGS_PATH,
    coverageTags: REPLAY_COVERAGE_TAGS,
    replay,
  };
}
