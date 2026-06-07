#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const templatesRoot = path.join(repoRoot, "packages/create-game/templates");
const templateManifestPath = path.join(templatesRoot, "manifest.json");
const ferrumWebRoot = path.join(repoRoot, "packages/ferrum-web");
const configuredCommandTimeoutMs = Number(process.env.FERRUM_TEMPLATE_REPORT_TIMEOUT_MS ?? 60000);
const commandTimeoutMs = Number.isFinite(configuredCommandTimeoutMs) && configuredCommandTimeoutMs > 0
  ? configuredCommandTimeoutMs
  : 60000;

let tempRoot;

try {
  const templates = await readTemplateCatalog();
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ferrum-create-game-template-reports-"));

  const summaries = [];
  for (const template of templates) {
    const templateName = template.id;
    const projectRoot = path.join(tempRoot, templateName);
    await cp(path.join(templatesRoot, templateName), projectRoot, { recursive: true });
    await normalizePackageJson(projectRoot, templateName);
    if (await needsFerrumWebRuntime(projectRoot)) {
      await linkFerrumWeb(projectRoot);
    }

    const authoringReport = await runJsonReport(
      projectRoot,
      ["scripts/ferrum-harness.mjs", "authoring-report"],
      "ferrum2d.consumer.gameplay-authoring.report",
    );
    assertConsumerAuthoringReport(authoringReport, templateName);

    const replayReport = await runJsonReport(
      projectRoot,
      ["scripts/ferrum-harness.mjs", "replay-report"],
      "ferrum2d.consumer.gameplay-replay.report",
    );
    assertConsumerReplayReport(replayReport, template);

    const runtimeReplayReport = await runJsonReport(
      projectRoot,
      ["scripts/ferrum-runtime-replay.mjs", "report"],
      "ferrum2d.consumer.runtime-gameplay-replay.report",
    );
    assertConsumerRuntimeReplayReport(runtimeReplayReport, template);

    const runtimeReplayRecipe = await runJsonReport(
      projectRoot,
      ["scripts/ferrum-runtime-replay.mjs", "recipe"],
      "ferrum2d.consumer.runtime-gameplay-replay.recipe",
    );
    assertConsumerRuntimeReplayRecipe(runtimeReplayRecipe, template);

    if (template.runtimeGameplayReplay.configured) {
      const runtimeReplayUpdateReport = await runJsonReport(
        projectRoot,
        ["scripts/ferrum-runtime-replay.mjs", "update-fixture"],
        "ferrum2d.consumer.runtime-gameplay-replay.fixture-update-report",
      );
      assertConsumerRuntimeReplayFixtureUpdateReport(runtimeReplayUpdateReport, template);
      assert(await exists(path.join(projectRoot, template.runtimeGameplayReplay.fixturePath)), `${templateName} runtime replay update must keep fixture present`);
      assert(await exists(path.join(projectRoot, template.runtimeGameplayReplay.coverageTagDefinitionsPath)), `${templateName} runtime replay update must keep coverage tags present`);
    } else {
      const runtimeReplayUpdateReport = await runJsonReportAllowFailure(
        projectRoot,
        ["scripts/ferrum-runtime-replay.mjs", "update-fixture"],
        "ferrum2d.consumer.runtime-gameplay-replay.report",
      );
      assertConsumerRuntimeReplayUpdateNotConfiguredReport(runtimeReplayUpdateReport, templateName);
      assert(
        !await exists(path.join(projectRoot, "public/gameplay-runtime-replay.fixture.json")),
        `${templateName} runtime replay update must not create fixture while not configured`,
      );
      assert(
        !await exists(path.join(projectRoot, "public/gameplay-runtime-replay.coverage-tags.json")),
        `${templateName} runtime replay update must not create coverage tags while not configured`,
      );
    }

    summaries.push({
      template: templateName,
      replayCatalogConfigured: template.gameplayReplay.configured,
      authoringStatus: authoringReport.gameplayAuthoring.status,
      replayStatus: replayReport.gameplayReplay.status,
      replayConfigured: replayReport.gameplayReplay.configured,
      runtimeReplayStatus: runtimeReplayReport.runtimeGameplayReplay.status,
      runtimeReplayConfigured: runtimeReplayReport.runtimeGameplayReplay.configured,
      runtimeReplayRecipe: runtimeReplayRecipe.status,
    });
  }

  console.log("create-game template report envelope smoke ok");
  console.log(JSON.stringify({ templates: summaries }, null, 2));
} finally {
  if (tempRoot !== undefined) {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function readTemplateCatalog() {
  const manifest = JSON.parse(await readFile(templateManifestPath, "utf8"));
  assert.equal(manifest.format, "ferrum-create-game-template-catalog", "template manifest format is invalid");
  assert.equal(manifest.version, 1, "template manifest version is invalid");
  assert(Array.isArray(manifest.templates), "template manifest templates must be an array");
  assert(manifest.templates.length > 0, "template manifest must include at least one template");
  for (const entry of manifest.templates) {
    const templateName = entry.id;
    assert.equal(typeof templateName, "string", "template id must be a string");
    assert(templateName.length > 0, "template id must not be empty");
    assertTemplateReplayCatalog(entry, templateName);
    assertTemplateRuntimeReplayCatalog(entry, templateName);
    assert(await exists(path.join(templatesRoot, templateName, "scripts/ferrum-harness.mjs")), `${templateName} must include scripts/ferrum-harness.mjs`);
    assert(await exists(path.join(templatesRoot, templateName, "scripts/ferrum-runtime-replay.mjs")), `${templateName} must include scripts/ferrum-runtime-replay.mjs`);
  }
  return manifest.templates;
}

function assertTemplateRuntimeReplayCatalog(template, templateName) {
  assert.equal(typeof template.runtimeGameplayReplay?.configured, "boolean", `${templateName} runtimeGameplayReplay.configured must be a boolean`);
  if (template.runtimeGameplayReplay.configured) {
    assert.equal(template.runtimeGameplayReplay.scenario, "project-runtime", `${templateName} runtime replay scenario is invalid`);
    assert.equal(template.runtimeGameplayReplay.fixturePath, "public/gameplay-runtime-replay.fixture.json", `${templateName} runtime replay fixture path is invalid`);
    assert.equal(
      template.runtimeGameplayReplay.coverageTagDefinitionsPath,
      "public/gameplay-runtime-replay.coverage-tags.json",
      `${templateName} runtime replay coverage path is invalid`,
    );
  } else {
    assert.equal(typeof template.runtimeGameplayReplay.reason, "string", `${templateName} runtime replay reason must be a string`);
    assert(template.runtimeGameplayReplay.reason.length > 0, `${templateName} runtime replay reason must not be empty`);
  }
}

async function normalizePackageJson(projectRoot, templateName) {
  const file = path.join(projectRoot, "package.json");
  const packageJson = JSON.parse(await readFile(file, "utf8"));
  packageJson.name = templateName;
  packageJson.dependencies = {
    ...(packageJson.dependencies ?? {}),
    "@ferrum2d/ferrum-web": "0.0.0-smoke",
  };
  await writeFile(file, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function needsFerrumWebRuntime(projectRoot) {
  return await exists(path.join(projectRoot, "public/game.json"))
    || await exists(path.join(projectRoot, "public/gameplay-replay.fixture.json"));
}

async function linkFerrumWeb(projectRoot) {
  const scopeRoot = path.join(projectRoot, "node_modules/@ferrum2d");
  await mkdir(scopeRoot, { recursive: true });
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(ferrumWebRoot, path.join(scopeRoot, "ferrum-web"), linkType);
}

async function runJsonReport(projectRoot, args, expectedFormat) {
  const result = await runHarness(projectRoot, args);
  assert.equal(
    result.code,
    0,
    `${formatCommand(process.execPath, args)} must pass\n${result.stdout}\n${result.stderr}`.trim(),
  );
  return parseJsonReport(result.stdout, expectedFormat, formatCommand(process.execPath, args));
}

async function runJsonReportAllowFailure(projectRoot, args, expectedFormat) {
  const result = await runHarness(projectRoot, args);
  assert.notEqual(
    result.code,
    0,
    `${formatCommand(process.execPath, args)} must fail for the expected negative path`,
  );
  return parseJsonReport(result.stdout, expectedFormat, formatCommand(process.execPath, args));
}

function runHarness(projectRoot, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, commandTimeoutMs);
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
      clearTimeout(timer);
      if (timedOut) {
        stderr += `\nCommand timed out after ${commandTimeoutMs}ms.`;
      }
      if (stderr.trim().length > 0) {
        process.stderr.write(stderr);
      }
      resolve({ code: timedOut ? 1 : code, stdout, stderr });
    });
  });
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
  assert.equal(report.format, "ferrum2d.consumer.gameplay-authoring.report", `${templateName} authoring report format is invalid`);
  assert.equal(report.version, 1, `${templateName} authoring report version is invalid`);
  assert.equal(report.ok, true, `${templateName} authoring report must be ok for a generated template`);
  assert.equal(report.gameplayAuthoring?.packageName, templateName, `${templateName} authoring report packageName is invalid`);
  assert(Array.isArray(report.gameplayAuthoring?.diagnostics), `${templateName} authoring report diagnostics must be an array`);
  assert(Array.isArray(report.gameplayAuthoring?.reports), `${templateName} authoring report reports must be an array`);
  assertMachineActionableReports(report.gameplayAuthoring.reports, `${templateName} authoring report gameplayAuthoring.reports`);
  if (templateName === "topdown") {
    assert.equal(report.gameplayAuthoring.status, "validated", "topdown authoring report must validate public/game.json");
    assert.equal(report.gameplayAuthoring.gameSpec?.ok, true, "topdown authoring report must include a valid Game Spec result");
    assert.equal(report.gameplayAuthoring.gameSpec?.file, "public/game.json", "topdown authoring report must identify public/game.json");
  } else {
    assert.equal(report.gameplayAuthoring.status, "not-configured", `${templateName} authoring report must be not-configured`);
    assert.equal(report.gameplayAuthoring.gameSpec?.ok, null, `${templateName} authoring report must mark missing Game Spec as a structured skip`);
  }
}

