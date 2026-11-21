import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as original from "../pkg/ferrum_core.js";
import type { WasmBindingsFactory } from "../pkg/ferrum_core_factory.js";
import { WasmNamespace } from "../src/wasmNamespace.js";
import { guardWasmNamespaceObject, nativeWasmNamespaceObject, wasmNamespaceForObject } from "../src/wasmNamespaceObject.js";
import { preflightDataScenePhysics, type CompiledDataScenePhysicsBody } from "../src/dataScenePhysicsPreflight.js";
import { encodeDataSceneCollisionTilemap } from "../src/dataSceneCollisionTilemap.js";
import { createPixelMaskTerrain, createPixelMaskTerrainInWasmNamespace, PixelMaskTerrain } from "../src/pixelMaskTerrain.js";
import type { UnifiedPhysicsOptions } from "../src/unifiedPhysics.js";

const bytes = () => readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url));
const world: UnifiedPhysicsOptions = { space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1, maxBodies: 8, maxColliders: 8, maxEvents: 16, maxCharacters: 4, maxJoints: 8 };
const bodies = (): CompiledDataScenePhysicsBody[] => [
  { id: "a", options: { kind: "fixed", collider: { shape: { type: "sphere", radius: .5 } } } },
  { id: "b", options: { pose: { position: [0, 2, 0] }, collider: { shape: { type: "sphere", radius: .5 } } } },
];
// Two healthy Native Engine owners need more than the old legacy 64-page
// fixture. The independent 8 MiB malloc below still exceeds remaining capacity.
async function namespace(): Promise<WasmNamespace> { const ns = await WasmNamespace.compile(await bytes(), 128); await ns.initialize(); return ns; }
function engine(ns: WasmNamespace): original.Engine { return ns.call(b => guardWasmNamespaceObject(ns, new b.Engine())); }
function maskNative(value: PixelMaskTerrain): original.NativePixelMaskTerrain { return Object.getOwnPropertyDescriptor(value, "native")!.value; }
function exports(ns: WasmNamespace): original.InitOutput {
  const owner = ns as unknown as { factory: WasmBindingsFactory; module: WebAssembly.Module };
  return ns.call(b => b.initSync({ module: owner.module }));
}
let defaultReady = false;
async function defaultEngine(): Promise<original.Engine> {
  if (!defaultReady) { original.initSync({ module: await bytes() }); defaultReady = true; }
  return new original.Engine();
}
function unchanged(memory: WebAssembly.Memory) {
  const buffer = memory.buffer, bytes = new Uint8Array(buffer).slice();
  return () => { equal(memory.buffer, buffer); deepEqual(new Uint8Array(buffer), bytes); };
}

test("target preflight and mask work before default singleton initialization with real target geometry tile and joint admission", async () => {
  throws(() => original.wasm_memory());
  const ns = await namespace(), owner = engine(ns), bindings = ns.call(b => b);
  const free = bindings.Engine.prototype.free; let frees = 0;
  bindings.Engine.prototype.free = function () { ok(this instanceof bindings.Engine); frees++; return free.call(this); };
  try {
    const tilemap = encodeDataSceneCollisionTilemap({ columns: 1, rows: 1, tileWidth: 1, tileHeight: 1, tiles: [1], definitions: [{ id: 1 }] });
    preflightDataScenePhysics(world, bodies(), [{ name: "link", options: { bodyA: "a", bodyB: "b", kind: { type: "distance", length: 2 } } }], "scene", tilemap, owner);
    equal(frees, 1); equal(wasmNamespaceForObject(owner), ns);
    const mask = createPixelMaskTerrainInWasmNamespace(ns, { width: 2, height: 2, data: [0, 1, 128, 255] });
    try {
      ok(mask instanceof PixelMaskTerrain); const raw = nativeWasmNamespaceObject(ns, maskNative(mask));
      ok(raw instanceof bindings.NativePixelMaskTerrain); ok(!(raw instanceof original.NativePixelMaskTerrain));
      deepEqual(Array.from(mask.data), [0, 1, 128, 255]); equal(mask.alphaAt(1, 1), 255);
      throws(() => original.wasm_memory());
    } finally { mask.destroy(); }
  } finally { bindings.Engine.prototype.free = free; owner.free(); ns.dispose(); }
});

