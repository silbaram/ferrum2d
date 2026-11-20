import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { Engine } from "../pkg/ferrum_core.js";
import { initializeFerrumWasm } from "../src/core.js";
import {
  attachDataSceneVariableRuntimeEngineAdapter,
  attachPreparedDataSceneVariableBindings,
  captureDataSceneVariableBindings,
  dataSceneVariableStoreForEngine,
  prepareDataSceneVariableBindings,
  resolveDataSceneVariableDeclarations,
  synchronizeDataSceneVariableStore,
  type DataSceneVariableBindingsSnapshot,
  type DataSceneVariableRuntimeEngineAdapter,
  type NativeDataSceneVariableLayoutEntry,
} from "../src/dataSceneVariables.js";
import type { FerrumEngine } from "../src/engineTypes.js";

const declarations = resolveDataSceneVariableDeclarations([
  { name: "__proto__", type: "integer", scope: "global", default: 1 },
  { name: "speed", type: "real", scope: "scene", default: 1.25 },
  { name: "ready", type: "bool", scope: "global", default: false },
]);
const ids = Object.fromEntries([["__proto__", 7], ["speed", 2], ["ready", 64]]);
const layout: readonly NativeDataSceneVariableLayoutEntry[] = [
  { slot: 64, type: "bool", scope: "global", default: false },
  { slot: 7, type: "integer", scope: "global", default: 1 },
  { slot: 2, type: "real", scope: "scene", default: 1.25 },
];

function memoryEngine() {
  const values = new Map<number, number>();
  const calls = { clear: 0, configure: 0, get: 0, set: 0 };
  const adapter: DataSceneVariableRuntimeEngineAdapter = {
    clear() { calls.clear += 1; values.clear(); },
    configure(slot, _type, _scope, _default, value) {
      calls.configure += 1;
      values.set(slot, Number(value));
      return true;
    },
    get(slot) { calls.get += 1; return values.get(slot) ?? NaN; },
    set(slot, value) {
      calls.set += 1;
      if (!values.has(slot)) return false;
      values.set(slot, Number(value));
      return true;
    },
  };
  const engine = attachDataSceneVariableRuntimeEngineAdapter({} as FerrumEngine, adapter);
  return { engine, values, calls, reset: () => Object.assign(calls, { clear: 0, configure: 0, get: 0, set: 0 }) };
}

function sourceBindings(): DataSceneVariableBindingsSnapshot {
  const source = memoryEngine();
  synchronizeDataSceneVariableStore(source.engine, declarations, "project.variables", ids);
  const snapshot = captureDataSceneVariableBindings(source.engine);
  if (!snapshot) throw new Error("Expected bindings.");
  return snapshot;
}

test("variable bindings capture preserves declaration order, sparse slots and path without native reads", () => {
  const source = memoryEngine();
  const store = synchronizeDataSceneVariableStore(source.engine, declarations, "project.variables", ids);
  store.set("__proto__", 37);
  source.reset();
  const snapshot = captureDataSceneVariableBindings(source.engine);
  deepEqual(snapshot, {
    path: "project.variables",
    entries: declarations.map(declaration => ({ declaration, slot: ids[declaration.name] })),
  });
  deepEqual(source.calls, { clear: 0, configure: 0, get: 0, set: 0 });
  ok(Object.isFrozen(snapshot));
  ok(Object.isFrozen(snapshot?.entries));
  equal(JSON.stringify(snapshot).includes('"value"'), false);
  equal(store.get("__proto__"), 37);
});

test("variable bindings prepare is detached and attach only publishes metadata onto restored slots", () => {
  const source = memoryEngine();
  const sourceStore = synchronizeDataSceneVariableStore(source.engine, declarations, "project.variables", ids);
  sourceStore.set("__proto__", 37);
  const snapshot = JSON.parse(JSON.stringify(captureDataSceneVariableBindings(source.engine)));
  const target = memoryEngine();
  target.values.set(7, 91);
  target.values.set(2, 2.75);
  target.values.set(64, 1);
  target.values.set(9, 123);
  source.reset();
  const prepared = prepareDataSceneVariableBindings(target.engine, snapshot, layout);
  equal(dataSceneVariableStoreForEngine(target.engine), undefined);
  snapshot.path = "changed";
  snapshot.entries[0].slot = 9;
  snapshot.entries[0].declaration.name = "changed";
  const store = attachPreparedDataSceneVariableBindings(target.engine, prepared);
  if (!store) throw new Error("Expected metadata.");
  deepEqual(target.calls, { clear: 0, configure: 0, get: 0, set: 0 });
  deepEqual(source.calls, { clear: 0, configure: 0, get: 0, set: 0 });
  equal(store.get("__proto__"), 91);
  equal(store.get("speed"), 2.75);
  equal(store.get("ready"), true);
  store.set("__proto__", 92);
  equal(target.values.get(7), 92);
  equal(target.values.get(9), 123);
  equal(sourceStore.get("__proto__"), 37);
  equal(captureDataSceneVariableBindings(target.engine)?.path, "project.variables");
});