function assertConsumerReplayReport(report, template) {
  const templateName = template.id;
  assert.equal(report.format, "ferrum2d.consumer.gameplay-replay.report", `${templateName} replay report format is invalid`);
  assert.equal(report.version, 1, `${templateName} replay report version is invalid`);
  assert.equal(report.ok, true, `${templateName} replay report must be ok for default templates`);
  assert.equal(report.gameplayReplay?.packageName, templateName, `${templateName} replay report packageName is invalid`);
  assert(Array.isArray(report.gameplayReplay?.reports), `${templateName} replay report reports must be an array`);
  assertMachineActionableReports(report.gameplayReplay.reports, `${templateName} replay report gameplayReplay.reports`);
  assert.equal(
    report.gameplayReplay?.configured,
    template.gameplayReplay.configured,
    `${templateName} replay report configured must match template manifest`,
  );
  if (template.gameplayReplay.configured) {
    assert.equal(report.gameplayReplay?.status, "validated", `${templateName} replay report must validate its replay fixture`);
    assert.equal(report.gameplayReplay?.scenario, template.gameplayReplay.scenario, "topdown replay report scenario is invalid");
    assert.equal(report.gameplayReplay?.fixture, template.gameplayReplay.fixturePath, `${templateName} replay report fixture path is invalid`);
    assert.equal(
      report.gameplayReplay?.coverageTagDefinitionsPath,
      template.gameplayReplay.coverageTagDefinitionsPath,
      `${templateName} replay report coverage vocabulary path is invalid`,
    );
    assertCoverageRegistryReport(report.gameplayReplay, templateName);
    assert.equal(report.gameplayReplay?.comparison?.passed, true, `${templateName} replay comparison must pass`);
    assert.equal(typeof report.gameplayReplay?.expectedHash, "string", `${templateName} replay report must include expectedHash`);
    assert.equal(report.gameplayReplay?.expectedHash, report.gameplayReplay?.actualHash, `${templateName} replay expectedHash and actualHash must match`);
  } else {
    assert.equal(report.gameplayReplay?.status, "not-configured", `${templateName} replay report must be not-configured`);
    assert.equal(report.gameplayReplay?.reason, "This template does not include a deterministic gameplay replay manifest.", `${templateName} replay report reason is invalid`);
    assert.equal(
      report.gameplayReplay?.reports?.[0]?.code,
      "FERRUM_CONSUMER_REPLAY_NOT_CONFIGURED",
      `${templateName} replay report must include the not-configured diagnostic code`,
    );
  }
}

