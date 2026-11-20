/** @internal Actual owner projections. Registrations come from SDK constructors,
 * never from file data or a caller-supplied roster. Not a public package export. */
import { NativeFileResourceError, type ResourceBudget } from "./nativeFileResourceBudget.js";
export interface ResourceSourceBytes {
    readonly mime: string;
    readonly url: string;
    readonly bytes: Uint8Array<ArrayBuffer>;
}
export interface ResourceAudioEntry {
    /** Empty for a still-owned voice buffer replaced/evicted from the ID registry. */
    readonly ids: readonly number[];
    readonly generation: number;
    readonly sampleRate: number;
    readonly frames: number;
    readonly channels: readonly Float32Array<ArrayBuffer>[];
    readonly source?: ResourceSourceBytes;
}
export interface ResourceAudioData {
    readonly generation: number;
    readonly playback: import("./nativeFileResourceAudioPlayback.js").ResourceAudioPlayback;
    readonly entries: readonly ResourceAudioEntry[];
    readonly volumes: readonly [
        number,
        number,
        number,
        number
    ];
}
export interface ResourceSavedOrigin {
    readonly version: 1;
    readonly generation: number;
    readonly contentRevision?: number;
    readonly resourceGenerations: readonly number[];
}
export interface DetachedResourceOwner {
    readonly owner: object;
    /** Saved owner epoch is provenance; the new runtime keeps its own counter. */
    readonly savedOrigin?: ResourceSavedOrigin;
    runtimeGeneration?(): number | string;
    /** Transfer once into the same unpublished target manager used for prepare.
     * Success relinquishes this lease; target/session destruction owns cleanup. */
    adopt?(): void;
    dispose(): void | Promise<void>;
}
export interface ResourceAudioActivation {
    readonly started: number;
    readonly contextState: string;
    readonly waitingForGesture: boolean;
}
export interface DetachedAudioResourceOwner extends DetachedResourceOwner {
    activate(): ResourceAudioActivation;
}
export interface AudioFileOwner {
    capture(budget: ResourceBudget): Promise<ResourceAudioData>;
    prepare(data: ResourceAudioData, budget: ResourceBudget): Promise<DetachedAudioResourceOwner>;
    revision(): number;
}
const audio = new WeakMap<object, AudioFileOwner>();
export function registerAudioFileOwner(owner: object, hooks: AudioFileOwner): void {
    if (audio.has(owner))
        throw new NativeFileResourceError("DATA", "duplicate audio owner");
    audio.set(owner, hooks);
}
export function audioFileOwner(owner: object): AudioFileOwner {
    const hooks = audio.get(owner);
    if (!hooks)
        throw new NativeFileResourceError("CAPABILITY", "audio owner");
    return hooks;
}
interface CapturedBlob {
    readonly bytes: Promise<Uint8Array<ArrayBuffer>>;
    readonly byUrl: Map<string, Promise<ResourceSourceBytes>>;
}
const capturedSources = new WeakMap<ResourceBudget, WeakMap<Blob, CapturedBlob>>();
/** One immutable Blob backing read, with separate provenance records for each
 * actual source URL. Sharing bytes never silently merges distinct metadata. */
