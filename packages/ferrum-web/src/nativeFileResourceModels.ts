import { resourceModelCacheOwner, type ResourceModelCacheRoots } from "./nativeFileResourceModelCaches.js";
/** @internal Actual model CPU owner capture. Raw input provenance is retained
 * separately; it is not substituted for the currently owned normalized arrays. */
import { createSpatialModelAsset, spatialModelOwnedFacts, prepareFileSpatialModelRegistry, inspectSpatialModelRegistry, spatialModelResource, type SpatialModelAsset, type SpatialModelResource, type SpatialModelPrimitive, type SpatialModelTexture } from "./spatialModel.js";
import { captureResourceSource, fileResourceBlob, type ResourceSourceBytes } from "./nativeFileResourceOwners.js";
import { ResourceBudget, resourceFinite, resourceInteger, resourceKeys, NativeFileResourceError } from "./nativeFileResourceBudget.js";
interface ModelSource {
    readonly bundle: Blob;
    readonly url: string;
    readonly originals?: readonly {
        readonly blob: Blob;
        readonly url: string;
    }[];
}
// GPU caches strongly own the CPU resource, not necessarily its public handle.
// Original bytes must follow that actual lifetime, without retaining a handle.
const sources = new WeakMap<SpatialModelResource, ModelSource>();
const preparingResources = new WeakSet<SpatialModelResource>();
export function retainModelFileSource(asset: SpatialModelAsset, bundle: Blob, url: string): void {
    const resource = spatialModelResource(asset);
    if (!resource)
        throw new NativeFileResourceError("DATA", "model source owner");
    sources.set(resource, { bundle, url });
}
export function retainModelFileOriginals(asset: SpatialModelAsset, originals: readonly {
    readonly blob: Blob;
    readonly url: string;
}[]): void {
    const resource = spatialModelResource(asset), source = resource && sources.get(resource);
    if (!resource || !source)
        throw new NativeFileResourceError("DATA", "model source ownership missing");
    sources.set(resource, { ...source, originals: Object.freeze([...originals]) });
}
export interface ResourceModelAssetData {
    readonly resource: SpatialModelResource;
    readonly bundle: ResourceSourceBytes;
    readonly originals: readonly ResourceSourceBytes[];
}
export interface ResourceModelCacheData {
    readonly backend: "webgl2" | "webgpu";
    readonly roots: readonly number[];
    readonly active: readonly number[];
    readonly warmed: readonly number[];
    readonly prepared: readonly number[];
    readonly visible?: readonly (readonly [
        number,
        number
    ])[];
}
export interface ResourceModelData {
    readonly registry: readonly {
        readonly key: string;
        readonly id: number;
        readonly group: number;
    }[];
    readonly assets: readonly ResourceModelAssetData[];
    readonly renderer?: ResourceModelCacheData;
}
/** Model CPU storage is private behind immutable public handles. SDK writers
 * allocate it during load and never mutate it after commit. This pass borrows
 * that owner graph (or an already-owned detached file graph), preserving every
 * array/view/backing alias. Wire detachment belongs to the resource codec. It
 * neither freezes caller storage nor turns a public mutable graph into an owner. */
function vector(value: readonly number[], count: number, b: ResourceBudget, field: string, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): void {
    if (!Array.isArray(value) || value.length !== count)
        return b.fail("DATA", field);
    b.work(count);
    for (let i = 0; i < count; i++) {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        if (!d || !("value" in d))
            return b.fail("DATA", field);
        resourceFinite(d.value, field, min, max);
    }
}
function sampler(value: readonly [
    number,
    number,
    number,
    number
], b: ResourceBudget): void {
    vector(value, 4, b, "model sampler");
    if (![9728, 9729, 9984, 9985, 9986, 9987].includes(value[0]) || ![9728, 9729].includes(value[1]) || ![33071, 33648, 10497].includes(value[2]) || ![33071, 33648, 10497].includes(value[3]))
        b.fail("DATA", "model sampler enum");
}
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype), arrayTag = Object.getOwnPropertyDescriptor(typedPrototype, Symbol.toStringTag)?.get, arrayLength = Object.getOwnPropertyDescriptor(typedPrototype, "length")?.get, arrayBuffer = Object.getOwnPropertyDescriptor(typedPrototype, "buffer")?.get, bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
function typed(value: unknown, kind: "Float32Array" | "Uint32Array" | "Uint8ClampedArray", b: ResourceBudget): number {
    try {
        if (!ArrayBuffer.isView(value) || !arrayTag || !arrayLength || !arrayBuffer || !bufferLength || arrayTag.call(value) !== kind)
            return b.fail("DATA", "model array kind");
        bufferLength.call(arrayBuffer.call(value));
        const length: unknown = arrayLength.call(value);
        return resourceInteger(length, "model array length");
    }
    catch {
        return b.fail("DATA", "ordinary model array");
    }
}
function floats(value: Float32Array, b: ResourceBudget, expected?: number): number {
    const count = typed(value, "Float32Array", b);
    if (expected !== undefined && count !== expected)
        return b.fail("DATA", "model float shape");
    b.work(count);
    for (let i = 0; i < count; i++)
        if (!Number.isFinite(value[i]))
            return b.fail("DATA", "model finite float");
    return count;
}
function uv(value: Float32Array | undefined, b: ResourceBudget): void { if (value !== undefined)
    floats(value, b, 9); }
