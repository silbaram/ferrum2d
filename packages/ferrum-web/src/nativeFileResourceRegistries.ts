/** @internal Stable producer order of reserved namespaces, including entries
 * whose backing resource was evicted. Does not load or resolve original URLs. */
import { ResourceBudget, resourceKeys, resourceInteger } from "./nativeFileResourceBudget.js";
import type { ResourceRegistryData } from "./nativeFileResourceOwners.js";
export function copyResourceRegistry(data: ResourceRegistryData, kind: "texture" | "sound", b: ResourceBudget): ResourceRegistryData {
    resourceKeys(data, ["kind", "nextId", "entries"], b);
    if (data.kind !== kind || !Array.isArray(data.entries))
        return b.fail("DATA", "registry type/entries");
    const nextId = resourceInteger(data.nextId, "registry next ID", 1, Number.MAX_SAFE_INTEGER);
    if (data.entries.length !== nextId - 1)
        return b.fail("DATA", "registry cardinality");
    b.work(data.entries.length * 3);
    b.charge("resources", data.entries.length);
    b.charge("metadataBytes", data.entries.length * 24);
    const names = new Set<string>();
    const entries = data.entries.map((row, i) => {
        resourceKeys(row, ["id", "name", "url"], b);
        if (row.id !== i + 1)
            return b.fail("DATA", "registry reservation order");
        b.metadata(row.name);
        b.metadata(row.url);
        if (names.has(row.name))
            return b.fail("DATA", "duplicate registry name");
        names.add(row.name);
        return Object.freeze({ id: row.id, name: row.name, url: row.url });
    });
    return Object.freeze({ kind, nextId, entries: Object.freeze(entries) });
}
