#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageRoots = {
  ferrumWeb: path.join(repoRoot, "packages/ferrum-web"),
  createGame: path.join(repoRoot, "packages/create-game"),
  agents: path.join(repoRoot, "packages/agents"),
};
const repoPackageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const packageManager = repoPackageJson.packageManager ?? "pnpm@10.8.0";
const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const CONSUMER_SMOKE_REPORT_FORMAT = "ferrum2d.package.consumer-smoke.report";
const CONSUMER_SMOKE_REPORT_VERSION = 1;
const AGENT_INSTALL_EXPECTED_FILES = Object.freeze([
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".agents/harness/ferrum-game-development.md",
  ".agents/harness/ferrum-runtime-replay.md",
  ".agents/skills/ferrum-consumer-asset-pipeline/SKILL.md",
  ".agents/skills/ferrum-consumer-architecture/SKILL.md",
  ".agents/skills/ferrum-consumer-build/SKILL.md",
  ".agents/skills/ferrum-consumer-game-spec/SKILL.md",
  ".agents/skills/ferrum-consumer-gameplay/SKILL.md",
  ".agents/skills/ferrum-consumer-playtest/SKILL.md",
  ".agents/skills/ferrum-consumer-project/SKILL.md",
  ".codex/agents/consumer-architecture-agent.toml",
  ".codex/config.toml",
  ".codex/agents/consumer-asset-agent.toml",
  ".codex/agents/consumer-build-agent.toml",
  ".codex/agents/consumer-game-spec-agent.toml",
  ".codex/agents/consumer-gameplay-agent.toml",
  ".codex/agents/consumer-playtest-agent.toml",
  ".codex/agents/consumer-project-agent.toml",
  ".claude/agents/consumer-architecture-agent.md",
  ".claude/agents/consumer-asset-agent.md",
  ".claude/agents/consumer-build-agent.md",
  ".claude/agents/consumer-game-spec-agent.md",
  ".claude/agents/consumer-gameplay-agent.md",
  ".claude/agents/consumer-playtest-agent.md",
  ".claude/agents/consumer-project-agent.md",
  ".claude/skills/ferrum-consumer-asset-pipeline/SKILL.md",
  ".claude/skills/ferrum-consumer-architecture/SKILL.md",
  ".claude/skills/ferrum-consumer-build/SKILL.md",
  ".claude/skills/ferrum-consumer-game-spec/SKILL.md",
  ".claude/skills/ferrum-consumer-gameplay/SKILL.md",
  ".claude/skills/ferrum-consumer-playtest/SKILL.md",
  ".claude/skills/ferrum-consumer-project/SKILL.md",
  ".gemini/commands/ferrum/architecture.toml",
  ".gemini/commands/ferrum/assets.toml",
  ".gemini/commands/ferrum/build.toml",
  ".gemini/commands/ferrum/game-spec.toml",
  ".gemini/commands/ferrum/gameplay.toml",
  ".gemini/commands/ferrum/playtest.toml",
  ".gemini/commands/ferrum/project.toml",
]);
const templateCatalog = JSON.parse(await readFile(path.join(packageRoots.createGame, "templates/manifest.json"), "utf8"));
const templateCatalogEntries = validateTemplateCatalog(templateCatalog);
const templateCatalogById = new Map(templateCatalogEntries.map((template) => [template.id, template]));

const options = parseArgs(process.argv.slice(2));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const installArgs = [
  "install",
  "--ignore-scripts",
  "--frozen-lockfile=false",
  ...(options.offline ? ["--offline"] : []),
];

let tempRoot;
let ferrumWebTarball;
let createGameTarball;
let agentsTarball;
const smokeStartedAt = new Date();
const templateSummaries = [];

if (options.help) {
  printHelp();
  process.exit(0);
}

const templateNames = await resolveTemplateMatrix(options.templates);

