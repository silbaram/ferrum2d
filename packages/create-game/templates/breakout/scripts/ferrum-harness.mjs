#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const command = process.argv[2] ?? "report";
const REPLAY_COVERAGE_TAGS_FORMAT = "ferrum2d.consumer.gameplay-replay.coverage-tags";
const REPLAY_COVERAGE_TAGS_VERSION = 1;
const REPLAY_FIXTURE_FORMAT = "ferrum2d.consumer.gameplay-replay.fixture";
const REPLAY_FIXTURE_VERSION = 1;
const REPLAY_SCENARIO = "breakout-template-surface";
const REPLAY_COVERAGE_TAGS_PATH = "public/gameplay-replay.coverage-tags.json";
const SCENE_AUTHORING_PATH = "public/scene-authoring.json";
const REPLAY_COVERAGE_TAGS = Object.freeze([
  "breakout-template",
  "breakout-built-in-scene",
]);

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

async function inspectProject() {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const mainPath = path.join(root, "src/main.ts");
  const hasMainSource = await exists(mainPath);
  const mainSource = hasMainSource ? await readFile(mainPath, "utf8") : "";
  const sceneAuthoring = await inspectSceneAuthoring();
  return {
    packageName: packageJson.name,
    packageJson,
    hasFerrumDependency: packageJson.dependencies?.["@ferrum2d/ferrum-web"] !== undefined,
    hasMainSource,
    internalImports: [...mainSource.matchAll(/from\s+["'](@ferrum2d\/ferrum-web\/(?:dist|pkg|src)\/[^"']*)["']/g)]
      .map((match) => match[1]),
    authoringSurface: inspectTemplateAuthoringSurface(mainSource, sceneAuthoring),
    sceneAuthoring,
    publicAssets: await listPublicAssets(),
    usesPublicRuntime: mainSource.includes("createFerrumRuntime") && mainSource.includes("useBreakoutGame"),
  };
}

function inspectTemplateAuthoringSurface(mainSource, sceneAuthoring) {
  return {
    publicApis: {
      applySceneBehaviorRecipes: sceneAuthoring?.publicApis?.applySceneBehaviorRecipes === true,
      dryRunSceneBehaviorRecipes: sceneAuthoring?.publicApis?.dryRunSceneBehaviorRecipes === true,
      resolveSceneCompositionSpec: sceneAuthoring?.publicApis?.resolveSceneCompositionSpec === true,
      resolveBehaviorRecipeDocument: sceneAuthoring?.publicApis?.resolveBehaviorRecipeDocument === true,
    },
    runtimeHooks: {
      useBreakoutGame: mainSource.includes("useBreakoutGame"),
      resetGame: mainSource.includes("resetGame"),
      runtimeMetrics: mainSource.includes("rendererStats.renderCommandCount"),
    },
    sceneComposition: sceneAuthoring === undefined
      ? { configured: false }
      : {
        configured: true,
        ok: sceneAuthoring.ok,
        file: sceneAuthoring.file,
        instanceCount: sceneAuthoring.summary?.instanceCount ?? 0,
        behaviorCommandCount: sceneAuthoring.summary?.behaviorCommandCount ?? 0,
        appliedCommandCount: sceneAuthoring.summary?.appliedCommandCount ?? 0,
        runtimeEntities: sceneAuthoring.summary?.runtimeEntities ?? [],
        runtimeEntityHandles: sceneAuthoring.summary?.runtimeEntityHandles ?? [],
      },
  };
}

async function validateProject() {
  const result = await inspectProject();
  const diagnostics = validationDiagnostics(result);
  if (diagnostics.length > 0) {
    console.error("Ferrum2D validation failed:");
    for (const entry of diagnostics) console.error(`- ${entry.context.detail}`);
    process.exit(1);
  }
  console.log("Ferrum2D validation ok");
}

async function printReport() {
  const result = await inspectProject();
  console.log(JSON.stringify({
    packageName: result.packageName,
    ferrumWeb: result.packageJson.dependencies?.["@ferrum2d/ferrum-web"] ?? null,
    scripts: result.packageJson.scripts ?? {},
    files: {
      main: result.hasMainSource,
      gameSpec: null,
      sceneAuthoring: result.sceneAuthoring?.file ?? null,
      publicAssets: result.publicAssets,
    },
    authoringSurface: result.authoringSurface,
    checks: {
      hasFerrumDependency: result.hasFerrumDependency,
      internalImports: result.internalImports,
      usesPublicRuntime: result.usesPublicRuntime,
      sceneAuthoring: result.sceneAuthoring ?? { ok: null, message: `${SCENE_AUTHORING_PATH} not present` },
    },
    recommendedCommands: [
      "npm run ferrum:validate",
      "npm run ferrum:authoring-report",
      "npm run ferrum:replay-report",
      "npm run ferrum:runtime-replay-report",
      "npm run ferrum:smoke",
      "npm run dev",
    ],
  }, null, 2));
}

