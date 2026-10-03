import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { githubRelease, resolveGithubRelease } from "../../packages/create-game/bin/github-release.mjs";
import { run } from "../../scripts/package/package-check-helpers.mjs";
import { prepareGithubRelease } from "../../scripts/package/prepare-github-release.mjs";
import { runReleaseCommand } from "./github-release-command.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = path.join(repoRoot, "packages/create-game");
let temp;
let bundled;
before(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), "ferrum-release-contract-"));
  bundled = path.join(temp, "generator");
  await cp(source, bundled, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(bundled, "package.json"), "utf8"));
  manifest.version = "0.1.0-beta.7";
  manifest.ferrumGithubRelease = { version: manifest.version, tag: "ferrum-web-v0.1.0-beta.7", repository: "example/ferrum-fork" };
  await writeFile(path.join(bundled, "package.json"), JSON.stringify(manifest));
});
after(async () => { if (temp) await rm(temp, { recursive: true, force: true }); });

test("exact beta releases only; reject mutable tags, malformed versions, and unsafe repository paths", () => {
  assert.equal(githubRelease("ferrum-web-v0.1.0-beta.7").tag, "ferrum-web-v0.1.0-beta.7");
  for (const version of [undefined, {}, "", "latest", "beta", "0.1.0", "01.1.0-beta.1", "0.1.0-beta.01", "0.1.0-beta.1\n", "0.1.0-beta.1/../x"]) {
    assert.throws(() => githubRelease(version), /exact beta version/);
  }
  for (const repository of ["", "https://github.com/o/r", "o/r.git", "o/../r", "o/r?x", "o/r;echo", "o/r\n"]) {
    assert.throws(() => githubRelease("0.1.0-beta.7", repository), /owner\/repo/);
  }
});

test("embedded release metadata must agree with package version", () => {
  assert.throws(() => resolveGithubRelease({}, { version: "0.1.0-beta.8", ferrumGithubRelease: {
    version: "0.1.0-beta.7", tag: "ferrum-web-v0.1.0-beta.7", repository: "example/repo",
  } }), /must match/);
  assert.throws(() => resolveGithubRelease({}, { version: "0.1.0-beta.7", ferrumGithubRelease: {
    version: "0.1.0-beta.7", tag: "ferrum-web-v0.1.0-beta.7",
  } }), /must include/);
});

test("release preparation rejects mismatched base versions and preserves an existing output directory", async () => {
  const mismatched = path.join(temp, "wrong-base");
  await assert.rejects(prepareGithubRelease({ version: "99.0.0-beta.1", output: mismatched, skipBuild: true, skipPackageCheck: true }), /base version/);
  await assert.rejects(stat(mismatched), { code: "ENOENT" });
  const before = await readFile(path.join(bundled, "package.json"), "utf8");
  await assert.rejects(prepareGithubRelease({ version: "0.1.0-beta.7", output: bundled, skipBuild: true, skipPackageCheck: true }), /already exists/);
  assert.equal(await readFile(path.join(bundled, "package.json"), "utf8"), before);
});

