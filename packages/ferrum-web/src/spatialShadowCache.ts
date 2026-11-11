import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";
import type { SpriteTextureSource } from "./spriteBatch.js";
import { secondSpatialShadowSlot } from "./spatialPointShadows.js";
type ShadowTextures = SpriteTextureSource | { textureRevision(id: number): number | undefined };

// Map bits are independent of native face/model bits: primary, secondary, sun.
export function spatialShadowMaps(frame: SpatialRenderBufferView): number {
    const v = frame.environment?.values;
    return !v || !(v[0] & 1) ? 0 : Number(v[2] >= 0) | (secondSpatialShadowSlot(v) >= 0 ? 2 : 0) | (v[92] > 0 ? 4 : 0);
}
export function spatialShadowModelPasses(maps: number): number {
    return 1 | (maps & 1 ? 126 : 0) | (maps & 2 ? 16128 : 0) | (maps & 4 ? 128 : 0);
}

/** One GPU map's native snapshot; never retains borrowed Wasm views. */
class ShadowMapCache {
    private readonly models = new Uint32Array(1024 * 18);
    private modelWordCount = -1;
    private readonly modelAssets = new Map<number, string>();
    private readonly matrices: Float32Array;
    private readonly light = new Float32Array(4);
    constructor(private readonly owner: number) {
        this.matrices = new Float32Array(owner === 2 ? 16 : 96);
    }
    invalidate(): void { this.modelWordCount = -1; }
    clear(): void { this.invalidate(); this.modelAssets.clear(); }
    private matrixOffset(frame: SpatialRenderBufferView): number {
        return this.owner === 2 ? frame.environment!.shadowMatrices.length - 16 : this.owner * 96;
    }
    private lightOffset(frame: SpatialRenderBufferView): number {
        const v = frame.environment!.values;
        return 12 + (this.owner === 0 ? v[2] : secondSpatialShadowSlot(v)) * 12;
    }
    matches(frame: SpatialRenderBufferView): boolean {
        if (this.modelWordCount < 0) return false;
        const matrices = frame.environment!.shadowMatrices, base = this.matrixOffset(frame);
        for (let i = 0; i < this.matrices.length; i++)
            if (matrices[base + i] !== this.matrices[i]) return false;
        if (this.owner !== 2) {
            const v = frame.environment!.values, start = this.lightOffset(frame);
            for (let i = 0; i < 4; i++) if (v[start + i] !== this.light[i]) return false;
        }
        let offset = 0;
        const packet = frame.models, maskBits = spatialShadowModelPasses(1 << this.owner) & ~1;
        if (packet) for (let i = 0; i < packet.words.length; i += 20) {
            const mask = packet.words[i + 2] & maskBits;
            if (!mask) continue;
            if (offset + 18 > this.modelWordCount || this.models[offset++] !== packet.words[i]
                || this.models[offset++] !== mask || this.modelAssets.get(packet.words[i]) !== packet.assets.get(packet.words[i])?.contentId)
                return false;
            for (let j = 4; j < 20; j++) if (this.models[offset++] !== packet.words[i + j]) return false;
        }
        return offset === this.modelWordCount;
    }
    commit(frame: SpatialRenderBufferView): void {
        this.modelAssets.clear();
        let offset = 0;
        const packet = frame.models, maskBits = spatialShadowModelPasses(1 << this.owner) & ~1;
        if (packet) for (let i = 0; i < packet.words.length; i += 20) {
            const mask = packet.words[i + 2] & maskBits;
            if (!mask) continue;
            this.models[offset++] = packet.words[i]; this.models[offset++] = mask;
            for (let j = 4; j < 20; j++) this.models[offset++] = packet.words[i + j];
            this.modelAssets.set(packet.words[i], packet.assets.get(packet.words[i])!.contentId);
        }
        this.modelWordCount = offset;
        const start = this.matrixOffset(frame);
        this.matrices.set(frame.environment!.shadowMatrices.subarray(start, start + this.matrices.length));
        if (this.owner !== 2) {
            const light = this.lightOffset(frame);
            this.light.set(frame.environment!.values.subarray(light, light + 4));
        }
    }
}

/** GPU-result caches only. Native revisions, matrices and face membership stay authoritative. */
export class SpatialShadowCache {
    private readonly maps = [new ShadowMapCache(0), new ShadowMapCache(1), new ShadowMapCache(2)];
    private terrainRevision = -1;
    private casterRevision = -1;
    private memory?: ArrayBufferLike;
    private offset = -1;
    private terrainLength = -1;
    private readonly textureRevisions = new Map<number, number>();
    private readonly pendingTextures = new Map<number, number>();
    /** Discard cached results without reallocating fixed model/matrix capacity. */
    clear(): void {
        for (const cache of this.maps) cache.clear();
        this.memory = undefined; this.textureRevisions.clear(); this.pendingTextures.clear();
    }
    /** Dirty map bits are invalidated before resource preparation or drawing can fail. */
    prepare(frame: SpatialRenderBufferView, textures: ShadowTextures, readyMaps: number): number {
        const active = spatialShadowMaps(frame), env = frame.environment;
        if (!active) {
            this.clear();
            return 0;
        }
        this.pendingTextures.clear();
        let tracked = env?.shadowSubmission !== undefined;
        if (env) for (const buffer of [frame.terrain, env.shadowCasters]) {
            for (let i = 9; i < buffer.length; i += 33) {
                const id = buffer[i];
                if (id === 16777215 || this.pendingTextures.has(id)) continue;
                const revision = textures.textureRevision?.(id);
                if (revision === undefined) tracked = false;
                else this.pendingTextures.set(id, revision);
            }
        }
        let sameTextures = this.textureRevisions.size === this.pendingTextures.size;
        for (const [id, revision] of this.pendingTextures)
            if (this.textureRevisions.get(id) !== revision) sameTextures = false;
        const sameGeometry = tracked && this.memory === frame.terrain.buffer && this.offset === frame.terrain.byteOffset
            && this.terrainLength === frame.terrain.length && this.terrainRevision === frame.terrainRevision
            && this.casterRevision === env?.shadowSubmission?.revision && sameTextures;
        let dirty = 0;
        for (let owner = 0; owner < 3; owner++) {
            const bit = 1 << owner, cache = this.maps[owner];
            if (!(active & bit)) cache.invalidate();
            else if (!sameGeometry || !(readyMaps & bit) || !cache.matches(frame)) {
                cache.invalidate(); dirty |= bit;
            }
        }
        // Observe shared inputs once. Dirty maps remain invalid until successful commit.
        this.memory = frame.terrain.buffer; this.offset = frame.terrain.byteOffset; this.terrainLength = frame.terrain.length;
        this.terrainRevision = frame.terrainRevision; this.casterRevision = env?.shadowSubmission?.revision ?? -1;
        this.textureRevisions.clear();
        for (const [id, revision] of this.pendingTextures) this.textureRevisions.set(id, revision);
        return dirty;
    }
    commit(frame: SpatialRenderBufferView, maps: number): void {
        for (let owner = 0; owner < 3; owner++) if (maps & (1 << owner)) this.maps[owner].commit(frame);
    }
}
