import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FERRUM_AUTHORING_VIEWER_OWNERSHIP,
  createAuthoringViewerBehaviorBindingEvidence,
} from "@ferrum2d/authoring-viewer";
import {
  assertCoverageTagDefinitions,
  assertCoverageTagGroups,
  assertCoverageTags,
  assertDeprecatedCoverageTags,
  HARNESS_REPLAY_COVERAGE_TAGS_FORMAT,
  HARNESS_REPLAY_COVERAGE_TAGS_VERSION,
} from "./ferrum-harness-coverage.mjs";
import {
  exists,
  listPublicAssets,
  readJson,
  runBuild,
} from "./ferrum-harness-files.mjs";

export {
  HARNESS_REPLAY_COVERAGE_TAGS_FORMAT,
  HARNESS_REPLAY_COVERAGE_TAGS_VERSION,
} from "./ferrum-harness-coverage.mjs";
export {
  exists,
  readJson,
} from "./ferrum-harness-files.mjs";

export const HARNESS_REPLAY_FIXTURE_FORMAT = "ferrum2d.consumer.gameplay-replay.fixture";
export const HARNESS_REPLAY_FIXTURE_VERSION = 1;
export const HARNESS_REPLAY_FIXTURE_PATH = "public/gameplay-replay.fixture.json";
export const HARNESS_REPLAY_COVERAGE_TAGS_PATH = "public/gameplay-replay.coverage-tags.json";
export const HARNESS_SCENE_AUTHORING_PATH = "public/scene-authoring.json";