for (const template of ["minimal", "topdown", "platformer", "breakout"]) {
  test(`release-built CLI automatically pins ${template}, including optional agent setup`, async () => {
    const target = path.join(temp, `game with spaces ${template}`);
    const result = await run(process.execPath, [path.join(bundled, "bin/create-game.mjs"), target, "--template", template], temp);
    assert.equal(result.code, 0, result.stderr);
    const manifest = JSON.parse(await readFile(path.join(target, "package.json"), "utf8"));
    const base = "https://github.com/example/ferrum-fork/releases/download/ferrum-web-v0.1.0-beta.7";
    assert.equal(manifest.dependencies["@ferrum2d/ferrum-web"], `${base}/ferrum2d-ferrum-web-0.1.0-beta.7.tgz`);
    assert.equal(manifest.dependencies["@ferrum2d/authoring-viewer"], `${base}/ferrum2d-authoring-viewer-0.1.0-beta.7.tgz`);
    assert.match(manifest.scripts["ferrum:agents"], /--package=https:\/\/github.com\/example\/ferrum-fork\/releases\/download\/ferrum-web-v0.1.0-beta.7\/ferrum2d-agents-0.1.0-beta.7.tgz/);
    assert.equal(manifest.scripts.postinstall, undefined);
    assert.equal(manifest.ferrumGithubRelease.version, "0.1.0-beta.7");
    assert.match(result.stdout, /npm run ferrum:agents/);
    assert(!result.stdout.includes("npx @ferrum2d/agents"));
    assert.match(await readFile(path.join(target, "FERRUM_INSTALL.md"), "utf8"), /package-lock.json/);
    assert.match(await readFile(path.join(target, ".npmrc"), "utf8"), /^allow-remote=root$/m);
    await assert.rejects(stat(path.join(target, ".agents")), { code: "ENOENT" });
  });
}

test("source CLI supports an explicit release and fork without network or local release metadata", async () => {
  const target = path.join(temp, "explicit");
  const result = await run(process.execPath, [path.join(source, "bin/create-game.mjs"), target,
    "--github-release=ferrum-web-v0.1.0-beta.9", "--github-repository=someone/engine"], temp);
  assert.equal(result.code, 0, result.stderr);
  const manifest = JSON.parse(await readFile(path.join(target, "package.json"), "utf8"));
  assert.equal(manifest.dependencies["@ferrum2d/ferrum-web"], "https://github.com/someone/engine/releases/download/ferrum-web-v0.1.0-beta.9/ferrum2d-ferrum-web-0.1.0-beta.9.tgz");
});

test("invalid release options fail before creating a game directory", async () => {
  const cases = [
    ["--github-release", "latest"],
    ["--github-release="],
    ["--github-repository", "someone/repo"],
    ["--github-release", "0.1.0-beta.7", "--ferrum-version", "file:engine.tgz"],
    ["--github-release", "0.1.0-beta.7", "--authoring-viewer-version", "^0.1.0"],
    ["--github-release", "0.1.0-beta.7", "--github-repository", "o/r;whoami"],
  ];
  for (const [index, args] of cases.entries()) {
    const target = path.join(temp, `invalid-${index}`);
    const result = await run(process.execPath, [path.join(source, "bin/create-game.mjs"), target, ...args], temp);
    assert.notEqual(result.code, 0);
    await assert.rejects(stat(target), { code: "ENOENT" });
  }
});

test("release CLI refuses to overwrite an existing game without force", async () => {
  const target = path.join(temp, "existing");
  const args = [path.join(bundled, "bin/create-game.mjs"), target];
  assert.equal((await run(process.execPath, args, temp)).code, 0);
  await writeFile(path.join(target, "src/main.ts"), "// user's game\n");
  const result = await run(process.execPath, args, temp);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /not empty/);
  assert.equal(await readFile(path.join(target, "src/main.ts"), "utf8"), "// user's game\n");
  await writeFile(path.join(target, ".npmrc"), "allow-remote=none\nregistry=https://registry.npmjs.org/\n");
  assert.equal((await run(process.execPath, [...args, "--force"], temp)).code, 0);
  assert.equal(await readFile(path.join(target, ".npmrc"), "utf8"), "allow-remote=none\nregistry=https://registry.npmjs.org/\n");
});

test("the printed directory command handles spaces, quotes, shell substitutions, and leading hyphens", { skip: process.platform === "win32" }, async () => {
  for (const name of ["my game", "game's $HOME $(echo unexpected)", "-my-game"]) {
    const target = path.join(temp, name);
    const created = await run(process.execPath, [path.join(bundled, "bin/create-game.mjs"), target], temp);
    assert.equal(created.code, 0, created.stderr);
    const command = created.stdout.split("\n").find((line) => line.startsWith("  cd "))?.trim();
    assert(command, "CLI must print a usable directory command");
    const navigation = await run("sh", ["-c", `${command}\npwd -P`], temp);
    assert.equal(navigation.code, 0, navigation.stderr);
    assert.equal(navigation.stdout.trimEnd(), target);
  }
});

