import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  validateSpriteNormalWasmBundle,
  wasmMemoryLimits,
} from "../../scripts/tools/build-sprite-normals-wasm.mjs";
import {
  repositoryRoot,
  sha256,
  tool,
} from "../../scripts/tools/sprite-normals-tool.mjs";

const header = [0, 97, 115, 109, 1, 0, 0, 0];
const boundedMemory = Buffer.from([...header, 5, 5, 1, 1, 1, 128, 32]);

async function bundle(t) {
  const root = await mkdtemp(resolve(tmpdir(), "ferrum-normal-wasm-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resource = async (path, data) => {
    await writeFile(resolve(root, path), data);
    return { path, bytes: data.length, sha256: sha256(data) };
  };
  const manifest = {
    format: "ferrum2d.sprite-normal.generator",
    version: 1,
    generator: tool,
    target: "wasm32-unknown-unknown",
    memoryMaxBytes: 268435456,
    adapterSha256: sha256(
      await readFile(
        resolve(repositoryRoot, "scripts/tools/sprite-normals-wasm.patch"),
      ),
    ),
    module: await resource(
      "spritefusion_sprite_normals.js",
      Buffer.from("export default function(){}"),
    ),
    wasm: await resource("spritefusion_sprite_normals_bg.wasm", boundedMemory),
    license: await resource("LICENSE", Buffer.from("MIT License\nfixture")),
  };
  const save = () =>
    writeFile(resolve(root, "manifest.json"), JSON.stringify(manifest));
  await save();
  return { root, manifest, save };
}

test("Wasm memory reader requires one bounded unshared wasm32 memory and complete limits", () => {
  assert.deepEqual(wasmMemoryLimits(boundedMemory), {
    initialBytes: 65536,
    maxBytes: 268435456,
  });
  for (const invalid of [
    Buffer.from("not wasm"),
    Buffer.from(header),
    Buffer.from([...header, 5, 3, 1, 0, 1]),
    Buffer.from([...header, 5, 4, 1, 3, 1, 1]),
    Buffer.from([...header, 5, 4, 1, 1, 2, 1]),
    boundedMemory.subarray(0, -1),
    Buffer.from([...header, 5, 2, 1, 1, 1, 128, 32]),
  ])
    assert.throws(() => wasmMemoryLimits(invalid));
});

test("optional bundle validation pins provenance, paths, adapter, hashes and actual memory cap", async (t) => {
  const b = await bundle(t),
    validated = await validateSpriteNormalWasmBundle(b.root);
  assert.equal(
    validated.manifestSha256,
    sha256(await readFile(resolve(b.root, "manifest.json"))),
  );
  for (const change of [
    { version: 2 },
    { generator: { ...tool, revision: "wrong" } },
    { target: "other" },
    { adapterSha256: "0".repeat(64) },
    { memoryMaxBytes: 536870912 },
    { module: { ...b.manifest.module, path: "../escape.js" } },
  ]) {
    await writeFile(
      resolve(b.root, "manifest.json"),
      JSON.stringify({ ...b.manifest, ...change }),
    );
    await assert.rejects(validateSpriteNormalWasmBundle(b.root));
  }
  await b.save();
  const wrongMemory = Buffer.from([...header, 5, 4, 1, 1, 1, 1]);
  await writeFile(resolve(b.root, b.manifest.wasm.path), wrongMemory);
  b.manifest.wasm.bytes = wrongMemory.length;
  b.manifest.wasm.sha256 = sha256(wrongMemory);
  await b.save();
  await assert.rejects(
    validateSpriteNormalWasmBundle(b.root),
    /memory maximum differs/,
  );
});

test("existing damaged bundle is rejected rather than silently repaired", async (t) => {
  const b = await bundle(t);
  await writeFile(resolve(b.root, b.manifest.module.path), "changed");
  await assert.rejects(
    validateSpriteNormalWasmBundle(b.root),
    /module integrity differs/,
  );
  await rm(resolve(b.root, b.manifest.wasm.path));
  // Restore JS to reach the missing Wasm resource; validation performs no writes.
  await writeFile(
    resolve(b.root, b.manifest.module.path),
    "export default function(){}",
  );
  await assert.rejects(validateSpriteNormalWasmBundle(b.root), {
    code: "ENOENT",
  });
  await assert.rejects(readFile(resolve(b.root, b.manifest.wasm.path)), {
    code: "ENOENT",
  });
});
