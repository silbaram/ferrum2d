#!/usr/bin/env node
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assert,
  assertFilesAllowlist,
  assertSemverPackage,
  checkPackedTarball,
  readJson,
  requireFile,
  run,
  runNodeCheck,
} from "./package-check-helpers.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(repoRoot, "packages/create-game");
const packageJson = await readJson(path.join(packageRoot, "package.json"));
const expectPublishable = process.argv.includes("--expect-publishable");
const verifyPack = process.argv.includes("--verify-pack");
const packageLabel = "@ferrum2d/create-game";
const expectedFiles = ["LICENSE", "README.md", "bin", "templates"];
const commonRequiredTemplateFiles = [
  "index.html",
  "package.json",
  "scripts/ferrum-harness.mjs",
  "scripts/ferrum-runtime-replay.mjs",
  "src/main.ts",
  "src/styles.css",
];
const templateCatalog = await readJson(path.join(packageRoot, "templates/manifest.json"));
const templateEntries = validateTemplateCatalog(templateCatalog);
const templateNames = templateEntries.map((template) => template.id);
const runtimeReplayConfiguredTemplateNames = new Set(
  templateEntries.filter((template) => template.runtimeGameplayReplay.configured).map((template) => template.id),
);
const templateDirectoryNames = await listTemplateDirectoryNames();
const requiredPackageFiles = [
  "LICENSE",
  "README.md",
  "bin/create-game.mjs",
  "templates/manifest.json",
  ...templateEntries.flatMap((template) => (
    requiredTemplateFilesForTemplate(template).map((file) => `templates/${template.id}/${file}`)
  )),
];
const requiredPackedFiles = [
  "package/package.json",
  "package/LICENSE",
  "package/README.md",
  "package/bin/create-game.mjs",
  "package/templates/manifest.json",
  ...templateEntries.flatMap((template) => (
    requiredTemplateFilesForTemplate(template).map((file) => `package/templates/${template.id}/${file}`)
  )),
];
const requiredTemplateNames = ["minimal", "topdown", "platformer"];

assert(packageJson.name === packageLabel, "create-game package name must stay @ferrum2d/create-game");
assert(
  JSON.stringify(templateDirectoryNames) === JSON.stringify(templateNames),
  `create-game template directories must match manifest ids. manifest=${templateNames.join(", ")} directories=${templateDirectoryNames.join(", ")}`,
);
for (const requiredTemplateName of requiredTemplateNames) {
  assert(templateNames.includes(requiredTemplateName), `create-game templates must include ${requiredTemplateName}`);
}
assertSemverPackage(packageJson, { expectPublishable, packageLabel });
assert(packageJson.type === "module", "create-game package type must be module");
assert(packageJson.license === "MIT OR Apache-2.0", "create-game package license must stay MIT OR Apache-2.0");
assert(packageJson.bin?.["create-ferrum2d-game"] === "./bin/create-game.mjs", "create-game bin must point to ./bin/create-game.mjs");
assert(packageJson.engines?.node === ">=18.17", "create-game Node engine must stay >=18.17");
assert(packageJson.publishConfig?.access === "public", "create-game publishConfig.access must be public");
assert(packageJson.publishConfig?.tag === "beta", "create-game publishConfig.tag must be beta");
assertFilesAllowlist(packageJson, expectedFiles, packageLabel);

for (const file of requiredPackageFiles) {
  await requireFile(path.join(packageRoot, file), repoRoot);
}
for (const template of templateEntries) {
  if (template.gameplayReplay.configured) {
    await checkReplayCoverageRegistry(path.join(packageRoot, "templates", template.id), template);
  }
}
await runNodeCheck(path.join(packageRoot, "bin/create-game.mjs"), repoRoot);
for (const template of templateEntries) {
  await checkGeneratedProject(template);
}
if (verifyPack) {
  await checkPackedTarball({
    packageRoot,
    requiredFiles: requiredPackedFiles,
    forbiddenPrefixes: [
      "package/node_modules/",
      "package/dist/",
      "package/test/",
    ],
  });
}

console.log("packages/create-game package check ok");

