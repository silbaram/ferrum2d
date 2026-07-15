#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEPLOYMENT_RUNTIME_SAMPLE_FRAMES } from "./runtime-budget-profiles.mjs";

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
  await assertPassedDeploymentEvidenceMissingFails();
  await assertPassedPlacementViewerEvidenceMissingFails();
  await assertPassedDeploymentSamplingEvidenceInvalidFails();
  await assertPassedDeploymentShortSamplingEvidenceFails();
  await assertPassedDeploymentUnknownBudgetProfileFails();
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

async function assertPassedDeploymentEvidenceMissingFails() {
  const artifactDir = path.join(tempRoot, "passed-deployment-evidence-missing");
  await mkdir(artifactDir, { recursive: true });
  const report = createPassedReportWithNotConfiguredRuntime({ artifactDir });
  delete report.templates[0].reports.deployment.checks.smokeBasePath;
  delete report.templates[0].reports.deploymentBrowser.runtime;
  await writeJson(path.join(artifactDir, "consumer-smoke-report.json"), report);
  const result = await runValidator(["--artifact-dir", artifactDir, "--expect-status", "passed", "--skip-artifacts"]);
  assert(result.code !== 0, "passed report without deployment subpath/runtime evidence must fail validation");
  assert(
    result.stdout.includes("checks.smokeBasePath must be /__ferrum2d_deploy_smoke__/")
      && result.stdout.includes("reports.deploymentBrowser.runtime must be an object"),
    `missing deployment evidence validation must be reported\n${result.stdout}\n${result.stderr}`,
  );
}

async function assertPassedPlacementViewerEvidenceMissingFails() {
  const artifactDir = path.join(tempRoot, "passed-placement-viewer-evidence-missing");
  await mkdir(artifactDir, { recursive: true });
  const report = createPassedReportWithNotConfiguredRuntime({ artifactDir });
  delete report.templates[0].checks.placementViewerSmoke;
  delete report.templates[0].reports.placementViewer;
  delete report.templates[0].buildOutput.distPlacementViewerHtml;
  await writeJson(path.join(artifactDir, "consumer-smoke-report.json"), report);
  const result = await runValidator(["--artifact-dir", artifactDir, "--expect-status", "passed", "--skip-artifacts"]);
  assert(result.code !== 0, "passed report without placement viewer evidence must fail validation");
  assert(
    result.stdout.includes("checks.placementViewerSmoke must be a boolean")
      && result.stdout.includes("reports.placementViewer must be an object")
      && result.stdout.includes("buildOutput.distPlacementViewerHtml must point to dist/placement-viewer.html"),
    `missing placement viewer evidence validation must be reported\n${result.stdout}\n${result.stderr}`,
  );
}

async function assertPassedDeploymentSamplingEvidenceInvalidFails() {
  const artifactDir = path.join(tempRoot, "passed-deployment-sampling-evidence-invalid");
  await mkdir(artifactDir, { recursive: true });
  const report = createPassedReportWithNotConfiguredRuntime({ artifactDir });
  report.templates[0].reports.deploymentBrowser.runtime.sampledFrameCount = 1;
  report.templates[0].reports.deploymentBrowser.runtime.statsSource = "renderCommands";
  report.templates[0].reports.deploymentBrowser.budgets.sampleFrames = 1;
  report.templates[0].reports.deploymentBrowser.budgets.maxDrawCalls = 64;
  await writeJson(path.join(artifactDir, "consumer-smoke-report.json"), report);
  const result = await runValidator(["--artifact-dir", artifactDir, "--expect-status", "passed", "--skip-artifacts"]);
  assert(result.code !== 0, "passed report with single-frame or non-profile deployment budget evidence must fail validation");
  assert(
    result.stdout.includes(`runtime.sampledFrameCount must be ${DEPLOYMENT_RUNTIME_SAMPLE_FRAMES}`)
      && result.stdout.includes("runtime.statsSource must be renderer.stats-after-frame")
      && result.stdout.includes(`budgets.sampleFrames must be ${DEPLOYMENT_RUNTIME_SAMPLE_FRAMES}`)
      && result.stdout.includes("budgets.maxDrawCalls must match runtime budget profile minimal (8)"),
    `invalid deployment sampling evidence must be reported\n${result.stdout}\n${result.stderr}`,
  );
}

