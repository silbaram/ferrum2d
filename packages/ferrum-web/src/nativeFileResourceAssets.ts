/** @internal Detached namespace/materialized JSON plan. All file data is
 * admitted before any registry adoption; original encodings remain provenance. */
import { ResourceBudget, resourceKeys, resourceInteger } from "./nativeFileResourceBudget.js";
import { copyResourceRegistry } from "./nativeFileResourceRegistries.js";
import { cloneResourceJson, type ResourceJson } from "./nativeFileResourceJson.js";
import type { ResourceAssetData, ResourceSourceBytes } from "./nativeFileResourceOwners.js";
export function copyResourceAssetData(data: ResourceAssetData, b: ResourceBudget): ResourceAssetData {
    resourceKeys(data, ["generation", "textures", "sounds", "json"], b);
    resourceInteger(data.generation, "asset source generation", 0, Number.MAX_SAFE_INTEGER);
    const textures = copyResourceRegistry(data.textures, "texture", b), sounds = copyResourceRegistry(data.sounds, "sound", b);
    if (!Array.isArray(data.json))
        return b.fail("DATA", "JSON assets");
    b.work(data.json.length);
    b.charge("resources", data.json.length);
    const names = new Set<string>(), sources = new Map<object, ResourceSourceBytes>(), copies = new WeakMap<object, ResourceJson>();
    const json = data.json.map(row => {
        resourceKeys(row, ["name", "url", "value", "source"], b);
        b.metadata(row.name);
        b.metadata(row.url);
        if (names.has(row.name))
            return b.fail("DATA", "duplicate JSON name");
        names.add(row.name);
        const value = cloneResourceJson(row.value, b, 0, new Set(), copies);
        let source;
        if (row.source) {
            source = sources.get(row.source);
            if (!source) {
                resourceKeys(row.source, ["url", "mime", "bytes"], b);
                b.metadata(row.source.url);
                b.metadata(row.source.mime);
                source = Object.freeze({ url: row.source.url, mime: row.source.mime, bytes: b.bytes(row.source.bytes, "sourceBytes") });
                sources.set(row.source, source);
            }
        }
        return Object.freeze({ name: row.name, url: row.url, value, ...(source === undefined ? {} : { source }) });
    });
    return Object.freeze({ generation: data.generation, textures, sounds, json: Object.freeze(json) });
}
