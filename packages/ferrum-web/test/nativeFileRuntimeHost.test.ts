import { deepEqual, equal, ok } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createEngine, createEngineWithFramePipeline } from "../src/createEngine.js";
import { initializeFerrumWasm } from "../src/initializeFerrumWasm.js";
import { nativeFileEngineOwner, captureDetachedEngineMetadata } from "../src/nativeFileEngineOwner.js";
import { captureNativeFileRuntimeHost, admitNativeFileRuntimeHost, inspectNativeFileRuntimeHost, consumeNativeFileRuntimeHost, discardNativeFileRuntimeHost, registerNativeFileRuntimeHostBinding, NATIVE_FILE_RUNTIME_HOST_TYPES } from "../src/nativeFileRuntimeHost.js";
import { unregisterNativeFileHostBinding, registerNativeFileHostBinding } from "../src/nativeFileHostBindings.js";
import { ResourceBudget, NativeFileResourceError, type NativeFileResourceLimits } from "../src/nativeFileResourceBudget.js";
import { decodeNativeFileResourceGraph, encodeNativeFileResourceGraph } from "../src/nativeFileResourceCodec.js";
import { resolvePhysicsSpec } from "../src/physicsSpec.js";
import { resolvePresentationEffectRegistry } from "../src/presentationEffects.js";
import type { CreateEngineOptions, FerrumEngine } from "../src/engineTypes.js";

const empty = new Uint8Array([70,50,68,82,69,83,0,0,1,0,0,0,0,0,0,0]);
function throws(action: () => unknown, expected: (e: unknown) => boolean): void {
  let rejected = false; try { action(); } catch (e) { rejected = true; ok(expected(e), String(e)); } ok(rejected, "expected rejection");
}
const error = (code: string) => (e: unknown) => e instanceof NativeFileResourceError && e.code === code;
const data = () => readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url));
async function source(options: CreateEngineOptions = {}) { await initializeFerrumWasm(await data()); return createEngine(undefined, undefined, undefined, undefined, options); }
function doc(bytes: Uint8Array): any { return decodeNativeFileResourceGraph(bytes, empty, new ResourceBudget(), { maxDataBytes: 16 }); }
function encoded(v: unknown) { return encodeNativeFileResourceGraph(v, new ResourceBudget(), { maxDataBytes: 16 }).manifestBytes; }
function nativeBytes(engine: FerrumEngine) { return nativeFileEngineOwner(engine).native.capture_native_file(new TextEncoder().encode("{}{}{}{}{}{}"), new Uint32Array([2,2,2,2,2,2]), 0, 0, new Uint32Array()); }

test("actual headless facade saves initial/current metadata with no registered host references and remains executable", async () => {
  const engine = await source(); const before = nativeBytes(engine), metadata = captureDetachedEngineMetadata(nativeFileEngineOwner(engine));
  try {
    const capture = captureNativeFileRuntimeHost(engine, new ResourceBudget()); capture.assertCurrent();
    const owner = {}, token = admitNativeFileRuntimeHost(owner, capture.bytes, new ResourceBudget());
    const inspected = inspectNativeFileRuntimeHost(owner, token); deepEqual(inspected.metadata, metadata); equal(inspected.resolvedReferences.length, 0);
    equal(Object.isFrozen(inspected.metadata.physicsSpec.solver), true); equal(Object.isFrozen(inspected.frameData), true);
    deepEqual(nativeBytes(engine), before); equal(consumeNativeFileRuntimeHost(owner, token), inspected);
    throws(() => inspectNativeFileRuntimeHost(owner, token), error("CAPABILITY")); discardNativeFileRuntimeHost(owner, token);
    const checkpoint = engine.captureRuntimeCheckpoint(); for (let i = 0; i < 6; i++) nativeFileEngineOwner(engine).native.update(.01);
    const after = nativeBytes(engine), endTime = engine.time(); engine.restoreRuntimeCheckpoint(checkpoint); for (let i = 0; i < 6; i++) nativeFileEngineOwner(engine).native.update(.01);
    // Same-engine checkpoint restore deliberately increments revision; physics time is exact.
    ok(after.length > 0); equal(engine.time(), endTime); checkpoint.dispose();
  } finally { engine.destroy(); }
});

