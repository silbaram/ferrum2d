import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { githubRelease } from "../../packages/create-game/bin/github-release.mjs";
import { attachDraftRelease, draftReleaseApi } from "../../scripts/package/attach-draft-release.mjs";
import { parseDistributionArgs, prepareDistribution } from "../../scripts/package/prepare-distribution.mjs";
import { PREVIOUS_STUDIO_DEB_PACKAGES, prepareStudioRelease, STUDIO_DEB_PACKAGE, studioDebControl } from "../../scripts/package/prepare-studio-release.mjs";
import { assembleDistribution, fileRecord, nativeChecks, readJson, releaseIdentity, studioManifestName, validateEngineBundle, verifyDistribution } from "../../scripts/package/release-distribution.mjs";
import { resolvePackageCommand } from "../../scripts/package/release-command.mjs";
import { updaterSettings } from "../../scripts/package/studio-updater.mjs";
import { fakeDebControl, fakeDebPayload, fakeDpkgDeb, TAURI_DEB_CONTROL } from "./fake-dpkg-deb.mjs";

const version = "0.1.0-beta.1", release = githubRelease(version), commit = "a".repeat(40);
test("Studio uses its own desktop installation identity", async () => {
  const config = await readJson(new URL("../../apps/studio-desktop/src-tauri/tauri.conf.json", import.meta.url));
  assert.equal(config.productName, "Ferrum2D Studio");
  assert.equal(config.identifier, "com.ferrum2d.studio");
  assert.equal(config.bundle.windows?.wix?.upgradeCode, undefined);
});
async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ferrum distribution & "));
  t.after(() => rm(root, { recursive: true, force: true })); return root;
}
async function put(root, name, value) {
  const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === "object" && !Buffer.isBuffer(value) ? JSON.stringify(value, null, 2) : value); return file;
}

