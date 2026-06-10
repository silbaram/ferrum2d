#!/usr/bin/env node
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageRoot = path.join(repoRoot, "packages/create-game");
const packageJson = await readJson(path.join(packageRoot, "package.json"));
const rootPackageJson = await readJson(path.join(repoRoot, "package.json"));
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
const sharedTemplateFiles = [
  "_shared/public/assets/audio.manifest.json",
  "_shared/public/assets/localization.manifest.json",
  "_shared/public/assets/texture-atlas.input.json",
  "_shared/scripts/ferrum-assets.mjs",
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
  ...sharedTemplateFiles.map((file) => `templates/${file}`),
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
  ...sharedTemplateFiles.map((file) => `package/templates/${file}`),
  ...templateEntries.flatMap((template) => (
    requiredTemplateFilesForTemplate(template).map((file) => `package/templates/${template.id}/${file}`)
  )),
];
const requiredTemplateNames = ["minimal", "topdown", "platformer", "breakout"];
let ferrumWebPublicEntrypointBuilt = false;

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
assert(
  rootPackageJson.scripts?.["smoke:create-game-template-catalog"] === "node tests/smoke/create-game-template-catalog-smoke.mjs",
  "root package.json must expose smoke:create-game-template-catalog",
);
assert(
  rootPackageJson.scripts?.["smoke:check"]?.includes("pnpm smoke:create-game-template-catalog"),
  "root smoke:check must include smoke:create-game-template-catalog",
);

for (const file of requiredPackageFiles) {
  await requireFile(path.join(packageRoot, file), repoRoot);
}
await assertCreateGameTemplateCatalogSmoke(path.join(repoRoot, "tests/smoke/create-game-template-catalog-smoke.mjs"));
for (const template of templateEntries) {
  if (template.sceneAuthoring.configured) {
    await checkSceneAuthoringFixture(path.join(packageRoot, "templates", template.id), template);
  }
  if (template.gameplayReplay.configured) {
    await checkReplayCoverageRegistry(path.join(packageRoot, "templates", template.id), template);
  }
}
const createGameCliPath = path.join(packageRoot, "bin/create-game.mjs");
await runNodeCheck(createGameCliPath, repoRoot);
await assertCreateGameCliManifestValidation(createGameCliPath);
await assertCreateGameTemplateListJson(createGameCliPath, templateEntries);
await assertCreateGameCliRejectsInvalidSceneAuthoringFixture();
await buildFerrumWebPublicEntrypoint();
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
    validateTemplateSceneAuthoringCatalog(template);
    validateTemplateReplayCatalog(template);
    validateTemplateRuntimeReplayCatalog(template);
    ids.add(template.id);
  }
  assert(ids.has(catalog.defaultTemplate), "create-game template manifest defaultTemplate must reference a listed template id");
  return [...catalog.templates].sort((left, right) => left.id.localeCompare(right.id));
}

function validateTemplateSceneAuthoringCatalog(template) {
  const sceneAuthoring = template.sceneAuthoring;
  assert(
    sceneAuthoring !== null && typeof sceneAuthoring === "object" && !Array.isArray(sceneAuthoring),
    `create-game template ${template.id} sceneAuthoring must be an object`,
  );
  assert(typeof sceneAuthoring.configured === "boolean", `create-game template ${template.id} sceneAuthoring.configured must be boolean`);
  if (sceneAuthoring.configured) {
    assertNonEmptyString(sceneAuthoring.fixturePath, `create-game template ${template.id} sceneAuthoring.fixturePath`);
    assertNonEmptyString(sceneAuthoring.format, `create-game template ${template.id} sceneAuthoring.format`);
    assert(
      sceneAuthoring.fixturePath === "public/scene-authoring.json",
      `create-game template ${template.id} sceneAuthoring.fixturePath must be public/scene-authoring.json`,
    );
    assert(
      sceneAuthoring.format === "ferrum2d.consumer.scene-authoring",
      `create-game template ${template.id} sceneAuthoring.format must be ferrum2d.consumer.scene-authoring`,
    );
  } else {
    assertNonEmptyString(sceneAuthoring.reason, `create-game template ${template.id} sceneAuthoring.reason`);
    assert(sceneAuthoring.fixturePath === undefined, `create-game template ${template.id} unconfigured scene authoring must not include fixturePath`);
    assert(sceneAuthoring.format === undefined, `create-game template ${template.id} unconfigured scene authoring must not include format`);
  }
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
  const sceneAuthoringFiles = template.sceneAuthoring.configured
    ? [template.sceneAuthoring.fixturePath]
    : [];
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
      ...sceneAuthoringFiles,
      ...replayFiles,
      ...runtimeReplayFiles,
    ];
  }
  return [
    ...commonRequiredTemplateFiles,
    ...sceneAuthoringFiles,
    ...replayFiles,
    ...runtimeReplayFiles,
  ];
}

