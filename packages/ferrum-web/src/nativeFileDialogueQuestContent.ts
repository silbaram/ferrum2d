/** @internal Lossless bounded plain immutable content graph. Object aliases,
 * cycles, sparse arrays, undefined and -0 are metadata, never simulation state.
 * Date/Map/Set/typed arrays/functions are not declared dialogue content. */
import { fileDialogueQuestRequire as require } from "./nativeFileDialogueQuestTypes.js";
import type { NativeFileDialogueQuestBudget as Budget } from "./nativeFileDialogueQuestTypes.js";
export type NativeFileDialogueQuestContent = null | boolean | number | string | {
    readonly t: "undefined" | "negative-zero";
} | {
    readonly t: "ref";
    readonly id: number;
} | {
    readonly t: "object";
    readonly id: number;
    readonly entries: readonly (readonly [
        string,
        NativeFileDialogueQuestContent
    ])[];
} | {
    readonly t: "array";
    readonly id: number;
    readonly length: number;
    readonly entries: readonly (readonly [
        string,
        NativeFileDialogueQuestContent
    ])[];
};
const MAX_DEPTH = 24, MAX_MEMBERS = 65536, MAX_OBJECTS = 65536;
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object"; }
function uint(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0); }
export function captureNativeFileDialogueQuestContent(value: unknown, budget: Budget): NativeFileDialogueQuestContent {
    const seen = new WeakMap<object, number>();
    let count = 0;
    const visit = (value: unknown, depth: number): NativeFileDialogueQuestContent => {
        budget.work(1);
        require(depth <= MAX_DEPTH, "LIMIT", "content.depth");
        if (value === null || typeof value === "boolean")
            return value;
        if (typeof value === "string") {
            budget.metadata(value);
            return value;
        }
        if (typeof value === "number") {
            require(Number.isFinite(value), "CONTENT", "content.number");
            return Object.is(value, -0) ? { t: "negative-zero" } : value;
        }
        if (value === undefined)
            return { t: "undefined" };
        require(record(value), "CONTENT", "content.value");
        const prior = seen.get(value);
        if (prior !== undefined)
            return { t: "ref", id: prior };
        require(count < MAX_OBJECTS, "LIMIT", "content.objects");
        const array = Array.isArray(value);
        require(array || [Object.prototype, null].includes(Object.getPrototypeOf(value)), "CONTENT", "content.prototype");
        const length = array ? value.length : 0;
        require(length <= MAX_MEMBERS, "LIMIT", "content.array");
        budget.work(length);
        budget.charge("decodedBytes", 64 + length * 8);
        const id = count++;
        seen.set(value, id);
        const entries: [
            string,
            NativeFileDialogueQuestContent
        ][] = [];
        // Already-owned ctor content: bounded explicit enumeration, not a general
        // hostile Proxy/intrinsic or global engine allocation guarantee.
        for (const key in value) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor)
                continue;
            budget.work(1);
            budget.metadata(key);
            require(entries.length < MAX_MEMBERS, "LIMIT", "content.members");
            require("value" in descriptor, "CONTENT", "content.getter");
            budget.charge("decodedBytes", 24);
            entries.push([key, visit(descriptor.value, depth + 1)]);
        }
        return array ? { t: "array", id, length, entries } : { t: "object", id, entries };
    };
    return visit(value, 0);
}
export function materializeNativeFileDialogueQuestContent(input: unknown, budget: Budget): unknown {
    const objects: object[] = [];
    const visit = (value: unknown, depth: number): unknown => {
        budget.work(1);
        require(depth <= MAX_DEPTH, "LIMIT", "content.depth");
        if (value === null || typeof value === "boolean")
            return value;
        if (typeof value === "string") {
            budget.metadata(value);
            return value;
        }
        if (typeof value === "number") {
            require(Number.isFinite(value), "CONTENT", "content.number");
            return value;
        }
        require(record(value) && !Array.isArray(value), "CONTENT", "content.node");
        const t = value.t;
        const allowed = t === "ref" ? ["t", "id"] : t === "array" ? ["t", "id", "length", "entries"] : t === "object" ? ["t", "id", "entries"] : ["t"];
        for (const key in value)
            require(allowed.includes(key), "CONTENT", "content.extra");
        if (t === "undefined")
            return undefined;
        if (t === "negative-zero")
            return -0;
        if (t === "ref") {
            require(uint(value.id) && value.id < objects.length, "REFERENCE", "content.ref");
            return objects[value.id];
        }
        require(t === "array" || t === "object", "CONTENT", "content.tag");
        require(uint(value.id) && value.id === objects.length && objects.length < MAX_OBJECTS, "REFERENCE", "content.id");
        require(Array.isArray(value.entries) && value.entries.length <= MAX_MEMBERS, "LIMIT", "content.entries");
        const length = t === "array" ? value.length : 0;
        require(uint(length) && length <= MAX_MEMBERS, "LIMIT", "content.length");
        budget.work(length + value.entries.length);
        budget.charge("decodedBytes", 64 + length * 8 + value.entries.length * 24);
        const out: Record<string, unknown> | unknown[] = t === "array" ? new Array(length) : {};
        objects.push(out);
        const keys = new Set<string>();
        for (const entry of value.entries) {
            require(Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string", "CONTENT", "content.entry");
            const key = entry[0];
            budget.metadata(key);
            require(!keys.has(key), "REFERENCE", "content.duplicate-key");
            keys.add(key);
            if (t === "array") {
                require(key !== "length", "REFERENCE", "content.array-length-key");
                const index = Number(key);
                require(!(Number.isInteger(index) && index >= 0 && index < 4294967295 && String(index) === key) || index < length, "REFERENCE", "content.array-index");
            }
            Object.defineProperty(out, key, { value: visit(entry[1], depth + 1), enumerable: true, writable: true, configurable: true });
        }
        return out;
    };
    const result = visit(input, 0);
    // Freeze every declared object once; references/cycles never recurse here.
    budget.work(objects.length);
    for (const object of objects)
        Object.freeze(object);
    return result;
}