test("explicit legacy raw -0, undefined, key order, old initial spec and changed current clock/cache are preserved without native repair", async () => {
  const engine = await source({ physicsBackend: "legacy", includeAudioEvents: undefined, fixedTimestep: { maxFrameSeconds: -0, maxStepsPerUpdate: 0, enabled: false }, effectEvents: false });
  try {
    engine.configureFixedTimestep({ enabled: false, stepSeconds: -0, maxFrameSeconds: -0, maxStepsPerUpdate: 0 });
    const owner = nativeFileEngineOwner(engine); owner.frame.lastViewportWidth = -0; owner.frame.lastViewportHeight = -3; owner.frame.viewportDirty = undefined;
    const cap = captureNativeFileRuntimeHost(engine, new ResourceBudget()); const token = admitNativeFileRuntimeHost(engine, cap.bytes, new ResourceBudget());
    const saved = inspectNativeFileRuntimeHost(engine, token);
    equal(Object.is(saved.metadata.physicsSpec.solver.stepSeconds, -0), true); ok(saved.metadata.initialPhysicsSpec.solver.stepSeconds > 0);
    equal(Object.is(saved.metadata.lastViewportWidth, -0), true); equal(saved.metadata.lastViewportHeight, -3);
    deepEqual(Object.keys(saved.optionsData), Object.keys(owner.options)); ok(Object.prototype.hasOwnProperty.call(saved.optionsData, "includeAudioEvents")); equal(saved.optionsData.includeAudioEvents, undefined);
    equal(Object.is((saved.optionsData.fixedTimestep as any).maxFrameSeconds, -0), true);
    discardNativeFileRuntimeHost(engine, token); cap.assertCurrent();
  } finally { engine.destroy(); }
});

test("explicit role references resolve without invoking callback/target and save effect data independently of later source mutation", async () => {
  await initializeFerrumWasm(await data()); let calls = 0;
  const onFrame = () => { calls++; }, onRenderFrame = () => { calls++; }, onStart = () => { calls++; }, hasSound = () => { calls++; return true; };
  class Target { playSoundEffect() { calls++; } }
  const target = new Target(), registry = resolvePresentationEffectRegistry({ pop: { effectId: 3, kind: "sound", soundId: 9, intensity: -0, tags: ["a"] } });
  const engine = await createEngineWithFramePipeline({ onFrame, onRenderFrame, needsFrameState: false, needsPhysicsDebugLineBuffer: true }, undefined, undefined, undefined,
    { lifecycle: { onStart, onStop: undefined }, effectEvents: { registry, assetValidation: "error", path: "saved", unknownEffect: "passthrough", requireKindMatch: false, missingHandler: "ignore", hasSoundEffect: hasSound, target } });
  const bindingOwner = {};
  try {
    registerNativeFileRuntimeHostBinding(bindingOwner, "frame.onFrame", "source.onFrame", onFrame);
    registerNativeFileRuntimeHostBinding(bindingOwner, "frame.onRenderFrame", "source.render", onRenderFrame);
    registerNativeFileRuntimeHostBinding(bindingOwner, "options.lifecycle.onStart", "start", onStart);
    registerNativeFileRuntimeHostBinding(bindingOwner, "options.effectEvents.hasSoundEffect", "sounds", hasSound);
    registerNativeFileRuntimeHostBinding(bindingOwner, "options.effectEvents.target", "effect.target", target);
    const cap = captureNativeFileRuntimeHost(engine, new ResourceBudget(), bindingOwner); equal(calls, 0);
    (registry.effects.pop.tags as string[]).push("later"); throws(cap.assertCurrent, error("STALE"));
    const token = admitNativeFileRuntimeHost(bindingOwner, cap.bytes, new ResourceBudget()), saved = inspectNativeFileRuntimeHost(bindingOwner, token);
    equal(calls, 0); equal(saved.resolvedReferences.length, 5); equal(saved.resolvedReferences.find(r => r.role === "frame.onRenderFrame")?.value, onRenderFrame);
    const effects = saved.optionsData.effectEvents as any;
    deepEqual(effects.registry.effects.pop.tags, ["a"]); equal(Object.is(effects.registry.effects.pop.intensity, -0), true);
    equal(effects.registry.effects.pop, effects.registry.byId[3]); equal(effects.target, null); equal(effects.hasSoundEffect, null);
    equal((saved.optionsData.lifecycle as any).onStart, null); ok(Object.prototype.hasOwnProperty.call(saved.optionsData.lifecycle, "onStop"));
    equal(saved.frameData.onRenderFrame, null); equal(saved.frameData.needsFrameState, false); equal(calls, 0);
    consumeNativeFileRuntimeHost(bindingOwner, token); equal(calls, 0);
  } finally { engine.destroy(); }
});

