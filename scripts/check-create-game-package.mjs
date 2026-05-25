#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
const requiredPackageFiles = [
  "LICENSE",
  "README.md",
  "bin/create-game.mjs",
  "templates/minimal/index.html",
  "templates/minimal/package.json",
  "templates/minimal/scripts/ferrum-harness.mjs",
  "templates/minimal/src/main.ts",
  "templates/minimal/src/styles.css",
];
const requiredPackedFiles = [
  "package/package.json",
  "package/LICENSE",
  "package/README.md",
  "package/bin/create-game.mjs",
  "package/templates/minimal/index.html",
  "package/templates/minimal/package.json",
  "package/templates/minimal/scripts/ferrum-harness.mjs",
  "package/templates/minimal/src/main.ts",
  "package/templates/minimal/src/styles.css",
];

assert(packageJson.name === packageLabel, "create-game package name must stay @ferrum2d/create-game");
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
await checkGeneratedProject();
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

async function checkGeneratedProject() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ferrum2d-create-game-check-"));
  try {
    const targetRoot = path.join(tempDir, "sample-game");
    const cliPath = path.join(packageRoot, "bin/create-game.mjs");
    const result = await run(process.execPath, [cliPath, targetRoot, "--ferrum-version", "0.0.0-test"], repoRoot);
    assert(
      result.code === 0,
      `create-game CLI failed with exit code ${result.code}\n${result.stdout}\n${result.stderr}`.trim(),
    );

    const generatedPackage = await readJson(path.join(targetRoot, "package.json"));
    assert(generatedPackage.name === "sample-game", "generated package name must be derived from target directory");
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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