export async function runFerrumHarnessCli(config) {
  const command = process.argv[2] ?? "report";
  try {
    if (command === "validate") {
      await validateProject(config);
    } else if (command === "smoke") {
      await validateProject(config);
      await runBuild(config.root ?? process.cwd());
    } else if (command === "report") {
      await printReport(config);
    } else if (command === "authoring-report") {
      await printAuthoringReport(config);
    } else if (command === "replay-report") {
      await printReplayReport(config);
    } else if (command === "update-replay-fixture") {
      await updateReplayFixture(config);
    } else {
      throw new Error(`Unknown ferrum harness command: ${command}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function inspectShooterGameSpec(root, summary) {
  const file = path.join(root, "public/game.json");
  if (!await exists(file)) return undefined;
  try {
    const source = await readFile(file, "utf8");
    const { resolveShooterGameSpec } = await import("@ferrum2d/ferrum-web/starter-scenes");
    const resolved = resolveShooterGameSpec(JSON.parse(source));
    return {
      ok: true,
      file: path.relative(root, file),
      ...(typeof summary === "function" ? { summary: summary(resolved) } : {}),
    };
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

export function sceneAuthoringError(pathValue, detail) {
  const error = new Error(`Invalid Ferrum2D scene authoring data: path=${JSON.stringify(pathValue)} detail=${JSON.stringify(detail)}.`);
  error.sceneAuthoringPath = pathValue;
  return error;
}

export function sceneCompositionAuthoringSurface(sceneAuthoring) {
  return sceneAuthoring === undefined
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
    };
}

export async function createTemplateSurfaceReplayRun({ scenario, phases, summary }) {
  const {
    GAME_STATE_SNAPSHOT_FORMAT,
    GAME_STATE_SNAPSHOT_VERSION,
    createGameplayReplayRun,
    hashGameStateSnapshot,
  } = await import("@ferrum2d/ferrum-web/quality");
  const snapshots = phases.map((phase, frame) => templateSurfaceReplaySnapshot({
    frame,
    phase,
    summary,
    scenario,
    format: GAME_STATE_SNAPSHOT_FORMAT,
    version: GAME_STATE_SNAPSHOT_VERSION,
    hashGameStateSnapshot,
  }));
  return createGameplayReplayRun(snapshots);
}

function templateSurfaceReplaySnapshot({ frame, phase, summary, scenario, format, version, hashGameStateSnapshot }) {
  const snapshot = {
    format,
    version,
    frame,
    source: "ferrum-runtime",
    scene: { score: 0, gameState: frame, entityCount: frame, spriteCount: frame, cameraX: 0, cameraY: 0 },
    custom: {
      templateReplay: {
        version: 1,
        scenario,
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

async function validateProject(config) {
  const result = await inspectProject(config);
  const diagnostics = validationDiagnostics(config, result, {
    requireGameSpec: config.requireGameSpec === true,
  });
  if (diagnostics.length > 0) {
    console.error("Ferrum2D validation failed:");
    for (const entry of diagnostics) console.error(`- ${entry.context.detail}`);
    process.exit(1);
  }
  console.log("Ferrum2D validation ok");
  if (result.gameSpec?.ok === true && config.printValidatedGameSpec !== false) {
    console.log(`- game spec: ${result.gameSpec.file}`);
  } else if (config.printSkippedGameSpec === true) {
    console.log("- game spec: not present, skipped");
  }
}

async function printReport(config) {
  const result = await inspectProject(config);
  const diagnostics = validationDiagnostics(config, result, {
    requireGameSpec: config.requireGameSpec === true,
  });
  const reports = diagnostics.map((entry) => reportFromDiagnostic(config, entry));
  const report = {
    format: "ferrum2d.consumer.project.report",
    version: 1,
    ok: diagnostics.length === 0,
    project: {
      packageName: result.packageName,
      authoringViewer: result.packageJson.dependencies?.["@ferrum2d/authoring-viewer"] ?? null,
      ferrumWeb: result.packageJson.dependencies?.["@ferrum2d/ferrum-web"] ?? null,
      scripts: result.packageJson.scripts ?? {},
      files: {
        main: result.hasMainSource,
        gameSpec: result.gameSpec?.file ?? null,
        sceneAuthoring: result.sceneAuthoring?.file ?? null,
        ...(config.includePublicAssetsInReport === true ? { publicAssets: result.publicAssets } : {}),
      },
      authoringSurface: result.authoringSurface,
      checks: {
        hasAuthoringViewerDependency: result.hasAuthoringViewerDependency,
        hasFerrumDependency: result.hasFerrumDependency,
        internalImports: result.internalImports,
        ...(config.projectChecks?.(result) ?? {}),
        gameSpec: result.gameSpec ?? missingGameSpecCheck(config),
        sceneAuthoring: result.sceneAuthoring ?? { ok: null, message: `${sceneAuthoringPath(config)} not present` },
      },
    },
    recommendedCommands: recommendedCommands(),
    reports,
    errors: diagnostics.map((entry) => entry.message),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function printAuthoringReport(config) {
  const result = await inspectProject(config);
  const diagnostics = validationDiagnostics(config, result, {
    requireGameSpec: config.requireGameSpec === true,
  });
  const reports = diagnostics.map((entry) => reportFromDiagnostic(config, entry));
  const report = {
    format: "ferrum2d.consumer.gameplay-authoring.report",
    version: 1,
    ok: diagnostics.length === 0,
    gameplayAuthoring: {
      packageName: result.packageName,
      status: diagnostics.length === 0 ? authoringStatus(config, result) : "invalid",
      authoringSurface: result.authoringSurface,
      gameSpec: result.gameSpec ?? missingGameSpecCheck(config),
      sceneAuthoring: result.sceneAuthoring ?? { ok: null, message: `${sceneAuthoringPath(config)} not present` },
      ...(config.includePublicAssetsInAuthoringReport === true ? { publicAssets: result.publicAssets } : {}),
      diagnostics,
      reports,
    },
    ...(diagnostics.length === 0 ? {} : { diagnostics, reports }),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function printReplayReport(config) {
  const result = await inspectProject(config);
  const diagnostics = validationDiagnostics(config, result, {
    requireGameSpec: config.requireGameSpec === true,
  });
  const reports = diagnostics.map((entry) => reportFromDiagnostic(config, entry));
  const replayFixturePatches = [];
  let fixture;
  let actualRun;
  let comparison;
  if (diagnostics.length === 0) {
    try {
      fixture = await loadReplayFixture(config);
      actualRun = await config.createTemplateReplayRun(result);
      const { compareGameplayReplayRuns } = await import("@ferrum2d/ferrum-web/quality");
      comparison = compareGameplayReplayRuns(fixture.replay, actualRun);
      if (!comparison.passed) {
        replayFixturePatches.push(replayFixturePatchCandidate(config, actualRun, fixture));
        reports.push({
          kind: "gameplay-replay",
          code: "FERRUM_CONSUMER_REPLAY_MISMATCH",
          path: comparison.firstMismatch?.path ?? `${HARNESS_REPLAY_FIXTURE_PATH}.replayHash`,
          message: config.replayMismatchMessage,
          expected: comparison.firstMismatch?.expected ?? comparison.expectedHash,
          actual: comparison.firstMismatch?.actual ?? comparison.actualHash,
          suggestion: config.replayMismatchSuggestion,
        });
      }
    } catch (error) {
      const entry = replayFixtureDiagnostic(replayFixtureErrorPath(error), error instanceof Error ? error.message : String(error));
      diagnostics.push(entry);
      reports.push(reportFromDiagnostic(config, entry));
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
      scenario: fixture?.scenario ?? config.replayScenario,
      fixture: HARNESS_REPLAY_FIXTURE_PATH,
      coverageTagDefinitionsPath: fixture?.coverageTagDefinitionsPath ?? replayCoverageTagsPath(config),
      coverageTags: fixture?.coverageTags ?? config.replayCoverageTags,
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
  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function updateReplayFixture(config) {
  const result = await inspectProject(config);
  const diagnostics = validationDiagnostics(config, result, {
    requireGameSpec: config.requireGameSpec === true,
  });
  if (diagnostics.length > 0) {
    console.error("Ferrum2D replay fixture update failed:");
    for (const entry of diagnostics) console.error(`- ${entry.message}`);
    process.exit(1);
  }
  const replay = await config.createTemplateReplayRun(result);
  const coverage = await loadReplayCoverageTags(config, replayCoverageTagsPath(config));
  const fixture = config.createReplayFixture(replay);
  assertCoverageTags(fixture.coverageTags, coverage.coverageTagDefinitions, coverage.deprecatedCoverageTags, `${HARNESS_REPLAY_FIXTURE_PATH}.coverageTags`);
  await writeFile(path.join(config.root ?? process.cwd(), HARNESS_REPLAY_FIXTURE_PATH), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(JSON.stringify({
    format: "ferrum2d.consumer.gameplay-replay.fixture-update-report",
    version: 1,
    ok: true,
    gameplayReplayFixture: {
      packageName: result.packageName,
      fixture: HARNESS_REPLAY_FIXTURE_PATH,
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

async function inspectProject(config) {
  const root = config.root ?? process.cwd();
  const packageJson = await readJson(path.join(root, "package.json"));
  const mainPath = path.join(root, "src/main.ts");
  const hasMainSource = await exists(mainPath);
  const mainSource = hasMainSource ? await readFile(mainPath, "utf8") : "";
  const sceneAuthoring = await inspectSceneAuthoring(config);
  const gameSpec = typeof config.inspectGameSpec === "function"
    ? await config.inspectGameSpec({ root, mainSource, sceneAuthoring })
    : undefined;
  const result = {
    packageName: packageJson.name,
    packageJson,
    hasAuthoringViewerDependency: packageJson.dependencies?.["@ferrum2d/authoring-viewer"] !== undefined,
    hasFerrumDependency: packageJson.dependencies?.["@ferrum2d/ferrum-web"] !== undefined,
    hasMainSource,
    internalImports: [...mainSource.matchAll(/from\s+["'](@ferrum2d\/ferrum-web\/(?:dist|pkg|src)\/[^"']*)["']/g)]
      .map((match) => match[1]),
    authoringSurface: config.inspectAuthoringSurface({ mainSource, sceneAuthoring }),
    gameSpec,
    sceneAuthoring,
    ...(config.includePublicAssets === true ? {
      publicAssets: await listPublicAssets(root, config.publicAssetsMode),
    } : {}),
    ...(config.inspectProjectExtras?.({ mainSource, sceneAuthoring, gameSpec }) ?? {}),
  };
  return result;
}

async function inspectSceneAuthoring(config) {
  const root = config.root ?? process.cwd();
  const file = path.join(root, sceneAuthoringPath(config));
  if (!await exists(file)) return undefined;
  try {
    const source = await readFile(file, "utf8");
    const json = JSON.parse(source);
    const {
      applySceneBehaviorRecipes,
      classifySceneInstance,
      dryRunSceneBehaviorRecipes,
      previewScenePlacementBindingMigration,
      resolveBehaviorRecipeDocument,
      resolveSceneAuthoringDocument,
      resolveSceneCompositionSpec,
    } = await import("@ferrum2d/ferrum-web/authoring");
    const resolved = resolveSceneAuthoringDocument(json, {
      path: "sceneAuthoring",
      validateBindings: true,
      missingBehavior: "error",
    });
    const engine = config.createSceneAuthoringMockEngine();
    const applied = applySceneBehaviorRecipes(engine, {
      spawnSceneInstance: config.spawnSceneInstance,
    }, resolved.sceneComposition, resolved.behaviorRecipes, {
      path: "sceneAuthoring",
      ...(config.passSceneAuthoringIds === true ? { ids: resolved.ids } : {}),
      missingBehavior: "error",
    });
    return {
      ok: true,
      file: sceneAuthoringPath(config),
      format: resolved.format,
      version: resolved.version,
      publicApis: {
        applySceneBehaviorRecipes: typeof applySceneBehaviorRecipes === "function",
        classifySceneInstance: typeof classifySceneInstance === "function",
        dryRunSceneBehaviorRecipes: typeof dryRunSceneBehaviorRecipes === "function",
        previewScenePlacementBindingMigration: typeof previewScenePlacementBindingMigration === "function",
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
        placementAuthoring: scenePlacementAuthoringSummary(applied, classifySceneInstance),
        behaviorProfiles: Object.keys(resolved.behaviorRecipes.entities),
      },
    };
  } catch (error) {
    const { diagnosticReport } = await import("@ferrum2d/ferrum-web/quality").catch(() => ({ diagnosticReport: undefined }));
    const report = typeof diagnosticReport === "function" ? diagnosticReport(error) : undefined;
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      file: sceneAuthoringPath(config),
      path: sceneAuthoringErrorPath(error) ?? report?.context?.path ?? sceneAuthoringPath(config),
      message,
      detail: report?.context?.detail ?? message,
    };
  }
}

function validationDiagnostics(config, result, { requireGameSpec }) {
  const diagnostics = [];
  if (!result.hasFerrumDependency) {
    diagnostics.push(diagnostic("package.json.dependencies.@ferrum2d/ferrum-web", "package.json must depend on @ferrum2d/ferrum-web", config));
  }
  if (!result.hasAuthoringViewerDependency) {
    diagnostics.push(diagnostic("package.json.dependencies.@ferrum2d/authoring-viewer", "package.json must depend on @ferrum2d/authoring-viewer", config));
  }
  if (!result.hasMainSource) {
    diagnostics.push(diagnostic("src/main.ts", "src/main.ts is required", config));
  }
  for (const importPath of result.internalImports) {
    diagnostics.push(diagnostic("src/main.ts", `Use the public package entrypoint instead of internal import: ${importPath}`, config));
  }
  if (requireGameSpec && result.gameSpec === undefined) {
    diagnostics.push(diagnostic("public/game.json", "public/game.json is required", config));
  }
  if (result.gameSpec?.ok === false) {
    diagnostics.push(diagnostic(result.gameSpec.path, result.gameSpec.message, config));
  }
  if (result.sceneAuthoring?.ok === false) {
    diagnostics.push(diagnostic(result.sceneAuthoring.path, result.sceneAuthoring.detail ?? result.sceneAuthoring.message, config));
  }
  diagnostics.push(...(config.extraDiagnostics?.(result, { diagnostic: (pathValue, detail) => diagnostic(pathValue, detail, config) }) ?? []));
  return diagnostics;
}

async function loadReplayFixture(config) {
  const root = config.root ?? process.cwd();
  const fixture = await readJson(path.join(root, HARNESS_REPLAY_FIXTURE_PATH));
  if (fixture.format !== HARNESS_REPLAY_FIXTURE_FORMAT) {
    throw replayFixtureError(HARNESS_REPLAY_FIXTURE_PATH, `${HARNESS_REPLAY_FIXTURE_PATH} format is invalid.`);
  }
  if (fixture.version !== HARNESS_REPLAY_FIXTURE_VERSION) {
    throw replayFixtureError(HARNESS_REPLAY_FIXTURE_PATH, `${HARNESS_REPLAY_FIXTURE_PATH} version must be ${HARNESS_REPLAY_FIXTURE_VERSION}.`);
  }
  if (fixture.scenario !== config.replayScenario) {
    throw replayFixtureError(HARNESS_REPLAY_FIXTURE_PATH, `${HARNESS_REPLAY_FIXTURE_PATH} scenario must be ${config.replayScenario}.`);
  }
  const coverage = await loadReplayCoverageTags(config, fixture.coverageTagDefinitionsPath);
  assertCoverageTags(fixture.coverageTags, coverage.coverageTagDefinitions, coverage.deprecatedCoverageTags, `${HARNESS_REPLAY_FIXTURE_PATH}.coverageTags`);
  return {
    ...fixture,
    coverageTagDefinitions: coverage.coverageTagDefinitions,
    coverageTagGroups: coverage.coverageTagGroups,
    deprecatedCoverageTags: coverage.deprecatedCoverageTags,
  };
}

async function loadReplayCoverageTags(config, relativePath) {
  const expectedPath = replayCoverageTagsPath(config);
  if (relativePath !== expectedPath) {
    throw replayFixtureError(HARNESS_REPLAY_FIXTURE_PATH, `${HARNESS_REPLAY_FIXTURE_PATH} coverageTagDefinitionsPath must be ${expectedPath}.`);
  }
  try {
    const coverage = await readJson(path.join(config.root ?? process.cwd(), relativePath));
    if (coverage.format !== HARNESS_REPLAY_COVERAGE_TAGS_FORMAT) {
      throw new Error(`${relativePath} format is invalid.`);
    }
    if (coverage.version !== HARNESS_REPLAY_COVERAGE_TAGS_VERSION) {
      throw new Error(`${relativePath} version must be ${HARNESS_REPLAY_COVERAGE_TAGS_VERSION}.`);
    }
    assertCoverageTagDefinitions(coverage.coverageTagDefinitions, `${relativePath}.coverageTagDefinitions`);
    assertCoverageTagGroups(coverage.coverageTagGroups, `${relativePath}.coverageTagGroups`, coverage.coverageTagDefinitions);
    assertDeprecatedCoverageTags(coverage.deprecatedCoverageTags, `${relativePath}.deprecatedCoverageTags`, coverage.coverageTagDefinitions);
    return coverage;
  } catch (error) {
    throw replayFixtureError(relativePath, error instanceof Error ? error.message : String(error));
  }
}

function replayFixturePatchCandidate(config, actualRun, fixture) {
  return {
    kind: "consumer-gameplay-replay-fixture",
    code: "FERRUM_CONSUMER_REPLAY_FIXTURE_PATCH_CANDIDATE",
    path: HARNESS_REPLAY_FIXTURE_PATH,
    message: config.replayPatchMessage,
    expected: config.createReplayFixture(actualRun),
    actual: {
      scenario: fixture.scenario,
      replayHash: fixture.replay?.replayHash,
    },
    suggestion: config.replayPatchSuggestion,
  };
}

function replayFixtureDiagnostic(pathValue, detail) {
  return {
    code: "FERRUM_CONSUMER_REPLAY_FIXTURE_INVALID",
    message: `Invalid Ferrum2D consumer replay fixture: path=${JSON.stringify(pathValue)} detail=${JSON.stringify(detail)}.`,
    context: {
      kind: "consumer-gameplay-replay",
      path: pathValue,
      detail,
    },
  };
}

function diagnostic(pathValue, detail, config) {
  return {
    code: "FERRUM_CONSUMER_AUTHORING_INVALID",
    message: `${config.diagnosticMessagePrefix ?? "Invalid Ferrum2D consumer authoring data"}: path=${JSON.stringify(pathValue)} detail=${JSON.stringify(detail)}.`,
    context: {
      kind: "consumer-gameplay-authoring",
      path: pathValue,
      detail,
    },
  };
}

function reportFromDiagnostic(config, entry) {
  if (entry.code === "FERRUM_CONSUMER_REPLAY_FIXTURE_INVALID") {
    return {
      kind: entry.context.kind,
      code: entry.code,
      path: entry.context.path,
      message: entry.message,
      expected: config.replayFixtureReportExpected ?? "valid Ferrum2D consumer replay fixture",
      actual: entry.context.detail,
      suggestion: config.replayFixtureReportSuggestion ?? "Fix the reported replay fixture path and rerun npm run ferrum:replay-report.",
    };
  }
  return {
    kind: config.reportKind ?? "consumer-gameplay-authoring",
    code: config.reportCode ?? entry.code,
    path: entry.context.path,
    message: entry.message,
    expected: config.reportExpected ?? "valid Ferrum2D consumer project authoring data",
    actual: entry.context.detail,
    suggestion: config.reportSuggestion ?? "Fix the reported file/path and rerun npm run ferrum:authoring-report.",
  };
}

function authoringStatus(config, result) {
  if (typeof config.authoringStatus === "function") {
    return config.authoringStatus(result);
  }
  if (result.gameSpec?.ok === false || result.sceneAuthoring?.ok === false) return "invalid";
  if (result.gameSpec?.ok === true || result.sceneAuthoring?.ok === true) return "validated";
  return "not-configured";
}

function missingGameSpecCheck(config) {
  return config.requireGameSpec === true
    ? { ok: false, message: "public/game.json is required" }
    : { ok: null, message: "public/game.json not present" };
}

function recommendedCommands() {
  return [
    "npm run ferrum:report",
    "npm run ferrum:validate",
    "npm run ferrum:placement-viewer",
    "npm run ferrum:authoring-report",
    "npm run ferrum:replay-report",
    "npm run ferrum:runtime-replay-report",
    "npm run ferrum:smoke",
    "npm run dev",
  ];
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

function scenePlacementAuthoringSummary(applied, classifySceneInstance) {
  const bindingsByInstanceId = new Map();
  for (const binding of applied.plan.bindings) {
    const instanceBindings = bindingsByInstanceId.get(binding.instance.id);
    if (instanceBindings === undefined) {
      bindingsByInstanceId.set(binding.instance.id, [binding]);
    } else {
      instanceBindings.push(binding);
    }
  }

  return {
    ...FERRUM_AUTHORING_VIEWER_OWNERSHIP,
    fragment: applied.plan.fragment,
    instanceCount: applied.plan.instances.length,
    instances: applied.plan.instances.map((instance) => {
      const classification = classifySceneInstance(instance, {
        path: `sceneAuthoring.placement.instances.${instance.id}`,
      });
      const bindings = bindingsByInstanceId.get(instance.id) ?? [];
      const handle = applied.entityHandles[instance.id];
      return {
        instanceId: instance.id,
        prefab: instance.prefab,
        ...(instance.variant === undefined ? {} : { variant: instance.variant }),
        role: classification.kind,
        runtimeEntity: typeof instance.props.runtimeEntity === "string" ? instance.props.runtimeEntity : null,
        behaviorProfiles: [...classification.behaviorProfiles],
        behaviorBindingCount: classification.behaviorProfiles.length,
        behaviorBindings: classification.behaviorProfiles.map((recipeId) => {
          const recipeBindings = bindings.filter((binding) => binding.behaviorEntity === recipeId);
          return {
            ...createAuthoringViewerBehaviorBindingEvidence({
              instanceId: instance.id,
              recipeId,
              commandCount: recipeBindings.length,
              commandTypes: uniqueSorted(recipeBindings.map((binding) => binding.command.type)),
            }),
            target: {
              kind: "instance",
              instanceId: instance.id,
              prefab: instance.prefab,
              ...(instance.variant === undefined ? {} : { variant: instance.variant }),
            },
          };
        }),
        behaviorCommandCount: bindings.length,
        behaviorCommandTypes: uniqueSorted(bindings.map((binding) => binding.command.type)),
        entity: handle === undefined
          ? null
          : {
            entityId: handle.entityId,
            entityGeneration: handle.entityGeneration,
          },
      };
    }),
  };
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function sceneAuthoringErrorPath(error) {
  return error instanceof Error && typeof error.sceneAuthoringPath === "string"
    ? error.sceneAuthoringPath
    : undefined;
}

function replayFixtureError(pathValue, message) {
  const error = new Error(message);
  error.replayFixturePath = pathValue;
  return error;
}

function replayFixtureErrorPath(error) {
  return error instanceof Error && typeof error.replayFixturePath === "string"
    ? error.replayFixturePath
    : HARNESS_REPLAY_FIXTURE_PATH;
}

function sceneAuthoringPath(config) {
  return config.sceneAuthoringPath ?? HARNESS_SCENE_AUTHORING_PATH;
}

function replayCoverageTagsPath(config) {
  return config.replayCoverageTagsPath ?? HARNESS_REPLAY_COVERAGE_TAGS_PATH;
}
