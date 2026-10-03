#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { githubRelease } from "../../packages/create-game/bin/github-release.mjs";
import { runReleaseCommand } from "./github-release-command.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.length !== 2 || args[0] !== "--bundle-dir") {
  throw new Error("Usage: pnpm smoke:github-release-install -- --bundle-dir <prepared release directory>");
}
const bundle = path.resolve(args[1]);
let temp;
let server;
const report = {
  format: "ferrum2d.github-release.install-smoke", version: 1,
  release: null, transport: "local-http-mirror", liveGithubDownloadVerified: false,
  nodeVersion: process.version, status: "failed", checks: {},
};
try {
  // Invalidate an older success before parsing or verifying any bundle input.
  await writeFile(path.join(bundle, "github-install-smoke-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const manifest = JSON.parse(await readFile(path.join(bundle, "release-manifest.json"), "utf8"));
  assert.equal(manifest.format, "ferrum2d.github-release.bundle");
  assert.equal(manifest.version, 1);
  const release = githubRelease(manifest.release.version, manifest.release.repository);
  assert.equal(manifest.release.tag, release.tag);
  report.release = { repository: release.repository, version: release.version, tag: release.tag };
  assert.equal(manifest.assets.length, 4);
  const expectedUrls = new Set([release.generator, release.runtime, release.viewer, release.agents]);
  const files = new Map();
  for (const asset of manifest.assets) {
    assert(expectedUrls.delete(asset.url), `Unexpected or duplicate asset URL: ${asset.url}`);
    assert.equal(asset.file, path.basename(new URL(asset.url).pathname));
    assert.equal(asset.version, release.version);
    const bytes = await readFile(path.join(bundle, asset.file));
    assert.equal(bytes.length, asset.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, `Corrupt release asset: ${asset.file}`);
    files.set(asset.file, bytes);
  }
  assert.equal(expectedUrls.size, 0);

  report.checks.bundleIntegrity = true;
  temp = await mkdtemp(path.join(os.tmpdir(), "ferrum-release-http-"));
  const downloaded = new Set();
  server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const file = path.posix.basename(pathname);
    if (!files.has(file)) { response.writeHead(404).end(); return; }
    const original = new URL(`${release.baseUrl}/${file}`).pathname;
    if (pathname === original) {
      response.writeHead(302, { Location: `/assets/${file}` }).end();
    } else if (pathname === `/assets/${file}`) {
      downloaded.add(file);
      const bytes = files.get(file);
      response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length }).end(bytes);
    } else response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const mirror = (url) => origin + new URL(url).pathname;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const game = path.join(temp, "my game");
  // Exercise the documented URL command, including npx's binary inference.
  await command(npx, ["--yes", "--allow-remote=root", mirror(release.generator), game], temp);
  const packagePath = path.join(game, "package.json");
  const gamePackage = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(gamePackage.dependencies["@ferrum2d/ferrum-web"], release.runtime);
  assert.equal(gamePackage.dependencies["@ferrum2d/authoring-viewer"], release.viewer);
  assert.deepEqual(gamePackage.ferrumGithubRelease, manifest.release);
  assert(gamePackage.scripts["ferrum:agents"].includes(release.agents));
  report.checks.releaseDefaults = true;
  assert.match(await readFile(path.join(game, ".npmrc"), "utf8"), /^allow-remote=root$/m);
  await assert.rejects(stat(path.join(game, ".agents")), { code: "ENOENT" });
  // The exact generated GitHub URLs above are verified BEFORE replacing their
  // origin with the local fixture. This test never claims a live GitHub release.
  gamePackage.dependencies["@ferrum2d/ferrum-web"] = mirror(release.runtime);
  gamePackage.dependencies["@ferrum2d/authoring-viewer"] = mirror(release.viewer);
  gamePackage.scripts["ferrum:agents"] = gamePackage.scripts["ferrum:agents"].replace(release.agents, mirror(release.agents));
  await writeFile(packagePath, JSON.stringify(gamePackage, null, 2));
  await command(npm, ["install", "--no-audit", "--no-fund"], game);
  report.checks.install = true;
  for (const name of ["ferrum-web", "authoring-viewer"]) {
    const installed = JSON.parse(await readFile(path.join(game, "node_modules/@ferrum2d", name, "package.json"), "utf8"));
    assert.equal(installed.version, release.version);
  }
  await assert.rejects(stat(path.join(game, ".agents")), { code: "ENOENT" });
  const lock = JSON.parse(await readFile(path.join(game, "package-lock.json"), "utf8"));
  for (const name of ["ferrum-web", "authoring-viewer"]) {
    assert.match(lock.packages[`node_modules/@ferrum2d/${name}`].integrity, /^sha512-/);
  }
  report.checks.lockIntegrity = true;
  await command(npm, ["ci", "--no-audit", "--no-fund"], game);
  report.checks.cleanInstall = true;
  await command(npm, ["run", "ferrum:agents"], game);
  await stat(path.join(game, ".codex/agents/consumer-project-agent.toml"));
  await stat(path.join(game, ".claude/agents/consumer-project-agent.md"));
  await stat(path.join(game, ".gemini/commands/ferrum/project.toml"));
  report.checks.explicitAgentInstall = true;
  await command(npm, ["run", "ferrum:check"], game);
  report.checks.gameCheck = true;
  await command(npm, ["run", "ferrum:deploy-report"], game);
  report.checks.productionPreview = true;
  assert.equal(downloaded.size, 4, "All four packages must be downloaded through the HTTP redirect fixture");
  report.checks.httpRedirects = true;
  report.status = "passed";
  console.log("GitHub Release HTTP install smoke passed (local mirror, not a live release).");
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  server?.closeAllConnections();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  try {
    await writeFile(path.join(bundle, "github-install-smoke-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true });
  }
}

async function command(executable, args, cwd) {
  console.log(`Checking: ${executable} ${args.slice(0, 2).join(" ")}`);
  const env = { ...process.env, npm_config_cache: path.join(temp, "npm-cache"), npm_config_update_notifier: "false" };
  // The outer test runner is pnpm; the consumer starts with npm in a fresh shell.
  // Do not let pnpm's inherited user agent make generated harnesses invoke pnpm.
  for (const key of ["npm_config_user_agent", "npm_execpath", "npm_command", "npm_config_allow_builds", "npm_config_verify_deps_before_run"]) delete env[key];
  return runReleaseCommand(executable, args, { cwd, env });
}
