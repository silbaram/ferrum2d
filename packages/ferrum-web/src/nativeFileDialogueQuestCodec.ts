/** @internal Owned content/native packets only. No progress is simulated in JS. */
import type { ResolvedQuestDocument, ResolvedDialogueGraph } from "./dialogueQuest.js";
import { encodeQuestConfig, encodeDialogueGraph } from "./dialogueQuestNative.js";
import { fileDialogueQuestRequire as check } from "./nativeFileDialogueQuestTypes.js";
import type { NativeFileDialogueQuestBudget as Budget } from "./nativeFileDialogueQuestTypes.js";
const MAX = 16 * 1024 * 1024, ITEMS = 65536;
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export function record(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
export function list(v: unknown, budget: Budget): asserts v is unknown[] { check(Array.isArray(v) && v.length <= ITEMS, "LIMIT", "list"); budget.work(v.length); budget.charge("decodedBytes", v.length * 8); }
export function text(v: unknown): asserts v is string { check(typeof v === "string", "CONTENT", "string"); }
export function u32(v: unknown): asserts v is number { check(typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 4294967295 && !Object.is(v, -0), "CONTENT", "u32"); }
export function fields(v: unknown, keys: readonly string[]): asserts v is Record<string, unknown> { check(record(v), "CONTENT", "object"); for (const k in v)
    check(keys.includes(k), "CONTENT", "extra-field"); }
function utf8Size(value: string): number {
    let n = 0;
    for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        if (c < 0x80)
            n++;
        else if (c < 0x800)
            n += 2;
        else if (c >= 0xd800 && c <= 0xdbff) {
            const d = value.charCodeAt(++i);
            check(d >= 0xdc00 && d <= 0xdfff, "CONTENT", "unicode");
            n += 4;
        }
        else {
            check(c < 0xdc00 || c > 0xdfff, "CONTENT", "unicode");
            n += 3;
        }
    }
    return n;
}
function nativeString(value: unknown, budget: Budget): number { text(value); check(value.length > 0 && value.length <= MAX, "CONTENT", "native-string"); budget.metadata(value); const n = utf8Size(value); check(n <= MAX, "LIMIT", "native-string"); return 4 + n; }
function nativeStrings(v: unknown, budget: Budget): number { list(v, budget); let n = 4; for (const s of v)
    n += nativeString(s, budget); return n; }
