import type { FerrumRuntime } from "@ferrum2d/ferrum-web/core";
import {
  inspectTileAsset,
  TILE_ASSET_LIMITS,
  tileBundle,
  type PlacementTileAsset,
} from "./placementTileAssets";
import { createPlacementSpriteRevisions } from "./placementSpriteRevisions";
import { placementNormalRead } from "./placementNormalAssets";

type Metadata = Pick<
  ReturnType<typeof import("./placementTileAssets").tileEvidence>,
  | "logicalId"
  | "assetId"
  | "identityDocument"
  | "kind"
  | "levelIndex"
  | "jsonName"
  | "pngName"
  | "jsonSha256"
  | "pngSha256"
  | "width"
  | "height"
  | "tilesetKey"
  | "dependencies"
>;
export interface PlacementTileProjectCatalog {
  format: "ferrum2d.tile-import.project";
  version: 1;
  assets: {
    metadata: Metadata;
    pngUrl: string;
    jsonUrl: string;
    dependencies?: { source: string; jsonUrl: string }[];
  }[];
}
export interface PlacementTileProjectHost {
  readonly project: string;
  load(signal: AbortSignal): Promise<PlacementTileProjectCatalog>;
  save(
    bundle: ReturnType<typeof tileBundle>,
    signal: AbortSignal,
  ): Promise<PlacementTileProjectCatalog>;
}
export function createPlacementTileAssets(
  engine: FerrumRuntime["engine"],
  taken: (id: string) => boolean,
) {
  return createPlacementSpriteRevisions<PlacementTileAsset>(
    engine,
    taken,
    TILE_ASSET_LIMITS,
    (a, b) =>
      a.document === b.document &&
      a.name === b.name &&
      a.kind === b.kind &&
      a.levelIndex === b.levelIndex &&
      a.selection?.key === b.selection?.key &&
      a.jsonSha256 === b.jsonSha256 &&
      a.pngSha256 === b.pngSha256 &&
      JSON.stringify(a.dependencies?.map((d) => [d.source, d.sha256]) ?? []) ===
        JSON.stringify(b.dependencies?.map((d) => [d.source, d.sha256]) ?? []),
  );
}
export function createDesktopTileProjectHost(
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
  project: string,
): PlacementTileProjectHost {
  async function request(
    command: string,
    signal: AbortSignal,
    bundle?: ReturnType<typeof tileBundle>,
  ) {
    signal.throwIfAborted();
    const result = await invoke<PlacementTileProjectCatalog>(command, {
      projectPath: project,
      ...(bundle ? { bundle } : {}),
    });
    signal.throwIfAborted();
    return result;
  }
  return {
    project,
    load: (signal) => request("load_placement_tile_assets", signal),
    save: (bundle, signal) =>
      request("save_placement_tile_assets", signal, bundle),
  };
}
function durable(value: string) {
  if (typeof value !== "string" || !value.length)
    throw Error("Missing durable tile URL");
  const url = new URL(value, location.href);
  if (
    !["http:", "https:", "ferrum-asset:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error("Invalid durable tile URL");
  return url.href;
}
/** Re-import actual source bytes; never trust persisted converted maps or frame evidence. */
export async function readPlacementTileProject(
  value: PlacementTileProjectCatalog,
  document: string,
  project: string,
  signal: AbortSignal,
): Promise<PlacementTileAsset[]> {
  if (
    value?.format !== "ferrum2d.tile-import.project" ||
    value.version !== 1 ||
    !Array.isArray(value.assets) ||
    value.assets.length > TILE_ASSET_LIMITS.entries
  )
    throw Error("Invalid or oversized tile project catalog");
  const result: PlacementTileAsset[] = [],
    ids = new Set<string>();
  let total = 0;
  for (const entry of value.assets) {
    signal.throwIfAborted();
    const meta = entry.metadata;
    if (
      !meta ||
      typeof meta.assetId !== "string" ||
      ids.has(meta.assetId) ||
      typeof meta.identityDocument !== "string" ||
      !meta.identityDocument.length ||
      meta.identityDocument.length > 1024 ||
      !["tiled", "ldtk"].includes(meta.kind) ||
      typeof meta.jsonName !== "string" ||
      typeof meta.pngName !== "string" ||
      !Number.isInteger(meta.levelIndex) ||
      meta.levelIndex < 0 ||
      meta.levelIndex > 63 ||
      (meta.kind === "tiled" && meta.levelIndex !== 0) ||
      (meta.tilesetKey !== undefined &&
        (typeof meta.tilesetKey !== "string" ||
          !meta.tilesetKey.length ||
          meta.tilesetKey.length > 264))
    )
      throw Error("Invalid tile project metadata");
    ids.add(meta.assetId);
    const json = await placementNormalRead(
      await fetch(durable(entry.jsonUrl), { signal, cache: "no-store" }),
      TILE_ASSET_LIMITS.jsonBytes,
    );
    const png = await placementNormalRead(
      await fetch(durable(entry.pngUrl), { signal, cache: "no-store" }),
      TILE_ASSET_LIMITS.pngBytes,
    );
    const dependencyFiles: File[] = [];
    const metas = meta.dependencies ?? [];
    if (
      !Array.isArray(metas) ||
      metas.length > 8 ||
      (entry.dependencies !== undefined &&
        !Array.isArray(entry.dependencies)) ||
      (entry.dependencies?.length ?? 0) !== metas.length
    )
      throw Error("Invalid saved TSJ dependencies");
    let jsonBytes = json.byteLength;
    total += json.byteLength + png.byteLength;
    for (const dep of metas) {
      if (
        !dep ||
        typeof dep.source !== "string" ||
        typeof dep.name !== "string" ||
        typeof dep.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(dep.sha256)
      )
        throw Error("Invalid saved TSJ metadata");
      const matches =
        entry.dependencies?.filter((d) => d.source === dep.source) ?? [];
      if (matches.length !== 1)
        throw Error("Missing or duplicate saved TSJ URL");
      const bytes = await placementNormalRead(
        await fetch(durable(matches[0].jsonUrl), { signal, cache: "no-store" }),
        TILE_ASSET_LIMITS.jsonBytes - jsonBytes,
      );
      jsonBytes += bytes.byteLength;
      total += bytes.byteLength;
      dependencyFiles.push(new File([bytes], dep.name));
    }
    if (total > TILE_ASSET_LIMITS.bytes)
      throw Error("Tile sources exceed 64 MiB");
    const asset = await inspectTileAsset(
      meta.identityDocument,
      meta.logicalId,
      meta.kind,
      meta.levelIndex,
      new File([json], meta.jsonName),
      new File([png], meta.pngName),
      signal,
      meta.tilesetKey,
      dependencyFiles,
    );
    if (
      asset.id !== meta.assetId ||
      asset.jsonSha256 !== meta.jsonSha256 ||
      asset.pngSha256 !== meta.pngSha256 ||
      asset.width !== meta.width ||
      asset.height !== meta.height ||
      JSON.stringify(
        asset.dependencies?.map(({ source, name, sha256 }) => [
          source,
          name,
          sha256,
        ]) ?? [],
      ) !==
        JSON.stringify(
          metas.map(({ source, name, sha256 }) => [source, name, sha256]),
        )
    )
      throw Error("Saved tile source identity differs");
    asset.document = document;
    asset.project = project;
    asset.persisted = true;
    result.push(asset);
  }
  return result;
}
