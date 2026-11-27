#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, statfsSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const manifests = [
  "crates/ferrum-core/Cargo.toml",
  "apps/studio-desktop/src-tauri/Cargo.toml",
  "crates/ferrum-core/vendor/rapier3d/Cargo.toml",
  "crates/ferrum-core/vendor/parry3d/Cargo.toml",
];
const artifactFolders = [".fingerprint", "deps", "build", "incremental", "examples"];
const day = 24 * 60 * 60 * 1000;
const gib = 1024 ** 3;
const nfs = 0x6969;

function inside(parent, path) {
  const offset = relative(parent, path);
  return offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset);
}

function cargo(args, root, env, stdio) {
  const result = spawnSync("cargo", args, {
    cwd: root, env, encoding: "utf8", stdio, timeout: args[0] === "metadata" ? 5000 : undefined,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `cargo ${args[0]} failed (${result.signal ?? result.status})`);
  }
  return result.stdout;
}

function discoverTargets(root, env) {
  const targets = new Set();
  for (const manifest of manifests) {
    const metadata = JSON.parse(cargo([
      "metadata", "--no-deps", "--locked", "--offline", "--format-version", "1", "--manifest-path", manifest,
    ], root, env));
    const target = metadata.target_directory;
    if (typeof target !== "string" || !isAbsolute(target)) throw new Error(`invalid target_directory for ${manifest}`);
    if (!lstatSync(target, { throwIfNoEntry: false })) continue;
    const actual = realpathSync(target);
    if (inside(actual, root)) {
      throw new Error(`unsafe target directory: ${actual}`);
    }
    targets.add(actual);
  }
  return [...targets].sort((a, b) => a.length - b.length).filter((target, index, ordered) =>
    !ordered.slice(0, index).some(parent => inside(parent, target)),
  );
}

function directories(path) {
  return readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .map(entry => join(path, entry.name));
}

function tryLock(path, env, create = false) {
  const flags = constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  let fd;
  try {
    fd = openSync(path, create ? flags | constants.O_CREAT : flags, 0o600);
  } catch (error) {
    if (["ENOENT", "ELOOP", "EACCES", "EPERM", "EROFS"].includes(error.code)) return undefined;
    throw error;
  }
  let locked = false;
  try {
    if (!fstatSync(fd).isFile()) return undefined;
    // flock(2) locks the open file description shared with the inherited fd.
    const lock = spawnSync("flock", ["--nonblock", "3"], { env, stdio: ["ignore", "ignore", "ignore", fd] });
    locked = lock.status === 0;
    return locked ? fd : undefined;
  } finally {
    if (!locked) closeSync(fd);
  }
}

function lockProfiles(targets, env, locks) {
  const buckets = new Set();
  let skipped = 0;
  for (const target of targets) {
    if (statfsSync(target).type === nfs) {
      skipped++;
      continue;
    }
    for (const entry of directories(target)) {
      const profiles = artifactFolders.some(name => lstatSync(join(entry, name), { throwIfNoEntry: false }))
        ? [entry] : directories(entry);
      for (const profile of profiles) {
        const folders = artifactFolders.map(name => join(profile, name)).filter(path =>
          lstatSync(path, { throwIfNoEntry: false })?.isDirectory(),
        );
        if (folders.length === 0) continue;
        const lockPath = join(profile, ".cargo-lock");
        const stat = lstatSync(lockPath, { throwIfNoEntry: false });
        const fd = stat?.isFile() && statfsSync(profile).type !== nfs ? tryLock(lockPath, env) : undefined;
        if (fd === undefined) {
          skipped++;
          continue;
        }
        locks.push(fd);
        for (const folder of folders) buckets.add(folder);
      }
    }
  }
  return { buckets, skipped };
}