test("variable bindings reject invalid DTOs before touching existing source or target state", () => {
  const source = memoryEngine();
  const sourceStore = synchronizeDataSceneVariableStore(source.engine, declarations, "source", ids);
  sourceStore.set("__proto__", 37);
  const target = memoryEngine();
  const targetStore = synchronizeDataSceneVariableStore(target.engine, declarations, "target", ids);
  targetStore.set("__proto__", 91);
  source.reset();
  target.reset();
  const mutations: ((dto: any) => void)[] = [
    dto => { dto.path = 5; },
    dto => { dto.entries[0].slot = 0; },
    dto => { dto.entries[0].slot = 65; },
    dto => { dto.entries[0].slot = 1.5; },
    dto => { dto.entries[0].slot = NaN; },
    dto => { dto.entries[1].slot = 7; },
    dto => { dto.entries[1].declaration.name = "__proto__"; },
    dto => { dto.entries[0].declaration.name = " bad "; },
    dto => { dto.entries[0].declaration.type = "number"; },
    dto => { dto.entries[0].declaration.scope = "runtime"; },
    dto => { dto.entries[0].declaration.default = 1.5; },
    dto => { dto.entries[1].declaration.default = Infinity; },
    dto => { dto.entries[2].declaration.default = 0; },
    dto => { dto.entries[0].value = 10; },
    dto => { dto.entries = Array(65).fill(dto.entries[0]); },
    dto => { dto.entries = Array(1); },
  ];
  for (const mutate of mutations) {
    const dto = JSON.parse(JSON.stringify(sourceBindings()));
    mutate(dto);
    throws(() => prepareDataSceneVariableBindings(target.engine, dto, layout));
    equal(dataSceneVariableStoreForEngine(target.engine), targetStore);
    equal(dataSceneVariableStoreForEngine(source.engine), sourceStore);
  }
  deepEqual(target.calls, { clear: 0, configure: 0, get: 0, set: 0 });
  deepEqual(source.calls, { clear: 0, configure: 0, get: 0, set: 0 });
  equal(target.values.get(7), 91);
  equal(source.values.get(7), 37);
});

test("variable bindings cross-check every native slot type, scope and default", () => {
  const target = memoryEngine();
  const snapshot = sourceBindings();
  const badLayouts = [
    layout.slice(1),
    [...layout, layout[0]],
    layout.map(entry => entry.slot === 7 ? { ...entry, type: "real" } : entry),
    layout.map(entry => entry.slot === 7 ? { ...entry, scope: "scene" } : entry),
    layout.map(entry => entry.slot === 7 ? { ...entry, default: 2 } : entry),
    layout.map(entry => entry.slot === 7 ? { ...entry, slot: 65 } : entry),
    layout.map(entry => entry.slot === 7 ? { ...entry, default: NaN } : entry),
    Array(1),
    Array(65).fill(layout[0]),
  ];
  for (const candidate of badLayouts) {
    throws(() => prepareDataSceneVariableBindings(target.engine, snapshot, candidate));
    equal(dataSceneVariableStoreForEngine(target.engine), undefined);
  }
  deepEqual(target.calls, { clear: 0, configure: 0, get: 0, set: 0 });
});

test("variable binding admission rejects getters without invoking them", () => {
  const target = memoryEngine();
  let reads = 0;
  const snapshot = { path: "test", get entries() { reads += 1; return []; } };
  throws(() => prepareDataSceneVariableBindings(target.engine, snapshot, layout));
  const entries = [sourceBindings().entries[0]];
  Object.defineProperty(entries, "0", { get() { reads += 1; return undefined; } });
  throws(() => prepareDataSceneVariableBindings(target.engine, { path: "test", entries }, layout));
  equal(reads, 0);
  deepEqual(target.calls, { clear: 0, configure: 0, get: 0, set: 0 });
});