function texture(value: SpatialModelTexture, images: number, b: ResourceBudget, normal = false): void {
    resourceKeys(value, normal ? ["image", "sampler", "uvTransform", "scale"] : ["image", "sampler", "uvTransform"], b);
    resourceInteger(value.image, "model image reference", 0, images - 1);
    sampler(value.sampler, b);
    uv(value.uvTransform, b);
}
/** Read-only complete field/index/numeric admission of normalized model values.
 * A loader contentId is original bundle identity, not a digest of current CPU
 * storage. The resource manifest must separately hash its actual encoded data. */
export function admitModelResource(resource: SpatialModelResource, b: ResourceBudget): SpatialModelResource {
    resourceKeys(resource, ["materialProfile", "contentId", "bounds", "primitives", "images", "diagnostics"], b);
    b.metadata(resource.contentId);
    if (!/^[a-f0-9]{64}$/.test(resource.contentId) || resource.materialProfile !== undefined && resource.materialProfile !== "diffuse" && resource.materialProfile !== "specular")
        return b.fail("DATA", "model identity/profile");
    if (!Array.isArray(resource.primitives) || !Array.isArray(resource.images) || !Array.isArray(resource.diagnostics))
        return b.fail("DATA", "model collections");
    resourceInteger(resource.primitives.length, "model primitives", 1, 32);
    resourceInteger(resource.images.length, "model images", 0, 16);
    b.work(resource.primitives.length + resource.images.length + resource.diagnostics.length);
    b.charge("resources", 1 + resource.images.length);
    vector(resource.bounds, 6, b, "model bounds");
    for (const value of resource.bounds)
        if (!Object.is(Math.fround(value), value))
            return b.fail("DATA", "model normalized bounds f32");
    for (let i = 0; i < 3; i++)
        if (resource.bounds[i] > resource.bounds[i + 3])
            return b.fail("DATA", "model bounds order");
    let totalPixels = 0;
    for (const image of resource.images) {
        resourceKeys(image, ["width", "height", "pixels"], b);
        const width = resourceInteger(image.width, "model image width", 1, 2048), height = resourceInteger(image.height, "model image height", 1, 2048);
        totalPixels += width * height;
        if (totalPixels > 8 * 1024 * 1024 || typed(image.pixels, "Uint8ClampedArray", b) !== width * height * 4)
            return b.fail("DATA", "model image bytes");
    }
    let vertexTotal = 0, indexTotal = 0;
    for (const p of resource.primitives) {
        resourceKeys(p, ["vertices", "indices", "color", "sampler", "alphaCutoff", "doubleSided", "emissiveFactor", "unlit", "image", "uvTransform", "normal", "emissive", "specular"], b);
        const n = typed(p.vertices, "Float32Array", b), indices = typed(p.indices, "Uint32Array", b), stride = p.normal === undefined ? 8 : 12, count = n / stride;
        if (n % stride || indices % 3)
            return b.fail("DATA", "model geometry stride");
        vertexTotal += count;
        indexTotal += indices;
        if (!count || vertexTotal > 65536 || !indices || indexTotal > 196608)
            return b.fail("DATA", "model geometry count");
        floats(p.vertices, b, n);
        b.work(indices + count * 12);
        for (let i = 0; i < indices; i++)
            if (p.indices[i] >= count)
                return b.fail("DATA", "model index");
        for (let i = 0; i < n; i += stride) {
            for (let k = 0; k < 3; k++)
                if (p.vertices[i + k] < resource.bounds[k] || p.vertices[i + k] > resource.bounds[k + 3])
                    return b.fail("DATA", "model vertex bounds");
            if (Math.abs(Math.hypot(p.vertices[i + 5], p.vertices[i + 6], p.vertices[i + 7]) - 1) > .001)
                return b.fail("DATA", "model normal");
            if (stride === 12 && (![-1, 1].includes(p.vertices[i + 11]) || Math.abs(Math.hypot(p.vertices[i + 8], p.vertices[i + 9], p.vertices[i + 10]) - 1) > .001))
                return b.fail("DATA", "model tangent");
        }
        if (typeof p.doubleSided !== "boolean" || p.unlit !== undefined && typeof p.unlit !== "boolean")
            return b.fail("DATA", "model flags");
        vector(p.color, 4, b, "model color", 0, 1);
        sampler(p.sampler, b);
        vector(p.emissiveFactor, 3, b, "model emission", 0, 64);
        const cutoff = resourceFinite(p.alphaCutoff, "model alpha cutoff", 0);
        if (!Object.is(Math.fround(cutoff), cutoff))
            return b.fail("DATA", "model cutoff f32");
        if (p.image !== undefined)
            resourceInteger(p.image, "model image", 0, resource.images.length - 1);
        uv(p.uvTransform, b);
        if (p.normal !== undefined) {
            texture(p.normal, resource.images.length, b, true);
            resourceFinite(p.normal.scale, "normal scale", -64, 64);
        }
        if (p.emissive !== undefined)
            texture(p.emissive, resource.images.length, b);
        if (p.specular !== undefined) {
            const s = p.specular;
            resourceKeys(s, ["factor", "color", "roughness", "texture", "colorTexture", "roughnessTexture"], b);
            if (resource.materialProfile !== "specular")
                return b.fail("DATA", "model specular profile");
            resourceFinite(s.factor, "specular factor", 0, 1);
            vector(s.color, 3, b, "specular color", 0, 1);
            resourceFinite(s.roughness, "roughness", 0, 1);
            for (const t of [s.texture, s.colorTexture, s.roughnessTexture])
                if (t !== undefined)
                    texture(t, resource.images.length, b);
        }
    }
    for (const text of resource.diagnostics)
        b.metadata(text);
    return resource;
}
export async function captureModelResources(engine: object, b: ResourceBudget, renderer?: object): Promise<ResourceModelData> {
    const registry = inspectSpatialModelRegistry(engine), cache = renderer === undefined ? undefined : resourceModelCacheOwner(renderer)?.capture(b);
    if (renderer !== undefined && !cache)
        return b.fail("CAPABILITY", "actual model renderer owner");
    b.work(registry?.size ?? 0);
    b.charge("resources", registry?.size ?? 0);
    const order: {
        key: string;
        id: number;
        group: number;
    }[] = [], handles: SpatialModelAsset[] = [], groups = new Map<SpatialModelAsset, number>(), ids = new Set<number>();
    const group = (handle: SpatialModelAsset) => { let index = groups.get(handle); if (index === undefined) {
        index = handles.length;
        groups.set(handle, index);
        handles.push(handle);
    } return index; };
    for (const [key, entry] of registry ?? []) {
        b.metadata(key);
        resourceInteger(entry.id, "native model id", 1, 0xffffffff);
        if (!key || ids.has(entry.id) || spatialModelResource(entry.handle) !== entry.asset)
            return b.fail("DATA", "model registry binding");
        ids.add(entry.id);
        order.push({ key, id: entry.id, group: group(entry.handle) });
    }
    const prepared = cache?.prepared.map(group), visible = cache?.visible?.map(([id, handle]) => { resourceInteger(id, "visible model ID", 1, 0xffffffff); return [id, group(handle)] as const; });
    const resources = new Map<SpatialModelResource, number>();
    for (let i = 0; i < handles.length; i++)
        if (!resources.has(spatialModelResource(handles[i])!))
            resources.set(spatialModelResource(handles[i])!, i);
    const resourceGroup = (resource: SpatialModelResource) => { let i = resources.get(resource); if (i === undefined) {
        b.work(resource.primitives.length + resource.images.length + resource.bounds.length + resource.diagnostics.length);
        i = group(createSpatialModelAsset(resource));
        resources.set(resource, i);
    } return i; };
    const roots = cache?.roots.map(resourceGroup), active = cache?.active.map(resourceGroup), warmed = cache?.warmed.map(resourceGroup);
    b.work(handles.length);
    b.charge("resources", handles.length);
    const actual = handles.map(handle => {
        const resource = spatialModelResource(handle);
        if (!resource)
            return b.fail("DATA", "model owner");
        admitModelResource(resource, b);
        b.work(resource.primitives.length + resource.images.length + handle.bounds.length + handle.diagnostics.length);
        const check = spatialModelOwnedFacts(resource);
        if (handle.bounds.length !== 6 || handle.bounds.some((v, i) => !Object.is(v, resource.bounds[i])) || handle.diagnostics.length !== resource.diagnostics.length || handle.diagnostics.some((v, i) => v !== resource.diagnostics[i]) || handle.materialProfile !== (resource.materialProfile === "specular" ? "specular" : undefined) || handle.contentId !== resource.contentId || handle.byteLength !== check.byteLength || handle.triangleCount !== check.triangleCount || handle.primitiveCount !== check.primitiveCount)
            return b.fail("DATA", "model handle metadata");
        return resource;
    });
    const assets = [];
    for (const resource of actual) {
        const source = sources.get(resource);
        if (!source)
            return b.fail("DATA", "actual model source owner missing");
        const bundle = await captureResourceSource({ blob: source.bundle, url: source.url }, b), originals = [];
        b.work(source.originals?.length ?? 0);
        b.charge("resources", source.originals?.length ?? 0);
        for (const original of source.originals ?? [])
            originals.push(await captureResourceSource(original, b));
        assets.push(Object.freeze({ resource, bundle, originals: Object.freeze(originals) }));
    }
    b.work(order.length);
    if ((registry?.size ?? 0) !== order.length || order.some(row => { const entry = registry?.get(row.key); return entry?.id !== row.id || entry.handle !== handles[row.group]; }))
        return b.fail("STALE", "model registry capture");
    cache?.assertCurrent();
    return Object.freeze({ registry: Object.freeze(order), assets: Object.freeze(assets), ...(cache ? { renderer: Object.freeze({ backend: cache.backend, roots: Object.freeze(roots!), active: Object.freeze(active!), warmed: Object.freeze(warmed!), prepared: Object.freeze(prepared!), ...(visible === undefined ? {} : { visible: Object.freeze(visible) }) }) } : {}) });
}
export interface PreparedResourceModels {
    readonly kind: "prepared-resource-models";
}
interface ModelPlan {
    handles: SpatialModelAsset[];
    rows: {
        key: string;
        id: number;
        handle: SpatialModelAsset;
    }[];
    sourceResources: SpatialModelResource[];
    cache?: ResourceModelCacheData;
    cacheInstalled: boolean;
    disposed: boolean;
    bound: boolean;
    installed: boolean;
}
const preparedModels = new WeakMap<PreparedResourceModels, ModelPlan>();
/** The caller supplies the private already-owned codec graph. Admission is
 * read-only; no reconstruction from provenance bytes or array normalization. */
