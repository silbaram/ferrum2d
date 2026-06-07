#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_ARTIFACT_DIR = "artifacts/consumer-smoke";
const REPORT_FORMAT = "ferrum2d.package.consumer-smoke.report";
const REPORT_VERSION = 1;
const EXPECTED_AGENT_FILES_CHECKED = 41;
const REQUIRED_TEMPLATE_CHECKS = Object.freeze([
  "createGame",
  "agentsDryRun",
  "agentsInstall",
  "install",
  "publicImportSmoke",
  "publicTypeSmoke",
  "validate",
  "build",
]);
const FORBIDDEN_SNAPSHOT_DIRS = Object.freeze(["node_modules", "dist", ".pnpm"]);

const options = parseArgs(process.argv.slice(2));
const report = JSON.parse(await readFile(options.reportPath, "utf8"));
const errors = [];

validateTopLevelReport(report, errors);
validateTemplates(report, errors);
if (options.validateArtifacts) {
  await validateArtifacts(report, errors);
}

const validationReport = {
  format: "ferrum2d.package.consumer-smoke.report.validation",
  version: 1,
  ok: errors.length === 0,
  reportPath: options.reportPath,
  artifactDir: options.artifactDir,
  expectedStatus: options.expectStatus,
  status: report.status,
  templateCount: Array.isArray(report.templates) ? report.templates.length : 0,
  errors,
};
console.log(JSON.stringify(validationReport, null, 2));
if (!validationReport.ok) {
  process.exitCode = 1;
}

function validateTopLevelReport(value, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push("report must be an object");
    return;
  }
  if (value.format !== REPORT_FORMAT) {
    reportErrors.push(`format must be ${REPORT_FORMAT}`);
  }
  if (value.version !== REPORT_VERSION) {
    reportErrors.push(`version must be ${REPORT_VERSION}`);
  }
  if (!["passed", "failed"].includes(value.status)) {
    reportErrors.push("status must be passed or failed");
  }
  if (options.expectStatus !== undefined && value.status !== options.expectStatus) {
    reportErrors.push(`status must be ${options.expectStatus}`);
  }
  if (!isIsoTimestamp(value.startedAt)) {
    reportErrors.push("startedAt must be an ISO timestamp");
  }
  if (!isIsoTimestamp(value.completedAt)) {
    reportErrors.push("completedAt must be an ISO timestamp");
  }
  if (!Number.isFinite(value.durationMs) || value.durationMs < 0) {
    reportErrors.push("durationMs must be a non-negative number");
  }
  if (typeof value.packageManager !== "string" || value.packageManager.length === 0) {
    reportErrors.push("packageManager must be a non-empty string");
  }
  if (!["online", "offline"].includes(value.installMode)) {
    reportErrors.push("installMode must be online or offline");
  }
  if (!isRecord(value.options)) {
    reportErrors.push("options must be an object");
  }
  if (!isRecord(value.tarballs)) {
    reportErrors.push("tarballs must be an object");
  } else if (value.status === "passed") {
    validateTarballName(value.tarballs.ferrumWeb, "tarballs.ferrumWeb", reportErrors);
    validateTarballName(value.tarballs.createGame, "tarballs.createGame", reportErrors);
    validateTarballName(value.tarballs.agents, "tarballs.agents", reportErrors);
  }
  if (!Array.isArray(value.requestedTemplates) || value.requestedTemplates.length === 0) {
    reportErrors.push("requestedTemplates must include at least one template");
  } else if (!value.requestedTemplates.every((template) => typeof template === "string" && template.length > 0)) {
    reportErrors.push("requestedTemplates entries must be non-empty strings");
  }
  if (!Array.isArray(value.templates)) {
    reportErrors.push("templates must be an array");
  }
  if (value.status === "passed" && isRecord(value.error)) {
    reportErrors.push("passed report must not include error");
  }
  if (value.status === "failed" && !isRecord(value.error)) {
    reportErrors.push("failed report must include error");
  } else if (value.status === "failed") {
    validateErrorSummary(value.error, "error", reportErrors);
  }
}