test("unregistered identity and source getter are rejected with no callback/accessor invocation", async () => {
  await initializeFerrumWasm(await data()); let calls = 0; const onFrame = () => { calls++; };
  const engine = await createEngine(onFrame);
  try {
    throws(() => captureNativeFileRuntimeHost(engine, new ResourceBudget()), error("CAPABILITY")); equal(calls, 0);
    const owner = nativeFileEngineOwner(engine);
    Object.defineProperty(owner.options, "includeAudioEvents", { configurable: true, enumerable: true, get() { calls++; return true; } });
    throws(() => captureNativeFileRuntimeHost(engine, new ResourceBudget()), error("CAPABILITY")); equal(calls, 0);
    delete owner.options.includeAudioEvents;
    Object.defineProperty(owner.frame.physicsSpec.solver, "stepSeconds", { enumerable: true, configurable: true, get() { calls++; return .01; } });
    registerNativeFileRuntimeHostBinding(engine, "frame.onFrame", "onFrame", onFrame);
    throws(() => captureNativeFileRuntimeHost(engine, new ResourceBudget()), error("CAPABILITY")); equal(calls, 0);
  } finally { engine.destroy(); }
});

test("source fence detects frame identity, nested values, preset order and registry revision without recapturing native", async () => {
  const engine = await source();
  try {
    const owner = nativeFileEngineOwner(engine), cap = captureNativeFileRuntimeHost(engine, new ResourceBudget());
    owner.frame.physicsSpec = structuredClone(owner.frame.physicsSpec); throws(cap.assertCurrent, error("STALE"));
    const second = captureNativeFileRuntimeHost(engine, new ResourceBudget()); owner.frame.physicsSpec.debug.ccd = !owner.frame.physicsSpec.debug.ccd; throws(second.assertCurrent, error("STALE"));
    const third = captureNativeFileRuntimeHost(engine, new ResourceBudget()); (owner.particlePresetIds as Set<number>).add(9); throws(third.assertCurrent, error("STALE"));
    const fourth = captureNativeFileRuntimeHost(engine, new ResourceBudget()); registerNativeFileRuntimeHostBinding(engine, "frame.onFrame", "unused", () => {}); throws(fourth.assertCurrent, error("STALE"));
  } finally { engine.destroy(); }
});

test("host token is owner-bound, one-use and invalid after binding registry mutation; discard does not dispose host values", async () => {
  await initializeFerrumWasm(await data()); let calls = 0; const onFrame = () => { calls++; };
  const engine = await createEngine(onFrame), owner = {};
  try {
    registerNativeFileRuntimeHostBinding(owner, "frame.onFrame", "frame", onFrame);
    const cap = captureNativeFileRuntimeHost(engine, new ResourceBudget(), owner), token = admitNativeFileRuntimeHost(owner, cap.bytes, new ResourceBudget());
    throws(() => inspectNativeFileRuntimeHost({}, token), error("CAPABILITY")); throws(() => consumeNativeFileRuntimeHost({}, token), error("CAPABILITY"));
    unregisterNativeFileHostBinding(owner, NATIVE_FILE_RUNTIME_HOST_TYPES["frame.onFrame"], "frame");
    throws(() => inspectNativeFileRuntimeHost(owner, token), error("STALE")); throws(() => consumeNativeFileRuntimeHost(owner, token), error("STALE"));
    discardNativeFileRuntimeHost(owner, token); discardNativeFileRuntimeHost(owner, token); equal(calls, 0);
  } finally { engine.destroy(); }
});