function inventory(targets, buckets) {
  const items = [];
  const inodes = new Map();
  let total = 0;
  function visit(path, item) {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat || (!stat.isFile() && !stat.isDirectory())) return;
    if (buckets.has(dirname(path))) {
      item = { path, files: [], lastUse: -Infinity, fallback: Math.max(stat.atimeMs, stat.mtimeMs) };
      items.push(item);
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name), item);
      return;
    }
    // Cargo can hard-link hashed outputs to unversioned binaries in the same target.
    let file = { bytes: stat.size, links: 0 };
    if (stat.nlink > 1) {
      const key = `${stat.dev}:${stat.ino}`;
      if (inodes.has(key)) file = inodes.get(key);
      else inodes.set(key, file);
    }
    if (file.links++ === 0) total += file.bytes;
    if (item) {
      item.lastUse = Math.max(item.lastUse, stat.atimeMs, stat.mtimeMs);
      item.files.push(file);
    }
  }
  for (const target of targets) visit(target);
  for (const item of items) if (item.lastUse === -Infinity) item.lastUse = item.fallback;
  items.sort((a, b) => a.lastUse - b.lastUse || a.path.localeCompare(b.path));
  return { items, total };
}

function limit(env, name, defaultValue, unit) {
  if (env[name] === undefined) return defaultValue * unit;
  const value = Number(env[name]);
  if (!env[name].trim() || !Number.isFinite(value * unit) || value < 0) throw new Error(`invalid ${name}`);
  return value * unit;
}

function cleanStale(root, env, now, dryRun, log) {
  const age = limit(env, "FERRUM_RUST_TARGET_MAX_AGE_DAYS", 14, day);
  const max = limit(env, "FERRUM_RUST_TARGET_MAX_GIB", 20, gib);
  const targets = discoverTargets(root, env);
  const locks = [];
  try {
    const { buckets, skipped } = lockProfiles(targets, env, locks);
    const { items, total } = inventory(targets, buckets);
    let remaining = total;
    let removed = 0;
    for (const item of items) {
      if (item.lastUse >= now - age && remaining <= max) break;
      if (!dryRun) rmSync(item.path, { recursive: true, force: true });
      let bytes = 0;
      for (const file of item.files) if (--file.links === 0) bytes += file.bytes;
      remaining -= bytes;
      removed++;
      if (dryRun) log(`[rust-target-gc] ${item.path} (${bytes} bytes)`);
    }
    log(`[rust-target-gc] ${dryRun ? "would remove" : "removed"} ${removed} items, ${total - remaining} bytes; ${remaining} bytes remain, ${skipped} profiles or targets skipped`);
  } finally {
    for (const fd of locks) closeSync(fd);
  }
}

export function cleanRustTargets({ root = repository, env = process.env, now = Date.now(),
  automatic = false, dryRun = false, all = false, log = console.log } = {}) {
  if (env.CI === "true" || (!all && env.FERRUM_RUST_TARGET_GC === "0")) return;
  if (all) {
    for (const manifest of manifests) cargo(["clean", "--manifest-path", manifest], root, env, "inherit");
    return;
  }
  if (process.platform !== "linux" || spawnSync("flock", ["--version"], { env, stdio: "ignore" }).status !== 0) {
    log("[rust-target-gc] skipped: Linux flock is required for safe cleanup");
    return;
  }
  if (!automatic || dryRun) {
    cleanStale(root, env, now, dryRun, log);
    return;
  }

  const directory = join(root, "node_modules/.cache/ferrum2d");
  const stamp = join(directory, "rust-target-gc.json");
  mkdirSync(directory, { recursive: true });
  const fd = tryLock(`${stamp}.lock`, env, true);
  if (fd === undefined) return;
  try {
    let lastRun;
    try { lastRun = JSON.parse(readFileSync(stamp, "utf8"))?.lastRun; }
    catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
    if (Number.isFinite(lastRun) && lastRun <= now && now - lastRun < day) return;
    cleanStale(root, env, now, false, log);
    const next = `${stamp}.${process.pid}.tmp`;
    writeFileSync(next, `${JSON.stringify({ lastRun: now })}\n`);
    renameSync(next, stamp);
  } finally {
    closeSync(fd);
  }
}

export function maybeCleanRustTargets() {
  try { cleanRustTargets({ automatic: true }); }
  catch (error) { console.warn(`[rust-target-gc] skipped: ${error.message.replace(/\s+/g, " ")}`); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [flag] = process.argv.slice(2);
    if (process.argv.length > 3 || (flag !== undefined && flag !== "--all" && flag !== "--dry-run")) {
      throw new Error("expected --all or --dry-run");
    }
    cleanRustTargets({ all: flag === "--all", dryRun: flag === "--dry-run" });
  } catch (error) {
    console.error(`[rust-target-gc] ${error.message}`);
    process.exitCode = 1;
  }
}
