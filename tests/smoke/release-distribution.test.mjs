import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { githubRelease } from "../../packages/create-game/bin/github-release.mjs";
import { parseDistributionArgs, prepareDistribution } from "../../scripts/package/prepare-distribution.mjs";
import { prepareViewerRelease } from "../../scripts/package/prepare-viewer-release.mjs";
import { assembleDistribution, fileRecord, nativeChecks, readJson, releaseIdentity, validateEngineBundle, verifyDistribution } from "../../scripts/package/release-distribution.mjs";
import { resolvePackageCommand } from "../../scripts/package/release-command.mjs";
import { updaterSettings } from "../../scripts/package/viewer-updater.mjs";

const version = "0.1.0-beta.1", release = githubRelease(version), commit = "a".repeat(40);
async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ferrum distribution & "));
  t.after(() => rm(root, { recursive: true, force: true })); return root;
}
async function put(root, name, value) {
  const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === "object" && !Buffer.isBuffer(value) ? JSON.stringify(value, null, 2) : value); return file;
}

// Simulated tool output tests artifact contracts; it is not native installer/GUI evidence.
async function nativeFixture(t, { platform = "linux", arch = "x64", stale = false, wrongWasm = false, missingPrerequisite = false } = {}) {
  const root = await temporary(t), calls = [], output = path.join(root, "candidate");
  const names = { linux: "linux", win32: "windows", darwin: "macos" }, bundles = { linux: "deb", win32: "nsis", darwin: "dmg" }, extensions = { linux: "deb", win32: "exe", darwin: "dmg" };
  const target = platform === "linux" ? "x86_64-unknown-linux-gnu" : platform === "win32" ? "x86_64-pc-windows-msvc" : arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  const installer = path.join(root, "target", target, "release/bundle", bundles[platform], `Ferrum2D Placement Viewer_${version}_${arch}.${extensions[platform]}`);
  await put(root, "packages/ferrum-web/package.json", { name: "@ferrum2d/ferrum-web", version: "0.1.0", private: true });
  await put(root, "apps/placement-viewer-desktop/package.json", { name: "@ferrum2d/placement-viewer-desktop", version: "0.1.0", private: true });
  await put(root, "apps/placement-viewer-desktop/src-tauri/tauri.conf.json", { version: "0.1.0" });
  await put(root, "apps/placement-viewer-desktop/src-tauri/Cargo.toml", '[package]\nversion = "0.1.0"\n');
  await put(root, "apps/placement-viewer-desktop/app-icon.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>');
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  await put(root, "packages/ferrum-web/pkg/ferrum_core_bg.wasm", wasm);
  await put(root, "apps/placement-viewer/dist/index.html", "<canvas></canvas>");
  await put(root, "apps/placement-viewer/dist/assets/core.wasm", wrongWasm ? "old wasm" : wasm);
  if (stale) { await put(root, path.relative(root, installer), "old installer"); await utimes(installer, 0, 0); }
  const run = async (command, args) => {
    calls.push({ command, args }); let stdout = "";
    if (command === "pkg-config" && missingPrerequisite) throw new Error("spawn pkg-config ENOENT");
    if (command === "rustc") stdout = `rustc 1.90.0\nhost: ${target}\n`;
    if (command === "git") stdout = args[0] === "rev-parse" ? `${commit}\n` : "";
    if (command === "cargo") stdout = JSON.stringify({ target_directory: path.join(root, "target") });
    if (command === "pnpm" && args.includes("icon")) {
      const dir = args[args.indexOf("--output") + 1];
      for (const file of ["32x32.png", "128x128.png", "128x128@2x.png", "icon.ico", "icon.icns"]) await put(dir, file, "fixture icon");
    }
    if (command === "pnpm" && args.includes("tauri") && args.includes("build") && !stale) {
      await put(root, path.relative(root, installer), `fixture installer ${names[platform]}`);
      // A cached beta.10 must not be selected for beta.1.
      await put(root, path.relative(root, installer).replace(version, "0.1.0-beta.10"), "unrelated cached installer");
      await put(root, path.relative(root, installer).replace(version, "10.1.0-beta.1"), "unrelated major version");
    }
    return { stdout, stderr: "" };
  };
  return { root, output, calls, context: { root, platform, arch, run }, options: { version, repository: release.repository, output, quiet: true, noSign: true } };
}

async function engineFixture(root) {
  await mkdir(root, { recursive: true }); const assets = [];
  for (const name of ["ferrum-web", "authoring-viewer", "create-game", "agents"]) {
    const file = `ferrum2d-${name}-${version}.tgz`; await put(root, file, `fixture package ${name}`);
    assets.push({ ...await fileRecord(path.join(root, file)), package: `@ferrum2d/${name}`, version, url: `${release.baseUrl}/${file}` });
  }
  const manifest = { format: "ferrum2d.github-release.bundle", version: 1, release: releaseIdentity(release), source: { commit, dirty: false },
    checks: { build: true, packageCheck: true }, published: false, assets };
  await put(root, "release-manifest.json", manifest); await put(root, "INSTALL.md", "Fixture SDK installation");
  await put(root, "SHA256SUMS", assets.map(asset => `${asset.sha256}  ${asset.file}\n`).join("")); return manifest;
}

test("CLI rejects ambiguous, incomplete or unsupported release requests", () => {
  for (const args of [[], ["prepare"], ["prepare", "--version", "latest"], ["prepare", "--version", version, "--component", "web"],
    ["prepare", "--version", version, "--version", version], ["prepare", "--version", "--plan"],
    ["prepare", "--version", version, "--component", "viewer", "--skip-engine-build"],
    ["assemble", "--engine", "a", "--output", "b"], ["verify"], ["publish"], ["verify", "--bundle", "x", "--upload"]]) {
    assert.throws(() => parseDistributionArgs(args), Error, args.join(" "));
  }
  assert.equal(parseDistributionArgs(["prepare", "--", "--version", version]).component, "all");
  assert.deepEqual(parseDistributionArgs(["assemble", "--engine", "e", "--viewer", "a", "--viewer", "b", "--output", "o"]).viewers, ["a", "b"]);
});

test("Windows pnpm uses its JS entry without shell interpolation", () => {
  const cli = "C:\\Program Files\\pnpm & tool\\pnpm.cjs", args = ["--config", '{"value":"$(example) & space"}'];
  assert.deepEqual(resolvePackageCommand("pnpm.cmd", args, { platform: "win32", env: { npm_execpath: cli }, execPath: "node.exe" }), { executable: "node.exe", args: [cli, ...args] });
  assert.throws(() => resolvePackageCommand("pnpm", [], { platform: "win32", env: { npm_execpath: "npm-cli.js" } }), /through pnpm/);
  assert.deepEqual(resolvePackageCommand("pnpm", args, { platform: "linux" }), { executable: "pnpm", args });
});

for (const [platform, arch] of [["linux", "x64"], ["win32", "x64"], ["darwin", "arm64"]]) {
  test(`native builder stages ${platform}/${arch}, embeds matching Wasm and preserves source versions`, async t => {
    const fixture = await nativeFixture(t, { platform, arch });
    const sourcePath = path.join(fixture.root, "apps/placement-viewer-desktop/src-tauri/tauri.conf.json"), before = await readFile(sourcePath, "utf8");
    const { manifest } = await prepareViewerRelease(fixture.options, fixture.context);
    assert.equal(manifest.platform.arch, arch); assert.equal(manifest.release.version, version);
    assert.equal(manifest.checks.nativeGui, "not-run"); assert.equal(manifest.checks.signing, "not-verified");
    assert.deepEqual(manifest.manualReleaseGate.checks, nativeChecks); assert.equal(manifest.published, false);
    assert.equal(await readFile(sourcePath, "utf8"), before);
    const build = fixture.calls.find(call => call.args.includes("tauri") && call.args.includes("build"));
    assert(build.args.includes("--no-sign")); assert(build.args.includes("--locked"));
    const config = JSON.parse(build.args[build.args.indexOf("--config") + 1]);
    assert.equal(config.version, version); assert(config.bundle.icon.every(file => path.isAbsolute(file)));
    assert.equal(manifest.assets[0].sha256, (await fileRecord(path.join(fixture.output, manifest.assets[0].file))).sha256);
    assert.equal((await readdir(fixture.output)).length, 4);
  });
}

test("plan mode writes nothing and runs no tools", async t => {
  const fixture = await nativeFixture(t);
  const plan = await prepareDistribution({ ...fixture.options, component: "all", plan: true }, fixture.context);
  assert.equal(plan.component, "all"); assert.equal(plan.published, false); assert.equal(fixture.calls.length, 0);
  await assert.rejects(stat(fixture.output), { code: "ENOENT" });
  await assert.rejects(prepareDistribution({ ...fixture.options, component: "all", withUpdater: true }, fixture.context), /combined/);
  assert.equal(fixture.calls.length, 0);
});

for (const [options, pattern] of [[{ stale: true }, /stale output/], [{ wrongWasm: true }, /current engine Wasm/], [{ missingPrerequisite: true }, /prerequisites.*missing/]]) {
  test(`native preparation refuses invalid build: ${Object.keys(options)[0]}`, async t => {
    const fixture = await nativeFixture(t, options);
    await assert.rejects(prepareViewerRelease(fixture.options, fixture.context), pattern);
    await assert.rejects(stat(fixture.output), { code: "ENOENT" });
    if (options.missingPrerequisite) assert.equal(fixture.calls.length, 1);
  });
}

test("all mode checks native prerequisites before expensive engine builds", async t => {
  const fixture = await nativeFixture(t, { missingPrerequisite: true });
  await assert.rejects(prepareDistribution({ ...fixture.options, component: "all" }, fixture.context), /prerequisites/);
  assert.equal(fixture.calls.length, 1);
});

test("existing output is preserved and no commands are executed", async t => {
  const fixture = await nativeFixture(t); await put(fixture.output, "keep.txt", "existing work");
  await assert.rejects(prepareViewerRelease(fixture.options, fixture.context), /already exists/);
  assert.equal(await readFile(path.join(fixture.output, "keep.txt"), "utf8"), "existing work"); assert.equal(fixture.calls.length, 0);
});

test("a failed native command cannot stage a successful candidate", async t => {
  const fixture = await nativeFixture(t), original = fixture.context.run;
  fixture.context.run = (command, args) => {
    if (args.includes("tauri") && args.includes("build")) throw new Error("native compiler failed");
    return original(command, args);
  };
  await assert.rejects(prepareViewerRelease(fixture.options, fixture.context), /native compiler failed/);
  await assert.rejects(stat(fixture.output), { code: "ENOENT" });
});

test("a Rust target for a different OS is rejected before building", async t => {
  const fixture = await nativeFixture(t), original = fixture.context.run;
  fixture.context.run = (command, args) => command === "rustc" ? { stdout: "host: x86_64-pc-windows-msvc\n" } : original(command, args);
  await assert.rejects(prepareViewerRelease(fixture.options, fixture.context), /cross compilation/);
  assert(!fixture.calls.some(call => call.command === "pnpm"));
  await assert.rejects(stat(fixture.output), { code: "ENOENT" });
});

test("assembly preserves engine v1 contract, verifies all files, and rejects tampering", async t => {
  const root = await temporary(t), engine = path.join(root, "engine"), output = path.join(root, "distribution");
  const original = await engineFixture(engine), viewers = [];
  for (const platform of ["linux", "win32", "darwin"]) {
    const fixture = await nativeFixture(t, { platform }); await prepareViewerRelease(fixture.options, fixture.context); viewers.push(fixture.output);
  }
  const { manifest } = await assembleDistribution({ engine, viewers, output });
  assert.equal(manifest.viewerManifests.length, 3); assert.equal(manifest.published, false);
  assert.deepEqual(await validateEngineBundle(output), original);
  assert.deepEqual(await verifyDistribution(output), manifest);
  const checksum = await readFile(path.join(output, "DISTRIBUTION_SHA256SUMS"), "utf8");
  assert(checksum.includes("  distribution-manifest.json\n")); assert(checksum.includes("  DISTRIBUTION_INSTALL.md\n"));
  await put(output, "DISTRIBUTION_INSTALL.md", "altered installation guide");
  await assert.rejects(verifyDistribution(output), /Corrupt release asset/);
});

test("mismatched commit/version, duplicate platform and corrupted input fail before reserving output", async t => {
  const root = await temporary(t), engine = path.join(root, "engine"), output = path.join(root, "distribution"); await engineFixture(engine);
  const fixture = await nativeFixture(t), { manifest } = await prepareViewerRelease(fixture.options, fixture.context);
  const manifestName = (await readdir(fixture.output)).find(name => name.startsWith("viewer-manifest"));
  for (const modify of [m => { m.source.commit = "b".repeat(40); }, m => { m.release.version = "0.1.0-beta.2"; }, m => { m.assets[0].file = "../escape.deb"; }]) {
    const changed = structuredClone(manifest); modify(changed); await put(fixture.output, manifestName, changed);
    await assert.rejects(assembleDistribution({ engine, viewers: [fixture.output], output }));
    await assert.rejects(stat(output), { code: "ENOENT" });
  }
  await put(fixture.output, manifestName, manifest);
  await assert.rejects(assembleDistribution({ engine, viewers: [fixture.output, fixture.output], output }), /Duplicate viewer/);
  await assert.rejects(stat(output), { code: "ENOENT" });
  await put(fixture.output, manifest.assets[0].file, "corrupt installer");
  await assert.rejects(assembleDistribution({ engine, viewers: [fixture.output], output }), /Corrupt/);
});

test("regular files are required, and manifest native GUI claims cannot bypass the manual gate", async t => {
  const fixture = await nativeFixture(t), { manifest } = await prepareViewerRelease(fixture.options, fixture.context);
  const engine = path.join(fixture.root, "engine"), output = path.join(fixture.root, "distribution"); await engineFixture(engine);
  const name = (await readdir(fixture.output)).find(name => name.startsWith("viewer-manifest"));
  manifest.checks.nativeGui = "passed"; await put(fixture.output, name, manifest);
  await assert.rejects(assembleDistribution({ engine, viewers: [fixture.output], output }), /manual native release gate/);
  if (process.platform !== "win32") {
    const file = await put(fixture.root, "original", "contents"); await symlink(file, path.join(fixture.root, "link"));
    await assert.rejects(fileRecord(path.join(fixture.root, "link")), /regular file/);
  }
});

test("dirty source remains visible in the combined manifest", async t => {
  const fixture = await nativeFixture(t), { manifest } = await prepareViewerRelease(fixture.options, fixture.context);
  const name = (await readdir(fixture.output)).find(name => name.startsWith("viewer-manifest"));
  manifest.source.dirty = true; await put(fixture.output, name, manifest);
  const engine = path.join(fixture.root, "engine"), output = path.join(fixture.root, "distribution"); await engineFixture(engine);
  await assembleDistribution({ engine, viewers: [fixture.output], output });
  assert.equal((await readJson(path.join(output, "distribution-manifest.json"))).source.dirty, true);
  assert.equal((await verifyDistribution(output)).source.dirty, true);
});

test("updater signing is explicit, requires keys, and cannot silently use --no-sign", () => {
  assert.throws(() => updaterSettings(true, {}), /requires/);
  assert.throws(() => updaterSettings(true, { FERRUM_UPDATER_PUBLIC_KEY: "invalid", TAURI_SIGNING_PRIVATE_KEY: "fixture" }), /public key/);
  assert.equal(updaterSettings(false, {}), undefined);
  assert.throws(() => parseDistributionArgs(["prepare", "--version", version, "--no-sign", "--with-updater"]), /combined/);
});

for (const platform of ["linux", "win32", "darwin"]) test(`signed updater metadata survives ${platform} staging/assembly and rejects mismatches`, async t => {
  const fixture = await nativeFixture(t, { platform }), run = fixture.context.run;
  const previous = { public: process.env.FERRUM_UPDATER_PUBLIC_KEY, private: process.env.TAURI_SIGNING_PRIVATE_KEY };
  // Tool-output contract fixture only; these are not real signing keys or native signature evidence.
  process.env.FERRUM_UPDATER_PUBLIC_KEY = Buffer.from("untrusted comment: fixture public key\nRWRmaXh0dXJl\n").toString("base64");
  process.env.TAURI_SIGNING_PRIVATE_KEY = "fixture-never-published";
  t.after(() => {
    for (const [name, value] of [["FERRUM_UPDATER_PUBLIC_KEY", previous.public], ["TAURI_SIGNING_PRIVATE_KEY", previous.private]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  fixture.context.run = async (command, args) => {
    const result = await run(command, args);
    if (args.includes("tauri") && args.includes("build")) {
      const target = args[args.indexOf("--target") + 1], os = { linux: "linux", win32: "windows", darwin: "macos" }[platform];
      const subdir = { linux: "appimage", win32: "nsis", darwin: "macos" }[platform], extension = { linux: "AppImage", win32: "exe", darwin: "app.tar.gz" }[platform];
      const name = `Ferrum2D Placement Viewer_${version}_x64.${extension}`;
      const root = path.join(fixture.root, "target", target, "release/bundle", subdir);
      // Windows updater and installer are the same emitted file.
      await put(root, name, `fixture installer ${os}`); await put(root, name + ".sig", Buffer.from("fixture-signature").toString("base64"));
    }
    return result;
  };
  const { manifest } = await prepareViewerRelease({ ...fixture.options, noSign: false, withUpdater: true }, fixture.context);
  assert(manifest.updater); assert(manifest.updater.metadata.file.endsWith("-x64.json"));
  const engine = path.join(fixture.root, "engine"), output = path.join(fixture.root, "assembled"); await engineFixture(engine);
  await assembleDistribution({ engine, viewers: [fixture.output], output }); await verifyDistribution(output);
  assert.equal((await validateEngineBundle(output)).assets.length, 4);
  await put(output, manifest.updater.metadata.file, { version: "0.1.0-beta.99", platforms: {} });
  await assert.rejects(verifyDistribution(output), /Corrupt/);
});
