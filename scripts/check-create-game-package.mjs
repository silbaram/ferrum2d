#!/usr/bin/env node
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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
  "src/main.ts",
  "src/styles.css",
];
const templateCatalog = await readJson(path.join(packageRoot, "templates/manifest.json"));
const templateNames = validateTemplateCatalog(templateCatalog);
const templateDirectoryNames = await listTemplateDirectoryNames();
const requiredPackageFiles = [
  "LICENSE",
  "README.md",
  "bin/create-game.mjs",
  "templates/manifest.json",
  ...templateNames.flatMap((templateName) => (
    requiredTemplateFilesForTemplate(templateName).map((file) => `templates/${templateName}/${file}`)
  )),
];
const requiredPackedFiles = [
  "package/package.json",
  "package/LICENSE",
  "package/README.md",
  "package/bin/create-game.mjs",
  "package/templates/manifest.json",
  ...templateNames.flatMap((templateName) => (
    requiredTemplateFilesForTemplate(templateName).map((file) => `package/templates/${templateName}/${file}`)
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
await runNodeCheck(path.join(packageRoot, "bin/create-game.mjs"), repoRoot);
for (const templateName of templateNames) {
  await checkGeneratedProject(templateName);
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
  const templateIds = [];
  for (const template of catalog.templates) {
    assert(typeof template.id === "string" && /^[a-z0-9-]+$/.test(template.id), "create-game template ids must use lowercase letters, numbers, and hyphens");
    assert(!ids.has(template.id), `create-game template manifest must not duplicate id ${template.id}`);
    ids.add(template.id);
    templateIds.push(template.id);
  }
  assert(ids.has(catalog.defaultTemplate), "create-game template manifest defaultTemplate must reference a listed template id");
  return templateIds.sort();
}

function requiredTemplateFilesForTemplate(templateName) {
  if (templateName === "topdown") {
    return [...commonRequiredTemplateFiles, "public/game.json"];
  }
  return commonRequiredTemplateFiles;
}

async function listTemplateDirectoryNames() {
  const entries = await readdir(path.join(packageRoot, "templates"), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function checkGeneratedProject(templateName) {
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
    assert(generatedPackage.devDependencies?.vite !== undefined, "generated game must include vite devDependency");

    const mainSource = await readFile(path.join(targetRoot, "src/main.ts"), "utf8");
    assert(mainSource.includes('from "@ferrum2d/ferrum-web"'), "generated game must import from package public entrypoint");
    assert(!mainSource.includes("@ferrum2d/ferrum-web/dist/"), "generated game must not import dist internals");
    assert(!mainSource.includes("@ferrum2d/ferrum-web/pkg/"), "generated game must not import wasm package internals");
    assert(!mainSource.includes("@ferrum2d/ferrum-web/src/"), "generated game must not import source internals");

    await requireFile(path.join(targetRoot, "index.html"), repoRoot);
    await requireFile(path.join(targetRoot, "scripts/ferrum-harness.mjs"), repoRoot);
    await requireFile(path.join(targetRoot, "src/styles.css"), repoRoot);
    if (templateName === "topdown") {
      await requireFile(path.join(targetRoot, "public/game.json"), repoRoot);
      assert(mainSource.includes("resolveShooterGameSpec"), "topdown template runtime must validate public/game.json");
      assert(mainSource.includes("./game.json"), "topdown template runtime must load public/game.json");
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
