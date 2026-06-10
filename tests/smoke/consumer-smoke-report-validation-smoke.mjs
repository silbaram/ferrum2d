#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const validatorPath = path.join(repoRoot, "scripts/validate/validate-consumer-smoke-report.mjs");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ferrum2d-consumer-smoke-report-validation-"));

try {
  await assertEarlyFailedReportPasses();
  await assertPartialFailedReportPasses();
  await assertPassedNotConfiguredRuntimeReplayPasses();
  await assertPassedNotConfiguredGameplayReplayPasses();
  await assertPassedMissingCreateGameCatalogFails();
  await assertPassedCatalogMissingRequestedTemplateFails();
  await assertPassedTemplateMatrixMismatchFails();
  await assertDirtySnapshotFails();
  console.log("consumer smoke report validation smoke ok");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function assertEarlyFailedReportPasses() {
  const artifactDir = path.join(tempRoot, "early-failed");
  await mkdir(artifactDir, { recursive: true });
  await writeJson(path.join(artifactDir, "consumer-smoke-report.json"), createFailedReport({
    artifactDir,
    errorMessage: "simulated pack failure before tarballs",
    requestedTemplates: ["minimal"],
  }));
  await runValidatorExpecting(0, ["--artifact-dir", artifactDir, "--expect-status", "failed"], "early failed report");
}

async function assertPartialFailedReportPasses() {
  const artifactDir = path.join(tempRoot, "partial-failed");
  await writePartialFailedArtifact(artifactDir, { includeForbiddenSnapshotDir: false });
  await runValidatorExpecting(0, ["--artifact-dir", artifactDir, "--expect-status", "failed"], "partial failed report");
}

async function assertPassedNotConfiguredRuntimeReplayPasses() {
  const artifactDir = path.join(tempRoot, "passed-not-configured-runtime");
  await mkdir(artifactDir, { recursive: true });
  await writeJson(path.join(artifactDir, "consumer-smoke-report.json"), createPassedReportWithNotConfiguredRuntime({
    artifactDir,
  }));
  await runValidatorExpecting(
    0,
    ["--artifact-dir", artifactDir, "--expect-status", "passed", "--skip-artifacts"],
    "passed report with not-configured runtime replay",
  );
}

async function assertPassedNotConfiguredGameplayReplayPasses() {
  const artifactDir = path.join(tempRoot, "passed-not-configured-gameplay-replay");
  await mkdir(artifactDir, { recursive: true });
  await writeJson(path.join(artifactDir, "consumer-smoke-report.json"), createPassedReportWithNotConfiguredGameplayReplay({
    artifactDir,
  }));
  await runValidatorExpecting(
    0,
    ["--artifact-dir", artifactDir, "--expect-status", "passed", "--skip-artifacts"],
    "passed report with not-configured gameplay replay",
  );
}

async function assertPassedMissingCreateGameCatalogFails() {
  const artifactDir = path.join(tempRoot, "passed-missing-create-game-catalog");
  await mkdir(artifactDir, { recursive: true });
  const report = createPassedReportWithNotConfiguredRuntime({ artifactDir });
  delete report.createGameCatalog;
  await writeJson(path.join(artifactDir, "consumer-smoke-report.json"), report);
  const result = await runValidator(["--artifact-dir", artifactDir, "--expect-status", "passed", "--skip-artifacts"]);
  assert(result.code !== 0, "passed report without createGameCatalog must fail validation");
  assert(
    result.stdout.includes("createGameCatalog must be an object"),
    `missing createGameCatalog validation must be reported\n${result.stdout}\n${result.stderr}`,
  );
}

async function assertPassedCatalogMissingRequestedTemplateFails() {
  const artifactDir = path.join(tempRoot, "passed-catalog-missing-requested-template");
  await mkdir(artifactDir, { recursive: true });
  const report = createPassedReportWithNotConfiguredRuntime({ artifactDir });
  report.createGameCatalog.defaultTemplate = "platformer";
  report.createGameCatalog.templates = [
    {
      id: "platformer",
      sceneAuthoringConfigured: true,
      gameplayReplayConfigured: true,
      runtimeGameplayReplayConfigured: true,
    },
  ];
  await writeJson(path.join(artifactDir, "consumer-smoke-report.json"), report);
  const result = await runValidator(["--artifact-dir", artifactDir, "--expect-status", "passed", "--skip-artifacts"]);
  assert(result.code !== 0, "passed report whose catalog misses a requested template must fail validation");
  assert(
    result.stdout.includes("createGameCatalog.templates must include requested template minimal"),
    `missing requested template validation must be reported\n${result.stdout}\n${result.stderr}`,
  );
}

async function assertPassedTemplateMatrixMismatchFails() {
  const artifactDir = path.join(tempRoot, "passed-template-matrix-mismatch");
  await mkdir(artifactDir, { recursive: true });
  const report = createPassedReportWithNotConfiguredRuntime({ artifactDir });
  report.templates[0].template = "platformer";
  await writeJson(path.join(artifactDir, "consumer-smoke-report.json"), report);
  const result = await runValidator(["--artifact-dir", artifactDir, "--expect-status", "passed", "--skip-artifacts"]);
  assert(result.code !== 0, "passed report whose templates[] differ from requestedTemplates must fail validation");
  assert(
    result.stdout.includes("passed report templates must include requested template minimal") &&
      result.stdout.includes("passed report templates must not include unrequested template platformer"),
    `template matrix mismatch validation must be reported\n${result.stdout}\n${result.stderr}`,
  );
}

async function assertDirtySnapshotFails() {
  const artifactDir = path.join(tempRoot, "dirty-failed");
  await writePartialFailedArtifact(artifactDir, { includeForbiddenSnapshotDir: true });
  const result = await runValidator(["--artifact-dir", artifactDir, "--expect-status", "failed"]);
  assert(result.code !== 0, "dirty failed snapshot validation must fail");
  assert(
    result.stdout.includes("node_modules"),
    `dirty failed snapshot validation must report node_modules\n${result.stdout}\n${result.stderr}`,
  );
}

async function writePartialFailedArtifact(artifactDir, { includeForbiddenSnapshotDir }) {
  await mkdir(path.join(artifactDir, "tarballs"), { recursive: true });
  await mkdir(path.join(artifactDir, "tool-consumer"), { recursive: true });
  await mkdir(path.join(artifactDir, "sample-games/topdown"), { recursive: true });
  await writeFile(path.join(artifactDir, "tarballs/ferrum2d-ferrum-web-0.1.0.tgz"), "");
  await writeFile(path.join(artifactDir, "tarballs/ferrum2d-create-game-0.1.0.tgz"), "");
  await writeFile(path.join(artifactDir, "tarballs/ferrum2d-agents-0.1.0.tgz"), "");
  await writeJson(path.join(artifactDir, "tool-consumer/package.json"), {
    name: "tool-consumer",
  });
  await writeJson(path.join(artifactDir, "sample-games/topdown/package.json"), {
    name: "topdown",
  });
  if (includeForbiddenSnapshotDir) {
    await mkdir(path.join(artifactDir, "sample-games/topdown/node_modules/@ferrum2d"), { recursive: true });
    await writeFile(path.join(artifactDir, "sample-games/topdown/node_modules/@ferrum2d/marker"), "");
  }
  await writeJson(path.join(artifactDir, "consumer-smoke-report.json"), createFailedReport({
    artifactDir,
    errorMessage: "simulated template failure after generated project install",
    requestedTemplates: ["topdown", "platformer"],
    tarballs: {
      ferrumWeb: "ferrum2d-ferrum-web-0.1.0.tgz",
      createGame: "ferrum2d-create-game-0.1.0.tgz",
      agents: "ferrum2d-agents-0.1.0.tgz",
    },
    templates: [
      {
        template: "topdown",
        status: "failed",
        generatedProject: "sample-games/topdown",
        checks: {
          createGame: true,
          agentsDryRun: true,
          agentsInstall: true,
          install: true,
          publicImportSmoke: true,
          publicTypeSmoke: false,
          validate: false,
          build: false,
        },
        agents: {
          tools: ["codex", "claude", "gemini"],
          expectedFilesChecked: 41,
          unsupportedGeminiWrappersAbsent: true,
        },
        reports: {},
        mutationChecks: {},
        buildOutput: {},
        error: {
          name: "Error",
          message: "simulated type smoke failure",
        },
      },
    ],
  }));
}

function createFailedReport({
  artifactDir,
  errorMessage,
  requestedTemplates,
  tarballs = {},
  templates = [],
}) {
  return {
    format: "ferrum2d.package.consumer-smoke.report",
    version: 1,
    status: "failed",
    startedAt: "2026-06-06T00:00:00.000Z",
    completedAt: "2026-06-06T00:00:01.000Z",
    durationMs: 1000,
    packageManager: "pnpm@10.8.0",
    installMode: "online",
    options: {
      skipBuild: false,
      skipPackageCheck: false,
      keepTemp: false,
      artifactDir,
      commandTimeoutMs: 300000,
    },
    tarballs,
    templates,
    requestedTemplates,
    artifactDir,
    error: {
      name: "Error",
      message: errorMessage,
    },
  };
}

function createPassedReportWithNotConfiguredRuntime({ artifactDir }) {
  return {
    format: "ferrum2d.package.consumer-smoke.report",
    version: 1,
    status: "passed",
    startedAt: "2026-06-06T00:00:00.000Z",
    completedAt: "2026-06-06T00:00:01.000Z",
    durationMs: 1000,
    packageManager: "pnpm@10.8.0",
    installMode: "online",
    options: {
      skipBuild: false,
      skipPackageCheck: false,
      keepTemp: false,
      artifactDir,
      commandTimeoutMs: 300000,
    },
    tarballs: {
      ferrumWeb: "ferrum2d-ferrum-web-0.1.0.tgz",
      createGame: "ferrum2d-create-game-0.1.0.tgz",
      agents: "ferrum2d-agents-0.1.0.tgz",
    },
    createGameCatalog: {
      format: "ferrum-create-game-template-list",
      version: 1,
      defaultTemplate: "minimal",
      templateCount: 1,
      templates: [
        {
          id: "minimal",
          sceneAuthoringConfigured: true,
          gameplayReplayConfigured: true,
          runtimeGameplayReplayConfigured: false,
        },
      ],
    },
    requestedTemplates: ["minimal"],
    templates: [
      {
        template: "minimal",
        status: "passed",
        generatedProject: "sample-games/minimal",
        checks: {
          createGame: true,
          agentsDryRun: true,
          agentsInstall: true,
          install: true,
          publicImportSmoke: true,
          publicTypeSmoke: true,
          validate: true,
          build: true,
        },
        agents: {
          tools: ["codex", "claude", "gemini"],
          expectedFilesChecked: 41,
          unsupportedGeminiWrappersAbsent: true,
        },
        reports: {
          authoring: {
            status: "not-configured",
            gameSpec: {
              ok: null,
              message: "public/game.json not present",
            },
            diagnostics: 0,
            reports: 0,
          },
          gameplayReplay: {
            status: "validated",
            configured: true,
            scenario: "minimal-template-surface",
            fixture: "public/gameplay-replay.fixture.json",
            coverageTags: ["starter-runtime-template"],
            expectedHash: "abc123",
            actualHash: "abc123",
            comparisonPassed: true,
            reports: 0,
          },
          runtimeReplay: {
            status: "not-configured",
            configured: false,
            scenario: "project-runtime",
            fixture: "public/gameplay-runtime-replay.fixture.json",
            coverageTags: ["project-runtime"],
            reports: 1,
          },
          runtimeReplayRecipe: {
            template: "minimal",
            status: "scaffold",
            scenario: "project-runtime",
            coverageTags: ["project-runtime"],
            fixedDelta: 1 / 60,
            inputFrames: [1, 2],
            captureFrames: [0, 1, 2],
          },
        },
        mutationChecks: {},
        buildOutput: {
          distIndexHtml: "sample-games/minimal/dist/index.html",
          preservedInArtifactSnapshot: false,
        },
      },
    ],
  };
}

function createPassedReportWithNotConfiguredGameplayReplay({ artifactDir }) {
  const report = createPassedReportWithNotConfiguredRuntime({ artifactDir });
  report.createGameCatalog.templateCount = 2;
  report.createGameCatalog.templates.push({
    id: "prototype",
    sceneAuthoringConfigured: false,
    gameplayReplayConfigured: false,
    runtimeGameplayReplayConfigured: false,
  });
  report.requestedTemplates.push("prototype");
  report.templates.push({
    template: "prototype",
    status: "passed",
    generatedProject: "sample-games/prototype",
    checks: {
      createGame: true,
      agentsDryRun: true,
      agentsInstall: true,
      install: true,
      publicImportSmoke: true,
      publicTypeSmoke: true,
      validate: true,
      build: true,
    },
    agents: {
      tools: ["codex", "claude", "gemini"],
      expectedFilesChecked: 41,
      unsupportedGeminiWrappersAbsent: true,
    },
    reports: {
      authoring: {
        status: "not-configured",
        gameSpec: {
          ok: null,
          message: "public/game.json not present",
        },
        diagnostics: 0,
        reports: 0,
      },
      gameplayReplay: {
        status: "not-configured",
        configured: false,
        fixture: "public/gameplay-replay.fixture.json",
        reports: 1,
      },
      gameplayReplayFixtureUpdate: {
        status: "not-configured",
        rejected: true,
      },
      runtimeReplay: {
        status: "not-configured",
        configured: false,
        scenario: "project-runtime",
        fixture: "public/gameplay-runtime-replay.fixture.json",
        coverageTags: ["project-runtime"],
        reports: 1,
      },
      runtimeReplayRecipe: {
        template: "prototype",
        status: "scaffold",
        scenario: "project-runtime",
        coverageTags: ["project-runtime"],
        fixedDelta: 1 / 60,
        inputFrames: [1, 2],
        captureFrames: [0, 1, 2],
      },
    },
    mutationChecks: {},
    buildOutput: {
      distIndexHtml: "sample-games/prototype/dist/index.html",
      preservedInArtifactSnapshot: false,
    },
  });
  return report;
}

async function runValidatorExpecting(expectedCode, args, label) {
  const result = await runValidator(args);
  assert(
    result.code === expectedCode,
    `${label} validation exit code ${result.code}, expected ${expectedCode}\n${result.stdout}\n${result.stderr}`,
  );
}

async function runValidator(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [validatorPath, ...args], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