function validateTemplateCatalog(catalog) {
  assert(catalog.format === "ferrum-create-game-template-catalog", "create-game template manifest format must stay ferrum-create-game-template-catalog");
  assert(catalog.version === 1, "create-game template manifest version must stay 1");
  assert(Array.isArray(catalog.templates), "create-game template manifest must include templates");
  const ids = new Set();
  for (const template of catalog.templates) {
    assert(typeof template.id === "string" && /^[a-z0-9-]+$/.test(template.id), "create-game template ids must use lowercase letters, numbers, and hyphens");
    assert(!ids.has(template.id), `create-game template manifest must not duplicate id ${template.id}`);
    assertNonEmptyString(template.name, `create-game template ${template.id} name`);
    assertNonEmptyString(template.description, `create-game template ${template.id} description`);
    assertNonEmptyString(template.genre, `create-game template ${template.id} genre`);
    assertStringArray(template.tags, `create-game template ${template.id} tags`);
    validateTemplateReplayCatalog(template);
    validateTemplateRuntimeReplayCatalog(template);
    ids.add(template.id);
  }
  assert(ids.has(catalog.defaultTemplate), "create-game template manifest defaultTemplate must reference a listed template id");
  return [...catalog.templates].sort((left, right) => left.id.localeCompare(right.id));
}

function validateTemplateRuntimeReplayCatalog(template) {
  const replay = template.runtimeGameplayReplay;
  assert(replay !== null && typeof replay === "object" && !Array.isArray(replay), `create-game template ${template.id} runtimeGameplayReplay must be an object`);
  assert(typeof replay.configured === "boolean", `create-game template ${template.id} runtimeGameplayReplay.configured must be boolean`);
  if (replay.configured) {
    assertNonEmptyString(replay.scenario, `create-game template ${template.id} runtimeGameplayReplay.scenario`);
    assertNonEmptyString(replay.fixturePath, `create-game template ${template.id} runtimeGameplayReplay.fixturePath`);
    assertNonEmptyString(replay.coverageTagDefinitionsPath, `create-game template ${template.id} runtimeGameplayReplay.coverageTagDefinitionsPath`);
    assert(
      replay.fixturePath === "public/gameplay-runtime-replay.fixture.json",
      `create-game template ${template.id} runtimeGameplayReplay.fixturePath must be public/gameplay-runtime-replay.fixture.json`,
    );
    assert(
      replay.coverageTagDefinitionsPath === "public/gameplay-runtime-replay.coverage-tags.json",
      `create-game template ${template.id} runtimeGameplayReplay.coverageTagDefinitionsPath must be public/gameplay-runtime-replay.coverage-tags.json`,
    );
  } else {
    assertNonEmptyString(replay.reason, `create-game template ${template.id} runtimeGameplayReplay.reason`);
    assert(replay.scenario === undefined, `create-game template ${template.id} unconfigured runtime replay must not include scenario`);
    assert(replay.fixturePath === undefined, `create-game template ${template.id} unconfigured runtime replay must not include fixturePath`);
    assert(replay.coverageTagDefinitionsPath === undefined, `create-game template ${template.id} unconfigured runtime replay must not include coverageTagDefinitionsPath`);
  }
}

function validateTemplateReplayCatalog(template) {
  const replay = template.gameplayReplay;
  assert(replay !== null && typeof replay === "object" && !Array.isArray(replay), `create-game template ${template.id} gameplayReplay must be an object`);
  assert(typeof replay.configured === "boolean", `create-game template ${template.id} gameplayReplay.configured must be boolean`);
  if (replay.configured) {
    assertNonEmptyString(replay.scenario, `create-game template ${template.id} gameplayReplay.scenario`);
    assertNonEmptyString(replay.fixturePath, `create-game template ${template.id} gameplayReplay.fixturePath`);
    assertNonEmptyString(replay.coverageTagDefinitionsPath, `create-game template ${template.id} gameplayReplay.coverageTagDefinitionsPath`);
    assert(
      replay.fixturePath === "public/gameplay-replay.fixture.json",
      `create-game template ${template.id} gameplayReplay.fixturePath must be public/gameplay-replay.fixture.json`,
    );
    assert(
      replay.coverageTagDefinitionsPath === "public/gameplay-replay.coverage-tags.json",
      `create-game template ${template.id} gameplayReplay.coverageTagDefinitionsPath must be public/gameplay-replay.coverage-tags.json`,
    );
  } else {
    assertNonEmptyString(replay.reason, `create-game template ${template.id} gameplayReplay.reason`);
    assert(replay.scenario === undefined, `create-game template ${template.id} unconfigured replay must not include scenario`);
    assert(replay.fixturePath === undefined, `create-game template ${template.id} unconfigured replay must not include fixturePath`);
    assert(replay.coverageTagDefinitionsPath === undefined, `create-game template ${template.id} unconfigured replay must not include coverageTagDefinitionsPath`);
  }
}

