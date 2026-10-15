import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installLocalEngine, parseArgs, powershellCommand, windowsPath } from "../../scripts/package/install-local-engine.mjs";

test("local install arguments reject missing values and unknown options", () => {
  assert.throws(() => parseArgs([]), /--project/);
  assert.throws(() => parseArgs(["--project", "--skip-build"]), /requires a value/);
  assert.throws(() => parseArgs(["--project", "/tmp/game", "--skip-check"]), /Unknown/);
  assert.deepEqual(parseArgs(["--", "--project", "C:\\My Game", "--skip-build"]), { project: "C:\\My Game", skipBuild: true });
});

test("Windows npm invocation keeps paths and command arguments literal", () => {
  assert.equal(windowsPath("/mnt/c/Users/psj/My Game"), "C:\\Users\\psj\\My Game");
  assert.equal(windowsPath("/tmp/game"), null);
  const encoded = powershellCommand("node.exe", ["-e", "console.log('x'); $HOME; $(bad)"], "C:\\It's a Game");
  const script = Buffer.from(encoded.at(-1), "base64").toString("utf16le");
  assert.match(script, /Set-Location -LiteralPath 'C:\\It''s a Game'/);
  assert.ok(script.includes("'console.log(''x''); $HOME; $(bad)'"));
});

test("real tarball installs offline and a failed game check restores the previous engine", { timeout: 180000 }, async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "ferrum-local-install-test-"));
  const readJson = async (file) => JSON.parse(await readFile(path.join(project, file), "utf8"));
  const packageFile = path.join(project, "package.json");
  const outputs = [];
  const previousCache = process.env.npm_config_cache;
  process.env.npm_config_cache = path.join(project, "npm-cache");
  try {
    await writeFile(packageFile, JSON.stringify({ name: "local-install-test", private: true, type: "module",
      dependencies: { "@ferrum2d/ferrum-web": "https://example.invalid/never-download.tgz" },
      scripts: { "ferrum:check": "node --input-type=module -e \"await import('@ferrum2d/ferrum-web/core')\"" },
    }));
    const first = await installLocalEngine({ project, skipBuild: true });
    outputs.push(first.output);
    assert.equal(first.report.status, "passed");
    const original = await readJson("package.json");
    assert.equal(original.ferrumLocalEngine.version, first.report.package.version);
    const installedFile = "node_modules/@ferrum2d/ferrum-web/package.json";
    assert.equal((await readJson(installedFile)).version, first.report.package.version);
    original.scripts["ferrum:check"] = "node -e \"process.exit(23)\"";
    await writeFile(packageFile, `${JSON.stringify(original, null, 2)}\n`);
    const before = await readFile(packageFile);
    const lockBefore = await readFile(path.join(project, "package-lock.json"));
    const coreBefore = await readFile(path.join(project, "node_modules/@ferrum2d/ferrum-web/dist/core.js"));
    await assert.rejects(installLocalEngine({ project, skipBuild: true }), /failed/);
    assert.ok(before.equals(await readFile(packageFile)));
    assert.ok(lockBefore.equals(await readFile(path.join(project, "package-lock.json"))));
    assert.ok(coreBefore.equals(await readFile(path.join(project, "node_modules/@ferrum2d/ferrum-web/dist/core.js"))));
    assert.equal((await readJson(installedFile)).version, first.report.package.version);
  } finally {
    if (previousCache === undefined) delete process.env.npm_config_cache;
    else process.env.npm_config_cache = previousCache;
    await rm(project, { recursive: true, force: true });
    // Reports for failures intentionally remain in artifacts/local-engine for diagnosis.
    for (const output of outputs) await rm(output, { recursive: true, force: true });
  }
});
