import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { githubRelease } from "../../packages/create-game/bin/github-release.mjs";
import { applyProjectUpdate, checkProject, compareReleaseVersions, inspectProject, installProject, selectRelease, updateManifest } from "../../packages/create-game/bin/update-game.mjs";
import { packageFileHashes, sha256 } from "../../packages/create-game/bin/update-integrity.mjs";

const old = githubRelease("0.1.0-beta.9"), latest = githubRelease("0.1.0-beta.10");
const packageName = "@ferrum2d/ferrum-web";
test("updater bin runs through the symlink installed by npm/pnpm", async t => {
  if (process.platform === "win32") { t.skip("Windows npm uses a command shim rather than this POSIX symlink"); return; }
  const root = await mkdtemp(path.join(os.tmpdir(), "ferrum-update-bin-")); t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "ferrum-update-game");
  await symlink(fileURLToPath(new URL("../../packages/create-game/bin/update-game.mjs", import.meta.url)), bin);
  const { stdout } = await promisify(execFile)(process.execPath, [bin, "--help"]); assert.match(stdout, /--apply/);
});
export function archive(files) {
  const records = [];
  for (const [name, value] of Object.entries(files)) {
    const body = Buffer.from(value), header = Buffer.alloc(512);
    header.write(name); header.write("0000644\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116);
    header.write(body.length.toString(8).padStart(11, "0") + "\0", 124); header.write("00000000000\0", 136);
    header.fill(32, 148, 156); header[156] = 48; header.write("ustar\0", 257); header.write("00", 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0); header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
    records.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...records, Buffer.alloc(1024)]));
}
function releaseRow(release) {
  return { draft: false, tag_name: release.tag, assets: ["ferrum-web", "authoring-viewer", "create-game", "agents"].map(name => ({ state: "uploaded", name: `ferrum2d-${name}-${release.version}.tgz` })).concat({ state: "uploaded", name: "release-manifest.json" }) };
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ferrum-update & ")); t.after(() => rm(root, { recursive: true, force: true }));
  const files = new Map(), archives = new Map();
  for (const release of [old, latest]) {
    const pkg = JSON.stringify({ name: packageName, version: release.version, main: "index.js", scripts: { install: "node -e \"require('fs').writeFileSync('LIFECYCLE_RAN','bad')\"" } });
    const source = { "package/package.json": pkg, "package/index.js": `module.exports = '${release.version}';\n` };
    const bytes = archive(source), file = path.basename(release.runtime);
    files.set(release.runtime, bytes); archives.set(release.version, source);
    files.set(release.baseUrl + "/release-manifest.json", Buffer.from(JSON.stringify({ format: "ferrum2d.github-release.bundle", version: 1,
      release: { repository: release.repository, version: release.version, tag: release.tag },
      assets: [{ package: packageName, version: release.version, file, url: release.runtime, bytes: bytes.length, sha256: sha256(bytes) }] })));
  }
  const request = async url => {
    if (String(url).startsWith("https://api.github.com/")) return new Response(JSON.stringify([releaseRow(old), releaseRow(latest)]));
    return new Response(files.get(String(url)), { status: files.has(String(url)) ? 200 : 404 });
  };
  const metadata = { name: "my-game", version: "1.0.0", dependencies: { [packageName]: old.runtime },
    ferrumGithubRelease: { repository: old.repository, version: old.version, tag: old.tag } };
  await writeFile(path.join(root, "package.json"), JSON.stringify(metadata, null, 2) + "\n");
  const installFiles = async version => {
    for (const [file, value] of Object.entries(archives.get(version))) {
      const target = path.join(root, "node_modules", packageName, file.slice(8)); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, value);
    }
  };
  await installFiles(old.version);
  return { root, metadata, request, files, archives, installFiles };
}

