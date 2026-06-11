#!/usr/bin/env node
import {
  captureDeterministicRuntimeSnapshots,
  RUNTIME_REPLAY_COVERAGE_TAGS,
  RUNTIME_REPLAY_COVERAGE_TAGS_PATH,
  RUNTIME_REPLAY_FIXTURE_PATH,
  RUNTIME_REPLAY_SCENARIO,
  runRuntimeReplayCli,
} from "./ferrum-runtime-replay-core.mjs";

const RECIPE_FORMAT = "ferrum2d.consumer.runtime-gameplay-replay.recipe";
const RECIPE_VERSION = 1;
const TEMPLATE_RUNTIME_REPLAY_RECIPE = Object.freeze({
  format: RECIPE_FORMAT,
  version: RECIPE_VERSION,
  template: "minimal",
  scenario: RUNTIME_REPLAY_SCENARIO,
  status: "configured",
  fixture: RUNTIME_REPLAY_FIXTURE_PATH,
  coverageTagDefinitionsPath: RUNTIME_REPLAY_COVERAGE_TAGS_PATH,
  coverageTags: [...RUNTIME_REPLAY_COVERAGE_TAGS],
  deterministicRun: {
    fixedDelta: 1 / 60,
    seed: "minimal-headless-runtime-seed",
    inputSequence: [
      { frame: 1, action: "press", control: "Enter" },
      { frame: 2, action: "release", control: "Enter" },
    ],
    captureFrames: [0, 1, 2],
  },
  canonicalState: {
    required: [
      "GameStateSnapshot.format/version/source/frame/scene",
      "scene.score",
      "scene.gameState",
      "scene.entityCount",
      "scene.spriteCount",
      "scene.cameraX",
      "scene.cameraY",
      "custom.template",
      "custom.runtime",
    ],
    optional: [
      "physics",
      "project-owned custom JSON state",
    ],
    excluded: [
      "render commands",
      "audio playback",
      "DOM state",
      "wall-clock timings",
      "debug overlay",
      "profiler output",
    ],
  },
  implementationSteps: [
    "Create or boot the project runtime deterministically.",
    "Advance fixed timestep frames using the seed/input sequence above.",
    "Capture a non-empty, strictly increasing GameStateSnapshot[] at captureFrames.",
    "Compute snapshotHash with hashGameStateSnapshot(...) for manually constructed snapshots.",
    "Run npm run ferrum:update-runtime-replay-fixture, then npm run ferrum:runtime-replay-report.",
  ],
});

const PROJECT_RUNTIME_REPLAY_CONFIGURED = true;

await runRuntimeReplayCli({
  recipe: TEMPLATE_RUNTIME_REPLAY_RECIPE,
  configured: PROJECT_RUNTIME_REPLAY_CONFIGURED,
  createProjectRuntimeReplayRun,
});

async function createProjectRuntimeReplayRun() {
  const {
    createGameplayReplayRun,
    hashGameStateSnapshot,
  } = await import("@ferrum2d/ferrum-web/quality");
  const snapshots = await captureProjectRuntimeSnapshots({ hashGameStateSnapshot });
  return createGameplayReplayRun(snapshots, { path: "runtimeGameplayReplay" });
}

async function captureProjectRuntimeSnapshots({ hashGameStateSnapshot }) {
  const viewport = { width: 800, height: 480 };
  return captureDeterministicRuntimeSnapshots({
    recipe: TEMPLATE_RUNTIME_REPLAY_RECIPE,
    hashGameStateSnapshot,
    viewport,
    setupEngine: ({ engine }) => {
      engine.setTextureIds({ player: 0, enemy: 0, bullet: 0 });
    },
    customState: ({ recipe }) => ({
      template: "minimal",
      runtime: {
        mode: "headless-engine",
        seed: recipe.deterministicRun.seed,
        fixedDelta: recipe.deterministicRun.fixedDelta,
        inputSequence: recipe.deterministicRun.inputSequence,
        viewport,
      },
    }),
  });
}