// Simulated tool output tests artifact contracts; it is not native installer/GUI evidence.
async function nativeFixture(t, { platform = "linux", arch = "x64", stale = false, wrongWasm = false, missingPrerequisite = false,
  productName = "Ferrum2D Studio", cachedLegacy = false, ambiguousFresh = false } = {}) {
  const root = await temporary(t), calls = [], output = path.join(root, "candidate");
  const names = { linux: "linux", win32: "windows", darwin: "macos" }, bundles = { linux: "deb", win32: "nsis", darwin: "dmg" }, extensions = { linux: "deb", win32: "exe", darwin: "dmg" };
  const target = platform === "linux" ? "x86_64-unknown-linux-gnu" : platform === "win32" ? "x86_64-pc-windows-msvc" : arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  const installer = path.join(root, "target", target, "release/bundle", bundles[platform], `${productName}_${version}_${arch}.${extensions[platform]}`);
  await put(root, "packages/ferrum-web/package.json", { name: "@ferrum2d/ferrum-web", version: "0.1.0", private: true });
  await put(root, "apps/studio-desktop/package.json", { name: "@ferrum2d/studio-desktop", version: "0.1.0", private: true });
  await put(root, "apps/studio-desktop/src-tauri/tauri.conf.json", { version: "0.1.0", productName, identifier: "com.ferrum2d.studio" });
  await put(root, "apps/studio-desktop/src-tauri/Cargo.toml", '[package]\nversion = "0.1.0"\n');
  await put(root, "apps/studio-desktop/app-icon.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>');
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  await put(root, "packages/ferrum-web/pkg/ferrum_core_bg.wasm", wasm);
  await put(root, "apps/studio/dist/index.html", "<canvas></canvas>");
  await put(root, "apps/studio/dist/placement-scenes.json", '{"version":1,"scenes":[],"truncated":false,"diagnostics":[]}');
  await put(root, "apps/studio/dist/assets/core.wasm", wrongWasm ? "old wasm" : wasm);
  if (stale) { await put(root, path.relative(root, installer), "old installer"); await utimes(installer, 0, 0); }
  const legacyInstaller = installer.replace(productName, "Cached Other Product");
  if (cachedLegacy) await put(root, path.relative(root, legacyInstaller), "cached legacy installer");
  const run = async (command, args) => {
    calls.push({ command, args }); let stdout = "";
    if (command === "pkg-config" && missingPrerequisite) throw new Error("spawn pkg-config ENOENT");
    if (command === "rustc") stdout = `rustc 1.90.0\nhost: ${target}\n`;
    if (command === "git") stdout = args[0] === "rev-parse" ? `${commit}\n` : "";
    if (command === "cargo") stdout = JSON.stringify({ target_directory: path.join(root, "target") });
    if (command === "dpkg-deb") stdout = await fakeDpkgDeb(args);
    if (command === "pnpm" && args.includes("icon")) {
      const dir = args[args.indexOf("--output") + 1];
      for (const file of ["32x32.png", "128x128.png", "128x128@2x.png", "icon.ico", "icon.icns"]) await put(dir, file, "fixture icon");
    }
    if (command === "pnpm" && args.includes("tauri") && args.includes("build") && !stale) {
      await put(root, path.relative(root, installer), `fixture installer ${names[platform]}`);
      if (ambiguousFresh) await put(root, path.relative(root, installer).replace(productName, "Unexpected Product"), "ambiguous fresh installer");
      // A cached beta.10 must not be selected for beta.1.
      await put(root, path.relative(root, installer).replace(version, "0.1.0-beta.10"), "unrelated cached installer");
      await put(root, path.relative(root, installer).replace(version, "10.1.0-beta.1"), "unrelated major version");
    }
    return { stdout, stderr: "" };
  };
  return { root, output, calls, legacyInstaller, context: { root, platform, arch, run }, options: { version, repository: release.repository, output, quiet: true, noSign: true } };
}

async function engineFixture(root) {
  await mkdir(root, { recursive: true }); const assets = [];
  for (const name of ["ferrum-web", "studio-kit", "create-game", "agents"]) {
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
    ["prepare", "--version", version, "--component", "studio", "--skip-engine-build"],
    ["assemble", "--engine", "a", "--output", "b"], ["verify"], ["publish"], ["verify", "--bundle", "x", "--upload"]]) {
    assert.throws(() => parseDistributionArgs(args), Error, args.join(" "));
  }
  assert.equal(parseDistributionArgs(["prepare", "--", "--version", version]).component, "all");
  assert.deepEqual(parseDistributionArgs(["assemble", "--engine", "e", "--studio", "a", "--studio", "b", "--output", "o"]).studios, ["a", "b"]);
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
    const sourcePath = path.join(fixture.root, "apps/studio-desktop/src-tauri/tauri.conf.json"), before = await readFile(sourcePath, "utf8");
    const { manifest } = await prepareStudioRelease(fixture.options, fixture.context);
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
    const repacked = fixture.calls.filter(call => call.command === "dpkg-deb" && call.args[0] !== "--version");
    if (platform === "linux") {
      const control = fakeDebControl(await readFile(path.join(fixture.output, manifest.assets[0].file), "utf8"));
      assert.match(control, new RegExp(`^Package: ${STUDIO_DEB_PACKAGE}$`, "m"));
      assert.match(control, /^Replaces: ferrum2-d-studio$/m);
      assert.match(control, /^Conflicts: ferrum2-d-studio$/m);
      assert.equal(repacked.length, 2);
    } else {
      assert.equal(repacked.length, 0);
    }
  });
}

test("Studio Debian control keeps fields and only renames the Tauri package", () => {
  const control = studioDebControl(TAURI_DEB_CONTROL);
  assert.equal(control, TAURI_DEB_CONTROL.replace("Package: ferrum2-d-studio", `Package: ${STUDIO_DEB_PACKAGE}`) +
    `Replaces: ${PREVIOUS_STUDIO_DEB_PACKAGES.join(", ")}\nConflicts: ${PREVIOUS_STUDIO_DEB_PACKAGES.join(", ")}\n`);
  assert.match(control, /^Description: Ferrum2D Studio\n multi-line description$/m);
  assert.throws(() => studioDebControl("Version: 0.1.0\n"), /no Package field/);
  assert.throws(() => studioDebControl(`${TAURI_DEB_CONTROL}Replaces: other\n`), /already declares/);
});

