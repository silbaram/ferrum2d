import { createPlacementSpriteRevisions } from "./placementSpriteRevisions";
import type { FerrumRuntime } from "@ferrum2d/ferrum-web/core";
import {
  instantiateSceneFragment,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementPatch,
  type ScenePlacementViewerState,
  type ScenePlacementSpriteAsset,
} from "@ferrum2d/ferrum-web/authoring";
type ComponentsPatch = Extract<
  ScenePlacementPatch["operations"][number],
  { kind: "updateComponents" }
>["components"];
import { placementNormalHash } from "./placementNormalAssets";
import { asepriteTrimPlan, asepriteRestoredFrames, restoreAsepriteTrim } from "./placementAsepriteTrim";

export const ASEPRITE_LIMITS = {
  jsonBytes: 1_048_576,
  pngBytes: 16_777_216,
  side: 4096,
  pixels: 4_194_304,
  frames: 256,
  entries: 8,
  bytes: 67_108_864,
} as const;
export interface AsepriteFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  uv: { u0: number; v0: number; u1: number; v1: number };
}
export interface PlacementAsepriteAsset {
  document: string;
  identityDocument: string;
  persisted: boolean;
  project?: string;
  name: string;
  id: string;
  jsonName: string;
  pngName: string;
  jsonText: string;
  json: ArrayBuffer;
  png: ArrayBuffer;
  /** Only trimmed imports retain a separate immutable packed source PNG. */
  sourcePng?: { png: ArrayBuffer; sha256: string; width: number; height: number };
  jsonSha256: string;
  pngSha256: string;
  width: number;
  height: number;
  frames: AsepriteFrame[];
  bytes: number;
  url?: string;
  uploaded: boolean;
}
export interface AsepriteDiff {
  added: string[];
  removed: string[];
  changed: string[];
  imageChanged: boolean;
}
const error = (message: string): never => {
  throw new Error(message);
};
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : error("Expected an Aseprite JSON object");
const integer = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max
    ? v
    : error("Frame dimensions must be bounded integers");
const uvKey = (uv: AsepriteFrame["uv"]) =>
  JSON.stringify([uv.u0 ?? 0, uv.v0 ?? 0, uv.u1 ?? 1, uv.v1 ?? 1]);
export function asepriteDiff(
  previous: PlacementAsepriteAsset | undefined,
  next: PlacementAsepriteAsset,
): AsepriteDiff {
  const old = new Map(previous?.frames.map((f) => [f.id, f]) ?? []),
    current = new Map(next.frames.map((f) => [f.id, f]));
  return {
    added: next.frames.filter((f) => !old.has(f.id)).map((f) => f.id),
    removed: [...old.keys()].filter((id) => !current.has(id)),
    changed: next.frames
      .filter(
        (f) =>
          old.has(f.id) && JSON.stringify(old.get(f.id)) !== JSON.stringify(f),
      )
      .map((f) => f.id),
    imageChanged: previous?.pngSha256 !== next.pngSha256,
  };
}
export async function inspectAseprite(
  document: string,
  name: string,
  jsonFile: File,
  pngFile: File,
  signal: AbortSignal,
): Promise<PlacementAsepriteAsset> {
  signal.throwIfAborted();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,47}$/.test(name))
    error(
      "Asset name requires 1–48 letters, digits, dots, hyphens or underscores",
    );
  if (
    jsonFile.size > ASEPRITE_LIMITS.jsonBytes ||
    pngFile.size > ASEPRITE_LIMITS.pngBytes
  )
    error("Aseprite input exceeds the JSON/PNG byte limit");
  const [jsonBytes, png] = await Promise.all([
    jsonFile.arrayBuffer(),
    pngFile.arrayBuffer(),
  ]);
  const jsonText = new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes);
  signal.throwIfAborted();
  const signature = new Uint8Array(png, 0, Math.min(24, png.byteLength));
  if (
    signature.length < 24 ||
    [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82].some(
      (n, i) => signature[i] !== n,
    )
  )
    error("Choose a valid PNG export");
  const header = new DataView(png),
    width = integer(header.getUint32(16), 1, ASEPRITE_LIMITS.side),
    height = integer(header.getUint32(20), 1, ASEPRITE_LIMITS.side);
  if (width * height > ASEPRITE_LIMITS.pixels)
    error("PNG exceeds the 4 megapixel limit");
  const json: unknown = JSON.parse(jsonText),
    root = record(json),
    meta = record(root.meta),
    size = record(meta.size);
  if (size.w !== width || size.h !== height)
    error("PNG dimensions differ from Aseprite meta.size");
  if (
    typeof meta.image !== "string" ||
    meta.image.split(/[\\/]/u).at(-1) !== pngFile.name
  )
    error("PNG filename differs from Aseprite meta.image");
  const raw = Array.isArray(root.frames)
    ? root.frames.map((v) => [record(v).filename, record(v)] as const)
    : Object.entries(record(root.frames));
  if (!raw.length || raw.length > ASEPRITE_LIMITS.frames)
    error("Aseprite requires 1–256 frames");
  const plan = asepriteTrimPlan(raw, width, height);
  const bitmap = await createImageBitmap(
    new Blob([png], { type: "image/png" }),
  );
  try {
    if (bitmap.width !== width || bitmap.height !== height)
      error("Decoded PNG dimensions differ");
  } finally {
    bitmap.close();
  }
  signal.throwIfAborted();
  const restored = await restoreAsepriteTrim(png, width, height, plan, signal);
  const texturePng = restored ?? png;
  const textureWidth = plan.restored?.width ?? width, textureHeight = plan.restored?.height ?? height;
  const [jsonSha256, sourceSha256] = await Promise.all([
    placementNormalHash(jsonBytes), placementNormalHash(png),
  ]);
  const pngSha256 = restored ? await placementNormalHash(restored) : sourceSha256;
  signal.throwIfAborted();
  const digest = await placementNormalHash(
    JSON.stringify([document, name, jsonSha256, sourceSha256]),
  );
  signal.throwIfAborted();
  const frames = asepriteRestoredFrames(plan).map(frame => ({...frame, uv: {
    u0: frame.x / textureWidth, v0: frame.y / textureHeight,
    u1: (frame.x + frame.width) / textureWidth, v1: (frame.y + frame.height) / textureHeight,
  }}));
  return {
    document,
    identityDocument: document,
    persisted: false,
    name,
    id: "aseprite." + name + "." + digest.slice(0, 24),
    jsonName: jsonFile.name,
    pngName: pngFile.name,
    jsonText,
    json: jsonBytes,
    png: texturePng,
    ...(restored ? { sourcePng: { png, sha256: sourceSha256, width, height } } : {}),
    jsonSha256,
    pngSha256,
    width: textureWidth,
    height: textureHeight,
    frames,
    bytes: texturePng.byteLength + jsonBytes.byteLength + (restored ? png.byteLength : 0),
    uploaded: false,
  };
}