test("preflight keeps all geometry planar capacity tile and joint rejection paths and frees each healthy target probe", async () => {
  const source = await defaultEngine(), ns = await namespace(), owner = engine(ns), peer = await namespace(), peerEngine = engine(peer);
  const sourceSame = unchanged(original.wasm_memory()), peerSame = unchanged(peer.memory()), originalCount = owner.entity_count();
  const bindings = ns.call(b => b), free = bindings.Engine.prototype.free; let frees = 0;
  bindings.Engine.prototype.free = function () { frees++; return free.call(this); };
  try {
    const bads: CompiledDataScenePhysicsBody[][] = [
      [{ id: "bad", options: { collider: { shape: { type: "sphere", radius: -1 } } } }],
      [{ id: "bad", options: { linearVelocity: [0, 0, 1], collider: { shape: { type: "sphere", radius: 1 } } } }],
      [{ id: "bad", options: { collider: { shape: { type: "triangleMesh", vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [0, 1, 2] } } } }],
    ];
    for (const bad of bads) throws(() => preflightDataScenePhysics(world, bad, [], "scene", undefined, owner), /scene\.instances\.bad\.components\.body/);
    throws(() => preflightDataScenePhysics({ ...world, maxBodies: 1 }, bodies(), [], "scene", undefined, owner), /capacity/);
    const invalidTile = encodeDataSceneCollisionTilemap(false); invalidTile.metadata = new Uint32Array([1]);
    throws(() => preflightDataScenePhysics(world, [], [], "scene", invalidTile, owner), /collisionTilemap/);
    throws(() => preflightDataScenePhysics(world, bodies(), [{ name: "bad", options: { bodyA: "a", bodyB: "b", kind: { type: "distance", length: -1 } } }], "scene", undefined, owner), /physics\.joints\.bad/);
    equal(frees, 6); equal(ns.state().state, "ready"); equal(owner.entity_count(), originalCount);
    preflightDataScenePhysics(world, bodies(), [], "scene", undefined, owner); equal(frees, 7);
    sourceSame(); peerSame();
  } finally { bindings.Engine.prototype.free = free; owner.free(); peerEngine.free(); source.free(); ns.dispose(); peer.dispose(); }
});

test("namespace lookup uses actual owner records and released disposed owners never fall back to default preflight", async () => {
  const source = await defaultEngine(), ns = await namespace(), owner = engine(ns);
  try {
    let getters = 0; equal(wasmNamespaceForObject(Object.defineProperty({}, "namespace", { get() { getters++; return ns; } })), undefined); equal(getters, 0);
    equal(wasmNamespaceForObject(source), undefined); equal(wasmNamespaceForObject(owner), ns);
    const raw = nativeWasmNamespaceObject(ns, owner); equal(wasmNamespaceForObject(raw), ns);
    owner.free(); throws(() => wasmNamespaceForObject(owner), /released/);
    const sourceSame = unchanged(original.wasm_memory());
    throws(() => preflightDataScenePhysics(world, [], [], "scene", undefined, owner), /released/); sourceSame();
    const live = engine(ns); ns.dispose();
    throws(() => preflightDataScenePhysics(world, [], [], "scene", undefined, live), /disposed/); live.free(); sourceSame();
  } finally { owner.free(); source.free(); ns.dispose(); }
});

test("actual allocation trap inside target preflight poisons before diagnostic wrapping and skips probe and owner cleanup", async () => {
  const source = await defaultEngine(), ns = await namespace(), owner = engine(ns), peer = await namespace(), peerEngine = engine(peer);
  const bindings = ns.call(b => b), out = exports(ns), configure = bindings.Engine.prototype.configure_unified_physics_world, free = bindings.Engine.prototype.free;
  let frees = 0, calls = 0; let probe: original.Engine | undefined;
  bindings.Engine.prototype.configure_unified_physics_world = function () { probe = this; calls++; out.__wbindgen_malloc(8 * 1024 * 1024, 8); throw Error("malloc should trap"); };
  bindings.Engine.prototype.free = function () { frees++; return free.call(this); };
  const sourceSame = unchanged(original.wasm_memory()), peerSame = unchanged(peer.memory());
  try {
    throws(() => preflightDataScenePhysics(world, [], [], "scene", undefined, owner), /scene\.physics.*unreachable/);
    equal(ns.state().state, "poisoned"); equal(calls, 1); equal(frees, 0); ok((probe as unknown as { __wbg_ptr: number }).__wbg_ptr > 0);
    throws(() => preflightDataScenePhysics(world, [], [], "scene", undefined, owner), /poisoned/); equal(calls, 1);
    owner.free(); owner.free(); equal(frees, 0); sourceSame(); peerSame(); equal(peer.state().state, "ready");
  } finally { bindings.Engine.prototype.configure_unified_physics_world = configure; bindings.Engine.prototype.free = free; owner.free(); peerEngine.free(); source.free(); ns.dispose(); peer.dispose(); }
});

