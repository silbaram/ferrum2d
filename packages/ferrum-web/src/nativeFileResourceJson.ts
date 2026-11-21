/** @internal Bounded clone of actual materialized JSON. Never calls toJSON,
 * getters or an application resolver. Ordinary owned objects only; hostile
 * Proxies/global intrinsic replacement are an outer host contract. */
import { ResourceBudget } from "./nativeFileResourceBudget.js";
export type ResourceJson = null | boolean | number | string | ResourceJson[] | {
    [key: string]: ResourceJson;
};
export function cloneResourceJson(value: unknown, budget: ResourceBudget, depth = 0, ancestors = new Set<object>(), copies = new WeakMap<object, ResourceJson>()): ResourceJson {
    budget.work(1);
    if (value === null || typeof value === "boolean")
        return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            budget.fail("DATA", "JSON number");
        return value;
    }
    if (typeof value === "string") {
        budget.metadata(value);
        return value;
    }
    if (!value || typeof value !== "object" || depth >= 32 || ancestors.has(value))
        return budget.fail("DATA", "JSON tree");
    const previous = copies.get(value);
    if (previous !== undefined)
        return previous;
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            budget.work(value.length);
            budget.charge("metadataBytes", value.length * 8);
            const keys = Reflect.ownKeys(value);
            budget.work(keys.length);
            budget.charge("metadataBytes", keys.length * 8);
            if (keys.length !== value.length + 1 || keys.some(key => key !== "length" && (typeof key !== "string" || !Number.isSafeInteger(Number(key)) || String(Number(key)) !== key || Number(key) < 0 || Number(key) >= value.length)))
                return budget.fail("DATA", "JSON dense array own keys");
            const result: ResourceJson[] = [];
            copies.set(value, result);
            for (let i = 0; i < value.length; i++) {
                const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
                if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
                    budget.fail("DATA", "JSON array member");
                result.push(cloneResourceJson(descriptor.value, budget, depth + 1, ancestors, copies));
            }
            return result;
        }
        if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
            return budget.fail("DATA", "JSON object prototype");
        const result: {
            [key: string]: ResourceJson;
        } = Object.create(Object.getPrototypeOf(value));
        copies.set(value, result);
        const own = Reflect.ownKeys(value);
        budget.work(own.length);
        budget.charge("metadataBytes", own.length * 8);
        for (const key of own) {
            if (typeof key !== "string")
                return budget.fail("DATA", "JSON own symbol key");
            budget.work(1);
            budget.charge("metadataBytes", 16);
            budget.metadata(key);
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
                budget.fail("DATA", "JSON object member");
            Object.defineProperty(result, key, { enumerable: true, configurable: true, writable: true,
                value: cloneResourceJson(descriptor.value, budget, depth + 1, ancestors, copies) });
        }
        return result;
    }
    finally {
        ancestors.delete(value);
    }
}
/** Compares actual current JSON and its admitted snapshot, including DAG alias
 * identities, without invoking accessors or normalizing the source. */
export function resourceJsonUnchanged(actual: unknown, saved: ResourceJson, b: ResourceBudget, aliases = new Map<object, object>(), reverse = new Map<object, object>(), depth = 0): boolean {
    b.work(1);
    if (actual === null || typeof actual !== "object" || saved === null || typeof saved !== "object")
        return Object.is(actual, saved);
    if (depth >= 32 || Array.isArray(actual) !== Array.isArray(saved) || Object.getPrototypeOf(actual) !== Object.getPrototypeOf(saved) && Object.getPrototypeOf(actual) !== null)
        return false;
    const previous = aliases.get(actual);
    if (previous !== undefined)
        return previous === saved;
    if (reverse.has(saved))
        return false;
    aliases.set(actual, saved);
    reverse.set(saved, actual);
    const ak = Object.keys(actual), sk = Object.keys(saved);
    b.work(ak.length + sk.length);
    b.charge("metadataBytes", (ak.length + sk.length) * 8);
    if (ak.length !== sk.length || Array.isArray(actual) && actual.length !== (saved as ResourceJson[]).length)
        return false;
    for (let i = 0; i < ak.length; i++) {
        const key = ak[i];
        if (key !== sk[i])
            return false;
        b.metadata(key);
        const d = Object.getOwnPropertyDescriptor(actual, key);
        if (!d || !("value" in d) || !resourceJsonUnchanged(d.value, (saved as {
            [key: string]: ResourceJson;
        })[key], b, aliases, reverse, depth + 1))
            return false;
    }
    return true;
}