export async function prepareModelResources(data: ResourceModelData, b: ResourceBudget): Promise<PreparedResourceModels> {
    resourceKeys(data, ["registry", "assets", "renderer"], b);
    if (!Array.isArray(data.registry) || !Array.isArray(data.assets))
        return b.fail("DATA", "model root arrays");
    b.work(data.registry.length + data.assets.length);
    b.charge("resources", data.registry.length + data.assets.length);
    const keys = new Set<string>(), ids = new Set<number>(), seen = new Set<number>();
    let next = 0;
    for (const row of data.registry) {
        resourceKeys(row, ["key", "id", "group"], b);
        b.metadata(row.key);
        resourceInteger(row.id, "model native ID", 1, 0xffffffff);
        resourceInteger(row.group, "model group", 0, data.assets.length - 1);
        if (!row.key || keys.has(row.key) || ids.has(row.id))
            return b.fail("DATA", "model key/ID binding");
        keys.add(row.key);
        ids.add(row.id);
        if (!seen.has(row.group)) {
            if (row.group !== next++)
                return b.fail("DATA", "model first owner ordinal");
            seen.add(row.group);
        }
    }
    const cache = data.renderer;
    if (cache) {
        resourceKeys(cache, ["backend", "roots", "active", "warmed", "prepared", "visible"], b);
        if (cache.backend !== "webgl2" && cache.backend !== "webgpu")
            return b.fail("DATA", "model cache backend");
        const visit = (index: number) => { resourceInteger(index, "model cache group", 0, data.assets.length - 1); if (!seen.has(index)) {
            if (index !== next++)
                return b.fail("DATA", "model first owner ordinal");
            seen.add(index);
        } };
        for (const list of [cache.prepared, cache.visible, cache.roots, cache.active, cache.warmed])
            if (list !== undefined) {
                if (!Array.isArray(list))
                    return b.fail("DATA", "model cache root array");
                b.work(list.length);
                b.charge("metadataBytes", list.length * 16);
            }
        for (const i of cache.prepared)
            visit(i);
        const visibleIds = new Set<number>();
        for (const row of cache.visible ?? []) {
            if (!Array.isArray(row) || row.length !== 2)
                return b.fail("DATA", "visible model pair");
            resourceInteger(row[0], "visible model ID", 1, 0xffffffff);
            if (visibleIds.has(row[0]))
                return b.fail("DATA", "visible model ID duplicate");
            visibleIds.add(row[0]);
            visit(row[1]);
        }
        for (const list of [cache.roots, cache.active, cache.warmed]) {
            const unique = new Set<SpatialModelResource>();
            for (const i of list) {
                visit(i);
                const resource = data.assets[i].resource;
                if (unique.has(resource))
                    return b.fail("DATA", "duplicate model cache resource");
                unique.add(resource);
            }
        }
        const retained = new Set([...cache.active, ...cache.warmed].map(i => data.assets[i].resource));
        if (cache.roots.length !== retained.size || cache.roots.some(i => !retained.has(data.assets[i].resource)))
            return b.fail("DATA", "model cache retained root union");
        const roots = new Set(cache.roots.map(i => data.assets[i].resource));
        for (const i of [...cache.active, ...cache.warmed])
            if (!roots.has(data.assets[i].resource))
                return b.fail("DATA", "model active/warm cache reference");
    }
    if (next !== data.assets.length)
        return b.fail("DATA", "unowned model group");
    // Complete scalar/index admission precedes source Blob/opaque-handle allocation.
    const provenance = new Map<SpatialModelResource, ResourceModelAssetData>();
    for (const row of data.assets) {
        resourceKeys(row, ["resource", "bundle", "originals"], b);
        const previous = provenance.get(row.resource);
        if (!previous)
            admitModelResource(row.resource, b);
        if (!Array.isArray(row.originals))
            return b.fail("DATA", "model original encodings");
        b.work(row.originals.length + 1);
        b.charge("resources", row.originals.length);
        if (!row.bundle)
            return b.fail("DATA", "model original bundle missing");
        for (const source of [row.bundle, ...row.originals]) {
            resourceKeys(source, ["url", "mime", "bytes"], b);
            b.metadata(source.url);
            b.metadata(source.mime);
            if (!(source.bytes instanceof Uint8Array) || !(source.bytes.buffer instanceof ArrayBuffer))
                return b.fail("DATA", "model owned source bytes");
        }
        if (previous && (previous.bundle !== row.bundle || previous.originals.length !== row.originals.length || previous.originals.some((v, i) => v !== row.originals[i])))
            return b.fail("DATA", "shared immutable model provenance");
        provenance.set(row.resource, row);
    }
    b.work(provenance.size * 2);
    b.charge("metadataBytes", provenance.size * 8);
    const sourceResources = [...provenance.keys()];
    for (const resource of sourceResources)
        if (sources.has(resource) || preparingResources.has(resource))
            return b.fail("BUSY", "expected detached exclusively owned model graph");
    for (const resource of sourceResources)
        preparingResources.add(resource);
    const handles: SpatialModelAsset[] = [];
    try {
        for (const row of provenance.values())
            await validateModelBundleIdentity(row, b);
        const blobs = new Map<object, {
            blob: Blob;
            url: string;
        }>(), getSource = (source: ResourceSourceBytes) => { let value = blobs.get(source); if (!value) {
            value = { blob: fileResourceBlob(source.bytes, source.mime, b), url: source.url };
            blobs.set(source, value);
        } return value; };
        for (const row of data.assets) {
            b.work(row.resource.primitives.length + row.resource.images.length);
            const handle = createSpatialModelAsset(row.resource);
            handles.push(handle);
            if (!sources.has(row.resource)) {
                const bundle = getSource(row.bundle), originals = row.originals.map(getSource);
                sources.set(row.resource, { bundle: bundle.blob, url: bundle.url, originals: Object.freeze(originals) });
            }
        }
        const rows = data.registry.map(row => ({ key: row.key, id: row.id, handle: handles[row.group] })), token = Object.freeze({ kind: "prepared-resource-models" as const });
        preparedModels.set(token, { handles, rows, sourceResources, ...(cache ? { cache } : {}), cacheInstalled: false, disposed: false, bound: false, installed: false });
        return token;
    }
    catch (error) {
        for (const resource of sourceResources)
            sources.delete(resource);
        handles.length = 0;
        sourceResources.length = 0;
        throw error;
    }
    finally {
        for (const resource of provenance.keys())
            preparingResources.delete(resource);
    }
}
/** Internal opaque handles may warm only the new unpublished renderer. */
export function preparedResourceModelHandles(token: PreparedResourceModels): readonly SpatialModelAsset[] { const plan = preparedModels.get(token); if (!plan || plan.disposed)
    throw new NativeFileResourceError("STALE", "model preparation"); return Object.freeze([...plan.handles]); }
