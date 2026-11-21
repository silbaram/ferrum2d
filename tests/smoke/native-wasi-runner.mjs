// Real WASI execution of Rust-only unit tests. Every non-WASI binding rejects calls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WASI } from "node:wasi";

export function forwardNativeWasiImports(wasiImport) {
  // 관측된 Node22 V8 FastAPI/GC host fault를 우회하도록 fd_write만 forwarding한다.
  return { ...wasiImport, fd_write: (...args) => wasiImport.fd_write(...args) };
}

export async function runNativeWasi(filename, args, { abortProbe = false } = {}) {
  assert(filename, "Usage: node tests/smoke/native-wasi-runner.mjs <wasm> [Rust test arguments]");
  const module = await WebAssembly.compile(readFileSync(filename));
  const allowed = new Set([
    "__wbindgen_placeholder__/__wbindgen_describe",
    "__wbindgen_placeholder__/__wbg___wbindgen_throw_9c75d47bf9e7731e",
    "__wbindgen_placeholder__/__wbg___wbindgen_memory_c2356dd1a089dfbd",
    // Public Result<_, JsValue> capture tests retain these cold error paths.
    // They remain rejecting stubs: normal Rust-only execution must call none.
    "__wbindgen_placeholder__/__wbg___wbindgen_debug_string_07cb72cfcc952e2b",
    "__wbindgen_placeholder__/__wbindgen_object_drop_ref",
    "__wbindgen_placeholder__/__wbindgen_describe_cast",
    "__wbindgen_externref_xform__/__wbindgen_externref_table_grow",
    "__wbindgen_externref_xform__/__wbindgen_externref_table_set_null",
  ]);
  const wasi = new WASI({ version: "preview1", args: [filename, ...args], env: {}, preopens: {}, returnOnExit: true });
  const imports = { wasi_snapshot_preview1: forwardNativeWasiImports(wasi.wasiImport) };
  let deniedBindingCalls = 0;
  const bindings = [];
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.module === "wasi_snapshot_preview1") continue;
    const key = `${entry.module}/${entry.name}`;
    assert.equal(entry.kind, "function");
    assert(allowed.has(key), `Unexpected non-WASI capability: ${key}`);
    bindings.push(key);
    (imports[entry.module] ??= {})[entry.name] = () => {
      deniedBindingCalls++;
      throw new Error(`Rust-only regression attempted JS binding: ${key}`);
    };
  }
  try {
    const instance = await WebAssembly.instantiate(module, imports);
    const exitCode = wasi.start(instance);
    assert.equal(exitCode, 0);
    assert.equal(deniedBindingCalls, 0);
    if (abortProbe) throw new Error("Abort probe unexpectedly returned without trapping");
    const result = { wasiRustOnly: true, deniedBindingCalls, rejectedCapabilities: bindings, exitCode };
    console.log(JSON.stringify(result));
    return result;
  } catch (error) {
    if (abortProbe) console.error(JSON.stringify({ nativeWasiAbortProbe: true, wasmExecutionSucceeded: false,
      deniedBindingCalls, rejectedCapabilities: bindings, errorName: error.name, errorMessage: error.message }));
    // The isolated probe must still exit1; the parent CLI validates the exact failure.
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const abortProbe = argv[0] === "--abort-probe";
  if (abortProbe) argv.shift();
  await runNativeWasi(argv[0], argv.slice(1), { abortProbe });
}