function richSpec() {
  const colliders = [
    { shape: "aabb", halfSize: [1,2] }, { shape: "box", size: [2,3] }, { shape: "circle", radius: .5 },
    { shape: "capsule", start: [0,0], end: [0,1], radius: .2 }, { shape: "orientedBox", halfSize: [.5,.8], rotationRadians: -.2 },
    { shape: "convexPolygon", vertices: [[0,0],[2,0],[1,1]], rotationRadians: -0 },
    { shape: "edge", start: [0,0], end: [1,0] }, { shape: "chain", vertices: [[0,0],[1,0],[1,1]], loop: true },
  ];
  return resolvePhysicsSpec({ mode: "rigid", gravity: [-0,-9.8], continuous: false,
    hd2d: { enabled: true, defaultHeight: 2, maxStepHeight: .3, maxDropHeight: .7 },
    materials: { rubber: { friction: 3, restitution: 2, density: .25 } }, layers: { a: { mask: ["a","b","a"] }, b: { mask: [] } },
    bodies: {
      a: { type: "dynamic", material: "rubber", layer: "a", floor: "upstairs", height: 3, elevation: -5, mass: 2, inertia: 3, gravityScale: -1, angularVelocityRadiansPerSecond: -.5, fixedRotation: false, colliders },
      b: { type: "kinematic", enabled: true, collider: { shape: "circle", radius: .25 }, kinematicController: { solidMaskBits: 0xffffffff, maxIterations: 8, maxStepHeight: 65536, maxDropHeight: -0, allowLedgeDrop: false } },
    },
    joints: Object.fromEntries(["distance","rope","spring","pulley","revolute","prismatic","weld","gear"].map((type, i) => [`j${i}`, {
      type, bodyA: "a", bodyB: i === 0 ? "world" : "b", anchor: [-0,2], localAxisA: [1,0],
      limit: { enabled: true, lower: 2, upper: -1, continuous: type === "revolute" },
      motor: { enabled: false, speed: -2, maxForce: 4, maxTorque: 2 }, ratio: type === "pulley" ? .5 : -1,
      ...(type === "spring" ? { frequencyHz: 1000, dampingRatio: 10 } : {}), breakForce: -0, breakTorque: 2, breakDistance: 3, breakAngle: 4,
    }])), debug: { colliders: true, contacts: true, manifolds: true, broadphase: true, joints: true, sleeping: true, layers: true, ccd: true },
  });
}

test("all resolved body/collider/joint variants and world endpoint retain source data and order", async () => {
  const engine = await source();
  try {
    const spec = richSpec(); nativeFileEngineOwner(engine).frame.physicsSpec = spec;
    const cap = captureNativeFileRuntimeHost(engine, new ResourceBudget()); const token = admitNativeFileRuntimeHost(engine, cap.bytes, new ResourceBudget());
    deepEqual(inspectNativeFileRuntimeHost(engine, token).metadata.physicsSpec, spec); discardNativeFileRuntimeHost(engine, token); cap.assertCurrent();
  } finally { engine.destroy(); }
});