function assertConsumerRuntimeReplayReport(report, template) {
  const templateName = template.id;
  assert.equal(report.format, "ferrum2d.consumer.runtime-gameplay-replay.report", `${templateName} runtime replay report format is invalid`);
  assert.equal(report.version, 1, `${templateName} runtime replay report version is invalid`);
  assert.equal(report.ok, true, `${templateName} runtime replay report must be ok`);
  assert.equal(report.runtimeGameplayReplay?.configured, template.runtimeGameplayReplay.configured, `${templateName} runtime replay configured flag is invalid`);
  assert.equal(report.runtimeGameplayReplay?.status, template.runtimeGameplayReplay.configured ? "validated" : "not-configured", `${templateName} runtime replay status is invalid`);
  assert.equal(report.runtimeGameplayReplay?.scenario, "project-runtime", `${templateName} runtime replay scenario is invalid`);
  assert.equal(report.runtimeGameplayReplay?.fixture, "public/gameplay-runtime-replay.fixture.json", `${templateName} runtime replay fixture path is invalid`);
  assert.equal(
    report.runtimeGameplayReplay?.coverageTagDefinitionsPath,
    "public/gameplay-runtime-replay.coverage-tags.json",
    `${templateName} runtime replay coverage path is invalid`,
  );
  assert.deepEqual(report.runtimeGameplayReplay?.coverageTags, ["project-runtime"], `${templateName} runtime replay coverage tags are invalid`);
  assert.equal(report.runtimeGameplayReplay?.recipe?.template, templateName, `${templateName} runtime replay report recipe template is invalid`);
  if (template.runtimeGameplayReplay.configured) {
    assert.deepEqual(report.runtimeGameplayReplay?.reports, [], `${templateName} runtime replay reports must be empty after validation`);
    assert.equal(report.runtimeGameplayReplay?.comparison?.passed, true, `${templateName} runtime replay comparison must pass`);
    assert.equal(report.runtimeGameplayReplay?.expectedHash, report.runtimeGameplayReplay?.actualHash, `${templateName} runtime replay hash must match`);
  } else {
    assertMachineActionableReports(report.runtimeGameplayReplay?.reports, `${templateName} runtime replay reports`);
    assert.equal(
      report.runtimeGameplayReplay?.reports?.[0]?.code,
      "FERRUM_CONSUMER_RUNTIME_REPLAY_NOT_CONFIGURED",
      `${templateName} runtime replay must include not-configured diagnostic code`,
    );
  }
}

