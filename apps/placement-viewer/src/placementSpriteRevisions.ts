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
        error("Import budget reached. Close a document to release assets.");
      entries.set(asset.id, asset);
      return asset;
    },
    async upload(asset: T, signal: AbortSignal) {
      while (pending.has(asset.id))
        await pending.get(asset.id)!.catch(() => {});
      signal.throwIfAborted();
      if (disposed || entries.get(asset.id) !== asset)
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
