import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createEngine, createDetachedEngineFacade } from "../src/createEngine.js";
import { initializeFerrumWasm } from "../src/initializeFerrumWasm.js";
import { captureDetachedEngineMetadata, nativeFileEngineOwner } from "../src/nativeFileEngineOwner.js";
import { captureNativeFileCut, NativeFileUnpublishedTarget, type NativeFileSdkSections } from "../src/nativeFileRuntimeNative.js";
import { ResourceBudget } from "../src/nativeFileResourceBudget.js";
import { WasmNamespace } from "../src/wasmNamespace.js";
import { NATIVE_FILE_SDK_BUILD } from "../src/nativeFileSdkBuild.js";
import { wasm_memory } from "../pkg/ferrum_core.js";

const wasm = () => readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url));
const utf8 = new TextEncoder();
function sections(): NativeFileSdkSections {
  return { variables: utf8.encode("{}"), authoring: utf8.encode("{}"), resourceManifest: utf8.encode("{}"),
    resourceData: utf8.encode("{}"), dialogueQuest: utf8.encode("{}"), hostBindings: utf8.encode("{}") };
}
async function source() {
  await initializeFerrumWasm(await wasm());
  const engine = await createEngine(); engine.useDataScene();
  engine.configureUnifiedPhysics({ space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: .01 });
  const body = engine.spawnUnifiedPhysicsBody({ linearVelocity: [.25, .5, 0], canSleep: false, collider: { shape: { type: "sphere", radius: .2 } } });
  const native = nativeFileEngineOwner(engine).native; ok(native.configure_gameplay_variable(7, 1, 0, -3.25, 17.25));
  engine.stepRigidBodies(.01);
  return { engine, native, body };
}

test("actual native file cut preserves opaque SDK bytes, admitted facts, single-use installation and six-tick physics", async () => {
  const data = await wasm(), src = await source(), sdk = sections(), file = captureNativeFileCut(src.native, sdk, new ResourceBudget()), original = file.slice();
  const owner = nativeFileEngineOwner(src.engine), saved = captureDetachedEngineMetadata(owner);
  let target: NativeFileUnpublishedTarget | undefined;
  let facade: Awaited<ReturnType<typeof createDetachedEngineFacade>> | undefined;
  try {
    target = await NativeFileUnpublishedTarget.prepare(data, file, new ResourceBudget());
    deepEqual(file, original); equal(target.facts.scene, "data"); equal(target.facts.dataSceneEpoch, src.native.data_scene_epoch());
    equal(target.facts.configurationRevision, src.native.spatial_configuration_revision());
    deepEqual(target.facts.variableLayout, [{ slot: 7, type: "real", scope: "global", default: -3.25 }]);
    equal(target.facts.classify(src.body), "live-exact"); deepEqual(target.sdkSections(), sdk);
    equal(target.placeholderBridge.engine().gameplay_variable_is_configured(7), false);
    const nextSdk = { ...sdk, hostBindings: utf8.encode('{"opaque":"host-section"}') };
    const repacked = target.repackSdkSections(nextSdk), check = await NativeFileUnpublishedTarget.prepare(data, repacked, new ResourceBudget());
    try { deepEqual(check.sdkSections(), nextSdk); deepEqual(check.facts.variableLayout, target.facts.variableLayout); }
    finally { check.dispose(); }
    // This unit checks the native participant; SDK sections above are explicitly
    // opaque. No whole-file Ready token or platform publication is issued here.
    target.installAfterSdkAdmission(); equal(target.placeholderBridge.engine().gameplay_variable_value(7), 17.25);
    throws(() => target!.installAfterSdkAdmission(), /STALE/); throws(() => target!.sdkSections(), /STALE/);
    facade = await createDetachedEngineFacade(target.placeholderBridge, saved, {}, undefined, undefined, undefined, owner.options);
    deepEqual(captureNativeFileCut(target.placeholderBridge.engine(), sdk, new ResourceBudget()), file);
    const handles = new Uint32Array([src.body.entityId, src.body.entityGeneration]);
    for (let i = 0; i < 6; i++) {
      src.engine.stepRigidBodies(.01); facade.stepRigidBodies(.01);
      const a = src.engine.queryUnifiedPhysicsBodyStates(handles), b = facade.queryUnifiedPhysicsBodyStates(handles);
      deepEqual(b.words, a.words); deepEqual(b.floats, a.floats);
      deepEqual(captureNativeFileCut(target.placeholderBridge.engine(), sdk, new ResourceBudget()), captureNativeFileCut(src.native, sdk, new ResourceBudget()));
    }
  } finally { facade?.destroy(); target?.dispose(); src.engine.destroy(); }
});