try {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ferrum2d-consumer-smoke-"));
  const tarballRoot = path.join(tempRoot, "tarballs");
  const toolConsumerRoot = path.join(tempRoot, "tool-consumer");
  const generatedGamesRoot = path.join(tempRoot, "sample-games");

  if (!options.skipBuild) {
    await runRequired(pnpm, ["build:wasm"], repoRoot);
    await runRequired(pnpm, ["--filter", "@ferrum2d/ferrum-web", "build"], repoRoot);
  }

  if (!options.skipPackageCheck) {
    await runRequired(process.execPath, [
      path.join(repoRoot, "scripts/package/check-package-files.mjs"),
      "--require-wasm-pkg",
      "--verify-pack",
    ], repoRoot);
    await runRequired(process.execPath, [
      path.join(repoRoot, "scripts/package/check-create-game-package.mjs"),
      "--verify-pack",
    ], repoRoot);
    await runRequired(process.execPath, [
      path.join(repoRoot, "scripts/package/check-agents-package.mjs"),
      "--verify-pack",
    ], repoRoot);
  }

  await mkdir(tarballRoot, { recursive: true });
  ferrumWebTarball = await packPackage(packageRoots.ferrumWeb, tarballRoot);
  createGameTarball = await packPackage(packageRoots.createGame, tarballRoot);
  agentsTarball = await packPackage(packageRoots.agents, tarballRoot);

  await writeToolConsumerPackage(toolConsumerRoot, {
    createGameTarball,
    agentsTarball,
  });
  await runRequired(pnpm, installArgs, toolConsumerRoot);

  for (const templateName of templateNames) {
    const templateSummary = createTemplateSummary(templateName);
    templateSummaries.push(templateSummary);
    try {
      await runGeneratedGameConsumer({
        ferrumWebTarball,
        generatedGamesRoot,
        templateName,
        templateSummary,
        toolConsumerRoot,
      });
      templateSummary.status = "passed";
    } catch (error) {
      templateSummary.status = "failed";
      templateSummary.error = describeError(error);
      throw error;
    }
  }

  const report = buildConsumerSmokeReport({ status: "passed" });
  await writeConsumerSmokeArtifacts(report);
  console.log("package consumer smoke ok");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeConsumerSmokeArtifacts(buildConsumerSmokeReport({
    status: "failed",
    error: describeError(error),
  }));
  throw error;
} finally {
  if (tempRoot && !options.keepTemp) {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function parseArgs(args) {
  const parsed = {
    help: false,
    keepTemp: false,
    offline: false,
    skipBuild: false,
    skipPackageCheck: false,
    templates: undefined,
    artifactDir: process.env.FERRUM_CONSUMER_SMOKE_ARTIFACT_DIR,
    commandTimeoutMs: optionalPositiveIntegerEnv(process.env.FERRUM_CONSUMER_SMOKE_COMMAND_TIMEOUT_MS)
      ?? DEFAULT_COMMAND_TIMEOUT_MS,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--keep-temp") {
      parsed.keepTemp = true;
    } else if (arg === "--offline") {
      parsed.offline = true;
    } else if (arg === "--no-offline") {
      parsed.offline = false;
    } else if (arg === "--skip-build") {
      parsed.skipBuild = true;
    } else if (arg === "--skip-package-check") {
      parsed.skipPackageCheck = true;
    } else if (arg.startsWith("--templates=")) {
      parsed.templates = parseTemplateList(arg.slice("--templates=".length));
    } else if (arg === "--templates") {
      const next = args[index + 1];
      assert(next, "--templates requires a comma-separated template list");
      parsed.templates = parseTemplateList(next);
      index += 1;
    } else if (arg.startsWith("--artifact-dir=")) {
      parsed.artifactDir = arg.slice("--artifact-dir=".length);
    } else if (arg === "--artifact-dir") {
      const next = args[index + 1];
      assert(next, "--artifact-dir requires a path");
      parsed.artifactDir = next;
      index += 1;
    } else if (arg.startsWith("--command-timeout-ms=")) {
      parsed.commandTimeoutMs = parsePositiveInteger(arg.slice("--command-timeout-ms=".length), "--command-timeout-ms");
    } else if (arg === "--command-timeout-ms") {
      const next = args[index + 1];
      assert(next, "--command-timeout-ms requires a positive integer");
      parsed.commandTimeoutMs = parsePositiveInteger(next, "--command-timeout-ms");
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

function parseTemplateList(value) {
  const templates = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  assert(templates.length > 0, "--templates must include at least one template name");
  return [...new Set(templates)];
}

function optionalPositiveIntegerEnv(value) {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return parsePositiveInteger(value, "FERRUM_CONSUMER_SMOKE_COMMAND_TIMEOUT_MS");
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  assert(Number.isInteger(parsed) && parsed > 0, `${label} must be a positive integer`);
  return parsed;
}

async function resolveTemplateMatrix(requestedTemplates) {
  const availableTemplates = templateCatalogEntries.map((template) => template.id);
  await assertTemplateCatalogMatchesDirectories(availableTemplates);
  if (requestedTemplates === undefined) {
    return availableTemplates;
  }

  const unknown = requestedTemplates.filter((templateName) => !availableTemplates.includes(templateName));
  assert(
    unknown.length === 0,
    `unknown create-game template(s): ${unknown.join(", ")}. Available: ${availableTemplates.join(", ")}`,
  );
  return requestedTemplates;
}

function validateTemplateCatalog(catalog) {
  assert(
    catalog !== null && typeof catalog === "object" && !Array.isArray(catalog),
    "create-game template manifest must be an object",
  );
  assert(Array.isArray(catalog.templates), "create-game template manifest must include templates[]");
  assert(catalog.templates.length > 0, "create-game template manifest must include at least one template");
  const seen = new Set();
  for (const [index, template] of catalog.templates.entries()) {
    assert(
      template !== null && typeof template === "object" && !Array.isArray(template),
      `create-game template manifest templates.${index} must be an object`,
    );
    assert(typeof template.id === "string" && template.id.length > 0, `create-game template manifest templates.${index}.id must be a non-empty string`);
    assert(!seen.has(template.id), `create-game template manifest includes duplicate template id '${template.id}'`);
    seen.add(template.id);
  }
  return catalog.templates;
}

async function assertTemplateCatalogMatchesDirectories(catalogTemplateIds) {
  const directoryTemplateIds = await listCreateGameTemplateDirectories();
  const manifestOnly = catalogTemplateIds.filter((templateName) => !directoryTemplateIds.includes(templateName));
  const directoryOnly = directoryTemplateIds.filter((templateName) => !catalogTemplateIds.includes(templateName));
  assert(
    manifestOnly.length === 0 && directoryOnly.length === 0,
    [
      "create-game template manifest must match template directories",
      manifestOnly.length > 0 ? `manifest-only: ${manifestOnly.join(", ")}` : undefined,
      directoryOnly.length > 0 ? `directory-only: ${directoryOnly.join(", ")}` : undefined,
    ].filter(Boolean).join("; "),
  );
}

async function listCreateGameTemplateDirectories() {
  const entries = await readdir(path.join(packageRoots.createGame, "templates"), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function runGeneratedGameConsumer({
  ferrumWebTarball,
  generatedGamesRoot,
  templateName,
  templateSummary,
  toolConsumerRoot,
}) {
  const generatedGameRoot = path.join(generatedGamesRoot, templateName);
  templateSummary.generatedProject = path.relative(tempRoot, generatedGameRoot);
  await runRequired(pnpm, [
    "exec",
    "create-ferrum2d-game",
    generatedGameRoot,
    "--template",
    templateName,
    "--ferrum-version",
    fileDependency(ferrumWebTarball),
  ], toolConsumerRoot);
  templateSummary.checks.createGame = true;
  await pinGeneratedPackageManager(generatedGameRoot);

  await runRequired(pnpm, [
    "exec",
    "ferrum2d-agents",
    "init",
    "--target",
    generatedGameRoot,
    "--tools",
    "codex,claude,gemini",
    "--dry-run",
  ], toolConsumerRoot);
  await assertMissing(path.join(generatedGameRoot, ".agents"), "agents dry-run must not create .agents");
  await assertMissing(path.join(generatedGameRoot, ".codex"), "agents dry-run must not create .codex");
  await assertMissing(path.join(generatedGameRoot, ".claude"), "agents dry-run must not create .claude");
  await assertMissing(path.join(generatedGameRoot, ".gemini"), "agents dry-run must not create .gemini");
  templateSummary.checks.agentsDryRun = true;
  await runRequired(pnpm, [
    "exec",
    "ferrum2d-agents",
    "init",
    "--target",
    generatedGameRoot,
    "--tools",
    "codex,claude,gemini",
  ], toolConsumerRoot);
  await assertGeneratedAgentsInstall(generatedGameRoot, templateName);
  templateSummary.checks.agentsInstall = true;
  templateSummary.agents = {
    tools: ["codex", "claude", "gemini"],
    expectedFilesChecked: AGENT_INSTALL_EXPECTED_FILES.length,
    unsupportedGeminiWrappersAbsent: true,
  };

  await runRequired(pnpm, installArgs, generatedGameRoot);
  templateSummary.checks.install = true;
  await writePublicImportSmoke(generatedGameRoot);
  await writePublicTypesSmoke(generatedGameRoot);
  await runRequired(process.execPath, ["scripts/package-import-smoke.mjs"], generatedGameRoot);
  templateSummary.checks.publicImportSmoke = true;
  await runRequired(pnpm, [
    "exec",
    "tsc",
    "--noEmit",
    "--strict",
    "--target",
    "ES2022",
    "--module",
    "ESNext",
    "--moduleResolution",
    "Bundler",
    "--lib",
    "ESNext,DOM",
    "scripts/package-type-smoke.ts",
  ], generatedGameRoot);
  templateSummary.checks.publicTypeSmoke = true;
  await runRequired(pnpm, ["run", "ferrum:validate"], generatedGameRoot);
  templateSummary.checks.validate = true;
  const authoringReport = await runJsonReport(
    pnpm,
    ["run", "ferrum:authoring-report"],
    generatedGameRoot,
    "ferrum2d.consumer.gameplay-authoring.report",
  );
  assertConsumerAuthoringReport(authoringReport, templateName);
  templateSummary.reports.authoring = summarizeConsumerAuthoringReport(authoringReport);
  const replayReport = await runJsonReport(
    pnpm,
    ["run", "ferrum:replay-report"],
    generatedGameRoot,
    "ferrum2d.consumer.gameplay-replay.report",
  );
  assertConsumerReplayReport(replayReport, templateName);
  templateSummary.reports.gameplayReplay = summarizeConsumerReplayReport(replayReport);
  const runtimeReplayReport = await runJsonReport(
    pnpm,
    ["run", "ferrum:runtime-replay-report"],
    generatedGameRoot,
    "ferrum2d.consumer.runtime-gameplay-replay.report",
  );
  assertConsumerRuntimeReplayReport(runtimeReplayReport, templateName);
  templateSummary.reports.runtimeReplay = summarizeConsumerRuntimeReplayReport(runtimeReplayReport);
  const runtimeReplayRecipe = await runJsonReport(
    pnpm,
    ["run", "ferrum:runtime-replay-recipe"],
    generatedGameRoot,
    "ferrum2d.consumer.runtime-gameplay-replay.recipe",
  );
  assertConsumerRuntimeReplayRecipe(runtimeReplayRecipe, templateName);
  templateSummary.reports.runtimeReplayRecipe = summarizeConsumerRuntimeReplayRecipe(runtimeReplayRecipe);
  const runtimeReplayTemplate = templateCatalogById.get(templateName);
  if (runtimeReplayTemplate?.runtimeGameplayReplay?.configured === true) {
    const runtimeReplayUpdateReport = await runJsonReport(
      pnpm,
      ["run", "ferrum:update-runtime-replay-fixture"],
      generatedGameRoot,
      "ferrum2d.consumer.runtime-gameplay-replay.fixture-update-report",
    );
    assertConsumerRuntimeReplayFixtureUpdateReport(runtimeReplayUpdateReport, templateName);
    templateSummary.reports.runtimeReplayFixtureUpdate = summarizeRuntimeReplayFixtureUpdateReport(runtimeReplayUpdateReport);
    await requireFile(
      path.join(generatedGameRoot, "public/gameplay-runtime-replay.fixture.json"),
      `${templateName} configured runtime replay update must keep fixture present`,
    );
    await requireFile(
      path.join(generatedGameRoot, "public/gameplay-runtime-replay.coverage-tags.json"),
      `${templateName} configured runtime replay update must keep coverage tags present`,
    );
  } else {
    const runtimeReplayUpdateReport = await runJsonReportAllowFailure(
      pnpm,
      ["run", "ferrum:update-runtime-replay-fixture"],
      generatedGameRoot,
      "ferrum2d.consumer.runtime-gameplay-replay.report",
    );
    assert(runtimeReplayUpdateReport.result.code !== 0, `${templateName} runtime replay fixture update must fail while scaffold is not configured`);
    assertConsumerRuntimeReplayUpdateNotConfiguredReport(runtimeReplayUpdateReport.report, templateName);
    templateSummary.reports.runtimeReplayFixtureUpdate = {
      status: "not-configured",
      rejected: true,
      report: summarizeConsumerRuntimeReplayReport(runtimeReplayUpdateReport.report),
    };
    await assertMissing(
      path.join(generatedGameRoot, "public/gameplay-runtime-replay.fixture.json"),
      `${templateName} runtime replay update must not create a fixture while scaffold is not configured`,
    );
    await assertMissing(
      path.join(generatedGameRoot, "public/gameplay-runtime-replay.coverage-tags.json"),
      `${templateName} runtime replay update must not create coverage tags while scaffold is not configured`,
    );
  }
  if (templateName === "topdown") {
    await writeStaleTopdownReplayFixture(generatedGameRoot);
    const staleReplayReport = await runJsonReportAllowFailure(
      pnpm,
      ["run", "ferrum:replay-report"],
      generatedGameRoot,
      "ferrum2d.consumer.gameplay-replay.report",
    );
    assert(staleReplayReport.result.code !== 0, "topdown replay report must fail for a stale replay fixture");
    assertTopdownStaleReplayReport(staleReplayReport.report);
    templateSummary.mutationChecks.staleReplayFixtureRejected = summarizeRejectedReport(staleReplayReport.report);
    const updateReport = await runJsonReport(
      pnpm,
      ["run", "ferrum:update-replay-fixture"],
      generatedGameRoot,
      "ferrum2d.consumer.gameplay-replay.fixture-update-report",
    );
    assertConsumerReplayFixtureUpdateReport(updateReport, replayReport);
    templateSummary.mutationChecks.staleReplayFixtureUpdate = summarizeGameplayReplayFixtureUpdateReport(updateReport);
    const replayReportAfterUpdate = await runJsonReport(
      pnpm,
      ["run", "ferrum:replay-report"],
      generatedGameRoot,
      "ferrum2d.consumer.gameplay-replay.report",
    );
    assertConsumerReplayReport(replayReportAfterUpdate, templateName);
    await writeTopdownGameSpecDrift(generatedGameRoot);
    const driftReplayReport = await runJsonReportAllowFailure(
      pnpm,
      ["run", "ferrum:replay-report"],
      generatedGameRoot,
      "ferrum2d.consumer.gameplay-replay.report",
    );
    assert(driftReplayReport.result.code !== 0, "topdown replay report must fail when Game Spec drifts from the replay fixture");
    assertTopdownGameSpecDriftReplayReport(driftReplayReport.report);
    templateSummary.mutationChecks.gameSpecDriftRejected = summarizeRejectedReport(driftReplayReport.report);
    const driftUpdateReport = await runJsonReport(
      pnpm,
      ["run", "ferrum:update-replay-fixture"],
      generatedGameRoot,
      "ferrum2d.consumer.gameplay-replay.fixture-update-report",
    );
    assertConsumerReplayFixtureUpdateReport(driftUpdateReport, driftReplayReport.report);
    templateSummary.mutationChecks.gameSpecDriftFixtureUpdate = summarizeGameplayReplayFixtureUpdateReport(driftUpdateReport);
    const replayReportAfterDriftUpdate = await runJsonReport(
      pnpm,
      ["run", "ferrum:replay-report"],
      generatedGameRoot,
      "ferrum2d.consumer.gameplay-replay.report",
    );
    assertConsumerReplayReport(replayReportAfterDriftUpdate, templateName);
  }
  await runRequired(pnpm, ["run", "build"], generatedGameRoot);
  templateSummary.checks.build = true;
  await requireFile(
    path.join(generatedGameRoot, "dist/index.html"),
    `generated ${templateName} game build must emit dist/index.html`,
  );
  templateSummary.buildOutput.distIndexHtml = path.join(templateSummary.generatedProject, "dist/index.html");
  templateSummary.buildOutput.preservedInArtifactSnapshot = false;
}

async function packPackage(packageRoot, destination) {
  const before = new Set(await listTarballs(destination));
  await runRequired(pnpm, ["pack", "--pack-destination", destination], packageRoot);
  const after = await listTarballs(destination);
  const created = after.filter((entry) => !before.has(entry));
  assert(created.length === 1, `expected one new tarball from ${path.relative(repoRoot, packageRoot)}, found ${created.length}`);
  return path.join(destination, created[0]);
}

async function listTarballs(directory) {
  const entries = await readdir(directory).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter((entry) => entry.endsWith(".tgz")).sort();
}

function createTemplateSummary(templateName) {
  return {
    template: templateName,
    status: "running",
    generatedProject: undefined,
    checks: {
      createGame: false,
      agentsDryRun: false,
      agentsInstall: false,
      install: false,
      publicImportSmoke: false,
      publicTypeSmoke: false,
      validate: false,
      build: false,
    },
    agents: undefined,
    reports: {},
    mutationChecks: {},
    buildOutput: {},
  };
}

async function writeToolConsumerPackage(targetRoot, { createGameTarball, agentsTarball }) {
  await mkdir(targetRoot, { recursive: true });
  await writeJson(path.join(targetRoot, "package.json"), {
    name: "ferrum2d-package-tool-consumer",
    private: true,
    packageManager,
    type: "module",
    devDependencies: {
      "@ferrum2d/create-game": fileDependency(createGameTarball),
      "@ferrum2d/agents": fileDependency(agentsTarball),
    },
  });
}

async function pinGeneratedPackageManager(targetRoot) {
  const packageJsonPath = path.join(targetRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.packageManager ??= packageManager;
  await writeJson(packageJsonPath, packageJson);
}

async function assertGeneratedAgentsInstall(generatedGameRoot, templateName) {
  for (const file of AGENT_INSTALL_EXPECTED_FILES) {
    await requireFile(
      path.join(generatedGameRoot, file),
      `${templateName} generated game must include installed agents file ${file}`,
    );
  }
  await assertMissing(
    path.join(generatedGameRoot, ".gemini/agents"),
    `${templateName} generated game must not install unsupported Gemini agents`,
  );
  await assertMissing(
    path.join(generatedGameRoot, ".gemini/skills"),
    `${templateName} generated game must not install Gemini skill wrappers`,
  );

  const gameDevelopmentHarness = await readFile(
    path.join(generatedGameRoot, ".agents/harness/ferrum-game-development.md"),
    "utf8",
  );
  const gameSpecSkill = await readFile(
    path.join(generatedGameRoot, ".agents/skills/ferrum-consumer-game-spec/SKILL.md"),
    "utf8",
  );
  const architectureSkill = await readFile(
    path.join(generatedGameRoot, ".agents/skills/ferrum-consumer-architecture/SKILL.md"),
    "utf8",
  );
  const gameplaySkill = await readFile(
    path.join(generatedGameRoot, ".agents/skills/ferrum-consumer-gameplay/SKILL.md"),
    "utf8",
  );
  assertConsumerProjectileWeaponAuthoringContract(gameDevelopmentHarness, `${templateName} installed game-development harness`);
  assertConsumerRuntimeApplyContract(gameDevelopmentHarness, `${templateName} installed game-development harness`);
  assertConsumerArchitectureContract(gameDevelopmentHarness, `${templateName} installed game-development harness`);
  assertForbiddenPublicImportBoundary(gameDevelopmentHarness, `${templateName} installed game-development harness`);
  assertConsumerArchitectureContract(architectureSkill, `${templateName} installed architecture skill`);
  assertForbiddenPublicImportBoundary(architectureSkill, `${templateName} installed architecture skill`);
  assertConsumerProjectileWeaponAuthoringContract(gameSpecSkill, `${templateName} installed game-spec skill`);
  assert(
    gameSpecSkill.includes("npm run ferrum:authoring-report") &&
      gameSpecSkill.includes("npm run ferrum:replay-report"),
    `${templateName} installed game-spec skill must require authoring and replay report checks`,
  );
  assertConsumerProjectileWeaponAuthoringContract(gameplaySkill, `${templateName} installed gameplay skill`);
  assertConsumerRuntimeApplyContract(gameplaySkill, `${templateName} installed gameplay skill`);
}

async function writePublicImportSmoke(targetRoot) {
  await mkdir(path.join(targetRoot, "scripts"), { recursive: true });
  await writeFile(path.join(targetRoot, "scripts/package-import-smoke.mjs"), `import {
  AnimationTimelinePlayer,
  AudioManager,
  CameraRigController,
  CutsceneSequencePlayer,
  DialogueSession,
  LevelChunkStreamer,
  LocalizationBundle,
  QuestLog,
  RuntimeProfiler,
  ScreenFadeTransition,
  SCREENSHOT_CAPTURE_SUMMARY_FORMAT,
  TEXTURE_ATLAS_PACK_FORMAT,
  GAMEPLAY_BEHAVIOR_BINDING_PROP,
  PARTICLE_VFX_PRESETS,
  SPRITE_MATERIAL_PRESETS,
  assetManifestFingerprint,
  applyPhysicsSceneProfile,
  applyAccessibilityToCameraRigSpec,
  applyGameplayBehaviorCommands,
  behaviorRecipeCommandsForEntity,
  bindSceneBehaviorRecipes,
  buildDebugGizmoLineBuffer,
  captureDialogueQuestState,
  compileWeaponProfiles,
  resolveCutsceneSequenceSpec,
  createHudOverlayState,
  dialogueNodeToUiOverlayState,
  instantiateSceneFragment,
  createAssetPreloadCachePolicy,
  createFerrumRuntime,
  diagnosticReport,
  dryRunSceneBehaviorRecipes,
  gameplayActionDiagnosticReports,
  gameplaySpawnDiagnosticReports,
  particleVfxPreset,
  projectile,
  resolveAnimationTimelineSpec,
  resolveAccessibilityOptions,
  resolveBehaviorRecipeDocument,
  resolveDialogueGraph,
  resolveFontLoadingPolicy,
  resolveLevelChunkManifest,
  resolveLevelStreamingPlan,
  compareGameplayReplayRuns,
  createGameplayReplayRun,
  resolveQuestDocument,
  resolvePostProcessPasses,
  resolveAccessibilityHudTheme,
  resolveHudTheme,
  hashGameStateSnapshot,
  summarizeScreenshotPixels,
  compareScreenshotSummaries,
  resolveSceneCompositionSpec,
  resolveSpriteMaterialPreset,
  resolveShooterGameSpec,
  suggestionForActionFailureReason,
  suggestionForSpawnDiagnosticMetric,
  weapon,
  packTextureAtlas,
  textureAtlasDocumentToShooterAtlas,
} from "@ferrum2d/ferrum-web";

if (typeof createFerrumRuntime !== "function") {
  throw new Error("createFerrumRuntime must be exported from the public entrypoint.");
}
if (typeof resolveAnimationTimelineSpec !== "function") {
  throw new Error("resolveAnimationTimelineSpec must be exported from the public entrypoint.");
}
if (typeof AnimationTimelinePlayer !== "function") {
  throw new Error("AnimationTimelinePlayer must be exported from the public entrypoint.");
}
const animationTimeline = resolveAnimationTimelineSpec({
  states: {
    idle: { frameCount: 1 },
  },
});
if (AnimationTimelinePlayer.create(animationTimeline).currentState() !== "idle") {
  throw new Error("AnimationTimelinePlayer must resolve and play public animation timeline specs.");
}
if (typeof resolveSceneCompositionSpec !== "function") {
  throw new Error("resolveSceneCompositionSpec must be exported from the public entrypoint.");
}
if (typeof instantiateSceneFragment !== "function") {
  throw new Error("instantiateSceneFragment must be exported from the public entrypoint.");
}
const sceneComposition = resolveSceneCompositionSpec({
  prefabs: { marker: { props: { kind: "marker" } } },
  fragments: { main: { instances: [{ id: "spawn", prefab: "marker" }] } },
});
if (instantiateSceneFragment(sceneComposition)[0]?.id !== "spawn") {
  throw new Error("scene composition helpers must resolve public prefab fragments.");
}
if (typeof resolveBehaviorRecipeDocument !== "function") {
  throw new Error("resolveBehaviorRecipeDocument must be exported from the public entrypoint.");
}
if (typeof behaviorRecipeCommandsForEntity !== "function") {
  throw new Error("behaviorRecipeCommandsForEntity must be exported from the public entrypoint.");
}
const behaviorRecipes = resolveBehaviorRecipeDocument({
  entities: {
    enemy: { recipes: [{ kind: "health", max: 2 }, { kind: "lifetime", seconds: 1 }, { kind: "scoreReward", reward: 0 }] },
  },
});
if (behaviorRecipeCommandsForEntity(behaviorRecipes, "enemy")[0]?.type !== "configureHealth") {
  throw new Error("behavior recipe helpers must emit public runtime adapter commands.");
}
if (behaviorRecipeCommandsForEntity(behaviorRecipes, "enemy", { kinds: ["lifetime"] })[0]?.type !== "configureLifetime") {
  throw new Error("behavior recipe helpers must emit lifetime runtime adapter commands.");
}
if (behaviorRecipeCommandsForEntity(behaviorRecipes, "enemy", { kinds: ["scoreReward"] })[0]?.type !== "configureScoreReward") {
  throw new Error("behavior recipe helpers must emit score reward runtime adapter commands.");
}
if (typeof compileWeaponProfiles !== "function" || typeof projectile !== "function" || typeof weapon !== "function") {
  throw new Error("projectile/weapon authoring helpers must be exported from the public entrypoint.");
}
const weaponProfiles = compileWeaponProfiles([
  weapon("standard").action("standard").actionId(1).cooldown(0.08).fire(
    projectile("standard-shot").speed(720).damage(1).lifetime(1.6),
  ),
  weapon("piercing").action("piercing").actionId(4).fire(
    projectile("piercing-shot").speed(520).collisionTarget("enemies").tileImpact("passThrough"),
  ),
  weapon("bounce").action("bounce").actionId(5).cooldown(0.1).fire(
    projectile("bounce-shot").speed(420).damage(2).lifetime(1).tileImpact("bounce"),
  ),
], {
  path: "consumerSmoke.weaponProfiles",
});
const piercingCommand = behaviorRecipeCommandsForEntity(weaponProfiles, "piercing")[0];
const bounceCommand = behaviorRecipeCommandsForEntity(weaponProfiles, "bounce")[0];
if (piercingCommand?.type !== "configureProjectileAction" || piercingCommand.tileImpact !== "passThrough") {
  throw new Error("weapon authoring helpers must compile piercing projectiles to passThrough projectileAction commands.");
}
if (bounceCommand?.type !== "configureProjectileAction" || bounceCommand.tileImpact !== "bounce") {
  throw new Error("weapon authoring helpers must compile bounce projectiles to bounce projectileAction commands.");
}
if (GAMEPLAY_BEHAVIOR_BINDING_PROP !== "behaviorRecipes") {
  throw new Error("GAMEPLAY_BEHAVIOR_BINDING_PROP must be exported from the public entrypoint.");
}
if (typeof bindSceneBehaviorRecipes !== "function" || typeof dryRunSceneBehaviorRecipes !== "function") {
  throw new Error("gameplay authoring helpers must be exported from the public entrypoint.");
}
const gameplayBindingPlan = bindSceneBehaviorRecipes({
  prefabs: { enemy: { props: { behaviorRecipes: "enemy" } } },
  fragments: { main: { instances: [{ id: "enemy-a", prefab: "enemy" }] } },
}, behaviorRecipes);
if (gameplayBindingPlan.commands[0]?.entity !== "enemy-a") {
  throw new Error("gameplay authoring helpers must retarget behavior commands to scene instances.");
}
const gameplayBehaviorApply = applyGameplayBehaviorCommands({
  set_gameplay_health: () => true,
  clear_gameplay_health: () => true,
  set_gameplay_damage: () => true,
  clear_gameplay_damage: () => true,
  set_gameplay_lifetime: () => true,
  clear_gameplay_lifetime: () => true,
  set_gameplay_score_reward: () => true,
  clear_gameplay_score_reward: () => true,
  set_gameplay_pickup: () => true,
  clear_gameplay_pickup: () => true,
  set_gameplay_interaction: () => true,
  clear_gameplay_interaction: () => true,
  set_gameplay_movement_chase_player: () => true,
  set_gameplay_movement_chase_entity: () => true,
  add_gameplay_collision_damage: () => true,
}, gameplayBindingPlan.commands, { "enemy-a": { entityId: 1, entityGeneration: 1 } });
if (gameplayBehaviorApply.results[0] !== true) {
  throw new Error("gameplay authoring helpers must apply supported behavior commands to entity handles.");
}
if (!dryRunSceneBehaviorRecipes(sceneComposition, behaviorRecipes).ok) {
  throw new Error("gameplay authoring dry-run must return ok for valid composition and behavior recipes.");
}
if (
  typeof createGameplayReplayRun !== "function" ||
  typeof compareGameplayReplayRuns !== "function" ||
  typeof hashGameStateSnapshot !== "function"
) {
  throw new Error("gameplay replay helpers must be exported from the public entrypoint.");
}
const gameplayReplaySnapshot = {
  format: "ferrum2d.game-state.snapshot",
  version: 1,
  frame: 0,
  source: "ferrum-runtime",
  scene: {
    score: 0,
    gameState: 0,
    entityCount: 0,
    spriteCount: 0,
    cameraX: 0,
    cameraY: 0,
  },
  snapshotHash: "",
  custom: { score: 0 },
};
gameplayReplaySnapshot.snapshotHash = hashGameStateSnapshot(gameplayReplaySnapshot);
const gameplayReplayRun = createGameplayReplayRun([gameplayReplaySnapshot]);
if (!compareGameplayReplayRuns(gameplayReplayRun, gameplayReplayRun).passed) {
  throw new Error("gameplay replay helpers must compare public deterministic replay runs.");
}
if (typeof gameplayActionDiagnosticReports !== "function" || typeof suggestionForActionFailureReason !== "function") {
  throw new Error("gameplay action diagnostic helpers must be exported from the public entrypoint.");
}
if (typeof gameplaySpawnDiagnosticReports !== "function" || typeof suggestionForSpawnDiagnosticMetric !== "function") {
  throw new Error("gameplay spawn diagnostic helpers must be exported from the public entrypoint.");
}
const gameplayActionReports = gameplayActionDiagnosticReports({
  triggerAttempts: 1,
  triggerFailures: 1,
  triggerFailureEventsPushed: 1,
  triggerCommitSkips: 0,
  lastPreparedTriggerFailureReasonCode: 5,
  failureReasonCounts: [0, 0, 0, 0, 0, 1],
}, {
  actionFailures: [{
    type: "actionFailed",
    actor: { entityId: 1, entityGeneration: 1 },
    source: { entityId: 1, entityGeneration: 1 },
    actionId: 11,
    reasonCode: 5,
    reason: "spawnQueueFull",
    flags: 0,
    payloadBits: 5,
    event: {
      kind: "actionFailed",
      kindCode: 6,
      actorId: 1,
      actorGeneration: 1,
      sourceId: 1,
      sourceGeneration: 1,
      tokenId: 11,
      flags: 0,
      payloadBits: 5,
      once: false,
      consumedThisFrame: false,
      targetRemoved: false,
    },
  }],
  actionNames: { 11: "summon" },
});
if (gameplayActionReports[0]?.code !== "FERRUM_GAMEPLAY_ACTION_TRIGGER_FAILURE") {
  throw new Error("gameplay action diagnostic helpers must emit machine-actionable reports.");
}
if (!suggestionForActionFailureReason("spawnQueueFull").includes("deferred spawn queue")) {
  throw new Error("gameplay action diagnostic helpers must expose actionable suggestions.");
}
const gameplaySpawnReports = gameplaySpawnDiagnosticReports({
  commandsDrained: 1,
  projectileSpawns: 1,
  projectileArcsApplied: 0,
  projectileShootAudioEventsPushed: 1,
  prefabSpawns: 0,
  prefabSpawnedPayloads: 0,
  prefabSpawnedEventsPushed: 0,
}, {
  includeActivity: true,
});
if (gameplaySpawnReports[0]?.code !== "FERRUM_GAMEPLAY_SPAWN_FLUSH_ACTIVITY") {
  throw new Error("gameplay spawn diagnostic helpers must emit machine-actionable reports.");
}
if (!suggestionForSpawnDiagnosticMetric("prefabSpawns").includes("spawnPrefab")) {
  throw new Error("gameplay spawn diagnostic helpers must expose actionable suggestions.");
}
if (typeof resolveHudTheme !== "function") {
  throw new Error("resolveHudTheme must be exported from the public entrypoint.");
}
if (typeof createHudOverlayState !== "function") {
  throw new Error("createHudOverlayState must be exported from the public entrypoint.");
}
if (createHudOverlayState([{ type: "meter", id: "hp", value: 1, max: 2 }]).panels?.[0]?.lines?.[0]?.value !== "50%") {
  throw new Error("HUD toolkit helpers must create public overlay state presets.");
}
if (resolveHudTheme("high-contrast").panelBorder !== "#ffffff") {
  throw new Error("HUD toolkit theme presets must resolve from the public entrypoint.");
}
if (typeof resolveShooterGameSpec !== "function") {
  throw new Error("resolveShooterGameSpec must be exported from the public entrypoint.");
}
if (typeof RuntimeProfiler !== "function") {
  throw new Error("RuntimeProfiler must be exported from the public entrypoint.");
}
if (typeof AudioManager !== "function") {
  throw new Error("AudioManager must be exported from the public entrypoint.");
}
if (typeof CameraRigController !== "function") {
  throw new Error("CameraRigController must be exported from the public entrypoint.");
}
if (typeof ScreenFadeTransition !== "function") {
  throw new Error("ScreenFadeTransition must be exported from the public entrypoint.");
}
if (typeof resolvePostProcessPasses !== "function") {
  throw new Error("resolvePostProcessPasses must be exported from the public entrypoint.");
}
if (new CameraRigController({ x: 1 }).snapshot().x !== 1) {
  throw new Error("CameraRigController must expose public camera rig snapshots.");
}
if (ScreenFadeTransition.create({ durationSeconds: 1 }).update(0.5).opacity !== 0.5) {
  throw new Error("ScreenFadeTransition must expose public fade transition state.");
}
if (resolvePostProcessPasses({ opacity: 0.25 })[0]?.color?.[3] !== 0.25) {
  throw new Error("resolvePostProcessPasses must resolve public fullscreen fade passes.");
}
if (typeof resolveCutsceneSequenceSpec !== "function") {
  throw new Error("resolveCutsceneSequenceSpec must be exported from the public entrypoint.");
}
if (typeof CutsceneSequencePlayer !== "function") {
  throw new Error("CutsceneSequencePlayer must be exported from the public entrypoint.");
}
const cutscene = resolveCutsceneSequenceSpec({
  commands: [
    { kind: "wait", durationSeconds: 0.1 },
    { kind: "camera", target: { x: 8, y: 4 } },
    { kind: "audio", sound: "ding" },
    { kind: "dialogue", text: "Ready" },
  ],
});
if (CutsceneSequencePlayer.create(cutscene).update(0).events[0]?.command.kind !== "wait") {
  throw new Error("CutsceneSequencePlayer must emit public sequence command events.");
}
if (typeof resolveLevelChunkManifest !== "function") {
  throw new Error("resolveLevelChunkManifest must be exported from the public entrypoint.");
}
if (typeof resolveLevelStreamingPlan !== "function") {
  throw new Error("resolveLevelStreamingPlan must be exported from the public entrypoint.");
}
if (typeof LevelChunkStreamer !== "function") {
  throw new Error("LevelChunkStreamer must be exported from the public entrypoint.");
}
const levelManifest = resolveLevelChunkManifest({
  chunks: [
    { id: "0,0", chunkX: 0, chunkY: 0, tilemap: { url: "/chunks/0-0.json" } },
  ],
});
const levelPlan = resolveLevelStreamingPlan(levelManifest, { x: 0, y: 0, width: 16, height: 16 });
if (levelPlan.activeChunkIds[0] !== "0,0" || LevelChunkStreamer.create(levelManifest).plan({ x: 0, y: 0, width: 16, height: 16 }).loadChunkIds[0] !== "0,0") {
  throw new Error("level streaming helpers must expose public chunk planning.");
}
if (typeof buildDebugGizmoLineBuffer !== "function") {
  throw new Error("buildDebugGizmoLineBuffer must be exported from the public entrypoint.");
}
const debugGizmos = buildDebugGizmoLineBuffer({
  paths: [{ id: "route", points: [{ x: 0, y: 0 }, { x: 16, y: 0 }] }],
  spawns: [{ id: "spawn", x: 8, y: 8 }],
});
if (debugGizmos.bufferView.lineCount !== debugGizmos.lines.length || debugGizmos.lines[0]?.category !== "path") {
  throw new Error("debug gizmo helpers must produce public debug line buffers.");
}
if (typeof resolveAccessibilityOptions !== "function" || typeof applyAccessibilityToCameraRigSpec !== "function") {
  throw new Error("accessibility helpers must be exported from the public entrypoint.");
}
const accessibilityOptions = resolveAccessibilityOptions({
  reducedMotion: "system",
  contrastPalette: "high-contrast",
}, { environment: { prefersReducedMotion: true } });
if (!accessibilityOptions.reducedMotion || resolveAccessibilityHudTheme(accessibilityOptions).panelBackground !== "#000000") {
  throw new Error("accessibility helpers must resolve reduced motion and contrast palette.");
}
if (applyAccessibilityToCameraRigSpec({ smoothTimeSeconds: 0.5 }, accessibilityOptions).smoothTimeSeconds !== 0) {
  throw new Error("accessibility helpers must reduce camera motion.");
}
if (SCREENSHOT_CAPTURE_SUMMARY_FORMAT !== "ferrum-screenshot-capture-summary") {
  throw new Error("screenshot capture summary format must be exported from the public entrypoint.");
}
const screenshotSummary = summarizeScreenshotPixels(new Uint8Array([255, 255, 255, 255]), 1, 1);
if (!compareScreenshotSummaries(screenshotSummary, screenshotSummary, { maxAverageColorDelta: 0 }).passed) {
  throw new Error("screenshot capture helpers must compare screenshot summaries.");
}
if (typeof LocalizationBundle !== "function") {
  throw new Error("LocalizationBundle must be exported from the public entrypoint.");
}
if (typeof resolveFontLoadingPolicy !== "function") {
  throw new Error("resolveFontLoadingPolicy must be exported from the public entrypoint.");
}
const localization = LocalizationBundle.create({
  defaultLocale: "en",
  locales: {
    en: { strings: { greeting: "Hello, {name}" } },
  },
});
if (localization.t("greeting", { values: { name: "Ferrum" } }) !== "Hello, Ferrum") {
  throw new Error("LocalizationBundle must resolve public string tables.");
}
if (resolveFontLoadingPolicy({ defaultFamily: "Ferrum UI" }).cssFontFamily.includes("Ferrum UI") !== true) {
  throw new Error("resolveFontLoadingPolicy must resolve public font loading policy.");
}
if (typeof DialogueSession !== "function" || typeof QuestLog !== "function") {
  throw new Error("DialogueSession and QuestLog must be exported from the public entrypoint.");
}
const questDocument = resolveQuestDocument({
  quests: { tutorial: { title: "Tutorial" } },
});
const dialogueGraph = resolveDialogueGraph({
  initialNode: "start",
  nodes: {
    start: { text: "Ready?", choices: [{ id: "yes", label: "Yes", to: "done" }] },
    done: { text: "Done", end: true },
  },
});
const questLog = QuestLog.create(questDocument);
const dialogue = DialogueSession.create(dialogueGraph, questLog);
if (dialogueNodeToUiOverlayState(dialogue).dialog?.actions?.[0]?.id !== "yes") {
  throw new Error("dialogueNodeToUiOverlayState must expose public dialogue choices.");
}
dialogue.choose("yes");
if (captureDialogueQuestState(dialogue, questLog).dialogue?.nodeId !== "done") {
  throw new Error("captureDialogueQuestState must capture public dialogue state.");
}
const physicsSceneEngine = {
  configurePhysicsRuntime: (spec) => spec,
  configureAutoRigidBodyStep: (options) => {
    globalThis.__ferrumPhysicsSceneAutoStep = options;
  },
  spawnRigidBody: () => ({ entityId: 1, entityGeneration: 1 }),
  despawnPhysicsEntity: () => true,
  clearPhysicsJoint: () => true,
};
const physicsScene = applyPhysicsSceneProfile(physicsSceneEngine, {
  physics: {
    mode: "rigid",
    bodies: {
      crate: { type: "dynamic", collider: { shape: "box", size: [8, 8] } },
    },
  },
});
if (!physicsScene.autoStep || physicsScene.bodyCount !== 1 || typeof globalThis.__ferrumPhysicsSceneAutoStep !== "object") {
  throw new Error("applyPhysicsSceneProfile must expose public generic physics scene integration.");
}
physicsScene.clear();
if (typeof assetManifestFingerprint !== "function") {
  throw new Error("assetManifestFingerprint must be exported from the public entrypoint.");
}
if (typeof createAssetPreloadCachePolicy !== "function") {
  throw new Error("createAssetPreloadCachePolicy must be exported from the public entrypoint.");
}
if (typeof resolveSpriteMaterialPreset !== "function") {
  throw new Error("resolveSpriteMaterialPreset must be exported from the public entrypoint.");
}
if (SPRITE_MATERIAL_PRESETS.outline?.blendMode !== "alpha") {
  throw new Error("SPRITE_MATERIAL_PRESETS must expose the built-in outline preset.");
}
if (resolveSpriteMaterialPreset("additive").blendMode !== "additive") {
  throw new Error("resolveSpriteMaterialPreset must resolve built-in additive material.");
}
if (PARTICLE_VFX_PRESETS["motion-trail"]?.emitter?.mode !== "trail") {
  throw new Error("PARTICLE_VFX_PRESETS must expose the built-in motion trail preset.");
}
if (particleVfxPreset("hit-spark", 0).emitter?.mode !== "burst") {
  throw new Error("particleVfxPreset must resolve built-in VFX presets.");
}
if (!createAssetPreloadCachePolicy({ json: { game: "/game.json" } }).version?.startsWith("assets-")) {
  throw new Error("createAssetPreloadCachePolicy must derive manifest-scoped versions.");
}
if (TEXTURE_ATLAS_PACK_FORMAT !== "ferrum-texture-atlas-pack") {
  throw new Error("TEXTURE_ATLAS_PACK_FORMAT must be exported from the public entrypoint.");
}
const packedAtlas = packTextureAtlas([
  { name: "hero", source: "hero.png", width: 16, height: 16 },
], { texture: "packed", padding: 1 });
if (packedAtlas.frames.hero?.texture !== "packed" || packedAtlas.placements[0]?.source !== "hero.png") {
  throw new Error("packTextureAtlas must emit public deterministic atlas frame metadata.");
}
if (textureAtlasDocumentToShooterAtlas(packedAtlas).frames?.hero?.texture !== "packed") {
  throw new Error("textureAtlasDocumentToShooterAtlas must convert atlas pack documents.");
}
if (diagnosticReport(new Error("smoke")).code !== "FERRUM_UNKNOWN") {
  throw new Error("diagnosticReport must keep the public error contract.");
}

for (const internalSubpath of [
  "dist/index.js",
  "pkg/ferrum_core.js",
  "src/index.js",
]) {
  let blocked = false;
  try {
    await import(\`@ferrum2d/ferrum-web/\${internalSubpath}\`);
  } catch (error) {
    blocked = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
  }
  if (!blocked) {
    throw new Error(\`Internal import must be blocked by package exports: \${internalSubpath}\`);
  }
}

console.log("public import smoke ok");
`);
}

async function writePublicTypesSmoke(targetRoot) {
  await mkdir(path.join(targetRoot, "scripts"), { recursive: true });
  await writeFile(path.join(targetRoot, "scripts/package-type-smoke.ts"), `import {
  createAssetPreloadCachePolicy,
  createFerrumRuntime,
  applyGameplayBehaviorCommands,
  behaviorRecipeCommandsForEntity,
  compileWeaponProfiles,
  dryRunSceneBehaviorRecipes,
  gameplayActionDiagnosticReports,
  gameplaySpawnDiagnosticReports,
  projectile,
  resolveShooterGameSpec,
  suggestionForActionFailureReason,
  suggestionForSpawnDiagnosticMetric,
  weapon,
  type ActionFrameDiagnostics,
  type AssetPreloadCachePolicy,
  type FerrumRuntime,
  type GameplayActionDiagnosticReport,
  type GameplayActionFailedEventAction,
  type GameplayEntityHandle,
  type GameplaySpawnDiagnosticReport,
  type ProjectileDefinition,
  type SceneBehaviorBindingDryRunResult,
  type ShooterGameSpec,
  type SpawnFrameDiagnostics,
  type WeaponDefinition,
} from "@ferrum2d/ferrum-web";

const spec: ShooterGameSpec = {
  world: { width: 960, height: 540 },
  player: { speed: 210 },
  enemies: { speed: 64, spawnInterval: 2.5 },
  weapons: { bulletSpeed: 520, cooldown: 0.18, damage: 1 },
};
const resolved = resolveShooterGameSpec(spec);
const policy: AssetPreloadCachePolicy = createAssetPreloadCachePolicy({
  json: { game: "/game.json" },
});
const behaviorDryRun: SceneBehaviorBindingDryRunResult = dryRunSceneBehaviorRecipes({
  prefabs: { actor: { props: { behaviorRecipes: "actor" } } },
  fragments: { main: { instances: [{ id: "actor-a", prefab: "actor" }] } },
}, {
  entities: { actor: { recipes: [{ kind: "health", max: 1 }, { kind: "lifetime", seconds: 1 }, { kind: "scoreReward", reward: 0 }] } },
});
const gameplayHandle: GameplayEntityHandle = { entityId: 1, entityGeneration: 1 };
const gameplayRuntime: Parameters<typeof applyGameplayBehaviorCommands>[0] = {
  set_gameplay_health: () => true,
  clear_gameplay_health: () => true,
  set_gameplay_damage: () => true,
  clear_gameplay_damage: () => true,
  set_gameplay_lifetime: () => true,
  clear_gameplay_lifetime: () => true,
  set_gameplay_score_reward: () => true,
  clear_gameplay_score_reward: () => true,
  set_gameplay_pickup: () => true,
  clear_gameplay_pickup: () => true,
  set_gameplay_interaction: () => true,
  clear_gameplay_interaction: () => true,
  set_gameplay_movement_chase_player: () => true,
  set_gameplay_movement_chase_entity: () => true,
  add_gameplay_collision_damage: () => true,
};
const gameplayApply = applyGameplayBehaviorCommands(gameplayRuntime, behaviorDryRun.ok ? behaviorDryRun.plan.commands : [], {
  "actor-a": gameplayHandle,
});
const projectileDefinition: ProjectileDefinition = projectile("typed-shot")
  .speed(480)
  .damage(2)
  .lifetime(1)
  .tileImpact("bounce")
  .build();
const weaponDefinition: WeaponDefinition = weapon("typed-weapon")
  .action("typed")
  .actionId(6)
  .cooldown(0.2)
  .fire(projectileDefinition)
  .build();
const weaponProfileDocument = compileWeaponProfiles([weaponDefinition], { path: "typeSmoke.weaponProfiles" });
const weaponProfileCommand = behaviorRecipeCommandsForEntity(weaponProfileDocument, "typed-weapon")[0];
const actionDiagnostics: ActionFrameDiagnostics = {
  triggerAttempts: 1,
  triggerFailures: 1,
  triggerFailureEventsPushed: 1,
  triggerCommitSkips: 0,
  lastPreparedTriggerFailureReasonCode: 5,
  failureReasonCounts: [0, 0, 0, 0, 0, 1],
};
const actionFailed: GameplayActionFailedEventAction = {
  type: "actionFailed",
  actor: gameplayHandle,
  source: gameplayHandle,
  actionId: 11,
  reasonCode: 5,
  reason: "spawnQueueFull",
  flags: 0,
  payloadBits: 5,
  event: {
    kind: "actionFailed",
    kindCode: 6,
    actorId: 1,
    actorGeneration: 1,
    sourceId: 1,
    sourceGeneration: 1,
    tokenId: 11,
    flags: 0,
    payloadBits: 5,
    once: false,
    consumedThisFrame: false,
    targetRemoved: false,
  },
};
const actionDiagnosticReport: GameplayActionDiagnosticReport | undefined = gameplayActionDiagnosticReports(actionDiagnostics, {
  actionFailures: [actionFailed],
  actionNames: { 11: "summon" },
})[0];
const actionDiagnosticSuggestion: string = suggestionForActionFailureReason("spawnQueueFull");
const spawnDiagnostics: SpawnFrameDiagnostics = {
  commandsDrained: 1,
  projectileSpawns: 1,
  projectileArcsApplied: 0,
  projectileShootAudioEventsPushed: 1,
  prefabSpawns: 0,
  prefabSpawnedPayloads: 0,
  prefabSpawnedEventsPushed: 0,
};
const spawnDiagnosticReport: GameplaySpawnDiagnosticReport | undefined = gameplaySpawnDiagnosticReports(spawnDiagnostics, {
  includeActivity: true,
})[0];
const spawnDiagnosticSuggestion: string = suggestionForSpawnDiagnosticMetric("projectileSpawns");
const runtimeFactory: typeof createFerrumRuntime = createFerrumRuntime;
declare const runtime: FerrumRuntime;
runtime.engine.setGameSpec(spec);
void policy;
void resolved;
void behaviorDryRun;
void gameplayApply;
void weaponProfileCommand;
void actionDiagnosticReport;
void actionDiagnosticSuggestion;
void spawnDiagnosticReport;
void spawnDiagnosticSuggestion;
void runtimeFactory;
`);
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fileDependency(filePath) {
  return `file:${filePath}`;
}

async function runRequired(command, args, cwd) {
  console.log(`$ ${formatCommand(command, args)} (${path.relative(repoRoot, cwd) || "."})`);
  const result = await run(command, args, cwd, options.commandTimeoutMs);
  assert(
    !result.timedOut && result.code === 0,
    commandFailureMessage(command, args, result),
  );
  if (result.stdout.trim().length > 0) {
    console.log(result.stdout.trim());
  }
  if (result.stderr.trim().length > 0) {
    console.error(result.stderr.trim());
  }
  return result;
}

async function runJsonReport(command, args, cwd, expectedFormat) {
  const result = await runRequired(command, args, cwd);
  return parseJsonReport(result.stdout, expectedFormat, formatCommand(command, args));
}

async function runJsonReportAllowFailure(command, args, cwd, expectedFormat) {
  console.log(`$ ${formatCommand(command, args)} (${path.relative(repoRoot, cwd) || "."})`);
  const result = await run(command, args, cwd, options.commandTimeoutMs);
  assert(!result.timedOut, commandFailureMessage(command, args, result));
  if (result.stdout.trim().length > 0) {
    console.log(result.stdout.trim());
  }
  if (result.stderr.trim().length > 0) {
    console.error(result.stderr.trim());
  }
  return {
    result,
    report: parseJsonReport(result.stdout, expectedFormat, formatCommand(command, args)),
  };
}

function parseJsonReport(stdout, expectedFormat, commandLabel) {
  const marker = `{\n  "format": "${expectedFormat}"`;
  const start = stdout.indexOf(marker);
  assert(start >= 0, `command did not emit ${expectedFormat} JSON report: ${commandLabel}`);
  const end = findJsonObjectEnd(stdout, start);
  assert(end >= 0, `command emitted an incomplete ${expectedFormat} JSON report: ${commandLabel}`);
  try {
    return JSON.parse(stdout.slice(start, end));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to parse ${expectedFormat} JSON report from ${commandLabel}: ${message}`);
  }
}

function findJsonObjectEnd(source, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return -1;
}

function assertConsumerAuthoringReport(report, templateName) {
  assert(report.format === "ferrum2d.consumer.gameplay-authoring.report", `${templateName} authoring report format is invalid`);
  assert(report.version === 1, `${templateName} authoring report version is invalid`);
  assert(report.ok === true, `${templateName} authoring report must be ok for a generated template`);
  assert(report.gameplayAuthoring?.packageName === templateName, `${templateName} authoring report packageName is invalid`);
  assert(Array.isArray(report.gameplayAuthoring?.diagnostics), `${templateName} authoring report diagnostics must be an array`);
  assert(Array.isArray(report.gameplayAuthoring?.reports), `${templateName} authoring report reports must be an array`);
  assertMachineActionableReports(report.gameplayAuthoring.reports, `${templateName} authoring report gameplayAuthoring.reports`);
  if (templateName === "topdown") {
    assert(report.gameplayAuthoring.status === "validated", "topdown authoring report must validate public/game.json");
    assert(report.gameplayAuthoring.gameSpec?.ok === true, "topdown authoring report must include a valid Game Spec result");
    assert(report.gameplayAuthoring.gameSpec?.file === "public/game.json", "topdown authoring report must identify public/game.json");
  } else {
    assert(report.gameplayAuthoring.status === "not-configured", `${templateName} authoring report must be not-configured`);
    assert(report.gameplayAuthoring.gameSpec?.ok === null, `${templateName} authoring report must mark missing Game Spec as a structured skip`);
  }
  if (templateName === "minimal") {
    assertMinimalTemplateAuthoringSurface(report.gameplayAuthoring?.authoringSurface, "minimal authoring report");
  }
}

function assertConsumerReplayReport(report, templateName) {
  assert(report.format === "ferrum2d.consumer.gameplay-replay.report", `${templateName} replay report format is invalid`);
  assert(report.version === 1, `${templateName} replay report version is invalid`);
  assert(report.ok === true, `${templateName} replay report must be ok for default templates`);
  assert(report.gameplayReplay?.packageName === templateName, `${templateName} replay report packageName is invalid`);
  assert(Array.isArray(report.gameplayReplay?.reports), `${templateName} replay report reports must be an array`);
  assertMachineActionableReports(report.gameplayReplay.reports, `${templateName} replay report gameplayReplay.reports`);
  assert(report.gameplayReplay?.status === "validated", `${templateName} replay report must validate its replay fixture`);
  assert(report.gameplayReplay?.configured === true, `${templateName} replay report must mark replay as configured`);
  assert(typeof report.gameplayReplay?.scenario === "string" && report.gameplayReplay.scenario.length > 0, `${templateName} replay report scenario is invalid`);
  assert(report.gameplayReplay?.fixture === "public/gameplay-replay.fixture.json", `${templateName} replay report fixture path is invalid`);
  assert(report.gameplayReplay?.coverageTagDefinitionsPath === "public/gameplay-replay.coverage-tags.json", `${templateName} replay report coverage vocabulary path is invalid`);
  assert(Array.isArray(report.gameplayReplay?.coverageTags) && report.gameplayReplay.coverageTags.length > 0, `${templateName} replay report coverage tags are invalid`);
  assertCoverageRegistryReport(report.gameplayReplay, `${templateName} replay report`);
  if (templateName === "topdown") {
    assert(report.gameplayReplay.scenario === "topdown-template-game-spec", "topdown replay report scenario is invalid");
    assertDeepEqual(report.gameplayReplay.coverageTags, ["template-game-spec"], "topdown replay report coverage tags are invalid");
    assertTopdownCoverageRegistry(report.gameplayReplay, "topdown replay report");
  } else if (templateName === "minimal") {
    assert(report.gameplayReplay.scenario === "minimal-template-surface", "minimal replay report scenario is invalid");
    assertDeepEqual(
      report.gameplayReplay.coverageTags,
      ["starter-runtime-template", "template-weapon-authoring"],
      "minimal replay report coverage tags are invalid",
    );
    assertMinimalCoverageRegistry(report.gameplayReplay, "minimal replay report");
  } else if (templateName === "platformer") {
    assert(report.gameplayReplay.scenario === "platformer-template-surface", "platformer replay report scenario is invalid");
    assertDeepEqual(report.gameplayReplay.coverageTags, ["platformer-template"], "platformer replay report coverage tags are invalid");
    assertPlatformerCoverageRegistry(report.gameplayReplay, "platformer replay report");
  }
  assert(report.gameplayReplay?.comparison?.passed === true, `${templateName} replay comparison must pass`);
  assert(typeof report.gameplayReplay?.expectedHash === "string", `${templateName} replay report must include expectedHash`);
  assert(report.gameplayReplay?.expectedHash === report.gameplayReplay?.actualHash, `${templateName} replay expectedHash and actualHash must match`);
}

function assertConsumerRuntimeReplayReport(report, templateName) {
  const runtimeReplayConfigured = templateCatalogById.get(templateName)?.runtimeGameplayReplay?.configured === true;
  assert(report.format === "ferrum2d.consumer.runtime-gameplay-replay.report", `${templateName} runtime replay report format is invalid`);
  assert(report.version === 1, `${templateName} runtime replay report version is invalid`);
  assert(report.ok === true, `${templateName} runtime replay report must be ok`);
  assert(report.runtimeGameplayReplay?.configured === runtimeReplayConfigured, `${templateName} runtime replay configured flag is invalid`);
  assert(report.runtimeGameplayReplay?.status === (runtimeReplayConfigured ? "validated" : "not-configured"), `${templateName} runtime replay status is invalid`);
  assert(report.runtimeGameplayReplay?.scenario === "project-runtime", `${templateName} runtime replay scenario is invalid`);
  assert(report.runtimeGameplayReplay?.fixture === "public/gameplay-runtime-replay.fixture.json", `${templateName} runtime replay fixture path is invalid`);
  assert(
    report.runtimeGameplayReplay?.coverageTagDefinitionsPath === "public/gameplay-runtime-replay.coverage-tags.json",
    `${templateName} runtime replay coverage vocabulary path is invalid`,
  );
  assertDeepEqual(report.runtimeGameplayReplay?.coverageTags, ["project-runtime"], `${templateName} runtime replay coverage tags are invalid`);
  assert(report.runtimeGameplayReplay?.recipe?.template === templateName, `${templateName} runtime replay report recipe template is invalid`);
  if (runtimeReplayConfigured) {
    assertDeepEqual(report.runtimeGameplayReplay?.reports, [], `${templateName} runtime replay reports must be empty when validated`);
    assert(report.runtimeGameplayReplay?.comparison?.passed === true, `${templateName} runtime replay comparison must pass`);
    assert(report.runtimeGameplayReplay?.expectedHash === report.runtimeGameplayReplay?.actualHash, `${templateName} runtime replay hash must match`);
  } else {
    assertMachineActionableReports(report.runtimeGameplayReplay?.reports, `${templateName} runtime replay reports`);
    assert(
      report.runtimeGameplayReplay?.reports?.[0]?.code === "FERRUM_CONSUMER_RUNTIME_REPLAY_NOT_CONFIGURED",
      `${templateName} runtime replay report must include not-configured diagnostic code`,
    );
  }
}

function assertConsumerRuntimeReplayRecipe(recipe, templateName) {
  const runtimeReplayConfigured = templateCatalogById.get(templateName)?.runtimeGameplayReplay?.configured === true;
  assert(recipe.format === "ferrum2d.consumer.runtime-gameplay-replay.recipe", `${templateName} runtime replay recipe format is invalid`);
  assert(recipe.version === 1, `${templateName} runtime replay recipe version is invalid`);
  assert(recipe.template === templateName, `${templateName} runtime replay recipe template is invalid`);
  assert(recipe.scenario === "project-runtime", `${templateName} runtime replay recipe scenario is invalid`);
  assert(recipe.status === (runtimeReplayConfigured ? "configured" : "scaffold"), `${templateName} runtime replay recipe status is invalid`);
  assert(recipe.fixture === "public/gameplay-runtime-replay.fixture.json", `${templateName} runtime replay recipe fixture path is invalid`);
  assert(
    recipe.coverageTagDefinitionsPath === "public/gameplay-runtime-replay.coverage-tags.json",
    `${templateName} runtime replay recipe coverage path is invalid`,
  );
  assertDeepEqual(recipe.coverageTags, ["project-runtime"], `${templateName} runtime replay recipe coverage tags are invalid`);
  assert(recipe.deterministicRun?.fixedDelta === 1 / 60, `${templateName} runtime replay recipe fixedDelta is invalid`);
  assert(typeof recipe.deterministicRun?.seed === "string" && recipe.deterministicRun.seed.length > 0, `${templateName} runtime replay recipe seed is invalid`);
  assertRuntimeReplayInputSequence(recipe.deterministicRun?.inputSequence, `${templateName} runtime replay recipe inputSequence`);
  assert(Array.isArray(recipe.deterministicRun?.captureFrames) && recipe.deterministicRun.captureFrames.length > 0, `${templateName} runtime replay recipe captureFrames must be non-empty`);
  assertStringArray(recipe.canonicalState?.required, `${templateName} runtime replay recipe canonicalState.required`);
  assertStringArray(recipe.canonicalState?.excluded, `${templateName} runtime replay recipe canonicalState.excluded`);
  assertStringArray(recipe.implementationSteps, `${templateName} runtime replay recipe implementationSteps`);
  assert(recipe.canonicalState.excluded.includes("render commands"), `${templateName} runtime replay recipe must exclude render commands`);
  assert(recipe.canonicalState.excluded.includes("audio playback"), `${templateName} runtime replay recipe must exclude audio playback`);
}

function assertConsumerRuntimeReplayFixtureUpdateReport(report, templateName) {
  assert(report.format === "ferrum2d.consumer.runtime-gameplay-replay.fixture-update-report", `${templateName} runtime replay update format is invalid`);
  assert(report.version === 1, `${templateName} runtime replay update version is invalid`);
  assert(report.ok === true, `${templateName} runtime replay update must pass when configured`);
  assert(report.runtimeGameplayReplayFixture?.fixture === "public/gameplay-runtime-replay.fixture.json", `${templateName} runtime replay update fixture path is invalid`);
  assert(report.runtimeGameplayReplayFixture?.scenario === "project-runtime", `${templateName} runtime replay update scenario is invalid`);
  assert(
    report.runtimeGameplayReplayFixture?.coverageTagDefinitionsPath === "public/gameplay-runtime-replay.coverage-tags.json",
    `${templateName} runtime replay update coverage path is invalid`,
  );
  assertDeepEqual(report.runtimeGameplayReplayFixture?.coverageTags, ["project-runtime"], `${templateName} runtime replay update coverage tags are invalid`);
  assert(typeof report.runtimeGameplayReplayFixture?.replayHash === "string" && report.runtimeGameplayReplayFixture.replayHash.length > 0, `${templateName} runtime replay update replayHash is invalid`);
  assert(report.runtimeGameplayReplayFixture?.snapshotCount > 0, `${templateName} runtime replay update snapshotCount must be positive`);
}

function assertConsumerRuntimeReplayUpdateNotConfiguredReport(report, templateName) {
  assert(report.format === "ferrum2d.consumer.runtime-gameplay-replay.report", `${templateName} runtime replay update report format is invalid`);
  assert(report.version === 1, `${templateName} runtime replay update report version is invalid`);
  assert(report.ok === false, `${templateName} runtime replay update report must be ok=false while not configured`);
  assert(report.runtimeGameplayReplay?.configured === false, `${templateName} runtime replay update must keep configured=false`);
  assert(report.runtimeGameplayReplay?.status === "not-configured", `${templateName} runtime replay update status must be not-configured`);
  assert(report.runtimeGameplayReplay?.updateAttempted === true, `${templateName} runtime replay update report must mark updateAttempted`);
  assert(report.runtimeGameplayReplay?.recipe?.template === templateName, `${templateName} runtime replay update report recipe template is invalid`);
  assertMachineActionableReports(report.runtimeGameplayReplay?.reports, `${templateName} runtime replay update reports`);
  assert(
    report.runtimeGameplayReplay?.reports?.[0]?.code === "FERRUM_CONSUMER_RUNTIME_REPLAY_NOT_CONFIGURED",
    `${templateName} runtime replay update report must include not-configured diagnostic code`,
  );
}

function assertConsumerReplayFixtureUpdateReport(report, replayReport) {
  assert(report.format === "ferrum2d.consumer.gameplay-replay.fixture-update-report", "topdown replay fixture update report format is invalid");
  assert(report.version === 1, "topdown replay fixture update report version is invalid");
  assert(report.ok === true, "topdown replay fixture update report must be ok");
  assert(report.gameplayReplayFixture?.fixture === "public/gameplay-replay.fixture.json", "topdown replay fixture update report fixture path is invalid");
  assert(report.gameplayReplayFixture?.scenario === "topdown-template-game-spec", "topdown replay fixture update report scenario is invalid");
  assert(report.gameplayReplayFixture?.coverageTagDefinitionsPath === "public/gameplay-replay.coverage-tags.json", "topdown replay fixture update report coverage vocabulary path is invalid");
  assertDeepEqual(report.gameplayReplayFixture?.coverageTags, ["template-game-spec"], "topdown replay fixture update report coverage tags are invalid");
  assertTopdownCoverageRegistry(report.gameplayReplayFixture, "topdown replay fixture update report");
  assert(report.gameplayReplayFixture?.snapshotCount === 2, "topdown replay fixture update report snapshotCount is invalid");
  assert(
    report.gameplayReplayFixture?.replayHash === replayReport.gameplayReplay?.actualHash,
    "topdown replay fixture update hash must match the validated replay report actualHash",
  );
}

function assertTopdownStaleReplayReport(report) {
  assert(report.format === "ferrum2d.consumer.gameplay-replay.report", "stale topdown replay report format is invalid");
  assert(report.version === 1, "stale topdown replay report version is invalid");
  assert(report.ok === false, "stale topdown replay report must not be ok");
  assert(report.gameplayReplay?.packageName === "topdown", "stale topdown replay report packageName is invalid");
  assert(report.gameplayReplay?.configured === true, "stale topdown replay report must remain configured");
  assert(report.gameplayReplay?.status === "invalid", "stale topdown replay report must mark the fixture invalid");
  assert(report.gameplayReplay?.fixture === "public/gameplay-replay.fixture.json", "stale topdown replay report fixture path is invalid");
  assert(report.gameplayReplay?.coverageTagDefinitionsPath === "public/gameplay-replay.coverage-tags.json", "stale topdown replay report coverage vocabulary path is invalid");
  assertDeepEqual(report.gameplayReplay?.coverageTags, ["template-game-spec"], "stale topdown replay report coverage tags are invalid");
  assert(report.gameplayReplay?.expectedHash === "00000000", "stale topdown replay report must include the stale fixture hash");
  assert(Array.isArray(report.gameplayReplay?.reports), "stale topdown replay report must include gameplayReplay reports");
  assert(Array.isArray(report.diagnostics), "stale topdown replay report must include top-level diagnostics");
  assert(Array.isArray(report.reports), "stale topdown replay report must include top-level reports");
  assertMachineActionableReports(report.gameplayReplay.reports, "stale topdown replay report gameplayReplay.reports");
  assertMachineActionableReports(report.reports, "stale topdown replay report reports");
  assert(
    report.reports[0]?.code === "FERRUM_CONSUMER_REPLAY_FIXTURE_INVALID",
    "stale topdown replay report must use the replay fixture invalid code",
  );
  assert(
    report.gameplayReplay.reports[0]?.code === "FERRUM_CONSUMER_REPLAY_FIXTURE_INVALID",
    "stale topdown gameplayReplay report must use the replay fixture invalid code",
  );
  assert(
    report.reports[0]?.path === "public/gameplay-replay.fixture.json",
    "stale topdown replay report must point at the replay fixture path",
  );
  assert(
    String(report.reports[0]?.actual ?? "").includes("canonical run hash"),
    "stale topdown replay report must explain the canonical hash failure",
  );
}

function assertTopdownGameSpecDriftReplayReport(report) {
  assert(report.format === "ferrum2d.consumer.gameplay-replay.report", "drift topdown replay report format is invalid");
  assert(report.version === 1, "drift topdown replay report version is invalid");
  assert(report.ok === false, "drift topdown replay report must not be ok");
  assert(report.gameplayReplay?.packageName === "topdown", "drift topdown replay report packageName is invalid");
  assert(report.gameplayReplay?.configured === true, "drift topdown replay report must remain configured");
  assert(report.gameplayReplay?.status === "mismatch", "drift topdown replay report must mark the replay as mismatch");
  assert(report.gameplayReplay?.fixture === "public/gameplay-replay.fixture.json", "drift topdown replay report fixture path is invalid");
  assert(report.gameplayReplay?.coverageTagDefinitionsPath === "public/gameplay-replay.coverage-tags.json", "drift topdown replay report coverage vocabulary path is invalid");
  assertDeepEqual(report.gameplayReplay?.coverageTags, ["template-game-spec"], "drift topdown replay report coverage tags are invalid");
  assertTopdownCoverageRegistry(report.gameplayReplay, "drift topdown replay report");
  assert(report.gameplayReplay?.comparison?.passed === false, "drift topdown replay comparison must fail");
  assert(
    report.gameplayReplay?.expectedHash !== report.gameplayReplay?.actualHash,
    "drift topdown replay report must include different expected and actual hashes",
  );
  assert(Array.isArray(report.gameplayReplay?.reports), "drift topdown replay report must include gameplayReplay reports");
  assert(Array.isArray(report.gameplayReplay?.replayFixturePatches), "drift topdown replay report must include replay fixture patch candidates");
  assert(Array.isArray(report.reports), "drift topdown replay report must include top-level reports");
  assertMachineActionableReports(report.gameplayReplay.reports, "drift topdown replay report gameplayReplay.reports");
  assertMachineActionableReports(report.reports, "drift topdown replay report reports");
  assertMachineActionableReports(report.gameplayReplay.replayFixturePatches, "drift topdown replay report replayFixturePatches");
  assert(
    report.reports[0]?.code === "FERRUM_CONSUMER_REPLAY_MISMATCH",
    "drift topdown replay report must use the replay mismatch code",
  );
  assert(
    String(report.reports[0]?.path ?? "").includes("custom.templateReplay.spec.player.speed"),
    "drift topdown replay report must point at the changed Game Spec value",
  );
  const patch = report.gameplayReplay.replayFixturePatches[0];
  assert(
    patch?.code === "FERRUM_CONSUMER_REPLAY_FIXTURE_PATCH_CANDIDATE",
    "drift topdown replay report must include a fixture patch candidate code",
  );
  assert(
    patch?.path === "public/gameplay-replay.fixture.json",
    "drift topdown replay fixture patch must point at the fixture path",
  );
  assert(
    patch?.expected?.format === "ferrum2d.consumer.gameplay-replay.fixture",
    "drift topdown replay fixture patch must include candidate fixture content",
  );
  assert(
    patch?.expected?.coverageTagDefinitionsPath === "public/gameplay-replay.coverage-tags.json",
    "drift topdown replay fixture patch must include coverage vocabulary path",
  );
  assertDeepEqual(
    patch?.expected?.coverageTags,
    ["template-game-spec"],
    "drift topdown replay fixture patch must include coverage tags",
  );
  assert(
    patch?.expected?.replay?.replayHash === report.gameplayReplay.actualHash,
    "drift topdown replay fixture patch hash must match the actual replay hash",
  );
}

function assertTopdownCoverageRegistry(value, label) {
  assert(
    value?.coverageTagDefinitions?.["template-game-spec"] === "Consumer replay validates the generated Top-down template Game Spec contract.",
    `${label} must include resolved coverage tag definitions`,
  );
  assertDeepEqual(
    value?.coverageTagGroups,
    {
      "template-contracts": {
        description: "Consumer template replay contracts generated with create-game.",
        tags: ["template-game-spec"],
      },
    },
    `${label} coverage tag groups are invalid`,
  );
  assertDeepEqual(value?.deprecatedCoverageTags, {}, `${label} deprecated coverage tags are invalid`);
}

function assertMinimalCoverageRegistry(value, label) {
  assert(
    value?.coverageTagDefinitions?.["starter-runtime-template"] === "Consumer replay validates the generated Minimal Runtime template surface contract.",
    `${label} must include starter runtime template coverage definition`,
  );
  assert(
    value?.coverageTagDefinitions?.["template-weapon-authoring"] === "Consumer replay validates the Minimal Runtime projectile/weapon authoring surface.",
    `${label} must include template weapon authoring coverage definition`,
  );
  assertDeepEqual(
    value?.coverageTagGroups,
    {
      "template-contracts": {
        description: "Consumer template replay contracts generated with create-game.",
        tags: ["starter-runtime-template", "template-weapon-authoring"],
      },
    },
    `${label} coverage tag groups are invalid`,
  );
  assertDeepEqual(value?.deprecatedCoverageTags, {}, `${label} deprecated coverage tags are invalid`);
}

function assertPlatformerCoverageRegistry(value, label) {
  assert(
    value?.coverageTagDefinitions?.["platformer-template"] === "Consumer replay validates the generated Platformer template surface contract.",
    `${label} must include platformer template coverage definition`,
  );
  assertDeepEqual(
    value?.coverageTagGroups,
    {
      "template-contracts": {
        description: "Consumer template replay contracts generated with create-game.",
        tags: ["platformer-template"],
      },
    },
    `${label} coverage tag groups are invalid`,
  );
  assertDeepEqual(value?.deprecatedCoverageTags, {}, `${label} deprecated coverage tags are invalid`);
}

function assertMinimalTemplateAuthoringSurface(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must include authoringSurface object`);
  assertDeepEqual(
    value.weaponProfiles,
    ["standard", "piercing", "bounce"],
    `${label} weaponProfiles are invalid`,
  );
  assert(value.publicApis?.behaviorRecipeCommandsForEntity === true, `${label} must expose behaviorRecipeCommandsForEntity`);
  assert(value.publicApis?.compileWeaponProfiles === true, `${label} must expose compileWeaponProfiles`);
  assert(value.publicApis?.ProjectileDefinition === true, `${label} must expose ProjectileDefinition`);
  assert(value.publicApis?.WeaponDefinition === true, `${label} must expose WeaponDefinition`);
  assert(value.runtimeHooks?.applyGameplayBehaviorCommands === true, `${label} must expose applyGameplayBehaviorCommands`);
  assert(value.runtimeHooks?.builtInShooterPlayerHandle === true, `${label} must expose builtInShooterPlayerHandle`);
  assert(value.runtimeHooks?.setInputActionBinding === true, `${label} must expose setInputActionBinding`);
  assert(value.runtimeHooks?.profileQueryParam === true, `${label} must expose profile query param hook`);
}

function assertCoverageRegistryReport(value, label) {
  assert(
    value?.coverageTagDefinitions !== null
      && typeof value?.coverageTagDefinitions === "object"
      && !Array.isArray(value?.coverageTagDefinitions),
    `${label} coverage definitions must be an object`,
  );
  assert(Object.keys(value.coverageTagDefinitions).length > 0, `${label} coverage definitions must not be empty`);
  assert(
    value?.coverageTagGroups !== null
      && typeof value?.coverageTagGroups === "object"
      && !Array.isArray(value?.coverageTagGroups),
    `${label} coverage groups must be an object`,
  );
  assertDeepEqual(value?.deprecatedCoverageTags, {}, `${label} deprecated coverage tags are invalid`);
}

function assertMachineActionableReports(reports, label) {
  assert(Array.isArray(reports), `${label} must be an array`);
  for (const [index, report] of reports.entries()) {
    assert(report !== null && typeof report === "object" && !Array.isArray(report), `${label}[${index}] must be an object`);
    assert(typeof report.kind === "string" && report.kind.length > 0, `${label}[${index}].kind must be a non-empty string`);
    assert(typeof report.code === "string" && report.code.length > 0, `${label}[${index}].code must be a non-empty string`);
    assert(typeof report.path === "string" && report.path.length > 0, `${label}[${index}].path must be a non-empty string`);
    assert(typeof report.message === "string" && report.message.length > 0, `${label}[${index}].message must be a non-empty string`);
    assert(typeof report.suggestion === "string" && report.suggestion.length > 0, `${label}[${index}].suggestion must be a non-empty string`);
  }
}

function assertConsumerProjectileWeaponAuthoringContract(source, label) {
  assert(
    source.includes("ProjectileDefinition") &&
      source.includes("WeaponDefinition") &&
      source.includes("compileWeaponProfiles") &&
      source.includes("behaviorRecipeCommandsForEntity"),
    `${label} must document projectile/weapon authoring helpers`,
  );
}

function assertConsumerRuntimeApplyContract(source, label) {
  assert(
    source.includes("applyGameplayBehaviorCommands") &&
      source.includes("setInputActionBinding") &&
      source.includes("builtInShooterPlayerHandle"),
    `${label} must document public runtime apply helpers`,
  );
}

function assertConsumerArchitectureContract(source, label) {
  assert(
    source.includes("src/main.ts") &&
      source.includes("bootstrap") &&
      source.includes("src/runtime/") &&
      source.includes("src/game/") &&
      source.includes("src/assets/") &&
      source.includes("src/ui/") &&
      source.includes("src/dev/") &&
      source.includes("tests/playtest/"),
    `${label} must document consumer architecture module boundaries`,
  );
}

function assertForbiddenPublicImportBoundary(source, label) {
  assert(
    source.includes("@ferrum2d/ferrum-web") &&
      source.includes("@ferrum2d/ferrum-web/dist/*") &&
      source.includes("@ferrum2d/ferrum-web/pkg/*") &&
      source.includes("@ferrum2d/ferrum-web/src/*"),
    `${label} must document public entrypoint and forbidden internal imports`,
  );
}

function summarizeConsumerAuthoringReport(report) {
  return {
    status: report.gameplayAuthoring?.status,
    gameSpec: {
      ok: report.gameplayAuthoring?.gameSpec?.ok,
      file: report.gameplayAuthoring?.gameSpec?.file,
      message: report.gameplayAuthoring?.gameSpec?.message,
    },
    diagnostics: report.gameplayAuthoring?.diagnostics?.length ?? 0,
    reports: report.gameplayAuthoring?.reports?.length ?? 0,
    authoringSurface: report.gameplayAuthoring?.authoringSurface === undefined
      ? undefined
      : {
        weaponProfiles: report.gameplayAuthoring.authoringSurface.weaponProfiles,
        publicApis: report.gameplayAuthoring.authoringSurface.publicApis,
        runtimeHooks: report.gameplayAuthoring.authoringSurface.runtimeHooks,
      },
  };
}

function summarizeConsumerReplayReport(report) {
  return {
    status: report.gameplayReplay?.status,
    configured: report.gameplayReplay?.configured,
    scenario: report.gameplayReplay?.scenario,
    fixture: report.gameplayReplay?.fixture,
    coverageTags: report.gameplayReplay?.coverageTags,
    expectedHash: report.gameplayReplay?.expectedHash,
    actualHash: report.gameplayReplay?.actualHash,
    comparisonPassed: report.gameplayReplay?.comparison?.passed,
    reports: report.gameplayReplay?.reports?.length ?? 0,
  };
}

function summarizeConsumerRuntimeReplayReport(report) {
  return {
    status: report.runtimeGameplayReplay?.status,
    configured: report.runtimeGameplayReplay?.configured,
    scenario: report.runtimeGameplayReplay?.scenario,
    fixture: report.runtimeGameplayReplay?.fixture,
    coverageTags: report.runtimeGameplayReplay?.coverageTags,
    expectedHash: report.runtimeGameplayReplay?.expectedHash,
    actualHash: report.runtimeGameplayReplay?.actualHash,
    comparisonPassed: report.runtimeGameplayReplay?.comparison?.passed,
    reports: report.runtimeGameplayReplay?.reports?.length ?? 0,
  };
}

function summarizeConsumerRuntimeReplayRecipe(recipe) {
  return {
    template: recipe.template,
    status: recipe.status,
    scenario: recipe.scenario,
    coverageTags: recipe.coverageTags,
    fixedDelta: recipe.deterministicRun?.fixedDelta,
    inputFrames: recipe.deterministicRun?.inputSequence?.map((entry) => entry.frame),
    captureFrames: recipe.deterministicRun?.captureFrames,
  };
}

function summarizeRuntimeReplayFixtureUpdateReport(report) {
  return {
    status: "updated",
    fixture: report.runtimeGameplayReplayFixture?.fixture,
    scenario: report.runtimeGameplayReplayFixture?.scenario,
    coverageTags: report.runtimeGameplayReplayFixture?.coverageTags,
    replayHash: report.runtimeGameplayReplayFixture?.replayHash,
    snapshotCount: report.runtimeGameplayReplayFixture?.snapshotCount,
  };
}

function summarizeGameplayReplayFixtureUpdateReport(report) {
  return {
    status: "updated",
    fixture: report.gameplayReplayFixture?.fixture,
    scenario: report.gameplayReplayFixture?.scenario,
    coverageTags: report.gameplayReplayFixture?.coverageTags,
    replayHash: report.gameplayReplayFixture?.replayHash,
    snapshotCount: report.gameplayReplayFixture?.snapshotCount,
  };
}

function summarizeRejectedReport(report) {
  const firstReport = report?.reports?.[0] ?? report?.gameplayReplay?.reports?.[0] ?? report?.runtimeGameplayReplay?.reports?.[0];
  return {
    rejected: true,
    status: report?.gameplayReplay?.status ?? report?.runtimeGameplayReplay?.status,
    code: firstReport?.code,
    path: firstReport?.path,
    message: firstReport?.message,
  };
}

async function writeStaleTopdownReplayFixture(generatedGameRoot) {
  const fixturePath = path.join(generatedGameRoot, "public/gameplay-replay.fixture.json");
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  fixture.replay = {
    ...fixture.replay,
    replayHash: "00000000",
  };
  await writeJson(fixturePath, fixture);
}

async function writeTopdownGameSpecDrift(generatedGameRoot) {
  const gameSpecPath = path.join(generatedGameRoot, "public/game.json");
  const gameSpec = JSON.parse(await readFile(gameSpecPath, "utf8"));
  gameSpec.player = {
    ...gameSpec.player,
    speed: 211,
  };
  await writeJson(gameSpecPath, gameSpec);
}

function run(command, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      killChildTree(child, "SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          killChildTree(child, "SIGKILL");
        }
      }, 5000).unref();
    }, timeoutMs);
    timeout.unref();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr, timedOut, timeoutMs });
    });
  });
}