async function assertCreateGameCliManifestValidation(cliPath) {
  const source = await readFile(cliPath, "utf8");
  assert(
    source.includes("validateTemplateSceneAuthoringCatalog") &&
      source.includes("validateTemplateSceneAuthoringFixture") &&
      source.includes("templateCatalogListReport") &&
      source.includes("sceneAuthoring.fixturePath") &&
      source.includes("scene authoring fixture sceneComposition") &&
      source.includes("ferrum2d.consumer.scene-authoring") &&
      source.includes("validateTemplateReplayCatalog") &&
      source.includes("runtimeGameplayReplay"),
    "create-game CLI must validate scene authoring and replay catalog entries before copying templates",
  );
  assert(
    source.includes("sharedTemplateRoot") &&
      source.includes("Shared create-game template scaffold is missing.") &&
      source.includes("await copyTemplate(sharedTemplateRoot"),
    "create-game CLI must apply the shared template scaffold before copying a genre template",
  );
}

async function assertCreateGameTemplateCatalogSmoke(filePath) {
  await requireFile(filePath, repoRoot);
  const source = await readFile(filePath, "utf8");
  assert(
    source.includes("assertInvalidCatalogFailsBeforeJsonOutput") &&
      source.includes("invalid.scene-authoring") &&
      source.includes("invalid manifest must not emit a JSON catalog"),
    "create-game template catalog smoke must reject invalid manifest data before emitting JSON",
  );
}

async function assertCreateGameTemplateListJson(cliPath, templates) {
  const result = await run(process.execPath, [cliPath, "--list-templates", "--json"], repoRoot);
  assert(
    result.code === 0,
    `create-game --list-templates --json failed with exit code ${result.code}\n${result.stdout}\n${result.stderr}`.trim(),
  );
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`create-game --list-templates --json must emit JSON: ${message}`);
  }
  assert(report.format === "ferrum-create-game-template-list", "create-game template list JSON format is invalid");
  assert(report.version === 1, "create-game template list JSON version must be 1");
  assert(report.defaultTemplate === templateCatalog.defaultTemplate, "create-game template list JSON defaultTemplate must match manifest");
  assert(Array.isArray(report.templates), "create-game template list JSON templates must be an array");
  assert(report.templates.length === templates.length, "create-game template list JSON template count must match manifest");
  for (const template of templates) {
    const listed = report.templates.find((candidate) => candidate.id === template.id);
    assert(listed !== undefined, `create-game template list JSON must include ${template.id}`);
    assert(listed.name === template.name, `${template.id} template list name must match manifest`);
    assert(listed.description === template.description, `${template.id} template list description must match manifest`);
    assert(listed.genre === template.genre, `${template.id} template list genre must match manifest`);
    assert(JSON.stringify(listed.tags) === JSON.stringify(template.tags), `${template.id} template list tags must match manifest`);
    assert(
      JSON.stringify(listed.sceneAuthoring) === JSON.stringify(template.sceneAuthoring),
      `${template.id} template list sceneAuthoring must match manifest`,
    );
    assert(
      JSON.stringify(listed.gameplayReplay) === JSON.stringify(template.gameplayReplay),
      `${template.id} template list gameplayReplay must match manifest`,
    );
    assert(
      JSON.stringify(listed.runtimeGameplayReplay) === JSON.stringify(template.runtimeGameplayReplay),
      `${template.id} template list runtimeGameplayReplay must match manifest`,
    );
  }

  const textResult = await run(process.execPath, [cliPath, "--list-templates"], repoRoot);
  assert(textResult.code === 0, "create-game --list-templates text output must still pass");
  assert(!textResult.stdout.trim().startsWith("{"), "create-game --list-templates must keep human-readable output by default");

  const misplacedJsonResult = await run(process.execPath, [cliPath, "--json", "sample-game"], repoRoot);
  assert(misplacedJsonResult.code !== 0, "create-game --json must fail without --list-templates");
  assert(
    misplacedJsonResult.stderr.includes("--json can only be used with --list-templates"),
    "create-game --json misuse error must explain the required --list-templates pairing",
  );
}

