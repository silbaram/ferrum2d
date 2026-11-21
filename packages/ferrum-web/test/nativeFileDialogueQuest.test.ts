import { deepEqual, equal, ok, throws as nodeThrows } from "node:assert/strict";
import { test } from "node:test";
import "./nativeRuntimeTestHelper.js";
import { QuestLog, DialogueSession, nativeFileDialogueQuestPacket, nativeFileDialogueQuestOwner } from "../src/dialogueQuest.js";
import { NativeDialogueSession, NativeQuestLog } from "../pkg/ferrum_core.js";
import { ResourceBudget, NativeFileResourceError } from "../src/nativeFileResourceBudget.js";
import { registerNativeFileDialogueQuest as register, unregisterNativeFileDialogueQuest as unregister, captureNativeFileDialogueQuest as capture, prepareNativeFileDialogueQuest as prepare, inspectPreparedNativeFileDialogueQuest as inspect, consumePreparedNativeFileDialogueQuest as consume, discardPreparedNativeFileDialogueQuest as discard, nativeFileDialogueQuestFenceUnchanged as unchanged, NativeFileDialogueQuestError } from "../src/nativeFileDialogueQuest.js";
import { captureNativeFileDialogueQuestContent as captureContent, materializeNativeFileDialogueQuestContent as materialize } from "../src/nativeFileDialogueQuestContent.js";
import { byteList, validateProgress } from "../src/nativeFileDialogueQuestCodec.js";
import type { ResolvedQuestDocument } from "../src/dialogueQuest.js";
function throws(operation: () => unknown, expected?: RegExp | ((error: unknown) => boolean)): void {
    if (typeof expected !== "function") {
        nodeThrows(operation, expected);
        return;
    }
    let caught: unknown, failed = false;
    try {
        operation();
    }
    catch (e) {
        caught = e;
        failed = true;
    }
    ok(failed && expected(caught), String(caught));
}
function notEqual(a: unknown, b: unknown): void { ok(!Object.is(a, b)); }
const budget = () => new ResourceBudget();
const qdoc = () => ({ quests: Object.fromEntries([["__proto__", { title: "퀘스트 🙂", stages: { constructor: { title: "시작", objectives: { talk: "대화" } } } }]]) });
const graph = () => ({ initialNode: "constructor", nodes: Object.fromEntries([["constructor", { text: "시작🙂", questUpdates: [{ quest: "__proto__", action: "start" as const, stage: "constructor" }], choices: [{ id: "again", label: "계속", to: "constructor", questUpdates: [{ quest: "__proto__", action: "completeObjective" as const, objective: "talk" }] }] }]]) });
function roots() { const owner = {}, q = new QuestLog(qdoc()), a = new DialogueSession(graph(), q), b = new DialogueSession(graph(), q); register(owner, "__proto__", q); register(owner, "a", a); register(owner, "b", b); return { owner, q, a, b }; }
function free(g: {
    quests: readonly QuestLog[];
    dialogues: readonly DialogueSession[];
}) { for (const d of g.dialogues)
    d.destroy(); for (const q of g.quests)
    q.destroy(); }