test("plan mode writes nothing and runs no tools", async t => {
  const fixture = await nativeFixture(t);
  const plan = await prepareDistribution({ ...fixture.options, component: "all", plan: true }, fixture.context);
  assert.equal(plan.component, "all"); assert.equal(plan.published, false); assert.equal(fixture.calls.length, 0);
  await assert.rejects(stat(fixture.output), { code: "ENOENT" });
  await assert.rejects(prepareDistribution({ ...fixture.options, component: "all", withUpdater: true }, fixture.context), /combined/);
  assert.equal(fixture.calls.length, 0);
});

test("release preparation rejects an incorrect Studio identity before tools or output", async t => {
  const fixture = await nativeFixture(t, { productName: "Unexpected Product" });
  for (const component of ["studio", "all"]) for (const plan of [true, false]) {
    await assert.rejects(prepareDistribution({ ...fixture.options, component, plan, noSign: false, withUpdater: true }, fixture.context), /Studio releases require/);
  }
  await assert.rejects(prepareStudioRelease(fixture.options, fixture.context), /Studio releases require/);
  assert.equal(fixture.calls.length, 0);
  await assert.rejects(stat(fixture.output), { code: "ENOENT" });
});

for (const platform of ["linux", "win32", "darwin"]) test(`cached legacy installer does not block fresh Studio staging on ${platform}`, async t => {
  const fixture = await nativeFixture(t, { platform, cachedLegacy: true });
  const before = (await stat(fixture.legacyInstaller)).mtimeMs;
  const { manifest } = await prepareStudioRelease(fixture.options, fixture.context);
  assert.equal(await readFile(fixture.legacyInstaller, "utf8"), "cached legacy installer");
  assert.equal((await stat(fixture.legacyInstaller)).mtimeMs, before);
  const staged = await readFile(path.join(fixture.output, manifest.assets[0].file), "utf8");
  // Linux stages the fresh .deb after renaming its Debian package.
  assert.equal(platform === "linux" ? fakeDebPayload(staged) : staged, `fixture installer ${manifest.platform.os}`);
});

test("ambiguous fresh installers are rejected without staging", async t => {
  const fixture = await nativeFixture(t, { ambiguousFresh: true });
  await assert.rejects(prepareStudioRelease(fixture.options, fixture.context), /exactly one.*installer/);
  await assert.rejects(stat(fixture.output), { code: "ENOENT" });
});