test("typed malformed host data reject without touching source native bytes: every structural family", async () => {
  const engine = await source();
  try {
    nativeFileEngineOwner(engine).frame.physicsSpec = richSpec(); const cap = captureNativeFileRuntimeHost(engine, new ResourceBudget()), original = cap.bytes.slice(), before = nativeBytes(engine);
    const mutations: ((d: any) => void)[] = [
      d => d.version = 2, d => d.unrecognized = true, d => d.options.physicsBackend = "other", d => d.options.fixedTimestep = { bad: 1 },
      d => d.options.enablePhysicsDebugLines = { layers: 3 }, d => d.frame.needsFrameState = 1,
      d => d.metadata.physicsSpecScene = 5, d => d.metadata.particlePresetIds = [1,1], d => d.metadata.viewportDirty = 1,
      d => d.metadata.physicsSpec.mode = "no", d => d.metadata.initialPhysicsSpec.solver.stepSeconds = null,
      d => d.metadata.physicsSpec.solver.velocityIterations = -.5, d => d.metadata.physicsSpec.hd2d.maxDropHeight = -1,
      d => d.metadata.physicsSpec.materials.rubber.density = 0, d => d.metadata.physicsSpec.layers.a.maskBits = 0,
      d => d.metadata.physicsSpec.layers.a.mask = ["missing"], d => d.metadata.physicsSpec.bodies.a.material = "missing",
      d => d.metadata.physicsSpec.bodies.a.colliders[0].halfWidth = 0, d => d.metadata.physicsSpec.bodies.a.colliders[2].radius = -1,
      d => d.metadata.physicsSpec.bodies.a.colliders[3].endY = 0, d => d.metadata.physicsSpec.bodies.a.colliders[5].vertices[2] = { x: 4, y: 0 },
      d => d.metadata.physicsSpec.bodies.a.colliders[7].loop = 1, d => d.metadata.physicsSpec.bodies.b.kinematicController.maxIterations = 9,
      d => d.metadata.physicsSpec.joints.j0.bodyA = "missing", d => d.metadata.physicsSpec.joints.j1.bodyB = "a",
      d => d.metadata.physicsSpec.joints.j2.frequencyHz = 1001, d => d.metadata.physicsSpec.joints.j3.ratio = 0,
      d => d.metadata.physicsSpec.joints.j4.stiffness = 2, d => d.metadata.physicsSpec.joints.j6.continuousLimit = true,
      d => d.metadata.physicsSpec.debug.contacts = 0,
    ];
    for (const mutate of mutations) { const damaged = doc(cap.bytes); mutate(damaged); const bytes = encoded(damaged), own = bytes.slice(); throws(() => admitNativeFileRuntimeHost({}, bytes, new ResourceBudget()), error("DATA")); deepEqual(bytes, own); }
    deepEqual(cap.bytes, original); deepEqual(nativeBytes(engine), before); cap.assertCurrent();
  } finally { engine.destroy(); }
});

test("binding row missing/duplicate/role/kind/version/symbol tampering cannot bypass actual registered identity", async () => {
  await initializeFerrumWasm(await data()); const callback = () => {}, engine = await createEngine(callback);
  try {
    registerNativeFileRuntimeHostBinding(engine, "frame.onFrame", "registered", callback); const cap = captureNativeFileRuntimeHost(engine, new ResourceBudget());
    const mutations: [((d: any) => void), string][] = [
      [d => d.bindings = [], "DATA"], [d => d.bindings.push(d.bindings[0]), "DATA"], [d => d.bindings[0].role = "frame.onRenderFrame", "DATA"],
      [d => d.bindings[0].reference.kind = "unknown", "CAPABILITY"], [d => d.bindings[0].reference.version = 2, "CAPABILITY"], [d => d.bindings[0].reference.symbol = "missing", "CAPABILITY"],
    ];
    for (const [mutate, code] of mutations) { const d = doc(cap.bytes); mutate(d); const bytes = encoded(d); throws(() => admitNativeFileRuntimeHost(engine, bytes, new ResourceBudget()), error(code)); }
    const before = nativeBytes(engine); throws(() => admitNativeFileRuntimeHost({}, cap.bytes, new ResourceBudget()), error("CAPABILITY")); deepEqual(nativeBytes(engine), before);
  } finally { engine.destroy(); }
});

