#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const command = process.argv[2] ?? "report";
const REPORT_FORMAT = "ferrum2d.consumer.runtime-gameplay-replay.report";
const UPDATE_REPORT_FORMAT = "ferrum2d.consumer.runtime-gameplay-replay.fixture-update-report";
const FIXTURE_FORMAT = "ferrum2d.consumer.runtime-gameplay-replay.fixture";
const FIXTURE_VERSION = 1;
const COVERAGE_FORMAT = "ferrum2d.consumer.gameplay-replay.coverage-tags";
const COVERAGE_VERSION = 1;
const RUNTIME_REPLAY_SCENARIO = "project-runtime";
const RUNTIME_REPLAY_FIXTURE_PATH = "public/gameplay-runtime-replay.fixture.json";
const RUNTIME_REPLAY_COVERAGE_TAGS_PATH = "public/gameplay-runtime-replay.coverage-tags.json";
const RUNTIME_REPLAY_COVERAGE_TAGS = Object.freeze(["project-runtime"]);
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

try {
  if (command === "report") {
    await printRuntimeReplayReport();
  } else if (command === "recipe") {
    printRuntimeReplayRecipe();
  } else if (command === "update-fixture") {
    await updateRuntimeReplayFixture();
  } else {
    throw new Error(`Unknown runtime replay command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function printRuntimeReplayRecipe() {
  console.log(JSON.stringify(TEMPLATE_RUNTIME_REPLAY_RECIPE, null, 2));
}

async function printRuntimeReplayReport() {
  if (!PROJECT_RUNTIME_REPLAY_CONFIGURED) {
    console.log(JSON.stringify(notConfiguredReport({ ok: true }), null, 2));
    return;
  }

  const reports = [];
  const replayFixturePatches = [];
  let fixture;
  let actualRun;
  let comparison;
  try {
    fixture = await loadRuntimeReplayFixture();
    actualRun = await createProjectRuntimeReplayRun();
    const { compareGameplayReplayRuns } = await import("@ferrum2d/ferrum-web/quality");
    comparison = compareGameplayReplayRuns(fixture.replay, actualRun);
    if (!comparison.passed) {
      replayFixturePatches.push(runtimeReplayFixturePatchCandidate(actualRun, fixture));
      reports.push({
        kind: "runtime-gameplay-replay",
        code: "FERRUM_CONSUMER_RUNTIME_REPLAY_MISMATCH",
        path: comparison.firstMismatch?.path ?? `${RUNTIME_REPLAY_FIXTURE_PATH}.replayHash`,
        message: "Project runtime replay fixture does not match the current runtime capture.",
        expected: comparison.firstMismatch?.expected ?? comparison.expectedHash,
        actual: comparison.firstMismatch?.actual ?? comparison.actualHash,
        suggestion: "If the runtime gameplay change is intentional, run npm run ferrum:update-runtime-replay-fixture and rerun npm run ferrum:runtime-replay-report.",
      });
    }
  } catch (error) {
    reports.push(runtimeReplayReportEntry({
      code: "FERRUM_CONSUMER_RUNTIME_REPLAY_INVALID",
      path: runtimeReplayErrorPath(error),
      message: error instanceof Error ? error.message : String(error),
      expected: "valid project runtime replay fixture and capture",
      actual: "invalid",
      suggestion: "Fix the reported runtime replay path and rerun npm run ferrum:runtime-replay-report.",
    }));
  }

  const ok = reports.length === 0 && comparison?.passed === true;
  const report = {
    format: REPORT_FORMAT,
    version: 1,
    ok,
    runtimeGameplayReplay: {
      configured: true,
      status: ok ? "validated" : (comparison?.passed === false ? "mismatch" : "invalid"),
      scenario: fixture?.scenario ?? RUNTIME_REPLAY_SCENARIO,
      fixture: RUNTIME_REPLAY_FIXTURE_PATH,
      coverageTagDefinitionsPath: fixture?.coverageTagDefinitionsPath ?? RUNTIME_REPLAY_COVERAGE_TAGS_PATH,
      coverageTags: fixture?.coverageTags ?? RUNTIME_REPLAY_COVERAGE_TAGS,
      recipe: TEMPLATE_RUNTIME_REPLAY_RECIPE,
      expectedHash: comparison?.expectedHash ?? fixture?.replay?.replayHash,
      actualHash: comparison?.actualHash ?? actualRun?.replayHash,
      comparison,
      reports,
      ...(replayFixturePatches.length === 0 ? {} : { replayFixturePatches }),
    },
    ...(ok ? {} : { reports }),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!ok) {
    process.exitCode = 1;
  }
}

async function updateRuntimeReplayFixture() {
  if (!PROJECT_RUNTIME_REPLAY_CONFIGURED) {
    console.log(JSON.stringify(notConfiguredReport({ ok: false, updateAttempted: true }), null, 2));
    process.exitCode = 1;
    return;
  }

  const replay = await createProjectRuntimeReplayRun();
  const fixture = runtimeReplayFixture(replay);
  await ensureRuntimeReplayCoverageTags();
  await mkdir(path.dirname(path.join(root, RUNTIME_REPLAY_FIXTURE_PATH)), { recursive: true });
  await writeFile(path.join(root, RUNTIME_REPLAY_FIXTURE_PATH), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(JSON.stringify({
    format: UPDATE_REPORT_FORMAT,
    version: 1,
    ok: true,
    runtimeGameplayReplayFixture: {
      fixture: RUNTIME_REPLAY_FIXTURE_PATH,
      scenario: fixture.scenario,
      coverageTagDefinitionsPath: fixture.coverageTagDefinitionsPath,
      coverageTags: fixture.coverageTags,
      replayHash: replay.replayHash,
      snapshotCount: replay.snapshots.length,
    },
  }, null, 2));
}

async function createProjectRuntimeReplayRun() {
  const {
    createGameplayReplayRun,
    hashGameStateSnapshot,
  } = await import("@ferrum2d/ferrum-web/quality");
  const snapshots = await captureProjectRuntimeSnapshots({ hashGameStateSnapshot });
  return createGameplayReplayRun(snapshots, { path: "runtimeGameplayReplay" });
}

async function captureProjectRuntimeSnapshots({ hashGameStateSnapshot }) {
  const restoreFileUrlFetch = patchFileUrlFetchForNodeWasm();
  let runtimeClock;
  let engine;
  try {
    const {
      captureGameStateSnapshot,
      createEngine,
    } = await import("@ferrum2d/ferrum-web/core");
    const { resolveShooterGameSpec } = await import("@ferrum2d/ferrum-web/starter-scenes");
    const gameSpec = await readJson(path.join(root, "public/game.json"));
    const resolvedGameSpec = resolveShooterGameSpec(gameSpec);
    runtimeClock = createDeterministicFrameClock();
    const inputProvider = createRecipeInputProvider(TEMPLATE_RUNTIME_REPLAY_RECIPE.deterministicRun.inputSequence);
    engine = await createEngine(
      undefined,
      inputProvider.snapshot,
      undefined,
      () => ({ width: resolvedGameSpec.worldWidth, height: resolvedGameSpec.worldHeight }),
    );
    engine.setTextureIds({ player: 0, enemy: 0, bullet: 0 });
    engine.setGameSpec(gameSpec);
    const snapshots = [];
    const captureFrameSet = new Set(TEMPLATE_RUNTIME_REPLAY_RECIPE.deterministicRun.captureFrames);
    const capture = (frame) => {
      snapshots.push(captureGameStateSnapshot(engine, {
        frame,
        includeBuiltInShooterState: true,
        customState: {
          gameSpec: resolvedGameSpec,
          runtime: {
            mode: "headless-engine",
            seed: TEMPLATE_RUNTIME_REPLAY_RECIPE.deterministicRun.seed,
            fixedDelta: TEMPLATE_RUNTIME_REPLAY_RECIPE.deterministicRun.fixedDelta,
            inputSequence: TEMPLATE_RUNTIME_REPLAY_RECIPE.deterministicRun.inputSequence,
            captureFrames: TEMPLATE_RUNTIME_REPLAY_RECIPE.deterministicRun.captureFrames,
            viewport: {
              width: resolvedGameSpec.worldWidth,
              height: resolvedGameSpec.worldHeight,
            },
          },
        },
      }));
    };
    if (captureFrameSet.has(0)) {
      capture(0);
    }
    engine.start();
    runtimeClock.pumpInitialFrame();
    const maxCaptureFrame = Math.max(...TEMPLATE_RUNTIME_REPLAY_RECIPE.deterministicRun.captureFrames);
    for (let frame = 1; frame <= maxCaptureFrame; frame += 1) {
      inputProvider.setFrame(frame);
      runtimeClock.pumpFrame(TEMPLATE_RUNTIME_REPLAY_RECIPE.deterministicRun.fixedDelta);
      if (captureFrameSet.has(frame)) {
        capture(frame);
      }
    }
    return snapshots.map((snapshot) => ({
      ...snapshot,
      snapshotHash: hashGameStateSnapshot(snapshot),
    }));
  } finally {
    if (engine !== undefined) {
      engine.stop();
      engine.destroy();
    }
    runtimeClock?.restore();
    restoreFileUrlFetch();
  }
}

function patchFileUrlFetchForNodeWasm() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = fileUrlFromFetchInput(input);
    if (url?.protocol === "file:") {
      return new Response(await readFile(url), {
        headers: { "Content-Type": "application/wasm" },
      });
    }
    return originalFetch(input, init);
  };
  return () => {
    if (originalFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = originalFetch;
    }
  };
}

function fileUrlFromFetchInput(input) {
  if (input instanceof URL) return input;
  if (typeof input === "string") {
    try {
      return new URL(input);
    } catch {
      return undefined;
    }
  }
  if (input?.url !== undefined) {
    try {
      return new URL(input.url);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function createDeterministicFrameClock() {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const queue = [];
  let nextId = 1;
  let timestampMs = 0;
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextId;
    nextId += 1;
    queue.push({ id, callback });
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    const index = queue.findIndex((entry) => entry.id === id);
    if (index >= 0) queue.splice(index, 1);
  };
  const pump = (nextTimestampMs) => {
    const entry = queue.shift();
    if (entry === undefined) {
      throw new Error("Deterministic runtime replay frame queue is empty.");
    }
    entry.callback(nextTimestampMs);
  };
  return {
    pumpInitialFrame() {
      pump(timestampMs);
    },
    pumpFrame(deltaSeconds) {
      timestampMs += deltaSeconds * 1000;
      pump(timestampMs);
    },
    restore() {
      if (originalRequestAnimationFrame === undefined) {
        delete globalThis.requestAnimationFrame;
      } else {
        globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      }
      if (originalCancelAnimationFrame === undefined) {
        delete globalThis.cancelAnimationFrame;
      } else {
        globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
      }
    },
  };
}

function createRecipeInputProvider(inputSequence) {
  const emptyInput = {
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
  const activeControls = new Set();
  let frame = 0;
  return {
    setFrame(nextFrame) {
      frame = nextFrame;
      for (const event of inputSequence) {
        if (event.frame !== frame) continue;
        if (event.action === "press") {
          activeControls.add(event.control);
        } else if (event.action === "release") {
          activeControls.delete(event.control);
        }
      }
    },
    snapshot() {
      return {
        ...emptyInput,
        enter: activeControls.has("Enter"),
        space: activeControls.has("Space"),
        w: activeControls.has("KeyW") || activeControls.has("ArrowUp"),
        a: activeControls.has("KeyA") || activeControls.has("ArrowLeft"),
        s: activeControls.has("KeyS") || activeControls.has("ArrowDown"),
        d: activeControls.has("KeyD") || activeControls.has("ArrowRight"),
        mouseLeft: activeControls.has("MouseLeft"),
      };
    },
  };
}

async function loadRuntimeReplayFixture() {
  const fixture = await readJson(path.join(root, RUNTIME_REPLAY_FIXTURE_PATH));
  if (fixture.format !== FIXTURE_FORMAT) {
    throw runtimeReplayError(RUNTIME_REPLAY_FIXTURE_PATH, `${RUNTIME_REPLAY_FIXTURE_PATH} format is invalid.`);
  }
  if (fixture.version !== FIXTURE_VERSION) {
    throw runtimeReplayError(RUNTIME_REPLAY_FIXTURE_PATH, `${RUNTIME_REPLAY_FIXTURE_PATH} version must be ${FIXTURE_VERSION}.`);
  }
  if (fixture.scenario !== RUNTIME_REPLAY_SCENARIO) {
    throw runtimeReplayError(`${RUNTIME_REPLAY_FIXTURE_PATH}.scenario`, `Runtime replay scenario must be ${RUNTIME_REPLAY_SCENARIO}.`);
  }
  if (fixture.coverageTagDefinitionsPath !== RUNTIME_REPLAY_COVERAGE_TAGS_PATH) {
    throw runtimeReplayError(`${RUNTIME_REPLAY_FIXTURE_PATH}.coverageTagDefinitionsPath`, `Runtime replay coverage path must be ${RUNTIME_REPLAY_COVERAGE_TAGS_PATH}.`);
  }
  if (!Array.isArray(fixture.coverageTags) || fixture.coverageTags.length === 0) {
    throw runtimeReplayError(`${RUNTIME_REPLAY_FIXTURE_PATH}.coverageTags`, "Runtime replay fixture must include coverageTags.");
  }
  if (fixture.replay === undefined) {
    throw runtimeReplayError(`${RUNTIME_REPLAY_FIXTURE_PATH}.replay`, "Runtime replay fixture must include replay.");
  }
  return fixture;
}

function runtimeReplayFixture(replay) {
  return {
    format: FIXTURE_FORMAT,
    version: FIXTURE_VERSION,
    scenario: RUNTIME_REPLAY_SCENARIO,
    description: "Project-specific deterministic runtime gameplay replay fixture.",
    coverageTagDefinitionsPath: RUNTIME_REPLAY_COVERAGE_TAGS_PATH,
    coverageTags: [...RUNTIME_REPLAY_COVERAGE_TAGS],
    replay,
  };
}

function runtimeReplayFixturePatchCandidate(actualRun, fixture) {
  return {
    kind: "runtime-gameplay-replay-fixture",
    code: "FERRUM_CONSUMER_RUNTIME_REPLAY_FIXTURE_PATCH_CANDIDATE",
    path: RUNTIME_REPLAY_FIXTURE_PATH,
    message: "Current runtime replay capture can be promoted to the project runtime replay fixture.",
    expected: runtimeReplayFixture(actualRun),
    actual: {
      scenario: fixture.scenario,
      replayHash: fixture.replay?.replayHash,
    },
    suggestion: "If the runtime gameplay change is intentional, run npm run ferrum:update-runtime-replay-fixture and rerun npm run ferrum:runtime-replay-report.",
  };
}

async function ensureRuntimeReplayCoverageTags() {
  const file = path.join(root, RUNTIME_REPLAY_COVERAGE_TAGS_PATH);
  if (await exists(file)) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({
    format: COVERAGE_FORMAT,
    version: COVERAGE_VERSION,
    coverageTagDefinitions: {
      "project-runtime": "Project-specific deterministic runtime gameplay replay coverage.",
    },
    coverageTagGroups: {
      runtime: {
        description: "Project runtime replay coverage.",
        tags: ["project-runtime"],
      },
    },
    deprecatedCoverageTags: {},
  }, null, 2)}\n`);
}

function notConfiguredReport({ ok, updateAttempted = false }) {
  const reportEntry = runtimeReplayReportEntry({
    code: "FERRUM_CONSUMER_RUNTIME_REPLAY_NOT_CONFIGURED",
    path: "scripts/ferrum-runtime-replay.mjs",
    message: "Project-specific runtime replay is not configured.",
    expected: "PROJECT_RUNTIME_REPLAY_CONFIGURED = true with deterministic GameStateSnapshot[] capture",
    actual: "not-configured",
    suggestion: "Implement captureProjectRuntimeSnapshots(...), set PROJECT_RUNTIME_REPLAY_CONFIGURED to true, then run npm run ferrum:update-runtime-replay-fixture.",
  });
  return {
    format: REPORT_FORMAT,
    version: 1,
    ok,
    runtimeGameplayReplay: {
      configured: false,
      status: "not-configured",
      scenario: RUNTIME_REPLAY_SCENARIO,
      fixture: RUNTIME_REPLAY_FIXTURE_PATH,
      coverageTagDefinitionsPath: RUNTIME_REPLAY_COVERAGE_TAGS_PATH,
      coverageTags: RUNTIME_REPLAY_COVERAGE_TAGS,
      recipe: TEMPLATE_RUNTIME_REPLAY_RECIPE,
      reports: [reportEntry],
      ...(updateAttempted ? { updateAttempted: true } : {}),
    },
    reports: [reportEntry],
  };
}

function runtimeReplayReportEntry({ code, path, message, expected, actual, suggestion }) {
  return {
    kind: "runtime-gameplay-replay",
    code,
    path,
    message,
    expected,
    actual,
    suggestion,
  };
}

function runtimeReplayError(path, message) {
  const error = new Error(message);
  error.runtimeReplayPath = path;
  return error;
}

function runtimeReplayErrorPath(error) {
  return error?.runtimeReplayPath ?? RUNTIME_REPLAY_FIXTURE_PATH;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