for (const [options, pattern] of [[{ stale: true }, /stale output/], [{ wrongWasm: true }, /current engine Wasm/], [{ missingPrerequisite: true }, /prerequisites.*missing/]]) {
  test(`native preparation refuses invalid build: ${Object.keys(options)[0]}`, async t => {
    const fixture = await nativeFixture(t, options);
    await assert.rejects(prepareStudioRelease(fixture.options, fixture.context), pattern);
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
  await assert.rejects(prepareStudioRelease(fixture.options, fixture.context), /already exists/);
  assert.equal(await readFile(path.join(fixture.output, "keep.txt"), "utf8"), "existing work"); assert.equal(fixture.calls.length, 0);
});

test("a failed native command cannot stage a successful candidate", async t => {
  const fixture = await nativeFixture(t), original = fixture.context.run;
  fixture.context.run = (command, args) => {
    if (args.includes("tauri") && args.includes("build")) throw new Error("native compiler failed");
    return original(command, args);
  };
  await assert.rejects(prepareStudioRelease(fixture.options, fixture.context), /native compiler failed/);
  await assert.rejects(stat(fixture.output), { code: "ENOENT" });
});

test("a Rust target for a different OS is rejected before building", async t => {
  const fixture = await nativeFixture(t), original = fixture.context.run;
  fixture.context.run = (command, args) => command === "rustc" ? { stdout: "host: x86_64-pc-windows-msvc\n" } : original(command, args);
  await assert.rejects(prepareStudioRelease(fixture.options, fixture.context), /cross compilation/);
  assert(!fixture.calls.some(call => call.command === "pnpm"));
  await assert.rejects(stat(fixture.output), { code: "ENOENT" });
});

async function assembledFixture(t, { platforms = ["linux", "win32", "darwin"], dirty = false,
  studioRuntimeOverrides = () => ({}) } = {}) {
  const root = await temporary(t), engine = path.join(root, "engine"), output = path.join(root, "distribution");
  const original = await engineFixture(engine), studios = [];
  if (dirty) {
    original.source.dirty = true;
    await put(engine, "release-manifest.json", original);
  }
  const sdk = original.assets.find(asset => asset.package === "@ferrum2d/ferrum-web");
  for (const platform of platforms) {
    const fixture = await nativeFixture(t, { platform });
    const { manifest } = await prepareStudioRelease(fixture.options, fixture.context);
    manifest.runtime = { ...manifest.runtime, tarballSha256: sdk.sha256, ...studioRuntimeOverrides(platform) };
    await put(fixture.output, studioManifestName(manifest.platform.os, manifest.platform.arch), manifest);
    studios.push(fixture.output);
  }
  const { manifest } = await assembleDistribution({ engine, studios, output });
  return { original, manifest, output };
}

test("assembly preserves engine v1 contract, verifies all files, and rejects tampering", async t => {
  const { original, manifest, output } = await assembledFixture(t);
  assert.equal(manifest.studioManifests.length, 3); assert.equal(manifest.published, false);
  assert.deepEqual(await validateEngineBundle(output), original);
  assert.deepEqual(await verifyDistribution(output), manifest);
  const checksum = await readFile(path.join(output, "DISTRIBUTION_SHA256SUMS"), "utf8");
  assert(checksum.includes("  distribution-manifest.json\n")); assert(checksum.includes("  DISTRIBUTION_INSTALL.md\n"));
  await put(output, "DISTRIBUTION_INSTALL.md", "altered installation guide");
  await assert.rejects(verifyDistribution(output), /Corrupt release asset/);
});

function draftRemote() {
  const draft = { id: 515, draft: true, prerelease: true, tag_name: release.tag, target_commitish: commit,
    html_url: `https://github.com/${release.repository}/releases/tag/${release.tag}` };
  const state = { release: null, assets: [], created: [], uploads: [] };
  const github = {
    async checkTag(tag, sha) {
      assert.equal(tag, release.tag);
      assert.equal(sha, commit);
    },
    async findRelease(tag) {
      assert.equal(tag, release.tag);
      return state.release;
    },
    async createDraft({ tag, version: requestedVersion, commit: sha }) {
      state.created.push(tag);
      assert.deepEqual([tag, requestedVersion, sha], [release.tag, version, commit]);
      assert.equal(state.release, null);
      state.release = draft;
      return draft;
    },
    async listAssets(id) {
      assert.equal(id, draft.id);
      return structuredClone(state.assets);
    },
    async uploadAsset(id, record, filePath) {
      assert.equal(id, draft.id);
      const file = await fileRecord(filePath);
      assert.deepEqual([record.file, record.bytes, record.sha256], [file.file, file.bytes, file.sha256]);
      assert(!state.assets.some(asset => asset.name === file.file));
      state.uploads.push(file.file);
      const asset = { name: file.file, state: "uploaded", size: file.bytes, digest: `sha256:${file.sha256}` };
      state.assets.push(asset);
      return asset;
    },
  };
  return { draft, state, github };
}

function attachFixture(bundle, github, overrides = {}) {
  return attachDraftRelease({ bundle, version, repository: release.repository, commit, github, ...overrides });
}

test("draft release resumes a partial upload, then reuses every verified file", async t => {
  const { output } = await assembledFixture(t);
  const expected = (await readdir(output)).sort();
  const { github, state } = draftRemote();
  const upload = github.uploadAsset;
  github.uploadAsset = (...args) => {
    if (state.uploads.length === 2) throw new Error("interrupted upload");
    return upload(...args);
  };
  await assert.rejects(attachFixture(output, github), /interrupted upload/);
  assert.equal(state.uploads.length, 2);
  github.uploadAsset = upload;
  await attachFixture(output, github);
  assert.deepEqual([...state.uploads].sort(), expected);
  await attachFixture(output, github);
  assert.equal(state.uploads.length, expected.length);
  assert.deepEqual(state.created, [release.tag]);
});

test("draft attachment refuses published releases, wrong targets, and conflicting remote files before uploading", async t => {
  const { output } = await assembledFixture(t);
  const file = await fileRecord(path.join(output, "INSTALL.md"));
  const asset = { name: file.file, state: "uploaded", size: file.bytes, digest: `sha256:${file.sha256}` };
  for (const [releaseChanges, assets] of [
    [{ draft: false }, []],
    [{ target_commitish: "b".repeat(40) }, []],
    [{}, [{ ...asset, digest: `sha256:${"0".repeat(64)}` }]],
    [{}, [{ ...asset, size: file.bytes + 1 }]],
    [{}, [{ ...asset, name: "unrelated.zip" }]],
  ]) {
    const { github, draft, state } = draftRemote();
    state.release = { ...draft, ...releaseChanges };
    state.assets = assets;
    await assert.rejects(attachFixture(output, github));
    assert.deepEqual(state.created, []);
    assert.deepEqual(state.uploads, []);
  }
  const { github, state } = draftRemote();
  github.checkTag = () => { throw new Error("tag points to a different commit"); };
  await assert.rejects(attachFixture(output, github), /different commit/);
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.uploads, []);
});

