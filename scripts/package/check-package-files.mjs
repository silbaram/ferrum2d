#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageRoot = path.join(repoRoot, "packages/ferrum-web");
const packageJsonPath = path.join(packageRoot, "package.json");
const requireWasmPkg = process.argv.includes("--require-wasm-pkg");
const verifyPack = process.argv.includes("--verify-pack");
const expectPublishable = process.argv.includes("--expect-publishable");
const gunzipAsync = promisify(gunzip);

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const warnings = [];
const requiredWasmArtifacts = [
  "pkg/ferrum_core.js",
  "pkg/ferrum_core.d.ts",
  "pkg/ferrum_core_bg.wasm",
  "pkg/ferrum_core_bg.wasm.d.ts",
  "pkg/package.json",
];
const publicEntrypoints = [
  [".", "index"],
  ["./core", "core"],
  ["./authoring", "authoring"],
  ["./starter-scenes", "starter-scenes"],
  ["./labs", "labs"],
  ["./quality", "quality"],
];
const requiredPackedFiles = [
  "package/package.json",
  "package/LICENSE",
  "package/README.md",
  ...publicEntrypoints.flatMap(([, distName]) => [
    `package/dist/${distName}.js`,
    `package/dist/${distName}.d.ts`,
  ]),
  ...requiredWasmArtifacts.map((artifact) => `package/${artifact}`),
];
const forbiddenPackedPrefixes = [
  "package/src/",
  "package/test/",
  "package/dist-test/",
  "package/node_modules/",
];
const forbiddenPackedFiles = [
  "package/tsconfig.json",
  "package/tsconfig.test.json",
  "package/pkg/.gitignore",
];

const stableVersionPattern = /^\d+\.\d+\.\d+$/;
const betaVersionPattern = /^\d+\.\d+\.\d+-beta\.\d+$/;

assert(packageJson.name === "@ferrum2d/ferrum-web", "package name must stay @ferrum2d/ferrum-web");
assert(
  stableVersionPattern.test(packageJson.version) || betaVersionPattern.test(packageJson.version),
  "package version must use semver or semver beta prerelease format",
);
if (expectPublishable) {
  assert(packageJson.private === false, "publishable beta package must set private to false");
  assert(betaVersionPattern.test(packageJson.version), "publishable beta package version must match x.y.z-beta.N");
} else {
  assert(packageJson.private === true, "package must remain private until an explicit publish decision is made");
}
assert(packageJson.type === "module", "package type must be module");
assert(packageJson.license === "MIT OR Apache-2.0", "package license must stay MIT OR Apache-2.0");
assert(packageJson.main === "./dist/index.js", "main must point to ./dist/index.js");
assert(packageJson.types === "./dist/index.d.ts", "types must point to ./dist/index.d.ts");
for (const [exportPath, distName] of publicEntrypoints) {
  assertPackageExport(exportPath, distName);
}
assert(packageJson.publishConfig?.access === "public", "publishConfig.access must be public for scoped beta releases");
assert(packageJson.publishConfig?.tag === "beta", "publishConfig.tag must be beta so prereleases do not land on latest");
assert(Array.isArray(packageJson.files), "package files must be an array");
assert(packageJson.files.includes("LICENSE"), "package files must include LICENSE");
assert(packageJson.files.includes("README.md"), "package files must include README.md");
assert(packageJson.files.includes("dist"), "package files must include dist");
for (const artifact of requiredWasmArtifacts) {
  assert(packageJson.files.includes(artifact), `package files must include generated wasm artifact ${artifact}`);
}

await requireFile("README.md");
await requireFile("LICENSE");
for (const [, distName] of publicEntrypoints) {
  await requireFile(`src/${distName}.ts`);
  await requireFile(`dist/${distName}.js`);
  await requireFile(`dist/${distName}.d.ts`);
}
await requireFile("dist/collisionEventDecoder.js");
await requireFile("dist/collisionEventDecoder.d.ts");
await checkDistModuleSpecifiers();
await checkSubpathDeclarationTypeSurfaces();
await checkWasmPkgArtifacts();
if (verifyPack) {
  await checkPackedTarball();
}

console.log("packages/ferrum-web package file check ok");
if (warnings.length > 0) {
  console.log(JSON.stringify({ warnings }, null, 2));
}

function assertPackageExport(exportPath, distName) {
  assert(
    packageJson.exports?.[exportPath]?.import === `./dist/${distName}.js`,
    `exports['${exportPath}'].import must point to ./dist/${distName}.js`,
  );
  assert(
    packageJson.exports?.[exportPath]?.types === `./dist/${distName}.d.ts`,
    `exports['${exportPath}'].types must point to ./dist/${distName}.d.ts`,
  );
}

async function requireFile(relativePath) {
  try {
    await access(path.join(packageRoot, relativePath));
  } catch {
    throw new Error(`[package check] required file is missing: packages/ferrum-web/${relativePath}`);
  }
}