function assertNonEmptyString(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty string`);
}

function assertStringArray(value, label) {
  assert(Array.isArray(value) && value.length > 0, `${label} must be a non-empty array`);
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    assertNonEmptyString(item, `${label}[${index}]`);
    assert(!seen.has(item), `${label}[${index}] must be unique`);
    seen.add(item);
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

function requiredTemplateFilesForTemplate(template) {
  const replayFiles = template.gameplayReplay.configured
    ? [
        template.gameplayReplay.coverageTagDefinitionsPath,
        template.gameplayReplay.fixturePath,
      ]
    : [];
  const runtimeReplayFiles = template.runtimeGameplayReplay.configured
    ? [
        template.runtimeGameplayReplay.coverageTagDefinitionsPath,
        template.runtimeGameplayReplay.fixturePath,
      ]
    : [];
  const templateName = template.id;
  if (templateName === "topdown") {
    return [
      ...commonRequiredTemplateFiles,
      "public/game.json",
      ...replayFiles,
      ...runtimeReplayFiles,
    ];
  }
  return [
    ...commonRequiredTemplateFiles,
    ...replayFiles,
    ...runtimeReplayFiles,
  ];
}

async function listTemplateDirectoryNames() {
  const entries = await readdir(path.join(packageRoot, "templates"), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function checkGeneratedProject(template) {
  const templateName = template.id;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ferrum2d-create-game-check-"));
  try {
    const targetRoot = path.join(tempDir, `sample-${templateName}-game`);
    const cliPath = path.join(packageRoot, "bin/create-game.mjs");
    const result = await run(process.execPath, [
      cliPath,
      targetRoot,
      "--template",
      templateName,
      "--ferrum-version",
      "0.0.0-test",
    ], repoRoot);
    assert(
      result.code === 0,
      `create-game CLI failed with exit code ${result.code}\n${result.stdout}\n${result.stderr}`.trim(),
    );

    const generatedPackage = await readJson(path.join(targetRoot, "package.json"));
    assert(
      generatedPackage.name === `sample-${templateName}-game`,
      "generated package name must be derived from target directory",
    );
    assert(generatedPackage.private === true, "generated game project must be private by default");
    assert(generatedPackage.dependencies?.["@ferrum2d/ferrum-web"] === "0.0.0-test", "generated game must depend on @ferrum2d/ferrum-web");
    assert(generatedPackage.scripts?.dev === "vite", "generated game must include dev script");
    assert(generatedPackage.scripts?.build === "vite build --base=./", "generated game must include static-safe build script");
    assert(generatedPackage.scripts?.["ferrum:validate"] === "node scripts/ferrum-harness.mjs validate", "generated game must include ferrum:validate script");
    assert(generatedPackage.scripts?.["ferrum:smoke"] === "node scripts/ferrum-harness.mjs smoke", "generated game must include ferrum:smoke script");
    assert(generatedPackage.scripts?.["ferrum:report"] === "node scripts/ferrum-harness.mjs report", "generated game must include ferrum:report script");
    assert(generatedPackage.scripts?.["ferrum:authoring-report"] === "node scripts/ferrum-harness.mjs authoring-report", "generated game must include ferrum:authoring-report script");
    assert(generatedPackage.scripts?.["ferrum:replay-report"] === "node scripts/ferrum-harness.mjs replay-report", "generated game must include ferrum:replay-report script");
    assert(generatedPackage.scripts?.["ferrum:runtime-replay-report"] === "node scripts/ferrum-runtime-replay.mjs report", "generated game must include ferrum:runtime-replay-report script");
    assert(generatedPackage.scripts?.["ferrum:runtime-replay-recipe"] === "node scripts/ferrum-runtime-replay.mjs recipe", "generated game must include ferrum:runtime-replay-recipe script");
    assert(generatedPackage.scripts?.["ferrum:update-runtime-replay-fixture"] === "node scripts/ferrum-runtime-replay.mjs update-fixture", "generated game must include ferrum:update-runtime-replay-fixture script");
    if (template.gameplayReplay.configured) {
      assert(
        generatedPackage.scripts?.["ferrum:update-replay-fixture"] === "node scripts/ferrum-harness.mjs update-replay-fixture",
        `${templateName} generated game with replay fixture must include ferrum:update-replay-fixture script`,
      );
    }
    assert(generatedPackage.devDependencies?.vite !== undefined, "generated game must include vite devDependency");

    const mainSource = await readFile(path.join(targetRoot, "src/main.ts"), "utf8");
    assert(mainSource.includes('from "@ferrum2d/ferrum-web"'), "generated game must import from package public entrypoint");
    assert(!mainSource.includes("@ferrum2d/ferrum-web/dist/"), "generated game must not import dist internals");
    assert(!mainSource.includes("@ferrum2d/ferrum-web/pkg/"), "generated game must not import wasm package internals");
    assert(!mainSource.includes("@ferrum2d/ferrum-web/src/"), "generated game must not import source internals");
    if (templateName === "minimal") {
      assertMinimalTemplateWeaponAuthoring(mainSource);
    }

    await requireFile(path.join(targetRoot, "index.html"), repoRoot);
    const generatedHarnessPath = path.join(targetRoot, "scripts/ferrum-harness.mjs");
    await requireFile(generatedHarnessPath, repoRoot);
    await runNodeCheck(generatedHarnessPath, repoRoot);
    const generatedRuntimeReplayPath = path.join(targetRoot, "scripts/ferrum-runtime-replay.mjs");
    await requireFile(generatedRuntimeReplayPath, repoRoot);
    await runNodeCheck(generatedRuntimeReplayPath, repoRoot);
    await assertRuntimeReplayScaffold(generatedRuntimeReplayPath, templateName);
    await assertRuntimeReplayRecipe(targetRoot, templateName);
    if (template.runtimeGameplayReplay.configured) {
      await requireFile(path.join(targetRoot, template.runtimeGameplayReplay.coverageTagDefinitionsPath), repoRoot);
      await requireFile(path.join(targetRoot, template.runtimeGameplayReplay.fixturePath), repoRoot);
      await checkRuntimeReplayCoverageRegistry(targetRoot, template);
    } else {
      await assertRuntimeReplayNotConfiguredReport(targetRoot, templateName);
      await assertRuntimeReplayUpdateNotConfiguredReport(targetRoot, templateName);
      assert(
        !await exists(path.join(targetRoot, "public/gameplay-runtime-replay.fixture.json")),
        `${templateName} generated game must not include a project-specific runtime replay fixture by default`,
      );
      assert(
        !await exists(path.join(targetRoot, "public/gameplay-runtime-replay.coverage-tags.json")),
        `${templateName} generated game must not include project-specific runtime replay coverage tags by default`,
      );
    }
    await requireFile(path.join(targetRoot, "src/styles.css"), repoRoot);
    if (template.gameplayReplay.configured) {
      await requireFile(path.join(targetRoot, template.gameplayReplay.coverageTagDefinitionsPath), repoRoot);
      await requireFile(path.join(targetRoot, template.gameplayReplay.fixturePath), repoRoot);
      await checkReplayCoverageRegistry(targetRoot, template);
    }
    if (templateName === "topdown") {
      await requireFile(path.join(targetRoot, "public/game.json"), repoRoot);
      assert(mainSource.includes("resolveShooterGameSpec"), "topdown template runtime must validate public/game.json");
      assert(mainSource.includes("./game.json"), "topdown template runtime must load public/game.json");
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function assertMinimalTemplateWeaponAuthoring(mainSource) {
  assert(
    mainSource.includes("compileWeaponProfiles") &&
      mainSource.includes("behaviorRecipeCommandsForEntity") &&
      mainSource.includes("ProjectileDefinition") &&
      mainSource.includes("WeaponDefinition"),
    "minimal template must include public projectile/weapon authoring imports",
  );
  assert(
    mainSource.includes('"standard"') &&
      mainSource.includes('"piercing"') &&
      mainSource.includes('"bounce"') &&
      mainSource.includes("tileImpact: \"passThrough\"") &&
      mainSource.includes("tileImpact: \"bounce\""),
    "minimal template must include standard, piercing, and bounce projectile authoring profiles",
  );
  assert(
    mainSource.includes("applyGameplayBehaviorCommands") &&
      mainSource.includes("builtInShooterPlayerHandle") &&
      mainSource.includes("setInputActionBinding") &&
      mainSource.includes('searchParams.get("profile")'),
    "minimal template must apply selected weapon profile through public runtime authoring APIs",
  );
}

async function assertRuntimeReplayScaffold(filePath, templateName) {
  const source = await readFile(filePath, "utf8");
  assert(
    source.includes('await import("@ferrum2d/ferrum-web")'),
    `${templateName} runtime replay scaffold must use the public @ferrum2d/ferrum-web entrypoint`,
  );
  assert(!source.includes("@ferrum2d/ferrum-web/dist/"), `${templateName} runtime replay scaffold must not import dist internals`);
  assert(!source.includes("@ferrum2d/ferrum-web/pkg/"), `${templateName} runtime replay scaffold must not import wasm package internals`);
  assert(!source.includes("@ferrum2d/ferrum-web/src/"), `${templateName} runtime replay scaffold must not import source internals`);
  assert(!source.includes("packages/ferrum-web"), `${templateName} runtime replay scaffold must not import engine workspace files`);
  assert(!source.includes("ferrum_core"), `${templateName} runtime replay scaffold must not import generated wasm bindings`);
  if (runtimeReplayConfiguredTemplateNames.has(templateName)) {
    assert(
      source.includes("PROJECT_RUNTIME_REPLAY_CONFIGURED = true"),
      `${templateName} runtime replay must be configured for headless engine capture`,
    );
    assert(
      source.includes("createEngine") &&
        source.includes("captureGameStateSnapshot") &&
        source.includes("requestAnimationFrame"),
      `${templateName} runtime replay must use public headless engine capture`,
    );
  } else {
    assert(
      source.includes("PROJECT_RUNTIME_REPLAY_CONFIGURED = false"),
      `${templateName} runtime replay scaffold must default to not-configured`,
    );
  }
  assert(
      source.includes("captureProjectRuntimeSnapshots") &&
      source.includes("TEMPLATE_RUNTIME_REPLAY_RECIPE") &&
      source.includes("createGameplayReplayRun") &&
      source.includes("compareGameplayReplayRuns") &&
      source.includes("hashGameStateSnapshot"),
    `${templateName} runtime replay scaffold must expose public replay helper workflow`,
  );
  assert(
    source.includes("FERRUM_CONSUMER_RUNTIME_REPLAY_NOT_CONFIGURED") &&
      source.includes("FERRUM_CONSUMER_RUNTIME_REPLAY_MISMATCH") &&
      source.includes("FERRUM_CONSUMER_RUNTIME_REPLAY_FIXTURE_PATCH_CANDIDATE"),
    `${templateName} runtime replay scaffold must provide machine-actionable runtime replay diagnostics`,
  );
}

async function assertRuntimeReplayRecipe(projectRoot, templateName) {
  const result = await run(process.execPath, ["scripts/ferrum-runtime-replay.mjs", "recipe"], projectRoot);
  assert(
    result.code === 0,
    `${templateName} runtime replay recipe command must pass\n${result.stdout}\n${result.stderr}`.trim(),
  );
  let recipe;
  try {
    recipe = JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[package check] ${templateName} runtime replay recipe must emit JSON: ${message}`);
  }
  assert(recipe.format === "ferrum2d.consumer.runtime-gameplay-replay.recipe", `${templateName} runtime replay recipe format is invalid`);
  assert(recipe.version === 1, `${templateName} runtime replay recipe version must be 1`);
  assert(recipe.template === templateName, `${templateName} runtime replay recipe template is invalid`);
  assert(recipe.scenario === "project-runtime", `${templateName} runtime replay recipe scenario is invalid`);
  const expectedStatus = runtimeReplayConfiguredTemplateNames.has(templateName) ? "configured" : "scaffold";
  assert(recipe.status === expectedStatus, `${templateName} runtime replay recipe status must be ${expectedStatus}`);
  assert(recipe.fixture === "public/gameplay-runtime-replay.fixture.json", `${templateName} runtime replay recipe fixture path is invalid`);
  assert(
    recipe.coverageTagDefinitionsPath === "public/gameplay-runtime-replay.coverage-tags.json",
    `${templateName} runtime replay recipe coverage path is invalid`,
  );
  assert(JSON.stringify(recipe.coverageTags) === JSON.stringify(["project-runtime"]), `${templateName} runtime replay recipe coverage tags are invalid`);
  assert(recipe.deterministicRun?.fixedDelta === 1 / 60, `${templateName} runtime replay recipe fixedDelta is invalid`);
  assertNonEmptyString(recipe.deterministicRun?.seed, `${templateName} runtime replay recipe deterministicRun.seed`);
  assertRuntimeReplayInputSequence(recipe.deterministicRun?.inputSequence, `${templateName} runtime replay recipe inputSequence`);
  assert(Array.isArray(recipe.deterministicRun?.captureFrames) && recipe.deterministicRun.captureFrames.length > 0, `${templateName} runtime replay recipe captureFrames must be non-empty`);
  let previousFrame = -1;
  for (const [index, frame] of recipe.deterministicRun.captureFrames.entries()) {
    assert(Number.isInteger(frame) && frame >= 0, `${templateName} runtime replay recipe captureFrames[${index}] must be a non-negative integer`);
    assert(frame > previousFrame, `${templateName} runtime replay recipe captureFrames must be strictly increasing`);
    previousFrame = frame;
  }
  assertStringArray(recipe.canonicalState?.required, `${templateName} runtime replay recipe canonicalState.required`);
  assertStringArray(recipe.canonicalState?.excluded, `${templateName} runtime replay recipe canonicalState.excluded`);
  assertStringArray(recipe.implementationSteps, `${templateName} runtime replay recipe implementationSteps`);
  assert(
    recipe.canonicalState.excluded.includes("render commands") &&
      recipe.canonicalState.excluded.includes("audio playback") &&
      recipe.canonicalState.excluded.includes("DOM state") &&
      recipe.canonicalState.excluded.includes("wall-clock timings"),
    `${templateName} runtime replay recipe must exclude non-canonical runtime outputs`,
  );
}