test("draft release requires the requested clean source and verified installers for all three operating systems", async t => {
  const complete = await assembledFixture(t);
  const incomplete = await assembledFixture(t, { platforms: ["linux", "win32"] });
  const dirty = await assembledFixture(t, { dirty: true });
  for (const [fixture, overrides] of [
    [complete, { version: "0.1.0-beta.2" }],
    [complete, { repository: "other/ferrum2d" }],
    [complete, { commit: "b".repeat(40) }],
    [incomplete, {}],
    [dirty, {}],
  ]) {
    const { github, state } = draftRemote();
    github.checkTag = async () => {};
    github.findRelease = async () => null;
    await assert.rejects(attachFixture(fixture.output, github, overrides));
    assert.deepEqual(state.created, []);
    assert.deepEqual(state.uploads, []);
  }
  const { github, state } = draftRemote();
  const installer = complete.manifest.files.find(record => record.file.endsWith(".dmg"));
  await put(complete.output, installer.file, "damaged after assembly");
  await assert.rejects(attachFixture(complete.output, github), /Corrupt release asset/);
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.uploads, []);
});

test("draft release detects an asset missing from the final remote inventory", async t => {
  const { output } = await assembledFixture(t);
  const { github, state } = draftRemote();
  const list = github.listAssets;
  github.listAssets = async id => (await list(id)).filter(asset => asset.name !== "INSTALL.md");
  await assert.rejects(attachFixture(output, github));
  assert(state.uploads.includes("INSTALL.md"));
});

test("draft release requires all installers to reference the released SDK tarball and the same embedded Wasm", async t => {
  for (const overrides of [
    () => ({ tarballSha256: "1".repeat(64) }),
    platform => platform === "win32" ? { tarballSha256: undefined } : {},
    platform => platform === "darwin" ? { wasmSha256: "2".repeat(64) } : {},
  ]) {
    const { output } = await assembledFixture(t, { studioRuntimeOverrides: overrides });
    const { github, state } = draftRemote();
    await assert.rejects(attachFixture(output, github));
    assert.deepEqual(state.created, []);
    assert.deepEqual(state.uploads, []);
  }
});