export async function captureResourceSource(source: {
    readonly blob: Blob;
    readonly url: string;
}, budget: ResourceBudget): Promise<ResourceSourceBytes> {
    let all = capturedSources.get(budget);
    if (!all) {
        all = new WeakMap();
        capturedSources.set(budget, all);
    }
    let value = all.get(source.blob);
    const previous = value?.byUrl.get(source.url);
    if (previous) return previous;
    // All record metadata and byte/work quotas precede the first Blob read.
    budget.metadata(source.url);
    budget.metadata(source.blob.type);
    budget.work(1);
    if (!value) {
        budget.charge("sourceBytes", source.blob.size);
        budget.work(source.blob.size);
        const bytes = source.blob.arrayBuffer().then(v => new Uint8Array(v), () => budget.fail("ALLOCATION", "source bytes"));
        value = { bytes, byUrl: new Map() };
        all.set(source.blob, value);
    }
    const capturing = value.bytes.then(bytes => Object.freeze({ url: source.url, mime: source.blob.type, bytes }));
    value.byUrl.set(source.url, capturing);
    return capturing;
}
export interface ResourceRegistryData {
    readonly kind: "texture" | "sound";
    readonly nextId: number;
    readonly entries: readonly {
        readonly id: number;
        readonly name: string;
        readonly url: string;
    }[];
}
export interface PreparedResourceRegistry {
    assertCurrent(): void;
    adopt(): void;
    dispose(): void;
}
export interface RegistryFileOwner {
    capture(budget: ResourceBudget): ResourceRegistryData;
    prepare(data: ResourceRegistryData, budget: ResourceBudget): PreparedResourceRegistry;
    revision(): number;
}
const registries = new WeakMap<object, RegistryFileOwner>();
export function registerRegistryFileOwner(owner: object, hooks: RegistryFileOwner): void {
    if (registries.has(owner))
        throw new NativeFileResourceError("DATA", "duplicate registry owner");
    registries.set(owner, hooks);
}
export function registryFileOwner(owner: object): RegistryFileOwner {
    const hooks = registries.get(owner);
    if (!hooks)
        throw new NativeFileResourceError("CAPABILITY", "registry owner");
    return hooks;
}
export interface ResourceJsonEntry {
    readonly name: string;
    readonly url: string;
    readonly value: import("./nativeFileResourceJson.js").ResourceJson;
    readonly source?: ResourceSourceBytes;
}
export interface ResourceAssetData {
    readonly generation: number;
    readonly textures: ResourceRegistryData;
    readonly sounds: ResourceRegistryData;
    readonly json: readonly ResourceJsonEntry[];
}
export interface AssetFileOwner {
    dispose(): void;
    capture(budget: ResourceBudget): Promise<ResourceAssetData>;
    /** Read actual complete reservation namespace, including unloaded IDs. */
    captureTextureNamespace(budget: ResourceBudget): ResourceRegistryData;
    textureNamespaceRevision(): number;
    prepare(data: ResourceAssetData, budget: ResourceBudget): Promise<DetachedResourceOwner>;
    /** Standard host updates this exact actual manager pair after a sealed lease check. */
    replaceAudio(expected: object, next: object): void;
    revision(): number;
    readonly textureOwner: object;
    readonly audioOwner?: object;
}
const assets = new WeakMap<object, AssetFileOwner>();
export function registerAssetFileOwner(owner: object, hooks: AssetFileOwner): void {
    if (assets.has(owner))
        throw new NativeFileResourceError("DATA", "duplicate asset owner");
    assets.set(owner, hooks);
}
export function assetFileOwner(owner: object): AssetFileOwner {
    const hooks = assets.get(owner);
    if (!hooks)
        throw new NativeFileResourceError("CAPABILITY", "asset owner");
    return hooks;
}
export interface ResourceTextureRuntimeInfo {
    readonly width: number;
    readonly height: number;
    readonly colorSpace: "srgb" | "linear" | "none";
    readonly compressed?: boolean;
    readonly alphaMode?: "straight" | "premultiplied";
}
export interface ResourceTextureEntry {
    readonly ids: readonly number[];
    readonly width: number;
    readonly height: number;
    readonly generation: number;
    readonly colorSpace: "srgb" | "linear" | "none";
    readonly alphaMode: "straight" | "premultiplied" | "unknown";
    /** Preserve absence of the old renderer-facing metadata for program uploads. */
    readonly runtimeInfo: boolean;
    /** Actual mutable renderer-facing CPU metadata, distinct from GPU storage. */
    readonly runtimeMetadata?: ResourceTextureRuntimeInfo;
    readonly storage: "rgba8" | "srgb8-alpha8";
    readonly sampler: readonly [
        number,
        number,
        number,
        number
    ];
    readonly pixels: Uint8Array;
    readonly compressed?: {
        readonly format: "astc-4x4" | "bc7" | "etc2-rgba";
        readonly internalFormat: number;
        readonly blocks: Uint8Array;
    };
    readonly source?: ResourceSourceBytes;
}
export interface ResourceTextureData {
    readonly backend: "webgl2" | "webgpu";
    readonly generation: number;
    readonly contentRevision: number;
    readonly colorManagement: "legacy" | "linear-srgb";
    readonly entries: readonly ResourceTextureEntry[];
}
export interface TextureFileOwner {
    capture(budget: ResourceBudget): Promise<ResourceTextureData>;
    prepare(data: ResourceTextureData, budget: ResourceBudget): Promise<DetachedResourceOwner>;
    revision(): number | string;
}
const textureOwners = new WeakMap<object, TextureFileOwner>();
export function registerTextureFileOwner(owner: object, hooks: TextureFileOwner): void {
    if (textureOwners.has(owner))
        throw new NativeFileResourceError("DATA", "duplicate texture owner");
    textureOwners.set(owner, hooks);
}
export function textureFileOwner(owner: object): TextureFileOwner {
    const hooks = textureOwners.get(owner);
    if (!hooks)
        throw new NativeFileResourceError("CAPABILITY", "texture owner");
    return hooks;
}
export interface ResourceFacadeState {
    readonly rustEngine: object;
    readonly assetHost?: object;
    readonly fontFaceSet?: FontFaceSet;
    readonly destroyed: boolean;
    readonly frameInProgress: boolean;
    readonly running: boolean;
}
const facades = new WeakMap<object, () => ResourceFacadeState>();
export function registerResourceFacade(engine: object, inspect: () => ResourceFacadeState): void {
    if (facades.has(engine))
        throw new NativeFileResourceError("DATA", "duplicate facade");
    facades.set(engine, inspect);
}
export function forgetResourceFacade(engine: object): void { facades.delete(engine); }
export function resourceFacadeState(engine: object): ResourceFacadeState {
    const state = facades.get(engine)?.();
    if (!state || state.destroyed)
        throw new NativeFileResourceError("STALE", "facade lifetime");
    return Object.freeze({ ...state });
}
export function inspectResourceFacade(engine: object): ResourceFacadeState {
    const state = resourceFacadeState(engine);
    if (state.frameInProgress || state.running)
        throw new NativeFileResourceError("BUSY", "facade frame/loop");
    return state;
}
const platformAssets = new WeakMap<object, {
    readonly loader: object;
    readonly alive: () => boolean;
    readonly adoptAudio?: (lease: DetachedAudioResourceOwner) => void;
}>();
export function registerPlatformAssetFileOwner(host: object, loader: object, alive: () => boolean, adoptAudio?: (lease: DetachedAudioResourceOwner) => void): void {
    if (platformAssets.has(host))
        throw new NativeFileResourceError("DATA", "duplicate platform host");
    platformAssets.set(host, { loader, alive, adoptAudio });
}
export function forgetPlatformAssetFileOwner(host: object): void { platformAssets.delete(host); }
export function platformAssetFileOwner(host: object): AssetFileOwner {
    const owner = platformAssets.get(host);
    if (!owner || !owner.alive())
        throw new NativeFileResourceError("CAPABILITY", "platform host lifetime/binding");
    return assetFileOwner(owner.loader);
}
/** @internal Root's unpublished standard host only. The host validates its
 * actual AssetLoader/AudioManager pair and the AudioManager's sealed lease. */