test("prepared variable bindings are target-bound, one-use, and reject changed metadata", () => {
  const target = memoryEngine();
  const other = memoryEngine();
  target.values.set(7, 91);
  target.values.set(2, 2.75);
  target.values.set(64, 1);
  const snapshot = sourceBindings();
  const prepared = prepareDataSceneVariableBindings(target.engine, snapshot, layout);
  throws(() => attachPreparedDataSceneVariableBindings(other.engine, prepared));
  throws(() => attachPreparedDataSceneVariableBindings(target.engine, { kind: "data-scene-variable-bindings" }));
  const store = attachPreparedDataSceneVariableBindings(target.engine, prepared);
  throws(() => attachPreparedDataSceneVariableBindings(target.engine, prepared));
  equal(dataSceneVariableStoreForEngine(target.engine), store);
  const stale = prepareDataSceneVariableBindings(target.engine, snapshot, layout);
  synchronizeDataSceneVariableStore(target.engine, declarations, "changed", ids);
  target.reset();
  throws(() => attachPreparedDataSceneVariableBindings(target.engine, stale));
  equal(dataSceneVariableStoreForEngine(target.engine), store);
  deepEqual(target.calls, { clear: 0, configure: 0, get: 0, set: 0 });
  deepEqual(other.calls, { clear: 0, configure: 0, get: 0, set: 0 });
});

test("absent or empty bindings preserve native-only slots and existing empty path policy", () => {
  const target = memoryEngine();
  synchronizeDataSceneVariableStore(target.engine, declarations, "old", ids);
  target.values.set(7, 81);
  target.reset();
  const absent = prepareDataSceneVariableBindings(target.engine, undefined, layout);
  equal(attachPreparedDataSceneVariableBindings(target.engine, absent), undefined);
  equal(target.values.get(7), 81);
  const empty = prepareDataSceneVariableBindings(target.engine, { path: "", entries: [] }, layout);
  const store = attachPreparedDataSceneVariableBindings(target.engine, empty);
  deepEqual(store?.declarations(), []);
  equal(captureDataSceneVariableBindings(target.engine)?.path, "");
  deepEqual(target.calls, { clear: 0, configure: 0, get: 0, set: 0 });
});

test("variable binding preparation and publication reject unavailable targets without native effects", () => {
  const snapshot = sourceBindings();
  throws(() => prepareDataSceneVariableBindings({} as FerrumEngine, snapshot, layout));
  const target = memoryEngine();
  const prepared = prepareDataSceneVariableBindings(target.engine, snapshot, layout);
  Object.preventExtensions(target.engine);
  throws(() => attachPreparedDataSceneVariableBindings(target.engine, prepared));
  throws(() => prepareDataSceneVariableBindings(target.engine, snapshot, layout));
  equal(dataSceneVariableStoreForEngine(target.engine), undefined);
  deepEqual(target.calls, { clear: 0, configure: 0, get: 0, set: 0 });
});

test("variable bindings attach reads and updates actual Wasm slots after native checkpoint restore", async () => {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
  const native = new Engine();
  try {
    equal(native.configure_gameplay_variable(7, 0, 0, 1, 91), true);
    equal(native.configure_gameplay_variable(2, 1, 1, 1.25, 2.75), true);
    equal(native.configure_gameplay_variable(64, 2, 0, 0, 1), true);
    const checkpoint = native.capture_runtime_checkpoint();
    if (!checkpoint) throw new Error("Expected native checkpoint.");
    equal(native.set_gameplay_variable_value(7, 6), true);
    equal(native.restore_runtime_checkpoint(checkpoint), true);
    checkpoint.free();
    const calls = { clear: 0, configure: 0, get: 0, set: 0 };
    const target = attachDataSceneVariableRuntimeEngineAdapter({} as FerrumEngine, {
      clear() { calls.clear += 1; native.clear_gameplay_variables(); },
      configure() { calls.configure += 1; throw new Error("Must not reconfigure restored values."); },
      get(slot) { calls.get += 1; return native.gameplay_variable_value(slot); },
      set(slot, value) { calls.set += 1; return native.set_gameplay_variable_value(slot, Number(value)); },
    });
    const prepared = prepareDataSceneVariableBindings(target, sourceBindings(), layout);
    const store = attachPreparedDataSceneVariableBindings(target, prepared);
    if (!store) throw new Error("Expected metadata.");
    deepEqual(calls, { clear: 0, configure: 0, get: 0, set: 0 });
    equal(store.get("__proto__"), 91);
    equal(store.get("speed"), 2.75);
    equal(store.get("ready"), true);
    store.set("__proto__", 92);
    store.set("ready", false);
    equal(native.gameplay_variable_value(7), 92);
    equal(native.gameplay_variable_value(64), 0);
    deepEqual(calls, { clear: 0, configure: 0, get: 3, set: 2 });
  } finally {
    native.free();
  }
});
