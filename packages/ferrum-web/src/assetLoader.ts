import { copyResourceAssetData } from "./nativeFileResourceAssets.js";
import { retainResourceCaptureFence, registerAssetFileOwner, registryFileOwner, captureResourceSource, fileResourceBlob, audioFileOwner, type ResourceAssetData } from "./nativeFileResourceOwners.js";
import { NativeFileResourceError, type ResourceBudget } from "./nativeFileResourceBudget.js";
import { cloneResourceJson,resourceJsonUnchanged } from "./nativeFileResourceJson.js";
import { createAssetLoadScope, runAssetLoadTasks, throwIfAssetLoadAborted } from "./assetLoadTasks.js";
import type { AssetLoadOptions } from "./assetLoadTasks.js";
export type { AssetLoadOptions } from "./assetLoadTasks.js";

import { assetLoadError, describeError } from "./diagnostics.js";
import type { JsonAssetCache } from "./indexedDbAssetCache.js";
import { SoundRegistry } from "./soundRegistry.js";
import { TextureRegistry } from "./textureRegistry.js";
import { resolveTextureColorSpace } from "./colorManagement.js";
import type { TextureLoadOptions } from "./colorManagement.js";

export interface TextureAssetManager {
  loadTexture(textureId: number, url: string, options?: TextureLoadOptions): Promise<unknown>;
  evictTexture?(textureId: number): boolean;
}

export interface SoundAssetManager {
  loadSound(soundId: number, url: string, options?: { signal?: AbortSignal }): Promise<AudioBuffer>;
  evictSound?(soundId: number): boolean;
}

export interface AssetManifest {
  textures?: Record<string, string>;
  /** Per-texture decode metadata. Keys must also appear in textures. */
  textureOptions?: Record<string, TextureLoadOptions>;
  sounds?: Record<string, string>;
  json?: Record<string, string>;
}

export type AssetReleaseKind = "texture" | "sound" | "json";

export interface AssetReleaseEntry {
  kind: AssetReleaseKind;
  name: string;
  url: string;
}

export interface AssetReleasePayload {
  entries: readonly AssetReleaseEntry[];
  textures: readonly AssetReleaseEntry[];
  sounds: readonly AssetReleaseEntry[];
  json: readonly AssetReleaseEntry[];
  total: number;
}

export interface AssetLoadProgress {
  loaded: number;
  total: number;
  ratio?: number;
  elapsedMs?: number;
  kind?: "texture" | "sound" | "json";
  name?: string;
  url?: string;
  cached?: boolean;
}

export type AssetLoadProgressCallback = (progress: AssetLoadProgress) => void;

export interface LoadedAssets {
  textures: TextureRegistry;
  sounds: SoundRegistry;
  json: Record<string, unknown>;
  progress: AssetLoadProgress;
}

export class AssetLoader {
  private fileJson = new Map<string, { url: string; value: unknown; source?: Blob }>();
  private fileRevision = 0;
  private filePending = 0;
  private fileDisposed = false;
  constructor(
    private readonly textureManager: TextureAssetManager,
    private audioManager?: SoundAssetManager,
    private readonly textureRegistry = new TextureRegistry(),
    private readonly soundRegistry = new SoundRegistry(),
    private readonly cache?: JsonAssetCache,
    private readonly cacheVersion = "v1",
    private readonly cacheTtlMs = 24 * 60 * 60 * 1000,
  ) {
    const target=this;
    registerAssetFileOwner(this, {
      capture: budget => this.captureFileAssets(budget),
      textureNamespaceRevision: () => registryFileOwner(this.textureRegistry).revision(),
      captureTextureNamespace: budget => {
        if (this.fileDisposed) budget.fail("STALE", "asset owner disposed");
        if (this.filePending) budget.fail("BUSY", "asset tasks");
        return registryFileOwner(this.textureRegistry).capture(budget);
      }, revision: () => this.fileRevision,
      prepare: (data,budget) => this.prepareFileAssets(data,budget),
      dispose: () => { this.fileDisposed = true; this.fileJson.clear(); this.fileRevision++; },
      replaceAudio: (expected,next) => {
        if(this.fileDisposed||this.filePending||this.audioManager!==expected)throw new NativeFileResourceError("STALE","asset/audio binding");
        // The standard host obtains this object from a sealed AudioManager lease.
        audioFileOwner(next); // Constructor registration proves an actual SDK audio owner.
        this.audioManager=next as SoundAssetManager; // Payload generation is independent; the owner identity is fenced by the session.
      },
      textureOwner: textureManager, get audioOwner() { return target.audioManager; },
    });
  }

