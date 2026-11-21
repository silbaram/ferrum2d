/** @internal Standalone actual SDK roots and their directed reachable native
 * owner graph. This is neither an Engine importer nor a whole-session Ready
 * boundary. External unregistered dialogues are not captured as roots; mutations
 * through one sharing an included quest are detected by the linked native epoch.
 * Caller supplies owned bytes and one shared resource ledger (no resets here).
 */
import { QuestLog, DialogueSession, nativeFileDialogueQuestOwner as describe, nativeFileDialogueQuestPacket as packet, nativeFileCreateQuest, nativeFileCreateDialogue } from "./dialogueQuest.js";
import type { ResolvedQuestDocument, ResolvedDialogueGraph, NativeFileDialogueQuestOwner as Owner } from "./dialogueQuest.js";
import { defineNativeFileHostBindingType, registerNativeFileHostBinding, unregisterNativeFileHostBinding, captureNativeFileHostBinding, captureNativeFileHostBindingFence, nativeFileHostBindingFenceUnchanged } from "./nativeFileHostBindings.js";
import type { NativeFileHostBindingFence } from "./nativeFileHostBindings.js";
import { readNativeFileJson } from "./nativeFileJson.js";
import type { WasmNamespace } from "./wasmNamespace.js";
import { captureNativeFileDialogueQuestContent as captureContent, materializeNativeFileDialogueQuestContent as materialize } from "./nativeFileDialogueQuestContent.js";
import { fileDialogueQuestRequire as check, NativeFileDialogueQuestError } from "./nativeFileDialogueQuestTypes.js";
import type { NativeFileDialogueQuestBudget as Budget } from "./nativeFileDialogueQuestTypes.js";
import { byteArray, byteList, config, encodeFile, equal, fields, list, nativeHeader, origin, record, revision, text, u32, validateProgress, word } from "./nativeFileDialogueQuestCodec.js";
export { NativeFileDialogueQuestError };
export type { NativeFileDialogueQuestBudget } from "./nativeFileDialogueQuestTypes.js";
const questType = defineNativeFileHostBindingType<QuestLog>("dialogue-quest.quest", 1, (v, identity): v is QuestLog => v === identity && !!v && typeof v === "object" && describe(v)?.kind === "quest");
const dialogueType = defineNativeFileHostBindingType<DialogueSession>("dialogue-quest.dialogue", 1, (v, identity): v is DialogueSession => v === identity && !!v && typeof v === "object" && describe(v)?.kind === "dialogue");
const MAX_ROOTS = 4096, EMPTY = new Uint8Array();
interface Entry {
    readonly symbol: string;
    readonly value: QuestLog | DialogueSession;
    readonly kind: "quest" | "dialogue";
}
const registries = new WeakMap<object, Map<string, Entry>>();
function key(kind: string, symbol: string): string { return `${kind}\0${symbol}`; }
function owner(v: object): Readonly<Owner> { const result = describe(v); check(result, "OWNER", "actual-sdk-owner"); return result; }
/** Explicit host registration proves constructor ownership, never instanceof or
 * caller-supplied same-value snapshots. Dead wrappers are valid participants. */