function assertConsumerRuntimeReplayRecipe(recipe, template) {
  const templateName = template.id;
  assert.equal(recipe.format, "ferrum2d.consumer.runtime-gameplay-replay.recipe", `${templateName} runtime replay recipe format is invalid`);
  assert.equal(recipe.version, 1, `${templateName} runtime replay recipe version is invalid`);
  assert.equal(recipe.template, templateName, `${templateName} runtime replay recipe template is invalid`);
  assert.equal(recipe.scenario, "project-runtime", `${templateName} runtime replay recipe scenario is invalid`);
  assert.equal(recipe.status, template.runtimeGameplayReplay.configured ? "configured" : "scaffold", `${templateName} runtime replay recipe status is invalid`);
  assert.equal(recipe.fixture, "public/gameplay-runtime-replay.fixture.json", `${templateName} runtime replay recipe fixture path is invalid`);
  assert.equal(
    recipe.coverageTagDefinitionsPath,
    "public/gameplay-runtime-replay.coverage-tags.json",
    `${templateName} runtime replay recipe coverage path is invalid`,
  );
  assert.deepEqual(recipe.coverageTags, ["project-runtime"], `${templateName} runtime replay recipe coverage tags are invalid`);
  assert.equal(recipe.deterministicRun?.fixedDelta, 1 / 60, `${templateName} runtime replay recipe fixedDelta is invalid`);
  assert.equal(typeof recipe.deterministicRun?.seed, "string", `${templateName} runtime replay recipe seed must be a string`);
  assertRuntimeReplayInputSequence(recipe.deterministicRun?.inputSequence, `${templateName} runtime replay recipe inputSequence`);
  assert(Array.isArray(recipe.deterministicRun?.captureFrames), `${templateName} runtime replay recipe captureFrames must be an array`);
  assert(recipe.deterministicRun.captureFrames.length > 0, `${templateName} runtime replay recipe captureFrames must not be empty`);
  assertStringArray(recipe.canonicalState?.required, `${templateName} runtime replay recipe canonicalState.required`);
  assertStringArray(recipe.canonicalState?.excluded, `${templateName} runtime replay recipe canonicalState.excluded`);
  assertStringArray(recipe.implementationSteps, `${templateName} runtime replay recipe implementationSteps`);
  assert(recipe.canonicalState.excluded.includes("render commands"), `${templateName} runtime replay recipe must exclude render commands`);
  assert(recipe.canonicalState.excluded.includes("audio playback"), `${templateName} runtime replay recipe must exclude audio playback`);
}

