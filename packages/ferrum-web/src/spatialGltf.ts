import { loadSpatialGlb, type SpatialGlbOptions, type SpatialModelAsset } from "./spatialModel.js";

/** Same explicit diffuse profile and cancellation contract as the self-contained GLB loader. */
export type SpatialGltfOptions = SpatialGlbOptions;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_JSON = 2 * 1024 * 1024;
type RecordValue = Record<string, unknown>;
const fail = (message: string): never => { throw Error(`Spatial glTF: ${message}`); };
function record(value: unknown): RecordValue {
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail("expected object");
    return value as RecordValue;
}
function array(value: unknown, max: number): unknown[] {
    if (!Array.isArray(value) || value.length > max) return fail("array limit/format");
    return value;
}
function integer(value: unknown, max = MAX_BYTES): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) return fail("invalid integer/range");
    return value;
}
function httpUrl(value: string, base?: URL): URL {
    let url: URL;
    try { url = new URL(value, base ?? globalThis.location?.href); }
    catch { return fail("requires an HTTP(S) URL"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
        return fail("requires HTTP(S) without credentials or fragments");
    if (base && url.origin !== base.origin) return fail("dependencies must use the document origin");
    return url;
}
function dependency(value: unknown, base: URL): URL {
    if (typeof value !== "string" || !value.length) return fail("external resource URI required");
    return httpUrl(value, base);
}
const align = (n: number) => Math.ceil(n / 4) * 4;

/**
 * Fetch a bounded separate glTF, then normalize its buffers/images into the existing GLB decoder.
 * This is cold platform asset work; native scene state and GPU model caches are not modified.
 */
export async function loadSpatialGltf(source: string, options: SpatialGltfOptions): Promise<SpatialModelAsset> {
    if (options.materialProfile !== "diffuse") return fail("materialProfile must explicitly select diffuse");
    options.signal?.throwIfAborted();
    const url = httpUrl(source);
    let transferred = 0;
    const fetched = new Map<string, Uint8Array>();
    const read = async (resource: URL, limit: number): Promise<Uint8Array> => {
        const cached = fetched.get(resource.href);
        if (cached) {
            if (cached.byteLength > limit) return fail("resource size limit");
            return cached;
        }
        options.signal?.throwIfAborted();
        const response = await fetch(resource.href, { signal: options.signal, redirect: "error" });
        const bound = Math.min(limit, MAX_BYTES - transferred);
        // Fetch exposes decoded body bytes, but Content-Length describes the encoded response.
        // CORS can hide Content-Encoding, so only use the header as an early identity-body check.
        const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
        const identityLength = response.type !== "cors" && (!encoding || encoding === "identity");
        const error = !response.ok ? `HTTP ${response.status}`
            : response.redirected ? "redirects are unsupported"
            : identityLength && Number(response.headers.get("content-length")) > bound ? "resource/aggregate size limit" : undefined;
        if (error) {
            try { await response.body?.cancel(); } catch { /* Preserve the original failure. */ }
            return fail(error);
        }
        const reader = response.body?.getReader();
        if (!reader) return fail("response has no body");
        let bytes = new Uint8Array(0), length = 0;
        try {
            for (;;) {
                options.signal?.throwIfAborted();
                const part = await reader.read();
                options.signal?.throwIfAborted();
                if (part.done) break;
                const nextLength = length + part.value.byteLength;
                if (nextLength > bound) return fail("resource/aggregate size limit");
                if (nextLength > bytes.byteLength) {
                    const next = new Uint8Array(Math.min(bound, Math.max(1024, bytes.byteLength * 2, nextLength)));
                    next.set(bytes.subarray(0, length)); bytes = next;
                }
                bytes.set(part.value, length); length = nextLength;
            }
        } finally {
            try { await reader.cancel(); } catch { /* Cleanup must not replace the failure. */ }
            finally { reader.releaseLock(); }
        }
        transferred += length;
        const result = bytes.byteLength === length ? bytes : bytes.slice(0, length);
        fetched.set(resource.href, result);
        return result;
    };
    const json = await read(url, MAX_JSON);
    const gltf = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json)));
    const asset = record(gltf.asset);
    if (asset.version !== "2.0" || (asset.minVersion !== undefined && asset.minVersion !== "2.0")) return fail("requires glTF 2.0");
    if (array(gltf.extensionsRequired ?? [], 4096).length || array(gltf.animations ?? [], 4096).length || array(gltf.skins ?? [], 4096).length)
        return fail("required extensions/animation/skin are unsupported");
    const buffers = array(gltf.buffers, 16).map(record);
    if (!buffers.length) return fail("external buffers required");
    const views = array(gltf.bufferViews, 4096).map(record), images = array(gltf.images ?? [], 16).map(record);
    // Validate every dependency before fetching any of them, and every view against its original
    // buffer. Rebasing must never make an invalid view overlap a later buffer or appended image.
    const bufferUris = buffers.map(buffer => dependency(buffer.uri, url));
    const lengths = buffers.map(buffer => { const n = integer(buffer.byteLength); if (!n) return fail("empty buffer"); return n; });
    for (const view of views) {
        const buffer = integer(view.buffer, buffers.length - 1), offset = integer(view.byteOffset ?? 0), length = integer(view.byteLength);
        if (!length || offset + length > lengths[buffer]) return fail("bufferView out of original bounds");
    }
    // Images add new views below; accessor references must refer to the original document views.
    for (const value of array(gltf.accessors, 4096)) {
        const accessor = record(value);
        if (accessor.bufferView !== undefined && integer(accessor.bufferView) >= views.length)
            return fail("accessor out of original bufferView range");
    }
    const imageUris = images.map(image => {
        if (image.uri !== undefined) {
            if (image.bufferView !== undefined) return fail("image URI and bufferView cannot coexist");
            if (image.mimeType !== undefined && !["image/png", "image/jpeg"].includes(String(image.mimeType))) return fail("requires PNG/JPEG images");
            return dependency(image.uri, url);
        }
        integer(image.bufferView, views.length - 1);
        if (!["image/png", "image/jpeg"].includes(String(image.mimeType))) return fail("embedded image requires PNG/JPEG mimeType");
        return undefined;
    });
    if (views.length + imageUris.filter(Boolean).length > 4096) return fail("bufferView budget exceeded");
    const chunks: { offset: number; bytes: Uint8Array }[] = [], offsets: number[] = [];
    let binaryLength = 0;
    const append = (bytes: Uint8Array): number => {
        const offset = align(binaryLength);
        binaryLength = offset + bytes.byteLength;
        if (binaryLength > MAX_BYTES) return fail("bundle size limit");
        chunks.push({ offset, bytes }); return offset;
    };
    for (let i = 0; i < buffers.length; i++) {
        const bytes = await read(bufferUris[i], lengths[i]);
        if (bytes.byteLength !== lengths[i]) return fail("external buffer length mismatch");
        offsets.push(append(bytes));
    }
    for (const view of views) {
        view.byteOffset = offsets[view.buffer as number] + (view.byteOffset as number ?? 0);
        view.buffer = 0;
    }
    for (let i = 0; i < images.length; i++) {
        const uri = imageUris[i]; if (!uri) continue;
        const bytes = await read(uri, MAX_BYTES);
        const png = [137, 80, 78, 71, 13, 10, 26, 10];
        const mime = bytes.length >= 8 && png.every((v, at) => bytes[at] === v) ? "image/png"
            : bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg" : fail("requires PNG/JPEG image bytes");
        if (images[i].mimeType !== undefined && images[i].mimeType !== mime) return fail("image mimeType mismatch");
        images[i].bufferView = views.length;
        views.push({ buffer: 0, byteOffset: append(bytes), byteLength: bytes.byteLength });
        images[i].mimeType = mime;
        delete images[i].uri;
    }
    gltf.buffers = [{ byteLength: binaryLength }]; gltf.bufferViews = views; gltf.images = images;
    const encoded = new TextEncoder().encode(JSON.stringify(gltf)), paddedJson = align(encoded.length), paddedBin = align(binaryLength);
    if (paddedJson > MAX_JSON || 28 + paddedJson + paddedBin > MAX_BYTES) return fail("normalized bundle size limit");
    options.signal?.throwIfAborted();
    const bundle = new ArrayBuffer(28 + paddedJson + paddedBin), header = new DataView(bundle);
    [0x46546c67, 2, bundle.byteLength, paddedJson, 0x4e4f534a].forEach((v, i) => header.setUint32(i * 4, v, true));
    const content = new Uint8Array(bundle); content.fill(32, 20, 20 + paddedJson); content.set(encoded, 20);
    header.setUint32(20 + paddedJson, paddedBin, true); header.setUint32(24 + paddedJson, 0x004e4942, true);
    for (const chunk of chunks) content.set(chunk.bytes, 28 + paddedJson + chunk.offset);
    return loadSpatialGlb(bundle, options);
}
