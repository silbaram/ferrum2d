#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const command = process.argv[2] ?? "report";
const REPLAY_COVERAGE_TAGS_FORMAT = "ferrum2d.consumer.gameplay-replay.coverage-tags";
const REPLAY_COVERAGE_TAGS_VERSION = 1;
const TOPDOWN_REPLAY_COVERAGE_TAGS_PATH = "public/gameplay-replay.coverage-tags.json";
const SCENE_AUTHORING_PATH = "public/scene-authoring.json";
const TOPDOWN_REPLAY_COVERAGE_TAGS = Object.freeze([
  "template-game-spec",
  "topdown-scene-composition-authoring",
]);

try {
  if (command === "validate") await validateProject();
  else if (command === "smoke") {
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
  if (!result.hasFerrumDependency) errors.push("package.json must depend on @ferrum2d/ferrum-web.");
  if (!result.hasMainSource) errors.push("src/main.ts is required.");
  for (const importPath of result.internalImports) {
    errors.push(`Use the public package entrypoint instead of internal import: ${importPath}`);
  }
  if (result.gameSpec === undefined) {
    errors.push("public/game.json is required.");
  }
  if (result.gameSpec?.ok === false) {
    errors.push(`Game Spec validation failed at ${result.gameSpec.path}: ${result.gameSpec.message}`);
  }
  if (result.sceneAuthoring?.ok === false) {
    errors.push(`Scene authoring validation failed at ${result.sceneAuthoring.path}: ${result.sceneAuthoring.message}`);
  }
  if (errors.length > 0) {
    console.error("Ferrum2D validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log("Ferrum2D validation ok");
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
    authoringSurface: inspectTemplateAuthoringSurface(sceneAuthoring),
    gameSpec: await inspectGameSpec(),
    sceneAuthoring,
  };
}

async function printReport() {
  const result = await inspectProject();
  const diagnostics = validationDiagnostics(result, { requireGameSpec: true });
  const reports = diagnostics.map(reportFromDiagnostic);
  const report = {
    format: "ferrum2d.consumer.project.report",
    version: 1,
    ok: diagnostics.length === 0,
    project: {
      packageName: result.packageName,
      ferrumWeb: result.packageJson.dependencies?.["@ferrum2d/ferrum-web"] ?? null,
      scripts: result.packageJson.scripts ?? {},
      files: {
        main: result.hasMainSource,
        gameSpec: result.gameSpec?.file ?? null,
        sceneAuthoring: result.sceneAuthoring?.file ?? null,
      },
      authoringSurface: result.authoringSurface,
      checks: {
        hasFerrumDependency: result.hasFerrumDependency,
        internalImports: result.internalImports,
        gameSpec: result.gameSpec ?? { ok: false, message: "public/game.json is required" },
        sceneAuthoring: result.sceneAuthoring ?? { ok: null, message: `${SCENE_AUTHORING_PATH} not present` },
      },
    },
    recommendedCommands: [
      "npm run ferrum:report",
      "npm run ferrum:validate",
      "npm run ferrum:authoring-report",
      "npm run ferrum:replay-report",
      "npm run ferrum:runtime-replay-report",
      "npm run ferrum:smoke",
      "npm run dev",
    ],
    reports,
    errors: diagnostics.map((entry) => entry.message),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function printAuthoringReport() {
  const result = await inspectProject();
  const diagnostics = validationDiagnostics(result, { requireGameSpec: true });
  const report = {
    format: "ferrum2d.consumer.gameplay-authoring.report",
    version: 1,
    ok: diagnostics.length === 0,
    gameplayAuthoring: {
      packageName: result.packageName,
      status: diagnostics.length === 0 ? authoringStatus(result) : "invalid",
      authoringSurface: result.authoringSurface,
      gameSpec: result.gameSpec ?? { ok: false, message: "public/game.json is required" },
      sceneAuthoring: result.sceneAuthoring ?? { ok: null, message: `${SCENE_AUTHORING_PATH} not present` },
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
  const diagnostics = validationDiagnostics(result, { requireGameSpec: true });
  const reports = diagnostics.map(reportFromDiagnostic);
  const replayFixturePatches = [];
  let fixture;
  let actualRun;
  let comparison;
  if (diagnostics.length === 0) {
    try {
      fixture = await loadTopdownReplayFixture();
      actualRun = await createTopdownTemplateReplayRun(result.gameSpec.summary, result.authoringSurface);
      const { compareGameplayReplayRuns } = await import("@ferrum2d/ferrum-web");
      comparison = compareGameplayReplayRuns(fixture.replay, actualRun);
      if (!comparison.passed) {
        replayFixturePatches.push(replayFixturePatchCandidate(actualRun, fixture));
        reports.push({
          kind: "gameplay-replay",
          code: "FERRUM_CONSUMER_REPLAY_MISMATCH",
          path: comparison.firstMismatch?.path ?? "public/gameplay-replay.fixture.json.replayHash",
          message: "Top-down template replay fixture does not match the current Game Spec contract.",
          expected: comparison.firstMismatch?.expected ?? comparison.expectedHash,
          actual: comparison.firstMismatch?.actual ?? comparison.actualHash,
          suggestion: "Update public/game.json intentionally, then regenerate public/gameplay-replay.fixture.json from the same replay contract.",
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
      scenario: fixture?.scenario ?? "topdown-template-game-spec",
      fixture: "public/gameplay-replay.fixture.json",
      coverageTagDefinitionsPath: fixture?.coverageTagDefinitionsPath ?? TOPDOWN_REPLAY_COVERAGE_TAGS_PATH,
      coverageTags: fixture?.coverageTags ?? TOPDOWN_REPLAY_COVERAGE_TAGS,
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

function replayFixturePatchCandidate(actualRun, fixture) {
  return {
    kind: "consumer-gameplay-replay-fixture",
    code: "FERRUM_CONSUMER_REPLAY_FIXTURE_PATCH_CANDIDATE",
    path: "public/gameplay-replay.fixture.json",
    message: "Current Game Spec replay contract can be promoted to the top-down template replay fixture.",
    expected: topdownReplayFixture(actualRun),
    actual: {
      scenario: fixture.scenario,
      replayHash: fixture.replay?.replayHash,
    },
    suggestion: "If the Game Spec change is intentional, run npm run ferrum:update-replay-fixture and rerun npm run ferrum:replay-report.",
  };
}

async function updateReplayFixture() {
  const result = await inspectProject();
  const diagnostics = validationDiagnostics(result, { requireGameSpec: true });
  if (diagnostics.length > 0) {
    console.error("Ferrum2D replay fixture update failed:");
    for (const entry of diagnostics) console.error(`- ${entry.message}`);
    process.exit(1);
  }
  const replay = await createTopdownTemplateReplayRun(result.gameSpec.summary, result.authoringSurface);
  const coverage = await loadReplayCoverageTags(TOPDOWN_REPLAY_COVERAGE_TAGS_PATH);
  const fixture = topdownReplayFixture(replay);
  assertCoverageTags(
    fixture.coverageTags,
    coverage.coverageTagDefinitions,
    coverage.deprecatedCoverageTags,
    "public/gameplay-replay.fixture.json.coverageTags",
  );
  const file = path.join(root, "public/gameplay-replay.fixture.json");
  await writeFile(file, `${JSON.stringify(fixture, null, 2)}\n`);
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
  if (result.sceneAuthoring?.ok === false) {
    diagnostics.push(diagnostic(result.sceneAuthoring.path, result.sceneAuthoring.detail ?? result.sceneAuthoring.message));
  }
  return diagnostics;
}

function authoringStatus(result) {
  if (result.gameSpec === undefined) return "missing";
  if (result.gameSpec.ok === false || result.sceneAuthoring?.ok === false) return "invalid";
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

function reportFromDiagnostic(entry) {
  if (entry.code === "FERRUM_CONSUMER_REPLAY_FIXTURE_INVALID") {
    return {
      kind: entry.context.kind,
      code: entry.code,
      path: entry.context.path,
      message: entry.message,
      expected: "valid Ferrum2D replay fixture matching the current Game Spec replay contract",
      actual: entry.context.detail,
      suggestion: "Confirm the Game Spec change is intentional, then rerun npm run ferrum:update-replay-fixture.",
    };
  }
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

async function inspectGameSpec() {
  const file = path.join(root, "public/game.json");
  if (!await exists(file)) return undefined;
  try {
    const source = await readFile(file, "utf8");
    const { resolveShooterGameSpec } = await import("@ferrum2d/ferrum-web");
    const resolved = resolveShooterGameSpec(JSON.parse(source));
    return { ok: true, file: path.relative(root, file), summary: topdownGameSpecSummary(resolved) };
  } catch (error) {
    return {
      ok: false,
      file: path.relative(root, file),
      path: "public/game.json",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function inspectTemplateAuthoringSurface(sceneAuthoring) {
  return {
    publicApis: {
      applySceneBehaviorRecipes: sceneAuthoring?.publicApis?.applySceneBehaviorRecipes === true,
      dryRunSceneBehaviorRecipes: sceneAuthoring?.publicApis?.dryRunSceneBehaviorRecipes === true,
      resolveSceneCompositionSpec: sceneAuthoring?.publicApis?.resolveSceneCompositionSpec === true,
      resolveBehaviorRecipeDocument: sceneAuthoring?.publicApis?.resolveBehaviorRecipeDocument === true,
    },
    runtimeHooks: {
      resolveShooterGameSpec: true,
      builtinShooterPlayerHandle: false,
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
        if (instance.props.runtimeEntity !== "builtinShooterPlayer") {
          throw sceneAuthoringError(
            `sceneAuthoring.sceneComposition.instances.${instance.id}.props.runtimeEntity`,
            "topdown template scene authoring supports builtinShooterPlayer runtime entity only",
          );
        }
        return { entityId: 1, entityGeneration: 0 };
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

function createSceneAuthoringMockEngine() {
  const calls = [];
  return {
    calls,
    set_gameplay_action_projectile(
      entityId,
      entityGeneration,
      actionId,
      cooldownSeconds,
      speed,
      damage,
      lifetimeSeconds,
    ) {
      calls.push([
        "set_gameplay_action_projectile",
        entityId,
        entityGeneration,
        actionId,
        cooldownSeconds,
        speed,
        damage,
        lifetimeSeconds,
      ]);
      return true;
    },
  };
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

async function loadTopdownReplayFixture() {
  const file = path.join(root, "public/gameplay-replay.fixture.json");
  const fixture = JSON.parse(await readFile(file, "utf8"));
  if (fixture.format !== "ferrum2d.consumer.gameplay-replay.fixture") {
    throw replayFixtureError("public/gameplay-replay.fixture.json", "public/gameplay-replay.fixture.json format is invalid.");
  }
  if (fixture.version !== 1) {
    throw replayFixtureError("public/gameplay-replay.fixture.json", "public/gameplay-replay.fixture.json version must be 1.");
  }
  if (fixture.scenario !== "topdown-template-game-spec") {
    throw replayFixtureError("public/gameplay-replay.fixture.json", "public/gameplay-replay.fixture.json scenario must be topdown-template-game-spec.");
  }
  const coverage = await loadReplayCoverageTags(fixture.coverageTagDefinitionsPath);
  assertCoverageTags(
    fixture.coverageTags,
    coverage.coverageTagDefinitions,
    coverage.deprecatedCoverageTags,
    "public/gameplay-replay.fixture.json.coverageTags",
  );
  return {
    ...fixture,
    coverageTagDefinitions: coverage.coverageTagDefinitions,
    coverageTagGroups: coverage.coverageTagGroups,
    deprecatedCoverageTags: coverage.deprecatedCoverageTags,
  };
}

async function loadReplayCoverageTags(relativePath) {
  if (relativePath !== TOPDOWN_REPLAY_COVERAGE_TAGS_PATH) {
    throw replayFixtureError(
      "public/gameplay-replay.fixture.json",
      `public/gameplay-replay.fixture.json coverageTagDefinitionsPath must be ${TOPDOWN_REPLAY_COVERAGE_TAGS_PATH}.`,
    );
  }
  const file = path.join(root, relativePath);
  let coverage;
  try {
    coverage = JSON.parse(await readFile(file, "utf8"));
    if (coverage.format !== REPLAY_COVERAGE_TAGS_FORMAT) {
      throw new Error(`${relativePath} format is invalid.`);
    }
    if (coverage.version !== REPLAY_COVERAGE_TAGS_VERSION) {
      throw new Error(`${relativePath} version must be ${REPLAY_COVERAGE_TAGS_VERSION}.`);
    }
    assertCoverageTagDefinitions(coverage.coverageTagDefinitions, `${relativePath}.coverageTagDefinitions`);
    assertCoverageTagGroups(
      coverage.coverageTagGroups,
      `${relativePath}.coverageTagGroups`,
      coverage.coverageTagDefinitions,
    );
    assertDeprecatedCoverageTags(
      coverage.deprecatedCoverageTags,
      `${relativePath}.deprecatedCoverageTags`,
      coverage.coverageTagDefinitions,
    );
  } catch (error) {
    throw replayFixtureError(relativePath, error instanceof Error ? error.message : String(error));
  }
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

function assertCoverageTagDefinitions(definitions, label) {
  if (definitions === null || typeof definitions !== "object" || Array.isArray(definitions)) {
    throw new Error(`${label} must be an object.`);
  }
  const entries = Object.entries(definitions);
  if (entries.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  for (const [tag, description] of entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) {
      throw new Error(`${label}.${tag} key must be kebab-case.`);
    }
    if (typeof description !== "string" || description.length === 0) {
      throw new Error(`${label}.${tag} must be a non-empty string.`);
    }
  }
}

function assertCoverageTagGroups(groups, label, definitions) {
  if (groups === null || typeof groups !== "object" || Array.isArray(groups)) {
    throw new Error(`${label} must be an object.`);
  }
  const entries = Object.entries(groups);
  if (entries.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  const groupedTags = new Set();
  for (const [group, spec] of entries) {
    const groupLabel = `${label}.${group}`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group)) {
      throw new Error(`${groupLabel} key must be kebab-case.`);
    }
    if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
      throw new Error(`${groupLabel} must be an object.`);
    }
    if (typeof spec.description !== "string" || spec.description.length === 0) {
      throw new Error(`${groupLabel}.description must be a non-empty string.`);
    }
    assertCoverageTags(spec.tags, definitions, undefined, `${groupLabel}.tags`, { requireAllDefinitions: false });
    for (const tag of spec.tags) groupedTags.add(tag);
  }
  for (const tag of Object.keys(definitions)) {
    if (!groupedTags.has(tag)) {
      throw new Error(`${label} must include active coverage tag '${tag}' in at least one group.`);
    }
  }
}

function assertDeprecatedCoverageTags(deprecatedTags, label, definitions) {
  if (deprecatedTags === null || typeof deprecatedTags !== "object" || Array.isArray(deprecatedTags)) {
    throw new Error(`${label} must be an object.`);
  }
  for (const [tag, description] of Object.entries(deprecatedTags)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) {
      throw new Error(`${label}.${tag} key must be kebab-case.`);
    }
    if (definitions[tag] !== undefined) {
      throw new Error(`${label}.${tag} must not also be an active coverage tag.`);
    }
    if (typeof description !== "string" || description.length === 0) {
      throw new Error(`${label}.${tag} must be a non-empty string.`);
    }
  }
}

function assertCoverageTags(tags, definitions, deprecatedTags, label, options = {}) {
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }
  const seen = new Set();
  for (const [index, tag] of tags.entries()) {
    if (typeof tag !== "string" || tag.length === 0) {
      throw new Error(`${label}[${index}] must be a non-empty string.`);
    }
    if (seen.has(tag)) {
      throw new Error(`${label}[${index}] must be unique.`);
    }
    seen.add(tag);
    if (definitions[tag] === undefined) {
      throw new Error(`${label}[${index}] must reference defined coverage tag '${tag}'.`);
    }
    if (deprecatedTags?.[tag] !== undefined) {
      throw new Error(`${label}[${index}] must not use deprecated coverage tag '${tag}'.`);
    }
  }
  if (options.requireAllDefinitions !== false) {
    for (const tag of Object.keys(definitions)) {
      if (!seen.has(tag)) {
        throw new Error(`${label} must use defined coverage tag '${tag}'.`);
      }
    }
  }
}

async function createTopdownTemplateReplayRun(specSummary, authoringSurface) {
  const {
    GAME_STATE_SNAPSHOT_FORMAT,
    GAME_STATE_SNAPSHOT_VERSION,
    createGameplayReplayRun,
    hashGameStateSnapshot,
  } = await import("@ferrum2d/ferrum-web");
  const snapshots = [
    templateReplaySnapshot({
      frame: 0,
      scene: { score: 0, gameState: 0, entityCount: 0, spriteCount: 0, cameraX: 0, cameraY: 0 },
      phase: "spec-loaded",
      specSummary,
      authoringSurface,
      format: GAME_STATE_SNAPSHOT_FORMAT,
      version: GAME_STATE_SNAPSHOT_VERSION,
      hashGameStateSnapshot,
    }),
    templateReplaySnapshot({
      frame: 1,
      scene: {
        score: 0,
        gameState: 1,
        entityCount: 1,
        spriteCount: 1,
        cameraX: specSummary.world.width / 2,
        cameraY: specSummary.world.height / 2,
      },
      phase: "playable-baseline",
      specSummary,
      authoringSurface,
      format: GAME_STATE_SNAPSHOT_FORMAT,
      version: GAME_STATE_SNAPSHOT_VERSION,
      hashGameStateSnapshot,
    }),
  ];
  return createGameplayReplayRun(snapshots);
}

function topdownReplayFixture(replay) {
  return {
    format: "ferrum2d.consumer.gameplay-replay.fixture",
    version: 1,
    scenario: "topdown-template-game-spec",
    description: "Generated topdown template Game Spec replay contract. This fixture validates public replay helper hashing and template Game Spec drift; it is not a browser frame runner.",
    coverageTagDefinitionsPath: TOPDOWN_REPLAY_COVERAGE_TAGS_PATH,
    coverageTags: TOPDOWN_REPLAY_COVERAGE_TAGS,
    replay,
  };
}

function templateReplaySnapshot({ frame, scene, phase, specSummary, authoringSurface, format, version, hashGameStateSnapshot }) {
  const snapshot = {
    format,
    version,
    frame,
    source: "ferrum-runtime",
    scene,
    custom: {
      templateReplay: {
        version: 1,
        scenario: "topdown-template-game-spec",
        phase,
        spec: specSummary,
        authoringSurface,
      },
    },
  };
  return {
    ...snapshot,
    snapshotHash: hashGameStateSnapshot(snapshot),
  };
}

function topdownGameSpecSummary(spec) {
  return {
    world: { width: spec.worldWidth, height: spec.worldHeight },
    player: { speed: spec.playerSpeed, width: spec.playerWidth, height: spec.playerHeight },
    enemies: {
      speed: spec.enemySpeed,
      spawnInterval: spec.enemySpawnInterval,
      behavior: spec.enemyBehavior,
      spawnPattern: spec.enemySpawnPattern,
      health: spec.enemyHealth,
      scoreReward: spec.scoreReward,
      waveCount: spec.waves.length,
    },
    weapons: {
      bulletSpeed: spec.bulletSpeed,
      cooldown: spec.fireCooldown,
      damage: spec.bulletDamage,
      lifetime: spec.bulletLifetime,
    },
    camera: { preset: spec.cameraPreset },
  };
}

async function runBuild() {
  const manager = packageManager();
  const args = manager === "yarn" ? ["build"] : ["run", "build"];
  await new Promise((resolve, reject) => {
    const child = spawn(manager, args, { cwd: root, shell: process.platform === "win32", stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Build failed with exit code ${code}.`)));
  });
}

function packageManager() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm")) return "pnpm";
  if (userAgent.startsWith("yarn")) return "yarn";
  return "npm";
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