export function registerNativeFileDialogueQuest(ownerKey: object, symbol: string, value: QuestLog | DialogueSession): void {
    const info = owner(value), entries = registries.get(ownerKey) ?? new Map<string, Entry>();
    check(entries.size < MAX_ROOTS, "LIMIT", "participants");
    if (info.kind === "quest")
        registerNativeFileHostBinding(ownerKey, questType, symbol, value as QuestLog);
    else
        registerNativeFileHostBinding(ownerKey, dialogueType, symbol, value as DialogueSession);
    entries.set(key(info.kind, symbol), { symbol, value, kind: info.kind });
    registries.set(ownerKey, entries);
}
export function unregisterNativeFileDialogueQuest(ownerKey: object, symbol: string, kind: "quest" | "dialogue"): boolean {
    const changed = kind === "quest" ? unregisterNativeFileHostBinding(ownerKey, questType, symbol) : unregisterNativeFileHostBinding(ownerKey, dialogueType, symbol);
    registries.get(ownerKey)?.delete(key(kind, symbol));
    return changed;
}
interface Observation {
    readonly value: object;
    readonly token: object;
    readonly destroyed: boolean;
    readonly header?: Uint8Array;
    readonly quest?: {
        readonly token: object;
        readonly destroyed: boolean;
    };
}
export interface NativeFileDialogueQuestFence {
    readonly kind: "native-file-dialogue-quest-fence";
}
interface FenceState {
    readonly owner: object;
    readonly host: NativeFileHostBindingFence;
    readonly observations: readonly Observation[];
}
const fences = new WeakMap<NativeFileDialogueQuestFence, FenceState>();
function probe(value: object, kind: "quest" | "dialogue", budget: Budget): Uint8Array { budget.work(1); budget.charge("decodedBytes", kind === "quest" ? 32 : 64); let p: Uint8Array; try {
    p = packet(value, EMPTY);
}
catch {
    throw new NativeFileDialogueQuestError("STALE", "native-probe");
} nativeHeader(p, kind); return p; }
function checkedPacket(value: object, kind: "quest" | "dialogue", budget: Budget): {
    header: Uint8Array;
    body: Uint8Array;
    linked?: Uint8Array;
} {
    const header = probe(value, kind, budget), n = word(header, 12), q = kind === "dialogue" ? word(header, 28) : 0;
    budget.work(n + q);
    budget.charge("decodedBytes", header.length * 3 + (n + q) * 2);
    let result: Uint8Array;
    try {
        result = packet(value, header);
    }
    catch {
        throw new NativeFileDialogueQuestError("STALE", "native-header");
    }
    check(result.length === header.length + n + q && equal(result.subarray(0, header.length), header), "NATIVE", "checked-packet");
    return { header, body: result.subarray(header.length, header.length + n), ...(q ? { linked: result.subarray(header.length + n) } : {}) };
}
/** Every check charges the same ledger before fixed native probe allocation. */
export function nativeFileDialogueQuestFenceUnchanged(ownerKey: object, token: NativeFileDialogueQuestFence, budget: Budget): boolean {
    const state = fences.get(token);
    if (!state || state.owner !== ownerKey || !nativeFileHostBindingFenceUnchanged(ownerKey, state.host))
        return false;
    budget.work(state.observations.length);
    for (const old of state.observations) {
        const now = describe(old.value);
        if (!now || now.token !== old.token || now.destroyed !== old.destroyed || (old.quest && (now.kind !== "dialogue" || now.quest?.token !== old.quest.token || now.quest.destroyed !== old.quest.destroyed)))
            return false;
        if (old.header && !equal(probe(old.value, now.kind, budget), old.header))
            return false;
    }
    return nativeFileHostBindingFenceUnchanged(ownerKey, state.host);
}
interface NativeState {
    readonly progress: readonly number[];
    readonly origin: readonly [
        number,
        number
    ];
    readonly savedOrigin?: readonly [
        number,
        number
    ];
}
interface QuestRow {
    readonly content: unknown;
    readonly wrapper: "live" | "destroyed";
    native: NativeState | null;
}
interface DialogueRow extends QuestRow {
    readonly quest: number | null;
}
interface Binding {
    readonly kind: "quest" | "dialogue";
    readonly symbol: string;
    readonly index: number;
}
interface FileGraph {
    readonly format: "ferrum-native-dialogue-quest-graph";
    readonly version: 1;
    readonly quests: QuestRow[];
    readonly dialogues: DialogueRow[];
    readonly bindings: Binding[];
}
export interface CapturedNativeFileDialogueQuest {
    readonly bytes: Uint8Array;
    readonly fence: NativeFileDialogueQuestFence;
}
export function captureNativeFileDialogueQuest(ownerKey: object, budget: Budget): CapturedNativeFileDialogueQuest {
    const host = captureNativeFileHostBindingFence(ownerKey), entries = registries.get(ownerKey), count = entries?.size ?? 0;
    check(count <= MAX_ROOTS, "LIMIT", "participants");
    budget.work(count);
    budget.charge("decodedBytes", count * 128);
    const file: FileGraph = { format: "ferrum-native-dialogue-quest-graph", version: 1, quests: [], dialogues: [], bindings: [] };
    const savedOrigins = new Map<number, readonly [
        number,
        number
    ]>();
    const qIndexes = new Map<object, number>(), dIndexes = new Map<object, number>(), observations: Observation[] = [];
    const addQuest = (q: Readonly<Extract<Owner, {
        kind: "quest";
    }>>): number => { const old = qIndexes.get(q.token); if (old !== undefined)
        return old; const i = file.quests.length; check(i < MAX_ROOTS * 2, "LIMIT", "quests"); budget.work(1); budget.charge("resources", 1); file.quests.push({ content: captureContent(q.content, budget), wrapper: q.destroyed ? "destroyed" : "live", native: null }); qIndexes.set(q.token, i); if (q.savedOrigin)
        savedOrigins.set(i, q.savedOrigin); return i; };
    const mergeQuest = (i: number, p: Uint8Array, rev: [
        number,
        number
    ]): void => { const row = file.quests[i]; const progress = byteList(p, budget); if (row.native)
        check(equal(byteArray(row.native.progress, budget), p) && row.native.origin[0] === rev[0] && row.native.origin[1] === rev[1], "STALE", "shared-quest");
    else
        row.native = { progress, origin: rev, ...(savedOrigins.has(i) ? { savedOrigin: savedOrigins.get(i)! } : {}) }; };
    if (entries)
        for (const entry of entries.values()) {
            const info = owner(entry.value);
            if (entry.kind === "quest")
                captureNativeFileHostBinding(ownerKey, questType, entry.value, entry.symbol);
            else
                captureNativeFileHostBinding(ownerKey, dialogueType, entry.value, entry.symbol);
            let index: number;
            if (info.kind === "quest") {
                index = addQuest(info);
                if (!info.destroyed) {
                    const p = checkedPacket(entry.value, "quest", budget);
                    mergeQuest(index, p.body, revision(p.header));
                    observations.push({ value: entry.value, token: info.token, destroyed: false, header: p.header });
                }
                else
                    observations.push({ value: entry.value, token: info.token, destroyed: true });
            }
            else {
                const old = dIndexes.get(info.token);
                if (old !== undefined)
                    index = old;
                else {
                    index = file.dialogues.length;
                    budget.work(1);
                    budget.charge("resources", 1);
                    const content = captureContent(info.content, budget);
                    if (info.destroyed) {
                        file.dialogues.push({ content, wrapper: "destroyed", native: null, quest: null });
                        observations.push({ value: entry.value, token: info.token, destroyed: true });
                    }
                    else {
                        const q = info.quest, qi = q === undefined ? null : addQuest(q), p = checkedPacket(entry.value, "dialogue", budget);
                        check((q !== undefined) === (p.linked !== undefined), "NATIVE", "actual-linked-quest");
                        if (qi !== null)
                            mergeQuest(qi, p.linked!, revision(p.header, 20));
                        file.dialogues.push({ content, wrapper: "live", native: { progress: byteList(p.body, budget), origin: revision(p.header), ...(info.savedOrigin ? { savedOrigin: info.savedOrigin } : {}) }, quest: qi });
                        observations.push({ value: entry.value, token: info.token, destroyed: false, header: p.header, ...(q ? { quest: { token: q.token, destroyed: q.destroyed } } : {}) });
                    }
                    dIndexes.set(info.token, index);
                }
            }
            budget.metadata(entry.symbol);
            file.bindings.push({ kind: info.kind, symbol: entry.symbol, index });
        }
    for (const q of file.quests)
        check(q.wrapper === "destroyed" || q.native !== null, "NATIVE", "missing-live-quest");
    const fence = Object.freeze({ kind: "native-file-dialogue-quest-fence" as const });
    fences.set(fence, { owner: ownerKey, host, observations });
    const bytes = encodeFile(file, budget);
    check(nativeFileDialogueQuestFenceUnchanged(ownerKey, fence, budget), "STALE", "capture-fence");
    return Object.freeze({ bytes, fence });
}
function provenance(v: unknown): readonly [
    number,
    number
] { check(record(v), "CONTENT", "provenance"); return origin(v.savedOrigin ?? v.origin); }
interface AdmittedQuest {
    readonly content: ResolvedQuestDocument;
    readonly wrapper: "live" | "destroyed";
    readonly config: Uint8Array;
    readonly progress?: Uint8Array;
    readonly savedOrigin?: readonly [
        number,
        number
    ];
}
interface AdmittedDialogue {
    readonly content: ResolvedDialogueGraph;
    readonly wrapper: "live" | "destroyed";
    readonly config: Uint8Array;
    readonly progress?: Uint8Array;
    readonly quest: number | null;
    readonly savedOrigin?: readonly [
        number,
        number
    ];
}
function state(v: unknown, content: ResolvedQuestDocument | ResolvedDialogueGraph, kind: "quest" | "dialogue", budget: Budget): Uint8Array | undefined { if (v === null)
    return undefined; fields(v, ["progress", "origin", "savedOrigin"]); origin(v.origin); if (v.savedOrigin !== undefined)
    origin(v.savedOrigin); const p = byteArray(v.progress, budget); validateProgress(p, content, kind, budget); return p; }
