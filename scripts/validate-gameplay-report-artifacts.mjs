#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readJsonSchemaContract,
  validateJsonSchemaContract,
} from "./json-schema-contract.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_AUTHORING_REPORT_PATH = "artifacts/gameplay-authoring-dry-run/gameplay-authoring-dry-run-report.json";
const DEFAULT_REPLAY_REPORT_PATH = "artifacts/gameplay-replay-smoke/gameplay-replay-smoke-report.json";
const AUTHORING_SCHEMA_PATH = "schemas/gameplay-authoring-dry-run-report.schema.json";
const REPLAY_SCHEMA_PATH = "schemas/gameplay-replay-smoke-report.schema.json";

const options = parseArgs(process.argv.slice(2));
const validations = [];
if (!options.skipAuthoring) {
  validations.push(validateReportArtifact({
    kind: "gameplay-authoring",
    reportPath: options.authoringReportPath,
    schemaPath: resolve(REPO_ROOT, AUTHORING_SCHEMA_PATH),
  }));
}
if (!options.skipReplay) {
  validations.push(validateReportArtifact({
    kind: "gameplay-replay",
    reportPath: options.replayReportPath,
    schemaPath: resolve(REPO_ROOT, REPLAY_SCHEMA_PATH),
  }));
}

const results = await Promise.all(validations);
const report = {
  format: "ferrum2d.gameplay-report-artifacts.validation",
  version: 1,
  ok: results.every((result) => result.ok),
  reports: results,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  process.exitCode = 1;
}

async function validateReportArtifact({ kind, reportPath, schemaPath }) {
  try {
    const schema = await readJsonSchemaContract(schemaPath);
    const artifact = JSON.parse(await readFile(reportPath, "utf8"));
    validateJsonSchemaContract(schema, artifact, kind);
    const semanticErrors = semanticReportArtifactErrors(kind, artifact);
    if (semanticErrors.length > 0) {
      throw new Error(semanticErrors.join("; "));
    }
    return {
      kind,
      ok: true,
      reportPath,
      schemaPath,
      format: artifact.format,
      version: artifact.version,
    };
  } catch (error) {
    return {
      kind,
      ok: false,
      reportPath,
      schemaPath,
      error: errorSummary(error),
    };
  }
}

function semanticReportArtifactErrors(kind, artifact) {
  if (kind === "gameplay-authoring") {
    return gameplayAuthoringReportErrors(artifact);
  }
  if (kind === "gameplay-replay") {
    return gameplayReplayReportErrors(artifact);
  }
  return [];
}

function gameplayAuthoringReportErrors(artifact) {
  const errors = [];
  const dryRun = artifact.gameplayAuthoringDryRun;
  if (artifact.ok !== true) {
    errors.push("gameplay-authoring report ok must be true");
  }
  if (!isRecord(dryRun)) {
    return [...errors, "gameplayAuthoringDryRun must be an object"];
  }
  if ((dryRun.commandCount ?? 0) <= 0) {
    errors.push("gameplayAuthoringDryRun.commandCount must be positive");
  }
  if ((dryRun.instanceCount ?? 0) <= 0) {
    errors.push("gameplayAuthoringDryRun.instanceCount must be positive");
  }
  if (Array.isArray(dryRun.diagnostics) && dryRun.diagnostics.length > 0) {
    errors.push("gameplayAuthoringDryRun.diagnostics must be empty");
  }
  if (Array.isArray(dryRun.reports) && dryRun.reports.length > 0) {
    errors.push("gameplayAuthoringDryRun.reports must be empty");
  }
  if (Array.isArray(artifact.diagnostics) && artifact.diagnostics.length > 0) {
    errors.push("diagnostics must be empty");
  }
  if (Array.isArray(artifact.reports) && artifact.reports.length > 0) {
    errors.push("reports must be empty");
  }
  if (dryRun.replay?.linked !== true) {
    errors.push("gameplayAuthoringDryRun.replay.linked must be true");
  }
  if (dryRun.replay?.fixtureIndex?.linked !== true) {
    errors.push("gameplayAuthoringDryRun.replay.fixtureIndex.linked must be true");
  }
  return errors;
}

function gameplayReplayReportErrors(artifact) {
  const errors = [];
  const runs = artifact.gameplayReplaySmoke;
  if (artifact.ok !== true) {
    errors.push("gameplay-replay report ok must be true");
  }
  if (!Array.isArray(runs) || runs.length === 0) {
    return [...errors, "gameplayReplaySmoke must include at least one scenario"];
  }
  for (const [index, run] of runs.entries()) {
    if (!isRecord(run)) {
      errors.push(`gameplayReplaySmoke[${index}] must be an object`);
      continue;
    }
    if (run.passed !== true) {
      errors.push(`gameplayReplaySmoke[${index}].passed must be true`);
    }
    if ((run.frameCount ?? 0) <= 0) {
      errors.push(`gameplayReplaySmoke[${index}].frameCount must be positive`);
    }
    if ((run.snapshots ?? 0) <= 0) {
      errors.push(`gameplayReplaySmoke[${index}].snapshots must be positive`);
    }
  }
  return errors;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArgs(args) {
  let authoringReportPath = resolve(REPO_ROOT, DEFAULT_AUTHORING_REPORT_PATH);
  let replayReportPath = resolve(REPO_ROOT, DEFAULT_REPLAY_REPORT_PATH);
  let skipAuthoring = false;
  let skipReplay = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--authoring-report") {
      authoringReportPath = resolve(REPO_ROOT, requiredArg(args, ++index, arg));
      continue;
    }
    if (arg.startsWith("--authoring-report=")) {
      authoringReportPath = resolve(REPO_ROOT, arg.slice("--authoring-report=".length));
      continue;
    }
    if (arg === "--replay-report") {
      replayReportPath = resolve(REPO_ROOT, requiredArg(args, ++index, arg));
      continue;
    }
    if (arg.startsWith("--replay-report=")) {
      replayReportPath = resolve(REPO_ROOT, arg.slice("--replay-report=".length));
      continue;
    }
    if (arg === "--skip-authoring") {
      skipAuthoring = true;
      continue;
    }
    if (arg === "--skip-replay") {
      skipReplay = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (skipAuthoring && skipReplay) {
    throw new Error("at least one report artifact must be validated");
  }
  return {
    authoringReportPath,
    replayReportPath,
    skipAuthoring,
    skipReplay,
  };
}

function requiredArg(args, index, flag) {
  const value = args[index];
  if (value === undefined || value.length === 0) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function errorSummary(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return {
    name: "Error",
    message: String(error),
  };
}