async function assertRuntimeReplayUpdateNotConfiguredReport(projectRoot, templateName) {
  const result = await run(process.execPath, ["scripts/ferrum-runtime-replay.mjs", "update-fixture"], projectRoot);
  assert(
    result.code !== 0,
    `${templateName} runtime replay fixture update must fail while scaffold is not configured`,
  );
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[package check] ${templateName} runtime replay update must emit JSON: ${message}`);
  }
  assert(report.format === "ferrum2d.consumer.runtime-gameplay-replay.report", `${templateName} runtime replay update report format is invalid`);
  assert(report.version === 1, `${templateName} runtime replay update report version must be 1`);
  assert(report.ok === false, `${templateName} runtime replay update report must be ok=false while scaffold is not configured`);
  assert(report.runtimeGameplayReplay?.configured === false, `${templateName} runtime replay update report must keep configured=false`);
  assert(report.runtimeGameplayReplay?.status === "not-configured", `${templateName} runtime replay update status must be not-configured`);
  assert(report.runtimeGameplayReplay?.updateAttempted === true, `${templateName} runtime replay update report must mark updateAttempted=true`);
  assert(report.runtimeGameplayReplay?.recipe?.template === templateName, `${templateName} runtime replay update report must include template recipe`);
  assertMachineActionableReports(report.runtimeGameplayReplay?.reports, `${templateName} runtime replay update reports`);
  assert(
    report.runtimeGameplayReplay?.reports?.[0]?.code === "FERRUM_CONSUMER_RUNTIME_REPLAY_NOT_CONFIGURED",
    `${templateName} runtime replay update not-configured code is invalid`,
  );
}

async function assertRuntimeReplayNotConfiguredReport(projectRoot, templateName) {
  const result = await run(process.execPath, ["scripts/ferrum-runtime-replay.mjs", "report"], projectRoot);
  assert(
    result.code === 0,
    `${templateName} runtime replay report must pass while scaffold is not configured\n${result.stdout}\n${result.stderr}`.trim(),
  );
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[package check] ${templateName} runtime replay report must emit JSON: ${message}`);
  }
  assert(report.format === "ferrum2d.consumer.runtime-gameplay-replay.report", `${templateName} runtime replay report format is invalid`);
  assert(report.version === 1, `${templateName} runtime replay report version must be 1`);
  assert(report.ok === true, `${templateName} runtime replay report must be ok while scaffold is not configured`);
  assert(report.runtimeGameplayReplay?.configured === false, `${templateName} runtime replay report must default configured=false`);
  assert(report.runtimeGameplayReplay?.status === "not-configured", `${templateName} runtime replay status must be not-configured`);
  assert(report.runtimeGameplayReplay?.scenario === "project-runtime", `${templateName} runtime replay scenario is invalid`);
  assert(report.runtimeGameplayReplay?.fixture === "public/gameplay-runtime-replay.fixture.json", `${templateName} runtime replay fixture path is invalid`);
  assert(
    report.runtimeGameplayReplay?.coverageTagDefinitionsPath === "public/gameplay-runtime-replay.coverage-tags.json",
    `${templateName} runtime replay coverage path is invalid`,
  );
  assert(JSON.stringify(report.runtimeGameplayReplay?.coverageTags) === JSON.stringify(["project-runtime"]), `${templateName} runtime replay coverage tags are invalid`);
  assert(report.runtimeGameplayReplay?.recipe?.template === templateName, `${templateName} runtime replay report must include template recipe`);
  assertMachineActionableReports(report.runtimeGameplayReplay?.reports, `${templateName} runtime replay reports`);
  assert(
    report.runtimeGameplayReplay?.reports?.[0]?.code === "FERRUM_CONSUMER_RUNTIME_REPLAY_NOT_CONFIGURED",
    `${templateName} runtime replay not-configured code is invalid`,
  );
}

