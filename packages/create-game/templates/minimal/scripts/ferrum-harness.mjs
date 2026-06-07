#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const command = process.argv[2] ?? "report";
const REPLAY_COVERAGE_TAGS_FORMAT = "ferrum2d.consumer.gameplay-replay.coverage-tags";
const REPLAY_COVERAGE_TAGS_VERSION = 1;
const REPLAY_FIXTURE_FORMAT = "ferrum2d.consumer.gameplay-replay.fixture";
const REPLAY_FIXTURE_VERSION = 1;
const REPLAY_SCENARIO = "minimal-template-surface";
const REPLAY_COVERAGE_TAGS_PATH = "public/gameplay-replay.coverage-tags.json";
const REPLAY_COVERAGE_TAGS = Object.freeze(["starter-runtime-template", "template-weapon-authoring"]);

try {
  if (command === "validate") {
    await validateProject();
  } else if (command === "smoke") {
    await validateProject();
    await runBuild();
  } else if (command === "report") {
    await printReport();
  } else if (command === "authoring-report") {
    await printAuthoringReport();
  } else if (command === "replay-report") {
    await printReplayReport();
  } else if (command === "update-replay-fixture") {
    await updateReplayFixture();
  } else {
    throw new Error(`Unknown ferrum harness command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function validateProject() {
  const result = await inspectProject();
  const errors = [];

  if (!result.hasFerrumDependency) {
    errors.push("package.json must depend on @ferrum2d/ferrum-web.");
  }
  if (!result.hasMainSource) {
    errors.push("src/main.ts is required.");
  }
  for (const importPath of result.internalImports) {
    errors.push(`Use the public package entrypoint instead of internal import: ${importPath}`);
  }
  if (result.gameSpec?.ok === false) {
    errors.push(`Game Spec validation failed at ${result.gameSpec.path}: ${result.gameSpec.message}`);
  }

  if (errors.length > 0) {
    console.error("Ferrum2D validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("Ferrum2D validation ok");
  if (result.gameSpec?.ok === true) {
    console.log(`- game spec: ${result.gameSpec.file}`);
  } else {
    console.log("- game spec: not present, skipped");
  }
}

async function printReport() {
  const result = await inspectProject();
  const report = {
    packageName: result.packageJson.name,
    ferrumWeb: result.packageJson.dependencies?.["@ferrum2d/ferrum-web"] ?? null,
    scripts: result.packageJson.scripts ?? {},
    files: {
      main: result.hasMainSource,
      gameSpec: result.gameSpec?.file ?? null,
      publicAssets: result.publicAssets,
    },
    authoringSurface: result.authoringSurface,
    checks: {
      hasFerrumDependency: result.hasFerrumDependency,
      internalImports: result.internalImports,
      gameSpec: result.gameSpec ?? { ok: null, message: "not present" },
    },
    recommendedCommands: [
      "npm run ferrum:validate",
      "npm run ferrum:authoring-report",
      "npm run ferrum:replay-report",
      "npm run ferrum:smoke",
      "npm run dev",
    ],
  };
  console.log(JSON.stringify(report, null, 2));
}

async function printAuthoringReport() {
  const result = await inspectProject();
  const diagnostics = validationDiagnostics(result, { requireGameSpec: false });
  const report = {
    format: "ferrum2d.consumer.gameplay-authoring.report",
    version: 1,
    ok: diagnostics.length === 0,
    gameplayAuthoring: {
      packageName: result.packageJson.name,
      status: authoringStatus(result),
      authoringSurface: result.authoringSurface,
      gameSpec: result.gameSpec ?? { ok: null, message: "public/game.json not present" },
      publicAssets: result.publicAssets,
      diagnostics,
      reports: diagnostics.map(reportFromDiagnostic),
    },
    ...(diagnostics.length === 0 ? {} : {
      diagnostics,
      reports: diagnostics.map(reportFromDiagnostic),
    }),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function printReplayReport() {
  const result = await inspectProject();
  const diagnostics = validationDiagnostics(result, { requireGameSpec: false });
  const reports = diagnostics.map(reportFromDiagnostic);
  const replayFixturePatches = [];
  let fixture;
  let actualRun;
  let comparison;
  if (diagnostics.length === 0) {
    try {
      fixture = await loadReplayFixture();
      actualRun = await createTemplateReplayRun(result);
      const { compareGameplayReplayRuns } = await import("@ferrum2d/ferrum-web");
      comparison = compareGameplayReplayRuns(fixture.replay, actualRun);
      if (!comparison.passed) {
        replayFixturePatches.push(replayFixturePatchCandidate(actualRun, fixture));
        reports.push({
          kind: "gameplay-replay",
          code: "FERRUM_CONSUMER_REPLAY_MISMATCH",
          path: comparison.firstMismatch?.path ?? "public/gameplay-replay.fixture.json.replayHash",
          message: "Minimal template replay fixture does not match the current template contract.",
          expected: comparison.firstMismatch?.expected ?? comparison.expectedHash,
          actual: comparison.firstMismatch?.actual ?? comparison.actualHash,
          suggestion: "Update the template intentionally, then regenerate public/gameplay-replay.fixture.json.",
        });
      }
    } catch (error) {
      const entry = replayFixtureDiagnostic(replayFixtureErrorPath(error), error instanceof Error ? error.message : String(error));
      diagnostics.push(entry);
      reports.push(reportFromDiagnostic(entry));
    }
  }
  const ok = diagnostics.length === 0 && comparison?.passed === true;
  const report = {
    format: "ferrum2d.consumer.gameplay-replay.report",
    version: 1,
    ok,
    gameplayReplay: {
      packageName: result.packageJson.name,
      status: ok ? "validated" : (diagnostics.length > 0 ? "invalid" : "mismatch"),
      configured: true,
      scenario: fixture?.scenario ?? REPLAY_SCENARIO,
      fixture: "public/gameplay-replay.fixture.json",
      coverageTagDefinitionsPath: fixture?.coverageTagDefinitionsPath ?? REPLAY_COVERAGE_TAGS_PATH,
      coverageTags: fixture?.coverageTags ?? REPLAY_COVERAGE_TAGS,
      coverageTagDefinitions: fixture?.coverageTagDefinitions,
      coverageTagGroups: fixture?.coverageTagGroups,
      deprecatedCoverageTags: fixture?.deprecatedCoverageTags,
      expectedHash: comparison?.expectedHash ?? fixture?.replay?.replayHash,
      actualHash: comparison?.actualHash ?? actualRun?.replayHash,
      comparison,
      reports,
      ...(replayFixturePatches.length === 0 ? {} : { replayFixturePatches }),
    },
    ...(ok ? {} : {
      diagnostics,
      reports,
    }),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function updateReplayFixture() {
  const result = await inspectProject();
  const diagnostics = validationDiagnostics(result, { requireGameSpec: false });
  if (diagnostics.length > 0) {
    console.error("Ferrum2D replay fixture update failed:");
    for (const entry of diagnostics) console.error(`- ${entry.message}`);
    process.exit(1);
  }
  const replay = await createTemplateReplayRun(result);
  const coverage = await loadReplayCoverageTags(REPLAY_COVERAGE_TAGS_PATH);
  const fixture = templateReplayFixture(replay);
  assertCoverageTags(fixture.coverageTags, coverage.coverageTagDefinitions, coverage.deprecatedCoverageTags, "public/gameplay-replay.fixture.json.coverageTags");
  await writeFile(path.join(root, "public/gameplay-replay.fixture.json"), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(JSON.stringify({
    format: "ferrum2d.consumer.gameplay-replay.fixture-update-report",
    version: 1,
    ok: true,
    gameplayReplayFixture: {
      packageName: result.packageJson.name,
      fixture: "public/gameplay-replay.fixture.json",
      scenario: fixture.scenario,
      coverageTagDefinitionsPath: fixture.coverageTagDefinitionsPath,
      coverageTags: fixture.coverageTags,
      coverageTagDefinitions: coverage.coverageTagDefinitions,
      coverageTagGroups: coverage.coverageTagGroups,
      deprecatedCoverageTags: coverage.deprecatedCoverageTags,
      replayHash: replay.replayHash,
      snapshotCount: replay.snapshots.length,
    },
  }, null, 2));
}

async function inspectProject() {
  const packageJson = await readJson(path.join(root, "package.json"));
  const mainPath = path.join(root, "src/main.ts");
  const hasMainSource = await exists(mainPath);
  const mainSource = hasMainSource ? await readFile(mainPath, "utf8") : "";
  const internalImports = [...mainSource.matchAll(/from\s+["'](@ferrum2d\/ferrum-web\/(?:dist|pkg|src)\/[^"']*)["']/g)]
    .map((match) => match[1]);
  return {
    packageJson,
    hasFerrumDependency: packageJson.dependencies?.["@ferrum2d/ferrum-web"] !== undefined,
    hasMainSource,
    internalImports,
    authoringSurface: inspectTemplateAuthoringSurface(mainSource),
    gameSpec: await inspectGameSpec(),
    publicAssets: await listPublicAssets(),
  };
}

function inspectTemplateAuthoringSurface(mainSource) {
  return {
    weaponProfiles: ["standard", "piercing", "bounce"].filter((profile) => (
      mainSource.includes(`"${profile}"`)
    )),
    publicApis: {
      behaviorRecipeCommandsForEntity: mainSource.includes("behaviorRecipeCommandsForEntity"),
      compileWeaponProfiles: mainSource.includes("compileWeaponProfiles"),
      ProjectileDefinition: mainSource.includes("ProjectileDefinition"),
      WeaponDefinition: mainSource.includes("WeaponDefinition"),
    },
    runtimeHooks: {
      applyGameplayBehaviorCommands: mainSource.includes("applyGameplayBehaviorCommands"),
      builtInShooterPlayerHandle: mainSource.includes("builtInShooterPlayerHandle"),
      setInputActionBinding: mainSource.includes("setInputActionBinding"),
      profileQueryParam: mainSource.includes('searchParams.get("profile")'),
    },
  };
}

function validationDiagnostics(result, { requireGameSpec }) {
  const diagnostics = [];
  if (!result.hasFerrumDependency) {
    diagnostics.push(diagnostic("package.json.dependencies.@ferrum2d/ferrum-web", "package.json must depend on @ferrum2d/ferrum-web"));
  }
  if (!result.hasMainSource) {
    diagnostics.push(diagnostic("src/main.ts", "src/main.ts is required"));
  }
  for (const importPath of result.internalImports) {
    diagnostics.push(diagnostic("src/main.ts", `Use the public package entrypoint instead of internal import: ${importPath}`));
  }
  if (requireGameSpec && result.gameSpec === undefined) {
    diagnostics.push(diagnostic("public/game.json", "public/game.json is required"));
  }
  if (result.gameSpec?.ok === false) {
    diagnostics.push(diagnostic(result.gameSpec.path, result.gameSpec.message));
  }
  return diagnostics;
}

function authoringStatus(result) {
  if (result.gameSpec === undefined) return "not-configured";
  if (result.gameSpec.ok === false) return "invalid";
  return "validated";
}

function diagnostic(path, detail) {
  return {
    code: "FERRUM_CONSUMER_AUTHORING_INVALID",
    message: `Invalid Ferrum2D consumer authoring data: path=${JSON.stringify(path)} detail=${JSON.stringify(detail)}.`,
    context: {
      kind: "consumer-gameplay-authoring",
      path,
      detail,
    },
  };
}

function reportFromDiagnostic(entry) {
  return {
    kind: "consumer-gameplay-authoring",
    code: entry.code,
    path: entry.context.path,
    message: entry.message,
    expected: "valid Ferrum2D consumer project authoring data",
    actual: entry.context.detail,
    suggestion: "Fix the reported file/path and rerun npm run ferrum:authoring-report.",
  };
}

function replayFixtureDiagnostic(path, detail) {
  return {
    code: "FERRUM_CONSUMER_REPLAY_FIXTURE_INVALID",
    message: `Invalid Ferrum2D consumer replay fixture: path=${JSON.stringify(path)} detail=${JSON.stringify(detail)}.`,
    context: {
      kind: "consumer-gameplay-replay",
      path,
      detail,
    },
  };
}

function replayFixturePatchCandidate(actualRun, fixture) {
  return {
    kind: "consumer-gameplay-replay-fixture",
    code: "FERRUM_CONSUMER_REPLAY_FIXTURE_PATCH_CANDIDATE",
    path: "public/gameplay-replay.fixture.json",
    message: "Current minimal template contract can be promoted to the replay fixture.",
    expected: templateReplayFixture(actualRun),
    actual: {
      scenario: fixture.scenario,
      replayHash: fixture.replay?.replayHash,
    },
    suggestion: "If the template change is intentional, run npm run ferrum:update-replay-fixture and rerun npm run ferrum:replay-report.",
  };
}

async function loadReplayFixture() {
  const fixture = await readJson(path.join(root, "public/gameplay-replay.fixture.json"));
  if (fixture.format !== REPLAY_FIXTURE_FORMAT) {
    throw replayFixtureError("public/gameplay-replay.fixture.json", "public/gameplay-replay.fixture.json format is invalid.");
  }
  if (fixture.version !== REPLAY_FIXTURE_VERSION) {
    throw replayFixtureError("public/gameplay-replay.fixture.json", `public/gameplay-replay.fixture.json version must be ${REPLAY_FIXTURE_VERSION}.`);
  }
  if (fixture.scenario !== REPLAY_SCENARIO) {
    throw replayFixtureError("public/gameplay-replay.fixture.json", `public/gameplay-replay.fixture.json scenario must be ${REPLAY_SCENARIO}.`);
  }
  const coverage = await loadReplayCoverageTags(fixture.coverageTagDefinitionsPath);
  assertCoverageTags(fixture.coverageTags, coverage.coverageTagDefinitions, coverage.deprecatedCoverageTags, "public/gameplay-replay.fixture.json.coverageTags");
  return {
    ...fixture,
    coverageTagDefinitions: coverage.coverageTagDefinitions,
    coverageTagGroups: coverage.coverageTagGroups,
    deprecatedCoverageTags: coverage.deprecatedCoverageTags,
  };
}

async function loadReplayCoverageTags(relativePath) {
  if (relativePath !== REPLAY_COVERAGE_TAGS_PATH) {
    throw replayFixtureError("public/gameplay-replay.fixture.json", `public/gameplay-replay.fixture.json coverageTagDefinitionsPath must be ${REPLAY_COVERAGE_TAGS_PATH}.`);
  }
  const coverage = await readJson(path.join(root, relativePath));
  if (coverage.format !== REPLAY_COVERAGE_TAGS_FORMAT) {
    throw replayFixtureError(relativePath, `${relativePath} format is invalid.`);
  }
  if (coverage.version !== REPLAY_COVERAGE_TAGS_VERSION) {
    throw replayFixtureError(relativePath, `${relativePath} version must be ${REPLAY_COVERAGE_TAGS_VERSION}.`);
  }
  assertCoverageTagDefinitions(coverage.coverageTagDefinitions, `${relativePath}.coverageTagDefinitions`);
  assertCoverageTagGroups(coverage.coverageTagGroups, `${relativePath}.coverageTagGroups`, coverage.coverageTagDefinitions);
  assertDeprecatedCoverageTags(coverage.deprecatedCoverageTags, `${relativePath}.deprecatedCoverageTags`, coverage.coverageTagDefinitions);
  return coverage;
}

function replayFixtureError(path, message) {
  const error = new Error(message);
  error.replayFixturePath = path;
  return error;
}

function replayFixtureErrorPath(error) {
  return error instanceof Error && typeof error.replayFixturePath === "string"
    ? error.replayFixturePath
    : "public/gameplay-replay.fixture.json";
}

async function createTemplateReplayRun(result) {
  const {
    GAME_STATE_SNAPSHOT_FORMAT,
    GAME_STATE_SNAPSHOT_VERSION,
    createGameplayReplayRun,
    hashGameStateSnapshot,
  } = await import("@ferrum2d/ferrum-web");
  const summary = templateSummary(result);
  const snapshots = [
    templateReplaySnapshot({
      frame: 0,
      phase: "template-loaded",
      summary,
      format: GAME_STATE_SNAPSHOT_FORMAT,
      version: GAME_STATE_SNAPSHOT_VERSION,
      hashGameStateSnapshot,
    }),
    templateReplaySnapshot({
      frame: 1,
      phase: "runtime-ready",
      summary,
      format: GAME_STATE_SNAPSHOT_FORMAT,
      version: GAME_STATE_SNAPSHOT_VERSION,
      hashGameStateSnapshot,
    }),
  ];
  return createGameplayReplayRun(snapshots);
}

function templateSummary(result) {
  return {
    template: "minimal",
    hasFerrumDependency: result.hasFerrumDependency,
    hasMainSource: result.hasMainSource,
    authoringSurface: result.authoringSurface,
    publicAssets: result.publicAssets,
    scripts: ["ferrum:validate", "ferrum:authoring-report", "ferrum:replay-report", "ferrum:update-replay-fixture"],
  };
}

function templateReplaySnapshot({ frame, phase, summary, format, version, hashGameStateSnapshot }) {
  const snapshot = {
    format,
    version,
    frame,
    source: "ferrum-runtime",
    scene: { score: 0, gameState: frame, entityCount: frame, spriteCount: frame, cameraX: 0, cameraY: 0 },
    custom: {
      templateReplay: {
        version: 1,
        scenario: REPLAY_SCENARIO,
        phase,
        template: summary,
      },
    },
  };
  return {
    ...snapshot,
    snapshotHash: hashGameStateSnapshot(snapshot),
  };
}

function templateReplayFixture(replay) {
  return {
    format: REPLAY_FIXTURE_FORMAT,
    version: REPLAY_FIXTURE_VERSION,
    scenario: REPLAY_SCENARIO,
    description: "Generated minimal template surface replay contract. This fixture validates public replay helper hashing and template surface drift; it is not a browser frame runner.",
    coverageTagDefinitionsPath: REPLAY_COVERAGE_TAGS_PATH,
    coverageTags: REPLAY_COVERAGE_TAGS,
    replay,
  };
}

function assertCoverageTagDefinitions(definitions, label) {
  if (definitions === null || typeof definitions !== "object" || Array.isArray(definitions)) {
    throw new Error(`${label} must be an object.`);
  }
  const entries = Object.entries(definitions);
  if (entries.length === 0) throw new Error(`${label} must not be empty.`);
  for (const [tag, description] of entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) throw new Error(`${label}.${tag} key must be kebab-case.`);
    if (typeof description !== "string" || description.length === 0) throw new Error(`${label}.${tag} must be a non-empty string.`);
  }
}

function assertCoverageTagGroups(groups, label, definitions) {
  if (groups === null || typeof groups !== "object" || Array.isArray(groups)) throw new Error(`${label} must be an object.`);
  const entries = Object.entries(groups);
  if (entries.length === 0) throw new Error(`${label} must not be empty.`);
  const groupedTags = new Set();
  for (const [group, spec] of entries) {
    const groupLabel = `${label}.${group}`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group)) throw new Error(`${groupLabel} key must be kebab-case.`);
    if (spec === null || typeof spec !== "object" || Array.isArray(spec)) throw new Error(`${groupLabel} must be an object.`);
    if (typeof spec.description !== "string" || spec.description.length === 0) throw new Error(`${groupLabel}.description must be a non-empty string.`);
    assertCoverageTags(spec.tags, definitions, undefined, `${groupLabel}.tags`, { requireAllDefinitions: false });
    for (const tag of spec.tags) groupedTags.add(tag);
  }
  for (const tag of Object.keys(definitions)) {
    if (!groupedTags.has(tag)) throw new Error(`${label} must include active coverage tag '${tag}' in at least one group.`);
  }
}

function assertDeprecatedCoverageTags(deprecatedTags, label, definitions) {
  if (deprecatedTags === null || typeof deprecatedTags !== "object" || Array.isArray(deprecatedTags)) throw new Error(`${label} must be an object.`);
  for (const [tag, description] of Object.entries(deprecatedTags)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) throw new Error(`${label}.${tag} key must be kebab-case.`);
    if (definitions[tag] !== undefined) throw new Error(`${label}.${tag} must not also be an active coverage tag.`);
    if (typeof description !== "string" || description.length === 0) throw new Error(`${label}.${tag} must be a non-empty string.`);
  }
}

function assertCoverageTags(tags, definitions, deprecatedTags, label, options = {}) {
  if (!Array.isArray(tags) || tags.length === 0) throw new Error(`${label} must be a non-empty array.`);
  const seen = new Set();
  for (const [index, tag] of tags.entries()) {
    if (typeof tag !== "string" || tag.length === 0) throw new Error(`${label}[${index}] must be a non-empty string.`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) throw new Error(`${label}[${index}] must be kebab-case.`);
    if (seen.has(tag)) throw new Error(`${label}[${index}] must be unique.`);
    seen.add(tag);
    if (definitions[tag] === undefined) throw new Error(`${label}[${index}] must reference defined coverage tag '${tag}'.`);
    if (deprecatedTags?.[tag] !== undefined) throw new Error(`${label}[${index}] must not use deprecated coverage tag '${tag}'.`);
  }
  if (options.requireAllDefinitions !== false) {
    for (const tag of Object.keys(definitions)) {
      if (!seen.has(tag)) throw new Error(`${label} must use defined coverage tag '${tag}'.`);
    }
  }
}

async function inspectGameSpec() {
  const file = path.join(root, "public/game.json");
  if (!await exists(file)) return undefined;
  try {
    const source = await readFile(file, "utf8");
    const json = JSON.parse(source);
    const { resolveShooterGameSpec } = await import("@ferrum2d/ferrum-web");
    resolveShooterGameSpec(json);
    return { ok: true, file: path.relative(root, file) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const pathMatch = message.match(/path=['"]?([^'"\s]+)['"]?/);
    return {
      ok: false,
      file: path.relative(root, file),
      path: pathMatch?.[1] ?? "public/game.json",
      message,
    };
  }
}

async function listPublicAssets() {
  const publicRoot = path.join(root, "public");
  if (!await exists(publicRoot)) return [];
  const output = [];
  await walk(publicRoot, output);
  return output
    .map((file) => path.relative(publicRoot, file).split(path.sep).join("/"))
    .filter((file) => file !== "game.json")
    .sort();
}

async function walk(directory, output) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(entryPath, output);
    } else if (entry.isFile()) {
      output.push(entryPath);
    }
  }
}

async function runBuild() {
  const manager = packageManager();
  const args = manager === "yarn" ? ["build"] : ["run", "build"];
  await new Promise((resolve, reject) => {
    const child = spawn(manager, args, {
      cwd: root,
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Build failed with exit code ${code}.`));
    });
  });
}

function packageManager() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm")) return "pnpm";
  if (userAgent.startsWith("yarn")) return "yarn";
  return "npm";
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
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
