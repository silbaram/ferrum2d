#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(repoRoot, "packages/ferrum-web");
const packageJsonPath = path.join(packageRoot, "package.json");
const requireWasmPkg = process.argv.includes("--require-wasm-pkg");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const warnings = [];

assert(packageJson.name === "@ferrum2d/ferrum-web", "package name must stay @ferrum2d/ferrum-web");
assert(packageJson.private === true, "package must remain private until an explicit publish decision is made");
assert(packageJson.type === "module", "package type must be module");
assert(packageJson.main === "./dist/index.js", "main must point to ./dist/index.js");
assert(packageJson.types === "./dist/index.d.ts", "types must point to ./dist/index.d.ts");
assert(packageJson.exports?.["."]?.import === "./dist/index.js", "exports['.'].import must point to ./dist/index.js");
assert(packageJson.exports?.["."]?.types === "./dist/index.d.ts", "exports['.'].types must point to ./dist/index.d.ts");
assert(Array.isArray(packageJson.files), "package files must be an array");
assert(packageJson.files.includes("dist"), "package files must include dist");
assert(packageJson.files.includes("pkg"), "package files must include generated wasm pkg");

await requireFile("src/index.ts");
await requireFile("dist/index.js");
await requireFile("dist/index.d.ts");
await checkWasmPkgArtifacts();

console.log("packages/ferrum-web package file check ok");
if (warnings.length > 0) {
  console.log(JSON.stringify({ warnings }, null, 2));
}

async function requireFile(relativePath) {
  try {
    await access(path.join(packageRoot, relativePath));
  } catch {
    throw new Error(`[package check] required file is missing: packages/ferrum-web/${relativePath}`);
  }
}

async function checkWasmPkgArtifacts() {
  const artifacts = ["pkg/ferrum_core.js", "pkg/ferrum_core.d.ts", "pkg/ferrum_core_bg.wasm"];
  const missing = [];
  for (const artifact of artifacts) {
    try {
      await access(path.join(packageRoot, artifact));
    } catch {
      missing.push(`packages/ferrum-web/${artifact}`);
    }
  }

  if (missing.length === 0) {
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[package check] ${message}`);
  }
}