function validateTemplates(value, reportErrors) {
  if (!Array.isArray(value.templates)) {
    return;
  }
  const requestedTemplates = Array.isArray(value.requestedTemplates) ? value.requestedTemplates : [];
  if (value.status === "passed" && value.templates.length !== requestedTemplates.length) {
    reportErrors.push("passed report templates length must match requestedTemplates length");
  }

  for (const [index, template] of value.templates.entries()) {
    const label = `templates[${index}]`;
    if (!isRecord(template)) {
      reportErrors.push(`${label} must be an object`);
      continue;
    }
    if (typeof template.template !== "string" || template.template.length === 0) {
      reportErrors.push(`${label}.template must be a non-empty string`);
    }
    if (!["running", "passed", "failed"].includes(template.status)) {
      reportErrors.push(`${label}.status must be running, passed, or failed`);
    }
    if (value.status === "passed" && template.status !== "passed") {
      reportErrors.push(`${label}.status must be passed when report status is passed`);
    }
    if (value.status === "failed" && template.status === "failed") {
      validateErrorSummary(template.error, `${label}.error`, reportErrors);
    }
    validateTemplateChecks(template, label, value.status, reportErrors);
    validateTemplateAgents(template, label, value.status, reportErrors);
    validateTemplateReports(template, label, value.status, reportErrors);
    validateTopdownMutationChecks(template, label, value.status, reportErrors);
  }
}

function validateTemplateChecks(template, label, reportStatus, reportErrors) {
  if (!isRecord(template.checks)) {
    reportErrors.push(`${label}.checks must be an object`);
    return;
  }
  for (const checkName of REQUIRED_TEMPLATE_CHECKS) {
    if (typeof template.checks[checkName] !== "boolean") {
      reportErrors.push(`${label}.checks.${checkName} must be a boolean`);
    } else if (reportStatus === "passed" && template.checks[checkName] !== true) {
      reportErrors.push(`${label}.checks.${checkName} must be true`);
    }
  }
}

function validateTemplateAgents(template, label, reportStatus, reportErrors) {
  if (!isRecord(template.agents)) {
    if (reportStatus === "passed") {
      reportErrors.push(`${label}.agents must be an object`);
    }
    return;
  }
  if (!Array.isArray(template.agents.tools) || !sameMembers(template.agents.tools, ["codex", "claude", "gemini"])) {
    reportErrors.push(`${label}.agents.tools must include codex, claude, and gemini`);
  }
  if (template.agents.expectedFilesChecked !== EXPECTED_AGENT_FILES_CHECKED) {
    reportErrors.push(`${label}.agents.expectedFilesChecked must be ${EXPECTED_AGENT_FILES_CHECKED}`);
  }
  if (template.agents.unsupportedGeminiWrappersAbsent !== true) {
    reportErrors.push(`${label}.agents.unsupportedGeminiWrappersAbsent must be true`);
  }
}

function validateTemplateReports(template, label, reportStatus, reportErrors) {
  if (!isRecord(template.reports)) {
    if (reportStatus === "passed") {
      reportErrors.push(`${label}.reports must be an object`);
    }
    return;
  }
  if (reportStatus !== "passed") {
    return;
  }
  validateStatusString(template.reports.authoring?.status, `${label}.reports.authoring.status`, reportErrors);
  validateConfiguredReplaySummary(template.reports.gameplayReplay, `${label}.reports.gameplayReplay`, reportErrors);
  validateRuntimeReplaySummary(template.reports.runtimeReplay, `${label}.reports.runtimeReplay`, reportErrors);
  validateRuntimeRecipeSummary(template.reports.runtimeReplayRecipe, `${label}.reports.runtimeReplayRecipe`, reportErrors);
  if (!isRecord(template.buildOutput)) {
    reportErrors.push(`${label}.buildOutput must be an object`);
  } else {
    if (typeof template.buildOutput.distIndexHtml !== "string" || !template.buildOutput.distIndexHtml.endsWith("/dist/index.html")) {
      reportErrors.push(`${label}.buildOutput.distIndexHtml must point to dist/index.html`);
    }
    if (template.buildOutput.preservedInArtifactSnapshot !== false) {
      reportErrors.push(`${label}.buildOutput.preservedInArtifactSnapshot must be false`);
    }
  }
}