function assertMachineActionableReports(reports, label) {
  assert(Array.isArray(reports), `${label} must be an array`);
  for (const [index, report] of reports.entries()) {
    assert(report !== null && typeof report === "object" && !Array.isArray(report), `${label}[${index}] must be an object`);
    assertNonEmptyString(report.kind, `${label}[${index}].kind`);
    assertNonEmptyString(report.code, `${label}[${index}].code`);
    assertNonEmptyString(report.path, `${label}[${index}].path`);
    assertNonEmptyString(report.message, `${label}[${index}].message`);
    assertNonEmptyString(report.suggestion, `${label}[${index}].suggestion`);
  }
}

async function exists(filePath) {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function checkReplayCoverageRegistry(projectRoot, template) {
  const coveragePath = path.join(projectRoot, template.gameplayReplay.coverageTagDefinitionsPath);
  const fixturePath = path.join(projectRoot, template.gameplayReplay.fixturePath);
  const coverage = await readJson(coveragePath);
  const fixture = await readJson(fixturePath);
  assert(coverage.format === "ferrum2d.consumer.gameplay-replay.coverage-tags", `${template.id} replay coverage registry format is invalid`);
  assert(coverage.version === 1, `${template.id} replay coverage registry version must be 1`);
  assertCoverageTagDefinitions(coverage.coverageTagDefinitions, `${template.id} replay coverageTagDefinitions`);
  assertCoverageTagGroups(
    coverage.coverageTagGroups,
    `${template.id} replay coverageTagGroups`,
    coverage.coverageTagDefinitions,
  );
  assertDeprecatedCoverageTags(
    coverage.deprecatedCoverageTags,
    `${template.id} replay deprecatedCoverageTags`,
    coverage.coverageTagDefinitions,
  );
  assertReplayFixtureEnvelope(fixture, template);
  assert(
    fixture.coverageTagDefinitionsPath === template.gameplayReplay.coverageTagDefinitionsPath,
    `${template.id} replay fixture must reference ${template.gameplayReplay.coverageTagDefinitionsPath}`,
  );
  assertCoverageTags(
    fixture.coverageTags,
    coverage.coverageTagDefinitions,
    coverage.deprecatedCoverageTags,
    `${template.id} replay fixture coverageTags`,
  );
}

async function checkRuntimeReplayCoverageRegistry(projectRoot, template) {
  const coveragePath = path.join(projectRoot, template.runtimeGameplayReplay.coverageTagDefinitionsPath);
  const fixturePath = path.join(projectRoot, template.runtimeGameplayReplay.fixturePath);
  const coverage = await readJson(coveragePath);
  const fixture = await readJson(fixturePath);
  assert(coverage.format === "ferrum2d.consumer.gameplay-replay.coverage-tags", `${template.id} runtime replay coverage registry format is invalid`);
  assert(coverage.version === 1, `${template.id} runtime replay coverage registry version must be 1`);
  assertCoverageTagDefinitions(coverage.coverageTagDefinitions, `${template.id} runtime replay coverageTagDefinitions`);
  assertCoverageTagGroups(
    coverage.coverageTagGroups,
    `${template.id} runtime replay coverageTagGroups`,
    coverage.coverageTagDefinitions,
  );
  assertDeprecatedCoverageTags(
    coverage.deprecatedCoverageTags,
    `${template.id} runtime replay deprecatedCoverageTags`,
    coverage.coverageTagDefinitions,
  );
  assert(fixture !== null && typeof fixture === "object" && !Array.isArray(fixture), `${template.id} runtime replay fixture must be an object`);
  assert(fixture.format === "ferrum2d.consumer.runtime-gameplay-replay.fixture", `${template.id} runtime replay fixture format is invalid`);
  assert(fixture.version === 1, `${template.id} runtime replay fixture version must be 1`);
  assert(fixture.scenario === template.runtimeGameplayReplay.scenario, `${template.id} runtime replay fixture scenario must match template manifest`);
  assertNonEmptyString(fixture.description, `${template.id} runtime replay fixture description`);
  assert(
    fixture.coverageTagDefinitionsPath === template.runtimeGameplayReplay.coverageTagDefinitionsPath,
    `${template.id} runtime replay fixture must reference ${template.runtimeGameplayReplay.coverageTagDefinitionsPath}`,
  );
  assertCoverageTags(
    fixture.coverageTags,
    coverage.coverageTagDefinitions,
    coverage.deprecatedCoverageTags,
    `${template.id} runtime replay fixture coverageTags`,
  );
  assertReplayRun(fixture.replay, `${template.id} runtime replay fixture replay`);
}

function assertReplayFixtureEnvelope(fixture, template) {
  assert(fixture !== null && typeof fixture === "object" && !Array.isArray(fixture), `${template.id} replay fixture must be an object`);
  assert(fixture.format === "ferrum2d.consumer.gameplay-replay.fixture", `${template.id} replay fixture format is invalid`);
  assert(fixture.version === 1, `${template.id} replay fixture version must be 1`);
  assert(fixture.scenario === template.gameplayReplay.scenario, `${template.id} replay fixture scenario must match template manifest`);
  assertNonEmptyString(fixture.description, `${template.id} replay fixture description`);
  assertReplayRun(fixture.replay, `${template.id} replay fixture replay`);
}

function assertReplayRun(replay, label) {
  assert(replay !== null && typeof replay === "object" && !Array.isArray(replay), `${label} must be an object`);
  assert(replay.format === "ferrum2d.gameplay-replay.run", `${label}.format is invalid`);
  assert(replay.version === 1, `${label}.version must be 1`);
  assert(Array.isArray(replay.snapshots) && replay.snapshots.length > 0, `${label}.snapshots must be a non-empty array`);
  assertReplayHash(replay.replayHash, `${label}.replayHash`);
  for (const [index, entry] of replay.snapshots.entries()) {
    const entryLabel = `${label}.snapshots[${index}]`;
    assert(entry !== null && typeof entry === "object" && !Array.isArray(entry), `${entryLabel} must be an object`);
    assert(Number.isInteger(entry.frame) && entry.frame >= 0, `${entryLabel}.frame must be a non-negative integer`);
    assertReplayHash(entry.replayHash, `${entryLabel}.replayHash`);
    assert(entry.snapshot !== null && typeof entry.snapshot === "object" && !Array.isArray(entry.snapshot), `${entryLabel}.snapshot must be an object`);
    assertReplayHash(entry.snapshot.snapshotHash, `${entryLabel}.snapshot.snapshotHash`);
  }
}

function assertReplayHash(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{8}$/.test(value), `${label} must be an 8-character lowercase hex hash`);
}