function assertConsumerRuntimeReplayFixtureUpdateReport(report, template) {
  const templateName = template.id;
  assert.equal(report.format, "ferrum2d.consumer.runtime-gameplay-replay.fixture-update-report", `${templateName} runtime replay update format is invalid`);
  assert.equal(report.version, 1, `${templateName} runtime replay update version is invalid`);
  assert.equal(report.ok, true, `${templateName} runtime replay update must pass when configured`);
  assert.equal(report.runtimeGameplayReplayFixture?.fixture, template.runtimeGameplayReplay.fixturePath, `${templateName} runtime replay update fixture path is invalid`);
  assert.equal(report.runtimeGameplayReplayFixture?.scenario, template.runtimeGameplayReplay.scenario, `${templateName} runtime replay update scenario is invalid`);
  assert.equal(
    report.runtimeGameplayReplayFixture?.coverageTagDefinitionsPath,
    template.runtimeGameplayReplay.coverageTagDefinitionsPath,
    `${templateName} runtime replay update coverage path is invalid`,
  );
  assert.deepEqual(report.runtimeGameplayReplayFixture?.coverageTags, ["project-runtime"], `${templateName} runtime replay update coverage tags are invalid`);
  assert.equal(typeof report.runtimeGameplayReplayFixture?.replayHash, "string", `${templateName} runtime replay update replayHash must be a string`);
  assert(report.runtimeGameplayReplayFixture.replayHash.length > 0, `${templateName} runtime replay update replayHash must not be empty`);
  assert(report.runtimeGameplayReplayFixture?.snapshotCount > 0, `${templateName} runtime replay update snapshotCount must be positive`);
}

function assertConsumerRuntimeReplayUpdateNotConfiguredReport(report, templateName) {
  assert.equal(report.format, "ferrum2d.consumer.runtime-gameplay-replay.report", `${templateName} runtime replay update report format is invalid`);
  assert.equal(report.version, 1, `${templateName} runtime replay update report version is invalid`);
  assert.equal(report.ok, false, `${templateName} runtime replay update report must be ok=false while scaffold is not configured`);
  assert.equal(report.runtimeGameplayReplay?.configured, false, `${templateName} runtime replay update must keep configured=false`);
  assert.equal(report.runtimeGameplayReplay?.status, "not-configured", `${templateName} runtime replay update status must be not-configured`);
  assert.equal(report.runtimeGameplayReplay?.updateAttempted, true, `${templateName} runtime replay update report must mark updateAttempted`);
  assert.equal(report.runtimeGameplayReplay?.recipe?.template, templateName, `${templateName} runtime replay update report recipe template is invalid`);
  assertMachineActionableReports(report.runtimeGameplayReplay?.reports, `${templateName} runtime replay update reports`);
  assert.equal(
    report.runtimeGameplayReplay?.reports?.[0]?.code,
    "FERRUM_CONSUMER_RUNTIME_REPLAY_NOT_CONFIGURED",
    `${templateName} runtime replay update must include not-configured diagnostic code`,
  );
}