test("draft API resolves annotated tags to the exact commit and propagates GitHub permission errors", async () => {
  const repo = { owner: "example", repo: "ferrum2d" };
  const git = {}, api = draftReleaseApi({ rest: { git } }, repo, release.tag, commit);
  for (const status of [404, 403]) {
    const error = Object.assign(new Error("git ref request failed"), { status });
    git.getRef = async request => {
      assert.deepEqual(request, { ...repo, ref: `tags/${release.tag}` });
      throw error;
    };
    if (status === 404) await api.checkTag();
    else await assert.rejects(api.checkTag(), failure => failure === error);
  }
  const outer = "c".repeat(40), inner = "d".repeat(40);
  git.getRef = async () => ({ data: { object: { type: "tag", sha: outer } } });
  const visited = [];
  let taggedCommit = commit;
  git.getTag = async ({ tag_sha }) => {
    visited.push(tag_sha);
    const object = tag_sha === outer ? { type: "tag", sha: inner } : { type: "commit", sha: taggedCommit };
    return { data: { object } };
  };
  await api.checkTag();
  assert.deepEqual(visited, [outer, inner]);
  taggedCommit = "e".repeat(40);
  await assert.rejects(api.checkTag(), /different object/);
});

test("draft API creates a prerelease at the build commit and checks its visibility before uploading bytes", async t => {
  const repo = { owner: "example", repo: "ferrum2d" };
  const { draft } = draftRemote();
  const requests = [], uploads = [];
  const repos = {
    async createRelease(request) { requests.push(request); return { data: draft }; },
    async getRelease(request) {
      assert.deepEqual(request, { ...repo, release_id: draft.id });
      return { data: draft };
    },
    async uploadReleaseAsset(request) { uploads.push(request); return { data: {} }; },
  };
  const api = draftReleaseApi({ rest: { repos } }, repo, release.tag, commit);
  assert.equal(await api.createDraft({ version }), draft);
  const [request] = requests;
  assert.equal(request.tag_name, release.tag);
  assert.equal(request.target_commitish, commit);
  assert.equal(request.draft, true);
  assert.equal(request.prerelease, true);

  const payload = Buffer.from([0, 128, 255]);
  const file = await put(await temporary(t), "installer.exe", payload);
  const record = await fileRecord(file);
  await api.uploadAsset(draft.id, record, file);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].name, record.file);
  assert.equal(uploads[0].release_id, draft.id);
  assert.deepEqual(uploads[0].data, payload);

  draft.draft = false;
  await assert.rejects(api.uploadAsset(draft.id, record, file), /draft prerelease/);
  assert.equal(uploads.length, 1);
});

test("mismatched commit/version, duplicate platform and corrupted input fail before reserving output", async t => {
  const root = await temporary(t), engine = path.join(root, "engine"), output = path.join(root, "distribution"); await engineFixture(engine);
  const fixture = await nativeFixture(t), { manifest } = await prepareStudioRelease(fixture.options, fixture.context);
  const manifestName = (await readdir(fixture.output)).find(name => name.startsWith("studio-manifest"));
  for (const modify of [m => { m.source.commit = "b".repeat(40); }, m => { m.release.version = "0.1.0-beta.2"; }, m => { m.assets[0].file = "../escape.deb"; }]) {
    const changed = structuredClone(manifest); modify(changed); await put(fixture.output, manifestName, changed);
    await assert.rejects(assembleDistribution({ engine, studios: [fixture.output], output }));
    await assert.rejects(stat(output), { code: "ENOENT" });
  }
  await put(fixture.output, manifestName, manifest);
  await assert.rejects(assembleDistribution({ engine, studios: [fixture.output, fixture.output], output }), /Duplicate studio/);
  await assert.rejects(stat(output), { code: "ENOENT" });
  await put(fixture.output, manifest.assets[0].file, "corrupt installer");
  await assert.rejects(assembleDistribution({ engine, studios: [fixture.output], output }), /Corrupt/);
});

