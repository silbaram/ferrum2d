import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateNativeFileSdkBuild, renderNativeFileSdkBuild } from "./generate-native-file-sdk-build.mjs";

test("SDK build identity is ordered, byte-exact and distinguishes paths and boundaries", () => {
  const a = ["src/a.ts", Buffer.from("ab")], b = ["src/b.ts", Buffer.from("c")];
  assert.equal(renderNativeFileSdkBuild([a, b]), renderNativeFileSdkBuild([b, a]));
  assert.notEqual(renderNativeFileSdkBuild([a, b]), renderNativeFileSdkBuild([[a[0], Buffer.from("a")], [b[0], Buffer.from("bc")]]));
  assert.notEqual(renderNativeFileSdkBuild([a]), renderNativeFileSdkBuild([["src/other.ts", a[1]]]));
});

test("SDK build identity tracks runtime additions, removals, glue and metadata, but not tests or itself", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ferrum-sdk-build-"));
  const source = "packages/ferrum-web/src/nativeFileSdkBuild.ts";
  async function put(name, content) {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content);
  }
  async function output() { await generateNativeFileSdkBuild(root); return readFile(path.join(root, source), "utf8"); }
  try {
    for (const name of ["packages/ferrum-web/package.json", "packages/ferrum-web/tsconfig.json",
      "packages/ferrum-web/pkg/ferrum_core.js", "packages/ferrum-web/pkg/ferrum_core_factory.js",
      "scripts/build/fix-dist-esm-extensions.mjs", "packages/ferrum-web/src/runtime.ts"])
      await put(name, `original ${name}`);
    const original = await output();
    await put(source, "corrupt generated output");
    await put("packages/ferrum-web/test/runtime.test.ts", "test only");
    assert.equal(await output(), original);
    await generateNativeFileSdkBuild(root, { check: true });
    await put("packages/ferrum-web/dist/nativeFileSdkBuild.js", original.replace(": readonly [number, number]", ""));
    await generateNativeFileSdkBuild(root, { check: true, checkDist: true });
    await put("packages/ferrum-web/dist/nativeFileSdkBuild.js", "old packed identity");
    await assert.rejects(generateNativeFileSdkBuild(root, { check: true, checkDist: true }), /Packed.*stale/);
    await put("packages/ferrum-web/src/nested/new.ts", "new runtime module");
    const added = await output(); assert.notEqual(added, original);
    await rm(path.join(root, "packages/ferrum-web/src/nested/new.ts")); assert.equal(await output(), original);
    for (const name of ["packages/ferrum-web/src/runtime.ts", "packages/ferrum-web/package.json", "packages/ferrum-web/pkg/ferrum_core_factory.js"]) {
      const before = await readFile(path.join(root, name)); await put(name, "changed bytes");
      await assert.rejects(generateNativeFileSdkBuild(root, { check: true }), /stale/);
      assert.equal(await readFile(path.join(root, source), "utf8"), original);
      assert.notEqual(await output(), original); await put(name, before); assert.equal(await output(), original);
    }
    await rm(path.join(root, source));
    await assert.rejects(generateNativeFileSdkBuild(root, { check: true }), /stale/);
    await rm(path.join(root, "packages/ferrum-web/pkg/ferrum_core.js"));
    await assert.rejects(generateNativeFileSdkBuild(root), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