async function checkSceneAuthoringFixture(templateRoot, template) {
  const fixturePath = path.join(templateRoot, template.sceneAuthoring.fixturePath);
  const fixture = await readJson(fixturePath);
  assert(
    fixture !== null && typeof fixture === "object" && !Array.isArray(fixture),
    `${template.id} scene authoring fixture must be an object`,
  );
  assert(
    fixture.format === template.sceneAuthoring.format,
    `${template.id} scene authoring fixture format must match manifest`,
  );
  assert(fixture.version === 1, `${template.id} scene authoring fixture version must be 1`);
  assert(
    fixture.sceneComposition !== null && typeof fixture.sceneComposition === "object" && !Array.isArray(fixture.sceneComposition),
    `${template.id} scene authoring fixture sceneComposition must be an object`,
  );
  assert(
    fixture.behaviorRecipes !== null && typeof fixture.behaviorRecipes === "object" && !Array.isArray(fixture.behaviorRecipes),
    `${template.id} scene authoring fixture behaviorRecipes must be an object`,
  );
  assert(
    fixture.sceneComposition.prefabs !== null &&
      typeof fixture.sceneComposition.prefabs === "object" &&
      !Array.isArray(fixture.sceneComposition.prefabs) &&
      Object.keys(fixture.sceneComposition.prefabs).length > 0,
    `${template.id} scene authoring fixture sceneComposition.prefabs must not be empty`,
  );
  assert(
    fixture.behaviorRecipes.entities !== null &&
      typeof fixture.behaviorRecipes.entities === "object" &&
      !Array.isArray(fixture.behaviorRecipes.entities) &&
      Object.keys(fixture.behaviorRecipes.entities).length > 0,
    `${template.id} scene authoring fixture behaviorRecipes.entities must not be empty`,
  );
}