test("regular files are required, and manifest native GUI claims cannot bypass the manual gate", async t => {
  const fixture = await nativeFixture(t), { manifest } = await prepareStudioRelease(fixture.options, fixture.context);
  const engine = path.join(fixture.root, "engine"), output = path.join(fixture.root, "distribution"); await engineFixture(engine);
  const name = (await readdir(fixture.output)).find(name => name.startsWith("studio-manifest"));
  manifest.checks.nativeGui = "passed"; await put(fixture.output, name, manifest);
  await assert.rejects(assembleDistribution({ engine, studios: [fixture.output], output }), /manual native release gate/);
  if (process.platform !== "win32") {
    const file = await put(fixture.root, "original", "contents"); await symlink(file, path.join(fixture.root, "link"));
    await assert.rejects(fileRecord(path.join(fixture.root, "link")), /regular file/);
  }
});

test("dirty source remains visible in the combined manifest", async t => {
  const fixture = await nativeFixture(t), { manifest } = await prepareStudioRelease(fixture.options, fixture.context);
  const name = (await readdir(fixture.output)).find(name => name.startsWith("studio-manifest"));
  manifest.source.dirty = true; await put(fixture.output, name, manifest);
  const engine = path.join(fixture.root, "engine"), output = path.join(fixture.root, "distribution"); await engineFixture(engine);
  await assembleDistribution({ engine, studios: [fixture.output], output });
  assert.equal((await readJson(path.join(output, "distribution-manifest.json"))).source.dirty, true);
  assert.equal((await verifyDistribution(output)).source.dirty, true);
});

test("updater signing is explicit, requires keys, and cannot silently use --no-sign", () => {
  assert.throws(() => updaterSettings(true, {}), /requires/);
  assert.throws(() => updaterSettings(true, { FERRUM_UPDATER_PUBLIC_KEY: "invalid", TAURI_SIGNING_PRIVATE_KEY: "fixture" }), /public key/);
  assert.equal(updaterSettings(false, {}), undefined);
  assert.throws(() => parseDistributionArgs(["prepare", "--version", version, "--no-sign", "--with-updater"]), /combined/);
});

for (const platform of ["linux", "win32", "darwin"]) test(`Studio signed updater metadata survives ${platform} staging/assembly and rejects mismatches`, async t => {
  // Studio signs and discovers the same studio-updater channel on every OS.
  const productName = "Ferrum2D Studio";
  const fixture = await nativeFixture(t, { platform, productName }), run = fixture.context.run;
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
      const name = `${productName}_${version}_x64.${extension}`;
      const root = path.join(fixture.root, "target", target, "release/bundle", subdir);
      // Windows updater and installer are the same emitted file.
      await put(root, name, `fixture installer ${os}`); await put(root, name + ".sig", Buffer.from("fixture-signature").toString("base64"));
    }
    return result;
  };
  const { manifest } = await prepareStudioRelease({ ...fixture.options, noSign: false, withUpdater: true }, fixture.context);
  assert(manifest.updater); assert.match(manifest.updater.metadata.file, /^studio-updater-(linux|windows|macos)-x64\.json$/);
  const engine = path.join(fixture.root, "engine"), output = path.join(fixture.root, "assembled"); await engineFixture(engine);
  await assembleDistribution({ engine, studios: [fixture.output], output }); await verifyDistribution(output);
  assert.equal((await validateEngineBundle(output)).assets.length, 4);
  await put(output, manifest.updater.metadata.file, { version: "0.1.0-beta.99", platforms: {} });
  await assert.rejects(verifyDistribution(output), /Corrupt/);
});
