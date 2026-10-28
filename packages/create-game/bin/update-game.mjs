#!/usr/bin/env node
import { readFile, writeFile, mkdir, lstat, realpath, rm, open } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { githubRelease, DEFAULT_GITHUB_REPOSITORY } from "./github-release.mjs";
import { packageFileHashes, sha256, verifyInstalledPackage } from "./update-integrity.mjs";

export const FAMILY = ["ferrum-web", "authoring-viewer", "create-game", "agents"];
const NAMES = FAMILY.map(name => "@ferrum2d/" + name);
const MAX_JSON = 2 * 1024 * 1024;

export function compareReleaseVersions(a, b) {
  const parse = value => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/u.exec(value ?? "");
    if (!match || match.slice(1).some(value => value !== undefined && !Number.isSafeInteger(Number(value)))) throw Error("Unsupported release version");
    return match.slice(1).map((value, index) => value === undefined && index === 3 ? Infinity : Number(value));
  };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

export function selectRelease(rows, repository, target) {
  if (!Array.isArray(rows) || rows.length > 500) throw Error("Invalid release list");
  const candidates = rows.flatMap(row => {
    if (!row || row.draft !== false || typeof row.tag_name !== "string" || !Array.isArray(row.assets)) return [];
    let release;
    try { release = githubRelease(row.tag_name, repository); compareReleaseVersions(release.version, release.version); } catch { return []; }
    if (target && release.version !== target) return [];
    const names = new Set(row.assets.filter(asset => asset?.state === "uploaded").map(asset => asset.name));
    if (![...FAMILY.map(name => `ferrum2d-${name}-${release.version}.tgz`), "release-manifest.json"].every(name => names.has(name))) return [];
    return [{ ...release, pageUrl: `https://github.com/${repository}/releases/tag/${release.tag}` }];
  });
  candidates.sort((a, b) => compareReleaseVersions(b.version, a.version));
  return candidates[0];
}

