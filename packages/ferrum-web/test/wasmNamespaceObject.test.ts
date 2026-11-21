import { equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { WasmNamespace, initializeBridgeInWasmNamespace } from "../src/wasmNamespace.js";
import { WasmBridge } from "../src/wasmBridge.js";
import { guardWasmNamespaceObject, nativeWasmNamespaceObject } from "../src/wasmNamespaceObject.js";
import type { WasmBindingsFactory } from "../pkg/ferrum_core_factory.js";

const bytes = () => readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url));

test("isolated Bridge objects and returned checkpoints keep actual native receivers and reject cross-owner arguments", async () => {
  const input = await bytes(), a = await WasmNamespace.compile(input, 128), b = await WasmNamespace.compile(input, 128);
  const left = await initializeBridgeInWasmNamespace(a, WasmBridge.init);
  const right = await initializeBridgeInWasmNamespace(b, WasmBridge.init);
  const engine = left.engine(); engine.use_data_scene(); ok(engine.configure_gameplay_variable(1, 0, 0, 3, 7));
  equal(engine.time, engine.time); equal(guardWasmNamespaceObject(a, engine), engine);
  throws(() => guardWasmNamespaceObject(b, engine), /another/);
  const checkpoint = engine.capture_runtime_checkpoint(); ok(checkpoint);
  const raw = nativeWasmNamespaceObject(a, checkpoint!); ok(raw !== checkpoint);
  engine.set_gameplay_variable_value(1, 99); ok(engine.restore_runtime_checkpoint(checkpoint!)); equal(engine.gameplay_variable_value(1), 7);
  throws(() => right.engine().restore_runtime_checkpoint(checkpoint!), /Foreign/);
  checkpoint!.free(); checkpoint!.free(); throws(() => nativeWasmNamespaceObject(a, checkpoint!), /released/);
  engine.free(); engine.free(); throws(() => engine.time(), /released/);
  right.engine().free(); a.dispose(); b.dispose();
});

test("generated-object RuntimeError poisons its own target and later explicit disposal never enters native again", async () => {
  const input = await bytes(), ns = await WasmNamespace.compile(input, 64), other = await WasmNamespace.compile(input, 128);
  const bridge = await initializeBridgeInWasmNamespace(ns, WasmBridge.init);
  const peer = await initializeBridgeInWasmNamespace(other, WasmBridge.init);
  const checkpoint = bridge.engine().capture_runtime_checkpoint(); ok(checkpoint);
  // The ordinary mask uses fallible allocation. Its typed allocation rejection
  // must remain distinct from the allocator trap injected below.
  const mask = ns.call(bindings => guardWasmNamespaceObject(ns,
    new bindings.NativePixelMaskTerrain(1, 1, 1, false, new Uint8Array([0]))));
  const pointer = nativeWasmNamespaceObject(ns, bridge.engine());
  const before = peer.engine().time();
  throws(() => ns.call(bindings => new bindings.NativePixelMaskTerrain(4096, 4096, 1, false, new Uint8Array())), /allocation failed/);
  equal(ns.state().state, "ready");
  // Test-only private owner projection uses the real exported allocator; no
  // production callback or fake allocator is installed.
  const owner = ns as unknown as { factory: WasmBindingsFactory; module: WebAssembly.Module };
  const output = owner.factory.bindings.initSync({ module: owner.module });
  throws(() => ns.call(() => output.__wbindgen_malloc(8 * 1024 * 1024, 8)), /unreachable/);
  equal(ns.state().state, "poisoned"); throws(() => bridge.engine().time(), /poisoned/);
  checkpoint!.free(); mask.free(); bridge.engine().free();
  // Skipped cleanup did not consume the generated pointer or reenter its free.
  ok((pointer as unknown as { __wbg_ptr: number }).__wbg_ptr > 0);
  equal(peer.engine().time(), before); peer.engine().update(.01); ok(peer.engine().time() > before);
  peer.engine().free(); ns.dispose(); other.dispose();
});

test("a trap raised by a guarded object method is caught at that object's native boundary", async () => {
  const ns = await WasmNamespace.compile(await bytes(), 64); await ns.initialize();
  let calls = 0;
  // Deterministic boundary injection complements the actual native allocation
  // trap above and proves callers need not remember an outer namespace.call().
  const value = guardWasmNamespaceObject(ns, { fail() { calls++; throw new WebAssembly.RuntimeError("injected trap"); }, free() { calls++; } });
  throws(() => value.fail(), /injected/); equal(ns.state().state, "poisoned");
  throws(() => value.fail(), /poisoned/); value.free(); equal(calls, 1); ns.dispose();
});