function validateConfiguredReplaySummary(value, label, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push(`${label} must be an object`);
    return;
  }
  validateStatusString(value.status, `${label}.status`, reportErrors);
  if (value.configured !== true) {
    reportErrors.push(`${label}.configured must be true`);
  }
  if (typeof value.scenario !== "string" || value.scenario.length === 0) {
    reportErrors.push(`${label}.scenario must be a non-empty string`);
  }
  if (!Array.isArray(value.coverageTags) || value.coverageTags.length === 0) {
    reportErrors.push(`${label}.coverageTags must be a non-empty array`);
  }
  if (typeof value.expectedHash !== "string" || value.expectedHash.length === 0) {
    reportErrors.push(`${label}.expectedHash must be a non-empty string`);
  }
  if (typeof value.actualHash !== "string" || value.actualHash.length === 0) {
    reportErrors.push(`${label}.actualHash must be a non-empty string`);
  }
  if (value.comparisonPassed !== true) {
    reportErrors.push(`${label}.comparisonPassed must be true`);
  }
}

function validateRuntimeReplaySummary(value, label, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push(`${label} must be an object`);
    return;
  }
  validateStatusString(value.status, `${label}.status`, reportErrors);
  if (typeof value.configured !== "boolean") {
    reportErrors.push(`${label}.configured must be a boolean`);
  }
  if (typeof value.scenario !== "string" || value.scenario.length === 0) {
    reportErrors.push(`${label}.scenario must be a non-empty string`);
  }
  if (!Array.isArray(value.coverageTags) || value.coverageTags.length === 0) {
    reportErrors.push(`${label}.coverageTags must be a non-empty array`);
  }
  if (value.configured === true) {
    if (typeof value.expectedHash !== "string" || value.expectedHash.length === 0) {
      reportErrors.push(`${label}.expectedHash must be a non-empty string when configured`);
    }
    if (typeof value.actualHash !== "string" || value.actualHash.length === 0) {
      reportErrors.push(`${label}.actualHash must be a non-empty string when configured`);
    }
    if (value.comparisonPassed !== true) {
      reportErrors.push(`${label}.comparisonPassed must be true when configured`);
    }
  } else if (value.configured === false) {
    if (value.status !== "not-configured") {
      reportErrors.push(`${label}.status must be not-configured when configured is false`);
    }
    if (!Number.isFinite(value.reports) || value.reports <= 0) {
      reportErrors.push(`${label}.reports must include at least one diagnostic when not configured`);
    }
  }
}

function validateRuntimeRecipeSummary(value, label, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push(`${label} must be an object`);
    return;
  }
  validateStatusString(value.status, `${label}.status`, reportErrors);
  if (typeof value.scenario !== "string" || value.scenario.length === 0) {
    reportErrors.push(`${label}.scenario must be a non-empty string`);
  }
  if (!Array.isArray(value.coverageTags) || value.coverageTags.length === 0) {
    reportErrors.push(`${label}.coverageTags must be a non-empty array`);
  }
  if (!Number.isFinite(value.fixedDelta) || value.fixedDelta <= 0) {
    reportErrors.push(`${label}.fixedDelta must be a positive number`);
  }
  if (!Array.isArray(value.captureFrames) || value.captureFrames.length === 0) {
    reportErrors.push(`${label}.captureFrames must be a non-empty array`);
  }
}

