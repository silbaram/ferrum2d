/** @internal SDK-owned active render textures. Retired externally held weak
 * handles are not strong owner roots and cannot be resurrected by a file. */
import { ResourceBudget, resourceKeys, resourceInteger, NativeFileResourceError } from "./nativeFileResourceBudget.js";
import type { RenderTexture } from "./renderTexture.js";
export interface ResourceRenderTextureData {
    readonly generation: number;
    readonly srgb: boolean;
    readonly entries: readonly {
        readonly id: number;
        readonly width: number;
        readonly height: number;
        readonly filter: "nearest" | "linear";
        readonly pixels: Uint8Array;
    }[];
}
export interface PreparedRenderTextures {
    readonly handles: ReadonlyMap<number, RenderTexture>;
    assertCurrent(): void;
    adopt(): void;
    dispose(): void;
}
export interface RenderTextureFileOwner {
    revision(): number;
    capture(b: ResourceBudget): ResourceRenderTextureData;
    prepare(data: ResourceRenderTextureData, b: ResourceBudget): PreparedRenderTextures;
}
const owners = new WeakMap<object, RenderTextureFileOwner>();
export function registerRenderTextureFileOwner(owner: object, hooks: RenderTextureFileOwner): void { if (owners.has(owner))
    throw new NativeFileResourceError("DATA", "duplicate render texture owner"); owners.set(owner, hooks); }
export function renderTextureFileOwner(owner: object): RenderTextureFileOwner | undefined { return owners.get(owner); }
export function copyFileRenderTextures(data: ResourceRenderTextureData, b: ResourceBudget): ResourceRenderTextureData {
    resourceKeys(data, ["generation", "srgb", "entries"], b);
    resourceInteger(data.generation, "render texture origin");
    if (typeof data.srgb !== "boolean" || !Array.isArray(data.entries))
        return b.fail("DATA", "render texture owner");
    b.work(data.entries.length);
    b.charge("resources", data.entries.length);
    const ids = new Set<number>();
    return Object.freeze({ generation: data.generation, srgb: data.srgb, entries: Object.freeze(data.entries.map(row => {
            resourceKeys(row, ["id", "width", "height", "filter", "pixels"], b);
            resourceInteger(row.id, "render texture id", 1, 0xffffff);
            resourceInteger(row.width, "render texture width", 1, 0x7fffffff);
            resourceInteger(row.height, "render texture height", 1, 0x7fffffff);
            if (ids.has(row.id) || row.filter !== "nearest" && row.filter !== "linear")
                return b.fail("DATA", "render texture binding/filter");
            ids.add(row.id);
            b.charge("gpuBytes", row.width * row.height * 4);
            return Object.freeze({ ...row, pixels: b.bytes(row.pixels, "decodedBytes", row.width * row.height * 4) });
        })) });
}
