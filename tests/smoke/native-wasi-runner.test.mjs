import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { WASI } from "node:wasi";
import { forwardNativeWasiImports } from "./native-wasi-runner.mjs";
import { nativeWasiInvocation, nativeWasiAbortProbeInvocation, validateNativeWasiAbortProbe,
  NATIVE_WASI_ABORT_PROBE, NATIVE_WASI_ABORT_MESSAGE } from "../../scripts/validate/run-native-wasi-tests.mjs";

const runner = fileURLToPath(new URL("./native-wasi-runner.mjs", import.meta.url));
const expectedBindings = [
  "__wbindgen_placeholder__/__wbindgen_describe",
  "__wbindgen_placeholder__/__wbg___wbindgen_throw_9c75d47bf9e7731e",
  "__wbindgen_placeholder__/__wbg___wbindgen_memory_c2356dd1a089dfbd",
  "__wbindgen_placeholder__/__wbg___wbindgen_debug_string_07cb72cfcc952e2b",
  "__wbindgen_placeholder__/__wbindgen_object_drop_ref",
  "__wbindgen_placeholder__/__wbindgen_describe_cast",
  "__wbindgen_externref_xform__/__wbindgen_externref_table_grow",
  "__wbindgen_externref_xform__/__wbindgen_externref_table_set_null",
];
function u32(value) {
  const bytes = [];
  do { const next = value & 127; value >>>= 7; bytes.push(next | (value ? 128 : 0)); } while (value);
  return bytes;
}
function text(value) { const bytes = [...Buffer.from(value)]; return [...u32(bytes.length), ...bytes]; }
function section(id, bytes) { return [id, ...u32(bytes.length), ...bytes]; }
function fixture(binding, memoryImport = false, trap = false) {
  const imported = binding ? [...text(binding[0]), ...text(binding[1]), ...(memoryImport ? [2, 0, 1] : [0, 0])] : [];
  const body = [0, ...(binding && !memoryImport ? [0x10, 0] : []), ...(trap ? [0] : []), 0x0b];
  return Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 0x60, 0, 0]),
    ...(binding ? section(2, [1, ...imported]) : []),
    ...section(3, [1, 0]),
    ...(memoryImport ? [] : section(5, [1, 0, 1])),
    ...section(7, [2, ...text("memory"), 2, 0, ...text("_start"), 0, binding && !memoryImport ? 1 : 0]),
    ...section(10, [1, ...u32(body.length), ...body]),
  ]);
}
function executeFixture(bytes, abortProbe = false) {
  const folder = mkdtempSync(join(tmpdir(), "ferrum wasi capability "));
  try {
    const filename = join(folder, "fixture with spaces.wasm");
    writeFileSync(filename, bytes);
    const env = { ...process.env }; delete env.NODE_OPTIONS;
    return spawnSync(process.execPath, [runner, ...(abortProbe ? ["--abort-probe"] : []), filename], { env, encoding: "utf8", shell: false, timeout: 10_000 });
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

test("native WASI forwarding retains real capabilities and only forwards fd_write arguments/results/errors", () => {
  const wasi = new WASI({ version: "preview1", args: [], env: {}, preopens: {}, returnOnExit: true });
  const wrapped = forwardNativeWasiImports(wasi.wasiImport);
  assert.deepEqual(Object.keys(wrapped).sort(), Object.keys(wasi.wasiImport).sort());
  for (const key of Object.keys(wrapped)) if (key !== "fd_write") assert.equal(wrapped[key], wasi.wasiImport[key]);
  const calls = [], failure = new Error("native write rejected");
  const controlled = forwardNativeWasiImports({ fd_write(...args) { calls.push(args); if (args[0] === 9) throw failure; return 27; } });
  assert.equal(controlled.fd_write(1, 8, 3, 20), 27);
  assert.deepEqual(calls, [[1, 8, 3, 20]]);
  assert.throws(() => controlled.fd_write(9, 8, 3, 20), value => value === failure);
});

test("native WASI source contract preserves strict bindings, original argv, empty env/preopens and zero-call attestation", () => {
  const source = readFileSync(runner, "utf8");
  const keys = [...source.matchAll(/"(__wbindgen[^"\n]+)"/g)].map(match => match[1]);
  assert.deepEqual(keys, expectedBindings);
  assert(source.includes('new WASI({ version: "preview1", args: [filename, ...args], env: {}, preopens: {}, returnOnExit: true })'));
  assert(source.includes('assert.equal(entry.kind, "function")'));
  assert(source.includes("assert.equal(deniedBindingCalls, 0)"));
  assert(source.includes("assert.equal(exitCode, 0)"));
  assert(!source.includes("--stack-size"));
});

test("native WASI runner really rejects calls to every permitted wasm-bindgen placeholder", () => {
  for (const key of expectedBindings) {
    const result = executeFixture(fixture(key.split("/")));
    assert.equal(result.status, 1, key);
    assert.match(result.stderr, /Rust-only regression attempted JS binding/);
    assert(!result.stdout.includes('"wasiRustOnly":true'));
  }
});

test("native WASI runner rejects unknown capabilities and non-function bindings before execution", () => {
  const unknown = executeFixture(fixture(["unapproved", "run"]));
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unexpected non-WASI capability: unapproved\/run/);
  const memory = executeFixture(fixture(expectedBindings[0].split("/"), true));
  assert.equal(memory.status, 1);
  assert.match(memory.stderr, /memory/);
  assert.match(memory.stderr, /function/);
});

test("native WASI runner starts an actual valid Wasm fixture and attests zero denied binding calls", () => {
  const result = executeFixture(fixture());
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { wasiRustOnly: true, deniedBindingCalls: 0, rejectedCapabilities: [], exitCode: 0 });
});