function validateTopdownMutationChecks(template, label, reportStatus, reportErrors) {
  if (reportStatus !== "passed" || template.template !== "topdown") {
    return;
  }
  const mutationChecks = template.mutationChecks;
  if (!isRecord(mutationChecks)) {
    reportErrors.push(`${label}.mutationChecks must be an object`);
    return;
  }
  validateRejectedSummary(mutationChecks.staleReplayFixtureRejected, `${label}.mutationChecks.staleReplayFixtureRejected`, reportErrors);
  validateFixtureUpdateSummary(mutationChecks.staleReplayFixtureUpdate, `${label}.mutationChecks.staleReplayFixtureUpdate`, reportErrors);
  validateRejectedSummary(mutationChecks.gameSpecDriftRejected, `${label}.mutationChecks.gameSpecDriftRejected`, reportErrors);
  validateFixtureUpdateSummary(mutationChecks.gameSpecDriftFixtureUpdate, `${label}.mutationChecks.gameSpecDriftFixtureUpdate`, reportErrors);
}

function validateRejectedSummary(value, label, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push(`${label} must be an object`);
    return;
  }
  if (value.rejected !== true) {
    reportErrors.push(`${label}.rejected must be true`);
  }
  if (typeof value.code !== "string" || value.code.length === 0) {
    reportErrors.push(`${label}.code must be a non-empty string`);
  }
  if (typeof value.message !== "string" || value.message.length === 0) {
    reportErrors.push(`${label}.message must be a non-empty string`);
  }
}

function validateFixtureUpdateSummary(value, label, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push(`${label} must be an object`);
    return;
  }
  if (value.status !== "updated") {
    reportErrors.push(`${label}.status must be updated`);
  }
  if (typeof value.replayHash !== "string" || value.replayHash.length === 0) {
    reportErrors.push(`${label}.replayHash must be a non-empty string`);
  }
  if (!Number.isFinite(value.snapshotCount) || value.snapshotCount <= 0) {
    reportErrors.push(`${label}.snapshotCount must be a positive number`);
  }
}

async function validateArtifacts(value, reportErrors) {
  await requireDirectory(options.artifactDir, reportErrors);
  await requireFile(options.reportPath, reportErrors);
  if (isRecord(value.tarballs)) {
    await requireTarball(value.tarballs.ferrumWeb, reportErrors);
    await requireTarball(value.tarballs.createGame, reportErrors);
    await requireTarball(value.tarballs.agents, reportErrors);
  }
  const requireSnapshots = value.status === "passed";
  await assertSnapshotHasNoForbiddenDirs(resolve(options.artifactDir, "tool-consumer"), "tool-consumer", reportErrors, {
    required: requireSnapshots,
  });
  await assertSnapshotHasNoForbiddenDirs(resolve(options.artifactDir, "sample-games"), "sample-games", reportErrors, {
    required: requireSnapshots,
  });
}

async function requireTarball(tarballName, reportErrors) {
  if (typeof tarballName !== "string" || tarballName.length === 0) {
    return;
  }
  await requireFile(resolve(options.artifactDir, "tarballs", tarballName), reportErrors);
}

async function requireDirectory(directoryPath, reportErrors) {
  try {
    const stats = await stat(directoryPath);
    if (!stats.isDirectory()) {
      reportErrors.push(`required artifact path must be a directory: ${relativePath(directoryPath)}`);
    }
  } catch (error) {
    reportErrors.push(`required artifact directory is missing: ${relativePath(directoryPath)} (${errorSummary(error)})`);
  }
}

async function requireFile(filePath, reportErrors) {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      reportErrors.push(`required artifact path must be a file: ${relativePath(filePath)}`);
    }
  } catch (error) {
    reportErrors.push(`required artifact file is missing: ${relativePath(filePath)} (${errorSummary(error)})`);
  }
}

