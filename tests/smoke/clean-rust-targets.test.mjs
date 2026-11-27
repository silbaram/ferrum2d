import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { cleanRustTargets } from "../../scripts/tools/clean-rust-targets.mjs";

const day = 86_400_000;
const now = Date.UTC(2026, 10, 27);
const hasFlock = process.platform === "linux" && spawnSync("flock", ["--version"], { stdio: "ignore" }).status === 0;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "ferrum-rust-targets-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const targets = Object.fromEntries(["ferrum-core", "src-tauri", "rapier3d", "parry3d"].map(name => [name, join(root, name, "out")]));
  const env = { PATH: `${bin}:${process.env.PATH}`, FERRUM_CLEAN_FIXTURE: root,
    FERRUM_CLEAN_TARGETS: JSON.stringify(targets) };
  writeFileSync(join(bin, "cargo"), `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(path.join(process.env.FERRUM_CLEAN_FIXTURE, "calls"), JSON.stringify(args) + String.fromCharCode(10));
if (args[0] === "metadata") {
  const name = path.basename(path.dirname(args.at(-1)));
  console.log(JSON.stringify({target_directory: JSON.parse(process.env.FERRUM_CLEAN_TARGETS)[name]}));
}
`, { mode: 0o755 });
  const lines = [];
  const clean = options => cleanRustTargets({ root, env, now, log: message => lines.push(message), ...options });
  const regular = (path, age, size = 32, atime = age) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.alloc(size));
    utimesSync(path, (now - atime * day) / 1000, (now - age * day) / 1000);
    return path;
  };
  const profile = (target = targets["ferrum-core"], name = "debug") => {
    const path = join(target, name);
    regular(join(path, ".cargo-lock"), 0, 0);
    return path;
  };
  return { root, targets, env, lines, clean, regular, profile };
}

test("expires artifacts by their latest file atime or mtime and skips symlink and unrelated entries", { skip: !hasFlock }, t => {
  const f = fixture(t);
  const host = f.profile();
  const wasi = f.profile(f.targets["ferrum-core"], "wasm32-wasip1/debug");
  const old = f.regular(join(host, "build", "old-hash", "out", "old"), 21);
  const oldWasi = f.regular(join(wasi, ".fingerprint", "crate-hash", "fingerprint"), 15);
  const readRecently = f.regular(join(host, "build", "read-hash", "out", "recent"), 20, 32, 1);
  const writtenRecently = f.regular(join(host, "examples", "example-old-read"), 1, 32, 20);
  const sibling = f.regular(join(host, "build", "read-hash", "out", "old-sibling"), 25);
  const unrelated = f.regular(join(host, "unhashed-binary"), 30);
  const outside = f.regular(join(f.root, "outside"), 30);
  const link = join(host, "build", "outside-link");
  symlinkSync(outside, link);
  f.clean();
  for (const path of [old, oldWasi]) assert(!existsSync(path), path);
  for (const path of [readRecently, writtenRecently, sibling, unrelated, outside, link]) assert(existsSync(path), path);
  assert.match(f.lines.at(-1), /removed 2 items, 64 bytes/);
});

test("limits combined target size oldest first, accounts for hard links, and leaves a dry run read-only", { skip: !hasFlock }, t => {
  const f = fixture(t);
  const core = f.profile();
  const studio = f.profile(f.targets["src-tauri"]);
  const evicted = f.regular(join(studio, "deps", "oldest"), 3, 100);
  const oldAlias = f.regular(join(core, "deps", "old-alias"), 4, 100);
  const stableAlias = join(core, "top-level-binary");
  linkSync(oldAlias, stableAlias);
  const recent = f.regular(join(core, "deps", "recent"), 1, 100);
  const env = { ...f.env, FERRUM_RUST_TARGET_MAX_GIB: String(200 / 1024 ** 3) };
  f.clean({ env, dryRun: true });
  assert(f.lines.some(line => line.includes(oldAlias) && line.endsWith("(0 bytes)")));
  assert(f.lines.some(line => line.includes(evicted)));
  assert(existsSync(evicted));
  assert(!existsSync(join(f.root, "node_modules")));
  f.clean({ env });
  assert(!existsSync(evicted));
  assert(!existsSync(oldAlias));
  assert(existsSync(stableAlias));
  assert(existsSync(recent));
  assert.match(f.lines.at(-1), /200 bytes remain/);
});

test("leaves busy or unverified profiles intact and holds the kernel lock while inspecting candidates", { skip: !hasFlock, timeout: 10_000 }, async t => {
  const f = fixture(t);
  const busy = f.profile();
  const idle = f.profile(f.targets["rapier3d"]);
  const busyItem = f.regular(join(busy, "incremental", "busy", "cache"), 20);
  const idleItem = f.regular(join(idle, "incremental", "idle", "cache"), 20);
  const unverified = f.regular(join(f.targets["parry3d"], "debug", "deps", "old"), 30);
  const locker = spawn("flock", ["--no-fork", join(busy, ".cargo-lock"), process.execPath,
    "-e", 'console.log("locked"); setInterval(() => {}, 1000)'], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => locker.kill());
  await Promise.race([
    once(locker.stdout, "data"),
    once(locker, "exit").then(([code]) => { throw new Error(`fixture lock holder exited (${code})`); }),
  ]);
  f.clean({ dryRun: true, log: message => {
    if (message.includes(join(idle, "incremental", "idle"))) {
      assert.equal(spawnSync("flock", ["--nonblock", join(idle, ".cargo-lock"), "true"]).status, 1);
    }
  } });
  f.clean();
  assert(existsSync(busyItem));
  assert(existsSync(unverified));
  assert(!existsSync(idleItem));
  assert.match(f.lines.at(-1), /2 profiles or targets skipped/);
});

test("CI and opt-out do no work; automatic cleanup is daily and manual cleanup bypasses the daily stamp", { skip: !hasFlock }, t => {
  const f = fixture(t);
  const profile = f.profile();
  const old = name => f.regular(join(profile, "deps", name), 30);
  const first = old("first");
  f.clean({ automatic: true, env: { ...f.env, CI: "true" } });
  f.clean({ automatic: true, env: { ...f.env, FERRUM_RUST_TARGET_GC: "0" } });
  assert(existsSync(first));
  assert(!existsSync(join(f.root, "calls")));
  f.clean({ automatic: true });
  assert(!existsSync(first));
  const stamp = join(f.root, "node_modules/.cache/ferrum2d/rust-target-gc.json");
  assert.deepEqual(JSON.parse(readFileSync(stamp)), { lastRun: now });
  const second = old("second");
  f.clean({ automatic: true, now: now + day - 1 });
  assert(existsSync(second));
  f.clean();
  assert(!existsSync(second));
  const third = old("third");
  f.clean({ automatic: true, now: now + day });
  assert(!existsSync(third));
  assert.deepEqual(JSON.parse(readFileSync(stamp)), { lastRun: now + day });
});

test("full cleanup delegates to Cargo for all four manifests", { skip: process.platform !== "linux" }, t => {
  const f = fixture(t);
  f.clean({ all: true });
  const calls = readFileSync(join(f.root, "calls"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(calls, [
    ["clean", "--manifest-path", "crates/ferrum-core/Cargo.toml"],
    ["clean", "--manifest-path", "apps/studio-desktop/src-tauri/Cargo.toml"],
    ["clean", "--manifest-path", "crates/ferrum-core/vendor/rapier3d/Cargo.toml"],
    ["clean", "--manifest-path", "crates/ferrum-core/vendor/parry3d/Cargo.toml"],
  ]);
});
