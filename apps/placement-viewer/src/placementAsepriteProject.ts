import {
  inspectAseprite,
  asepriteEvidence,
  ASEPRITE_LIMITS,
  type PlacementAsepriteAsset,
  type PlacementAsepriteEvidence,
  type asepriteBundle,
} from "./placementAsepriteAssets";
import { placementNormalRead } from "./placementNormalAssets";

export type PlacementAsepriteBundle = ReturnType<typeof asepriteBundle>;
export interface PlacementAsepriteProjectCatalog {
  format: "ferrum2d.aseprite.project";
  version: 1;
  assets: {
    metadata: PlacementAsepriteEvidence;
    pngUrl: string;
    jsonUrl: string;
  }[];
}
export interface PlacementAsepriteProjectHost {
  readonly project: string;
  load(signal: AbortSignal): Promise<PlacementAsepriteProjectCatalog>;
  save(
    bundle: PlacementAsepriteBundle,
    signal: AbortSignal,
  ): Promise<PlacementAsepriteProjectCatalog>;
}

type Invoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

/** App-only, bound to a project the desktop host has already authorized. */
export function createDesktopAsepriteProjectHost(
  invoke: Invoke,
  project: string,
): PlacementAsepriteProjectHost {
  async function request(
    command: string,
    signal: AbortSignal,
    bundle?: PlacementAsepriteBundle,
  ) {
    signal.throwIfAborted();
    const result = await invoke<PlacementAsepriteProjectCatalog>(command, {
      projectPath: project,
      ...(bundle ? { bundle } : {}),
    });
    signal.throwIfAborted();
    return result;
  }
  return {
    project,
    load: (signal) => request("load_placement_aseprite_assets", signal),
    save: (bundle, signal) =>
      request("save_placement_aseprite_assets", signal, bundle),
  };
}

function durableUrl(value: string) {
  if (typeof value !== "string" || !value.length)
    throw new Error("Project host must return durable asset URLs");
  const url = new URL(value, location.href);
  if (
    !["http:", "https:", "ferrum-asset:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Project host must return durable asset URLs");
  return url.href;
}

function sameFrames(
  left: PlacementAsepriteEvidence["frames"],
  right: PlacementAsepriteEvidence["frames"],
) {
  return (
    left.length === right.length &&
    left.every((frame, i) => {
      const other = right[i];
      return (
        other &&
        frame.id === other.id &&
        frame.x === other.x &&
        frame.y === other.y &&
        frame.width === other.width &&
        frame.height === other.height &&
        (["u0", "v0", "u1", "v1"] as const).every(
          (key) => frame.uv[key] === other.uv[key],
        )
      );
    })
  );
}

/** Verify source bytes again before trusting the catalog or marking an import durable. */
export async function readPlacementAsepriteProject(
  value: PlacementAsepriteProjectCatalog,
  document: string,
  project: string,
  signal: AbortSignal,
): Promise<PlacementAsepriteAsset[]> {
  if (
    value?.format !== "ferrum2d.aseprite.project" ||
    value.version !== 1 ||
    !Array.isArray(value.assets) ||
    value.assets.length > ASEPRITE_LIMITS.entries
  )
    throw new Error("Invalid or oversized project Aseprite catalog");
  const restored: PlacementAsepriteAsset[] = [],
    ids = new Set<string>();
  let bytes = 0;
  // Bound concurrent PNG decodes and source memory to one atlas at a time.
  for (const entry of value.assets) {
    signal.throwIfAborted();
    const meta = entry.metadata;
    if (
      !meta ||
      typeof meta.logicalId !== "string" ||
      typeof meta.assetId !== "string" ||
      typeof meta.pngSha256 !== "string" ||
      typeof meta.jsonSha256 !== "string" ||
      typeof meta.identityDocument !== "string" ||
      meta.identityDocument.length > 1024 ||
      typeof meta.jsonName !== "string" ||
      typeof meta.pngName !== "string" ||
      !Array.isArray(meta.frames) ||
      meta.frames.length > ASEPRITE_LIMITS.frames ||
      ids.has(meta.assetId)
    )
      throw new Error("Invalid project atlas metadata");
    ids.add(meta.assetId);
    const pngUrl = durableUrl(entry.pngUrl),
      jsonUrl = durableUrl(entry.jsonUrl);
    const json = await placementNormalRead(
      await fetch(jsonUrl, { signal, cache: "no-store" }),
      ASEPRITE_LIMITS.jsonBytes,
    );
    const png = await placementNormalRead(
      await fetch(pngUrl, { signal, cache: "no-store" }),
      ASEPRITE_LIMITS.pngBytes,
    );
    bytes += json.byteLength + png.byteLength;
    if (bytes > ASEPRITE_LIMITS.bytes)
      throw new Error("Project atlas sources exceed 64 MiB");
    const asset = await inspectAseprite(
      meta.identityDocument,
      meta.logicalId,
      new File([json], meta.jsonName, { type: "application/json" }),
      new File([png], meta.pngName, { type: "image/png" }),
      signal,
    );
    const actual = asepriteEvidence(asset);
    if (
      actual.assetId !== meta.assetId ||
      actual.pngSha256 !== meta.pngSha256 ||
      actual.jsonSha256 !== meta.jsonSha256 ||
      actual.width !== meta.width ||
      actual.height !== meta.height ||
      !sameFrames(actual.frames, meta.frames)
    )
      throw new Error("Saved Aseprite source or frame metadata differs");
    asset.document = document;
    asset.project = project;
    asset.persisted = true;
    restored.push(asset);
  }
  return restored;
}
