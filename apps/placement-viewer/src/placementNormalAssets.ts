import type { FerrumRuntime } from "@ferrum2d/ferrum-web/core";
import {
  createSpriteNormalAssetBinding,
  diagnoseSpriteNormalAssetBinding,
  type SpriteNormalAssetBinding,
  type SpriteNormalTextureAsset,
  type SpriteNormalWorkerResult,
  type SpriteNormalGeneratorSource,
} from "@ferrum2d/ferrum-web/authoring";

export interface PlacementNormalAssetHost {
  generator?: SpriteNormalGeneratorSource;
  /** Must exclusively create files AND register names/color spaces in the project catalog. */
  saveAssets?(
    bundle: PlacementNormalAssetBundle,
    options: { signal: AbortSignal },
  ): Promise<{
    registered: true;
    textures: Record<string, string>;
  }>;
}
export interface PlacementNormalAssetBundle {
  format: "ferrum2d.sprite-normal.assets";
  version: 1;
  overwrite: false;
  document: string;
  binding: SpriteNormalAssetBinding;
  report: Record<string, unknown>;
  metadataJson: string;
  descriptor?: Record<string, unknown>;
  manifest: {
    textures: Record<string, string>;
    textureOptions: Record<string, { colorSpace: "srgb" | "none" }>;
  };
  files: {
    path: string;
    mediaType: "image/png";
    sha256: string;
    base64: string;
  }[];
}
export interface PlacementNormalAsset {
  key: string;
  document: string;
  result: SpriteNormalWorkerResult;
  binding: SpriteNormalAssetBinding;
  measured: SpriteNormalTextureAsset[];
  urls?: Record<string, string>;
  uploaded: boolean;
  persisted: boolean;
  bytes: number;
  pixels: number;
}
export const PLACEMENT_NORMAL_ASSET_LIMITS = {
  entries: 8,
  bytes: 64 * 1024 * 1024,
  pixels: 8_388_608,
} as const;
export async function placementNormalHash(bytes: ArrayBuffer | string) {
  const data =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function placementNormalMeasure(bytes: ArrayBuffer) {
  const bitmap = await createImageBitmap(
    new Blob([bytes], { type: "image/png" }),
  );
  try {
    return {
      width: bitmap.width,
      height: bitmap.height,
      sha256: await placementNormalHash(bytes),
    };
  } finally {
    bitmap.close();
  }
}
export async function placementNormalRead(
  response: Response,
  limit: number,
): Promise<ArrayBuffer> {
  if (!response.ok || !response.body) throw new Error("Asset unavailable");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new Error("Asset exceeds byte limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes.buffer;
}
const binaryBase64 = (bytes: ArrayBuffer) => {
  const view = new Uint8Array(bytes);
  let text = "";
  for (let i = 0; i < view.length; i += 16384)
    text += String.fromCharCode(...view.subarray(i, i + 16384));
  return btoa(text);
};
export function placementNormalAssetBundle(
  asset: PlacementNormalAsset,
): PlacementNormalAssetBundle {
  const { binding, result } = asset,
    color = binding.textures.color.asset,
    normal = binding.textures.normal.asset;
  return {
    format: "ferrum2d.sprite-normal.assets",
    version: 1,
    overwrite: false,
    document: asset.document,
    binding: structuredClone(binding),
    report: structuredClone(result.report),
    metadataJson: result.metadataJson,
    ...(result.descriptor
      ? { descriptor: structuredClone(result.descriptor) }
      : {}),
    manifest: {
      textures: { [color]: color + ".png", [normal]: normal + ".png" },
      textureOptions: {
        [color]: { colorSpace: "srgb" },
        [normal]: { colorSpace: "none" },
      },
    },
    files: [
      {
        path: color + ".png",
        mediaType: "image/png",
        sha256: binding.textures.color.sha256,
        base64: binaryBase64(result.colorPng),
      },
      {
        path: normal + ".png",
        mediaType: "image/png",
        sha256: binding.textures.normal.sha256,
        base64: binaryBase64(result.normalPng),
      },
    ],
  };
}

/** Session asset ownership only. Scene history keeps immutable pairs until the document closes. */
export function createPlacementNormalAssets(
  engine: FerrumRuntime["engine"],
  taken: (id: string) => boolean,
) {
  const entries = new Map<string, PlacementNormalAsset>();
  function discard(asset: PlacementNormalAsset, shuttingDown = false) {
    if (asset.urls) {
      const textures = Object.entries(asset.urls).map(([name, url]) => ({
        kind: "texture" as const,
        name,
        url,
      }));
      try {
        if (asset.uploaded)
          engine.releaseAssets({
            entries: textures,
            textures,
            sounds: [],
            json: [],
            total: textures.length,
          });
      } catch (error) {
        if (!shuttingDown)
          throw error; /* The host may already have destroyed the engine. */
      } finally {
        for (const url of Object.values(asset.urls)) URL.revokeObjectURL(url);
      }
    }
    entries.delete(asset.key);
  }
  return {
    entries: () => [...entries.values()],
    async prepare(
      document: string,
      stem: string,
      result: SpriteNormalWorkerResult,
      signal: AbortSignal,
    ): Promise<{ asset: PlacementNormalAsset; created: boolean }> {
      signal.throwIfAborted();
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(stem))
        throw new Error(
          "Asset name requires 1–64 letters, digits, dots, hyphens or underscores",
        );
      const [color, normal] = await Promise.all([
        placementNormalMeasure(result.colorPng),
        placementNormalMeasure(result.normalPng),
      ]);
      signal.throwIfAborted();
      const digest = await placementNormalHash(
        JSON.stringify([
          document,
          stem,
          color.sha256,
          normal.sha256,
          result.descriptorSha256,
          result.report.config,
        ]),
      );
      signal.throwIfAborted();
      const key = stem + "." + digest.slice(0, 24),
        previous = entries.get(key);
      if (previous) return { asset: previous, created: false };
      const names = { color: key + ".color", normal: key + ".normal" };
      if (Object.values(names).some(taken))
        throw new Error("Asset name conflict. Choose another asset name.");
      const binding = createSpriteNormalAssetBinding({
        report: result.report,
        descriptor: result.descriptor,
        descriptorSha256: result.descriptorSha256,
        colorAsset: names.color,
        normalAsset: names.normal,
      });
      const measured: SpriteNormalTextureAsset[] = [
        { id: names.color, ...color, colorSpace: "srgb" },
        { id: names.normal, ...normal, colorSpace: "none" },
      ];
      const diagnostics = diagnoseSpriteNormalAssetBinding(binding, measured);
      if (diagnostics.length) throw new Error(diagnostics[0].message);
      const bytes = result.colorPng.byteLength + result.normalPng.byteLength,
        pixels = color.width * color.height;
      if (
        entries.size >= PLACEMENT_NORMAL_ASSET_LIMITS.entries ||
        [...entries.values()].reduce((n, a) => n + a.bytes, bytes) >
          PLACEMENT_NORMAL_ASSET_LIMITS.bytes ||
        [...entries.values()].reduce((n, a) => n + a.pixels, pixels) >
          PLACEMENT_NORMAL_ASSET_LIMITS.pixels
      )
        throw new Error(
          "Generated asset budget reached. Close a document to release assets.",
        );
      const asset = {
        key,
        document,
        result,
        binding,
        measured,
        bytes,
        pixels,
        uploaded: false,
        persisted: false,
      };
      entries.set(key, asset);
      return { asset, created: true };
    },
    async upload(asset: PlacementNormalAsset, signal: AbortSignal) {
      if (asset.uploaded) return;
      const color = asset.binding.textures.color.asset,
        normal = asset.binding.textures.normal.asset;
      if (taken(color) || taken(normal))
        throw new Error("Asset name conflict. Existing assets were preserved.");
      asset.urls ??= {
        [color]: URL.createObjectURL(
          new Blob([asset.result.colorPng], { type: "image/png" }),
        ),
        [normal]: URL.createObjectURL(
          new Blob([asset.result.normalPng], { type: "image/png" }),
        ),
      };
      try {
        await engine.loadAssets({
          textures: asset.urls,
          textureOptions: {
            [color]: { colorSpace: "srgb", signal },
            [normal]: { colorSpace: "none", signal },
          },
        });
        if (signal.aborted)
          throw new DOMException("Asset upload cancelled", "AbortError");
        asset.uploaded = true;
      } catch (error) {
        const textures = Object.entries(asset.urls).map(([name, url]) => ({
          kind: "texture" as const,
          name,
          url,
        }));
        engine.releaseAssets({
          entries: textures,
          textures,
          sounds: [],
          json: [],
          total: textures.length,
        });
        for (const url of Object.values(asset.urls)) URL.revokeObjectURL(url);
        asset.urls = undefined;
        throw error;
      }
    },
    discard,
    close(document: string) {
      for (const asset of entries.values())
        if (asset.document === document) discard(asset);
    },
    destroy() {
      for (const asset of entries.values()) discard(asset, true);
    },
  };
}