async function assertSnapshotHasNoForbiddenDirs(snapshotRoot, label, reportErrors, { required }) {
  try {
    const stats = await stat(snapshotRoot);
    if (!stats.isDirectory()) {
      reportErrors.push(`${label} snapshot must be a directory`);
      return;
    }
  } catch (error) {
    if (required) {
      reportErrors.push(`${label} snapshot is missing (${errorSummary(error)})`);
    }
    return;
  }

  const forbiddenPaths = [];
  await walk(snapshotRoot, (entry) => {
    const relative = relativePath(entry, snapshotRoot);
    const parts = relative.split(sep);
    if (parts.some((part) => FORBIDDEN_SNAPSHOT_DIRS.includes(part))) {
      forbiddenPaths.push(relative);
    }
  });
  if (forbiddenPaths.length > 0) {
    reportErrors.push(`${label} snapshot must not include ${FORBIDDEN_SNAPSHOT_DIRS.join(", ")}: ${forbiddenPaths.slice(0, 5).join(", ")}`);
  }
}

async function walk(root, visit) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = resolve(root, entry.name);
    visit(entryPath);
    if (entry.isDirectory()) {
      await walk(entryPath, visit);
    }
  }
}

function parseArgs(args) {
  let artifactDir = resolve(REPO_ROOT, DEFAULT_ARTIFACT_DIR);
  let reportPath;
  let expectStatus;
  let validateArtifacts = true;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--artifact-dir") {
      artifactDir = resolve(REPO_ROOT, requiredArg(args, ++index, arg));
      continue;
    }
    if (arg.startsWith("--artifact-dir=")) {
      artifactDir = resolve(REPO_ROOT, arg.slice("--artifact-dir=".length));
      continue;
    }
    if (arg === "--report") {
      reportPath = resolve(REPO_ROOT, requiredArg(args, ++index, arg));
      continue;
    }
    if (arg.startsWith("--report=")) {
      reportPath = resolve(REPO_ROOT, arg.slice("--report=".length));
      continue;
    }
    if (arg === "--expect-status") {
      expectStatus = requiredStatus(args, ++index, arg);
      continue;
    }
    if (arg.startsWith("--expect-status=")) {
      expectStatus = parseStatus(arg.slice("--expect-status=".length), arg);
      continue;
    }
    if (arg === "--skip-artifacts") {
      validateArtifacts = false;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return {
    artifactDir,
    reportPath: reportPath ?? resolve(artifactDir, "consumer-smoke-report.json"),
    expectStatus,
    validateArtifacts,
  };
}

function requiredArg(args, index, flag) {
  const value = args[index];
  if (value === undefined || value.length === 0) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function requiredStatus(args, index, flag) {
  return parseStatus(requiredArg(args, index, flag), flag);
}

function parseStatus(value, flag) {
  if (!["passed", "failed"].includes(value)) {
    throw new Error(`${flag} must be passed or failed`);
  }
  return value;
}

function validateStatusString(value, label, reportErrors) {
  if (typeof value !== "string" || value.length === 0) {
    reportErrors.push(`${label} must be a non-empty string`);
  }
}

function validateTarballName(value, label, reportErrors) {
  if (typeof value !== "string" || !value.endsWith(".tgz")) {
    reportErrors.push(`${label} must be a .tgz filename`);
  }
}

function validateErrorSummary(value, label, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push(`${label} must be an object`);
    return;
  }
  if (typeof value.message !== "string" || value.message.length === 0) {
    reportErrors.push(`${label}.message must be a non-empty string`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function sameMembers(value, expected) {
  if (!Array.isArray(value) || value.length !== expected.length) {
    return false;
  }
  const set = new Set(value);
  return expected.every((entry) => set.has(entry));
}

function relativePath(value, from = REPO_ROOT) {
  return value.startsWith(REPO_ROOT) ? value.slice(from.length + 1) : value;
}

function errorSummary(error) {
  return error instanceof Error ? error.message : String(error);
}

function printHelp() {
  console.log(`Usage:
  node scripts/validate/validate-consumer-smoke-report.mjs [options]

Options:
  --artifact-dir <path>     Artifact directory. Default: ${DEFAULT_ARTIFACT_DIR}
  --report <path>           Report JSON path. Default: <artifact-dir>/consumer-smoke-report.json
  --expect-status <status>  Require passed or failed
  --skip-artifacts          Validate JSON only, without checking tarballs/snapshots
  -h, --help                Show this help
`);
}