test("capture/admit consume shared ledger with deterministic exact and one-below work/metadata/source/decoded quotas", async () => {
  const engine = await source();
  try {
    const first = new ResourceBudget(), captured = captureNativeFileRuntimeHost(engine, first), admittedBudget = new ResourceBudget();
    const token = admitNativeFileRuntimeHost(engine, captured.bytes, admittedBudget); discardNativeFileRuntimeHost(engine, token);
    const limitKeys = { work: "maxWork", metadataBytes: "maxMetadataBytes", sourceBytes: "maxSourceBytes", decodedBytes: "maxDecodedBytes" } as const;
    for (const [usageKey, limitKey] of Object.entries(limitKeys) as [keyof typeof limitKeys, keyof NativeFileResourceLimits][]) {
      const captureUsed = first.usage()[usageKey], admitUsed = admittedBudget.usage()[usageKey]; ok(captureUsed > 0); ok(admitUsed > 0);
      const exact = captureNativeFileRuntimeHost(engine, new ResourceBudget({ [limitKey]: captureUsed })); deepEqual(exact.bytes, captured.bytes);
      throws(() => captureNativeFileRuntimeHost(engine, new ResourceBudget({ [limitKey]: captureUsed - 1 })), error("LIMIT"));
      const exactToken = admitNativeFileRuntimeHost(engine, captured.bytes, new ResourceBudget({ [limitKey]: admitUsed })); discardNativeFileRuntimeHost(engine, exactToken);
      throws(() => admitNativeFileRuntimeHost(engine, captured.bytes, new ResourceBudget({ [limitKey]: admitUsed - 1 })), error("LIMIT"));
    }
    const shared = new ResourceBudget({ maxWork: first.usage().work + admittedBudget.usage().work - 1 });
    const cap = captureNativeFileRuntimeHost(engine, shared); throws(() => admitNativeFileRuntimeHost(engine, cap.bytes, shared), error("LIMIT"));
  } finally { engine.destroy(); }
});

test("effect indexes preserve shared versus equal-distinct objects; data/reference corruption rejects independently", async () => {
  const registry = resolvePresentationEffectRegistry({ effect: { effectId: 8, kind: "particle", particlePresetId: 5, intensity: -0, radius: 0, key: "fx", tags: ["fx"] } });
  (registry.byId as Record<number, unknown>)[8] = structuredClone(registry.effects.effect);
  const engine = await source({ effectEvents: { registry, requireKindMatch: undefined } });
  try {
    const cap = captureNativeFileRuntimeHost(engine, new ResourceBudget()), token = admitNativeFileRuntimeHost(engine, cap.bytes, new ResourceBudget());
    const effect = inspectNativeFileRuntimeHost(engine, token).optionsData.effectEvents as any;
    ok(effect.registry.effects.effect !== effect.registry.byId[8]); deepEqual(effect.registry.effects.effect, effect.registry.byId[8]);
    const mutations: ((d: any) => void)[] = [
      d => d.options.effectEvents.assetValidation = "other", d => d.options.effectEvents.requireKindMatch = 0,
      d => d.options.effectEvents.registry.byId[8].kind = "sound", d => d.options.effectEvents.registry.byId[8].unknown = true,
      d => d.options.effectEvents.registry.effects.effect.effectId = 0,
      d => d.options.effectEvents.registry.effects.effect.tags = [""], d => d.options.effectEvents.registry.ids.effects.effect = 9,
      d => d.options.effectEvents.registry.effects.effect.intensity = -1,
    ];
    for (const mutate of mutations) { const d = doc(cap.bytes); mutate(d); throws(() => admitNativeFileRuntimeHost(engine, encoded(d), new ResourceBudget()), error("DATA")); }
    discardNativeFileRuntimeHost(engine, token);
  } finally { engine.destroy(); }
});

test("source getter added after capture is rejected by descriptor fence without evaluation, including busy/dead sources", async () => {
  const engine = await source(); let calls = 0;
  const cap = captureNativeFileRuntimeHost(engine, new ResourceBudget()), owner = nativeFileEngineOwner(engine);
  Object.defineProperty(owner.options, "includeAudioEvents", { enumerable: true, configurable: true, get() { calls++; return false; } });
  throws(cap.assertCurrent, error("STALE")); equal(calls, 0); delete owner.options.includeAudioEvents;
  engine.destroy(); throws(cap.assertCurrent, e => e instanceof Error); equal(calls, 0);
});

