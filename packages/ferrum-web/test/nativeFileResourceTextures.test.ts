import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { ResourceBudget } from "../src/nativeFileResourceBudget.js";
import { copyFileTextureData } from "../src/nativeFileResourceTextures.js";
import type { ResourceTextureData, ResourceTextureEntry } from "../src/nativeFileResourceOwners.js";
function fixture(): ResourceTextureData {
    const source = { url: "original.png", mime: "image/png", bytes: new Uint8Array([1, 2, 3]) };
    const entry: ResourceTextureEntry = { ids: [7, 9], width: 1, height: 1, generation: 1, colorSpace: "none", alphaMode: "unknown", runtimeInfo: false, storage: "rgba8", sampler: [9728, 9728, 33071, 33071], pixels: new Uint8Array([2, 3, 4, 255]), source };
    return { backend: "webgl2", generation: 2, contentRevision: 0, colorManagement: "legacy", entries: [entry, { ...entry, ids: [], generation: 2 }] };
}
test("texture payload admission copies exact current pixels and pools immutable original encodings", () => {
    const data = fixture(), b = new ResourceBudget(), copy = copyFileTextureData(data, b);
    deepEqual(copy, data);
    equal(copy.entries[0].source, copy.entries[1].source);
    equal(b.usage().sourceBytes, 3);
    data.entries[0].pixels[0] = 9;
    data.entries[0].source!.bytes[0] = 9;
    equal(copy.entries[0].pixels[0], 2);
    equal(copy.entries[0].source!.bytes[0], 1);
    deepEqual(copy.entries[0].ids, [7, 9]);
    equal(copy.entries[0].runtimeInfo, false);
});
test("texture payload rejects invalid aliases, storage, blocks, record getters and current byte bounds", () => {
    const data = fixture(), entry = data.entries[0];
    for (const change of [{ width: 0 }, { height: Infinity }, { generation: 3 }, { ids: [7, 7] }, { sampler: [0, 9728, 33071, 33071] }, { pixels: new Uint8Array(3) }, { runtimeInfo: true }, { storage: "hdr" }])
        throws(() => copyFileTextureData({ ...data, entries: [{ ...entry, ...change }] } as ResourceTextureData, new ResourceBudget()), /DATA/);
    let calls = 0;
    const bad = { ...entry };
    Object.defineProperty(bad, "width", { get() { calls++; return 1; } });
    throws(() => copyFileTextureData({ ...data, entries: [bad] }, new ResourceBudget()), /DATA/);
    equal(calls, 0);
    const pixels = new Uint8Array([2, 3, 4, 255]);
    for (const k of ["byteLength", "buffer", "length"])
        Object.defineProperty(pixels, k, { get() { calls++; throw Error("getter"); } });
    deepEqual([...copyFileTextureData({ ...data, entries: [{ ...entry, pixels }] }, new ResourceBudget()).entries[0].pixels], [2, 3, 4, 255]);
    equal(calls, 0);
});
test("texture shared ledger exact and one-below limits reject without modifying candidate bytes", () => {
    const data = fixture(), b = new ResourceBudget();
    copyFileTextureData(data, b);
    const u = b.usage();
    const limits = { maxResources: u.resources, maxWork: u.work, maxMetadataBytes: u.metadataBytes, maxSourceBytes: u.sourceBytes, maxDecodedBytes: u.decodedBytes, maxGpuBytes: u.gpuBytes };
    const exact = new ResourceBudget(limits);
    copyFileTextureData(data, exact);
    deepEqual(exact.usage(), u);
    for (const k of Object.keys(limits) as (keyof typeof limits)[])
        throws(() => copyFileTextureData(data, new ResourceBudget({ ...limits, [k]: limits[k] - 1 })), /LIMIT/);
    deepEqual([...data.entries[0].pixels], [2, 3, 4, 255]);
    deepEqual([...data.entries[0].source!.bytes], [1, 2, 3]);
});