  private async captureFileAssets(budget: ResourceBudget): Promise<ResourceAssetData> {
    if (this.fileDisposed) budget.fail("STALE", "asset owner disposed");
    if (this.filePending) budget.fail("BUSY", "asset tasks");
    const revision = this.fileRevision, textureRevision=registryFileOwner(this.textureRegistry).revision(),soundRevision=registryFileOwner(this.soundRegistry).revision();
    const textures = registryFileOwner(this.textureRegistry).capture(budget);
    const sounds = registryFileOwner(this.soundRegistry).capture(budget);
    budget.charge("resources", this.fileJson.size); budget.work(this.fileJson.size);
    // All mutable materialized JSON is cloned synchronously before source reads.
    const records: {name:string;entry:{url:string;value:unknown;source?:Blob};value:import("./nativeFileResourceJson.js").ResourceJson}[] = [], copies=new WeakMap<object,import("./nativeFileResourceJson.js").ResourceJson>();
    for (const [name, entry] of this.fileJson) {
      budget.metadata(name); budget.metadata(entry.url);
      records.push({ name, entry, value: cloneResourceJson(entry.value, budget,0,new Set(),copies) });
    }
    const json = [];
    for (const { name, entry, value } of records) {
      const source = entry.source === undefined ? undefined : await captureResourceSource({ blob: entry.source, url: entry.url }, budget);
      json.push(Object.freeze({ name, url: entry.url, value, ...(source === undefined ? {} : { source }) }));
    }
    if (revision !== this.fileRevision || this.fileDisposed || this.filePending || textureRevision!==registryFileOwner(this.textureRegistry).revision() || soundRevision!==registryFileOwner(this.soundRegistry).revision()) budget.fail("STALE", "asset capture");
    const assertCurrent=(b:ResourceBudget)=>{if(revision!==this.fileRevision||this.fileDisposed||this.filePending||this.fileJson.size!==records.length||textureRevision!==registryFileOwner(this.textureRegistry).revision()||soundRevision!==registryFileOwner(this.soundRegistry).revision())return b.fail("STALE","asset owner cut");
      const aliases=new Map<object,object>(),reverse=new Map<object,object>();b.work(records.length);for(const row of records)if(this.fileJson.get(row.name)!==row.entry||!resourceJsonUnchanged(row.entry.value,row.value,b,aliases,reverse))return b.fail("STALE","mutable JSON owner cut");};assertCurrent(budget);
    const data=Object.freeze({ generation:revision,textures, sounds, json: Object.freeze(json) });retainResourceCaptureFence(data,assertCurrent);return data;
  }

  private async prepareFileAssets(input:ResourceAssetData,budget:ResourceBudget) {
    if(this.fileDisposed||this.filePending)budget.fail("BUSY","asset target lifecycle");
    const revision=this.fileRevision,data=copyResourceAssetData(input,budget);
    const textures=registryFileOwner(this.textureRegistry).prepare(data.textures,budget),sounds=registryFileOwner(this.soundRegistry).prepare(data.sounds,budget);
    const records=new Map<string,{url:string;value:unknown;source?:Blob}>(),sources=new Map<object,Blob>();
    try {
      budget.work(data.json.length);budget.charge("metadataBytes",data.json.length*24);
      for(const row of data.json){let source;if(row.source){source=sources.get(row.source);if(!source){source=fileResourceBlob(row.source.bytes,row.source.mime,budget);sources.set(row.source,source);}}
        records.set(row.name,{url:row.url,value:row.value,...(source===undefined?{}:{source})});}
      let adopted=false,disposed=false;
      return Object.freeze({owner:this,savedOrigin:Object.freeze({version:1 as const,generation:data.generation,resourceGenerations:Object.freeze([])}),runtimeGeneration:()=>this.fileRevision,
        adopt:()=>{
          if(adopted||disposed||this.fileDisposed||this.filePending||revision!==this.fileRevision)throw new NativeFileResourceError("STALE","asset adoption");
          textures.assertCurrent();sounds.assertCurrent();textures.adopt();sounds.adopt();this.fileJson=records;this.fileRevision++;adopted=true;
        },dispose:()=>{if(!adopted&&!disposed){disposed=true;textures.dispose();sounds.dispose();records.clear();}}
      });
    }catch(error){textures.dispose();sounds.dispose();records.clear();throw error;}
  }

