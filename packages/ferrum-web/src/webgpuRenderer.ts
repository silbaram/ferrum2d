import "./webgpuTypes.js";
import { WebGpuRendererBackend, type WebGPURendererOptions } from "./webgpuRendererBackend.js";
export { WebGpuCanvasCommitError } from "./webgpuRendererBackend.js";
export type { WebGPURendererOptions } from "./webgpuRendererBackend.js";
import { emptyRendererStats, type Renderer, type RendererStats, type PhysicsDebugLineCamera } from "./renderer.js";
import type { SpatialModelAsset, SpatialModelPreparation } from "./spatialModel.js";
import type { TextureLoadOptions } from "./colorManagement.js";
import type { LightingScene2D } from "./lighting.js";
import type { SpriteMaterialPresetInput } from "./spriteMaterial.js";
import type { PostProcessStackInput } from "./cameraPostProcessing.js";
import type { RenderCommandBufferView, PhysicsDebugLineBufferView } from "./wasmBridge.js";
import type { PixelMaskTerrain, PixelMaskTerrainAlphaPatch, PixelMaskTerrainTextureUploadOptions } from "./pixelMaskTerrain.js";
import { rgbaFromAlpha } from "./webgpuTextureStore.js";
/** Stable renderer facade. GPU objects belong to a replaceable backend; simulation stays in Rust. */
export class WebGPURenderer implements Renderer {
    readonly supportsSpatialScene = true;
    private status: "ready" | "lost" | "recovering" | "destroyed" = "ready";
    private loss?: {
        reason: string;
        message: string;
    };
    private generation = 1;
    private timingFrameOffset = 0;
    private recovering?: Promise<boolean>;
    private recoveryAbort?: AbortController;
    private readonly textures = new Map<number, {
        source: Blob;
        options: TextureLoadOptions;
    } | {
        width: number;
        height: number;
        rgba: Uint8Array;
    }>();
    private readonly textureRequests = new Map<number, number>();
    private requestSerial = 0;
    private readonly preparedModels = new Set<SpatialModelAsset>();
    private visibleModels?: ReadonlyMap<number, SpatialModelAsset>;
    private zoom = 1;
    private groundScale = 1;
    private constructor(private readonly canvas: HTMLCanvasElement, private backend: WebGpuRendererBackend, private options: WebGPURendererOptions) { this.watch(backend); }
    static isSupported(): boolean { return WebGpuRendererBackend.isSupported(); }
    static async create(canvas?: HTMLCanvasElement, options: WebGPURendererOptions = {}): Promise<WebGPURenderer> {
        const settings = structuredClone(options);
        return new WebGPURenderer(canvas!, await WebGpuRendererBackend.create(canvas, settings), settings);
    }
    deviceState(): {
        status: "ready" | "lost" | "recovering" | "destroyed";
        generation: number;
        reason?: string;
        message?: string;
    } {
        return { status: this.status, generation: this.generation, ...this.loss };
    }
    private watch(backend: WebGpuRendererBackend): void {
        const device = backend.gpuDevice();
        void device.lost?.then(info => {
            if (this.status === "destroyed" || backend !== this.backend)
                return;
            this.loss = { reason: info.reason, message: info.message };
            this.timingFrameOffset += backend.gpuTimingStats().currentFrameId ?? 0;
            if (this.status === "ready")
                this.status = "lost";
            backend.destroy();
            device.destroy();
        });
    }
    /** Explicit, coalesced cold recovery. Failed recovery stays lost and may be retried. */
    recoverDevice(): Promise<boolean> {
        this.alive();
        if (this.recovering)
            return this.recovering;
        if (this.status === "ready")
            return Promise.resolve(true);
        this.status = "recovering";
        const abort = this.recoveryAbort = new AbortController();
        this.recovering = this.restore(abort.signal).finally(() => { this.recovering = undefined; this.recoveryAbort = undefined; });
        return this.recovering;
    }
    private async restore(signal: AbortSignal): Promise<boolean> {
        let next: WebGpuRendererBackend | undefined;
        try {
            next = await WebGpuRendererBackend.create(this.canvas, this.options);
            signal.throwIfAborted();
            let lost = false;
            void next.gpuDevice().lost?.then(() => { lost = true; });
            next.setViewportZoom(this.zoom);
            next.setGroundYScale(this.groundScale);
            const restoredIds: number[] = [];
            const resourceDevice=next.gpuDevice();
            resourceDevice.pushErrorScope("validation");resourceDevice.pushErrorScope("out-of-memory");
            try {
            for (const [id, entry] of this.textures) {
                restoredIds.push(id);
                if ("source" in entry) {
                    const url = URL.createObjectURL(entry.source);
                    try {
                        await next.loadTexture(id, url, { ...entry.options, signal });
                    }
                    finally {
                        URL.revokeObjectURL(url);
                    }
                }
                else
                    next.restoreRgbaTexture(id, entry.width, entry.height, entry.rgba);
            }
            // A live scene and its next prepared scene are separate, legal <=16-asset
            // batches. Pin the current scene before warming the next one so neither
            // is pruned, without relaxing the cache's aggregate GPU byte limit.
            const visible = [...new Set(this.visibleModels?.values() ?? [])];
            if (visible.length) {
                await next.preloadSpatialModels(visible);
                const lease = next.prepareSpatialModels(visible);
                try { lease.commit(); } finally { lease.dispose(); }
            }
            if (this.preparedModels.size)
                await next.preloadSpatialModels([...this.preparedModels.values()]);
            await next.gpuDevice().queue.onSubmittedWorkDone();
            } finally {
                const allocation=await resourceDevice.popErrorScope(),validation=await resourceDevice.popErrorScope();
                if(allocation||validation)throw new Error((allocation??validation)!.message);
            }
            signal.throwIfAborted();
            if (lost)
                throw new Error("Replacement WebGPU device was lost during recovery.");
            for (const id of restoredIds)
                if (!this.textures.has(id))
                    next.evictTexture(id);
            this.backend = next;
            this.generation++;
            this.loss = undefined;
            this.status = "ready";
            this.watch(next);
            return true;
        }
        catch (error) {
            if (next) {
                const device = next.gpuDevice();
                next.destroy();
                device.destroy();
            }
            if (this.status !== "destroyed")
                this.status = "lost";
            throw error;
        }
    }
    gpuAdapter(): GPUAdapter { this.ready(); return this.backend.gpuAdapter(); }
    gpuDevice(): GPUDevice { this.ready(); return this.backend.gpuDevice(); }
    prepareSpatialModels(assets: readonly SpatialModelAsset[]): SpatialModelPreparation {
        this.ready();
        const batch = [...assets];
        const backend = this.backend, lease = backend.prepareSpatialModels(batch);
        let done = false;
        return { uploadBytes: lease.uploadBytes, commit: () => { if (done)
                return; this.ready(); if (backend !== this.backend)
                throw new Error("Stale WebGPU preparation."); lease.commit(); this.preparedModels.clear(); for (const a of batch)
                this.preparedModels.add(a); done = true; }, dispose: () => { if (done)
                return; done = true; lease.dispose(); } };
    }
    async preloadSpatialModels(assets: readonly SpatialModelAsset[]): Promise<number> {
        this.ready();
        const batch = [...assets];
        const backend = this.backend, bytes = await backend.preloadSpatialModels(batch);
        this.ready();
        if (backend !== this.backend)
            throw new Error("Stale WebGPU preload.");
        this.preparedModels.clear();
        for (const a of batch)
            this.preparedModels.add(a);
        return bytes;
    }
    async loadTexture(textureId: number, url: string, options?: TextureLoadOptions): Promise<GPUTexture>;
    async loadTexture(url: string, options?: TextureLoadOptions): Promise<GPUTexture>;
    async loadTexture(first: number | string, second?: string | TextureLoadOptions, options: TextureLoadOptions = {}): Promise<GPUTexture> {
        this.ready();
        const backend = this.backend, token = ++this.requestSerial;
        if (typeof first !== "number")
            return backend.loadTexture(first, typeof second === "object" ? second : undefined);
        if (typeof second !== "string")
            throw new Error("loadTexture(textureId, url) requires a texture URL.");
        this.textureRequests.set(first, token);
        try {
            const texture = await backend.loadTexture(first, second, options);
            this.ready();
            if (backend !== this.backend || this.textureRequests.get(first) !== token)
                throw new Error("Stale WebGPU texture load.");
            const { signal: _, ...settings } = options;
            this.textures.set(first, { source: backend.textureSource(first), options: structuredClone(settings) });
            return texture;
        }
        finally {
            if (this.textureRequests.get(first) === token)
                this.textureRequests.delete(first);
        }
    }
    createPixelMaskTerrainTexture(id: number, terrain: PixelMaskTerrain, options: PixelMaskTerrainTextureUploadOptions = {}): GPUTexture {
        this.ready();
        const rgba = rgbaFromAlpha(terrain.width, terrain.height, terrain.data, options), texture = this.backend.createPixelMaskTerrainTexture(id, terrain, options);
        this.textures.set(id, { width: terrain.width, height: terrain.height, rgba });
        return texture;
    }
    updatePixelMaskTerrainTexture(id: number, patch: PixelMaskTerrainAlphaPatch, options: PixelMaskTerrainTextureUploadOptions = {}): void {
        this.ready();
        const entry = this.textures.get(id);
        if (!entry || "source" in entry)
            throw new Error("Pixel mask recovery requires a renderer-owned pixel mask texture.");
        const r = patch.rect;
        if (![r.x, r.y, r.width, r.height].every(Number.isInteger) || r.x < 0 || r.y < 0 || r.width < 1 || r.height < 1 || r.x + r.width > entry.width || r.y + r.height > entry.height)
            throw new Error("Invalid pixel mask recovery patch.");
        const rgba = rgbaFromAlpha(r.width, r.height, patch.alpha, options);
        this.backend.updatePixelMaskTerrainTexture(id, patch, options);
        for (let y = 0; y < patch.rect.height; y++)
            entry.rgba.set(rgba.subarray(y * patch.rect.width * 4, (y + 1) * patch.rect.width * 4), ((patch.rect.y + y) * entry.width + patch.rect.x) * 4);
    }
    evictTexture(id: number): boolean {
        this.alive();
        if (!Number.isInteger(id) || id < 0)
            throw new Error("texture_id must be a non-negative integer.");
        if (id === 0)
            return false;
        const existed = this.textures.delete(id);
        this.textureRequests.delete(id);
        return this.status === "ready" ? this.backend.evictTexture(id) : existed;
    }
    viewportSize(): {
        width: number;
        height: number;
    } { return this.backend.viewportSize(); }
    resourceStats() { return this.backend.resourceStats(); }
    beginGpuTiming(): void { this.alive(); if (this.status === "ready") this.backend.beginGpuTiming(); }
    endGpuTiming(discard = false): void { if (this.status === "ready") this.backend.endGpuTiming(discard); }
    gpuTimingStats(): import("./gpuTiming.js").RendererGpuTimingStats {
        if (this.status !== "ready") return { status: this.status === "destroyed" ? "disabled" : "context-lost", pendingQueryCount: 0 };
        const stats = this.backend.gpuTimingStats();
        return { ...stats,
            ...(stats.currentFrameId === undefined ? {} : { currentFrameId: stats.currentFrameId + this.timingFrameOffset }),
            ...(stats.frameId === undefined ? {} : { frameId: stats.frameId + this.timingFrameOffset }) };
    }
    stats(): RendererStats { return this.status === "ready" ? this.backend.stats() : emptyRendererStats(); }
    setLighting(scene: LightingScene2D | false | undefined): void { this.ready(); this.backend.setLighting(scene); this.options.lighting = structuredClone(scene); }
    setSpriteMaterial(material: SpriteMaterialPresetInput): void { this.ready(); this.backend.setSpriteMaterial(material); this.options.spriteMaterial = structuredClone(material); }
    setPostProcess(post: PostProcessStackInput): void { this.ready(); this.backend.setPostProcess(post); this.options.postProcess = structuredClone(post); }
    setGroundYScale(scale: number): void { this.ready(); this.backend.setGroundYScale(scale); this.groundScale = scale; }
    setViewportZoom(zoom: number): void { this.ready(); this.backend.setViewportZoom(zoom); this.zoom = zoom; }
    resize(): void { this.alive(); if (this.status === "ready")
        this.backend.resize(); }
    render(): void { this.alive(); if (this.status === "ready")
        this.backend.render(); }
    renderCommands(commands: RenderCommandBufferView): RendererStats {
        this.alive();
        if (this.status !== "ready")
            return emptyRendererStats();
        const stats = this.backend.renderCommands(commands);
        this.visibleModels = commands.spatial?.models?.assets;
        this.preparedModels.clear();
        return stats;
    }
    renderPhysicsDebugLines(lines: PhysicsDebugLineBufferView, camera: PhysicsDebugLineCamera): RendererStats { this.alive(); return this.status === "ready" ? this.backend.renderPhysicsDebugLines(lines, camera) : emptyRendererStats(); }
    renderPostProcess(post?: PostProcessStackInput): RendererStats { this.alive(); if (this.status !== "ready")
        return emptyRendererStats(); const stats = this.backend.renderPostProcess(post); if (post !== undefined)
        this.options.postProcess = structuredClone(post); return stats; }
    destroy(): void {
        if (this.status === "destroyed")
            return;
        const device = this.status === "ready" ? this.backend.gpuDevice() : undefined;
        this.status = "destroyed";
        this.recoveryAbort?.abort();
        this.backend.destroy();
        device?.destroy();
        this.textures.clear();
        this.textureRequests.clear();
        this.preparedModels.clear();
        this.visibleModels = undefined;
    }
    private alive(): void { if (this.status === "destroyed")
        throw new Error("WebGPURenderer has been destroyed."); }
    private ready(): void { this.alive(); if (this.status !== "ready")
        throw new Error(`WebGPU device is ${this.status}; call recoverDevice().`); }
}