test("native prepare compatibility/capacity failures leave source memory, held views and checkpoint continuation intact", async () => {
  const data = await wasm(), src = await source(), sdk = sections(), file = captureNativeFileCut(src.native, sdk, new ResourceBudget());
  const checkpoint = src.engine.captureRuntimeCheckpoint();
  const wrong = src.native.capture_native_file(utf8.encode("{}{}{}{}{}{}"), new Uint32Array([2, 2, 2, 2, 2, 2]), (NATIVE_FILE_SDK_BUILD[0] ^ 1) >>> 0, NATIVE_FILE_SDK_BUILD[1], new Uint32Array());
  const memory = wasm_memory(), buffer = memory.buffer, before = new Uint8Array(buffer).slice(), held = new Uint8Array(buffer, 0, 32);
  try {
    await rejects(NativeFileUnpublishedTarget.prepare(data, wrong, new ResourceBudget()), /native-file.prepare:3/);
    const corrupt = file.slice(); corrupt[corrupt.length - 1] ^= 1;
    await rejects(NativeFileUnpublishedTarget.prepare(data, corrupt, new ResourceBudget()), /native-file.prepare:3/);
    await rejects(NativeFileUnpublishedTarget.prepare(new Uint8Array(), file, new ResourceBudget({ maxSourceBytes: 0 })), /LIMIT/);
    await rejects(NativeFileUnpublishedTarget.prepare(new Uint8Array(), file, new ResourceBudget(), { limits: new Uint32Array([1]) }), /LIMITS/);
    equal(memory.buffer, buffer); equal(held.length, 32); deepEqual(new Uint8Array(buffer), before);
    const trace = () => Array.from({ length: 6 }, (_, i) => {
      src.native.increment_gameplay_variable_value(7, i + 1); src.engine.stepRigidBodies(.01);
      return [...src.engine.queryUnifiedPhysicsBodyStates(new Uint32Array([src.body.entityId, src.body.entityGeneration])).floats];
    });
    const first = trace(); src.engine.restoreRuntimeCheckpoint(checkpoint); deepEqual(trace(), first);
  } finally { checkpoint.dispose(); src.engine.destroy(); }
});

test("actual constructor memory trap disposes only the new target and keeps source native bytes unchanged", async () => {
  const data = await wasm(), src = await source(), file = captureNativeFileCut(src.native, sections(), new ResourceBudget());
  const sizing = new WasmNamespace(data, 65536); await sizing.initialize();
  const minimumPages = sizing.memory().buffer.byteLength / 65536; sizing.dispose();
  const memory = wasm_memory(), buffer = memory.buffer, before = new Uint8Array(buffer).slice(), held = new Uint8Array(buffer, 0, 16);
  try {
    await rejects(NativeFileUnpublishedTarget.prepare(data, file, new ResourceBudget(), { maximumMemoryPages: minimumPages }), /unreachable/);
    equal(memory.buffer, buffer); equal(held.length, 16); deepEqual(new Uint8Array(buffer), before);
    equal(src.native.gameplay_variable_value(7), 17.25); src.engine.stepRigidBodies(.01);
    ok(src.engine.queryUnifiedPhysicsBodyStates(new Uint32Array([src.body.entityId, src.body.entityGeneration])).count > 0);
  } finally { src.engine.destroy(); }
});
