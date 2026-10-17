import { loadSpatialGlb, type SpatialModelAsset } from "./spatialModel.js";
import { loadSpatialGltf } from "./spatialGltf.js";

export interface SpatialModelAssetSource {
    url: string;
    format: "glb" | "gltf";
    materialProfile: "diffuse";
    /** Expected normalized loader identity. Change this revision or evict unused entries to reload. */
    contentId?: string;
}
export interface SpatialModelAssetCacheOptions {
    /** Includes pending entries. Default 16; maximum 64. */
    maxEntries?: number;
    /** Retained decoded CPU resources, including pinned entries. Default/maximum 128 MiB. */
    maxBytes?: number;
    /** Distinct concurrent downloads/decodes. Default 2; maximum 8. No implicit queue. */
    maxPendingLoads?: number;
}
export interface SpatialModelAssetAcquireOptions { signal?: AbortSignal; }
export interface SpatialModelAssetLease {
    /** Throws after this lease is released. The underlying immutable handle may be shared. */
    readonly asset: SpatialModelAsset;
    release(): void;
}
export interface SpatialModelAssetCacheStats {
    readonly entryCount: number;
    readonly pendingLoadCount: number;
    readonly waitingRequestCount: number;
    readonly activeLeaseCount: number;
    readonly byteLength: number;
    readonly evictionCount: number;
    readonly destroyed: boolean;
}
interface CacheEntry {
    key: string;
    controller: AbortController;
    promise?: Promise<SpatialModelAsset>;
    asset?: SpatialModelAsset;
    users: number;
}
const fail = (message: string): never => { throw Error(`Spatial model cache: ${message}`); };
const cancelled = () => new DOMException("Spatial model cache request cancelled", "AbortError");
const limit = (value: number | undefined, fallback: number, max: number): number => {
    const n = value === undefined ? fallback : value;
    if (!Number.isSafeInteger(n) || n < 1 || n > max) return fail("invalid capacity");
    return n;
};
class ModelLease implements SpatialModelAssetLease {
    #handle: SpatialModelAsset | undefined;
    #release: (() => void) | undefined;
    constructor(asset: SpatialModelAsset, release: () => void) {
        this.#handle = asset; this.#release = release;
    }
    get asset(): SpatialModelAsset { return this.#handle ?? fail("lease released"); }
    release(): void {
        const release = this.#release;
        this.#handle = undefined; this.#release = undefined;
        release?.();
    }
}

/**
 * Cold CPU asset ownership for scene/chunk preloading. Does not activate scenes or own GPU resources.
 * Leases pin entries; unused entries are evicted in least-recently-used order when capacity is needed.
 */
export class SpatialModelAssetCache {
    private readonly entries = new Map<string, CacheEntry>();
    private readonly maxEntries: number;
    private readonly maxBytes: number;
    private readonly maxPendingLoads: number;
    private bytes = 0;
    private waiters = 0;
    private leases = 0;
    private evictions = 0;
    private loads = 0;
    private destroyed = false;

    constructor(options: SpatialModelAssetCacheOptions = {}) {
        this.maxEntries = limit(options.maxEntries, 16, 64);
        this.maxBytes = limit(options.maxBytes, 128 * 1024 * 1024, 128 * 1024 * 1024);
        this.maxPendingLoads = limit(options.maxPendingLoads, 2, 8);
    }

    async acquire(source: SpatialModelAssetSource, options: SpatialModelAssetAcquireOptions = {}): Promise<SpatialModelAssetLease> {
        if (this.destroyed) return fail("destroyed");
        options.signal?.throwIfAborted();
        // Snapshot caller input before the first asynchronous step.
        const { format, materialProfile, contentId } = source;
        if (!["glb", "gltf"].includes(format) || materialProfile !== "diffuse"
            || (contentId !== undefined && (typeof contentId !== "string" || !/^[a-f0-9]{64}$/.test(contentId))))
            return fail("invalid source/profile/contentId");
        if (typeof source.url !== "string" || !source.url.length || source.url.length > 16384) return fail("invalid URL");
        const url = new URL(source.url, globalThis.location?.href);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
            return fail("requires HTTP(S) without credentials or fragments");
        const key = JSON.stringify([format, url.href, contentId ?? null]);
        let entry = this.entries.get(key);
        if (!entry) {
            if (this.loads >= this.maxPendingLoads) return fail("pending load limit");
            if (this.entries.size >= this.maxEntries) {
                const idle = [...this.entries.values()].find(e => e.asset && e.users === 0);
                if (!idle) return fail("entry capacity is pinned");
                this.remove(idle, true);
            }
            entry = { key, controller: new AbortController(), users: 0 };
            this.entries.set(key, entry);
            const pending = entry;
            const load = format === "glb" ? loadSpatialGlb : loadSpatialGltf;
            this.loads++;
            pending.promise = load(url.href, { materialProfile, signal: pending.controller.signal }).then(asset => {
                if (this.destroyed || this.entries.get(key) !== pending || pending.users === 0) throw cancelled();
                if (contentId !== undefined && contentId !== asset.contentId) return fail("contentId mismatch");
                this.admit(pending, asset);
                return asset;
            }).catch(error => {
                this.remove(pending, false);
                throw error;
            }).finally(() => { this.loads--; });
        }
        this.touch(entry);
        return this.wait(entry, options.signal);
    }