function assertCoverageTagDefinitions(definitions, label) {
  assert(definitions !== null && typeof definitions === "object" && !Array.isArray(definitions), `${label} must be an object`);
  const entries = Object.entries(definitions);
  assert(entries.length > 0, `${label} must not be empty`);
  for (const [tag, description] of entries) {
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag), `${label}.${tag} key must be kebab-case`);
    assert(typeof description === "string" && description.length > 0, `${label}.${tag} must be a non-empty string`);
  }
}

function assertCoverageTagGroups(groups, label, definitions) {
  assert(groups !== null && typeof groups === "object" && !Array.isArray(groups), `${label} must be an object`);
  const entries = Object.entries(groups);
  assert(entries.length > 0, `${label} must not be empty`);
  const groupedTags = new Set();
  for (const [group, spec] of entries) {
    const groupLabel = `${label}.${group}`;
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group), `${groupLabel} key must be kebab-case`);
    assert(spec !== null && typeof spec === "object" && !Array.isArray(spec), `${groupLabel} must be an object`);
    assert(typeof spec.description === "string" && spec.description.length > 0, `${groupLabel}.description must be a non-empty string`);
    assertCoverageTags(spec.tags, definitions, undefined, `${groupLabel}.tags`, { requireAllDefinitions: false });
    for (const tag of spec.tags) groupedTags.add(tag);
  }
  for (const tag of Object.keys(definitions)) {
    assert(groupedTags.has(tag), `${label} must include active coverage tag '${tag}' in at least one group`);
  }
}

