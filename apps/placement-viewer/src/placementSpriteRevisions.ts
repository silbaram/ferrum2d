import type { FerrumRuntime } from "@ferrum2d/ferrum-web/core";
import { isPlacementProjectAsset } from "./placementAssetScope";

export interface PlacementSpriteRevision {
  id: string;
  document: string;
  name: string;
  png: ArrayBuffer;
  bytes: number;
  uploaded: boolean;
  url?: string;
  persisted?: boolean;
  project?: string;
}
const error = (message: string): never => {
  throw Error(message);
};

/** Revisions are immutable so earlier scene/history references continue to render. */
export function createPlacementSpriteRevisions<
  T extends PlacementSpriteRevision,
>(
  engine: FerrumRuntime["engine"],
  taken: (id: string) => boolean,
  limits: { entries: number; bytes: number },
  equivalent: (a: T, b: T) => boolean = (a, b) => a.id === b.id,
) {
  const entries = new Map<string, T>();
  const pending = new Map<string, Promise<void>>();
  let disposed = false;
  let collecting = false;
  function release(asset: T, expectedUrl?: string, finishAttempt = false) {
    // close() can revoke the URL before an async loader allocates its texture.
    // An upload attempt still owns this name until its pending promise settles.
    const url = asset.url ?? (finishAttempt ? expectedUrl : undefined);
    if (!url || (expectedUrl !== undefined && url !== expectedUrl)) return;
    const textures = [{ kind: "texture" as const, name: asset.id, url }];
    try {
      engine.releaseAssets({
        entries: textures,
        textures,
        sounds: [],
        json: [],
        total: 1,
      });
    } finally {
      URL.revokeObjectURL(url);
      if (asset.url === url) {
        asset.url = undefined;
        asset.uploaded = false;
      }
    }
  }
  return {
    entries: () => [...entries.values()],
    adopt(asset: T) {
      if (disposed) error("Import store closed");
      if (collecting) error("Import cleanup is in progress");
      const old =
        entries.get(asset.id) ??
        [...entries.values()].find((entry) => equivalent(entry, asset));
      if (old) return old;
      if (taken(asset.id))
        error("Asset name conflict. Existing assets were preserved.");
      if (
        entries.size >= limits.entries ||
        [...entries.values()].reduce((sum, a) => sum + a.bytes, asset.bytes) >
          limits.bytes
      )
        error("Import budget reached. Clean unused revisions or close a document.");
      entries.set(asset.id, asset);
      return asset;
    },
    async upload(asset: T, signal: AbortSignal) {
      while (pending.has(asset.id))
        await pending.get(asset.id)!.catch(() => {});
      signal.throwIfAborted();
      if (disposed || collecting || entries.get(asset.id) !== asset)
        error("Import revision closed");
      if (asset.uploaded) return asset.url!;
      if (taken(asset.id))
        error("Asset name conflict. Existing assets were preserved.");
      asset.url = URL.createObjectURL(
        new Blob([asset.png], { type: "image/png" }),
      );
      const uploadUrl = asset.url;
      const task = (async () => {
        try {
          await engine.loadAssets({
            textures: { [asset.id]: uploadUrl },
            textureOptions: { [asset.id]: { colorSpace: "srgb", signal } },
          });
          signal.throwIfAborted();
          if (disposed || entries.get(asset.id) !== asset)
            error("Import revision closed");
          asset.uploaded = true;
        } catch (cause) {
          release(asset, uploadUrl, true);
          throw cause;
        }
      })();
      pending.set(asset.id, task);
      try {
        await task;
      } finally {
        if (pending.get(asset.id) === task) pending.delete(asset.id);
      }
      return uploadUrl;
    },
    release,
    /** Explicit session cleanup. Durable revisions require project-wide reference evidence. */
    async collectUnused(retained: ReadonlySet<string>) {
      if (disposed) error("Import store closed");
      if (collecting) error("Import cleanup is in progress");
      const candidates = [...entries.values()].filter(a => !a.persisted && !retained.has(a.id) && !pending.has(a.id));
      const uploaded = candidates.filter(a => a.uploaded && a.url);
      collecting = true;
      try {
        if (uploaded.length) {
          const textures = uploaded.map(a => ({ kind: "texture" as const, name: a.id, url: a.url! }));
          try {
            engine.releaseAssets({ entries: textures, textures, sounds: [], json: [], total: textures.length });
          } catch (cause) {
            // A platform release can fail after releasing an earlier texture. Keep
            // source bytes/URLs and reconstruct all affected renderer resources.
            for (const a of uploaded) {
              if (disposed || entries.get(a.id) !== a || !a.url) continue;
              const url = a.url;
              try {
                await engine.loadAssets({ textures: { [a.id]: url }, textureOptions: { [a.id]: { colorSpace: "srgb" } } });
                if (disposed || entries.get(a.id) !== a) {
                  const textures = [{ kind: "texture" as const, name: a.id, url }];
                  engine.releaseAssets({ entries: textures, textures, sounds: [], json: [], total: 1 });
                }
              } catch {
                // Preserve source bytes for a retry without retaining a dead URL.
                URL.revokeObjectURL(url);
                if (a.url === url) { a.url = undefined; a.uploaded = false; }
              }
            }
            throw cause;
          }
        }
        for (const a of candidates) {
          if (a.url) URL.revokeObjectURL(a.url);
          a.url = undefined; a.uploaded = false; entries.delete(a.id);
        }
        return { removed: candidates.length, bytes: candidates.reduce((sum, a) => sum + a.bytes, 0) };
      } finally { collecting = false; }
    },
    discard(asset: T) {
      if (entries.get(asset.id) !== asset) return;
      release(asset);
      entries.delete(asset.id);
    },
    close(document: string) {
      for (const [id, a] of entries)
        if (a.document === document && !isPlacementProjectAsset(a)) {
          release(a);
          entries.delete(id);
        }
    },
    destroy() {
      disposed = true;
      for (const a of entries.values()) {
        try {
          release(a);
        } catch (cause) {
          // The engine's pagehide hook may already have destroyed the GPU registry.
          // release() still revokes the owned URL in finally.
          if (
            !(cause instanceof Error) ||
            cause.message !== "FerrumEngine has been destroyed."
          )
            throw cause;
        }
      }
      entries.clear();
    },
  };
}