test("target mask preserves input validation copies alpha solid dirty carve and healthy release contracts", async () => {
  const source = await defaultEngine(), ns = await namespace(), peer = await namespace(), peerEngine = engine(peer);
  const sourceSame = unchanged(original.wasm_memory()), peerSame = unchanged(peer.memory()), input = new Uint8Array([0, 127, 128, 255]);
  const mask = createPixelMaskTerrainInWasmNamespace(ns, { width: 2, height: 2, solidThreshold: 128, data: input });
  const raw = nativeWasmNamespaceObject(ns, maskNative(mask));
  try {
    for (const width of [0, -1, .5, 4097, Infinity, NaN]) throws(() => createPixelMaskTerrainInWasmNamespace(ns, { width, height: 1 }), /positive integer at most 4096/);
    for (const data of [[1], [0, 0, 0, NaN], [0, 0, 0, 256]]) throws(() => createPixelMaskTerrainInWasmNamespace(ns, { width: 2, height: 2, data }), /length|between 0 and 255/);
    input.fill(0); const alpha = mask.data, solid = mask.solidData(); alpha.fill(17); solid.fill(0);
    deepEqual(Array.from(mask.data), [0, 127, 128, 255]); deepEqual(Array.from(mask.solidData()), [0, 0, 1, 1]);
    equal(mask.version, 0); equal(mask.dirtyRect(), undefined); ok(mask.setPixel(0, 0, 128));
    ok(mask.carveRect(1, 1, 1, 1)); ok(mask.carveCircle(.5, 1.5, .4));
    const patch = mask.dirtyAlphaPatch()!; patch.alpha.fill(19); equal(mask.alphaAt(0, 0), 128); equal(mask.isSolid(1, 1), false);
    mask.clearDirty(); equal(mask.dirtyAlphaPatch(), undefined); equal(mask.toTilemapLayer().data[0], 1);
    const saved = mask.data; ns.memory().grow(1); deepEqual(Array.from(saved), Array.from(mask.data));
    mask.destroy(); mask.destroy(); equal((raw as unknown as { __wbg_ptr: number }).__wbg_ptr, 0); throws(() => mask.data, /destroyed/);
    sourceSame(); peerSame();
  } finally { mask.destroy(); peerEngine.free(); source.free(); ns.dispose(); peer.dispose(); }
});

test("target mask actual malloc trap blocks every later state method and late native free without changing source or peer bytes", async () => {
  const source = await defaultEngine(), ns = await namespace(), peer = await namespace(), peerMask = createPixelMaskTerrainInWasmNamespace(peer, { width: 1, height: 1, fill: "solid" });
  const mask = createPixelMaskTerrainInWasmNamespace(ns, { width: 1, height: 1, fill: "solid" }), raw = nativeWasmNamespaceObject(ns, maskNative(mask));
  const bindings = ns.call(b => b), out = exports(ns), alpha = bindings.NativePixelMaskTerrain.prototype.alpha_data, free = bindings.NativePixelMaskTerrain.prototype.free;
  let calls = 0, frees = 0;
  bindings.NativePixelMaskTerrain.prototype.alpha_data = function () { calls++; out.__wbindgen_malloc(8 * 1024 * 1024, 8); throw Error("malloc should trap"); };
  bindings.NativePixelMaskTerrain.prototype.free = function () { frees++; return free.call(this); };
  const sourceSame = unchanged(original.wasm_memory()), peerSame = unchanged(peer.memory());
  try {
    throws(() => mask.data, /unreachable/); equal(ns.state().state, "poisoned"); equal(calls, 1);
    for (const operation of [() => mask.data, () => mask.version, () => mask.solidData(), () => mask.alphaAt(0, 0), () => mask.isSolid(0, 0),
      () => mask.setPixel(0, 0, 0), () => mask.carveRect(0, 0, 1, 1), () => mask.carveCircle(0, 0, 1), () => mask.dirtyRect(), () => mask.dirtyAlphaPatch(), () => mask.clearDirty(), () => mask.toTilemapLayer()]) throws(operation, /poisoned/);
    throws(() => createPixelMaskTerrainInWasmNamespace(ns, { width: 1, height: 1 }), /poisoned/);
    mask.destroy(); mask.destroy(); equal(frees, 0); ok((raw as unknown as { __wbg_ptr: number }).__wbg_ptr > 0); equal(calls, 1);
    sourceSame(); peerSame(); equal(peerMask.alphaAt(0, 0), 255);
  } finally { bindings.NativePixelMaskTerrain.prototype.alpha_data = alpha; bindings.NativePixelMaskTerrain.prototype.free = free; mask.destroy(); peerMask.destroy(); source.free(); ns.dispose(); peer.dispose(); }
});

test("target mask allocation rejection stays healthy and new disposed namespaces cannot create or reenter masks", async () => {
  const unopened = await WasmNamespace.compile(await bytes(), 64);
  throws(() => createPixelMaskTerrainInWasmNamespace(unopened, { width: 1, height: 1 }), /namespace is new/); unopened.dispose();
  const ns = await namespace();
  try {
    throws(() => createPixelMaskTerrainInWasmNamespace(ns, { width: 4096, height: 4096 }), /allocation failed/); equal(ns.state().state, "ready");
    const mask = createPixelMaskTerrainInWasmNamespace(ns, { width: 1, height: 1 });
    ns.dispose(); throws(() => mask.data, /disposed/); throws(() => createPixelMaskTerrainInWasmNamespace(ns, { width: 1, height: 1 }), /disposed/);
    mask.destroy(); mask.destroy();
    // The unchanged public factory still allocates from the default singleton.
    const value = createPixelMaskTerrain({ width: 1, height: 1, data: [9.5] }); equal(value.alphaAt(0, 0), 10); value.destroy();
  } finally { ns.dispose(); }
});