function assertCoverageRegistryReport(gameplayReplay, templateName) {
  assert(
    gameplayReplay?.coverageTagDefinitions !== null
      && typeof gameplayReplay?.coverageTagDefinitions === "object"
      && !Array.isArray(gameplayReplay?.coverageTagDefinitions),
    `${templateName} replay report coverage definitions must be an object`,
  );
  assert(Object.keys(gameplayReplay.coverageTagDefinitions).length > 0, `${templateName} replay report coverage definitions must not be empty`);
  assert(
    gameplayReplay?.coverageTagGroups !== null
      && typeof gameplayReplay?.coverageTagGroups === "object"
      && !Array.isArray(gameplayReplay?.coverageTagGroups),
    `${templateName} replay report coverage groups must be an object`,
  );
  assert.deepEqual(gameplayReplay?.deprecatedCoverageTags, {}, `${templateName} replay report deprecated coverage tags are invalid`);
}

function assertTemplateReplayCatalog(template, templateName) {
  const replay = template.gameplayReplay;
  assert(replay !== null && typeof replay === "object" && !Array.isArray(replay), `${templateName} gameplayReplay manifest entry must be an object`);
  assert.equal(typeof replay.configured, "boolean", `${templateName} gameplayReplay.configured must be boolean`);
  if (replay.configured) {
    assertNonEmptyString(replay.scenario, `${templateName} gameplayReplay.scenario`);
    assertNonEmptyString(replay.fixturePath, `${templateName} gameplayReplay.fixturePath`);
    assertNonEmptyString(replay.coverageTagDefinitionsPath, `${templateName} gameplayReplay.coverageTagDefinitionsPath`);
  } else {
    assertNonEmptyString(replay.reason, `${templateName} gameplayReplay.reason`);
  }
}

function assertMachineActionableReports(reports, label) {
  assert(Array.isArray(reports), `${label} must be an array`);
  for (const [index, report] of reports.entries()) {
    assertMachineActionableReport(report, `${label}[${index}]`);
  }
}

function assertMachineActionableReport(report, label) {
  assertNonEmptyString(report?.kind, `${label}.kind`);
  assertNonEmptyString(report?.code, `${label}.code`);
  assertNonEmptyString(report?.path, `${label}.path`);
  assertNonEmptyString(report?.message, `${label}.message`);
  assertNonEmptyString(report?.suggestion, `${label}.suggestion`);
}

function assertNonEmptyString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert(value.length > 0, `${label} must not be empty`);
}

function assertStringArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  assert(value.length > 0, `${label} must not be empty`);
  for (const [index, item] of value.entries()) {
    assertNonEmptyString(item, `${label}[${index}]`);
  }
}

function assertRuntimeReplayInputSequence(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  for (const [index, entry] of value.entries()) {
    assert(entry !== null && typeof entry === "object" && !Array.isArray(entry), `${label}[${index}] must be an object`);
    assert(Number.isInteger(entry.frame) && entry.frame >= 0, `${label}[${index}].frame must be a non-negative integer`);
    assert(entry.action === "press" || entry.action === "release", `${label}[${index}].action must be press or release`);
    assertNonEmptyString(entry.control, `${label}[${index}].control`);
    for (const key of Object.keys(entry)) {
      assert(key === "frame" || key === "action" || key === "control", `${label}[${index}] has unsupported field ${key}`);
    }
  }
}

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