export interface PreparedNativeFileDialogueQuest {
    readonly kind: "native-file-dialogue-quest-prepared";
}
export interface NativeFileDialogueQuestGraph {
    readonly quests: readonly QuestLog[];
    readonly dialogues: readonly DialogueSession[];
    readonly bindings: readonly {
        readonly kind: "quest" | "dialogue";
        readonly symbol: string;
        readonly value: QuestLog | DialogueSession;
    }[];
}
interface Plan {
    readonly owner: object;
    readonly host: NativeFileHostBindingFence;
    readonly graph: NativeFileDialogueQuestGraph;
    readonly candidateFence: NativeFileDialogueQuestFence;
    readonly candidateOwner: object;
    readonly source?: {
        readonly owner: object;
        readonly fence: NativeFileDialogueQuestFence;
    };
}
const plans = new WeakMap<PreparedNativeFileDialogueQuest, Plan>();
function nativeCreate<T>(operation: () => T): T { try {
    return operation();
}
catch {
    throw new NativeFileDialogueQuestError("NATIVE", "detached-native-allocation-or-content");
} }
function dispose(graph: NativeFileDialogueQuestGraph): void { for (const d of graph.dialogues)
    d.destroy(); for (const q of graph.quests)
    q.destroy(); }
/** @internal Host-owned target only; never read from file metadata or public
 * QuestLog/DialogueSession constructors. The default singleton path is unchanged. */