for (const failure of ["invalid JSON", "missing asset", "corrupt asset"]) {
  test(`${failure} replaces a previous passed installation report before running npm`, async () => {
    const bundle = await mkdtemp(path.join(temp, "bad-bundle-"));
    const release = githubRelease("0.1.0-beta.7");
    const assets = [];
    for (const url of [release.generator, release.runtime, release.viewer, release.agents]) {
      const file = path.basename(new URL(url).pathname);
      const bytes = Buffer.from(`fixture for ${file}`);
      await writeFile(path.join(bundle, file), bytes);
      assets.push({ url, file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), version: release.version });
    }
    const manifest = { format: "ferrum2d.github-release.bundle", version: 1, release, assets };
    await writeFile(path.join(bundle, "release-manifest.json"), failure === "invalid JSON" ? "{" : JSON.stringify(manifest));
    if (failure === "missing asset") await rm(path.join(bundle, assets[0].file));
    if (failure === "corrupt asset") {
      // Keep the byte count equal so that the SHA-256 guard must reject it.
      await writeFile(path.join(bundle, assets[0].file), Buffer.alloc(assets[0].bytes));
    }
    const reportPath = path.join(bundle, "github-install-smoke-report.json");
    await writeFile(reportPath, JSON.stringify({ status: "passed", checks: { install: true } }));
    const result = await run(process.execPath, [path.join(repoRoot, "tests/smoke/github-release-install-smoke.mjs"), "--bundle-dir", bundle], temp);
    assert.notEqual(result.code, 0);
    assert(!result.stdout.includes("Checking:"), "invalid assets must not reach npm/npx");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.status, "failed");
    assert.equal(report.liveGithubDownloadVerified, false);
    assert.equal(report.checks.install, undefined);
    assert.equal(report.checks.bundleIntegrity, undefined);
    assert.equal(typeof report.error, "string");
    if (failure === "invalid JSON") assert.equal(report.release, null);
    if (failure === "corrupt asset") assert.match(report.error, /Corrupt release asset/);
  });
}

test("the release command runner reports spawn errors and failed command output", async () => {
  await assert.rejects(runReleaseCommand(path.join(temp, "missing-executable"), [], { cwd: temp, timeoutMs: 1000 }), /ENOENT/);
  await assert.rejects(runReleaseCommand(process.execPath, ["-e", "console.error('fixture failed'); process.exitCode = 7"], { cwd: temp, timeoutMs: 1000 }), /failed \(7\)[\s\S]*fixture failed/);
});

test("command timeouts kill descendants even after the package-manager process has exited", { skip: process.platform === "win32", timeout: 5000 }, async () => {
  const heartbeat = path.join(temp, "descendant-heartbeat");
  const pidFile = path.join(temp, "descendant-pid");
  const descendant = `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => fs.appendFileSync(${JSON.stringify(heartbeat)}, '.'), 10);`;
  const parent = `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'inherit', 'inherit'] }); child.unref(); process.exit(0);`;
  let pid;
  try {
    await assert.rejects(runReleaseCommand(process.execPath, ["-e", parent], { cwd: temp, timeoutMs: 500 }), /timed out after 500ms/);
    pid = Number(await readFile(pidFile, "utf8"));
    await delay(50);
    const stoppedSize = (await stat(heartbeat)).size;
    assert(stoppedSize > 0, "descendant must have started before timeout");
    await delay(100);
    assert.equal((await stat(heartbeat)).size, stoppedSize, "timed-out descendant must stop writing");
  } finally {
    if (pid) {
      try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  }
});