function sourceBytes(v: object) { const h = nativeFileDialogueQuestPacket(v, new Uint8Array()); return nativeFileDialogueQuestPacket(v, h); }
const json = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function error(code: string) { return (e: unknown) => e instanceof NativeFileDialogueQuestError && e.code === code; }
test("native file actual graph preserves content, shared Rc, arbitrary stage/objective history and six continuations", () => {
    const r = roots();
    r.q.restore({ quests: [{ id: "__proto__", status: "completed", stage: "unknown stage", completedObjectives: ["talk", "talk", "🙂"] }] });
    r.a.restore({ nodeId: "constructor", flags: ["\u{10000}", "\ue000", "constructor", "__proto__"], ended: false });
    register(r.owner, "alias", r.a);
    const before = [sourceBytes(r.q), sourceBytes(r.a), sourceBytes(r.b)], c = capture(r.owner, budget()), target = {}, p = prepare(target, c.bytes, budget(), { owner: r.owner, fence: c.fence }), g = consume(target, p, budget());
    equal(g.quests.length, 1);
    equal(g.dialogues.length, 2);
    equal(g.bindings[1].value, g.bindings[3].value);
    deepEqual(g.quests[0].snapshot(), r.q.snapshot());
    deepEqual(g.dialogues[0].snapshot(), r.a.snapshot());
    deepEqual(g.dialogues[0].currentNode(), r.a.currentNode());
    deepEqual([sourceBytes(r.q), sourceBytes(r.a), sourceBytes(r.b)], before);
    for (let i = 0; i < 6; i++) {
        r.a.choose("again");
        g.dialogues[0].choose("again");
        r.b.choose("again");
        g.dialogues[1].choose("again");
        deepEqual(g.quests[0].snapshot(), r.q.snapshot());
        deepEqual(g.dialogues[0].snapshot(), r.a.snapshot());
    }
    const copied = {}, again = g.bindings;
    for (const b of again)
        register(copied, b.symbol, b.value);
    const next = json(capture(copied, budget()).bytes);
    deepEqual(next.quests[0].native.savedOrigin, json(c.bytes).quests[0].native.origin);
    free(g);
    free({ quests: [r.q], dialogues: [r.a, r.b] });
});
test("native file destroyed Quest wrapper is retained through actual linked dialogue, and NativeAbsent tombstones invent no progress", () => {
    const r = roots();
    r.q.apply({ quest: "__proto__", action: "complete" });
    r.q.destroy();
    r.q.destroy();
    const c = capture(r.owner, budget()), f = json(c.bytes);
    equal(f.quests[0].wrapper, "destroyed");
    ok(f.quests[0].native);
    const target = {}, p = prepare(target, c.bytes, budget()), g = consume(target, p, budget());
    throws(() => g.quests[0].snapshot());
    g.dialogues[0].choose("again");
    const h = nativeFileDialogueQuestPacket(g.dialogues[1], new Uint8Array());
    g.dialogues[0].choose("again");
    notEqual(String(nativeFileDialogueQuestPacket(g.dialogues[1], new Uint8Array())), String(h));
    free(g);
    r.a.destroy();
    r.b.destroy();
    const absent = capture(r.owner, budget()), af = json(absent.bytes);
    equal(af.quests[0].native, null);
    equal(af.dialogues[0].native, null);
    const t = {}, ap = prepare(t, absent.bytes, budget()), ag = consume(t, ap, budget());
    throws(() => ag.quests[0].snapshot());
    throws(() => ag.dialogues[0].currentNode());
    free(ag);
});
test("native file directed closure includes unregistered quest and observes external shared progress without claiming external root", () => {
    const q = new QuestLog(qdoc()), a = new DialogueSession(graph(), q), external = new DialogueSession(graph(), q), owner = {};
    register(owner, "a", a);
    q.destroy();
    const c = capture(owner, budget()), f = json(c.bytes);
    equal(f.quests.length, 1);
    equal(f.dialogues.length, 1);
    equal(f.bindings.length, 1);
    external.choose("again");
    equal(unchanged(owner, c.fence, budget()), false);
    const t = {}, p = prepare(t, c.bytes, budget()), g = consume(t, p, budget());
    throws(() => g.quests[0].snapshot());
    g.dialogues[0].choose("again");
    free(g);
    a.destroy();
    external.destroy();
});
test("native file owner proof, source restore ABA, lifecycle, registry and prepared alias fences are one use", () => {
    const r = roots();
    throws(() => register({}, "fake", Object.create(QuestLog.prototype)), error("OWNER"));
    const c = capture(r.owner, budget());
    r.q.restore(r.q.snapshot());
    equal(unchanged(r.owner, c.fence, budget()), false);
    const now = capture(r.owner, budget()), target = {}, p = prepare(target, now.bytes, budget(), { owner: r.owner, fence: now.fence });
    throws(() => consume({}, p, budget()), error("OWNER"));
    inspect(target, p).dialogues[0].restore(inspect(target, p).dialogues[0].snapshot());
    throws(() => consume(target, p, budget()), error("STALE"));
    discard(target, p);
    discard(target, p);
    throws(() => consume(target, p, budget()), error("TOKEN"));
    const p2 = prepare(target, now.bytes, budget());
    const g = consume(target, p2, budget());
    throws(() => consume(target, p2, budget()), error("TOKEN"));
    free(g);
    const c2 = capture(r.owner, budget());
    unregister(r.owner, "a", "dialogue");
    register(r.owner, "a", r.a);
    equal(unchanged(r.owner, c2.fence, budget()), false);
    const c3 = capture(r.owner, budget());
    r.q.destroy();
    equal(unchanged(r.owner, c3.fence, budget()), false);
    free({ quests: [r.q], dialogues: [r.a, r.b] });
});
test("native file strict bytes/graph links/flags/quest identities reject without repairing or mutating sources", () => {
    const r = roots(), c = capture(r.owner, budget()), before = sourceBytes(r.a);
    const cases: ((f: any) => void)[] = [f => { f.dialogues[0].quest = 999; }, f => { f.bindings.push(f.bindings[0]); }, f => { f.quests.push(f.quests[0]); }, f => { f.dialogues[0].wrapper = "destroyed"; }, f => { f.quests[0].native.progress[4] = 0; }, f => { f.dialogues[0].native.progress.push(0); }, f => { f.quests[0].native.origin = [-1, 0]; }];
    for (const mutate of cases) {
        const f = json(c.bytes);
        mutate(f);
        const bad = bytes(f), copy = bad.slice();
        throws(() => prepare({}, bad, budget()));
        deepEqual(bad, copy);
        deepEqual(sourceBytes(r.a), before);
    }
    // Native progress permits arbitrary stages and duplicate objectives, but flags
    // must retain the exact native order rather than public snapshot UTF-16 sort.
    const raw = (flags: string[]) => { const chunks: number[] = []; const w = (n: number) => chunks.push(n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255); const s = (v: string) => { const b = new TextEncoder().encode(v); w(b.length); chunks.push(...b); }; w(1); s("constructor"); w(flags.length); flags.forEach(s); w(0); return chunks; };
    for (const flags of [["same", "same"], ["\u{10000}", "\ue000"]]) {
        const f = json(c.bytes);
        f.dialogues[0].native.progress = raw(flags);
        throws(() => prepare({}, bytes(f), budget()), error("REFERENCE"));
    }
    throws(() => prepare({}, new Uint8Array([0xff]), budget()));
    throws(() => prepare({}, new TextEncoder().encode('{"format":1,"format":2}'), budget()));
    free({ quests: [r.q], dialogues: [r.a, r.b] });
});
test("native file shared ledger exact and one-below metadata/work/resource/source/decoded quotas remain cumulative", () => {
    const r = roots();
    const b = budget(), c = capture(r.owner, b), usage = b.usage();
    const mapping = { resources: "maxResources", work: "maxWork", metadataBytes: "maxMetadataBytes", sourceBytes: "maxSourceBytes", decodedBytes: "maxDecodedBytes" } as const;
    for (const metric of Object.keys(mapping) as (keyof typeof mapping)[]) {
        const exact = new ResourceBudget({ [mapping[metric]]: usage[metric] });
        deepEqual(capture(r.owner, exact).bytes, c.bytes);
        const low = new ResourceBudget({ [mapping[metric]]: usage[metric] - 1 });
        throws(() => capture(r.owner, low), (e: unknown) => e instanceof NativeFileResourceError && e.code === "LIMIT");
    }
    const t = {}, pb = budget(), p = prepare(t, c.bytes, pb);
    const pu = pb.usage();
    discard(t, p);
    for (const metric of Object.keys(mapping) as (keyof typeof mapping)[]) {
        const exact = new ResourceBudget({ [mapping[metric]]: pu[metric] });
        const ep = prepare(t, c.bytes, exact);
        discard(t, ep);
        const low = new ResourceBudget({ [mapping[metric]]: pu[metric] - 1 });
        throws(() => prepare(t, c.bytes, low), (e: unknown) => e instanceof NativeFileResourceError && e.code === "LIMIT");
    }
    const shared = new ResourceBudget({ maxSourceBytes: c.bytes.length * 2 - 1 });
    capture(r.owner, shared);
    throws(() => prepare({}, c.bytes, shared), (e: unknown) => e instanceof NativeFileResourceError);
    free({ quests: [r.q], dialogues: [r.a, r.b] });
});
test("native file complete immutable content preserves safe prototype keys, cycles, aliases, undefined, sparse arrays and -0", () => {
    const content: any = { value: -0, optional: undefined, sparse: new Array(3), title: "\ud800🙂" };
    content.self = content;
    content.alias = content.sparse;
    content.sparse[2] = "x";
    Object.defineProperty(content, "__proto__", { value: { constructor: "data" }, enumerable: true });
    const encoded = captureContent(content, budget()), copied: any = materialize(JSON.parse(JSON.stringify(encoded)), budget());
    equal(copied.self, copied);
    equal(copied.alias, copied.sparse);
    equal(0 in copied.sparse, false);
    equal(Object.prototype.hasOwnProperty.call(copied, "optional"), true);
    ok(Object.is(copied.value, -0));
    equal(copied.title, content.title);
    equal(Object.getPrototypeOf(copied), Object.prototype);
    equal(copied.__proto__.constructor, "data");
    ok(Object.isFrozen(copied));
    const doc: any = { quests: { key: { id: "__proto__", title: "", stages: [{ id: "constructor", title: "", objectives: [{ id: "", text: "" }] }] } }, extra: content };
    const q = new QuestLog(doc), o = {};
    register(o, "q", q);
    const c = capture(o, budget()), target = {}, p = prepare(target, c.bytes, budget()), g = consume(target, p, budget());
    deepEqual(g.quests[0].snapshot(), q.snapshot());
    const saved: any = nativeFileDialogueQuestOwner(g.quests[0])!.content;
    equal(saved.extra.self, saved.extra);
    equal(saved.extra.alias, saved.extra.sparse);
    equal(saved.quests.key.title, "");
    equal(saved.quests.key.stages[0].objectives[0].id, "");
    ok(Object.is(saved.extra.value, -0));
    free(g);
    q.destroy();
    throws(() => captureContent(new Map(), budget()), error("CONTENT"));
    const huge = new Array(65537);
    throws(() => captureContent(huge, budget()), error("LIMIT"));
});
test("native file checked header quota precedes body allocation and detects reentrant mutation", () => {
    const r = roots();
    const before = sourceBytes(r.q), bodyCharge = 48 + (before.length - 16) * 2, b = budget();
    let changed = false;
    const reentrant = { work: (n: number) => b.work(n), metadata: (s: string) => b.metadata(s), charge: (k: "resources" | "sourceBytes" | "decodedBytes", n: number) => { b.charge(k, n); if (!changed && k === "decodedBytes" && n === bodyCharge) {
            changed = true;
            r.q.restore(r.q.snapshot());
        } } };
    // This deliberately trusted ledger mutates a source while its read is in
    // progress. Either the checked native header or final capture fence rejects.
    throws(() => capture(r.owner, reentrant), error("STALE"));
    ok(changed);
    notEqual(String(sourceBytes(r.q)), String(before));
    free({ quests: [r.q], dialogues: [r.a, r.b] });
});
test("native file injected native factory failure frees every detached allocation and preserves source bytes", () => {
    const r = roots(), c = capture(r.owner, budget()), before = [sourceBytes(r.q), sourceBytes(r.a), sourceBytes(r.b)];
    const original = NativeDialogueSession.file_with_quests, qFree = NativeQuestLog.prototype.free, dFree = NativeDialogueSession.prototype.free;
    let calls = 0, qFreed = 0, dFreed = 0;
    NativeDialogueSession.file_with_quests = (...args) => { if (++calls === 2)
        throw new Error("injected allocation failure"); return original(...args); };
    NativeQuestLog.prototype.free = function () { qFreed++; return qFree.call(this); };
    NativeDialogueSession.prototype.free = function () { dFreed++; return dFree.call(this); };
    try {
        throws(() => prepare({}, c.bytes, budget()), error("NATIVE"));
        equal(calls, 2);
        equal(qFreed, 1);
        equal(dFreed, 1);
        deepEqual([sourceBytes(r.q), sourceBytes(r.a), sourceBytes(r.b)], before);
    }
    finally {
        NativeDialogueSession.file_with_quests = original;
        NativeQuestLog.prototype.free = qFree;
        NativeDialogueSession.prototype.free = dFree;
        free({ quests: [r.q], dialogues: [r.a, r.b] });
    }
});
test("native file native probe and checked output are charged before calls, and mismatched headers reject source atomically", () => {
    const q = new QuestLog(qdoc()), owner = {};
    register(owner, "q", q);
    const before = sourceBytes(q), expectedBodyCharge = 48 + (before.length - 16) * 2, original = NativeQuestLog.prototype.file_state_packet;
    let probes = 0, bodies = 0;
    NativeQuestLog.prototype.file_state_packet = function (expected) { if (expected.length)
        bodies++;
    else
        probes++; return original.call(this, expected); };
    const b = budget(), stop = { work: (n: number) => b.work(n), metadata: (s: string) => b.metadata(s), charge: (k: "resources" | "sourceBytes" | "decodedBytes", n: number) => { if (k === "decodedBytes" && n === expectedBodyCharge)
            throw new NativeFileResourceError("LIMIT", "decodedBytes"); b.charge(k, n); } };
    try {
        throws(() => capture(owner, stop), (e: unknown) => e instanceof NativeFileResourceError);
        equal(probes, 1);
        equal(bodies, 0);
    }
    finally {
        NativeQuestLog.prototype.file_state_packet = original;
    }
    deepEqual(sourceBytes(q), before);
    const wrong = nativeFileDialogueQuestPacket(q, new Uint8Array());
    wrong[12] ^= 1;
    throws(() => nativeFileDialogueQuestPacket(q, wrong));
    deepEqual(sourceBytes(q), before);
    q.destroy();
});
test("native file equal-valued quest owners stay distinct while each dialogue edge retains its actual owner", () => {
    const q1 = new QuestLog(qdoc()), q2 = new QuestLog(qdoc()), a = new DialogueSession(graph(), q1), b = new DialogueSession(graph(), q2), source = {};
    register(source, "a", a);
    register(source, "b", b);
    const c = capture(source, budget()), f = json(c.bytes);
    equal(f.quests.length, 2);
    equal(f.dialogues[0].quest, 0);
    equal(f.dialogues[1].quest, 1);
    const t = {}, p = prepare(t, c.bytes, budget()), g = consume(t, p, budget());
    notEqual(g.quests[0], g.quests[1]);
    g.quests[0].apply({ quest: "__proto__", action: "complete" });
    notEqual(g.quests[0].snapshot().quests[0].status, g.quests[1].snapshot().quests[0].status);
    free(g);
    free({ quests: [q1, q2], dialogues: [a, b] });
});