  async loadAssets(
    manifest: AssetManifest,
    onProgress?: AssetLoadProgressCallback,
    options: AssetLoadOptions = {},
  ): Promise<LoadedAssets> {
    validateAssetTextureOptions(manifest);
    this.filePending++; this.fileRevision++;
    try {
    const startedAtMs = nowMs();
    const textureEntries = Object.entries(manifest.textures ?? {});
    const soundEntries = Object.entries(manifest.sounds ?? {});
    const jsonEntries = Object.entries(manifest.json ?? {});
    const total = textureEntries.length + soundEntries.length + jsonEntries.length;
    let loaded = 0;
    const json: Record<string, unknown> = {};

    const emitProgress = (progress: Omit<AssetLoadProgress, "loaded" | "total"> = {}): void => {
      onProgress?.({
        loaded,
        total,
        ratio: total <= 0 ? 1 : loaded / total,
        elapsedMs: nowMs() - startedAtMs,
        ...progress,
      });
    };

    const entries: (AssetReleaseEntry & { textureOptions?: TextureLoadOptions })[] = [
      ...textureEntries.map(([name, url]) => ({ kind: "texture" as const, name, url,
        textureOptions: manifest.textureOptions?.[name] === undefined ? undefined : { ...manifest.textureOptions[name] } })),
      ...soundEntries.map(([name, url]) => ({ kind: "sound" as const, name, url })),
      ...jsonEntries.map(([name, url]) => ({ kind: "json" as const, name, url })),
    ];
    await runAssetLoadTasks(entries, options, async (entry, signal) => {
      const { kind, name, url } = entry;
      let cached: boolean | undefined;
      if (kind === "texture") {
        const scope = createAssetLoadScope(signal, entry.textureOptions?.signal);
        try {
          throwIfAssetLoadAborted(scope.controller.signal);
          const textureId = this.textureRegistry.reserve(name, url);
          await this.textureManager.loadTexture(textureId, url, { ...entry.textureOptions, signal: scope.controller.signal });
          throwIfAssetLoadAborted(scope.controller.signal);
        } catch (error) {
          throwIfAssetLoadAborted(scope.controller.signal);
          throw assetLoadError({ kind, name, url, detail: describeError(error) });
        } finally {
          scope.dispose();
        }
      } else if (kind === "sound") {
        const soundId = this.soundRegistry.reserve(name, url);
        await this.loadSound(name, soundId, url, signal);
      } else {
        const loadedJson = await this.loadJson(name, url, signal);
        throwIfAssetLoadAborted(signal);
        json[name] = loadedJson.value;
        this.fileJson.set(name, { url, value: loadedJson.value, ...(loadedJson.source === undefined ? {} : { source: loadedJson.source }) });
        this.fileRevision++;
        cached = loadedJson.cached;
      }
      throwIfAssetLoadAborted(signal);
      loaded += 1;
      emitProgress({ kind, name, url, ...(cached === undefined ? {} : { cached }) });
    }, emitProgress);

    return {
      textures: this.textureRegistry,
      sounds: this.soundRegistry,
      json,
      progress: { loaded, total, ratio: total <= 0 ? 1 : loaded / total, elapsedMs: nowMs() - startedAtMs },
    };
    } finally { this.filePending--; this.fileRevision++; }
  }

  /** Current owned JSON value, shared with LoadedAssets.json. Missing names
   * return undefined; callers may mutate the retained value in place. */
  getJsonAsset(name: string): unknown {
    if (this.fileDisposed) throw new NativeFileResourceError("STALE", "asset owner disposed");
    return this.fileJson.get(name)?.value;
  }

  textureId(name: string): number {
    return this.textureRegistry.textureId(name);
  }

