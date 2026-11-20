#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));
export const NATIVE_WASI_ABORT_PROBE = "world::tests::joints::unchecked_distance_joint_stale_endpoint_abort_probe";
export const NATIVE_WASI_ABORT_MESSAGE = "distance joint endpoints must reference current entities";

/** Cargo receives a TOML string array as one argv entry; no shell quoting is involved. */
export function nativeWasiInvocation(argv, root = repository, node = process.execPath) {
  let targetDir;
  let release = false;
  let tests = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") { tests = argv.slice(i + 1); break; }
    if (arg === "--release") { release = true; continue; }
    if (arg === "--node" || arg === "--target-dir") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a path`);
      if (arg === "--node") node = resolve(root, value);
      else targetDir = resolve(root, value);
      continue;
    }
    tests = argv.slice(i);
    break;
  }
  if (!tests.some(arg => arg === "--test-threads" || arg.startsWith("--test-threads="))) tests.push("--test-threads=1");
  const runner = [node, resolve(root, "tests/smoke/native-wasi-runner.mjs")];
  const args = ["--config", `target.wasm32-wasip1.runner=${JSON.stringify(runner)}`,
    "test", "--message-format=json", "--manifest-path", resolve(root, "crates/ferrum-core/Cargo.toml"), "--target", "wasm32-wasip1"];
  if (targetDir) args.push("--target-dir", targetDir);
  if (release) args.push("--release");
  args.push("--", ...tests);
  return { command: "cargo", args, cwd: root, node, runner: runner[1] };
}

/** A negative probe retains its real Node exit1 and never emits a normal success attestation. */
export function nativeWasiAbortProbeInvocation(invocation, executable) {
  return { command: invocation.node, args: [invocation.runner, "--abort-probe", executable,
    NATIVE_WASI_ABORT_PROBE, "--ignored", "--exact", "--nocapture", "--test-threads=1"] };
}

export function validateNativeWasiAbortProbe(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 1, "abort probe must terminate with ordinary Node exit1");
  assert.equal(result.signal, null, "abort probe must not terminate by a host signal");
  assert(result.stdout.includes(`test ${NATIVE_WASI_ABORT_PROBE} ...`), "the exact ignored Rust probe must run");
  assert(result.stdout.includes("running 1 test"), "abort probe must select exactly one test");
  assert(result.stderr.includes("panicked at"), "the Rust panic hook must run");
  assert(result.stderr.split(/\r?\n/).includes(NATIVE_WASI_ABORT_MESSAGE), "the exact unchecked API panic message must match");
  assert(result.stderr.includes("RuntimeError: unreachable"), "panic=abort must produce the Wasm unreachable trap");
  const combined = result.stdout + result.stderr;
  assert(!combined.includes('"wasiRustOnly":true'), "an abort is never normal test success");
  assert(!combined.includes("Rust-only regression attempted JS binding"), "no denied JS binding may run");
  const records = result.stderr.split(/\r?\n/).filter(line => line.startsWith('{"nativeWasiAbortProbe":')).map(line => JSON.parse(line));
  assert.equal(records.length, 1, "one native failure attestation is required");
  const record = records[0];
  assert.equal(record.wasmExecutionSucceeded, false);
  assert.equal(record.deniedBindingCalls, 0);
  assert.equal(record.errorName, "RuntimeError");
  assert.equal(record.errorMessage, "unreachable");
  return { expectedAbortValidated: true, nodeExitCode: result.status, signal: result.signal,
    deniedBindingCalls: record.deniedBindingCalls, rustPanic: NATIVE_WASI_ABORT_MESSAGE, trap: record.errorMessage };
}

export async function runNativeWasiQa(invocation) {
  let executable;
  const normal = await new Promise((resolveResult, reject) => {
    const child = spawn(invocation.command, invocation.args, { cwd: invocation.cwd, stdio: ["inherit", "pipe", "inherit"], shell: false });
    child.stdout.pipe(process.stdout, { end: false });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", line => {
      let item;
      try { item = JSON.parse(line); } catch { return; }
      if (item.reason === "compiler-artifact" && item.target?.name === "ferrum_core" && item.profile?.test === true && item.executable?.endsWith(".wasm")) executable = item.executable;
    });
    child.once("error", reject);
    child.once("close", (status, signal) => resolveResult({ status, signal, pid: child.pid }));
  });
  if (normal.status !== 0 || normal.signal) {
    console.error(JSON.stringify({ nativeWasiQa: true, normalTests: normal, abortProbe: { status: "not-run", reason: "normal-tests-failed" } }));
    return normal.status ?? 1;
  }
  assert(executable, "Cargo must report the unit-test Wasm artifact before the isolated abort probe");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(executable)) hash.update(chunk);
  const wasmSha256 = hash.digest("hex");
  const probe = nativeWasiAbortProbeInvocation(invocation, executable);
  const result = spawnSync(probe.command, probe.args, { cwd: invocation.cwd, encoding: "utf8", shell: false,
    timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  let validation;
  try { validation = validateNativeWasiAbortProbe(result); }
  catch (error) {
    console.error(JSON.stringify({ nativeWasiQa: true, normalTests: normal, abortProbe: { status: "failed", pid: result.pid,
      nodeExitCode: result.status, signal: result.signal, wasmSha256, reason: error.message } }));
    return 1;
  }
  console.log(JSON.stringify({ nativeWasiQa: true, normalTests: normal, abortProbe: { status: "validated-negative",
    pid: result.pid, command: probe.command, args: probe.args, wasmSha256, ...validation } }));
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runNativeWasiQa(nativeWasiInvocation(process.argv.slice(2)));
}
