/** @internal Projects actual owner-admitted resource data, never a caller roster.
 * Generation and provenance remain separately stored in the resource graph. */
import { ResourceBudget } from "./nativeFileResourceBudget.js";
import { encodeNativeFileResourceGraph } from "./nativeFileResourceCodec.js";
import type { ResourceAssetData, ResourceTextureData } from "./nativeFileResourceOwners.js";
import type { ResourceModelData } from "./nativeFileResourceModels.js";
import type { ResourceRenderTextureData } from "./nativeFileResourceRenderTextures.js";
import type { NativeFileAuthoringResources } from "./nativeFileAuthoringBindings.js";
interface AdmittedData {
    readonly assets?: ResourceAssetData;
    readonly textures?: ResourceTextureData;
    readonly renderTextures?: ResourceRenderTextureData;
    readonly models: ResourceModelData;
}
async function hashActual(value: unknown, b: ResourceBudget): Promise<string> {
    const encoded = encodeNativeFileResourceGraph(value, b), domain = new TextEncoder().encode("ferrum.resource.texture-content.v1\0"), length = domain.length + encoded.manifestBytes.length + encoded.dataBytes.length;
    b.work(length * 2 + 64);
    b.charge("sourceBytes", length * 2);
    b.charge("metadataBytes", 128);
    if (!globalThis.crypto?.subtle)
        return b.fail("CAPABILITY", "resource content SHA-256");
    const bytes = new Uint8Array(length);
    bytes.set(domain);
    bytes.set(encoded.manifestBytes, domain.length);
    bytes.set(encoded.dataBytes, domain.length + encoded.manifestBytes.length);
    const result = await crypto.subtle.digest("SHA-256", bytes);
    let text = "";
    for (const byte of new Uint8Array(result))
        text += byte.toString(16).padStart(2, "0");
    return text;
}
/** Owner admission has already established field/index/byte/alias relations.
 * Missing loaded objects remain absent; namespace reservations are not fabricated
 * into live GPU entries. Native ID/sentinel use is the native-reference pass. */
export async function admittedResourceRoster(data: AdmittedData, b: ResourceBudget): Promise<NativeFileAuthoringResources> {
    const names = new Map<number, string[]>();
    b.work(data.assets?.textures.entries.length ?? 0);
    for (const row of data.assets?.textures.entries ?? []) {
        b.metadata(row.name);
        const aliases = names.get(row.id);
        if (aliases)
            aliases.push(row.name);
        else
            names.set(row.id, [row.name]);
    }
    const textures: {
        id: number;
        names: readonly string[];
        contentId: string;
    }[] = [], models: {
        id: number;
        asset: string;
        contentId: string;
    }[] = [];
    b.work((data.textures?.entries.length ?? 0) + (data.renderTextures?.entries.length ?? 0) + data.models.registry.length);
    b.charge("resources", (data.textures?.entries.length ?? 0) + (data.renderTextures?.entries.length ?? 0) + data.models.registry.length);
    for (const row of data.textures?.entries ?? []) {
        // ID, generation, source URL/original encoding are provenance/bindings, not
        // current sampled-content identity. Same-valued distinct objects may hash
        // equally while their actual alias topology stays separate in the codec.
        const fact = { kind: "texture", backend: data.textures!.backend, colorManagement: data.textures!.colorManagement, width: row.width, height: row.height, colorSpace: row.colorSpace, alphaMode: row.alphaMode, runtimeInfo: row.runtimeInfo, ...(row.runtimeMetadata === undefined ? {} : { runtimeMetadata: row.runtimeMetadata }), storage: row.storage, sampler: row.sampler, pixels: row.pixels, ...(row.compressed === undefined ? {} : { compressed: row.compressed }) };
        const contentId = await hashActual(fact, b);
        b.work(row.ids.length);
        b.charge("metadataBytes", row.ids.length * 32);
        for (const id of row.ids)
            textures.push(Object.freeze({ id, names: Object.freeze(names.get(id) ?? []), contentId }));
    }
    for (const row of data.renderTextures?.entries ?? []) {
        const contentId = await hashActual({ kind: "render-texture", srgb: data.renderTextures!.srgb, width: row.width, height: row.height, filter: row.filter, pixels: row.pixels }, b);
        b.charge("metadataBytes", 32);
        textures.push(Object.freeze({ id: row.id, names: Object.freeze([]), contentId }));
    }
    for (const row of data.models.registry) {
        const contentId = data.models.assets[row.group].resource.contentId;
        b.metadata(row.key);
        b.metadata(contentId);
        b.charge("metadataBytes", 32);
        models.push(Object.freeze({ id: row.id, asset: row.key, contentId }));
    }
    return Object.freeze({ textures: Object.freeze(textures), models: Object.freeze(models) });
}
