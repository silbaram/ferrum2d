import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import "./nativeRuntimeTestHelper.js";
import * as original from "../pkg/ferrum_core.js";
import type { WasmBindingsFactory } from "../pkg/ferrum_core_factory.js";
import { WasmNamespace } from "../src/wasmNamespace.js";
import { nativeWasmNamespaceObject } from "../src/wasmNamespaceObject.js";
import { ResourceBudget } from "../src/nativeFileResourceBudget.js";
import { QuestLog, DialogueSession, nativeFileDialogueQuestPacket, nativeFileCreateQuest, nativeFileCreateDialogue, resolveQuestDocument, resolveDialogueGraph } from "../src/dialogueQuest.js";
import { encodeQuestConfig, encodeQuestSnapshot, encodeDialogueGraph, encodeDialogueSnapshot } from "../src/dialogueQuestNative.js";
import { registerNativeFileDialogueQuest as register, captureNativeFileDialogueQuest as capture, prepareNativeFileDialogueQuest as prepare, consumePreparedNativeFileDialogueQuest as consume, discardPreparedNativeFileDialogueQuest as discard } from "../src/nativeFileDialogueQuest.js";
import type { NativeFileDialogueQuestGraph } from "../src/nativeFileDialogueQuest.js";

const budget = () => new ResourceBudget();
const wasm = () => readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url));
const qdoc = () => ({ quests: Object.fromEntries([["__proto__", { title: "퀘스트🙂", stages: { start: { title: "시작", objectives: { x: "대화" } } } }]]) });
const story = () => ({ initialNode: "start", nodes: { start: { text: "대화🙂", questUpdates: [{ quest: "__proto__", action: "start" as const, stage: "start" }], choices: [{ id: "next", label: "계속", to: "start", questUpdates: [{ quest: "__proto__", action: "completeObjective" as const, objective: "x" }] }] } } });
function roots() {
  const owner = {}, q = new QuestLog(qdoc()), equalQ = new QuestLog(qdoc()), a = new DialogueSession(story(), q), b = new DialogueSession(story(), q);
  q.restore({ quests: [{ id: "__proto__", status: "active", stage: "start", completedObjectives: ["persist"] }] }); equalQ.restore(q.snapshot());
  for (const [symbol, value] of [["q", q], ["equal", equalQ], ["a", a], ["b", b], ["alias", q]] as const) register(owner, symbol, value);
  return { owner, q, equalQ, a, b };
}
function release(g: { quests: readonly QuestLog[]; dialogues: readonly DialogueSession[] }): void { for (const d of g.dialogues) d.destroy(); for (const q of g.quests) q.destroy(); }
function sourceRelease(r: ReturnType<typeof roots>): void { release({ quests: [r.q, r.equalQ], dialogues: [r.a, r.b] }); }
function native<T extends object>(value: object): T { return Object.getOwnPropertyDescriptor(value, "native")!.value as T; }
function packet(value: object): Uint8Array { const h = nativeFileDialogueQuestPacket(value, new Uint8Array()); return nativeFileDialogueQuestPacket(value, h); }
function output(ns: WasmNamespace): original.InitOutput {
  const owner = ns as unknown as { factory: WasmBindingsFactory; module: WebAssembly.Module };
  return ns.call(b => b.initSync({ module: owner.module }));
}
async function namespace(): Promise<WasmNamespace> { const ns = await WasmNamespace.compile(await wasm(), 64); await ns.initialize(); return ns; }
function prepared(ns: WasmNamespace, bytes: Uint8Array): NativeFileDialogueQuestGraph { const owner = {}; return consume(owner, prepare(owner, bytes, budget(), undefined, { targetNamespace: ns }), budget()); }