test("numeric beta ordering excludes incomplete/draft releases and validates malformed versions", () => {
  assert(compareReleaseVersions(latest.version, old.version) > 0); assert(compareReleaseVersions("0.1.0", latest.version) > 0);
  for (const value of ["latest", "0.1.0-beta.01", "0.1.0-beta.1+build", "9007199254740992.0.0"]) assert.throws(() => compareReleaseVersions(value, value));
  const draft = { ...releaseRow(githubRelease("0.1.0-beta.99")), draft: true };
  assert.equal(selectRelease([draft, releaseRow(githubRelease("0.1.0-beta.9007199254740992")), releaseRow(old), releaseRow(latest), { tag_name: latest.tag, assets: {} }], old.repository).version, latest.version);
  assert.equal(selectRelease([{ ...releaseRow(latest), draft: undefined }], old.repository), undefined);
});
test("checks scan later pages, remain read-only, and reject source/workspace/custom manager projects", async t => {
  const f = await fixture(t), before = await readFile(path.join(f.root, "package.json"));
  let pages = 0;
  const state = await checkProject(f.root, { fetch: async () => new Response(JSON.stringify(++pages === 1 ? Array.from({ length: 100 }, () => releaseRow(old)) : [releaseRow(latest)])) });
  assert.equal(state.release.version, latest.version); assert.equal(pages, 2); assert.deepEqual(await readFile(path.join(f.root, "package.json")), before);
  for (const change of [{ workspaces: ["*"] }, { dependencies: { [packageName]: "workspace:*" } }, { packageManager: "yarn@1" }, { dependencies: { [packageName]: "https://example.test/custom.tgz" } }]) {
    await writeFile(path.join(f.root, "package.json"), JSON.stringify({ ...f.metadata, ...change })); await assert.rejects(inspectProject(f.root));
  }
});
test("manifest update keeps unrelated scripts and all Ferrum companions aligned; custom hooks require manual action", () => {
  const value = updateManifest({ dependencies: { [packageName]: old.runtime, other: "1.2.3" }, devDependencies: { "@ferrum2d/authoring-viewer": old.viewer }, scripts: { test: "custom" } }, latest);
  assert.equal(value.dependencies.other, "1.2.3"); assert.equal(value.devDependencies["@ferrum2d/authoring-viewer"], latest.viewer); assert.equal(value.scripts.test, "custom");
  assert.throws(() => updateManifest({ scripts: { "ferrum:agents": "echo customized" } }, latest), /manual update/);
});
test("direct official SDK URL installs work without generator metadata; local shorthand remains untouched", async t => {
  const f = await fixture(t), source = structuredClone(f.metadata); delete source.ferrumGithubRelease;
  await writeFile(path.join(f.root, "package.json"), JSON.stringify(source));
  const state = await checkProject(f.root, { fetch: f.request }); assert.equal(state.available, true); assert.equal(state.currentVersion, old.version);
  for (const spec of ["../local-engine", "owner/repository", "git://example.test/engine", "ssh://example.test/engine"]) {
    await writeFile(path.join(f.root, "package.json"), JSON.stringify({ ...source, dependencies: { [packageName]: spec } }));
    await assert.rejects(inspectProject(f.root), /source-managed/);
  }
});
test("archive traversal, duplicates, damaged headers and wrong package identities cannot reach installation", () => {
  const metadata = JSON.stringify({ name: packageName, version: latest.version });
  for (const file of ["package/../escape", "package//bad", "../bad", "package/./bad", "package/\\bad"]) assert.throws(() => packageFileHashes(archive({ "package/package.json": metadata, [file]: "bad" })));
  assert.throws(() => packageFileHashes(archive({ "package/package.json": metadata }), { name: "other", version: latest.version }), /identity/);
  const broken = archive({ "package/package.json": "{}" }); broken[15] ^= 1; assert.throws(() => packageFileHashes(broken));
});
test("verified apply preserves originals, rejects changed remote package bytes and confirms installed bytes", async t => {
  const f = await fixture(t), before = await readFile(path.join(f.root, "package.json")); let installs = 0;
  const report = await applyProjectUpdate(f.root, { fetch: f.request, expectedVersion: old.version, install: async () => { installs++; await f.installFiles(latest.version); } });
  assert.equal(report.version, latest.version); assert.equal(installs, 1); assert.deepEqual(await readFile(path.join(report.backup, "package.json")), before);
  assert.equal(JSON.parse(await readFile(path.join(f.root, "package.json"))).dependencies[packageName], latest.runtime);
  await assert.rejects(applyProjectUpdate(f.root, { fetch: f.request, expectedVersion: old.version }), /changed since/);
  const g = await fixture(t); g.files.set(latest.runtime, Buffer.from("substituted asset"));
  await assert.rejects(applyProjectUpdate(g.root, { fetch: g.request, install: async () => assert.fail("must not install") }), /checksum/);
  assert.deepEqual(await readFile(path.join(g.root, "package.json")), before);
});
test("failed installation restores original metadata/lock; failed recovery and external edits remain visible", async t => {
  for (const external of [false, true]) {
    const f = await fixture(t), original = await readFile(path.join(f.root, "package.json")); await writeFile(path.join(f.root, "package-lock.json"), "original lock");
    let calls = 0;
    await assert.rejects(applyProjectUpdate(f.root, { fetch: f.request, install: async () => {
      if (++calls > 1) throw Error("recovery offline");
      if (external) await writeFile(path.join(f.root, "package.json"), JSON.stringify({ ...f.metadata, userEdit: true }));
      throw Error("installation offline");
    } }), /Dependencies restored: false/);
    const backup = path.join(f.root, ".ferrum-updates", (await readdir(path.join(f.root, ".ferrum-updates")))[0]);
    const report = JSON.parse(await readFile(path.join(backup, "result.json")));
    assert.equal(report.metadataRestored, !external); assert.equal(report.dependenciesRestored, false);
    if (external) assert.equal(JSON.parse(await readFile(path.join(f.root, "package.json"))).userEdit, true);
    else { assert.deepEqual(await readFile(path.join(f.root, "package.json")), original); assert.equal(await readFile(path.join(f.root, "package-lock.json"), "utf8"), "original lock"); }
  }
});
test("installed-file substitution fails verification and restores the old dependency", async t => {
  const f = await fixture(t), before = await readFile(path.join(f.root, "package.json")); let installs = 0;
  await assert.rejects(applyProjectUpdate(f.root, { fetch: f.request, install: async () => {
    if (++installs === 1) {
      await f.installFiles(latest.version);
      await writeFile(path.join(f.root, "node_modules", packageName, "index.js"), "substituted installed code");
    } else await f.installFiles(old.version);
  } }), /differs from verified release/);
  assert.equal(installs, 2); assert.deepEqual(await readFile(path.join(f.root, "package.json")), before);
  assert.equal((await inspectProject(f.root)).currentVersion, old.version);
  const backup = path.join(f.root, ".ferrum-updates", (await readdir(path.join(f.root, ".ferrum-updates")))[0]);
  assert.equal(JSON.parse(await readFile(path.join(backup, "result.json"))).dependenciesRestored, true);
});
for (const manager of ["npm", "pnpm"]) test(`real ${manager} installation updates a temporary consumer without lifecycle hooks`, async t => {
  const f = await fixture(t), server = createServer((request, response) => {
    const url = "https://github.com" + new URL(request.url, "http://fixture").pathname, bytes = f.files.get(url);
    if (!bytes) response.writeHead(404).end(); else response.writeHead(200, { "content-length": bytes.length }).end(bytes);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const packageFile = path.join(f.root, "package.json");
  await writeFile(packageFile, JSON.stringify({ ...f.metadata, packageManager: manager + "@10.8.0" }));
  const mirroredInstall = async (state, settings) => {
    const source = await readFile(packageFile, "utf8");
    const value = JSON.parse(source); for (const name of Object.keys(value.dependencies)) value.dependencies[name] = `http://127.0.0.1:${server.address().port}` + new URL(value.dependencies[name]).pathname;
    await writeFile(packageFile, JSON.stringify(value));
    try { await installProject(state, settings); } finally { await writeFile(packageFile, source); }
  };
  // Fixture transport only: production provenance and URLs are checked before mirroring.
  await mirroredInstall({ root: f.root, manager });
  const result = await applyProjectUpdate(f.root, { fetch: f.request, install: mirroredInstall });
  assert.equal(result.version, latest.version); assert.equal(result.manager, manager);
  assert.equal(await readFile(path.join(f.root, "node_modules", packageName, "index.js"), "utf8"), f.archives.get(latest.version)["package/index.js"]);
  await assert.rejects(readFile(path.join(f.root, "node_modules", packageName, "LIFECYCLE_RAN")), { code: "ENOENT" });
});
