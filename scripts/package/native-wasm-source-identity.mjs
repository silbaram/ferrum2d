#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const fixedInputs = [
  "build.rs", "Cargo.toml", "Cargo.lock",
  "vendor/rapier3d/Cargo.toml", "vendor/rapier3d/FERRUM-PATCHES.md", "vendor/rapier3d/UPSTREAM.json",
  "vendor/parry3d/Cargo.toml", "vendor/parry3d/FERRUM-PATCHES.md", "vendor/parry3d/UPSTREAM.json",
  "vendor/libm/Cargo.toml", "vendor/libm/build.rs", "vendor/libm/configure.rs",
  "vendor/libm/FERRUM-PATCHES.md", "vendor/libm/UPSTREAM.json",
];
const sourceDirectories = ["src", "vendor/rapier3d/src", "vendor/parry3d/src", "vendor/libm/src"];
const targetMetadata = ["wasm32-unknown-unknown", "32", "little"];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
// Mirrors build.rs: upstream production modules whose names look like tests.
export const PRODUCTION_SOURCES_NAMED_LIKE_TESTS = Object.freeze([
  "vendor/rapier3d/src/dynamics/soft_body/soft_body_crossing_tests.rs",
]);
/** Host-independent key with `/` separators, as build.rs hashes it. */
export const portableSourcePath = name => name.split(path.sep).join("/");
/** `tests.rs`, `*_tests.rs` and their submodules are cfg(test) only. */
export function isTestOnlySource(relative) {
  return !PRODUCTION_SOURCES_NAMED_LIKE_TESTS.includes(relative) && relative.split("/").some(part => {
    const stem = part.endsWith(".rs") ? part.slice(0, -3) : part;
    return stem === "tests" || stem.endsWith("_tests");
  });
}

// Rust PathBuf::Ord compares components. Sorting whole path strings instead
// would put engine.rs before engine/audio.rs and disagree with build.rs.
function compareRustPaths(a, b) {
  const left = a.split(path.sep), right = b.split(path.sep);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const order = Buffer.compare(Buffer.from(left[i]), Buffer.from(right[i]));
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

/** Mirror the existing Core build.rs compatibility fingerprint without building.
 * A match is source/target metadata, not authentication or a compiler/flag proof. */
export async function computeNativeWasmSourceIdentity(root) {
  const core = path.join(root, "crates/ferrum-core"), files = [...fixedInputs].map(p => path.normalize(p));
  async function collect(relative) {
    for (const entry of await readdir(path.join(core, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await collect(name);
      else if (entry.isFile() && path.extname(name) === ".rs" && !isTestOnlySource(portableSourcePath(name))) {
        files.push(name);
      }
    }
  }
  for (const directory of sourceDirectories) await collect(path.normalize(directory));
  files.sort(compareRustPaths);
  const inputs = await Promise.all(files.map(async name => [name, await readFile(path.join(core, name))]));
  let value = 0xcbf29ce484222325n;
  const digest = createHash("sha256");
  const update = bytes => {
    for (const byte of bytes) value = BigInt.asUintN(64, (value ^ BigInt(byte)) * 0x100000001b3n);
  };
  for (const [name, bytes] of inputs) {
    const key = Buffer.from(portableSourcePath(name)), lengths = Buffer.alloc(8);
    lengths.writeUInt32LE(key.length, 0); lengths.writeUInt32LE(bytes.length, 4);
    digest.update(lengths); digest.update(key); digest.update(bytes);
    update(key); update([0]); update(bytes); update([0]);
  }
  for (const field of targetMetadata) { update(Buffer.from(field)); update([0]); }
  return {
    fingerprint: value.toString(16).padStart(16, "0"),
    sourceInputsSha256: digest.digest("hex"), sourceFiles: inputs.length,
    target: { triple: targetMetadata[0], pointerBits: 32, endian: targetMetadata[2] },
  };
}

/** Read only the stable framing header produced by this actual Wasm instance. */
export function readNativeFileBuildIdentity(bytes) {
  assert(bytes instanceof Uint8Array && bytes.byteLength >= 64, "Native build identity requires a complete file header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(Buffer.from(bytes.subarray(0, 8)).toString("hex"), "46324446494c4500", "Unknown Native file magic");
  assert.equal(view.getUint32(8, true), 1, "Review Native source identity check for the new file version");
  assert.equal(view.getUint32(12, true), 64, "Unknown Native file header size");
  assert.equal(view.getUint32(20, true), 7, "Unknown Native file section count");
  assert.equal(view.getBigUint64(24, true), BigInt(bytes.byteLength), "Incomplete Native file capture");
  assert.equal(view.getUint32(56, true), 32, "Native artifact must use the wasm32 pointer profile");
  return view.getBigUint64(32, true).toString(16).padStart(16, "0");
}

export async function inspectNativeWasmSourceIdentity(root) {
  const expected = await computeNativeWasmSourceIdentity(root);
  const pkg = path.join(root, "packages/ferrum-web/pkg");
  const wasm = await readFile(path.join(pkg, "ferrum_core_bg.wasm"));
  const factoryPath = path.join(pkg, "ferrum_core_factory.js");
  const { createFerrumWasmBindings } = await import(pathToFileURL(factoryPath).href);
  const factory = createFerrumWasmBindings();
  let actual;
  try {
    factory.bindings.initSync({ module: wasm });
    actual = factory.invoke(bindings => {
      const engine = new bindings.Engine();
      try {
        engine.use_data_scene();
        // Rust treats the six SDK sections as opaque here. No SDK admission,
        // public Ready token, stepping or source-world query is performed.
        const file = engine.capture_native_file(new TextEncoder().encode("{}{}{}{}{}{}"),
          new Uint32Array([2, 2, 2, 2, 2, 2]), 0, 0, new Uint32Array());
        return readNativeFileBuildIdentity(file);
      } finally { engine.free(); }
    });
  } finally { factory.dispose(); }
  return {
    format: "ferrum2d.native-wasm-source-identity", version: 1,
    matches: actual === expected.fingerprint, expected, compiledFingerprint: actual,
    wasmSha256: sha256(wasm), factorySha256: sha256(await readFile(factoryPath)),
    scope: "Actual Wasm embedded Core source/target compatibility fingerprint; not a compiler/flags, reproducibility, signature or whole-package acceptance proof.",
  };
}

export async function assertNativeWasmSourceIdentity(root) {
  const result = await inspectNativeWasmSourceIdentity(root);
  assert(result.matches,
    `Core source/Wasm mismatch (${result.compiledFingerprint} != ${result.expected.fingerprint}); run pnpm build:wasm before reusing package artifacts`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, "Unexpected native Wasm source identity argument");
  const result = await inspectNativeWasmSourceIdentity(fileURLToPath(new URL("../../", import.meta.url)));
  console.log(JSON.stringify(result));
  if (!result.matches) process.exitCode = 1;
}
