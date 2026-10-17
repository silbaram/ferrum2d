import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";
import { spatialModelResource, type SpatialModelResource as SpatialModelAsset, type SpatialModelPrimitive, type SpatialModelPreparation } from "./spatialModel.js";
import type { SpatialGeometryUniforms } from "./webgl2SpatialShaders.js";
import type { SpatialRendererStats } from "./webgl2SpatialPass.js";
type Frame = NonNullable<SpatialRenderBufferView["models"]>;
const MODEL_CAPACITY = 1024;
const MODEL_PASS_COUNT = 8;
/** Main camera, six point faces and sun each own non-overlapping matrix ranges. */
export const MODEL_INSTANCE_BUFFER_BYTES = MODEL_CAPACITY * MODEL_PASS_COUNT * 64;
export interface ModelMaterialUniforms {
    modelUnlit: WebGLUniformLocation;
    normalMap: WebGLUniformLocation;
    hasNormal: WebGLUniformLocation;
    modelNormalScale: WebGLUniformLocation;
    emissiveMap: WebGLUniformLocation;
    hasEmissive: WebGLUniformLocation;
    emissiveFactor: WebGLUniformLocation;
}
interface GpuPrimitive {
    vertex: WebGLBuffer;
    index: WebGLBuffer;
    samplers: WebGLSampler[];
    source: SpatialModelPrimitive;
}
interface GpuAsset {
    source: SpatialModelAsset;
    primitives: GpuPrimitive[];
    images: Map<number, WebGLTexture>;
    bytes: number;
    textureBytes: number;
    uploadBytes: number;
}
/** Platform resource cache only. Native buffers decide poses and camera/light visibility. */
export class WebGL2SpatialModels {
    private readonly assets = new Map<SpatialModelAsset, GpuAsset>();
    private active = new Set<SpatialModelAsset>();
    private pending?: Map<SpatialModelAsset, GpuAsset>;
    private destroyed = false;
    private readonly matrices = new Float32Array(MODEL_INSTANCE_BUFFER_BYTES / 4);
    private readonly batchCounts = new Uint32Array(MODEL_CAPACITY * MODEL_PASS_COUNT);
    private readonly batchEnds = new Uint32Array(MODEL_CAPACITY * MODEL_PASS_COUNT);
    private readonly matrixOffsets = new Uint32Array(MODEL_CAPACITY * MODEL_PASS_COUNT);
    private preparedFrame?: Frame;
    private preparedPasses = 0;
    constructor(private readonly gl: WebGL2RenderingContext) { }
    validate(frame?: Frame): void {
        if (!frame)
            return;
        if (frame.version !== 1 || frame.stride !== 20 || !(frame.words instanceof Uint32Array) || !(frame.values instanceof Float32Array) || !(frame.assets instanceof Map) || frame.words.length !== frame.values.length || frame.words.length % 20 || frame.words.length > 1024 * 20)
            throw Error("Invalid spatial model buffer");
        let primitiveCount = 0, triangleCount = 0, resourceBytes = 0;
        // Resource data is private and immutable; only per-row flags/matrices/budgets scale with N.
        // Keep this cache frame-local so validation never retains an unused asset or skips a new frame.
        const checked = new Map<SpatialModelAsset, number>();
        for (let i = 0; i < frame.words.length; i += 20) {
            if (!frame.assets.has(frame.words[i]) || frame.words[i + 1] > 3 || frame.words[i + 2] > 255 || frame.words[i + 3] !== 0)
                throw Error("Invalid model instance/resource");
            for (let j = i + 4; j < i + 20; j++) if (!Number.isFinite(frame.values[j]))
                throw Error("Invalid model instance/resource");
            const handle = frame.assets.get(frame.words[i])!;
            const asset = spatialModelResource(handle);
            if (!asset) throw Error("Invalid opaque spatial model asset");
            let triangles = checked.get(asset);
            if (triangles === undefined) {
                resourceBytes += handle.byteLength;
                if (checked.size >= 16 || resourceBytes > 128 * 1024 * 1024)
                    throw Error("Spatial model resource budget exceeded");
                if (!asset.primitives.length || asset.primitives.length > 32) throw Error("Invalid model primitive count");
                triangles = 0;
                for (const p of asset.primitives) {
                    if (typeof p.alphaCutoff !== "number" || !Number.isFinite(Math.fround(p.alphaCutoff)) || p.alphaCutoff < 0 ||
                        (p.alphaCutoff > 0 && Math.fround(p.alphaCutoff) === 0) || (p.alphaCutoff > 1 && Math.fround(p.alphaCutoff) <= 1) || typeof p.doubleSided !== "boolean") throw Error("Invalid model alpha/cull material");
                    if ((p.unlit!==undefined && typeof p.unlit!=='boolean') || !Array.isArray(p.emissiveFactor) || p.emissiveFactor.length !== 3 || p.emissiveFactor.some((x: number) => !Number.isFinite(x) || x < 0 || x > 64) ||
                        (p.normal && (!Number.isFinite(p.normal.scale) || Math.abs(p.normal.scale) > 64)) ||
                        [p.image, p.normal?.image, p.emissive?.image].some(image => image !== undefined && (!Number.isInteger(image) || image < 0 || image >= asset.images.length)))
                        throw Error("Invalid model normal/emissive material");
                    triangles += p.indices.length / 3;
                }
                checked.set(asset, triangles);
            }
            primitiveCount += asset.primitives.length;
            triangleCount += triangles;
            if (primitiveCount > 4096 || triangleCount > 262144) throw Error("Spatial model submission budget exceeded");
        }
    }
    prepare(frame: Frame | undefined, stats: SpatialRendererStats): void {
        this.assertAlive();
        const sources = new Set<SpatialModelAsset>();
        if (frame) for (let i = 0; i < frame.words.length; i += 20)
            sources.add(spatialModelResource(frame.assets.get(frame.words[i])!)!);
        let missing = false;
        for (const source of sources) if (!this.assets.has(source)) { missing = true; break; }
        if (!missing) { this.active = sources; this.prune(); return; }
        const prepared = this.uploadMissing(sources);
        for (const [source, gpu] of prepared.assets) this.assets.set(source, gpu);
        this.active = sources;
        this.prune();
        stats.modelUploadBytes += prepared.uploadBytes;
        stats.uploadBytes += prepared.uploadBytes;
    }
    /** Stage the whole asset set. No active resource is evicted until all uploads succeed. */
    stage(sources: readonly SpatialModelAsset[]): SpatialModelPreparation {
        this.assertAlive();
        if (this.pending) throw Error("Spatial model preparation already pending");
        this.pending = new Map();
        let prepared: ReturnType<WebGL2SpatialModels["uploadMissing"]>;
        try {
            prepared = this.uploadMissing(new Set(sources));
            this.pending = prepared.assets;
        } catch (error) {
            this.pending = undefined;
            throw error;
        }
        const assets = prepared.assets;
        let settled = false;
        return Object.freeze({
            uploadBytes: prepared.uploadBytes,
            commit: () => {
                this.assertAlive();
                if (settled || this.pending !== assets) throw Error("Spatial model preparation is no longer pending");
                this.pending = undefined;
                for (const [source, gpu] of assets) this.assets.set(source, gpu);
                this.active = new Set(assets.keys());
                settled = true;
                this.prune();
                assets.clear();
            },
            dispose: () => {
                if (settled || this.pending !== assets) return;
                this.pending = undefined;
                for (const [source, gpu] of assets) if (this.assets.get(source) !== gpu) this.release(gpu);
                settled = true;
                this.prune();
                assets.clear();
            },
        });
    }
    private uploadMissing(sources: Set<SpatialModelAsset>) {
        const assets = new Map<SpatialModelAsset, GpuAsset>(), created: GpuAsset[] = [];
        let uploadBytes = 0;
        try {
            for (const source of sources) {
                let gpu = this.assets.get(source) ?? this.pending?.get(source);
                if (!gpu) {
                    gpu = this.upload(source);
                    created.push(gpu);
                    uploadBytes += gpu.uploadBytes;
                }
                assets.set(source, gpu);
            }
            return { assets, uploadBytes };
        } catch (error) {
            for (const gpu of created) this.release(gpu);
            this.drainUploadErrors();
            throw error;
        }
    }
    private prune(): void {
        for (const [source, gpu] of this.assets) if (!this.active.has(source) && !this.pending?.has(source)) {
            this.release(gpu);
            this.assets.delete(source);
        }
    }
    clear(): void { this.finishDraws(); this.active.clear(); this.prune(); }
    private assertAlive(): void { if (this.destroyed) throw Error("Spatial model cache destroyed"); }
    private upload(source: SpatialModelAsset): GpuAsset {
        const gpu: GpuAsset = { source, primitives: [], images: new Map(), bytes: 0, textureBytes: 0, uploadBytes: 0 };
        const gl = this.gl;
        const buffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
        const element = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
        const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
        gl.activeTexture(gl.TEXTURE0);
        const texture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
        const alignment = gl.getParameter(gl.UNPACK_ALIGNMENT) as number;
        const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
        const premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean;
        const unpackBuffer=gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING) as WebGLBuffer|null;
        const rows=[gl.UNPACK_ROW_LENGTH,gl.UNPACK_IMAGE_HEIGHT,gl.UNPACK_SKIP_PIXELS,gl.UNPACK_SKIP_ROWS,gl.UNPACK_SKIP_IMAGES];
        const previousRows=rows.map(p=>gl.getParameter(p) as number);
        try {
            this.checkUploadError();
            gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);
            for(const p of rows)gl.pixelStorei(p,0);
            gl.activeTexture(gl.TEXTURE0);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
            const uses = new Set<number>();
            for (const p of source.primitives) {
                if (p.image !== undefined) uses.add(this.imageKey(p.image, true));
                if (p.normal) uses.add(this.imageKey(p.normal.image, false));
                if (p.emissive) uses.add(this.imageKey(p.emissive.image, true));
            }
            let textureUploadBytes = 0;
            for (const key of uses) {
                const image = source.images[Math.floor(key / 2)];
                const texture = gl.createTexture();
                if (!texture)
                    throw Error("Model texture allocation failed");
                gpu.images.set(key, texture);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texImage2D(gl.TEXTURE_2D, 0, key % 2 ? gl.SRGB8_ALPHA8 : gl.RGBA8, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, image.pixels);
                textureUploadBytes += image.pixels.byteLength;
                gl.generateMipmap(gl.TEXTURE_2D);
                this.checkUploadError();
                let w = image.width, h = image.height;
                for (;;) {
                    gpu.textureBytes += w * h * 4;
                    if (w === 1 && h === 1)
                        break;
                    w = Math.max(1, w >> 1);
                    h = Math.max(1, h >> 1);
                }
            }
            for (const primitive of source.primitives) {
                const vertex = gl.createBuffer(), index = gl.createBuffer();
                if (!vertex || !index) {
                    if (vertex) gl.deleteBuffer(vertex);
                    if (index) gl.deleteBuffer(index);
                    throw Error("Model buffer allocation failed");
                }
                const samplers: WebGLSampler[] = [];
                gpu.primitives.push({ vertex, index, samplers, source: primitive });
                gl.bindBuffer(gl.ARRAY_BUFFER, vertex);
                gl.bufferData(gl.ARRAY_BUFFER, primitive.vertices, gl.STATIC_DRAW);
                // WebGL distinguishes index buffers. Restore the caller VAO's element binding below.
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
                gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, primitive.indices, gl.STATIC_DRAW);
                for (const descriptor of [primitive.sampler, primitive.normal?.sampler, primitive.emissive?.sampler]) {
                    if (!descriptor) continue;
                    const sampler = gl.createSampler();
                    if (!sampler) throw Error("Model sampler allocation failed");
                    samplers.push(sampler);
                    const [min, mag, s, t] = descriptor;
                    for (const [parameter, value] of [[gl.TEXTURE_MIN_FILTER, min], [gl.TEXTURE_MAG_FILTER, mag], [gl.TEXTURE_WRAP_S, s], [gl.TEXTURE_WRAP_T, t]])
                        gl.samplerParameteri(sampler, parameter, value);
                }
                gpu.bytes += primitive.vertices.byteLength + primitive.indices.byteLength;
            }
            this.checkUploadError();
            gpu.uploadBytes = gpu.bytes + textureUploadBytes;
            return gpu;
        }
        catch (error) {
            this.release(gpu);
            // createTexture/createBuffer/createSampler may return null AND leave OUT_OF_MEMORY.
            // Clear failed allocation/cleanup flags too, so the next retry starts cleanly.
            this.drainUploadErrors();
            throw error;
        }
        finally {
            gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,unpackBuffer);
            rows.forEach((p,i)=>gl.pixelStorei(p,previousRows[i]));
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, alignment);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, Number(flip));
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, Number(premultiply));
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, element);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.activeTexture(activeTexture);
        }
    }
    private imageKey(image: number, color: boolean): number { return image * 2 + Number(color); }
    private checkUploadError():void {
        const error=this.gl.getError();
        if(error!==this.gl.NO_ERROR || this.gl.isContextLost()) {
            // A failed texImage2D can also make generateMipmap fail. Drain the cold error flags
            // so stale secondary errors do not reject a later valid upload retry.
            this.drainUploadErrors();
            throw Error(`Model GPU upload failed (WebGL error 0x${error.toString(16)})`);
        }
    }
    private drainUploadErrors(): void {
        for(let i=0;i<16 && this.gl.getError()!==this.gl.NO_ERROR;i++) { /* bounded cold failure cleanup */ }
    }
    /** Prepare only passes that will draw, then upload their packed matrices once before any draw. */
    prepareDraws(frame: Frame | undefined, passes: number, instanceBuffer: WebGLBuffer, stats: SpatialRendererStats): void {
        this.assertAlive();
        this.preparedFrame = undefined;
        this.preparedPasses = 0;
        this.batchCounts.fill(0);
        if (!frame) return;
        if (!Number.isInteger(passes) || passes < 0 || passes > 255 || frame.words.length % 20 || frame.words.length > MODEL_CAPACITY * 20)
            throw Error("Invalid model instance preparation");
        let floats = 0;
        for (let bit = 0; bit < MODEL_PASS_COUNT; bit++) {
            if (!(passes & (1 << bit))) continue;
            for (let i = 0; i < frame.words.length;) {
                if (!(frame.words[i + 2] & (1 << bit))) { i += 20; continue; }
                const first = i, flags = frame.words[i + 1] & 2;
                const gpu = this.assets.get(spatialModelResource(frame.assets.get(frame.words[i])!)!);
                if (!gpu) throw Error("Model instance resource is not prepared");
                let count = 0;
                while (i < frame.words.length) {
                    if (!(frame.words[i + 2] & (1 << bit))) { i += 20; continue; }
                    const next = this.assets.get(spatialModelResource(frame.assets.get(frame.words[i])!)!);
                    if (next !== gpu || (bit === 0 && (frame.words[i + 1] & 2) !== flags)) break;
                    for (let j = 0; j < 16; j++) this.matrices[floats + count * 16 + j] = frame.values[i + 4 + j];
                    count++; i += 20;
                }
                const batch = bit * MODEL_CAPACITY + first / 20;
                this.batchCounts[batch] = count;
                this.batchEnds[batch] = i;
                this.matrixOffsets[batch] = floats * 4;
                // Singletons keep their uniform path and consume no instance upload range.
                if (count > 1) floats += count * 16;
            }
        }
        if (floats) {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, instanceBuffer);
            this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.matrices.subarray(0, floats));
            stats.modelInstanceUploadBytes += floats * 4;
            stats.uploadBytes += floats * 4;
        }
        this.preparedFrame = frame;
        this.preparedPasses = passes;
    }
    /** Do not retain borrowed Wasm views or scene asset handles after the frame. */
    finishDraws(): void { this.preparedFrame = undefined; this.preparedPasses = 0; }
    draw(frame: Frame | undefined, bit: number, u: SpatialGeometryUniforms, stats: SpatialRendererStats, instanceBuffer: WebGLBuffer, receive?: WebGLUniformLocation, material?: ModelMaterialUniforms): void {
        if (!frame) return;
        if (!Number.isInteger(bit) || bit < 0 || bit >= MODEL_PASS_COUNT || frame !== this.preparedFrame || !(this.preparedPasses & (1 << bit)))
            throw Error("Model instance pass is not prepared");
        const gl = this.gl;
        gl.uniform1i(u.mesh, 1);
        gl.activeTexture(gl.TEXTURE0);
        // Prepared batches preserve native visible order, including gaps culled for each face.
        for (let i = 0; i < frame.words.length;) {
            const first = i, batch = bit * MODEL_CAPACITY + first / 20;
            const count = this.batchCounts[batch];
            if (!count) { i += 20; continue; }
            i = this.batchEnds[batch];
            const flags = frame.words[first + 1] & 2;
            const gpu = this.assets.get(spatialModelResource(frame.assets.get(frame.words[first])!)!)!;
            const instanced = count > 1;
            gl.uniform1i(u.instanced, instanced ? 1 : 0);
            if (instanced) {
                gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
                const offset = this.matrixOffsets[batch];
                for (let column = 0; column < 4; column++) {
                    gl.enableVertexAttribArray(6 + column);
                    gl.vertexAttribPointer(6 + column, 4, gl.FLOAT, false, 64, offset + column * 16);
                    gl.vertexAttribDivisor(6 + column, 1);
                }
            } else {
                gl.uniformMatrix4fv(u.model, false, frame.values.subarray(first + 4, first + 20));
                for (let column = 0; column < 4; column++) {
                    gl.disableVertexAttribArray(6 + column);
                    gl.vertexAttribDivisor(6 + column, 0);
                }
            }
            if (receive) gl.uniform1i(receive, flags ? 1 : 0);
            if (bit === 0) stats.visibleModelCount += count;
            for (const p of gpu.primitives) {
                gl.bindBuffer(gl.ARRAY_BUFFER, p.vertex);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.index);
                const stride = p.source.normal ? 48 : 32;
                for (const [location, size, offset] of [[0, 3, 0], [1, 2, 12], [4, 3, 20]]) {
                    gl.enableVertexAttribArray(location);
                    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
                }
                if (p.source.normal) {
                    gl.enableVertexAttribArray(5);
                    gl.vertexAttribPointer(5, 4, gl.FLOAT, false, stride, 32);
                } else gl.disableVertexAttribArray(5);
                gl.disableVertexAttribArray(2);
                gl.disableVertexAttribArray(3);
                // Per-primitive uniforms avoid changing context-global generic attribute values.
                // The enclosing pass no longer needs synchronous getVertexAttrib save/restore.
                gl.uniform4fv(u.modelColor, p.source.color);
                gl.uniform1f(u.modelCutoff, p.source.alphaCutoff);
                if (material) {
                    gl.uniform1i(material.modelUnlit,p.source.unlit?1:0);
                    let samplerIndex = 1;
                    gl.uniform1i(material.hasNormal, p.source.normal ? 1 : 0);
                    gl.uniform1f(material.modelNormalScale, p.source.normal?.scale ?? 1);
                    if (p.source.normal) {
                        gl.activeTexture(gl.TEXTURE2);
                        gl.bindSampler(2, p.samplers[samplerIndex++]);
                        gl.bindTexture(gl.TEXTURE_2D, gpu.images.get(this.imageKey(p.source.normal.image, false))!);
                        stats.textureBindCount++;
                    }
                    gl.uniform1i(material.normalMap, 2);
                    gl.uniform1i(material.hasEmissive, p.source.emissive ? 1 : 0);
                    gl.uniform3fv(material.emissiveFactor, p.source.emissiveFactor);
                    if (p.source.emissive) {
                        gl.activeTexture(gl.TEXTURE4);
                        gl.bindSampler(4, p.samplers[samplerIndex]);
                        gl.bindTexture(gl.TEXTURE_2D, gpu.images.get(this.imageKey(p.source.emissive.image, true))!);
                        stats.textureBindCount++;
                    }
                    gl.uniform1i(material.emissiveMap, 4);

                }
                gl.activeTexture(gl.TEXTURE0);
                gl.bindSampler(0, p.samplers[0]);
                gl.bindTexture(gl.TEXTURE_2D, p.source.image === undefined ? null : gpu.images.get(this.imageKey(p.source.image, true))!);
                gl.uniform1i(u.textured, p.source.image === undefined ? 0 : 1);
                gl.uniform1i(u.flip, 0);
                if (p.source.doubleSided) gl.disable(gl.CULL_FACE);
                else gl.enable(gl.CULL_FACE);
                gl.cullFace(gl.BACK);
                gl.frontFace(gl.CCW);
                if (instanced) gl.drawElementsInstanced(gl.TRIANGLES, p.source.indices.length, gl.UNSIGNED_INT, 0, count);
                else gl.drawElements(gl.TRIANGLES, p.source.indices.length, gl.UNSIGNED_INT, 0);
                stats.drawCalls++;
                stats.textureBindCount++;
                if (bit === 0) {
                    stats.modelDrawCalls++;
                    if (instanced) stats.modelInstancedDrawCalls++;
                    stats.modelTriangleCount += p.source.indices.length / 3 * count;
                    stats.triangleCount += p.source.indices.length / 3 * count;
                }
                else
                    stats.shadowTriangleCount += p.source.indices.length / 3 * count;
            }
        }
        for (let column = 0; column < 4; column++) {
            gl.disableVertexAttribArray(6 + column);
            gl.vertexAttribDivisor(6 + column, 0);
        }
        gl.uniform1i(u.instanced, 0);
        // Do not leave an owned index buffer on the spatial VAO: a later cold scene
        // commit can evict it while another VAO is bound. Restoring that deleted object
        // during the next upload would be INVALID_OPERATION in WebGL.
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
        if (material) {
            gl.uniform1i(material.hasNormal, 0);
            gl.uniform1i(material.hasEmissive, 0);
            gl.uniform3f(material.emissiveFactor, 0, 0, 0);
        }
        gl.disable(gl.CULL_FACE);
        gl.uniform1i(u.mesh, 0);
    }
    resources() {
        let buffers = 0, bytes = 0, textures = 0, textureBytes = 0;
        const add = (a: GpuAsset) => {
            buffers += a.primitives.length * 2; bytes += a.bytes;
            textures += a.images.size; textureBytes += a.textureBytes;
        };
        for (const a of this.assets.values()) add(a);
        if (this.pending) for (const [source, gpu] of this.pending) if (this.assets.get(source) !== gpu) add(gpu);
        return { buffers, bytes, textures, textureBytes };
    }
    private release(a: GpuAsset) { for (const p of a.primitives) {
        this.gl.deleteBuffer(p.vertex);
        this.gl.deleteBuffer(p.index);
        for (const sampler of p.samplers) this.gl.deleteSampler(sampler);
    } for (const t of a.images.values())
        this.gl.deleteTexture(t); }
    destroy(): void {
        if (this.destroyed) return;
        this.finishDraws();
        this.destroyed = true;
        for (const a of new Set([...this.assets.values(), ...this.pending?.values() ?? []])) this.release(a);
        this.assets.clear(); this.active.clear(); this.pending?.clear(); this.pending = undefined;
    }
}