  textureIds(): TextureRegistry {
    return this.textureRegistry;
  }

  soundId(name: string): number {
    return this.soundRegistry.soundId(name);
  }

  soundIds(): SoundRegistry {
    return this.soundRegistry;
  }

  releaseAssets(assets: AssetReleasePayload): void {
    for (const entry of assets.json) {
      if (entry.kind === "json" && this.fileJson.get(entry.name)?.url === entry.url) {
        this.fileJson.delete(entry.name); this.fileRevision++;
      }
    }
    for (const entry of assets.textures) {
      const texture = entry.kind === "texture" ? this.textureRegistry.tryEntry(entry.name) : undefined;
      if (texture?.url === entry.url) {
        this.textureManager.evictTexture?.(texture.textureId);
      }
    }
    for (const entry of assets.sounds) {
      const sound = entry.kind === "sound" ? this.soundRegistry.tryEntry(entry.name) : undefined;
      if (sound?.url === entry.url) {
        this.audioManager?.evictSound?.(sound.soundId);
      }
    }
  }

  /** @deprecated IndexedDB asset cache는 현재 MVP 범위 밖입니다. 주입된 cache가 있을 때만 위임합니다. */
  async invalidateJsonCache(url: string): Promise<void> {
    await this.cache?.invalidateJson(url, { version: this.cacheVersion });
  }

  private async loadSound(name: string, soundId: number, url: string, signal: AbortSignal): Promise<void> {
    if (!this.audioManager) {
      throw assetLoadError({
        kind: "sound",
        name,
        url,
        detail: "AudioManager is required before loading sound assets",
      });
    }

    try {
      await this.audioManager.loadSound(soundId, url, { signal });
    } catch (error) {
      throwIfAssetLoadAborted(signal);
      throw assetLoadError({
        kind: "sound",
        name,
        url,
        detail: describeError(error),
      });
    }
  }

  private async loadJson(name: string, url: string, signal: AbortSignal): Promise<{ value: unknown; cached: boolean; source?: Blob }> {
    const cached = await this.cache?.getJson(url, { version: this.cacheVersion });
    throwIfAssetLoadAborted(signal);
    if (cached !== undefined && cached !== null) {
      return { value: cached, cached: true };
    }

    let response: Response;
    try {
      response = await fetch(url, { signal });
      throwIfAssetLoadAborted(signal);
    } catch (error) {
      throwIfAssetLoadAborted(signal);
      throw assetLoadError({
        kind: "json",
        name,
        url,
        detail: describeError(error),
      });
    }
    if (!response.ok) {
      throw assetLoadError({
        kind: "json",
        name,
        url,
        detail: `HTTP ${response.status} ${response.statusText}`.trim(),
      });
    }

    try {
      // Standard Response owns an immutable original body. Legacy injected cache
      // values/mocks without a body remain materialized JSON, never fake originals.
      const source = typeof response.blob === "function" ? await response.blob() : undefined;
      const parsed = source === undefined ? await response.json() : JSON.parse(await source.text());
      throwIfAssetLoadAborted(signal);
      await this.cache?.setJson(url, parsed, {
        version: this.cacheVersion,
        ttlMs: this.cacheTtlMs,
        etag: response.headers?.get("etag") ?? undefined,
        lastModified: response.headers?.get("last-modified") ?? undefined,
      });
      return { value: parsed, cached: false, ...(source === undefined ? {} : { source }) };
    } catch (error) {
      throwIfAssetLoadAborted(signal);
      throw assetLoadError({
        kind: "json",
        name,
        url,
        detail: `Invalid JSON: ${describeError(error)}`,
      });
    }
  }
}

export function validateAssetTextureOptions(manifest: AssetManifest): void {
  if (manifest.textureOptions === undefined) return;
  if (!manifest.textureOptions || typeof manifest.textureOptions !== "object" || Array.isArray(manifest.textureOptions)) {
    throw new Error("AssetManifest.textureOptions must be an object.");
  }
  for (const [name, options] of Object.entries(manifest.textureOptions)) {
    if (!Object.prototype.hasOwnProperty.call(manifest.textures ?? {}, name)) {
      throw new Error(`AssetManifest.textureOptions.${name} has no matching texture.`);
    }
    resolveTextureColorSpace(options);
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
