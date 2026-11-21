import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { test } from "node:test";
import { loadSpatialGlb, spatialModelResource, spatialModelRegistry, inspectSpatialModelRegistry, type SpatialModelResource } from "../src/spatialModel.js";
import { captureModelResources, admitModelResource, prepareModelResources, preparedResourceModelHandles, prepareResourceModelRegistry, disposeResourceModels, type ResourceModelData } from "../src/nativeFileResourceModels.js";
import { ResourceBudget } from "../src/nativeFileResourceBudget.js";
import { nativeFileModelFixture } from "./nativeFileResourceModelFixtures.js";
async function fixture() {
    const input = nativeFileModelFixture(), original = input.slice(0), promise = loadSpatialGlb(input, { materialProfile: "diffuse" });
    new Uint8Array(input)[input.byteLength - 1] = 1;
    const handle = await promise, resource = spatialModelResource(handle)!, engine = {};
    spatialModelRegistry(engine).set("asset", { id: 1, handle, asset: resource });
    spatialModelRegistry(engine).set("alias", { id: 2, handle, asset: resource });
    const data = await captureModelResources(engine, new ResourceBudget());
    return { handle, resource, engine, data, original };
}
test("actual opaque model capture preserves current private graph aliases, scalar bits and original ownership", async () => {
    const f = await fixture();
    equal(f.resource.primitives.length, 3);
    equal(f.resource.primitives[0].color, f.resource.primitives[2].color);
    equal(f.data.assets[0].resource, f.resource);
    equal(f.data.assets[0].resource.primitives[0].color, f.data.assets[0].resource.primitives[2].color);
    ok(Object.is(f.resource.primitives[0].color[0], -0));
    equal(f.data.assets.length, 1);
    deepEqual(f.data.registry.map(r => r.group), [0, 0]);
    deepEqual(f.data.assets[0].bundle.bytes, new Uint8Array(f.original));
    const before = structuredClone(f.resource);
    equal(admitModelResource(f.resource, new ResourceBudget()), f.resource);
    deepEqual(f.resource, before);
    for (const p of f.resource.primitives) {
        equal(p.vertices.byteOffset, 0);
        equal(p.vertices.buffer.byteLength, p.vertices.byteLength);
        equal(p.indices.byteOffset, 0);
        equal(p.indices.buffer.byteLength, p.indices.byteLength);
    }
    const target = {}, plan = await prepareModelResources(structuredClone(f.data), new ResourceBudget()), handles = preparedResourceModelHandles(plan), lease = prepareResourceModelRegistry(plan, target, new ResourceBudget());
    equal(inspectSpatialModelRegistry(target), undefined);
    lease.adopt();
    const registry = inspectSpatialModelRegistry(target)!;
    equal(registry.get("asset")!.handle, registry.get("alias")!.handle);
    equal(registry.get("asset")!.handle, handles[0]);
    equal(spatialModelResource(handles[0])!.primitives[0].color, spatialModelResource(handles[0])!.primitives[2].color);
    disposeResourceModels(plan);
    lease.dispose();
    deepEqual((await captureModelResources(target, new ResourceBudget())).assets[0].bundle, f.data.assets[0].bundle);
    deepEqual(f.resource, before);
});
test("model detached owned subviews keep backing bytes/offset topology and same values in distinct handles stay distinct", async () => {
    const f = await fixture(), data = structuredClone(f.data), resource = data.assets[0].resource, p = resource.primitives[0], buffer = new ArrayBuffer(256);
    new Uint8Array(buffer).fill(0xa5);
    const vertices = new Float32Array(buffer, 16, p.vertices.length), indices = new Uint32Array(buffer, 128, p.indices.length);
    vertices.set(p.vertices);
    indices.set(p.indices);
    const modified: SpatialModelResource = { ...resource, primitives: resource.primitives.map((v, i) => i === 0 ? { ...v, vertices, indices } : v) }, candidate: ResourceModelData = { ...data, assets: [{ ...data.assets[0], resource: modified }] };
    const before = new Uint8Array(buffer).slice(), plan = await prepareModelResources(candidate, new ResourceBudget()), handle = preparedResourceModelHandles(plan)[0], actual = spatialModelResource(handle)!;
    equal(actual.primitives[0].vertices.buffer, actual.primitives[0].indices.buffer);
    equal(actual.primitives[0].vertices.byteOffset, 16);
    equal(actual.primitives[0].indices.byteOffset, 128);
    deepEqual(new Uint8Array(actual.primitives[0].vertices.buffer), before);
    disposeResourceModels(plan);
    const another = await loadSpatialGlb(nativeFileModelFixture(), { materialProfile: "diffuse" }), other = spatialModelResource(another)!;
    equal(f.handle.contentId, another.contentId);
    ok(f.handle !== another);
    spatialModelRegistry(f.engine).set("distinct", { id: 3, handle: another, asset: other });
    const captured = await captureModelResources(f.engine, new ResourceBudget());
    deepEqual(captured.registry.map(r => r.group), [0, 0, 1]);
    const prepared = await prepareModelResources(structuredClone(captured), new ResourceBudget());
    const all = preparedResourceModelHandles(prepared);
    equal(all.length, 2);
    ok(all[0] !== all[1]);
    equal(all[0].contentId, all[1].contentId);
    disposeResourceModels(prepared);
});
test("model malformed private codec-shaped candidates are guard-only and leave live source bytes unchanged", async () => {
    const f = await fixture(), before = structuredClone(f.resource);
    for (const edit of [
        (v: SpatialModelResource) => { v.primitives[0].indices[0] = 999; },
        (v: SpatialModelResource) => { v.primitives[0].vertices[0] = NaN; },
        (v: SpatialModelResource) => { (v.bounds as number[])[0] = Infinity; },
        (v: SpatialModelResource) => { (v.primitives[0].color as number[])[1] = 2; },
        (v: SpatialModelResource) => { Reflect.set(v.primitives[0].sampler, 0, 0); },
    ]) {
        const bad = structuredClone(f.data);
        edit(bad.assets[0].resource);
        await rejects(prepareModelResources(bad, new ResourceBudget()), /DATA/);
        deepEqual(f.resource, before);
    }
    const bytes = structuredClone(f.data);
    bytes.assets[0].bundle.bytes[bytes.assets[0].bundle.bytes.length - 1] ^= 1;
    await rejects(prepareModelResources(bytes, new ResourceBudget()), /bundle identity/);
    const refs = { ...f.data, registry: [{ ...f.data.registry[0], group: 1 }] };
    await rejects(prepareModelResources(refs, new ResourceBudget()), /DATA/);
    let calls = 0;
    const bad = { ...f.resource };
    Object.defineProperty(bad, "primitives", { get() { calls++; throw Error("getter"); } });
    throws(() => admitModelResource(bad, new ResourceBudget()), /DATA/);
    equal(calls, 0);
    deepEqual(f.resource, before);
});
test("model sealed preparation/target registry fences and disposal preserve ownership", async () => {
    const f = await fixture(), target = {}, b = new ResourceBudget(), plan = await prepareModelResources(structuredClone(f.data), b), lease = prepareResourceModelRegistry(plan, target, b);
    spatialModelRegistry(target).set("changed", { id: 5, handle: f.handle, asset: f.resource });
    throws(() => lease.adopt(), /STALE/);
    lease.dispose();
    disposeResourceModels(plan);
    throws(() => preparedResourceModelHandles(plan), /STALE/);
    const fresh = {}, second = await prepareModelResources(structuredClone(f.data), new ResourceBudget()), pending = prepareResourceModelRegistry(second, fresh, new ResourceBudget());
    disposeResourceModels(second);
    throws(() => pending.adopt(), /STALE/);
    pending.dispose();
    equal(inspectSpatialModelRegistry(fresh), undefined);
    deepEqual((await captureModelResources(f.engine, new ResourceBudget())).registry, f.data.registry);
});
test("model one shared logical ledger admits exact cumulative limits and rejects one below without repairing data", async () => {
    const f = await fixture(), b = new ResourceBudget(), plan = await prepareModelResources(structuredClone(f.data), b), lease = prepareResourceModelRegistry(plan, {}, b);
    lease.dispose();
    disposeResourceModels(plan);
    const u = b.usage(), limits = { maxResources: u.resources, maxWork: u.work, maxMetadataBytes: u.metadataBytes, maxSourceBytes: u.sourceBytes, maxDecodedBytes: u.decodedBytes, maxGpuBytes: u.gpuBytes };
    const exact = new ResourceBudget(limits), good = await prepareModelResources(structuredClone(f.data), exact), binding = prepareResourceModelRegistry(good, {}, exact);
    deepEqual(exact.usage(), u);
    binding.dispose();
    disposeResourceModels(good);
    for (const key of ["maxResources", "maxWork", "maxMetadataBytes", "maxSourceBytes"] as const) {
        let p: Awaited<ReturnType<typeof prepareModelResources>> | undefined;
        await rejects((async () => { const budget = new ResourceBudget({ ...limits, [key]: limits[key] - 1 }); p = await prepareModelResources(structuredClone(f.data), budget); const s = prepareResourceModelRegistry(p, {}, budget); s.dispose(); })(), /LIMIT/);
        if (p)
            disposeResourceModels(p);
    }
    equal(f.resource, admitModelResource(f.resource, new ResourceBudget()));
});