/** Preflight all actual config strings/collections before existing encoder allocates. */
export function config(content: unknown, kind: "quest" | "dialogue", budget: Budget): Uint8Array {
    check(record(content), "CONTENT", "content-root");
    let size = 4;
    if (kind === "quest") {
        check(record(content.quests), "CONTENT", "quests");
        const quests = values(content.quests, budget), ids = new Set<string>();
        size += 4;
        for (const q of quests) {
            check(record(q), "CONTENT", "quest");
            size += nativeString(q.id, budget);
            check(!ids.has(q.id as string), "REFERENCE", "quest-id");
            ids.add(q.id as string);
            text(q.title);
            budget.metadata(q.title);
            list(q.stages, budget);
            size += 4;
            for (const s of q.stages) {
                check(record(s), "CONTENT", "stage");
                size += nativeString(s.id, budget);
                text(s.title);
                budget.metadata(s.title);
                list(s.objectives, budget);
                for (const o of s.objectives) {
                    check(record(o), "CONTENT", "objective");
                    text(o.id);
                    text(o.text);
                    budget.metadata(o.id);
                    budget.metadata(o.text);
                }
            }
        }
    }
    else {
        text(content.initialNode);
        check(record(content.nodes), "CONTENT", "nodes");
        const nodes = values(content.nodes, budget);
        check(nodes.length > 0, "CONTENT", "nodes");
        size += 8;
        const ids = new Set<string>();
        for (const node of nodes) {
            check(record(node), "CONTENT", "node");
            size += nativeString(node.id, budget);
            check(!ids.has(node.id as string), "REFERENCE", "node-id");
            ids.add(node.id as string);
        }
        check(ids.has(content.initialNode), "REFERENCE", "initial-node");
        for (const node of nodes) {
            check(record(node), "CONTENT", "node");
            text(node.text);
            budget.metadata(node.text);
            if (node.speaker !== undefined) {
                text(node.speaker);
                budget.metadata(node.speaker);
            }
            check(typeof node.end === "boolean", "CONTENT", "node.end");
            size += 4 + updates(node.questUpdates, budget);
            list(node.choices, budget);
            size += 4;
            for (const choice of node.choices) {
                check(record(choice), "CONTENT", "choice");
                text(choice.id);
                text(choice.label);
                budget.metadata(choice.id);
                budget.metadata(choice.label);
                if (choice.to !== undefined) {
                    text(choice.to);
                    check(ids.has(choice.to), "REFERENCE", "choice.to");
                }
                size += 4 + nativeStrings(choice.setFlags, budget) + nativeStrings(choice.clearFlags, budget) + nativeStrings(choice.requireFlags, budget) + updates(choice.questUpdates, budget);
            }
        }
    }
    check(size <= MAX, "LIMIT", "config-packet");
    budget.work(size);
    budget.charge("decodedBytes", size * 3);
    const packet = kind === "quest" ? encodeQuestConfig(content as unknown as ResolvedQuestDocument) : encodeDialogueGraph(content as unknown as ResolvedDialogueGraph);
    check(packet.length === size, "CONTENT", "config-size");
    return packet;
}
function updates(v: unknown, budget: Budget): number { list(v, budget); let n = 4; for (const u of v) {
    check(record(u), "CONTENT", "update");
    check(["start", "setStage", "completeObjective", "complete"].includes(u.action as string), "CONTENT", "update.action");
    n += nativeString(u.quest, budget) + 12;
    if (u.stage !== undefined)
        n += nativeString(u.stage, budget);
    if (u.objective !== undefined)
        n += nativeString(u.objective, budget);
} return n; }
export function values(v: Record<string, unknown>, budget: Budget): unknown[] { const out: unknown[] = []; for (const k in v) {
    if (!Object.prototype.hasOwnProperty.call(v, k))
        continue;
    check(out.length < ITEMS, "LIMIT", "record-members");
    budget.work(1);
    budget.charge("decodedBytes", 8);
    out.push(v[k]);
} return out; }
export function byteArray(v: unknown, budget: Budget): Uint8Array { check(Array.isArray(v) && v.length <= MAX, "LIMIT", "progress-bytes"); budget.work(v.length); budget.charge("decodedBytes", v.length); for (const b of v) {
    u32(b);
    check(b <= 255, "CONTENT", "byte");
} return Uint8Array.from(v); }
export function byteList(v: Uint8Array, budget: Budget): number[] { budget.work(v.length); budget.charge("decodedBytes", v.length * 8); return Array.from(v); }
export function equal(a: Uint8Array, b: Uint8Array): boolean { if (a.length !== b.length)
    return false; for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i])
        return false; return true; }
export function word(b: Uint8Array, offset: number): number { return new DataView(b.buffer, b.byteOffset + offset, 4).getUint32(0, true); }
export function nativeHeader(b: Uint8Array, kind: "quest" | "dialogue"): void { check(b.length === (kind === "quest" ? 16 : 32) && word(b, 0) === (kind === "quest" ? 0x46515131 : 0x46445131), "NATIVE", "header"); check(word(b, 12) <= MAX, "LIMIT", "native-packet"); if (kind === "dialogue")
    check(word(b, 16) <= 1 && word(b, 28) <= MAX && (word(b, 16) === 1 || (word(b, 20) === 0 && word(b, 24) === 0 && word(b, 28) === 0)), "NATIVE", "linked-header"); }