test("file dialogue graph creates actual target bindings with aliases, distinct equal owners and saved provenance", async () => {
  const r = roots(), file = capture(r.owner, budget()), saved = JSON.parse(new TextDecoder().decode(file.bytes));
  const ns = await namespace(), sourceMemory = original.wasm_memory(), sourceBuffer = sourceMemory.buffer, before = new Uint8Array(sourceBuffer).slice();
  let g: NativeFileDialogueQuestGraph | undefined;
  try {
    g = prepared(ns, file.bytes); equal(sourceMemory.buffer, sourceBuffer); deepEqual(new Uint8Array(sourceBuffer), before);
    const classes = ns.call(b => b), raw = nativeWasmNamespaceObject(ns, native<original.NativeQuestLog>(g.quests[0]));
    ok(raw instanceof classes.NativeQuestLog); ok(!(raw instanceof original.NativeQuestLog));
    ok(nativeWasmNamespaceObject(ns, native<original.NativeDialogueSession>(g.dialogues[0])) instanceof classes.NativeDialogueSession);
    ok(g.quests[0] !== g.quests[1]); deepEqual(g.quests[0].snapshot(), g.quests[1].snapshot());
    equal(g.bindings.find(b => b.symbol === "alias")!.value, g.quests[0]);
    deepEqual(g.quests[0].snapshot(), r.q.snapshot());
    g.dialogues[0].choose("next"); deepEqual(g.quests[0].snapshot().quests[0].completedObjectives, ["persist", "x"]);
    const linked = packet(g.dialogues[1]); g.dialogues[1].choose("next"); ok(packet(g.dialogues[1]).length === linked.length);
    deepEqual(r.q.snapshot().quests[0].completedObjectives, ["persist"]); deepEqual(g.quests[1].snapshot().quests[0].completedObjectives, ["persist"]);
    const owner = {}; for (const b of g.bindings) register(owner, b.symbol, b.value);
    const copied = JSON.parse(new TextDecoder().decode(capture(owner, budget()).bytes)); deepEqual(copied.quests[0].native.savedOrigin, saved.quests[0].native.origin);
    for (let i = 0; i < 6; i++) g.dialogues[i % 2].choose("next");
  } finally { if (g) release(g); ns.dispose(); sourceRelease(r); }
});

test("target graph preserves destroyed wrapper linked Rc and true NativeAbsent tombstones", async () => {
  const r = roots(), absent = new QuestLog(qdoc()); absent.destroy(); register(r.owner, "absent", absent); r.q.destroy();
  const file = capture(r.owner, budget()), ns = await namespace(); let g: NativeFileDialogueQuestGraph | undefined;
  try {
    g = prepared(ns, file.bytes); throws(() => g!.quests[0].snapshot(), /destroyed/); throws(() => g!.quests[2].snapshot(), /destroyed/);
    equal(native(g.quests[2]), undefined); g.dialogues[0].choose("next");
    const owner = {}; for (const b of g.bindings) register(owner, b.symbol, b.value);
    const data = JSON.parse(new TextDecoder().decode(capture(owner, budget()).bytes)); equal(data.quests[0].wrapper, "destroyed"); ok(data.quests[0].native); equal(data.quests[2].native, null);
    const p = nativeFileDialogueQuestPacket(g.dialogues[1], new Uint8Array()); g.dialogues[1].choose("next");
    const after = nativeFileDialogueQuestPacket(g.dialogues[1], new Uint8Array()); ok(!p.every((v, i) => v === after[i]));
  } finally { if (g) release(g); ns.dispose(); sourceRelease(r); }
});

test("cold linked construction rejects default or peer raw quest before target native static entry", async () => {
  const a = await namespace(), b = await namespace(), q = new QuestLog(qdoc());
  const doc = resolveQuestDocument(qdoc()), graph = resolveDialogueGraph(story()), config = encodeQuestConfig(doc), progress = encodeQuestSnapshot(q.snapshot());
  let peer: QuestLog | undefined; const bindings = a.call(x => x), saved = bindings.NativeDialogueSession.file_with_quests; let calls = 0;
  bindings.NativeDialogueSession.file_with_quests = (...args) => { calls++; return saved(...args); };
  try {
    peer = nativeFileCreateQuest(doc, config, progress, undefined, b);
    const bytes = encodeDialogueGraph(graph), state = encodeDialogueSnapshot({ nodeId: "start", flags: [], ended: false });
    throws(() => nativeFileCreateDialogue(graph, bytes, state, q, undefined, a), /Foreign/);
    throws(() => nativeFileCreateDialogue(graph, bytes, state, peer, undefined, a), /Foreign/);
    equal(calls, 0); equal(a.state().state, "ready"); equal(b.state().state, "ready"); deepEqual(q.snapshot(), peer.snapshot());
    peer.destroy(); throws(() => nativeFileCreateDialogue(graph, bytes, state, peer, undefined, b), /destroyed/);
    const memory = original.wasm_memory();
    const owner = {}; register(owner, "q", q); const file = capture(owner, budget());
    const afterBuffer = memory.buffer, afterCapture = new Uint8Array(afterBuffer).slice();
    throws(() => prepare({}, file.bytes, budget(), undefined, { targetNamespace: null as unknown as WasmNamespace }));
    deepEqual(new Uint8Array(memory.buffer), afterCapture);
    throws(() => nativeFileCreateQuest(doc, config, progress, undefined, null as unknown as WasmNamespace));
    equal(memory.buffer, afterBuffer); deepEqual(new Uint8Array(memory.buffer), afterCapture);
    const unopened = await WasmNamespace.compile(await wasm(), 64); throws(() => nativeFileCreateQuest(doc, config, progress, undefined, unopened), /namespace is new/); unopened.dispose();
  } finally { bindings.NativeDialogueSession.file_with_quests = saved; peer?.destroy(); q.destroy(); a.dispose(); b.dispose(); }
});