async function checkWasmPkgArtifacts() {
  const missing = [];
  for (const artifact of requiredWasmArtifacts) {
    try {
      await access(path.join(packageRoot, artifact));
    } catch {
      missing.push(`packages/ferrum-web/${artifact}`);
    }
  }

  if (missing.length === 0) {
    await checkWasmExportDeclarations();
    return;
  }

  if (requireWasmPkg) {
    throw new Error(`[package check] generated wasm package artifacts are missing: ${missing.join(", ")}`);
  }

  warnings.push({
    kind: "wasm-pkg",
    detail: "Generated wasm artifacts are not present. Run pnpm build:wasm before release packaging.",
    missing,
  });
}

async function checkWasmExportDeclarations() {
  const wasmPath = path.join(packageRoot, "pkg/ferrum_core_bg.wasm");
  const wasmTypesPath = path.join(packageRoot, "pkg/ferrum_core_bg.wasm.d.ts");
  const wasmTypes = await readFile(wasmTypesPath, "utf8");
  const declaredExports = [...wasmTypes.matchAll(/^export const ([A-Za-z0-9_$]+):/gm)]
    .map((match) => match[1])
    .sort();
  const wasmModule = new WebAssembly.Module(await readFile(wasmPath));
  const actualExports = new Set(WebAssembly.Module.exports(wasmModule).map((entry) => entry.name));
  const missingExports = declaredExports.filter((name) => !actualExports.has(name));

  assert(
    missingExports.length === 0,
    `[package check] wasm artifact is stale; missing exports from packages/ferrum-web/pkg/ferrum_core_bg.wasm: ${missingExports.join(", ")}`,
  );
}

async function checkDistModuleSpecifiers() {
  const files = await collectDistFiles(path.join(packageRoot, "dist"));
  const modulePattern = /\b(?:from\s+|import\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
  for (const filePath of files) {
    const source = await readFile(filePath, "utf8");
    for (const match of source.matchAll(modulePattern)) {
      const specifier = match[1];
      if (!hasExplicitExtension(specifier)) {
        throw new Error(
          `[package check] dist module specifier must include a file extension: ${path.relative(repoRoot, filePath)} imports ${specifier}`,
        );
      }
    }
  }
}

async function checkSubpathDeclarationTypeSurfaces() {
  for (const [exportPath, distName] of publicEntrypoints) {
    if (exportPath === ".") continue;
    const source = await readFile(path.join(packageRoot, "dist", `${distName}.d.ts`), "utf8");
    assert(
      !source.includes("export type *"),
      `[package check] ${exportPath} declaration must use explicit type exports instead of export type *`,
    );
    assert(
      !source.includes("export *"),
      `[package check] ${exportPath} declaration must use explicit exports instead of export *`,
    );
  }
}

async function collectDistFiles(directory) {
  const entries = await readdir(directory);
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry);
    const entryStat = await stat(entryPath);
    if (entryStat.isDirectory()) {
      files.push(...await collectDistFiles(entryPath));
      continue;
    }
    if (entryPath.endsWith(".js") || entryPath.endsWith(".d.ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

function hasExplicitExtension(specifier) {
  return path.extname(path.basename(specifier)).length > 0;
}

async function checkPackedTarball() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ferrum2d-pack-"));
  try {
    await runPnpmPack(tempDir);
    const entries = await readdir(tempDir);
    const tarballs = entries.filter((entry) => entry.endsWith(".tgz"));
    assert(tarballs.length === 1, `expected exactly one packed tarball, found ${tarballs.length}`);

    const tarballPath = path.join(tempDir, tarballs[0]);
    const packedFiles = new Set(await listTarGzEntries(tarballPath));
    for (const requiredFile of requiredPackedFiles) {
      assert(packedFiles.has(requiredFile), `packed tarball is missing ${requiredFile}`);
    }
    for (const packedFile of packedFiles) {
      for (const forbiddenPrefix of forbiddenPackedPrefixes) {
        assert(!packedFile.startsWith(forbiddenPrefix), `packed tarball must not include ${packedFile}`);
      }
      assert(!forbiddenPackedFiles.includes(packedFile), `packed tarball must not include ${packedFile}`);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runPnpmPack(destination) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = await run(command, ["pack", "--pack-destination", destination], packageRoot);
  if (result.code !== 0) {
    throw new Error(
      `[package check] pnpm pack failed with exit code ${result.code}\n${result.stdout}\n${result.stderr}`.trim(),
    );
  }
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
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
      resolve({ code, stdout, stderr });
    });
  });
}

async function listTarGzEntries(tarballPath) {
  const archive = await gunzipAsync(await readFile(tarballPath));
  const entries = [];
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (isEmptyTarBlock(header)) {
      break;
    }

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const sizeText = readTarString(header, 124, 12).trim();
    const size = sizeText.length > 0 ? Number.parseInt(sizeText, 8) : 0;
    const entryPath = prefix ? `${prefix}/${name}` : name;
    if (entryPath) {
      entries.push(entryPath);
    }

    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function isEmptyTarBlock(block) {
  return block.every((byte) => byte === 0);
}

function readTarString(block, start, length) {
  const bytes = block.subarray(start, start + length);
  const end = bytes.indexOf(0);
  const content = end === -1 ? bytes : bytes.subarray(0, end);
  return new TextDecoder().decode(content);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[package check] ${message}`);
  }
}
