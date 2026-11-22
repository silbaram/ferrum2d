import { equal, notEqual, rejects, throws } from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  computeNativeWasmSourceIdentity, isTestOnlySource, PRODUCTION_SOURCES_NAMED_LIKE_TESTS,
  readNativeFileBuildIdentity,
} from "../../scripts/package/native-wasm-source-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const fixed = [
  "build.rs", "Cargo.toml", "Cargo.lock",
  "vendor/rapier3d/Cargo.toml", "vendor/rapier3d/FERRUM-PATCHES.md", "vendor/rapier3d/UPSTREAM.json",
  "vendor/parry3d/Cargo.toml", "vendor/parry3d/FERRUM-PATCHES.md", "vendor/parry3d/UPSTREAM.json",
  "vendor/libm/Cargo.toml", "vendor/libm/build.rs", "vendor/libm/configure.rs",
  "vendor/libm/FERRUM-PATCHES.md", "vendor/libm/UPSTREAM.json",
];
async function fixture(t, reverse = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ferrum-native-identity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = [
    ...fixed.map(name => [name, name + "\n"]),
    ["src/engine.rs", "engine\n"], ["src/engine/audio.rs", "audio\n"],
    ["vendor/rapier3d/src/lib.rs", "rapier\n"], ["vendor/parry3d/src/lib.rs", "parry\n"],
    ["vendor/libm/src/lib.rs", "libm\n"],
  ];
  for (const [name, text] of reverse ? files.reverse() : files) {
    const file = path.join(root, "crates/ferrum-core", name);
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text);
  }
  return root;
}

test("source fingerprint follows the genuine Rust collector's path order and ignores traversal order", async t => {
  const first = await computeNativeWasmSourceIdentity(await fixture(t));
  const second = await computeNativeWasmSourceIdentity(await fixture(t, true));
  equal(first.sourceFiles, 19);
  equal(first.fingerprint, second.fingerprint);
  equal(first.sourceInputsSha256, second.sourceInputsSha256);
  // This constant was emitted by compiling/running the actual build.rs on this
  // synthetic tree. Keys use `/` on every host, so Windows builds match.
  equal(first.fingerprint, "1aab7af9ff8b2b43");
});

test("cfg(test)-only sources are outside the fingerprint, production look-alikes are inside", async t => {
  const root = await fixture(t), core = path.join(root, "crates/ferrum-core");
  const original = await computeNativeWasmSourceIdentity(root);
  for (const name of ["src/engine_tests.rs", "src/engine/tests.rs", "src/engine/tests/deep.rs",
    "vendor/rapier3d/src/geometry/narrow_phase/validation/tests.rs"]) {
    const file = path.join(core, name);
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, "#[test] fn t() {}\n");
    equal((await computeNativeWasmSourceIdentity(root)).fingerprint, original.fingerprint, name);
    await rm(file);
  }
  const lookAlike = path.join(core, PRODUCTION_SOURCES_NAMED_LIKE_TESTS[0]);
  await mkdir(path.dirname(lookAlike), { recursive: true }); await writeFile(lookAlike, "pub fn crossing() {}\n");
  notEqual((await computeNativeWasmSourceIdentity(root)).fingerprint, original.fingerprint);
});