async function assertCreateGameCliRejectsInvalidSceneAuthoringFixture() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ferrum2d-create-game-invalid-scene-authoring-"));
  try {
    const copiedPackageRoot = path.join(tempDir, "create-game");
    await cp(packageRoot, copiedPackageRoot, { recursive: true });
    const fixturePath = path.join(copiedPackageRoot, "templates/minimal/public/scene-authoring.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    fixture.format = "invalid.scene-authoring";
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);

    const result = await run(process.execPath, [
      path.join(copiedPackageRoot, "bin/create-game.mjs"),
      "--list-templates",
    ], repoRoot);
    assert(result.code !== 0, "create-game CLI must reject an invalid scene authoring fixture before listing templates");
    assert(
      result.stderr.includes("scene authoring fixture format must be ferrum2d.consumer.scene-authoring"),
      `create-game CLI invalid scene authoring fixture error is not specific enough\n${result.stdout}\n${result.stderr}`.trim(),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function listTemplateDirectoryNames() {
  const entries = await readdir(path.join(packageRoot, "templates"), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
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
    assert(generatedPackage.scripts?.["pack:textures"] === "node scripts/ferrum-assets.mjs pack-textures", "generated game must include pack:textures script");
    assert(generatedPackage.scripts?.["ferrum:validate"] === "node scripts/ferrum-harness.mjs validate", "generated game must include ferrum:validate script");
    assert(generatedPackage.scripts?.["ferrum:smoke"] === "node scripts/ferrum-harness.mjs smoke", "generated game must include ferrum:smoke script");
    assert(generatedPackage.scripts?.["ferrum:report"] === "node scripts/ferrum-harness.mjs report", "generated game must include ferrum:report script");
    assert(generatedPackage.scripts?.["ferrum:asset-report"] === "node scripts/ferrum-assets.mjs report", "generated game must include ferrum:asset-report script");
    assert(generatedPackage.scripts?.["ferrum:asset-validate"] === "node scripts/ferrum-assets.mjs validate", "generated game must include ferrum:asset-validate script");
    assert(generatedPackage.scripts?.["ferrum:authoring-report"] === "node scripts/ferrum-harness.mjs authoring-report", "generated game must include ferrum:authoring-report script");
    assert(generatedPackage.scripts?.["ferrum:replay-report"] === "node scripts/ferrum-harness.mjs replay-report", "generated game must include ferrum:replay-report script");
    assert(generatedPackage.scripts?.["ferrum:update-replay-fixture"] === "node scripts/ferrum-harness.mjs update-replay-fixture", "generated game must include ferrum:update-replay-fixture script");
    assert(generatedPackage.scripts?.["ferrum:runtime-replay-report"] === "node scripts/ferrum-runtime-replay.mjs report", "generated game must include ferrum:runtime-replay-report script");
    assert(generatedPackage.scripts?.["ferrum:runtime-replay-recipe"] === "node scripts/ferrum-runtime-replay.mjs recipe", "generated game must include ferrum:runtime-replay-recipe script");
    assert(generatedPackage.scripts?.["ferrum:update-runtime-replay-fixture"] === "node scripts/ferrum-runtime-replay.mjs update-fixture", "generated game must include ferrum:update-runtime-replay-fixture script");
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
    const generatedAssetPipelinePath = path.join(targetRoot, "scripts/ferrum-assets.mjs");
    await requireFile(generatedAssetPipelinePath, repoRoot);
    await runNodeCheck(generatedAssetPipelinePath, repoRoot);
    await assertAssetPipelineScaffold(generatedAssetPipelinePath, targetRoot, templateName);
    await requireFile(path.join(targetRoot, "public/assets/audio.manifest.json"), repoRoot);
    await requireFile(path.join(targetRoot, "public/assets/localization.manifest.json"), repoRoot);
    await requireFile(path.join(targetRoot, "public/assets/texture-atlas.input.json"), repoRoot);
    await assertAssetPipelineReport(targetRoot, templateName);
    await linkWorkspaceFerrumWeb(targetRoot);
    await assertAssetPipelineValidate(targetRoot, templateName);
    const generatedHarnessPath = path.join(targetRoot, "scripts/ferrum-harness.mjs");
    await requireFile(generatedHarnessPath, repoRoot);
    if (template.sceneAuthoring.configured) {
      const harnessSource = await readFile(generatedHarnessPath, "utf8");
      assert(
        harnessSource.includes("applySceneBehaviorRecipes") &&
          harnessSource.includes("dryRunSceneBehaviorRecipes") &&
          harnessSource.includes("resolveSceneCompositionSpec") &&
          harnessSource.includes("runtimeEntityHandles") &&
          harnessSource.includes("public/scene-authoring.json"),
        `${templateName} template harness must validate SceneComposition behavior authoring through public APIs`,
      );
    }
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
      await assertRuntimeReplayConfiguredReport(targetRoot, templateName);
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
      await assertGameplayReplayConfiguredReport(targetRoot, templateName);
    } else {
      await assertGameplayReplayNotConfiguredReport(targetRoot, templateName);
      await assertGameplayReplayUpdateNotConfiguredReport(targetRoot, templateName);
      assert(
        !await exists(path.join(targetRoot, "public/gameplay-replay.fixture.json")),
        `${templateName} generated game must not include a gameplay replay fixture while replay is not configured`,
      );
      assert(
        !await exists(path.join(targetRoot, "public/gameplay-replay.coverage-tags.json")),
        `${templateName} generated game must not include gameplay replay coverage tags while replay is not configured`,
      );
    }
    if (templateName === "topdown") {
      await requireFile(path.join(targetRoot, "public/game.json"), repoRoot);
      if (template.sceneAuthoring.configured) {
        await requireFile(path.join(targetRoot, template.sceneAuthoring.fixturePath), repoRoot);
      }
      assert(mainSource.includes("resolveShooterGameSpec"), "topdown template runtime must validate public/game.json");
      assert(mainSource.includes("./game.json"), "topdown template runtime must load public/game.json");
    } else if (template.sceneAuthoring.configured) {
      await requireFile(path.join(targetRoot, template.sceneAuthoring.fixturePath), repoRoot);
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

async function assertAssetPipelineScaffold(filePath, projectRoot, templateName) {
  const source = await readFile(filePath, "utf8");
  assert(
    source.includes('await import("@ferrum2d/ferrum-web")'),
    `${templateName} asset pipeline scaffold must use the public @ferrum2d/ferrum-web entrypoint`,
  );
  assert(
      source.includes("packTextureAtlas") &&
      source.includes("textureAtlasDocumentToShooterAtlas") &&
      source.includes("resolveShooterGameSpec") &&
      source.includes("AudioAssetLoader") &&
      source.includes("LocalizationBundle") &&
      source.includes("ferrum2d.consumer.asset-pipeline.report") &&
      source.includes("ferrum2d.consumer.texture-atlas-input") &&
      source.includes("ferrum2d.consumer.audio-manifest") &&
      source.includes("ferrum2d.consumer.localization-manifest"),
    `${templateName} asset pipeline scaffold must expose public texture atlas import, Game Spec merge, and report contracts`,
  );
  assert(!source.includes("@ferrum2d/ferrum-web/dist/"), `${templateName} asset pipeline scaffold must not import dist internals`);
  assert(!source.includes("@ferrum2d/ferrum-web/pkg/"), `${templateName} asset pipeline scaffold must not import wasm package internals`);
  assert(!source.includes("@ferrum2d/ferrum-web/src/"), `${templateName} asset pipeline scaffold must not import source internals`);
  const input = await readJson(path.join(projectRoot, "public/assets/texture-atlas.input.json"));
  const audioManifest = await readJson(path.join(projectRoot, "public/assets/audio.manifest.json"));
  const localizationManifest = await readJson(path.join(projectRoot, "public/assets/localization.manifest.json"));
  assert(input.format === "ferrum2d.consumer.texture-atlas-input", `${templateName} asset pipeline input format is invalid`);
  assert(input.version === 1, `${templateName} asset pipeline input version must be 1`);
  assert(input.outputJson === "public/assets/atlas.json", `${templateName} asset pipeline outputJson is invalid`);
  assert(input.gameSpec === "public/game.json", `${templateName} asset pipeline gameSpec path is invalid`);
  assert(input.mergeGameSpec === true, `${templateName} asset pipeline mergeGameSpec must default to true`);
  assert(Array.isArray(input.sprites), `${templateName} asset pipeline sprites must be an array`);
  assert(audioManifest.format === "ferrum2d.consumer.audio-manifest", `${templateName} audio manifest format is invalid`);
  assert(audioManifest.version === 1, `${templateName} audio manifest version must be 1`);
  assert(audioManifest.sounds !== null && typeof audioManifest.sounds === "object" && !Array.isArray(audioManifest.sounds), `${templateName} audio manifest sounds must be an object`);
  assert(localizationManifest.format === "ferrum2d.consumer.localization-manifest", `${templateName} localization manifest format is invalid`);
  assert(localizationManifest.version === 1, `${templateName} localization manifest version must be 1`);
  assert(localizationManifest.gameSpec === "public/game.json", `${templateName} localization manifest gameSpec path is invalid`);
  assert(localizationManifest.source === "gameSpec.content.localization", `${templateName} localization manifest source is invalid`);
  assert(localizationManifest.documents !== null && typeof localizationManifest.documents === "object" && !Array.isArray(localizationManifest.documents), `${templateName} localization manifest documents must be an object`);
}

async function assertAssetPipelineReport(projectRoot, templateName) {
  const result = await run(process.execPath, ["scripts/ferrum-assets.mjs", "report"], projectRoot);
  assert(
    result.code === 0,
    `${templateName} asset pipeline report command must pass\n${result.stdout}\n${result.stderr}`.trim(),
  );
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[package check] ${templateName} asset pipeline report must emit JSON: ${message}`);
  }
  assert(report.format === "ferrum2d.consumer.asset-pipeline.report", `${templateName} asset pipeline report format is invalid`);
  assert(report.version === 1, `${templateName} asset pipeline report version must be 1`);
  assert(report.ok === true, `${templateName} asset pipeline report must be ok`);
  assert(report.assetPipeline?.textureAtlas?.configured === true, `${templateName} asset pipeline texture atlas must be configured`);
  assert(report.assetPipeline?.textureAtlas?.status === "scaffold", `${templateName} asset pipeline texture atlas status must be scaffold`);
  assert(report.assetPipeline?.textureAtlas?.input === "public/assets/texture-atlas.input.json", `${templateName} asset pipeline input path is invalid`);
  assert(report.assetPipeline?.textureAtlas?.outputJson === "public/assets/atlas.json", `${templateName} asset pipeline output path is invalid`);
  assert(report.assetPipeline?.textureAtlas?.spriteCount === 0, `${templateName} asset pipeline default sprite count must be 0`);
  assert(report.assetPipeline?.audio?.configured === true, `${templateName} asset pipeline audio manifest must be configured`);
  assert(report.assetPipeline?.audio?.status === "scaffold", `${templateName} asset pipeline audio status must be scaffold`);
  assert(report.assetPipeline?.audio?.soundCount === 0, `${templateName} asset pipeline default sound count must be 0`);
  assert(report.assetPipeline?.localization?.configured === true, `${templateName} asset pipeline localization manifest must be configured`);
  assert(report.assetPipeline?.localization?.input === "public/assets/localization.manifest.json", `${templateName} asset pipeline localization input is invalid`);
  assert(report.assetPipeline?.localization?.documentCount === 0, `${templateName} asset pipeline default localization document count must be 0`);
  assert(report.assetPipeline?.gameSpec?.path === "public/game.json", `${templateName} asset pipeline Game Spec path is invalid`);
  const expectedGameSpecPresent = templateName === "topdown";
  assert(
    report.assetPipeline?.gameSpec?.present === expectedGameSpecPresent,
    `${templateName} asset pipeline Game Spec presence must match template surface`,
  );
}

async function assertAssetPipelineValidate(projectRoot, templateName) {
  const result = await run(process.execPath, ["scripts/ferrum-assets.mjs", "validate"], projectRoot);
  assert(
    result.code === 0,
    `${templateName} asset pipeline validate command must pass\n${result.stdout}\n${result.stderr}`.trim(),
  );
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[package check] ${templateName} asset pipeline validate must emit JSON: ${message}`);
  }
  assert(report.format === "ferrum2d.consumer.asset-pipeline.report", `${templateName} asset pipeline validate format is invalid`);
  assert(report.assetPipeline?.validation?.validated === true, `${templateName} asset pipeline validate must mark validated=true`);
  assert(report.assetPipeline?.validation?.publicEntryPoint === "@ferrum2d/ferrum-web", `${templateName} asset pipeline validate must use the public package entrypoint`);
  const expectedLocalizationStatus = templateName === "topdown" && report.assetPipeline?.gameSpec?.localizationConfigured
    ? "configured"
    : "scaffold";
  assert(
    report.assetPipeline?.localization?.status === expectedLocalizationStatus,
    `${templateName} asset pipeline localization validate status must be ${expectedLocalizationStatus}`,
  );
}

async function linkWorkspaceFerrumWeb(projectRoot) {
  await buildFerrumWebPublicEntrypoint();
  const packageScope = path.join(projectRoot, "node_modules/@ferrum2d");
  const linkPath = path.join(packageScope, "ferrum-web");
  await mkdir(packageScope, { recursive: true });
  try {
    await symlink(path.join(repoRoot, "packages/ferrum-web"), linkPath, "dir");
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }
}

async function buildFerrumWebPublicEntrypoint() {
  if (ferrumWebPublicEntrypointBuilt) return;
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const wasmResult = await run(pnpm, ["build:wasm"], repoRoot);
  assert(
    wasmResult.code === 0,
    `create-game package check must build @ferrum2d/ferrum-web Wasm artifacts before runtime replay validation\n${wasmResult.stdout}\n${wasmResult.stderr}`.trim(),
  );
  const result = await run(pnpm, ["--filter", "@ferrum2d/ferrum-web", "build"], repoRoot);
  assert(
    result.code === 0,
    `create-game package check must build @ferrum2d/ferrum-web before symlinked public-entrypoint validation\n${result.stdout}\n${result.stderr}`.trim(),
  );
  await requireFile(path.join(repoRoot, "packages/ferrum-web/pkg/ferrum_core.js"), repoRoot);
  await requireFile(path.join(repoRoot, "packages/ferrum-web/pkg/ferrum_core_bg.wasm"), repoRoot);
  await requireFile(path.join(repoRoot, "packages/ferrum-web/dist/index.js"), repoRoot);
  await requireFile(path.join(repoRoot, "packages/ferrum-web/dist/index.d.ts"), repoRoot);
  ferrumWebPublicEntrypointBuilt = true;
}

async function assertGameplayReplayConfiguredReport(projectRoot, templateName) {
  const result = await run(process.execPath, ["scripts/ferrum-harness.mjs", "replay-report"], projectRoot);
  assert(
    result.code === 0,
    `${templateName} configured gameplay replay report must pass\n${result.stdout}\n${result.stderr}`.trim(),
  );
  const report = parseJsonReport(result.stdout, `${templateName} gameplay replay report`);
  assert(report.format === "ferrum2d.consumer.gameplay-replay.report", `${templateName} gameplay replay report format is invalid`);
  assert(report.version === 1, `${templateName} gameplay replay report version must be 1`);
  assert(report.ok === true, `${templateName} gameplay replay report must be ok`);
  assert(report.gameplayReplay?.status === "validated", `${templateName} gameplay replay status must be validated`);
  assert(report.gameplayReplay?.comparison?.passed === true, `${templateName} gameplay replay comparison must pass`);
  assertMachineActionableReports(report.gameplayReplay?.reports, `${templateName} gameplay replay reports`);
  assert(report.gameplayReplay.reports.length === 0, `${templateName} configured gameplay replay report must not include diagnostics`);
}

async function assertRuntimeReplayConfiguredReport(projectRoot, templateName) {
  const result = await run(process.execPath, ["scripts/ferrum-runtime-replay.mjs", "report"], projectRoot);
  assert(
    result.code === 0,
    `${templateName} configured runtime replay report must pass\n${result.stdout}\n${result.stderr}`.trim(),
  );
  const report = parseJsonReport(result.stdout, `${templateName} runtime replay report`);
  assert(report.format === "ferrum2d.consumer.runtime-gameplay-replay.report", `${templateName} runtime replay report format is invalid`);
  assert(report.version === 1, `${templateName} runtime replay report version must be 1`);
  assert(report.ok === true, `${templateName} runtime replay report must be ok`);
  assert(report.runtimeGameplayReplay?.status === "validated", `${templateName} runtime replay status must be validated`);
  assert(report.runtimeGameplayReplay?.comparison?.passed === true, `${templateName} runtime replay comparison must pass`);
  assertMachineActionableReports(report.runtimeGameplayReplay?.reports, `${templateName} runtime replay reports`);
  assert(report.runtimeGameplayReplay.reports.length === 0, `${templateName} configured runtime replay report must not include diagnostics`);
}

function parseJsonReport(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[package check] ${label} must emit JSON: ${message}`);
  }
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

async function assertGameplayReplayUpdateNotConfiguredReport(projectRoot, templateName) {
  const result = await run(process.execPath, ["scripts/ferrum-harness.mjs", "update-replay-fixture"], projectRoot);
  assert(
    result.code !== 0,
    `${templateName} gameplay replay fixture update must fail while scaffold is not configured`,
  );
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[package check] ${templateName} gameplay replay update must emit JSON: ${message}`);
  }
  assert(report.format === "ferrum2d.consumer.gameplay-replay.report", `${templateName} gameplay replay update report format is invalid`);
  assert(report.version === 1, `${templateName} gameplay replay update report version must be 1`);
  assert(report.ok === false, `${templateName} gameplay replay update report must be ok=false while scaffold is not configured`);
  assertNonEmptyString(report.gameplayReplay?.packageName, `${templateName} gameplay replay update packageName`);
  assert(report.gameplayReplay?.configured === false, `${templateName} gameplay replay update report must keep configured=false`);
  assert(report.gameplayReplay?.status === "not-configured", `${templateName} gameplay replay update status must be not-configured`);
  assert(report.gameplayReplay?.fixture === "public/gameplay-replay.fixture.json", `${templateName} gameplay replay update fixture path is invalid`);
  assert(report.gameplayReplay?.updateAttempted === true, `${templateName} gameplay replay update report must mark updateAttempted=true`);
  assertMachineActionableReports(report.gameplayReplay?.reports, `${templateName} gameplay replay update reports`);
  assert(
    report.gameplayReplay?.reports?.[0]?.code === "FERRUM_CONSUMER_REPLAY_NOT_CONFIGURED",
    `${templateName} gameplay replay update not-configured code is invalid`,
  );
}