/** Source identity can differ after native project restore; retain its existing revision. */
export function createPlacementAsepriteAssets(
  engine: FerrumRuntime["engine"],
  taken: (id: string) => boolean,
) {
  return createPlacementSpriteRevisions<PlacementAsepriteAsset>(
    engine,
    taken,
    ASEPRITE_LIMITS,
    (entry, asset) =>
      entry.document === asset.document &&
      entry.name === asset.name &&
      entry.jsonSha256 === asset.jsonSha256 &&
      (entry.sourcePng?.sha256 ?? entry.pngSha256) === (asset.sourcePng?.sha256 ?? asset.pngSha256),
  );
}
export function asepriteProviderAsset(
  a: PlacementAsepriteAsset,
): ScenePlacementSpriteAsset {
  return {
    id: a.id,
    label: a.name + " @" + a.id.slice(-6),
    width: a.width,
    height: a.height,
    thumbnailUrl: a.url,
    frames: a.frames.map((f) => ({
      id: f.id,
      width: f.width,
      height: f.height,
      frame: f.uv,
    })),
  };
}

/** Build ordinary component patches; do not invent a second runtime frame schema. */
export function asepriteComponentPatch(
  document: SceneAuthoringDocumentSpec,
  state: ScenePlacementViewerState,
  revisions: readonly PlacementAsepriteAsset[],
  next: PlacementAsepriteAsset,
  target?: { instance: string; frame: string },
  normalTexture?: string,
): ScenePlacementPatch {
  if (
    normalTexture !== undefined &&
    (!normalTexture.trim() || normalTexture.length > 256)
  )
    error("Choose a stable normal texture reference");
  const instances = instantiateSceneFragment(document.sceneComposition, {
      fragment: state.fragment,
    }),
    operations: Extract<
      ScenePlacementPatch["operations"][number],
      { kind: "updateComponents" }
    >[] = [];
  const byAsset = new Map(
    revisions
      .filter((a) => a.name === next.name && a.id !== next.id)
      .map((a) => [a.id, a]),
  );
  for (const instance of instances) {
    if (
      !instance.props.components ||
      typeof instance.props.components !== "object" ||
      Array.isArray(instance.props.components)
    )
      continue;
    const components = record(instance.props.components),
      visualValue = components.visual;
    if (!visualValue || typeof visualValue !== "object") continue;
    const visual = record(visualValue),
      texture = visual.texture ?? visual.asset,
      old = typeof texture === "string" ? byAsset.get(texture) : undefined;
    if (target ? instance.id !== target.instance : !old) continue;
    if (visual.kind !== "sprite") error("Choose a sprite instance");
    if (state.lockedInstanceIds.includes(instance.id))
      error("Unlock affected instances before applying the import");
    if (visual.animation || visual.animationSet || components.sprite)
      error("Animated/legacy sprites require an explicit animation migration");
    const billboard = document.spatial?.billboards?.[instance.id];
    if (normalTexture !== undefined && !billboard)
      error("Normal generation requires HD-2D billboard targets");
    if (
      normalTexture === undefined &&
      (visual.normalTexture !== undefined || billboard?.normalTexture !== undefined ||
        (billboard?.normalTextureId ?? 0) !== 0)
    )
      error("Detach the normal binding before replacing its color atlas");
    let frame: AsepriteFrame | undefined;
    if (target) frame = next.frames.find((f) => f.id === target.frame);
    else if (visual.frame) {
      const oldUv = record(visual.frame) as AsepriteFrame["uv"],
        matches = old!.frames.filter((f) => uvKey(f.uv) === uvKey(oldUv));
      if (matches.length !== 1)
        error(
          "Ambiguous or unknown frame UV on " +
            instance.id +
            ". Apply Frame explicitly.",
        );
      frame = next.frames.find((f) => f.id === matches[0].id);
      if (!frame)
        throw Object.assign(new Error("Missing frame " + matches[0].id + " used by " + instance.id), {
          importSource: { file: next.jsonName, pointer: "/frames", item: matches[0].id }, assetId: old!.id,
        });
    }
    if (target && !frame) error("Choose an imported frame");
    const changed = {
      ...visual,
      texture: next.id,
      asset: next.id,
      ...(frame ? { frame: { ...frame.uv } } : {}),
    };
    operations.push({
      kind: "updateComponents",
      instanceId: instance.id,
      components: { ...components, visual: changed } as ComponentsPatch,
    });
  }
  if (target && !operations.length)
    error("Choose a sprite instance in the active fragment");
  return {
    format: "ferrum2d.scene-placement.patch",
    version: normalTexture ? 3 : 2,
    operations,
    ...(normalTexture
      ? {
          spatial: {
            format: "ferrum2d.scene-spatial.patch" as const,
            version: 4 as const,
            operations: operations.map((op) => ({
              kind: "setBillboardNormalTexture" as const,
              id: op.instanceId,
              changes: { normalTexture },
            })),
          },
        }
      : {}),
  };
}
export function asepriteEvidence(a: PlacementAsepriteAsset) {
  return {
    logicalId: a.name,
    assetId: a.id,
    identityDocument: a.identityDocument,
    jsonName: a.jsonName,
    pngName: a.pngName,
    jsonSha256: a.jsonSha256,
    pngSha256: a.pngSha256,
    ...(a.sourcePng ? {sourcePng:{sha256:a.sourcePng.sha256,width:a.sourcePng.width,height:a.sourcePng.height}} : {}),
    width: a.width,
    height: a.height,
    // Trim evidence follows deterministic atlas placement; UI/tag source order stays in a.frames.
    frames: structuredClone(a.sourcePng ? [...a.frames].sort((left,right)=>left.y-right.y||left.x-right.x) : a.frames),
    persisted: a.persisted,
  };
}
export type PlacementAsepriteEvidence = ReturnType<typeof asepriteEvidence>;
function base64(bytes: ArrayBuffer) {
  let value = "";
  const data = new Uint8Array(bytes);
  for (let i = 0; i < data.length; i += 16384)
    value += String.fromCharCode(...data.subarray(i, i + 16384));
  return btoa(value);
}
export function asepriteBundle(
  document: string,
  assets: readonly PlacementAsepriteAsset[],
) {
  return {
    format: "ferrum2d.aseprite.assets",
    version: 1,
    overwrite: false,
    document,
    revisions: assets.map(asepriteEvidence),
    manifest: {
      textures: Object.fromEntries(assets.map((a) => [a.id, a.id + ".png"])),
      textureOptions: Object.fromEntries(
        assets.map((a) => [a.id, { colorSpace: "srgb" }]),
      ),
    },
    files: assets.flatMap((a) => [
      ...(a.sourcePng ? [{path:a.id+".source.png",mediaType:"image/png",sha256:a.sourcePng.sha256,base64:base64(a.sourcePng.png)}] : []),
      {
        path: a.id + ".png",
        mediaType: "image/png",
        sha256: a.pngSha256,
        base64: base64(a.png),
      },
      {
        path: a.id + ".json",
        mediaType: "application/json",
        sha256: a.jsonSha256,
        base64: base64(a.json),
      },
    ]),
  };
}
