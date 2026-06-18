#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assert,
  assertFilesAllowlist,
  assertSemverPackage,
  checkPackedTarball,
  readJson,
  requireFile,
} from "./package-check-helpers.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageRoot = path.join(repoRoot, "packages/ferrum-authoring-viewer");
const packageJson = await readJson(path.join(packageRoot, "package.json"));
const expectPublishable = process.argv.includes("--expect-publishable");
const verifyPack = process.argv.includes("--verify-pack");
const packageLabel = "@ferrum2d/authoring-viewer";
const expectedFiles = ["LICENSE", "README.md", "dist"];
const requiredPackageFiles = [
  "LICENSE",
  "README.md",
  "package.json",
  "dist/index.js",
  "dist/index.d.ts",
];
const requiredPackedFiles = [
  "package/LICENSE",
  "package/README.md",
  "package/package.json",
  "package/dist/index.js",
  "package/dist/index.d.ts",
];

assert(packageJson.name === packageLabel, "authoring-viewer package name must stay @ferrum2d/authoring-viewer");
assertSemverPackage(packageJson, { expectPublishable, packageLabel });
assert(packageJson.type === "module", "authoring-viewer package type must be module");
assert(packageJson.license === "MIT OR Apache-2.0", "authoring-viewer license must stay MIT OR Apache-2.0");
assert(packageJson.publishConfig?.access === "public", "authoring-viewer publishConfig.access must be public");
assert(packageJson.publishConfig?.tag === "beta", "authoring-viewer publishConfig.tag must be beta");
assert(packageJson.main === "./dist/index.js", "authoring-viewer main must point to dist/index.js");
assert(packageJson.types === "./dist/index.d.ts", "authoring-viewer types must point to dist/index.d.ts");
assert(packageJson.exports?.["."]?.import === "./dist/index.js", "authoring-viewer export import must point to dist/index.js");
assert(packageJson.exports?.["."]?.types === "./dist/index.d.ts", "authoring-viewer export types must point to dist/index.d.ts");
assert(Object.keys(packageJson.dependencies ?? {}).length === 0, "authoring-viewer must not add runtime dependencies");
assert(Object.keys(packageJson.peerDependencies ?? {}).length === 0, "authoring-viewer must not add peer dependencies");
assert(packageJson.bin === undefined, "authoring-viewer must not expose CLI bins");
assertFilesAllowlist(packageJson, expectedFiles, packageLabel);

for (const file of requiredPackageFiles) {
  await requireFile(path.join(packageRoot, file), repoRoot);
}

if (verifyPack) {
  await checkPackedTarball({
    packageRoot,
    requiredFiles: requiredPackedFiles,
    forbiddenPrefixes: [
      "package/src/",
      "package/node_modules/",
    ],
    forbiddenFiles: [
      "package/tsconfig.json",
    ],
  });
}

console.log("authoring-viewer package check ok");