test("actual target malloc trap blocks wrapper snapshot choose restore probe and cleanup without touching source or peer", async () => {
  const r = roots(), file = capture(r.owner, budget()), a = await namespace(), b = await namespace();
  const target = prepared(a, file.bytes), peer = prepared(b, file.bytes); const out = output(a);
  const rawQ = nativeWasmNamespaceObject(a, native<original.NativeQuestLog>(target.quests[0])), rawD = nativeWasmNamespaceObject(a, native<original.NativeDialogueSession>(target.dialogues[0]));
  const sourceMemory = original.wasm_memory(), sourceBuffer = sourceMemory.buffer, sourceBytes = new Uint8Array(sourceBuffer).slice();
  const peerMemory = b.memory(), peerBuffer = peerMemory.buffer, peerBytes = new Uint8Array(peerBuffer).slice();
  try {
    throws(() => a.call(() => out.__wbindgen_malloc(8 * 1024 * 1024, 8)), /unreachable/); equal(a.state().state, "poisoned");
    throws(() => target.quests[0].snapshot(), /poisoned/); throws(() => target.dialogues[0].choose("next"), /poisoned/);
    throws(() => target.quests[0].restore({ quests: [] }), /poisoned/); throws(() => target.dialogues[0].restore({ nodeId: "start", flags: [], ended: false }), /poisoned/);
    throws(() => nativeFileDialogueQuestPacket(target.dialogues[0], new Uint8Array()), /poisoned/);
    release(target); release(target); ok((rawQ as unknown as { __wbg_ptr: number }).__wbg_ptr > 0); ok((rawD as unknown as { __wbg_ptr: number }).__wbg_ptr > 0);
    equal(sourceMemory.buffer, sourceBuffer); deepEqual(new Uint8Array(sourceBuffer), sourceBytes); equal(peerMemory.buffer, peerBuffer); deepEqual(new Uint8Array(peerBuffer), peerBytes);
    equal(b.state().state, "ready"); peer.dialogues[0].choose("next"); deepEqual(r.q.snapshot().quests[0].completedObjectives, ["persist"]);
  } finally { release(target); release(peer); sourceRelease(r); a.dispose(); b.dispose(); }
});