function killChildTree(child, signal) {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error?.code !== "ESRCH") {
        child.kill(signal);
      }
      return;
    }
  }
  child.kill(signal);
}

function commandFailureMessage(command, args, result) {
  const label = formatCommand(command, args);
  if (result.timedOut) {
    return `command timed out after ${result.timeoutMs}ms: ${label}\n${result.stdout}\n${result.stderr}`.trim();
  }
  return `command failed with exit code ${result.code}: ${label}\n${result.stdout}\n${result.stderr}`.trim();
}

async function requireFile(filePath, message) {
  const stats = await stat(filePath).catch((error) => {
    if (error?.code === "ENOENT") {
      throw new Error(message);
    }
    throw error;
  });
  assert(stats.isFile(), message);
}

async function assertMissing(filePath, message) {
  try {
    await stat(filePath);
    throw new Error(message);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
}

function buildConsumerSmokeReport({ status, error }) {
  const completedAt = new Date();
  return {
    format: CONSUMER_SMOKE_REPORT_FORMAT,
    version: CONSUMER_SMOKE_REPORT_VERSION,
    status,
    startedAt: smokeStartedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - smokeStartedAt.getTime(),
    packageManager,
    installMode: options.offline ? "offline" : "online",
    options: {
      skipBuild: options.skipBuild,
      skipPackageCheck: options.skipPackageCheck,
      keepTemp: options.keepTemp,
      artifactDir: options.artifactDir,
      commandTimeoutMs: options.commandTimeoutMs,
    },
    tarballs: {
      ferrumWeb: ferrumWebTarball === undefined ? undefined : path.basename(ferrumWebTarball),
      createGame: createGameTarball === undefined ? undefined : path.basename(createGameTarball),
      agents: agentsTarball === undefined ? undefined : path.basename(agentsTarball),
    },
    templates: templateSummaries,
    requestedTemplates: templateNames,
    artifactDir: options.artifactDir,
    tempRoot: options.keepTemp ? tempRoot : undefined,
    ...(error === undefined ? {} : { error }),
  };
}

async function writeConsumerSmokeArtifacts(report) {
  if (!tempRoot || !options.artifactDir) {
    return;
  }

  const artifactRoot = path.resolve(repoRoot, options.artifactDir);
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
  await writeJson(path.join(artifactRoot, "consumer-smoke-report.json"), report);
  await copyIfExists(path.join(tempRoot, "tarballs"), path.join(artifactRoot, "tarballs"));
  await copyTreeIfExists(path.join(tempRoot, "tool-consumer"), path.join(artifactRoot, "tool-consumer"));
  await copyTreeIfExists(path.join(tempRoot, "sample-games"), path.join(artifactRoot, "sample-games"));
}

async function copyIfExists(source, target) {
  try {
    await stat(source);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true });
}