export function prepareResourceModelRegistry(token: PreparedResourceModels, engine: object, b: ResourceBudget) {
    const plan = preparedModels.get(token);
    if (!plan || plan.disposed || plan.bound)
        return b.fail("STALE", "model preparation token");
    const lease = prepareFileSpatialModelRegistry(engine, plan.rows, b);
    plan.bound = true;
    const assertCurrent = () => { if (plan.disposed || plan.installed || preparedModels.get(token) !== plan)
        return b.fail("STALE", "model token/target binding"); lease.assertCurrent(); };
    return Object.freeze({ assertCurrent, adopt: () => { assertCurrent(); lease.adopt(); plan.installed = true; }, dispose: () => lease.dispose() });
}
/** Prepares only the new unpublished renderer. Failure requires disposing that
 * whole target; no old live renderer or source registry is ever passed here. */
export async function prepareResourceModelCache(token: PreparedResourceModels, renderer: object, b: ResourceBudget) {
    const plan = preparedModels.get(token);
    if (!plan || plan.disposed || plan.cacheInstalled)
        return b.fail("STALE", "model cache token");
    const owner = resourceModelCacheOwner(renderer);
    if (!owner)
        return b.fail("CAPABILITY", "target model cache owner");
    const c = plan.cache, resolve = (ids: readonly number[]) => ids.map(i => plan.handles[i]);
    if (c) {
        const check = owner.capture(b);
        if (check.backend !== c.backend)
            return b.fail("CAPABILITY", "model cache backend");
        await owner.prepare({ all: resolve(c.roots), active: resolve(c.active), warmed: resolve(c.warmed), prepared: resolve(c.prepared), ...(c.visible === undefined ? {} : { visible: c.visible.map(([id, i]) => [id, plan.handles[i]] as const) }) }, b);
    }
    plan.cacheInstalled = true;
    const captured = owner.capture(b);
    return Object.freeze({ assertCurrent: () => { if (plan.disposed)
            return b.fail("STALE", "model cache lease"); captured.assertCurrent(); } });
}
export function disposeResourceModels(token: PreparedResourceModels): void {
    const plan = preparedModels.get(token);
    if (!plan || plan.disposed)
        return;
    plan.disposed = true;
    if (!plan.installed && !plan.cacheInstalled)
        for (const resource of plan.sourceResources)
            sources.delete(resource);
    plan.handles.length = 0;
    plan.rows.length = 0;
    plan.sourceResources.length = 0;
    preparedModels.delete(token);
}
/** Original bundle hash and current normalized storage hash are distinct.
 * This checks the original provenance identity without rebuilding CPU data. */
export async function validateModelBundleIdentity(row: ResourceModelAssetData, b: ResourceBudget): Promise<void> {
    const bytes = row.bundle.bytes, prefix = row.resource.materialProfile === "specular" ? new TextEncoder().encode("ferrum2d.specular.v1\0") : new Uint8Array(0), length = bytes.byteLength + prefix.length;
    b.charge("sourceBytes", length * 2);
    b.work(length * 2);
    if (!globalThis.crypto?.subtle)
        return b.fail("CAPABILITY", "model SHA-256");
    const identity = new Uint8Array(length);
    identity.set(prefix);
    identity.set(bytes, prefix.length);
    const hash = await crypto.subtle.digest("SHA-256", identity), hex = Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, "0")).join("");
    if (hex !== row.resource.contentId)
        return b.fail("DATA", "model original bundle identity");
}
