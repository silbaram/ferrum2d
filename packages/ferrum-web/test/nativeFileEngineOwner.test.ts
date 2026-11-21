import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createEngine, createDetachedEngineFacade } from "../src/createEngine.js";
import { initializeFerrumWasm } from "../src/initializeFerrumWasm.js";
import { captureDetachedEngineMetadata, nativeFileEngineOwner } from "../src/nativeFileEngineOwner.js";
import { WasmNamespace, initializeBridgeInWasmNamespace } from "../src/wasmNamespace.js";
import { WasmBridge } from "../src/wasmBridge.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import { encodeUnifiedPhysicsWorld } from "../src/unifiedPhysics.js";

const bytes = () => readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url));

test("detached facade attaches actual adapters without resetting installed native clock, state or source", async () => {
  const input = await bytes(); await initializeFerrumWasm(input);
  const source = await createEngine(undefined, undefined, undefined, undefined, { fixedTimestep: false });
  const sourceOwner = nativeFileEngineOwner(source);
  let metadata = captureDetachedEngineMetadata(sourceOwner);
  const namespace = await WasmNamespace.compile(input, 128);
  const bridge = await initializeBridgeInWasmNamespace(namespace, WasmBridge.init), native = bridge.engine();
  native.use_data_scene();
  const world = encodeUnifiedPhysicsWorld({ space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: .01 });
  native.configure_unified_physics_world(world.metadata, world.values);
  ok(native.configure_gameplay_variable(1, 0, 0, 3, 37)); native.update(.031);
  const originalTime = native.time(), sourceTime = source.time();
  metadata.physicsSpec.solver.fixedTimestep = true;
  metadata.physicsSpec.solver.stepSeconds = .01;
  metadata = { ...metadata, physicsSpecScene: native.default_physics_policy_scene() };
  const target = await createDetachedEngineFacade(bridge, metadata, {}, undefined, undefined, undefined, { fixedTimestep: false });
  const owner = nativeFileEngineOwner(target);
  equal(owner.native, native); equal(native.fixed_timestep_enabled(), true);
  equal(target.time(), originalTime); equal(native.gameplay_variable_value(1), 37); equal(source.time(), sourceTime);
  equal(owner.frame.physicsSpec.solver.stepSeconds, .01);
  metadata.physicsSpec.solver.stepSeconds = .05;
  equal(owner.frame.physicsSpec.solver.stepSeconds, .01);
  deepEqual(captureDetachedEngineMetadata(sourceOwner), captureDetachedEngineMetadata(nativeFileEngineOwner(source)));
  const checkpoint = target.captureRuntimeCheckpoint(); native.increment_gameplay_variable_value(1, 2);
  target.restoreRuntimeCheckpoint(checkpoint); equal(native.gameplay_variable_value(1), 37); checkpoint.dispose();
  target.destroy(); throws(() => nativeFileEngineOwner(target), /destroyed/); namespace.dispose();
  equal(source.time(), sourceTime); source.destroy();
});

test("native file ownership rejects fabricated facades and active RAF until the real owner stops", async () => {
  await initializeFerrumWasm(await bytes());
  throws(() => nativeFileEngineOwner({} as FerrumEngine), /actual/);
  const beforeRequest = globalThis.requestAnimationFrame, beforeCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  const engine = await createEngine();
  try {
    const owner = nativeFileEngineOwner(engine); engine.start();
    throws(() => nativeFileEngineOwner(engine), /Stop/);
    throws(() => captureDetachedEngineMetadata(owner), /active/);
    engine.stop(); equal(nativeFileEngineOwner(engine), owner);
  } finally {
    engine.destroy(); globalThis.requestAnimationFrame = beforeRequest; globalThis.cancelAnimationFrame = beforeCancel;
  }
});
