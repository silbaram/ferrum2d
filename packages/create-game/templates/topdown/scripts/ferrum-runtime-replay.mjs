#!/usr/bin/env node
import path from "node:path";

import {
  captureDeterministicRuntimeSnapshots,
  readJson,
  RUNTIME_REPLAY_COVERAGE_TAGS,
  RUNTIME_REPLAY_COVERAGE_TAGS_PATH,
  RUNTIME_REPLAY_FIXTURE_PATH,
  RUNTIME_REPLAY_SCENARIO,
  runRuntimeReplayCli,
} from "./ferrum-runtime-replay-core.mjs";

const root = process.cwd();
const RECIPE_FORMAT = "ferrum2d.consumer.runtime-gameplay-replay.recipe";
const RECIPE_VERSION = 1;
const TEMPLATE_RUNTIME_REPLAY_RECIPE = Object.freeze({
  format: RECIPE_FORMAT,
  version: RECIPE_VERSION,
  template: "topdown",
  scenario: RUNTIME_REPLAY_SCENARIO,
  status: "configured",
  fixture: RUNTIME_REPLAY_FIXTURE_PATH,
  coverageTagDefinitionsPath: RUNTIME_REPLAY_COVERAGE_TAGS_PATH,
  coverageTags: [...RUNTIME_REPLAY_COVERAGE_TAGS],
  deterministicRun: {
    fixedDelta: 1 / 60,
    seed: "topdown-project-runtime-seed",
    inputSequence: [
      { frame: 1, action: "press", control: "ArrowRight" },
      { frame: 8, action: "press", control: "Space" },
      { frame: 12, action: "release", control: "Space" },
      { frame: 20, action: "release", control: "ArrowRight" },
    ],
    captureFrames: [0, 1, 8, 16, 32],
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
      "builtInShooter",
      "custom.gameSpec",
      "custom.runtime",
    ],
    optional: [
      "physics",
      "resolved Game Spec summary",
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
    "Load public/game.json and boot the Top-down runtime deterministically.",
    "Advance fixed timestep frames using the seed/input sequence above.",
    "Capture a non-empty, strictly increasing GameStateSnapshot[] at captureFrames.",
    "Prefer captureGameStateSnapshot(..., { includeBuiltInShooterState: true, customState }) when a Ferrum runtime instance is available.",
    "Compute snapshotHash with hashGameStateSnapshot(...) for manually constructed snapshots.",
    "Run npm run ferrum:update-runtime-replay-fixture, then npm run ferrum:runtime-replay-report.",
  ],
});

const PROJECT_RUNTIME_REPLAY_CONFIGURED = true;

await runRuntimeReplayCli({
  root,
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
  const { resolveShooterGameSpec } = await import("@ferrum2d/ferrum-web/starter-scenes");
  const gameSpec = await readJson(path.join(root, "public/game.json"));
  const resolvedGameSpec = resolveShooterGameSpec(gameSpec);
  const viewport = {
    width: resolvedGameSpec.worldWidth,
    height: resolvedGameSpec.worldHeight,
  };
  return captureDeterministicRuntimeSnapshots({
    recipe: TEMPLATE_RUNTIME_REPLAY_RECIPE,
    hashGameStateSnapshot,
    viewport,
    setupEngine: ({ engine }) => {
      engine.setTextureIds({ player: 0, enemy: 0, bullet: 0 });
      engine.setGameSpec(gameSpec);
    },
    captureOptions: { includeBuiltInShooterState: true },
    customState: ({ recipe }) => ({
      gameSpec: resolvedGameSpec,
      runtime: {
        mode: "headless-engine",
        seed: recipe.deterministicRun.seed,
        fixedDelta: recipe.deterministicRun.fixedDelta,
        inputSequence: recipe.deterministicRun.inputSequence,
        captureFrames: recipe.deterministicRun.captureFrames,
        viewport,
      },
    }),
  });
}
