import { resolveSpatialTextureTransform, validateSpatialRequiredExtensions, validateSpatialTransformedUvs } from "./spatialTextureTransform.js";
import { SpatialModelImageReader } from "./spatialModelImage.js";
/** Bounded static GLB input. This is a diffuse conversion profile, not a glTF PBR renderer. */
export interface SpatialModelPrimitive {
    /** Interleaved asset-local XYZ, UV, normal; 8 floats, or 12 with tangent XYZW for normal maps. */
    readonly vertices: Float32Array;
    readonly indices: Uint32Array;
    readonly color: readonly number[];
    readonly image?: number;
    /** Optional KHR_texture_transform matrix for the base-color texture. */
    readonly uvTransform?: Float32Array;
    readonly normal?: { readonly image: number; readonly sampler: readonly [number, number, number, number]; readonly uvTransform?: Float32Array; readonly scale: number };
    readonly emissive?: { readonly image: number; readonly sampler: readonly [number, number, number, number]; readonly uvTransform?: Float32Array };
    /** Linear emission multiplier; independent of diffuse illumination, not a scene light. */
    readonly emissiveFactor: readonly number[];
    /** glTF unlit: base color/alpha only; scene fog and depth still apply. */
    readonly unlit?: boolean;
    /** Zero for OPAQUE, otherwise the glTF MASK threshold (default 0.5). */
    readonly alphaCutoff: number;
    readonly doubleSided: boolean;
    readonly sampler: readonly [
        number,
        number,
        number,
        number
    ];
}
export interface SpatialModelResource {
    readonly contentId: string;
    readonly bounds: readonly number[];
    readonly primitives: readonly SpatialModelPrimitive[];
    readonly images: readonly {
        width: number;
        height: number;
        pixels: Uint8ClampedArray;
    }[];
    readonly diagnostics: readonly string[];
}
/** Opaque immutable resource identity. Mutable geometry and decoded pixels stay private. */
export interface SpatialModelAsset {
    readonly contentId: string;
    readonly bounds: readonly number[];
    readonly primitiveCount: number;
    readonly byteLength: number;
    readonly triangleCount: number;
    readonly diagnostics: readonly string[];
}
/** A renderer-owned, synchronous preparation lease. Dispose uncommitted work explicitly. */
export interface SpatialModelPreparation {
    readonly uploadBytes: number;
    commit(): void;
    dispose(): void;
}
/** Cold platform hook; only opaque CPU asset handles cross the authoring boundary. */
export interface SpatialModelPreparer {
    prepareSpatialModels(assets: readonly SpatialModelAsset[]): SpatialModelPreparation;
}
const resources = new WeakMap<SpatialModelAsset, SpatialModelResource>();
export function spatialModelResource(asset: SpatialModelAsset): SpatialModelResource | undefined { return resources.get(asset); }
/** Internal ownership handoff from the validated loader; not a public package export. */
export function createSpatialModelAsset(resource: SpatialModelResource): SpatialModelAsset {
    const handle = Object.freeze({
        contentId: resource.contentId,
        bounds: Object.freeze([...resource.bounds]),
        primitiveCount: resource.primitives.length,
        triangleCount: resource.primitives.reduce((n, p) => n + p.indices.length / 3, 0),
        byteLength: resource.primitives.reduce((n, p) => n + p.vertices.byteLength + p.indices.byteLength
            + (p.uvTransform?.byteLength ?? 0) + (p.normal?.uvTransform?.byteLength ?? 0) + (p.emissive?.uvTransform?.byteLength ?? 0), 0)
            + resource.images.reduce((n, i) => n + i.pixels.byteLength, 0),
        diagnostics: Object.freeze([...resource.diagnostics]),
    });
    resources.set(handle, resource);
    return handle;
}
export interface SpatialGlbOptions {
    /** Explicitly accepts conversion of metallic/roughness to existing diffuse lighting. */
    materialProfile: "diffuse";
    signal?: AbortSignal;
}
const MAX_GLB_BYTES = 32 * 1024 * 1024;
type Obj = Record<string, unknown>;
const fail = (message: string): never => { throw new Error(`Spatial GLB: ${message}`); };
function obj(v: unknown): Obj {
    if (!v || typeof v !== "object" || Array.isArray(v))
        return fail("expected object");
    return v as Obj;
}
function list(v: unknown, max = 4096): unknown[] {
    if (!Array.isArray(v) || v.length > max)
        return fail("array limit/format");
    return v;
}
function integer(v: unknown, max = 0x7fffffff): number {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > max)
        return fail("invalid integer");
    return v;
}
function numbers(v: unknown, size: number): number[] {
    const a = list(v, size);
    if (a.length !== size || a.some(x => typeof x !== "number" || !Number.isFinite(Math.fround(x))))
        return fail("invalid numeric vector");
    return a as number[];
}
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a: number[], b: number[]): number[] {
    return Array.from({ length: 16 }, (_, i) => [0, 1, 2, 3].reduce((s, k) => s + a[k * 4 + i % 4] * b[Math.floor(i / 4) * 4 + k], 0));
}
function nodeMatrix(n: Obj): number[] {
    if (n.matrix !== undefined) {
        if (n.translation !== undefined || n.rotation !== undefined || n.scale !== undefined)
            return fail("matrix and TRS cannot coexist");
        return numbers(n.matrix, 16);
    }
    const [x, y, z, w] = numbers(n.rotation ?? [0, 0, 0, 1], 4);
    if (Math.abs(x * x + y * y + z * z + w * w - 1) > 0.001)
        return fail("rotation must be a unit quaternion");
    const s = numbers(n.scale ?? [1, 1, 1], 3), t = numbers(n.translation ?? [0, 0, 0], 3);
    return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
        2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
        2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0, ...t, 1];
}
/** Fetches/decodes a self-contained GLB before scene activation. No production parser dependency. */
export async function loadSpatialGlb(source: string | ArrayBuffer, options: SpatialGlbOptions): Promise<SpatialModelAsset> {
    if (options.materialProfile !== "diffuse")
        return fail("materialProfile must explicitly select diffuse");
    options.signal?.throwIfAborted();
    let bytes: ArrayBuffer;
    if (typeof source === "string") {
        const response = await fetch(source, { signal: options.signal });
        const responseError = !response.ok ? `HTTP ${response.status}`
            : Number(response.headers.get("content-length")) > MAX_GLB_BYTES ? "file exceeds 32 MiB" : undefined;
        if (responseError !== undefined) {
            try { await response.body?.cancel(); }
            catch { /* Preserve the HTTP/size error when cancellation itself fails. */ }
            return fail(responseError);
        }
        // Read with a limit even when Content-Length is absent or incorrect.
        const reader = response.body?.getReader();
        if (!reader)
            return fail("response has no body");
        // Retain a bounded contiguous buffer rather than one object per network chunk.
        // Even a byte-at-a-time response must not accumulate millions of array references.
        let data = new Uint8Array(0);
        let length = 0;
        try {
            for (;;) {
                const part = await reader.read();
                if (part.done)
                    break;
                const nextLength = length + part.value.byteLength;
                if (nextLength > MAX_GLB_BYTES)
                    return fail("file exceeds 32 MiB");
                if (nextLength > data.byteLength) {
                    const next = new Uint8Array(Math.min(MAX_GLB_BYTES, Math.max(1024, data.byteLength * 2, nextLength)));
                    next.set(data.subarray(0, length));
                    data = next;
                }
                data.set(part.value, length);
                length = nextLength;
            }
        }
        finally {
            try { await reader.cancel(); }
            catch { /* Cleanup must not replace the read/size error. */ }
            finally { reader.releaseLock(); }
        }
        bytes = data.byteLength === length ? data.buffer : data.slice(0, length).buffer;
    }
    else {
        if(source.byteLength<28 || source.byteLength>MAX_GLB_BYTES)return fail("file size limit");
        bytes = source.slice(0);
    }
    if (bytes.byteLength < 28 || bytes.byteLength > MAX_GLB_BYTES)
        return fail("file size limit");
    const dv = new DataView(bytes);
    if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2 || dv.getUint32(8, true) !== bytes.byteLength)
        return fail("invalid GLB header");
    let json: unknown, binary: Uint8Array | undefined, offset = 12;
    while (offset < bytes.byteLength) {
        if (offset + 8 > bytes.byteLength)
            return fail("truncated chunk");
        const size = dv.getUint32(offset, true), kind = dv.getUint32(offset + 4, true);
        if (size % 4 || offset + 8 + size > bytes.byteLength)
            return fail("chunk range/alignment");
        const data = new Uint8Array(bytes, offset + 8, size);
        if (offset === 12) {
            if (kind !== 0x4e4f534a || size > 2 * 1024 * 1024)
                return fail("first chunk must be bounded JSON");
            json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
        }
        else if (kind === 0x004e4942 && !binary)
            binary = data;
        else
            return fail("unsupported/duplicate chunk");
        offset += size + 8;
    }
    const gltf = obj(json), asset = obj(gltf.asset);
    if (asset.version !== "2.0" || (asset.minVersion !== undefined && asset.minVersion !== "2.0"))
        return fail("requires glTF 2.0");
    validateSpatialRequiredExtensions(gltf.extensionsRequired);
    if (list(gltf.animations ?? []).length || list(gltf.skins ?? []).length)
        return fail("animation/skin is unsupported");
    const buffers = list(gltf.buffers, 1);
    if (buffers.length !== 1 || obj(buffers[0]).uri !== undefined || !binary)
        return fail("requires one embedded BIN buffer");
    const binaryLength = integer(obj(buffers[0]).byteLength);
    if (binaryLength > binary.byteLength || binary.byteLength - binaryLength > 3)
        return fail("BIN length mismatch");
    const bin: Uint8Array = binary;
    const views = list(gltf.bufferViews), accessors = list(gltf.accessors);
    function view(index: unknown): {
        data: DataView;
        stride?: number;
        offset: number;
    } {
        const v = obj(views[integer(index, views.length - 1)]);
        if (v.buffer !== 0)
            return fail("external buffer");
        const start = integer(v.byteOffset ?? 0), length = integer(v.byteLength);
        if (start + length > binaryLength)
            return fail("bufferView out of bounds");
        return { data: new DataView(bin.buffer, bin.byteOffset + start, length), offset: start,
            ...(v.byteStride === undefined ? {} : { stride: integer(v.byteStride, 252) }) };
    }
    function accessor(index: unknown, type: string, count?: number, indices = false): number[] {
        const a = obj(accessors[integer(index, accessors.length - 1)]);
        if (a.type !== type || a.sparse !== undefined || (a.normalized !== undefined && a.normalized !== false))
            return fail("unsupported accessor type/sparse/normalized");
        const n = integer(a.count, indices ? 196608 : 65536);
        if (!n || (count !== undefined && count !== n))
            return fail("accessor count mismatch");
        const component = integer(a.componentType), size = component === 5126 || component === 5125 ? 4 : component === 5123 ? 2 : component === 5121 ? 1 : 0;
        if (!size || (!indices && component !== 5126) || (indices && component === 5126))
            return fail("unsupported component type");
        const v = view(a.bufferView), width = type === "VEC4" ? 4 : type === "VEC3" ? 3 : type === "VEC2" ? 2 : 1;
        const start = integer(a.byteOffset ?? 0), stride = v.stride ?? size * width;
        if (start % size || (v.offset + start) % size || stride < size * width || stride % size || (v.stride !== undefined && (indices || stride < 4 || stride % 4)) || start + (n - 1) * stride + size * width > v.data.byteLength)
            return fail("accessor range/alignment/stride");
        const out: number[] = [];
        for (let i = 0; i < n; i++)
            for (let k = 0; k < width; k++) {
                const p = start + i * stride + k * size;
                const x = component === 5126 ? v.data.getFloat32(p, true) : size === 4 ? v.data.getUint32(p, true) : size === 2 ? v.data.getUint16(p, true) : v.data.getUint8(p);
                if (!Number.isFinite(x))
                    return fail("nonfinite accessor");
                out.push(x);
            }
        return out;
    }
    const meshes = list(gltf.meshes, 128), nodes = list(gltf.nodes, 128), scenes = list(gltf.scenes, 16);
    const materials = list(gltf.materials ?? [], 64), textures = list(gltf.textures ?? [], 32), samplers = list(gltf.samplers ?? [], 32), rawImages = list(gltf.images ?? [], 16);
    const primitives: SpatialModelPrimitive[] = [], seen = new Set<number>();
    const opaqueImages = new Set<number>();
    const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    let vertexTotal = 0, indexTotal = 0;
    function visit(index: unknown, parent: number[], depth: number): void {
        const id = integer(index, nodes.length - 1);
        if (depth > 32 || seen.has(id))
            return fail("node cycle/shared parent/depth limit");
        seen.add(id);
        const n = obj(nodes[id]);
        if (n.skin !== undefined || n.weights !== undefined || n.extensions !== undefined)
            return fail("unsupported node skin/weights/extensions");
        const m = multiply(parent, nodeMatrix(n));
        if (m.some(x => !Number.isFinite(Math.fround(x))) || m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1)
            return fail("invalid affine transform");
        const a = [m[0], m[1], m[2]], b = [m[4], m[5], m[6]], c = [m[8], m[9], m[10]];
        const cross = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const bc = cross(b, c), ca = cross(c, a), ab = cross(a, b), det = a.reduce((s, x, i) => s + x * bc[i], 0);
        if (!(det > 0) || !Number.isFinite(det))
            return fail("singular/mirrored node transforms are unsupported");
        if (n.mesh !== undefined)
            for (const raw of list(obj(meshes[integer(n.mesh, meshes.length - 1)]).primitives, 256)) {
                if (primitives.length >= 1024)
                    return fail("source primitive limit 1024");
                const p = obj(raw), attrs = obj(p.attributes);
                if ((p.mode ?? 4) !== 4 || p.targets !== undefined || p.extensions !== undefined)
                    return fail("requires static TRIANGLES");
                if (Object.keys(attrs).some(k => !["POSITION", "NORMAL", "TEXCOORD_0", "TANGENT"].includes(k)))
                    return fail("unsupported vertex attribute");
                const positions = accessor(attrs.POSITION, "VEC3"), count = positions.length / 3;
                const normals = accessor(attrs.NORMAL, "VEC3", count);
                const tangents = attrs.TANGENT === undefined ? undefined : accessor(attrs.TANGENT, "VEC4", count);
                const uv = attrs.TEXCOORD_0 === undefined ? new Array(count * 2).fill(0) : accessor(attrs.TEXCOORD_0, "VEC2", count);
                const idx = p.indices === undefined ? Array.from({ length: count }, (_, i) => i) : accessor(p.indices, "SCALAR", undefined, true);
                vertexTotal += count;
                indexTotal += idx.length;
                if (idx.length % 3 || idx.some(x => x >= count) || vertexTotal > 65536 || indexTotal > 196608)
                    return fail("index/geometry budget");
                const material = p.material === undefined ? {} : obj(materials[integer(p.material, materials.length - 1)]);
                const alphaMode = material.alphaMode === undefined ? "OPAQUE" : material.alphaMode;
                const extensions=material.extensions===undefined?{}:obj(material.extensions);
                const unknownExtensions=Object.keys(extensions).filter(k=>!['KHR_materials_unlit','KHR_materials_emissive_strength'].includes(k));
                if(unknownExtensions.length) return fail(`material ${String(material.name??p.material??'default')}: unsupported extensions ${unknownExtensions.join(', ')}`);
                const unlit=extensions.KHR_materials_unlit!==undefined;
                if(unlit) obj(extensions.KHR_materials_unlit);
                if(unlit && extensions.KHR_materials_emissive_strength!==undefined) return fail('KHR_materials_unlit cannot be combined with KHR_materials_emissive_strength');
                const strengthExtension=extensions.KHR_materials_emissive_strength===undefined?{}:obj(extensions.KHR_materials_emissive_strength);
                const strength=strengthExtension.emissiveStrength??1;
                if(typeof strength!=='number'||!Number.isFinite(Math.fround(strength))||strength<0||strength>64) return fail('emissiveStrength must be a finite number in [0,64]');
                if (typeof alphaMode !== "string" || !["OPAQUE", "MASK"].includes(alphaMode) || (material.doubleSided !== undefined && typeof material.doubleSided !== "boolean") || material.occlusionTexture !== undefined)
                    return fail("requires OPAQUE/MASK diffuse material; BLEND, occlusion and extensions are unsupported");
                const cutoff = material.alphaCutoff === undefined ? 0.5 : material.alphaCutoff;
                if (typeof cutoff !== "number" || cutoff < 0 || !Number.isFinite(Math.fround(cutoff)) || (cutoff > 0 && Math.fround(cutoff) === 0))
                    return fail("alphaCutoff must be a finite nonnegative f32");
                // Preserve the logical >1 boundary even when the JSON number rounds down to f32 1.
                const alphaCutoff = alphaMode === "MASK" ? Math.max(cutoff > 1 ? 1 + 2 ** -23 : 0, Math.fround(cutoff)) : 0;
                const doubleSided = material.doubleSided === true;
                const pbr = material.pbrMetallicRoughness === undefined ? {} : obj(material.pbrMetallicRoughness);
                if (pbr.metallicRoughnessTexture !== undefined)
                    return fail("metallic/roughness texture is unsupported");
                const color = numbers(pbr.baseColorFactor ?? [1, 1, 1, 1], 4);
                if (color.some(x => x < 0 || x > 1))
                    return fail("base color outside [0,1]");
                const textureRef = (value: unknown) => {
                    if (attrs.TEXCOORD_0 === undefined)
                        return fail("textured primitive requires TEXCOORD_0");
                    const ref = obj(value);
                    const uvTransform = resolveSpatialTextureTransform(ref);
                    validateSpatialTransformedUvs(uv, uvTransform);
                    const tex = obj(textures[integer(ref.index, textures.length - 1)]);
                    if (tex.extensions !== undefined) return fail("texture extension is unsupported");
                    const image = integer(tex.source, rawImages.length - 1);
                    const s = tex.sampler === undefined ? {} : obj(samplers[integer(tex.sampler, samplers.length - 1)]);
                    const sampler: [number, number, number, number] = [integer(s.minFilter ?? 9729), integer(s.magFilter ?? 9729), integer(s.wrapS ?? 10497), integer(s.wrapT ?? 10497)];
                    if (![9728, 9729, 9984, 9985, 9986, 9987].includes(sampler[0]) || ![9728, 9729].includes(sampler[1]) || sampler.slice(2).some(x => ![33071, 33648, 10497].includes(x)))
                        return fail("invalid sampler");
                    return { image, sampler, ...(uvTransform ? { uvTransform } : {}) };
                };
                const base = pbr.baseColorTexture === undefined ? undefined : textureRef(pbr.baseColorTexture);
                if (base && alphaMode === "OPAQUE") opaqueImages.add(base.image);
                const normalRef = material.normalTexture === undefined ? undefined : textureRef(material.normalTexture);
                const normalScale = normalRef ? (obj(material.normalTexture).scale === undefined ? 1 : obj(material.normalTexture).scale) : 1;
                if (typeof normalScale !== "number" || (!Number.isFinite(Math.fround(normalScale)) || Math.abs(normalScale) > 64)) return fail("normal scale must be a finite f32 in [-64,64]");
                if (normalRef && !tangents) return fail("normal texture requires exported TANGENT VEC4; enable tangents in Blender export");
                const normal = normalRef ? { ...normalRef, scale: normalScale } : undefined;
                const emissive = material.emissiveTexture === undefined ? undefined : textureRef(material.emissiveTexture);
                let emissiveFactor = numbers(material.emissiveFactor === undefined ? [0,0,0] : material.emissiveFactor, 3);
                if (emissiveFactor.some(x => x < 0 || x > 1)) return fail("emissive factor outside [0,1]");
                emissiveFactor=unlit?[0,0,0]:emissiveFactor.map(x=>x*strength);
                // Validate even unused exported tangents; reject undefined tangent-space seams.
                if (tangents) {
                    for (let i = 0; i < count; i++) {
                        const t = tangents.slice(i*4,i*4+3), n = normals.slice(i*3,i*3+3);
                        if (Math.abs(Math.hypot(...t)-1) > .001 || ![-1,1].includes(tangents[i*4+3]) || Math.abs(t.reduce((v,x,k)=>v+x*n[k],0)) > .001*Math.hypot(...n))
                            return fail("invalid unit/orthogonal TANGENT or handedness");
                    }
                    for (let i = 0; i < idx.length; i += 3)
                        if (idx.slice(i,i+3).some(v=>tangents[v*4+3] !== tangents[idx[i]*4+3])) return fail("mixed triangle tangent handedness");
                }
                const stride = normal ? 12 : 8;
                const vertices = new Float32Array(count * stride);
                for (let i = 0; i < count; i++) {
                    const v = positions.slice(i * 3, i * 3 + 3), sourceNormal = normals.slice(i * 3, i * 3 + 3);
                    const at = [0, 1, 2].map(k => a[k] * v[0] + b[k] * v[1] + c[k] * v[2] + m[12 + k]);
                    const nn = [0, 1, 2].map(k => (bc[k] * sourceNormal[0] + ca[k] * sourceNormal[1] + ab[k] * sourceNormal[2]) / det), length = Math.hypot(...nn);
                    if (!(length > 0) || !Number.isFinite(length) || at.some(x => !Number.isFinite(Math.fround(x))))
                        return fail("invalid transformed vertex/normal");
                    const unitNormal = nn.map(x => x / length);
                    vertices.set([...at, ...uv.slice(i * 2, i * 2 + 2), ...unitNormal], i * stride);
                    if (normal && tangents) {
                        const t = tangents.slice(i*4,i*4+3);
                        const transformed = [0,1,2].map(k=>a[k]*t[0]+b[k]*t[1]+c[k]*t[2]);
                        const projection = transformed.reduce((v,x,k)=>v+x*unitNormal[k],0);
                        const orthogonal = transformed.map((x,k)=>x-projection*unitNormal[k]), len = Math.hypot(...orthogonal);
                        if (!(len > 0) || !Number.isFinite(len)) return fail("invalid transformed tangent");
                        vertices.set([...orthogonal.map(x=>x/len),tangents[i*4+3]],i*stride+8);
                    }
                    at.forEach((x, k) => { bounds[k] = Math.min(bounds[k], Math.fround(x)); bounds[k + 3] = Math.max(bounds[k + 3], Math.fround(x)); });
                }
                primitives.push({ vertices, indices: Uint32Array.from(idx), color, sampler: base?.sampler ?? [9729,9729,10497,10497], alphaCutoff, doubleSided, emissiveFactor, unlit, ...(base ? { image: base.image, ...(base.uvTransform ? { uvTransform: base.uvTransform } : {}) } : {}), ...(normal ? { normal } : {}), ...(emissive ? { emissive } : {}) });
            }
        for (const child of list(n.children ?? [], 128))
            visit(child, m, depth + 1);
    }
    const scene = obj(scenes[integer(gltf.scene ?? 0, scenes.length - 1)]);
    for (const root of list(scene.nodes, 128))
        visit(root, identity(), 0);
    if (!primitives.length)
        return fail("selected scene has no mesh");
    const sourcePrimitiveCount = primitives.length;
    if (primitives.length > 32) {
        // Existing <=32-primitive assets retain their exact draw order. Larger static
        // assets are baked into material batches before the unchanged submission gate.
        const groups = new Map<string, SpatialModelPrimitive[]>();
        for (const p of primitives) {
            const key = JSON.stringify([p.color,p.image,p.uvTransform,p.normal,p.emissive,p.emissiveFactor,p.unlit,p.alphaCutoff,p.doubleSided,p.sampler]);
            const group = groups.get(key);
            if (group) group.push(p); else groups.set(key,[p]);
        }
        if (groups.size > 32) return fail(`material batch limit 32 after merging ${sourcePrimitiveCount} source primitives`);
        const merged: SpatialModelPrimitive[] = [];
        for (const group of groups.values()) {
            const stride = group[0].normal ? 12 : 8;
            const vertices = new Float32Array(group.reduce((n,p)=>n+p.vertices.length,0));
            const indices = new Uint32Array(group.reduce((n,p)=>n+p.indices.length,0));
            let vertexOffset=0,indexOffset=0;
            for (const p of group) {
                vertices.set(p.vertices,vertexOffset);
                for (const index of p.indices) indices[indexOffset++]=index+vertexOffset/stride;
                vertexOffset+=p.vertices.length;
            }
            merged.push({...group[0],vertices,indices});
        }
        primitives.splice(0,primitives.length,...merged);
    }
    const images: {
        width: number;
        height: number;
        pixels: Uint8ClampedArray;
    }[] = [];
    let pixels = 0;
    const reader = new SpatialModelImageReader();
    try {
        for (const [imageIndex, raw] of rawImages.entries()) {
            options.signal?.throwIfAborted();
            const image = obj(raw);
            if (image.uri !== undefined || !["image/png", "image/jpeg"].includes(String(image.mimeType)))
                return fail("requires embedded PNG/JPEG");
            const v = view(image.bufferView);
            if (v.stride !== undefined)
                return fail("image bufferView cannot have stride");
            const data = new Uint8Array(v.data.buffer, v.data.byteOffset, v.data.byteLength);
            const [width, height] = imageDimensions(data, String(image.mimeType));
            pixels += width * height;
            if (width < 1 || height < 1 || width > 2048 || height > 2048 || pixels > 8 * 1024 * 1024)
                return fail("image pixel budget");
            const bitmap = await createImageBitmap(new Blob([data.slice()], { type: String(image.mimeType) }), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
            try {
                options.signal?.throwIfAborted();
                if (bitmap.width !== width || bitmap.height !== height)
                    return fail("image dimensions mismatch");
                const rgba = reader.read(bitmap);
                if (opaqueImages.has(imageIndex))
                    for(let i=3;i<rgba.length;i+=4)if(rgba[i]!==255)return fail("OPAQUE images require alpha 255 in the diffuse subset; use MASK for cutouts");
                images.push({ width, height, pixels:rgba });
            }
            finally {
                // Do not hold a scratch GPU context across the next asynchronous image decode.
                reader.destroy();
                bitmap.close();
            }
        }
    } finally {
        reader.destroy();
    }
    options.signal?.throwIfAborted();
    if(!globalThis.crypto?.subtle) return fail("SHA-256 requires a secure browser context");
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    options.signal?.throwIfAborted();
    const contentId = Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, "0")).join("");
    const diagnostics = Object.freeze(["diffuse profile: metallic/roughness scalars are not rendered as PBR",...(sourcePrimitiveCount>32?[`merged ${sourcePrimitiveCount} static source primitives into ${primitives.length} material batches`]:[])]);
    const frozenBounds = Object.freeze(bounds);
    return createSpatialModelAsset({ contentId, bounds: frozenBounds, primitives, images, diagnostics });
}
function imageDimensions(data: Uint8Array, mime: string): [
    number,
    number
] {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (mime === "image/png") {
        if (data.length < 24 || v.getUint32(0) !== 0x89504e47 || v.getUint32(4) !== 0x0d0a1a0a || v.getUint32(12) !== 0x49484452)
            return fail("invalid PNG header");
        return [v.getUint32(16), v.getUint32(20)];
    }
    if (data.length < 4 || v.getUint16(0) !== 0xffd8)
        return fail("invalid JPEG header");
    let p = 2;
    while (p + 4 <= data.length) {
        if (data[p++] !== 255)
            return fail("invalid JPEG marker");
        while (data[p] === 255)
            p++;
        const kind = data[p++];
        if (kind === 0xda || kind === 0xd9)
            break;
        const size = v.getUint16(p);
        if (size < 2 || p + size > data.length)
            return fail("JPEG segment range");
        if ([0xc0, 0xc1, 0xc2].includes(kind) && size >= 8)
            return [v.getUint16(p + 5), v.getUint16(p + 3)];
        p += size;
    }
    return fail("unsupported JPEG dimensions");
}
// Static CPU resources only. Native instance buffers remain the sole mutable pose/submission state.
const registries = new WeakMap<object, Map<string, {
    id: number;
    asset: SpatialModelResource;
    handle: SpatialModelAsset;
}>>();
export function spatialModelRegistry(engine: object) {
    let registry = registries.get(engine);
    if (!registry) {
        registry = new Map();
        registries.set(engine, registry);
    }
    return registry;
}
