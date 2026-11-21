import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { githubRelease } from "../../packages/create-game/bin/github-release.mjs";
import { parseDistributionArgs, prepareDistribution } from "../../scripts/package/prepare-distribution.mjs";
import { fileRecord, releaseIdentity } from "../../scripts/package/release-distribution.mjs";

const execute = promisify(execFile);
const release = githubRelease("0.1.0-beta.1");
const commit = "a".repeat(40);
const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ferrum studio SDK "));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function put(name, data) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data));
  }
  const sdk = path.join(root, "packages/ferrum-web"), desktop = "apps/studio-desktop";
  const sourcePackage = { name: "@ferrum2d/ferrum-web", version: "0.1.0", private: true };
  await put("packages/ferrum-web/package.json", sourcePackage);
  await put(desktop + "/package.json", { ...sourcePackage, name: "@ferrum2d/studio-desktop" });
  await put(desktop + "/src-tauri/Cargo.toml", 'version = "0.1.0"');
  await put(desktop + "/src-tauri/tauri.conf.json", { version: "0.1.0", productName: "Ferrum2D Studio", identifier: "com.ferrum2d.studio" });
  await put("staging/package/pkg/ferrum_core_bg.wasm", wasm);
  await put("staging/package/dist/core.js", "export const sdk = true;");
  await put("staging/package/package.json", { ...sourcePackage, version: release.version });
  await put("engine/INSTALL.md", "Install the SDK");
  const bundle = path.join(root, "engine");
  const assets = [];
  for (const name of ["ferrum-web", "studio-kit", "create-game", "agents"]) {
    const file = `ferrum2d-${name}-${release.version}.tgz`;
    if (name === "ferrum-web") {
      await execute("tar", ["-czf", path.join(bundle, file), "-C", path.join(root, "staging"), "package"]);
    } else {
      await put("engine/" + file, name);
    }
    assets.push({ ...await fileRecord(path.join(bundle, file)), package: "@ferrum2d/" + name,
      version: release.version, url: release.baseUrl + "/" + file });
  }
  const manifest = { format: "ferrum2d.github-release.bundle", version: 1, published: false,
    release: releaseIdentity(release), source: { commit, dirty: false }, checks: { build: true, packageCheck: true }, assets };
  await put("engine/release-manifest.json", manifest);
  await put("engine/SHA256SUMS", assets.map(asset => `${asset.sha256}  ${asset.file}\n`).join(""));
  const target = "x86_64-unknown-linux-gnu", commands = [];
  const run = async (cmd, args, options) => {
    commands.push([cmd, ...args].join(" "));
    switch (cmd) {
      case "git": return { stdout: args[0] === "rev-parse" ? commit : "" };
      case "pkg-config": return { stdout: "" };
      case "rustc": return { stdout: "host: " + target };
      case "cargo": return { stdout: JSON.stringify({ target_directory: path.join(root, "target") }) };
      case "tar": return execute(cmd, args, { cwd: options.cwd });
      case "pnpm":
        if (args.includes("icon")) {
          const icons = args[args.indexOf("--output") + 1];
          await mkdir(icons);
          for (const name of ["32x32.png", "128x128.png", "128x128@2x.png", "icon.ico", "icon.icns"]) await writeFile(path.join(icons, name), "icon");
        } else if (args.includes("tauri") && args.includes("build")) {
          assert.equal(await readFile(path.join(sdk, "dist/core.js"), "utf8"), "export const sdk = true;");
          assert.deepEqual(JSON.parse(await readFile(path.join(sdk, "package.json"), "utf8")), sourcePackage);
          await put("apps/studio/dist/assets/core.wasm", await readFile(path.join(sdk, "pkg/ferrum_core_bg.wasm")));
          await put("apps/studio/dist/index.html", "<canvas></canvas>");
          await put(`target/${target}/release/bundle/deb/studio_${release.version}_amd64.deb`, "test installer");
        } else throw new Error("Unexpected SDK rebuild: " + args.join(" "));
        return { stdout: "" };
      default: throw new Error("Unexpected tool: " + cmd);
    }
  };
  const options = parseDistributionArgs(["prepare", "--component", "studio", "--version", release.version, "--engine-bundle", bundle,
    "--no-sign", "--output", path.join(root, "output")]);
  return { sdk, put, commands, manifest, options, run: () => prepareDistribution(options, { root, platform: "linux", arch: "x64", run }) };
}

test("Studio embeds only the built SDK runtime from the checked release archive and cleans up staging", async t => {
  const f = await fixture(t);
  const { manifest } = await f.run();
  assert.equal(manifest.runtime.tarballSha256, f.manifest.assets[0].sha256);
  assert.equal(manifest.runtime.wasmSha256, (await fileRecord(path.join(f.sdk, "../../apps/studio/dist/assets/core.wasm"))).sha256);
  assert(!f.commands.some(cmd => cmd.includes("build:wasm")));
  for (const dir of ["dist", "pkg"]) await assert.rejects(stat(path.join(f.sdk, dir)), { code: "ENOENT" });
});

test("SDK staging rejects damaged, unverified and other-commit inputs and preserves existing build files", async t => {
  const f = await fixture(t);
  for (const manifest of [
    { ...f.manifest, source: { commit: "b".repeat(40), dirty: false } },
    { ...f.manifest, source: { commit, dirty: true } },
    { ...f.manifest, checks: { build: true, packageCheck: false } },
  ]) {
    await f.put("engine/release-manifest.json", manifest);
    await assert.rejects(f.run(), /checked SDK bundle/);
  }
  await f.put("engine/release-manifest.json", f.manifest);
  await f.put("packages/ferrum-web/dist/preserve.txt", "local build");
  await assert.rejects(f.run(), { code: "EEXIST" });
  assert.equal(await readFile(path.join(f.sdk, "dist/preserve.txt"), "utf8"), "local build");
  await assert.rejects(stat(path.join(f.sdk, "pkg")), { code: "ENOENT" });
  await f.put("engine/" + f.manifest.assets[0].file, "corrupt");
  await assert.rejects(f.run(), /Corrupt release asset/);
  assert(!f.commands.some(cmd => cmd.startsWith("pnpm ")));
});

test("existing engine bundles are only accepted for Studio builds", () => {
  assert.throws(() => parseDistributionArgs(["prepare", "--version", release.version, "--engine-bundle", "sdk"]), /requires --component studio/);
});