function assertDeprecatedCoverageTags(deprecatedTags, label, definitions) {
  assert(deprecatedTags !== null && typeof deprecatedTags === "object" && !Array.isArray(deprecatedTags), `${label} must be an object`);
  for (const [tag, description] of Object.entries(deprecatedTags)) {
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag), `${label}.${tag} key must be kebab-case`);
    assert(definitions[tag] === undefined, `${label}.${tag} must not also be an active coverage tag`);
    assert(typeof description === "string" && description.length > 0, `${label}.${tag} must be a non-empty string`);
  }
}

function assertCoverageTags(tags, definitions, deprecatedTags, label, options = {}) {
  assert(Array.isArray(tags) && tags.length > 0, `${label} must be a non-empty array`);
  const seen = new Set();
  for (const [index, tag] of tags.entries()) {
    assert(typeof tag === "string" && tag.length > 0, `${label}[${index}] must be a non-empty string`);
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag), `${label}[${index}] must be kebab-case`);
    assert(!seen.has(tag), `${label}[${index}] must be unique`);
    seen.add(tag);
    assert(definitions[tag] !== undefined, `${label}[${index}] must reference defined coverage tag '${tag}'`);
    assert(deprecatedTags?.[tag] === undefined, `${label}[${index}] must not use deprecated coverage tag '${tag}'`);
  }
  if (options.requireAllDefinitions !== false) {
    for (const tag of Object.keys(definitions)) {
      assert(seen.has(tag), `${label} must use defined coverage tag '${tag}'`);
    }
  }
}