test("abort mode retains exit1 and cannot accept an arbitrary trap, normal success or denied binding", () => {
  const trap = executeFixture(fixture(undefined, false, true), true);
  assert.equal(trap.status, 1);
  assert.equal(trap.signal, null);
  assert.match(trap.stderr, /RuntimeError: unreachable/);
  assert.match(trap.stderr, /"nativeWasiAbortProbe":true/);
  assert.match(trap.stderr, /"deniedBindingCalls":0/);
  assert(!trap.stdout.includes('"wasiRustOnly":true'));
  assert.throws(() => validateNativeWasiAbortProbe(trap));
  const noTrap = executeFixture(fixture(), true);
  assert.equal(noTrap.status, 1);
  assert.match(noTrap.stderr, /Abort probe unexpectedly returned without trapping/);
  assert.throws(() => validateNativeWasiAbortProbe(noTrap));
  const denied = executeFixture(fixture(expectedBindings[0].split("/")), true);
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /"deniedBindingCalls":1/);
  assert.throws(() => validateNativeWasiAbortProbe(denied));
});

test("abort verifier requires the exact Rust panic, unreachable trap, exit1 and zero denied calls", () => {
  const record = { nativeWasiAbortProbe: true, wasmExecutionSucceeded: false, deniedBindingCalls: 0,
    rejectedCapabilities: expectedBindings, errorName: "RuntimeError", errorMessage: "unreachable" };
  const good = { status: 1, signal: null, stdout: `running 1 test\ntest ${NATIVE_WASI_ABORT_PROBE} ... `,
    stderr: `thread 'main' panicked at src/world/joints.rs:18:14:\n${NATIVE_WASI_ABORT_MESSAGE}\n${JSON.stringify(record)}\nRuntimeError: unreachable\n` };
  assert.equal(validateNativeWasiAbortProbe(good).expectedAbortValidated, true);
  for (const invalid of [
    { ...good, status: 0 }, { ...good, status: null, signal: "SIGSEGV" },
    { ...good, stdout: "running 0 tests" },
    { ...good, stderr: good.stderr.replace(NATIVE_WASI_ABORT_MESSAGE, "different panic") },
    { ...good, stderr: good.stderr.replace("RuntimeError: unreachable", "different trap") },
    { ...good, stderr: good.stderr.replace('"deniedBindingCalls":0', '"deniedBindingCalls":1') },
    { ...good, stderr: good.stderr + '\n{"wasiRustOnly":true}\n' },
  ]) assert.throws(() => validateNativeWasiAbortProbe(invalid));
});

test("native WASI Cargo CLI uses a TOML JSON array without shell escaping and defaults to full tests", () => {
  const root = '/repo with spaces/and "quotes"';
  const node = '/tools with spaces/node "binary"';
  const plan = nativeWasiInvocation(["--node", node, "--target-dir", "build dir", "--", "pending1400", "--exact", "--nocapture"], root);
  assert.equal(plan.command, "cargo");
  assert.equal(plan.cwd, root);
  assert.equal(plan.args[0], "--config");
  const prefix = "target.wasm32-wasip1.runner=";
  assert(plan.args[1].startsWith(prefix));
  assert.deepEqual(JSON.parse(plan.args[1].slice(prefix.length)), [node, root + "/tests/smoke/native-wasi-runner.mjs"]);
  assert(!plan.args.includes("--lib"));
  assert(plan.args.includes("--message-format=json"));
  assert.deepEqual(plan.args.slice(-5), ["--", "pending1400", "--exact", "--nocapture", "--test-threads=1"]);
  assert(plan.args.includes(root + "/build dir"));
  const explicit = nativeWasiInvocation(["--release", "--", "test", "--test-threads=1"], root, node);
  assert(explicit.args.includes("--release"));
  assert.equal(explicit.args.filter(arg => arg === "--test-threads=1").length, 1);
  assert.throws(() => nativeWasiInvocation(["--node"], root), /requires a path/);
  const probe = nativeWasiAbortProbeInvocation(plan, root + "/unit test.wasm");
  assert.equal(probe.command, node);
  assert.deepEqual(probe.args, [root + "/tests/smoke/native-wasi-runner.mjs", "--abort-probe", root + "/unit test.wasm",
    NATIVE_WASI_ABORT_PROBE, "--ignored", "--exact", "--nocapture", "--test-threads=1"]);
});

test("actual Cargo accepts the runner string array with spaces and quotes in both paths", () => {
  const folder = mkdtempSync(join(tmpdir(), "ferrum cargo wasi "));
  try {
    writeFileSync(join(folder, "Cargo.toml"), '[package]\nname="wasi-runner-contract"\nversion="0.0.0"\nedition="2021"\n[lib]\npath="lib.rs"\n[workspace]\n');
    writeFileSync(join(folder, "lib.rs"), "");
    const plan = nativeWasiInvocation([], '/repo with spaces/and "quotes"', '/node with spaces/and "quotes"');
    const result = spawnSync("cargo", ["--config", plan.args[1], "metadata", "--offline", "--no-deps", "--format-version", "1", "--manifest-path", join(folder, "Cargo.toml")],
      { cwd: folder, encoding: "utf8", shell: false, timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).packages[0].name, "wasi-runner-contract");
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