async function copyTreeIfExists(source, target) {
  try {
    await stat(source);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    force: true,
    filter: (entry) => {
      const relative = path.relative(source, entry);
      return !relative.split(path.sep).some((part) => (
        part === "node_modules"
        || part === "dist"
        || part === ".pnpm"
      ));
    },
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[consumer smoke] ${message}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`[consumer smoke] ${message}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
}

function assertStringArray(value, message) {
  assert(Array.isArray(value), `${message} must be an array`);
  assert(value.length > 0, `${message} must not be empty`);
  for (const [index, item] of value.entries()) {
    assert(typeof item === "string" && item.length > 0, `${message}[${index}] must be a non-empty string`);
  }
}

function assertRuntimeReplayInputSequence(value, message) {
  assert(Array.isArray(value), `${message} must be an array`);
  for (const [index, entry] of value.entries()) {
    assert(entry !== null && typeof entry === "object" && !Array.isArray(entry), `${message}[${index}] must be an object`);
    assert(Number.isInteger(entry.frame) && entry.frame >= 0, `${message}[${index}].frame must be a non-negative integer`);
    assert(entry.action === "press" || entry.action === "release", `${message}[${index}].action must be press or release`);
    assert(typeof entry.control === "string" && entry.control.length > 0, `${message}[${index}].control must be a non-empty string`);
    for (const key of Object.keys(entry)) {
      assert(key === "frame" || key === "action" || key === "control", `${message}[${index}] has unsupported field ${key}`);
    }
  }
}

function describeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

function formatCommand(command, args) {
  return [command, ...args].map((part) => part.includes(" ") ? JSON.stringify(part) : part).join(" ");
}

function printHelp() {
  console.log(`Usage:
  pnpm package:consumer-smoke [options]

Options:
  --skip-build            Reuse existing ferrum-web dist/pkg artifacts
  --skip-package-check    Skip package allowlist and pack checks before consumer smoke
  --offline               Require all non-local dependencies to already be in the pnpm store
  --templates <names>     Comma-separated create-game templates to test. Default: every template
  --artifact-dir <path>   Copy the smoke report, tarballs, and light project snapshots to this directory
  --command-timeout-ms <n> Fail an individual child command after n milliseconds. Default: ${DEFAULT_COMMAND_TIMEOUT_MS}
  --keep-temp             Keep the temporary consumer project for inspection
  -h, --help              Show this help
`);
}