test("first partial graph allocation trap suppresses every new target free and never frees source", async () => {
  const r = roots(), file = capture(r.owner, budget()), ns = await namespace(), bindings = ns.call(b => b), out = output(ns);
  const staticCreate = bindings.NativeDialogueSession.file_with_quests, qFree = bindings.NativeQuestLog.prototype.free, dFree = bindings.NativeDialogueSession.prototype.free, sourceFree = original.NativeQuestLog.prototype.free;
  let calls = 0, frees = 0, sourceFrees = 0; const created: original.NativeDialogueSession[] = [];
  bindings.NativeDialogueSession.file_with_quests = (...args) => { if (++calls === 2) { out.__wbindgen_malloc(8 * 1024 * 1024, 8); throw Error("malloc should trap"); } const value = staticCreate(...args); created.push(value); return value; };
  bindings.NativeQuestLog.prototype.free = function () { frees++; return qFree.call(this); }; bindings.NativeDialogueSession.prototype.free = function () { frees++; return dFree.call(this); };
  original.NativeQuestLog.prototype.free = function () { sourceFrees++; return sourceFree.call(this); };
  const memory = original.wasm_memory(), buffer = memory.buffer, before = new Uint8Array(buffer).slice();
  try {
    throws(() => prepare({}, file.bytes, budget(), undefined, { targetNamespace: ns }), /NATIVE/); equal(calls, 2); equal(created.length, 1); equal(ns.state().state, "poisoned");
    equal(frees, 0); equal(sourceFrees, 0); ok((created[0] as unknown as { __wbg_ptr: number }).__wbg_ptr > 0);
    equal(memory.buffer, buffer); deepEqual(new Uint8Array(buffer), before); deepEqual(r.q.snapshot().quests[0].completedObjectives, ["persist"]);
  } finally { bindings.NativeDialogueSession.file_with_quests = staticCreate; bindings.NativeQuestLog.prototype.free = qFree; bindings.NativeDialogueSession.prototype.free = dFree; original.NativeQuestLog.prototype.free = sourceFree; sourceRelease(r); ns.dispose(); }
});

test("a RuntimeError raised through an actual target wrapper poisons before wrapper diagnostics and discard", async () => {
  const r = roots(), file = capture(r.owner, budget()), ns = await namespace(), bindings = ns.call(b => b);
  const snapshot = bindings.NativeQuestLog.prototype.snapshot, free = bindings.NativeQuestLog.prototype.free; let calls = 0, frees = 0;
  bindings.NativeQuestLog.prototype.snapshot = function () { calls++; ok(this instanceof bindings.NativeQuestLog); throw new WebAssembly.RuntimeError("method trap"); };
  bindings.NativeQuestLog.prototype.free = function () { frees++; return free.call(this); };
  const owner = {}, token = prepare(owner, file.bytes, budget(), undefined, { targetNamespace: ns });
  try {
    const graph = (await import("../src/nativeFileDialogueQuest.js")).inspectPreparedNativeFileDialogueQuest(owner, token);
    throws(() => graph.quests[0].snapshot(), /method trap/); equal(ns.state().state, "poisoned");
    throws(() => graph.quests[0].snapshot(), /poisoned/); equal(calls, 1); discard(owner, token); discard(owner, token); equal(frees, 0);
    deepEqual(r.q.snapshot().quests[0].completedObjectives, ["persist"]);
  } finally { bindings.NativeQuestLog.prototype.snapshot = snapshot; bindings.NativeQuestLog.prototype.free = free; discard(owner, token); sourceRelease(r); ns.dispose(); }
});


test("ordinary partial graph failure frees only new healthy target objects and leaves that namespace reusable", async () => {
  const r = roots(), file = capture(r.owner, budget()), ns = await namespace(), bindings = ns.call(b => b);
  const make = bindings.NativeDialogueSession.file_with_quests, qFree = bindings.NativeQuestLog.prototype.free, dFree = bindings.NativeDialogueSession.prototype.free;
  let calls = 0, quests = 0, dialogues = 0;
  bindings.NativeDialogueSession.file_with_quests = (...args) => { if (++calls === 2) throw Error("injected ordinary failure"); return make(...args); };
  bindings.NativeQuestLog.prototype.free = function () { ok(this instanceof bindings.NativeQuestLog); quests++; return qFree.call(this); };
  bindings.NativeDialogueSession.prototype.free = function () { ok(this instanceof bindings.NativeDialogueSession); dialogues++; return dFree.call(this); };
  const memory = original.wasm_memory(), buffer = memory.buffer, before = new Uint8Array(buffer).slice();
  try {
    throws(() => prepare({}, file.bytes, budget(), undefined, { targetNamespace: ns }), /NATIVE/);
    equal(calls, 2); equal(quests, 2); equal(dialogues, 1); equal(ns.state().state, "ready");
    equal(memory.buffer, buffer); deepEqual(new Uint8Array(buffer), before);
    bindings.NativeDialogueSession.file_with_quests = make; const graph = prepared(ns, file.bytes); release(graph);
  } finally { bindings.NativeDialogueSession.file_with_quests = make; bindings.NativeQuestLog.prototype.free = qFree; bindings.NativeDialogueSession.prototype.free = dFree; sourceRelease(r); ns.dispose(); }
});
