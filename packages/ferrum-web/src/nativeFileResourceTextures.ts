/** @internal Normal texture storage admission. External/HDR/multilevel storage
 * requires the separately registered host adapter; no guessed GPU dimensions. */
import { ResourceBudget, resourceInteger, resourceKeys } from "./nativeFileResourceBudget.js";
import type { ResourceTextureData, ResourceTextureEntry } from "./nativeFileResourceOwners.js";
export function copyFileTextureData(data: ResourceTextureData, b: ResourceBudget): ResourceTextureData {
    resourceKeys(data, ["backend", "generation", "contentRevision", "colorManagement", "entries"], b);
    if (data.backend !== "webgl2" && data.backend !== "webgpu" || data.colorManagement !== "legacy" && data.colorManagement !== "linear-srgb"
        || !Array.isArray(data.entries))
        b.fail("DATA", "texture owner metadata");
    resourceInteger(data.generation, "texture generation", 0, Number.MAX_SAFE_INTEGER);
    resourceInteger(data.contentRevision, "texture revision", 0, Number.MAX_SAFE_INTEGER);
    b.charge("resources", data.entries.length);
    b.work(data.entries.length);
    const ids = new Set<number>();
    const sources = new Map<object, NonNullable<ResourceTextureEntry["source"]>>();
    const entries = data.entries.map(entry => {
        resourceKeys(entry, ["ids", "width", "height", "generation", "colorSpace", "alphaMode", "runtimeInfo", "runtimeMetadata", "storage", "sampler", "pixels", "compressed", "source"], b);
        b.work(16);
        const width = resourceInteger(entry.width, "texture width", 1, 2147483647), height = resourceInteger(entry.height, "texture height", 1, 2147483647);
        resourceInteger(entry.generation, "texture generation", 0, data.generation);
        if (!["srgb", "linear", "none"].includes(entry.colorSpace) || !["straight", "premultiplied", "unknown"].includes(entry.alphaMode)
            || typeof entry.runtimeInfo !== "boolean" || entry.runtimeInfo && entry.alphaMode === "unknown"
            || !["rgba8", "srgb8-alpha8"].includes(entry.storage) || !Array.isArray(entry.ids) || !Array.isArray(entry.sampler) || entry.sampler.length !== 4)
            b.fail("DATA", "texture metadata");
        if (![9728, 9729].includes(entry.sampler[0]) || ![9728, 9729].includes(entry.sampler[1])
            || entry.sampler.slice(2).some((v: number) => ![33071, 33648, 10497].includes(v)))
            b.fail("DATA", "texture sampler");
        b.work(entry.ids.length);
        b.charge("metadataBytes", entry.ids.length * 8);
        const aliases = entry.ids.map((id: number) => {
            resourceInteger(id, "texture id", 0, Number.MAX_SAFE_INTEGER);
            if (ids.has(id))
                b.fail("DATA", "duplicate texture id");
            ids.add(id);
            return id;
        });
        let runtimeMetadata;
        if (entry.runtimeMetadata !== undefined) {
            const info = entry.runtimeMetadata;
            resourceKeys(info, ["width", "height", "colorSpace", "compressed", "alphaMode"], b);
            resourceInteger(info.width, "renderer info width", 1, 0x7fffffff);
            resourceInteger(info.height, "renderer info height", 1, 0x7fffffff);
            if (!entry.runtimeInfo || !["srgb", "linear", "none"].includes(info.colorSpace) || info.compressed !== undefined && typeof info.compressed !== "boolean" || info.alphaMode !== undefined && !["straight", "premultiplied"].includes(info.alphaMode))
                b.fail("DATA", "renderer texture info");
            runtimeMetadata = Object.freeze({ ...info });
        }
        const pixels = b.bytes(entry.pixels, "decodedBytes", width * height * 4);
        let compressed;
        if (entry.compressed) {
            resourceKeys(entry.compressed, ["format", "internalFormat", "blocks"], b);
            const c = entry.compressed, srgb = entry.storage === "srgb8-alpha8";
            const format = c.format === "astc-4x4" ? (srgb ? 0x93d0 : 0x93b0) : c.format === "bc7" ? (srgb ? 0x8e8d : 0x8e8c)
                : c.format === "etc2-rgba" ? (srgb ? 0x9279 : 0x9278) : -1;
            if (width < 4 || height < 4 || width % 4 || height % 4 || c.internalFormat !== format)
                b.fail("DATA", "compressed texture blocks");
            compressed = Object.freeze({ format: c.format, internalFormat: format, blocks: b.bytes(c.blocks, "decodedBytes", width * height) });
        }
        b.charge("gpuBytes", compressed === undefined ? width * height * 4 : compressed.blocks.byteLength);
        let source;
        if (entry.source) {
            source = sources.get(entry.source);
            if (source === undefined) {
                resourceKeys(entry.source, ["url", "mime", "bytes"], b);
                b.metadata(entry.source.url);
                b.metadata(entry.source.mime);
                source = Object.freeze({ url: entry.source.url, mime: entry.source.mime, bytes: b.bytes(entry.source.bytes, "sourceBytes") });
                sources.set(entry.source, source);
            }
        }
        return Object.freeze({ ...entry, ids: Object.freeze(aliases), pixels, ...(runtimeMetadata === undefined ? {} : { runtimeMetadata }),
            sampler: Object.freeze([entry.sampler[0], entry.sampler[1], entry.sampler[2], entry.sampler[3]] as const),
            ...(compressed === undefined ? {} : { compressed }), ...(source === undefined ? {} : { source }) });
    });
    return Object.freeze({ ...data, entries: Object.freeze(entries) });
}