export function adoptPlatformFileAudio(host: object, lease: DetachedAudioResourceOwner): void {
    const owner = platformAssets.get(host);
    if (!owner || !owner.alive() || !owner.adoptAudio)
        throw new NativeFileResourceError("CAPABILITY", "standard audio target");
    owner.adoptAudio(lease);
}
/** Charge the additional immutable browser-owned copy before Blob construction. */
export function fileResourceBlob(bytes: Uint8Array, mime: string, budget: ResourceBudget, kind: "sourceBytes" | "decodedBytes" = "sourceBytes"): Blob {
    budget.work(mime.length);
    if (mime !== mime.toLowerCase() || /[^\x20-\x7e]/.test(mime))
        return budget.fail("DATA", "canonical retained Blob MIME");
    const buffer = bytes.buffer;
    if (!(buffer instanceof ArrayBuffer))
        return budget.fail("DATA", "immutable source buffer");
    budget.charge(kind, bytes.byteLength);
    budget.work(bytes.byteLength);
    return new Blob([new Uint8Array(buffer, bytes.byteOffset, bytes.byteLength)], { type: mime });
}
const audioSourceRetainers = new WeakMap<object, (buffer: AudioBuffer, source: Blob, url: string) => void>();
export function registerAudioSourceRetainer(loader: object, retain: (buffer: AudioBuffer, source: Blob, url: string) => void): void {
    if (audioSourceRetainers.has(loader))
        throw new NativeFileResourceError("DATA", "duplicate audio source hook");
    audioSourceRetainers.set(loader, retain);
}
export function audioSourceRetainer(loader: object) { return audioSourceRetainers.get(loader); }
const capturedFences = new WeakMap<object, (budget: ResourceBudget) => void>();
/** Actual capture products only; decoded/caller records cannot invent a fence. */
export function retainResourceCaptureFence(data: object, check: (budget: ResourceBudget) => void): void { capturedFences.set(data, check); }
export function assertResourceCaptureFence(data: object, b: ResourceBudget): void { const check = capturedFences.get(data); if (!check)
    return b.fail("STALE", "actual resource capture fence"); check(b); }