    /** Drop only unused ready entries. Registries/other callers may still own their asset handles. */
    evictUnused(): number {
        let count = 0;
        for (const entry of this.entries.values()) if (entry.asset && entry.users === 0) {
            this.remove(entry, true); count++;
        }
        return count;
    }

    stats(): SpatialModelAssetCacheStats {
        return Object.freeze({ entryCount: this.entries.size, pendingLoadCount: this.loads,
            waitingRequestCount: this.waiters, activeLeaseCount: this.leases, byteLength: this.bytes,
            evictionCount: this.evictions, destroyed: this.destroyed });
    }

    /** Cancel waiters and drop cache ownership. Previously delivered leases remain valid until release. */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        const entries = [...this.entries.values()];
        this.entries.clear(); this.bytes = 0;
        for (const entry of entries) entry.controller.abort(cancelled());
    }

    private touch(entry: CacheEntry): void {
        if (this.entries.get(entry.key) !== entry) return;
        this.entries.delete(entry.key); this.entries.set(entry.key, entry);
    }

    private remove(entry: CacheEntry, eviction: boolean): void {
        // A cancelled request may finish after a replacement with the same key has started.
        if (this.entries.get(entry.key) !== entry) return;
        this.entries.delete(entry.key);
        if (entry.asset) this.bytes -= entry.asset.byteLength;
        if (eviction) this.evictions++;
    }

    private admit(entry: CacheEntry, asset: SpatialModelAsset): void {
        let needed = this.bytes + asset.byteLength - this.maxBytes;
        const victims: CacheEntry[] = [];
        if (asset.byteLength > this.maxBytes) return fail("asset exceeds byte capacity");
        for (const candidate of this.entries.values()) {
            if (needed <= 0) break;
            if (candidate !== entry && candidate.asset && candidate.users === 0) {
                victims.push(candidate); needed -= candidate.asset.byteLength;
            }
        }
        if (needed > 0) return fail("byte capacity is pinned");
        for (const victim of victims) this.remove(victim, true);
        entry.asset = asset; this.bytes += asset.byteLength;
        this.touch(entry);
    }

    private releaseUser(entry: CacheEntry): void {
        entry.users--;
        if (entry.users === 0 && !entry.asset && this.entries.get(entry.key) === entry) {
            this.remove(entry, false); entry.controller.abort(cancelled());
        } else if (entry.asset) this.touch(entry);
    }

    private wait(entry: CacheEntry, signal?: AbortSignal): Promise<SpatialModelAssetLease> {
        const promise = entry.promise;
        if (!promise) return fail("missing internal load");
        entry.users++; this.waiters++;
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = () => {
                settled = true; this.waiters--;
                signal?.removeEventListener("abort", abort);
                entry.controller.signal.removeEventListener("abort", abort);
            };
            const abort = () => {
                if (settled) return;
                finish(); this.releaseUser(entry);
                reject(signal?.aborted ? signal.reason : entry.controller.signal.reason);
            };
            signal?.addEventListener("abort", abort, { once: true });
            entry.controller.signal.addEventListener("abort", abort, { once: true });
            promise.then(asset => {
                if (settled) return;
                if (signal?.aborted || entry.controller.signal.aborted) { abort(); return; }
                finish(); this.leases++;
                resolve(Object.freeze(new ModelLease(asset, () => {
                    this.leases--; this.releaseUser(entry);
                })));
            }, error => {
                if (settled) return;
                finish(); this.releaseUser(entry); reject(error);
            });
            if (signal?.aborted || entry.controller.signal.aborted) abort();
        });
    }
}
