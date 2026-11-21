/** @internal Actual constructor-owned model cache roots; no caller roster. */
import { ResourceBudget, NativeFileResourceError } from "./nativeFileResourceBudget.js";
import type { SpatialModelAsset, SpatialModelResource } from "./spatialModel.js";
export interface ResourceModelCacheRoots {
    readonly backend: "webgl2" | "webgpu";
    readonly roots: readonly SpatialModelResource[];
    readonly active: readonly SpatialModelResource[];
    readonly warmed: readonly SpatialModelResource[];
    readonly prepared: readonly SpatialModelAsset[];
    readonly visible?: readonly (readonly [
        number,
        SpatialModelAsset
    ])[];
    assertCurrent(): void;
}
export interface ResourceModelCachePreparation {
    readonly all: readonly SpatialModelAsset[];
    readonly active: readonly SpatialModelAsset[];
    readonly warmed: readonly SpatialModelAsset[];
    readonly prepared: readonly SpatialModelAsset[];
    readonly visible?: readonly (readonly [
        number,
        SpatialModelAsset
    ])[];
}
export interface ResourceModelCacheOwner {
    capture(b: ResourceBudget): ResourceModelCacheRoots;
    prepare(data: ResourceModelCachePreparation, b: ResourceBudget): Promise<void>;
}
const owners = new WeakMap<object, ResourceModelCacheOwner>();
export function registerResourceModelCacheOwner(owner: object, hooks: ResourceModelCacheOwner): void { if (owners.has(owner))
    throw new NativeFileResourceError("DATA", "duplicate model cache owner"); owners.set(owner, hooks); }
export function resourceModelCacheOwner(owner: object): ResourceModelCacheOwner | undefined { return owners.get(owner); }
export function chargeFileModelGpu(resources: readonly SpatialModelResource[], b: ResourceBudget): void {
    b.work(resources.length);
    for (const r of resources) {
        b.work(r.primitives.length + r.images.length);
        let bytes = 0;
        for (const p of r.primitives)
            bytes += p.vertices.byteLength + p.indices.byteLength + 1024;
        for (const i of r.images)
            bytes += i.pixels.byteLength * 4;
        b.charge("gpuBytes", bytes);
    }
}