export function revision(header: Uint8Array, offset = 4): [
    number,
    number
] { return [word(header, offset), word(header, offset + 4)]; }
export function origin(v: unknown): readonly [
    number,
    number
] { check(Array.isArray(v) && v.length === 2, "CONTENT", "origin"); u32(v[0]); u32(v[1]); return Object.freeze([v[0], v[1]] as const); }
/** Native UTF-8 / Unicode scalar order; JS UTF-16 .sort() would be incorrect. */
function before(a: string, b: string): boolean { let x = 0, y = 0; while (x < a.length && y < b.length) {
    const ac = a.codePointAt(x)!, bc = b.codePointAt(y)!;
    if (ac !== bc)
        return ac < bc;
    x += ac > 0xffff ? 2 : 1;
    y += bc > 0xffff ? 2 : 1;
} return x === a.length && y < b.length; }
class Reader {
    private offset = 0;
    constructor(private readonly packet: Uint8Array, private readonly budget: Budget) { check(packet.length <= MAX && this.u32() === 1, "CONTENT", "progress-version"); }
    u32(): number { check(this.offset + 4 <= this.packet.length, "CONTENT", "progress-truncated"); const n = word(this.packet, this.offset); this.offset += 4; return n; }
    count(): number { const n = this.u32(); check(n <= ITEMS && n <= (this.packet.length - this.offset) / 4, "LIMIT", "progress-count"); this.budget.work(n); return n; }
    string(): string { const n = this.u32(); check(n > 0 && this.offset + n <= this.packet.length, "CONTENT", "progress-string"); this.budget.work(n); this.budget.charge("decodedBytes", n * 2); let s: string; try {
        s = decoder.decode(this.packet.subarray(this.offset, this.offset + n));
    }
    catch {
        check(false, "CONTENT", "progress-utf8");
    } this.offset += n; this.budget.metadata(s!); return s!; }
    boolean(): boolean { const n = this.u32(); check(n <= 1, "CONTENT", "progress-bool"); return n === 1; }
    finish(): void { check(this.offset === this.packet.length, "CONTENT", "progress-trailing"); }
}
export function validateProgress(packet: Uint8Array, content: ResolvedQuestDocument | ResolvedDialogueGraph, kind: "quest" | "dialogue", budget: Budget): void {
    const r = new Reader(packet, budget);
    if (kind === "quest") {
        const definitions = values((content as ResolvedQuestDocument).quests, budget);
        const n = r.count();
        check(n === definitions.length, "REFERENCE", "quest-progress-count");
        for (const q of definitions) {
            check(record(q) && r.string() === q.id, "REFERENCE", "quest-progress-id-order");
            check(r.u32() <= 2, "CONTENT", "quest-status");
            if (r.boolean())
                r.string();
            for (let count = r.count(); count > 0; count--)
                r.string();
        }
    }
    else {
        const id = r.string();
        const nodes = values((content as ResolvedDialogueGraph).nodes, budget);
        check(nodes.some(n => record(n) && n.id === id), "REFERENCE", "dialogue-progress-node");
        let previous: string | undefined;
        for (let n = r.count(); n > 0; n--) {
            const flag = r.string();
            check(previous === undefined || before(previous, flag), "REFERENCE", "flags-native-order");
            previous = flag;
        }
        r.boolean();
    }
    r.finish();
}
/** Exact UTF-8 JSON size before stringify/encode, including lone-surrogate escapes.
 * Input is our acyclic DTO/AST, never arbitrary host objects or toJSON callbacks. */
export function encodeFile(value: unknown, budget: Budget): Uint8Array {
    const stringSize = (s: string): number => { let n = 2; budget.work(s.length); for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 34 || c === 92 || [8, 9, 10, 12, 13].includes(c))
            n += 2;
        else if (c < 32)
            n += 6;
        else if (c >= 0xd800 && c <= 0xdbff) {
            const d = s.charCodeAt(i + 1);
            if (d >= 0xdc00 && d <= 0xdfff) {
                n += 4;
                i++;
            }
            else
                n += 6;
        }
        else if (c >= 0xdc00 && c <= 0xdfff)
            n += 6;
        else
            n += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
    } return n; };
    const measure = (v: unknown, depth: number): number => { budget.work(1); check(depth <= 128, "LIMIT", "json-depth"); if (v === null)
        return 4; if (typeof v === "boolean")
        return v ? 4 : 5; if (typeof v === "number") {
        check(Number.isFinite(v), "CONTENT", "json-number");
        return String(v).length;
    } if (typeof v === "string")
        return stringSize(v); check(v !== null && typeof v === "object", "CONTENT", "json-value"); let n = 2, count = 0; if (Array.isArray(v)) {
        for (const child of v) {
            n += (count++ ? 1 : 0) + measure(child, depth + 1);
            check(n <= 64 * 1024 * 1024, "LIMIT", "json-size");
        }
    }
    else {
        for (const key in v) {
            if (!Object.prototype.hasOwnProperty.call(v, key))
                continue;
            n += (count++ ? 1 : 0) + stringSize(key) + 1 + measure((v as Record<string, unknown>)[key], depth + 1);
            check(n <= 64 * 1024 * 1024, "LIMIT", "json-size");
        }
    } return n; };
    const size = measure(value, 0);
    budget.charge("sourceBytes", size);
    budget.charge("decodedBytes", size * 3);
    const bytes = encoder.encode(JSON.stringify(value));
    check(bytes.length === size, "CONTENT", "json-size");
    return bytes;
}