export async function fetchBytes(url, limit, { fetch: request = globalThis.fetch } = {}) {
  const response = await request(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "Ferrum2D-Updater", Accept: "application/vnd.github+json" } });
  if (!response.ok) throw Error(`Release request failed: HTTP ${response.status}`);
  if (response.url) {
    const final = new URL(response.url);
    if (final.protocol !== "https:" || !["api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(final.hostname)) throw Error("Unexpected release redirect");
  }
  if (!response.body || Number(response.headers.get("content-length")) > limit) throw Error("Release response exceeds byte limit");
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > limit) throw Error("Release response exceeds byte limit"); chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
const json = bytes => JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
async function fileJson(file, required = true) {
  let stat;
  try { stat = await lstat(file); } catch (error) { if (!required && error.code === "ENOENT") return undefined; throw error; }
  if (!stat.isFile() || stat.size > MAX_JSON) throw Error("Invalid project metadata file: " + path.basename(file));
  return json(await readFile(file));
}
function packageVersion(spec) {
  if (typeof spec !== "string") return undefined;
  const match = /\/ferrum2d-ferrum-web-(\d+\.\d+\.\d+-beta\.\d+)\.tgz$/u.exec(spec);
  if (match) return match[1];
  try { compareReleaseVersions(spec, spec); return spec; } catch { return undefined; }
}

export async function inspectProject(project) {
  const root = await realpath(project), manifest = await fileJson(path.join(root, "package.json"));
  if (manifest.name === "ferrum2d" || NAMES.includes(manifest.name) || manifest.workspaces || (await fileJson(path.join(root, "packages/ferrum-web/package.json"), false))?.name === NAMES[0])
    throw Error("Engine workspaces are updated through source control");
  const spec = manifest.dependencies?.[NAMES[0]] ?? manifest.devDependencies?.[NAMES[0]];
  if (typeof spec !== "string") throw Error("Project does not depend on @ferrum2d/ferrum-web");
  if (/^(?:workspace:|file:|link:|git\+|github:)/u.test(spec)) throw Error("Local or source-managed engine dependencies cannot be updated automatically");
  const metadata = manifest.ferrumGithubRelease;
  const repository = metadata?.repository ?? DEFAULT_GITHUB_REPOSITORY;
  let provenance = metadata ? githubRelease(metadata.version, repository) : undefined;
  if (metadata && provenance.tag !== metadata.tag) throw Error("Project release provenance is inconsistent");
  // Direct SDK installs predate generator metadata. Recognize only exact official release URLs.
  if (!provenance) {
    try { const candidate = githubRelease(packageVersion(spec), repository); if (spec === candidate.runtime) provenance = candidate; } catch { /* Registry version/range remains supported. */ }
  }
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) for (const name of NAMES) {
    const value = manifest[section]?.[name]; if (value === undefined) continue;
    if (typeof value !== "string" || /^(?:workspace:|file:|link:|git\+|github:|npm:)/u.test(value)) throw Error("Local or source-managed Ferrum dependencies cannot be updated automatically");
    if (/^https?:/u.test(value) && (!provenance || value !== provenance.baseUrl + "/" + name.replace(/^@/u, "").replace("/", "-") + "-" + provenance.version + ".tgz")) throw Error("Custom Ferrum download sources require a manual update");
    if (!/^https?:/u.test(value) && !/^[0-9A-Za-z.*^~<>=| -]+$/u.test(value)) throw Error("Local or source-managed Ferrum dependencies cannot be updated automatically");
  }
  const installedFile = path.join(root, "node_modules/@ferrum2d/ferrum-web/package.json");
  let installed;
  try { installed = await fileJson(await realpath(installedFile)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (installed && installed.name !== NAMES[0]) throw Error("Installed engine package name does not match");
  const currentVersion = installed?.version ?? packageVersion(spec) ?? provenance?.version;
  if (!currentVersion) throw Error("Install the project dependencies before checking an engine version range");
  compareReleaseVersions(currentVersion, currentVersion);
  const files = [];
  for (const file of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "npm-shrinkwrap.json"]) {
    try { const stat = await lstat(path.join(root, file)); if (!stat.isFile()) throw Error("Lock file must be a regular file"); files.push(file); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (files.includes("yarn.lock") || files.includes("npm-shrinkwrap.json") || files.length > 1) throw Error("Use one supported npm or pnpm lock file");
  const manager = manifest.packageManager?.startsWith("pnpm@") || files[0] === "pnpm-lock.yaml" ? "pnpm" : "npm";
  if (manifest.packageManager && !/^(?:pnpm|npm)@/u.test(manifest.packageManager)) throw Error("Only npm and pnpm projects are supported");
  if (manifest.packageManager && !manifest.packageManager.startsWith(manager + "@")) throw Error("Project package manager conflicts with its lock file");
  return { root, manifest, currentVersion, repository, manager, lockFile: manager === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json" };
}

export async function checkProject(project, options = {}) {
  const state = await inspectProject(project);
  let release;
  for (let page = 1; page <= 5; page++) {
    const rows = json(await fetchBytes(`https://api.github.com/repos/${state.repository}/releases?per_page=100&page=${page}`, MAX_JSON, options));
    const candidate = selectRelease(rows, state.repository, options.to);
    if (candidate && (!release || compareReleaseVersions(candidate.version, release.version) > 0)) release = candidate;
    if (options.to && release) break;
    if (!Array.isArray(rows) || rows.length < 100) break;
  }
  return { ...state, release, available: !!release && compareReleaseVersions(release.version, state.currentVersion) > 0 };
}

export function updateManifest(manifest, release) {
  const next = structuredClone(manifest), urls = [release.runtime, release.viewer, release.generator, release.agents];
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (let index = 0; index < NAMES.length; index++) if (next[section]?.[NAMES[index]] !== undefined) next[section][NAMES[index]] = urls[index];
  }
  if (typeof next.scripts?.["ferrum:agents"] === "string") {
    const pattern = /^npx --yes(?: --allow-remote=root)? --package=https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/download\/ferrum-web-v\d+\.\d+\.\d+-beta\.\d+\/ferrum2d-agents-\d+\.\d+\.\d+-beta\.\d+\.tgz ferrum2d-agents init --tools codex,claude,gemini$/u;
    if (!pattern.test(next.scripts["ferrum:agents"])) throw Error("Custom ferrum:agents command requires a manual update");
    next.scripts["ferrum:agents"] = `npx --yes --allow-remote=root --package=${release.agents} ferrum2d-agents init --tools codex,claude,gemini`;
  }
  next.ferrumGithubRelease = { repository: release.repository, version: release.version, tag: release.tag };
  return next;
}

/** Windows command shims can execute from the project cwd. Use a known JS entry or native exe instead. */
async function windowsManager(manager, root) {
  const filename = manager === "npm" ? "npm-cli.js" : "pnpm.cjs";
  const candidates = [];
  if (process.env.npm_execpath && path.basename(process.env.npm_execpath) === filename) candidates.push(process.env.npm_execpath);
  for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(directory => path.isAbsolute(directory))) {
    candidates.push(path.join(directory, manager + ".exe"), path.join(directory, "node_modules", manager, "bin", filename));
    if (manager === "pnpm") candidates.push(path.join(directory, "node_modules/corepack/dist/pnpm.js"));
  }
  for (const candidate of candidates) {
    let file; try { file = await realpath(candidate); if (!(await lstat(file)).isFile()) continue; } catch { continue; }
    const relative = path.relative(root, file);
    if (relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) continue;
    return file.endsWith(".exe") ? { command: file, prefix: [] } : { command: process.execPath, prefix: [file] };
  }
  throw Error("Cannot locate the package manager executable. Install Node.js/npm or pnpm on PATH");
}

/** No command shell and no project/package lifecycle hooks. */
export async function installProject(state, { frozen = false, timeoutMs = 300_000 } = {}) {
  const args = state.manager === "pnpm" ? ["install", "--ignore-scripts", "--ignore-pnpmfile", frozen ? "--frozen-lockfile" : "--no-frozen-lockfile"] : [frozen ? "ci" : "install", "--ignore-scripts", "--no-audit", "--no-fund"];
  const env = { ...process.env, npm_config_ignore_scripts: "true", npm_config_allow_remote: "root" };
  const invocation = process.platform === "win32" ? await windowsManager(state.manager, state.root) : { command: state.manager, prefix: [] };
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, [...invocation.prefix, ...args], { cwd: state.root, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let output = "", finished = false;
    const finish = error => { if (finished) return; finished = true; clearTimeout(timer); error ? reject(error) : resolve(); };
    child.stdout.on("data", chunk => { output = (output + chunk).slice(-16_384); });
    child.stderr.on("data", chunk => { output = (output + chunk).slice(-16_384); });
    const timer = setTimeout(() => {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" }).on("error", () => child.kill());
      else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
      child.stdout.destroy(); child.stderr.destroy(); finish(Error("Package installation timed out"));
    }, timeoutMs);
    child.once("error", finish); child.once("close", code => finish(code === 0 ? undefined : Error("Package installation failed: " + output)));
  });
}

export async function applyProjectUpdate(project, options = {}) {
  const state = await checkProject(project, options);
  if (options.expectedVersion && state.currentVersion !== options.expectedVersion) throw Error("Installed engine changed since the update was checked");
  if (!state.available) throw Error("No newer engine release is available");
  const release = state.release, next = updateManifest(state.manifest, release);
  const manifest = json(await fetchBytes(release.baseUrl + "/release-manifest.json", MAX_JSON, options));
  if (manifest?.format !== "ferrum2d.github-release.bundle" || manifest.version !== 1 || manifest.release?.version !== release.version || manifest.release?.repository !== release.repository || manifest.release?.tag !== release.tag || !Array.isArray(manifest.assets)) throw Error("Release manifest does not match the selected release");
  const verified = new Map();
  for (const name of NAMES.filter(name => ["dependencies", "devDependencies", "optionalDependencies"].some(section => next[section]?.[name]))) {
    const file = `${name.replace(/^@/u, "").replace("/", "-")}-${release.version}.tgz`, url = release.baseUrl + "/" + file;
    const asset = manifest.assets.find(asset => asset.package === name);
    if (!asset || asset.file !== file || asset.url !== url || asset.version !== release.version || !/^[a-f0-9]{64}$/u.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > 64 * 1024 * 1024) throw Error("Invalid release package metadata");
    const bytes = await fetchBytes(url, 64 * 1024 * 1024, options);
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) throw Error("Release package checksum mismatch");
    verified.set(name, packageFileHashes(bytes, { name, version: release.version }));
  }
  const cache = path.join(state.root, ".ferrum-updates");
  try { await mkdir(cache, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
  if (!(await lstat(cache)).isDirectory() || await realpath(cache) !== cache) throw Error("Update backup directory must not be a symlink");
  const lock = await open(path.join(cache, "active.lock"), "wx", 0o600).catch(error => {
    if (error.code === "EEXIST") throw Error("An update lock already exists. Check .ferrum-updates backups before removing active.lock");
    throw error;
  });
  const backup = path.join(cache, new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID());
  const originals = new Map(); let mutated = false;
  const nextBytes = Buffer.from(JSON.stringify(next, null, 2) + "\n");
  const install = options.install ?? installProject;
  try {
    await mkdir(backup, { mode: 0o700 });
    for (const name of ["package.json", state.lockFile]) {
      let bytes;
      try { if (!(await lstat(path.join(state.root, name))).isFile()) throw Error("Update target must be a regular file"); bytes = await readFile(path.join(state.root, name)); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      originals.set(name, bytes); if (bytes) await writeFile(path.join(backup, name), bytes, { flag: "wx" });
    }
    if (JSON.stringify(json(originals.get("package.json"))) !== JSON.stringify(state.manifest)) throw Error("Project metadata changed during update verification");
    mutated = true; await writeFile(path.join(state.root, "package.json"), nextBytes);
    await install(state);
    for (const [name, hashes] of verified) await verifyInstalledPackage(path.join(state.root, "node_modules", name), hashes);
    const installed = await fileJson(await realpath(path.join(state.root, "node_modules/@ferrum2d/ferrum-web/package.json")));
    if (installed.version !== release.version) throw Error("Installed engine version does not match the selected release");
    const report = { ok: true, previousVersion: state.currentVersion, version: release.version, projectPath: state.root, backup, manager: state.manager, verification: "package bytes match release SHA-256", projectChecks: "not-run", releaseUrl: release.pageUrl };
    await writeFile(path.join(backup, "result.json"), JSON.stringify(report, null, 2) + "\n"); return report;
  } catch (error) {
    let restored = !mutated, metadataRestored = !mutated, recoveryError;
    if (mutated) {
      try {
        // Keep failure-state files as well as originals; never erase an external package.json edit.
        const current = await readFile(path.join(state.root, "package.json"));
        for (const name of originals.keys()) {
          const bytes = await readFile(path.join(state.root, name)).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
          if (bytes) await writeFile(path.join(backup, "failed-" + name), bytes, { flag: "wx" });
        }
        if (!current.equals(nextBytes)) throw Error("Project metadata changed externally; restore the backup manually");
        for (const [name, bytes] of originals) {
          const file = path.join(state.root, name), stat = await lstat(file).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
          if (stat && !stat.isFile()) throw Error("Recovery target is no longer a regular file");
          if (bytes) await writeFile(file, bytes); else await rm(file, { force: true });
        }
        metadataRestored = true;
        await install(state, { frozen: !!originals.get(state.lockFile) }); restored = true;
      } catch (recovery) { recoveryError = recovery.message; }
    }
    const failure = { ok: false, error: error.message, backup, metadataRestored, dependenciesRestored: restored, recoveryError };
    await writeFile(path.join(backup, "result.json"), JSON.stringify(failure, null, 2) + "\n").catch(() => {});
    throw Error(`${error.message}. Backup: ${backup}. Metadata restored: ${metadataRestored}. Dependencies restored: ${restored}${recoveryError ? ". Recovery: " + recoveryError : ""}`);
  } finally { await lock.close(); await rm(path.join(cache, "active.lock"), { force: true }); }
}

export async function main(args) {
  const options = {}, seen = new Set(); let project = process.cwd();
  while (args.length) {
    const key = args.shift(); if (seen.has(key)) throw Error("Duplicate option: " + key); seen.add(key);
    if (key === "--apply") options.apply = true;
    else if (key === "--project") project = args.shift();
    else if (key === "--to") options.to = githubRelease(args.shift()).version;
    else if (key === "--expected-version") { options.expectedVersion = args.shift(); compareReleaseVersions(options.expectedVersion, options.expectedVersion); }
    else if (key === "--help") { console.log("ferrum-update-game [--project <directory>] [--to x.y.z-beta.N] [--apply]\nCheck public GitHub engine releases; --apply backs up metadata and installs verified packages without lifecycle scripts."); return; }
    else throw Error("Unknown option: " + key);
  }
  const state = options.apply ? await applyProjectUpdate(project, options) : await checkProject(project, options);
  console.log(JSON.stringify(options.apply ? state : { ok: true, projectPath: state.root, currentVersion: state.currentVersion, latestVersion: state.release?.version, available: state.available, manager: state.manager, releaseUrl: state.release?.pageUrl }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