async function printAuthoringReport() {
  const result = await inspectProject();
  const diagnostics = validationDiagnostics(result);
  const reports = diagnostics.map(reportFromDiagnostic);
  const ok = diagnostics.length === 0;
  const report = {
    format: "ferrum2d.consumer.gameplay-authoring.report",
    version: 1,
    ok,
    gameplayAuthoring: {
      packageName: result.packageName,
      status: ok ? authoringStatus(result) : "invalid",
      authoringSurface: result.authoringSurface,
      gameSpec: { ok: null, message: "public/game.json not present" },
      sceneAuthoring: result.sceneAuthoring ?? { ok: null, message: `${SCENE_AUTHORING_PATH} not present` },
      diagnostics,
      reports,
    },
    ...(ok ? {} : { diagnostics, reports }),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exitCode = 1;
}

async function printReplayReport() {
  const result = await inspectProject();
  const diagnostics = validationDiagnostics(result);
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
          message: "Breakout template replay fixture does not match the current template contract.",
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
      packageName: result.packageName,
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
    ...(ok ? {} : { diagnostics, reports }),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exitCode = 1;
}

async function updateReplayFixture() {
  const result = await inspectProject();
  const diagnostics = validationDiagnostics(result);
  if (diagnostics.length > 0) {
    console.error("Ferrum2D replay fixture update failed:");
    for (const entry of diagnostics) console.error(`- ${entry.context.detail}`);
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
      packageName: result.packageName,
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

function validationDiagnostics(result) {
  const diagnostics = [];
  if (!result.hasFerrumDependency) {
    diagnostics.push(diagnostic("package.json.dependencies.@ferrum2d/ferrum-web", "package.json must depend on @ferrum2d/ferrum-web."));
  }
  if (!result.hasMainSource) {
    diagnostics.push(diagnostic("src/main.ts", "src/main.ts is required."));
  }
  for (const importPath of result.internalImports) {
    diagnostics.push(diagnostic("src/main.ts", `Use the public package entrypoint instead of internal import: ${importPath}`));
  }
  if (!result.usesPublicRuntime) {
    diagnostics.push(diagnostic("src/main.ts", "Breakout template must boot createFerrumRuntime(...) and useBreakoutGame()."));
  }
  if (result.sceneAuthoring?.ok === false) {
    diagnostics.push(diagnostic(result.sceneAuthoring.path, result.sceneAuthoring.detail ?? result.sceneAuthoring.message));
  }
  return diagnostics;
}

async function inspectSceneAuthoring() {
  const file = path.join(root, SCENE_AUTHORING_PATH);
  if (!await exists(file)) return undefined;
  try {
    const source = await readFile(file, "utf8");
    const json = JSON.parse(source);
    const {
      applySceneBehaviorRecipes,
      dryRunSceneBehaviorRecipes,
      resolveBehaviorRecipeDocument,
      resolveSceneAuthoringDocument,
      resolveSceneCompositionSpec,
    } = await import("@ferrum2d/ferrum-web");
    const resolved = resolveSceneAuthoringDocument(json, {
      path: "sceneAuthoring",
      validateBindings: true,
      missingBehavior: "error",
    });
    const composition = resolved.sceneComposition;
    const recipes = resolved.behaviorRecipes;
    const engine = createSceneAuthoringMockEngine();
    const applied = applySceneBehaviorRecipes(engine, {
      spawnSceneInstance: (instance) => {
        if (instance.props.runtimeEntity === "builtinBreakoutPaddle") {
          return { entityId: 1, entityGeneration: 0 };
        }
        if (instance.props.runtimeEntity === "builtinBreakoutBall") {
          return { entityId: 2, entityGeneration: 0 };
        }
        throw sceneAuthoringError(
          `sceneAuthoring.sceneComposition.instances.${instance.id}.props.runtimeEntity`,
          "breakout template scene authoring supports builtinBreakoutPaddle and builtinBreakoutBall runtime entities only",
        );
      },
    }, composition, recipes, {
      path: "sceneAuthoring",
      missingBehavior: "error",
    });
    return {
      ok: true,
      file: SCENE_AUTHORING_PATH,
      format: resolved.format,
      version: resolved.version,
      publicApis: {
        applySceneBehaviorRecipes: typeof applySceneBehaviorRecipes === "function",
        dryRunSceneBehaviorRecipes: typeof dryRunSceneBehaviorRecipes === "function",
        resolveSceneCompositionSpec: typeof resolveSceneCompositionSpec === "function",
        resolveBehaviorRecipeDocument: typeof resolveBehaviorRecipeDocument === "function",
      },
      summary: {
        fragment: applied.plan.fragment,
        instanceCount: applied.plan.instances.length,
        behaviorCommandCount: applied.plan.commands.length,
        appliedCommandCount: applied.behaviorApplyResult.results.length,
        appliedCalls: engine.calls,
        runtimeEntities: applied.plan.instances
          .map((instance) => instance.props.runtimeEntity)
          .filter((value) => typeof value === "string"),
        runtimeEntityHandles: sceneRuntimeEntityHandles(applied),
        behaviorProfiles: Object.keys(recipes.entities),
      },
    };
  } catch (error) {
    const { diagnosticReport } = await import("@ferrum2d/ferrum-web").catch(() => ({ diagnosticReport: undefined }));
    const report = typeof diagnosticReport === "function" ? diagnosticReport(error) : undefined;
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      file: SCENE_AUTHORING_PATH,
      path: sceneAuthoringErrorPath(error) ?? report?.context?.path ?? SCENE_AUTHORING_PATH,
      message,
      detail: report?.context?.detail ?? message,
    };
  }
}

function createSceneAuthoringMockEngine() {
  const calls = [];
  return {
    calls,
    set_gameplay_health(entityId, entityGeneration, current) {
      calls.push([
        "set_gameplay_health",
        entityId,
        entityGeneration,
        current,
      ]);
      return true;
    },
    set_gameplay_lifetime(entityId, entityGeneration, seconds) {
      calls.push([
        "set_gameplay_lifetime",
        entityId,
        entityGeneration,
        seconds,
      ]);
      return true;
    },
  };
}

function sceneRuntimeEntityHandles(applied) {
  return applied.plan.instances.map((instance) => {
    const handle = applied.entityHandles[instance.id];
    return {
      instanceId: instance.id,
      runtimeEntity: typeof instance.props.runtimeEntity === "string" ? instance.props.runtimeEntity : null,
      entityId: handle.entityId,
      entityGeneration: handle.entityGeneration,
    };
  });
}

function sceneAuthoringError(path, detail) {
  const error = new Error(`Invalid Ferrum2D scene authoring data: path=${JSON.stringify(path)} detail=${JSON.stringify(detail)}.`);
  error.sceneAuthoringPath = path;
  return error;
}

function sceneAuthoringErrorPath(error) {
  return error instanceof Error && typeof error.sceneAuthoringPath === "string"
    ? error.sceneAuthoringPath
    : undefined;
}

function authoringStatus(result) {
  if (result.sceneAuthoring?.ok === false) return "invalid";
  if (result.sceneAuthoring?.ok === true) return "validated";
  return "not-configured";
}

function diagnostic(path, detail) {
  return {
    code: "FERRUM_CONSUMER_AUTHORING_INVALID",
    message: `Invalid Ferrum2D Breakout template: path=${JSON.stringify(path)} detail=${JSON.stringify(detail)}.`,
    context: {
      kind: "consumer-gameplay-authoring",
      path,
      detail,
    },
  };
}

function reportFromDiagnostic(entry) {
  return {
    kind: "project-validation",
    code: "FERRUM_CONSUMER_PROJECT_INVALID",
    path: entry.context.path,
    message: entry.message,
    expected: "valid Ferrum2D Breakout template project",
    actual: entry.context.detail,
    suggestion: "Fix the reported generated project contract and rerun npm run ferrum:validate.",
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
    message: "Current Breakout template contract can be promoted to the replay fixture.",
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
      phase: "breakout-ready",
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
    template: "breakout",
    scene: "builtin-breakout",
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
    description: "Generated Breakout template surface replay contract. This fixture validates public replay helper hashing and template surface drift; it is not a browser frame runner.",
    coverageTagDefinitionsPath: REPLAY_COVERAGE_TAGS_PATH,
    coverageTags: REPLAY_COVERAGE_TAGS,
    replay,
  };
}

function assertCoverageTagDefinitions(definitions, label) {
  if (definitions === null || typeof definitions !== "object" || Array.isArray(definitions)) throw new Error(`${label} must be an object.`);
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

async function listPublicAssets() {
  const publicRoot = path.join(root, "public");
  if (!await exists(publicRoot)) return [];
  const entries = await readdir(publicRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
}

async function runBuild() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await runRequired(npm, ["run", "build"], root);
}

function runRequired(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
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
      if (stdout.trim().length > 0) console.log(stdout.trim());
      if (stderr.trim().length > 0) console.error(stderr.trim());
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
      } else {
        resolve();
      }
    });
  });
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
