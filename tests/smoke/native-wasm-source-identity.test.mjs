import { equal, notEqual, rejects, throws } from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  computeNativeWasmSourceIdentity, readNativeFileBuildIdentity,
} from "../../scripts/package/native-wasm-source-identity.mjs";

const fixed = [
  "build.rs", "Cargo.toml", "Cargo.lock",
  "vendor/rapier3d/Cargo.toml", "vendor/rapier3d/FERRUM-PATCHES.md", "vendor/rapier3d/UPSTREAM.json",
  "vendor/parry3d/Cargo.toml", "vendor/parry3d/FERRUM-PATCHES.md", "vendor/parry3d/UPSTREAM.json",
];
async function fixture(t, reverse = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ferrum-native-identity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = [
    ...fixed.map(name => [name, name + "\n"]),
    ["src/engine.rs", "engine\n"], ["src/engine/audio.rs", "audio\n"],
    ["vendor/rapier3d/src/lib.rs", "rapier\n"], ["vendor/parry3d/src/lib.rs", "parry\n"],
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
  equal(first.sourceFiles, 13);
  equal(first.fingerprint, second.fingerprint);
  equal(first.sourceInputsSha256, second.sourceInputsSha256);
  // This constant was emitted by compiling/running the actual build.rs on this
  // synthetic tree. Rust's existing fingerprint uses the host path separator.
  if (path.sep === "/") equal(first.fingerprint, "d7fe071a4dfca5d8");
});

test("Core, both vendors, lock and patch inputs plus added/removed Rust files invalidate reuse", async t => {
  const root = await fixture(t), core = path.join(root, "crates/ferrum-core");
  const original = await computeNativeWasmSourceIdentity(root);
  for (const name of ["src/engine.rs", "vendor/rapier3d/src/lib.rs", "vendor/parry3d/src/lib.rs",
    "Cargo.lock", "vendor/parry3d/FERRUM-PATCHES.md"]) {
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