async function assertGameplayReplayNotConfiguredReport(projectRoot, templateName) {
  const result = await run(process.execPath, ["scripts/ferrum-harness.mjs", "replay-report"], projectRoot);
  assert(
    result.code === 0,
    `${templateName} gameplay replay report must pass while scaffold is not configured\n${result.stdout}\n${result.stderr}`.trim(),
  );
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[package check] ${templateName} gameplay replay report must emit JSON: ${message}`);
  }
  assert(report.format === "ferrum2d.consumer.gameplay-replay.report", `${templateName} gameplay replay report format is invalid`);
  assert(report.version === 1, `${templateName} gameplay replay report version must be 1`);
  assert(report.ok === true, `${templateName} gameplay replay report must be ok while scaffold is not configured`);
  assertNonEmptyString(report.gameplayReplay?.packageName, `${templateName} gameplay replay packageName`);
  assert(report.gameplayReplay?.configured === false, `${templateName} gameplay replay report must default configured=false`);
  assert(report.gameplayReplay?.status === "not-configured", `${templateName} gameplay replay status must be not-configured`);
  assert(report.gameplayReplay?.fixture === "public/gameplay-replay.fixture.json", `${templateName} gameplay replay fixture path is invalid`);
  assert(
    report.gameplayReplay?.reason === "This template does not include a deterministic gameplay replay manifest.",
    `${templateName} gameplay replay reason is invalid`,
  );
  assertMachineActionableReports(report.gameplayReplay?.reports, `${templateName} gameplay replay reports`);
  assert(
    report.gameplayReplay?.reports?.[0]?.code === "FERRUM_CONSUMER_REPLAY_NOT_CONFIGURED",
    `${templateName} gameplay replay not-configured code is invalid`,
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