async function assertPassedDeploymentShortSamplingEvidenceFails() {
  const artifactDir = path.join(tempRoot, "passed-deployment-short-sampling-evidence");
  await mkdir(artifactDir, { recursive: true });
  const report = createPassedReportWithNotConfiguredRuntime({ artifactDir });
  report.templates[0].reports.deploymentBrowser.runtime.sampledFrameCount = 8;
  report.templates[0].reports.deploymentBrowser.budgets.sampleFrames = 8;
  await writeJson(path.join(artifactDir, "consumer-smoke-report.json"), report);
  const result = await runValidator(["--artifact-dir", artifactDir, "--expect-status", "passed", "--skip-artifacts"]);
  assert(result.code !== 0, "passed report with fewer than the canonical deployment sample frames must fail validation");
  assert(
    result.stdout.includes(`runtime.sampledFrameCount must be ${DEPLOYMENT_RUNTIME_SAMPLE_FRAMES}`)
      && result.stdout.includes(`budgets.sampleFrames must be ${DEPLOYMENT_RUNTIME_SAMPLE_FRAMES}`),
    `short deployment sampling evidence must be reported\n${result.stdout}\n${result.stderr}`,
  );
}

async function assertPassedDeploymentUnknownBudgetProfileFails() {
  const artifactDir = path.join(tempRoot, "passed-deployment-unknown-budget-profile");
  await mkdir(artifactDir, { recursive: true });
  const report = createPassedReportWithNotConfiguredRuntime({ artifactDir });
  const templateName = "unknown-template";
  report.requestedTemplates = [templateName];
  report.createGameCatalog.defaultTemplate = templateName;
  report.createGameCatalog.templates[0].id = templateName;
  report.templates[0].template = templateName;
  report.templates[0].reports.deploymentBrowser.budgets.profileId = templateName;
  report.templates[0].reports.deploymentBrowser.budgets.maxDrawCalls = 999;
  await writeJson(path.join(artifactDir, "consumer-smoke-report.json"), report);
  const result = await runValidator(["--artifact-dir", artifactDir, "--expect-status", "passed", "--skip-artifacts"]);
  assert(result.code !== 0, "passed report with an unknown deployment runtime budget profile must fail validation");
  assert(
    result.stdout.includes(`budgets.profileId must reference known runtime budget profile ${templateName}`),
    `unknown deployment budget profile must be reported\n${result.stdout}\n${result.stderr}`,
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
  await writeFile(path.join(artifactDir, "tarballs/ferrum2d-authoring-viewer-0.1.0.tgz"), "");
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
      authoringViewer: "ferrum2d-authoring-viewer-0.1.0.tgz",
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
          report: false,
          smoke: false,
          build: false,
          deployReport: false,
          deployBrowserSmoke: false,
          placementViewerSmoke: false,
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
      authoringViewer: "ferrum2d-authoring-viewer-0.1.0.tgz",
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
          report: true,
          smoke: true,
          build: true,
          deployReport: true,
          deployBrowserSmoke: true,
          placementViewerSmoke: true,
        },
        agents: {
          tools: ["codex", "claude", "gemini"],
          expectedFilesChecked: 41,
          unsupportedGeminiWrappersAbsent: true,
        },
        reports: {
          project: projectReportSummary("minimal"),
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
          deployment: deploymentReportSummary(),
          deploymentBrowser: deploymentBrowserSummary("minimal"),
          placementViewer: placementViewerSummary("minimal"),
        },
        mutationChecks: {},
        buildOutput: {
          distIndexHtml: "sample-games/minimal/dist/index.html",
          distPlacementViewerHtml: "sample-games/minimal/dist/placement-viewer.html",
          deployReady: true,
          browserSmoke: true,
          preservedInArtifactSnapshot: false,
        },
      },
    ],
  };
}

function createPassedReportWithNotConfiguredGameplayReplay({ artifactDir }) {
  const report = createPassedReportWithNotConfiguredRuntime({ artifactDir });
  const templateName = "platformer";
  report.createGameCatalog.templateCount = 2;
  report.createGameCatalog.templates.push({
    id: templateName,
    sceneAuthoringConfigured: false,
    gameplayReplayConfigured: false,
    runtimeGameplayReplayConfigured: false,
  });
  report.requestedTemplates.push(templateName);
  report.templates.push({
    template: templateName,
    status: "passed",
    generatedProject: `sample-games/${templateName}`,
    checks: {
      createGame: true,
      agentsDryRun: true,
      agentsInstall: true,
      install: true,
      publicImportSmoke: true,
      publicTypeSmoke: true,
      validate: true,
      report: true,
      smoke: true,
      build: true,
      deployReport: true,
      deployBrowserSmoke: true,
      placementViewerSmoke: true,
    },
    agents: {
      tools: ["codex", "claude", "gemini"],
      expectedFilesChecked: 41,
      unsupportedGeminiWrappersAbsent: true,
    },
    reports: {
      project: projectReportSummary(templateName),
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
        template: templateName,
        status: "scaffold",
        scenario: "project-runtime",
        coverageTags: ["project-runtime"],
        fixedDelta: 1 / 60,
        inputFrames: [1, 2],
        captureFrames: [0, 1, 2],
      },
      deployment: deploymentReportSummary(),
      deploymentBrowser: deploymentBrowserSummary(templateName),
      placementViewer: placementViewerSummary(templateName),
    },
    mutationChecks: {},
    buildOutput: {
      distIndexHtml: `sample-games/${templateName}/dist/index.html`,
      distPlacementViewerHtml: `sample-games/${templateName}/dist/placement-viewer.html`,
      deployReady: true,
      browserSmoke: true,
      preservedInArtifactSnapshot: false,
    },
  });
  return report;
}