test("all host callback roles including input/viewport resolve registered adapters without running any host code", async () => {
  const engine = await source(), sourceOwner = nativeFileEngineOwner(engine), resolver = {};
  let calls = 0; const identities: Record<string, object> = {}, adapters: Record<string, object> = {};
  const frame = sourceOwner.frame as unknown as Record<string, unknown>, options = sourceOwner.options as unknown as Record<string, unknown>;
  options.lifecycle = {}; options.effectEvents = { registry: resolvePresentationEffectRegistry({}) };
  const roles = Object.keys(NATIVE_FILE_RUNTIME_HOST_TYPES) as (keyof typeof NATIVE_FILE_RUNTIME_HOST_TYPES)[];
  try {
    for (const role of roles) {
      const identity = role.endsWith(".target") ? {} : () => { calls++; };
      const adapter = role.endsWith(".target") ? { target: true } : () => { calls++; };
      identities[role] = identity; adapters[role] = adapter;
      const [root, parent, child] = role.split(".");
      if (root === "frame") frame[parent] = identity;
      else (options[parent] as Record<string, unknown>)[child] = identity;
      registerNativeFileRuntimeHostBinding(resolver, role, role, adapter, identity);
    }
    const cap = captureNativeFileRuntimeHost(engine, new ResourceBudget(), resolver), token = admitNativeFileRuntimeHost(resolver, cap.bytes, new ResourceBudget());
    const saved = consumeNativeFileRuntimeHost(resolver, token); equal(saved.resolvedReferences.length, roles.length);
    for (const row of saved.resolvedReferences) { equal(row.value, adapters[row.role]); ok(row.value !== identities[row.role]); }
    equal(calls, 0);
  } finally { engine.destroy(); }
});

test("legacy creation preserves finite signed clock inputs before native clamp, while actual unified Data scene code4 is admitted", async () => {
  const legacy = await source({ physicsBackend: "legacy", fixedTimestep: { stepSeconds: -0, maxFrameSeconds: -1, maxStepsPerUpdate: -1.5 } });
  try {
    const cap = captureNativeFileRuntimeHost(legacy, new ResourceBudget()), token = admitNativeFileRuntimeHost(legacy, cap.bytes, new ResourceBudget());
    const saved = inspectNativeFileRuntimeHost(legacy, token); equal(Object.is(saved.metadata.initialPhysicsSpec.solver.stepSeconds, -0), true);
    equal((saved.optionsData.fixedTimestep as any).maxStepsPerUpdate, -1.5); discardNativeFileRuntimeHost(legacy, token);
  } finally { legacy.destroy(); }
  const unified = await source({ physicsBackend: "unified", fixedTimestep: false });
  try {
    unified.useDataScene(); const cap = captureNativeFileRuntimeHost(unified, new ResourceBudget()), token = admitNativeFileRuntimeHost(unified, cap.bytes, new ResourceBudget());
    equal(inspectNativeFileRuntimeHost(unified, token).metadata.physicsSpecScene, 4); discardNativeFileRuntimeHost(unified, token);
  } finally { unified.destroy(); }
});

test("presentation resolver's whitespace and wide finite integer/history data survive rather than acquiring unrelated ID bounds", async () => {
  const registry = resolvePresentationEffectRegistry({ " ": { effectId: 1, kind: "sound", soundId: 2 ** 54, particlePresetId: 2 ** 55, key: " ", tags: [" "] } }, { ids: { items: { retained: -3.75, zero: -0 } } });
  const engine = await source({ effectEvents: { registry } });
  try {
    const owner = nativeFileEngineOwner(engine); owner.frame.physicsSpec = resolvePhysicsSpec({ mode: "none", solver: { velocityIterations: 2 ** 54 } });
    const cap = captureNativeFileRuntimeHost(engine, new ResourceBudget()), token = admitNativeFileRuntimeHost(engine, cap.bytes, new ResourceBudget());
    const saved = inspectNativeFileRuntimeHost(engine, token), effects = saved.optionsData.effectEvents as any;
    equal(effects.registry.effects[" "].soundId, 2 ** 54); deepEqual(effects.registry.effects[" "].tags, [" "]);
    equal(effects.registry.ids.items.retained, -3.75); equal(Object.is(effects.registry.ids.items.zero, -0), true);
    equal(saved.metadata.physicsSpec.solver.velocityIterations, 2 ** 54); discardNativeFileRuntimeHost(engine, token);
  } finally { engine.destroy(); }
});