// Each excluded top test module must be declared behind #[cfg(test)] (directly,
// via #[path], or as cfg(all(test, ...))). A new production module with a
// test-like name fails here until it is added to the build.rs/mirror exception.
test("every excluded Core and vendor source is a cfg(test) module", async () => {
  const core = path.join(repoRoot, "crates/ferrum-core");
  const files = [];
  async function walk(relative) {
    for (const entry of await readdir(path.join(core, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(name);
      else if (entry.name.endsWith(".rs")) files.push(name);
    }
  }
  for (const root of ["src", "vendor/rapier3d/src", "vendor/parry3d/src", "vendor/libm/src"]) await walk(root);
  const sources = new Map(await Promise.all(files.map(async name => [name, await readFile(path.join(core, name), "utf8")])));
  const testName = part => { const stem = part.replace(/\.rs$/, ""); return stem === "tests" || stem.endsWith("_tests"); };
  const cfgTest = attributes => /#\[cfg\(\s*(test\b|all\(\s*test\b)/.test(attributes);
  const declared = top => {
    for (const [name, text] of sources) {
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const module = lines[i].match(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/);
        if (!module) continue;
        let k = i - 1, attributes = "";
        while (k >= 0 && /^\s*(#\[|\)\)\]|feature|test,|\/\/)/.test(lines[k])) attributes = lines[k--] + attributes;
        const pathAttribute = attributes.match(/#\[path\s*=\s*"([^"]+)"\]/);
        const parent = name.endsWith("/mod.rs") || name.endsWith("/lib.rs") ? path.posix.dirname(name) : name.replace(/\.rs$/, "");
        const targets = pathAttribute
          ? [path.posix.join(path.posix.dirname(name), pathAttribute[1])]
          : [path.posix.join(parent, module[1]), `${path.posix.join(parent, module[1])}.rs`, path.posix.join(parent, module[1], "mod.rs")];
        if (targets.includes(top)) return cfgTest(attributes);
      }
    }
    return false;
  };
  let excluded = 0;
  const checked = new Set();
  for (const name of files) {
    if (!isTestOnlySource(name)) continue;
    excluded++;
    const parts = name.split("/"), index = parts.findIndex(testName);
    const top = parts.slice(0, index + 1).join("/");
    if (checked.has(top)) continue;
    checked.add(top);
    equal(declared(top), true, `${top} is excluded but not declared under #[cfg(test)]`);
  }
  equal(excluded > 100, true);
  for (const name of PRODUCTION_SOURCES_NAMED_LIKE_TESTS) equal(sources.has(name), true, name);
});

test("Core, both vendors, lock and patch inputs plus added/removed Rust files invalidate reuse", async t => {
  const root = await fixture(t), core = path.join(root, "crates/ferrum-core");
  const original = await computeNativeWasmSourceIdentity(root);
  for (const name of ["src/engine.rs", "vendor/rapier3d/src/lib.rs", "vendor/parry3d/src/lib.rs",
    "vendor/libm/src/lib.rs", "Cargo.lock", "vendor/parry3d/FERRUM-PATCHES.md", "vendor/libm/FERRUM-PATCHES.md"]) {
    const file = path.join(core, name), before = await readFile(file);
    await writeFile(file, Buffer.concat([before, Buffer.from("changed\n")]));
    const changed = await computeNativeWasmSourceIdentity(root);
    notEqual(changed.fingerprint, original.fingerprint);
    notEqual(changed.sourceInputsSha256, original.sourceInputsSha256);
    await writeFile(file, before);
  }
  const added = path.join(core, "src/added.rs");
  await writeFile(added, "new source\n");
  notEqual((await computeNativeWasmSourceIdentity(root)).fingerprint, original.fingerprint);
  await rm(added);
  equal((await computeNativeWasmSourceIdentity(root)).fingerprint, original.fingerprint);
  await writeFile(path.join(core, "README.md"), "not a build.rs input\n");
  equal((await computeNativeWasmSourceIdentity(root)).fingerprint, original.fingerprint);
  await rm(path.join(core, "Cargo.lock"));
  await rejects(computeNativeWasmSourceIdentity(root), { code: "ENOENT" });
});

function header() {
  const bytes = new Uint8Array(64), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("F2DFILE\0"));
  view.setUint32(8, 1, true); view.setUint32(12, 64, true);
  view.setUint32(20, 7, true); view.setBigUint64(24, 64n, true);
  view.setBigUint64(32, 0x0123456789abcdefn, true); view.setUint32(56, 32, true);
  return bytes;
}

test("captured build identity handles a nonzero view offset and rejects unknown framing/target", () => {
  const backing = new Uint8Array(96), bytes = header(); backing.set(bytes, 13);
  equal(readNativeFileBuildIdentity(backing.subarray(13, 77)), "0123456789abcdef");
  throws(() => readNativeFileBuildIdentity(bytes.subarray(0, 63)));
  for (const [offset, value] of [[0, 0], [8, 2], [12, 32], [20, 6], [24, 65], [56, 64]]) {
    const changed = header(); new DataView(changed.buffer).setUint32(offset, value, true);
    throws(() => readNativeFileBuildIdentity(changed));
  }
});