export interface NativeFileDialogueQuestPrepareOptions {
    readonly targetNamespace?: WasmNamespace;
}
/** All validation/materialization precedes native graph creation. Failure frees
 * every newly created native wrapper. Target/source registries are unchanged. */
export function prepareNativeFileDialogueQuest(ownerKey: object, bytes: Uint8Array, budget: Budget, source?: {
    readonly owner: object;
    readonly fence: NativeFileDialogueQuestFence;
}, options: NativeFileDialogueQuestPrepareOptions = {}): PreparedNativeFileDialogueQuest {
    if (options.targetNamespace !== undefined) options.targetNamespace.call(() => undefined);
    const host = captureNativeFileHostBindingFence(ownerKey);
    // Already-owned ordinary bytes only; the generic reader performs intrinsic
    // buffer checks before parsing. Quotas are semantic ledgers, not global RSS.
    const n = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!.call(bytes) as number;
    check(n <= 64 * 1024 * 1024, "LIMIT", "file-bytes");
    budget.charge("sourceBytes", n);
    budget.work(n);
    budget.charge("decodedBytes", n * 64);
    const input: unknown = readNativeFileJson(bytes, { maxBytes: 64 * 1024 * 1024, maxDepth: 128, maxValues: 1024 * 1024, maxMembers: 1024 * 1024, maxStringCodeUnits: 4 * 1024 * 1024, maxTotalStringCodeUnits: 16 * 1024 * 1024 }).value;
    fields(input, ["format", "version", "quests", "dialogues", "bindings"]);
    check(input.format === "ferrum-native-dialogue-quest-graph" && input.version === 1, "CONTENT", "format");
    list(input.quests, budget);
    list(input.dialogues, budget);
    list(input.bindings, budget);
    check(input.bindings.length <= MAX_ROOTS && input.quests.length <= MAX_ROOTS * 2 && input.dialogues.length <= MAX_ROOTS, "LIMIT", "graph-size");
    const qs: AdmittedQuest[] = [], ds: AdmittedDialogue[] = [], bindings: Binding[] = [], usedQ = new Set<number>(), usedD = new Set<number>(), keys = new Set<string>();
    for (const row of input.quests) {
        fields(row, ["content", "wrapper", "native"]);
        check(row.wrapper === "live" || row.wrapper === "destroyed", "CONTENT", "wrapper");
        const content = materialize(row.content, budget) as ResolvedQuestDocument;
        const c = config(content, "quest", budget);
        const progress = state(row.native, content, "quest", budget);
        check(row.wrapper === "destroyed" || progress, "REFERENCE", "live-quest-native");
        budget.charge("resources", 1);
        qs.push({ content, wrapper: row.wrapper, config: c, progress, ...(progress ? { savedOrigin: provenance(row.native) } : {}) });
    }
    for (const row of input.dialogues) {
        fields(row, ["content", "wrapper", "native", "quest"]);
        check(row.wrapper === "live" || row.wrapper === "destroyed", "CONTENT", "wrapper");
        const content = materialize(row.content, budget) as ResolvedDialogueGraph;
        const c = config(content, "dialogue", budget);
        const progress = state(row.native, content, "dialogue", budget);
        check((row.wrapper === "live") === !!progress, "REFERENCE", "dialogue-lifecycle");
        if (row.quest !== null) {
            u32(row.quest);
            check(row.quest < qs.length && !!progress && !!qs[row.quest].progress, "REFERENCE", "quest-link");
            usedQ.add(row.quest);
        }
        budget.charge("resources", 1);
        ds.push({ content, wrapper: row.wrapper, config: c, progress, quest: row.quest as number | null, ...(progress ? { savedOrigin: provenance(row.native) } : {}) });
    }
    for (const b of input.bindings) {
        fields(b, ["kind", "symbol", "index"]);
        check(b.kind === "quest" || b.kind === "dialogue", "REFERENCE", "binding-kind");
        text(b.symbol);
        check(b.symbol.length <= 1024 && !!b.symbol.trim() && !b.symbol.includes("\0"), "REFERENCE", "binding-symbol");
        budget.metadata(b.symbol);
        u32(b.index);
        const k = key(b.kind, b.symbol);
        check(!keys.has(k), "REFERENCE", "duplicate-binding");
        keys.add(k);
        check(b.index < (b.kind === "quest" ? qs.length : ds.length), "REFERENCE", "binding-index");
        (b.kind === "quest" ? usedQ : usedD).add(b.index);
        bindings.push({ kind: b.kind, symbol: b.symbol, index: b.index });
    }
    check(usedQ.size === qs.length && usedD.size === ds.length, "REFERENCE", "unreachable-row");
    // Native-present dead quests require a live dialogue carrier in this declared
    // graph; an unrelated last snapshot is never accepted as a live Rc owner.
    for (let i = 0; i < qs.length; i++)
        if (qs[i].wrapper === "destroyed" && qs[i].progress) {
            budget.work(ds.length);
            check(ds.some(d => d.quest === i && !!d.progress), "REFERENCE", "orphan-native-quest");
        }
    const graph: {
        quests: QuestLog[];
        dialogues: DialogueSession[];
        bindings: {
            kind: "quest" | "dialogue";
            symbol: string;
            value: QuestLog | DialogueSession;
        }[];
    } = { quests: [], dialogues: [], bindings: [] };
    try {
        for (const q of qs) {
            budget.work(1);
            graph.quests.push(nativeCreate(() => nativeFileCreateQuest(q.content, q.progress ? q.config : undefined, q.progress, q.savedOrigin, options.targetNamespace)));
        }
        for (const d of ds) {
            budget.work(1);
            graph.dialogues.push(nativeCreate(() => nativeFileCreateDialogue(d.content, d.progress ? d.config : undefined, d.progress, d.quest === null ? undefined : graph.quests[d.quest], d.savedOrigin, options.targetNamespace)));
        }
        // Read actual newly created native state rather than assuming restore did
        // not normalize input. A mismatch rejects and frees this entire graph.
        budget.work(qs.length + ds.length);
        for (let i = 0; i < qs.length; i++)
            if (qs[i].progress)
                check(equal(checkedPacket(graph.quests[i], "quest", budget).body, qs[i].progress!), "NATIVE", "prepared-quest-progress");
        for (let i = 0; i < ds.length; i++)
            if (ds[i].progress) {
                const actual = checkedPacket(graph.dialogues[i], "dialogue", budget);
                check(equal(actual.body, ds[i].progress!), "NATIVE", "prepared-dialogue-progress");
                if (ds[i].quest !== null)
                    check(actual.linked && equal(actual.linked, qs[ds[i].quest!].progress!), "NATIVE", "prepared-linked-quest-progress");
                else
                    check(!actual.linked, "NATIVE", "prepared-unlinked-dialogue");
            }
        for (let i = 0; i < qs.length; i++)
            if (qs[i].wrapper === "destroyed")
                graph.quests[i].destroy();
        for (const b of bindings)
            graph.bindings.push(Object.freeze({ kind: b.kind, symbol: b.symbol, value: b.kind === "quest" ? graph.quests[b.index] : graph.dialogues[b.index] }));
        Object.freeze(graph.quests);
        Object.freeze(graph.dialogues);
        Object.freeze(graph.bindings);
        Object.freeze(graph);
        const candidateOwner = {};
        for (const b of graph.bindings)
            registerNativeFileDialogueQuest(candidateOwner, b.symbol, b.value);
        const candidateFence = captureNativeFileDialogueQuest(candidateOwner, budget).fence;
        check(nativeFileHostBindingFenceUnchanged(ownerKey, host) && (!source || nativeFileDialogueQuestFenceUnchanged(source.owner, source.fence, budget)), "STALE", "prepare-fence");
        const token = Object.freeze({ kind: "native-file-dialogue-quest-prepared" as const });
        plans.set(token, { owner: ownerKey, host, graph, candidateOwner, candidateFence, source });
        return token;
    }
    catch (error) {
        dispose(graph);
        throw error;
    }
}
function plan(ownerKey: object, token: PreparedNativeFileDialogueQuest): Plan { const p = plans.get(token); check(p, "TOKEN", "prepared"); check(p.owner === ownerKey, "OWNER", "prepared-owner"); return p; }
/** Borrowed candidate identities remain fenced: a mutation through an alias
 * invalidates consume, and discard still frees the whole unpublished graph. */
export function inspectPreparedNativeFileDialogueQuest(ownerKey: object, token: PreparedNativeFileDialogueQuest): NativeFileDialogueQuestGraph { return plan(ownerKey, token).graph; }
export function consumePreparedNativeFileDialogueQuest(ownerKey: object, token: PreparedNativeFileDialogueQuest, budget: Budget): NativeFileDialogueQuestGraph {
    const p = plan(ownerKey, token);
    check(nativeFileHostBindingFenceUnchanged(ownerKey, p.host) && nativeFileDialogueQuestFenceUnchanged(p.candidateOwner, p.candidateFence, budget) && (!p.source || nativeFileDialogueQuestFenceUnchanged(p.source.owner, p.source.fence, budget)), "STALE", "consume-fence");
    plans.delete(token);
    return p.graph;
}
export function discardPreparedNativeFileDialogueQuest(ownerKey: object, token: PreparedNativeFileDialogueQuest): void { const p = plans.get(token); if (!p)
    return; check(p.owner === ownerKey, "OWNER", "prepared-owner"); plans.delete(token); dispose(p.graph); }