function projectReportSummary(templateName) {
  return {
    status: "validated",
    packageName: templateName,
    authoringViewer: "file:../tarballs/ferrum2d-authoring-viewer-0.1.0.tgz",
    ferrumWeb: "file:../tarballs/ferrum2d-ferrum-web-0.1.0.tgz",
    files: {
      main: true,
      gameSpec: templateName === "topdown" ? "public/game.json" : null,
      sceneAuthoring: "public/scene-authoring.json",
    },
    internalImports: 0,
    rootAggregateImports: 0,
    deployment: {
      target: "static-web",
      outputDirectory: "dist",
      basePath: "relative",
      fileProtocolSupported: false,
    },
    recommendedCommands: [
      "npm run ferrum:report",
      "npm run ferrum:validate",
      "npm run ferrum:authoring-report",
      "npm run ferrum:replay-report",
      "npm run ferrum:runtime-replay-report",
      "npm run ferrum:smoke",
      "npm run ferrum:deploy-report",
      "npm run build",
      "npm run preview",
    ],
    reports: 0,
    errors: 0,
  };
}

function deploymentReportSummary() {
  return {
    status: "ready",
    target: "static-web",
    outputDirectory: "dist",
    basePath: "relative",
    fileProtocolSupported: false,
    recommendedProtocol: "http(s)",
    checks: {
      build: true,
      indexHtml: true,
      relativeAssetReferences: true,
      referencedFiles: true,
      httpServe: true,
      previewHttp: true,
      wasmMime: true,
      smokeBasePath: "/__ferrum2d_deploy_smoke__/",
      servedFileCount: 8,
      wasmFileCount: 1,
    },
    reports: 0,
    errors: 0,
  };
}

function deploymentBrowserSummary(templateName) {
  const maxDrawCalls = templateName === "minimal" ? 8 : 16;
  return {
    status: "validated",
    basePath: "/__ferrum2d_consumer_smoke__/",
    indexStatus: 200,
    canvas: {
      width: 960,
      height: 540,
      webgl2: true,
      nonblank: true,
      coloredPixelSamples: 64,
      varyingPixelSamples: 16,
      readbackSource: "same-raf-after-render",
    },
    runtime: {
      gameState: 1,
      entityCount: 8,
      spriteCount: 8,
      renderCommandCount: 8,
      drawCalls: 1,
      sampledFrameCount: DEPLOYMENT_RUNTIME_SAMPLE_FRAMES,
      statsSource: "renderer.stats-after-frame",
    },
    budgets: {
      profileId: templateName,
      sampleFrames: DEPLOYMENT_RUNTIME_SAMPLE_FRAMES,
      maxDrawCalls,
    },
    wasmLoaded: true,
    wasmMimeValid: true,
    wasmResponseCount: 1,
    browserErrors: 0,
  };
}

function placementViewerSummary(templateName) {
  const definitionId = `consumer-${templateName}-definition`;
  return {
    status: "validated",
    projectAssets: ["atlas"],
    instanceCount: 4,
    objectDefinitionCount: 1,
    selectedInstanceId: `selected-${templateName}`,
    draftOperationCount: 3,
    addedInstanceId: `sprite-${templateName}`,
    addedPrefab: "object",
    addedAsset: "atlas",
    objectDefinitionId: definitionId,
    objectDefinitionVisualKind: "sprite",
    objectDefinitionInstanceId: `definition-instance-${templateName}`,
    objectDefinitionInstancePrefab: definitionId,
    behaviorBinding: {
      targetInstanceId: `target-${templateName}`,
      recipeId: `recipe-${templateName}`,
      mode: "attach-detach",
      attachOperationKind: "updateBehaviorBinding",
      cleared: true,
    },
    handoffUi: {
      draftCount: "3",
      blockedReferenceCount: "0",
      assetDiagnosticCount: "0",
      copyPatchDisabled: false,
      copyHandoffDisabled: false,
      saveDraftDisabled: false,
      status: "3 patch operations ready",
    },
    inspectorUi: {
      groups: ["identity", "visual", "collider", "behavior"],
      selectedId: `selected-${templateName}`,
      selectedPrefab: definitionId,
      visual: "atlas 48x48",
      collider: "aabb 48x48",
      behaviorProfiles: "none",
    },
  };
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
