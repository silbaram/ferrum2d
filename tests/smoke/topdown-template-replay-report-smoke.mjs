#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const templateRoot = path.join(repoRoot, "packages/create-game/templates/topdown");
const ferrumWebRoot = path.join(repoRoot, "packages/ferrum-web");
const expectedCoverageTags = ["template-game-spec", "topdown-scene-composition-authoring"];
const expectedCoverageTagDefinitions = {
  "template-game-spec": "Consumer replay validates the generated Top-down template Game Spec contract.",
  "topdown-scene-composition-authoring": "Consumer replay validates the Top-down SceneComposition and BehaviorRecipe authoring surface.",
};
const expectedCoverageTagGroups = {
  "template-contracts": {
    description: "Consumer template replay contracts generated with create-game.",
    tags: expectedCoverageTags,
  },
};

let tempRoot;

try {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ferrum-topdown-template-replay-report-"));
  const projectRoot = path.join(tempRoot, "topdown");
  await cp(templateRoot, projectRoot, { recursive: true });
  await mkdir(path.join(projectRoot, "node_modules/@ferrum2d"), { recursive: true });
  await symlink(ferrumWebRoot, path.join(projectRoot, "node_modules/@ferrum2d/ferrum-web"), "dir");

  const validatedReport = await runJsonReport(projectRoot, ["scripts/ferrum-harness.mjs", "replay-report"]);
  assert.equal(validatedReport.format, "ferrum2d.consumer.gameplay-replay.report");
  assert.equal(validatedReport.ok, true);
  assert.equal(validatedReport.gameplayReplay?.status, "validated");
  assert.equal(
    validatedReport.gameplayReplay?.coverageTagDefinitionsPath,
    "public/gameplay-replay.coverage-tags.json",
  );
  assert.deepEqual(validatedReport.gameplayReplay?.coverageTags, expectedCoverageTags);
  assert.deepEqual(validatedReport.gameplayReplay?.coverageTagDefinitions, expectedCoverageTagDefinitions);
  assert.deepEqual(validatedReport.gameplayReplay?.coverageTagGroups, expectedCoverageTagGroups);
  assert.deepEqual(validatedReport.gameplayReplay?.deprecatedCoverageTags, {});
  assert.equal(validatedReport.gameplayReplay?.replayFixturePatches, undefined);

  await writeTopdownGameSpecDrift(projectRoot);
  const driftReportResult = await runJsonReportAllowFailure(projectRoot, ["scripts/ferrum-harness.mjs", "replay-report"]);
  assert.notEqual(driftReportResult.code, 0, "drift replay report must fail");
  const driftReport = driftReportResult.report;
  assert.equal(driftReport.format, "ferrum2d.consumer.gameplay-replay.report");
  assert.equal(driftReport.ok, false);
  assert.equal(driftReport.gameplayReplay?.status, "mismatch");
  const patch = driftReport.gameplayReplay?.replayFixturePatches?.[0];
  assert.equal(patch?.code, "FERRUM_CONSUMER_REPLAY_FIXTURE_PATCH_CANDIDATE");
  assert.equal(patch?.path, "public/gameplay-replay.fixture.json");
  assertMachineActionableReport(patch, "topdown replay fixture patch candidate");
  assert.equal(patch?.expected?.format, "ferrum2d.consumer.gameplay-replay.fixture");
  assert.equal(patch?.expected?.coverageTagDefinitionsPath, "public/gameplay-replay.coverage-tags.json");
  assert.deepEqual(patch?.expected?.coverageTags, expectedCoverageTags);
  assert.equal(patch?.expected?.replay?.replayHash, driftReport.gameplayReplay?.actualHash);

  const updateReport = await runJsonReport(projectRoot, ["scripts/ferrum-harness.mjs", "update-replay-fixture"]);
  assert.equal(updateReport.format, "ferrum2d.consumer.gameplay-replay.fixture-update-report");
  assert.equal(updateReport.ok, true);
  assert.equal(updateReport.gameplayReplayFixture?.coverageTagDefinitionsPath, "public/gameplay-replay.coverage-tags.json");
  assert.deepEqual(updateReport.gameplayReplayFixture?.coverageTags, expectedCoverageTags);
  assert.deepEqual(updateReport.gameplayReplayFixture?.coverageTagDefinitions, expectedCoverageTagDefinitions);
  assert.deepEqual(updateReport.gameplayReplayFixture?.coverageTagGroups, expectedCoverageTagGroups);
  assert.deepEqual(updateReport.gameplayReplayFixture?.deprecatedCoverageTags, {});
  assert.equal(updateReport.gameplayReplayFixture?.replayHash, driftReport.gameplayReplay?.actualHash);

  const replayReportAfterUpdate = await runJsonReport(projectRoot, ["scripts/ferrum-harness.mjs", "replay-report"]);
  assert.equal(replayReportAfterUpdate.ok, true);
  assert.equal(replayReportAfterUpdate.gameplayReplay?.status, "validated");
  assert.equal(replayReportAfterUpdate.gameplayReplay?.expectedHash, driftReport.gameplayReplay?.actualHash);

  console.log("topdown template replay report smoke ok");
} finally {
  if (tempRoot !== undefined) {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function writeTopdownGameSpecDrift(projectRoot) {
  const gameSpecPath = path.join(projectRoot, "public/game.json");
  const gameSpec = JSON.parse(await readFile(gameSpecPath, "utf8"));
  gameSpec.player = {
    ...gameSpec.player,
    speed: 211,
  };
  await writeFile(gameSpecPath, `${JSON.stringify(gameSpec, null, 2)}\n`);
}

async function runJsonReport(projectRoot, args) {
  const result = await runHarness(projectRoot, args);
  assert.equal(result.code, 0, `${formatCommand(process.execPath, args)} must pass`);
  return parseJsonReport(result.stdout, formatCommand(process.execPath, args));
}

async function runJsonReportAllowFailure(projectRoot, args) {
  const result = await runHarness(projectRoot, args);
  return {
    code: result.code,
    report: parseJsonReport(result.stdout, formatCommand(process.execPath, args)),
  };
}

function runHarness(projectRoot, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
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
      if (stderr.trim().length > 0) {
        process.stderr.write(stderr);
      }
      resolve({ code, stdout, stderr });
    });
  });
}

function parseJsonReport(stdout, commandLabel) {
  const start = stdout.indexOf("{");
  assert.ok(start >= 0, `${commandLabel} must emit a JSON report`);
  const end = findJsonObjectEnd(stdout, start);
  assert.ok(end >= 0, `${commandLabel} emitted an incomplete JSON report`);
  return JSON.parse(stdout.slice(start, end));
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

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

function assertMachineActionableReport(report, label) {
  assert.equal(typeof report?.kind, "string", `${label} kind must be a string`);
  assert.ok(report.kind.length > 0, `${label} kind must not be empty`);
  assert.equal(typeof report?.code, "string", `${label} code must be a string`);
  assert.ok(report.code.length > 0, `${label} code must not be empty`);
  assert.equal(typeof report?.path, "string", `${label} path must be a string`);
  assert.ok(report.path.length > 0, `${label} path must not be empty`);
  assert.equal(typeof report?.message, "string", `${label} message must be a string`);
  assert.ok(report.message.length > 0, `${label} message must not be empty`);
  assert.equal(typeof report?.suggestion, "string", `${label} suggestion must be a string`);
  assert.ok(report.suggestion.length > 0, `${label} suggestion must not be empty`);
}
