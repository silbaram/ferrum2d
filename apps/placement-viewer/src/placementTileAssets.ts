import {
  readTileDependencies,
  resolveTileDependencies,
  tileJson,
  type PlacementTileDependency,
} from "./placementTileDependencies";
import {
  importTiledTilemap,
  importLDtkTilemap,
} from "@ferrum2d/ferrum-web/starter-scenes";
import {
  instantiateSceneFragment,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementPatch,
  type ScenePlacementViewerState,
  type ScenePlacementSpriteAsset,
} from "@ferrum2d/ferrum-web/authoring";
import {
  placementNormalHash,
  placementNormalMeasure,
} from "./placementNormalAssets";
import type { PlacementSpriteRevision } from "./placementSpriteRevisions";

import {
  selectTileSource,
  type PlacementTileSelection,
} from "./placementTileSelection";

export const TILE_ASSET_LIMITS = {
  jsonBytes: 1_048_576,
  pngBytes: 16_777_216,
  side: 4096,
  pixels: 4_194_304,
  frames: 256,
  entries: 8,
  bytes: 67_108_864,
  layers: 16,
  cells: 65_536,
} as const;
export type TileSourceKind = "tiled" | "ldtk";
type ImportedMap =
  | ReturnType<typeof importTiledTilemap>
  | ReturnType<typeof importLDtkTilemap>;
export interface PlacementTileAsset extends PlacementSpriteRevision {
  identityDocument: string;
  persisted: boolean;
  project?: string;
  kind: TileSourceKind;
  selection?: PlacementTileSelection;
  dependencies?: PlacementTileDependency[];
  lineage: string;
  levelIndex: number;
  json: ArrayBuffer;
  jsonName: string;
  pngName: string;
  jsonSha256: string;
  pngSha256: string;
  width: number;
  height: number;
  frames: {
    id: string;
    width: number;
    height: number;
    uv: { u0: number; v0: number; u1: number; v1: number };
  }[];
  imported: ImportedMap;
}
function fail(message: string): never {
  throw Error("Tile import: " + message);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("expected a JSON object");
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail("expected an array");
  return value;
}
function integer(value: unknown, min: number, max: number, label: string) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    fail(`${label} must be an integer in [${min}, ${max}]`);
  return value;
}
function preflight(
  root: Record<string, unknown>,
  kind: TileSourceKind,
  levelIndex: number,
  tilesetKey?: string,
) {
  let set: Record<string, unknown>, lineage: unknown[];
  if (kind === "tiled") {
    if (root.infinite === true || root.orientation !== "orthogonal")
      fail("choose a finite orthogonal Tiled map");
    integer(root.width, 1, 256, "map width");
    integer(root.height, 1, 256, "map height");
    let layers = 0,
      cells = 0;
    const visit = (items: unknown[], depth = 0) => {
      if (depth > 8) fail("layer nesting exceeds 8");
      for (const item of items) {
        if (++layers > TILE_ASSET_LIMITS.layers)
          fail("layer budget exceeds 16");
        const layer = record(item);
        if (layer.type === "group") visit(array(layer.layers), depth + 1);
        if (layer.type !== "tilelayer") continue;
        const w = integer(layer.width ?? root.width, 1, 256, "layer width"),
          h = integer(layer.height ?? root.height, 1, 256, "layer height");
        cells += w * h;
        if (
          cells > TILE_ASSET_LIMITS.cells ||
          !Array.isArray(layer.data) ||
          layer.encoding !== undefined ||
          layer.compression !== undefined ||
          layer.chunks !== undefined
        )
          fail("use bounded uncompressed Tiled tile data arrays");
      }
    };
    visit(array(root.layers));
    lineage = [];
  } else {
    const levels = array(root.levels);
    if (levels.length > 64) fail("level budget exceeds 64");
    integer(levelIndex, 0, levels.length - 1, "level index");
    const level = record(levels[levelIndex]);
    if (level.layerInstances === null || level.externalRelPath != null)
      fail("choose an embedded LDtk level; external levels are unsupported");
    const layers = array(level.layerInstances);
    if (layers.length > TILE_ASSET_LIMITS.layers)
      fail("layer budget exceeds 16");
    let cells = 0;
    for (const item of layers) {
      const layer = record(item);
      if (layer.__type === "Entities") continue;
      if (!["Tiles", "AutoLayer"].includes(String(layer.__type)))
        fail("only LDtk Tiles/AutoLayer and entity metadata are supported");
      const w = integer(layer.__cWid, 1, 256, "layer columns"),
        h = integer(layer.__cHei, 1, 256, "layer rows");
      cells += w * h;
      if (cells > TILE_ASSET_LIMITS.cells) fail("LDtk cell budget exceeded");
    }
    lineage = [level.iid ?? level.identifier];
  }
  const selected = selectTileSource(root, kind, tilesetKey, levelIndex);
  set = selected.set;
  lineage = kind === "tiled" ? [kind, set.name] : [kind, set.uid, ...lineage];
  return { ...selected, lineage: JSON.stringify(lineage) };
}

export async function inspectTileAsset(
  document: string,
  name: string,
  kind: TileSourceKind,
  levelIndex: number,
  jsonFile: File,
  pngFile: File,
  signal: AbortSignal,
  tilesetKey?: string,
  externalFiles: readonly File[] = [],
): Promise<PlacementTileAsset> {
  signal.throwIfAborted();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,47}$/.test(name))
    fail(
      "asset name requires 1..48 letters, digits, dots, hyphens or underscores",
    );
  if (
    jsonFile.size > TILE_ASSET_LIMITS.jsonBytes ||
    pngFile.size > TILE_ASSET_LIMITS.pngBytes
  )
    fail("JSON/PNG byte budget exceeded");
  const [{ json, dependencies: rawDependencies }, png] = await Promise.all([
    readTileDependencies(jsonFile, externalFiles, signal),
    pngFile.arrayBuffer(),
  ]);
  signal.throwIfAborted();
  const header = new Uint8Array(png, 0, Math.min(24, png.byteLength));
  if (
    header.length < 24 ||
    [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82].some(
      (v, i) => header[i] !== v,
    )
  )
    fail("choose a PNG tileset");
  const width = integer(
      new DataView(png).getUint32(16),
      1,
      TILE_ASSET_LIMITS.side,
      "PNG width",
    ),
    height = integer(
      new DataView(png).getUint32(20),
      1,
      TILE_ASSET_LIMITS.side,
      "PNG height",
    );
  if (width * height > TILE_ASSET_LIMITS.pixels)
    fail("PNG exceeds 4 megapixels");
  const resolved = resolveTileDependencies(
    tileJson(json),
    kind,
    rawDependencies,
  );
  const dependencies = await Promise.all(
    resolved.dependencies.map(async (d) => ({
      ...d,
      sha256: await placementNormalHash(d.json),
    })),
  );
  signal.throwIfAborted();
  const { set, lineage, input, selection } = preflight(
    resolved.input,
    kind,
    levelIndex,
    tilesetKey,
  );
  const sourceImage = kind === "tiled" ? set.image : set.relPath;
  if (
    typeof sourceImage !== "string" ||
    sourceImage.split(/[\\/]/u).at(-1) !== pngFile.name
  )
    fail("PNG filename differs from tileset image");
  if (
    (kind === "tiled" ? set.imagewidth : set.pxWid) !== width ||
    (kind === "tiled" ? set.imageheight : set.pxHei) !== height
  )
    fail("PNG dimensions differ from tileset metadata");
  const [actual, jsonSha256] = await Promise.all([
    placementNormalMeasure(png),
    placementNormalHash(json),
  ]);
  signal.throwIfAborted();
  if (actual.width !== width || actual.height !== height)
    fail("decoded PNG dimensions differ");
  const digest = await placementNormalHash(
      JSON.stringify([
        document,
        name,
        kind,
        kind === "ldtk" ? levelIndex : 0,
        jsonSha256,
        actual.sha256,
        ...(selection ? [selection.key] : []),
        ...(dependencies.length
          ? [dependencies.map((d) => [d.source, d.sha256])]
          : []),
      ]),
    ),
    id = `tile.${kind}.${name}.${digest.slice(0, 24)}`;
  const imported =
    kind === "tiled"
      ? importTiledTilemap(input, { texture: id })
      : importLDtkTilemap(input, { texture: id, levelIndex });
  const frames = Object.entries(imported.atlas.frames ?? {}).map(
    ([id, frame]) => {
      if (!id.trim() || id.trim() !== id || id.length > 256)
        fail("frame names require 1..256 characters");
      const uv = {
        u0: frame.uv?.u0 ?? 0,
        v0: frame.uv?.v0 ?? 0,
        u1: frame.uv?.u1 ?? 1,
        v1: frame.uv?.v1 ?? 1,
      };
      const [x0, y0, x1, y1] = [
        uv.u0 * width,
        uv.v0 * height,
        uv.u1 * width,
        uv.v1 * height,
      ];
      if (
        ![x0, y0, x1, y1].every((v) => Math.abs(v - Math.round(v)) < 1e-6) ||
        x0 < 0 ||
        y0 < 0 ||
        x1 > width ||
        y1 > height ||
        x1 <= x0 ||
        y1 <= y0
      )
        fail("frame rect must be pixel aligned inside the PNG");
      return {
        id,
        width: Math.round(x1) - Math.round(x0),
        height: Math.round(y1) - Math.round(y0),
        uv,
      };
    },
  );
  if (!frames.length || frames.length > TILE_ASSET_LIMITS.frames)
    fail("import requires 1..256 used tile frames");
  signal.throwIfAborted();
  return {
    document,
    identityDocument: document,
    persisted: false,
    name,
    kind,
    lineage,
    ...(selection ? { selection } : {}),
    ...(dependencies.length ? { dependencies } : {}),
    levelIndex: kind === "ldtk" ? levelIndex : 0,
    id,
    json,
    png,
    jsonName: jsonFile.name,
    pngName: pngFile.name,
    jsonSha256,
    pngSha256: actual.sha256,
    width,
    height,
    frames,
    imported,
    bytes:
      json.byteLength +
      png.byteLength +
      dependencies.reduce((n, d) => n + d.json.byteLength, 0),
    uploaded: false,
  };
}

const uvKey = (frame: Record<string, unknown>) =>
  JSON.stringify(
    [frame.u0 ?? 0, frame.v0 ?? 0, frame.u1 ?? 1, frame.v1 ?? 1].map((v) =>
      Math.fround(Number(v)),
    ),
  );
export function tileComponentPatch(
  document: SceneAuthoringDocumentSpec,
  state: ScenePlacementViewerState,
  revisions: readonly PlacementTileAsset[],
  next: PlacementTileAsset,
  target?: { instance: string; frame: string },
): ScenePlacementPatch {
  const previous = new Map(
      revisions
        .filter(
          (a) =>
            a.document === next.document &&
            a.name === next.name &&
            a.kind === next.kind,
        )
        .map((a) => [a.id, a]),
    ),
    operations: Extract<
      ScenePlacementPatch["operations"][number],
      { kind: "updateComponents" }
    >[] = [];
  for (const instance of instantiateSceneFragment(document.sceneComposition, {
    fragment: state.fragment,
  })) {
    if (!instance.props.components) continue;
    const components = record(instance.props.components);
    if (!components.visual) continue;
    const visual = record(components.visual),
      old = previous.get(String(visual.texture ?? visual.asset));
    if (target ? instance.id !== target.instance : !old || old.id === next.id)
      continue;
    if (visual.kind !== "sprite") fail("choose a sprite instance");
    if (state.lockedInstanceIds.includes(instance.id))
      fail("unlock affected instances before importing");
    if (visual.animation || visual.animationSet || components.sprite)
      fail("animated/legacy sprites require an explicit game-spec migration");
    const billboard = document.spatial?.billboards?.[instance.id];
    if (
      billboard?.normalTexture !== undefined ||
      (billboard?.normalTextureId ?? 0) !== 0
    )
      fail("detach the normal binding before replacing its color atlas");
    let frame = target
      ? next.frames.find((f) => f.id === target.frame)
      : undefined;
    if (!target) {
      if (old!.lineage !== next.lineage)
        fail(
          "tileset or LDtk level identity changed; apply a frame explicitly",
        );
      const matches = old!.frames.filter(
        (f) => uvKey(f.uv) === uvKey(record(visual.frame ?? {})),
      );
      if (matches.length !== 1)
        fail(
          `ambiguous or unknown frame on ${instance.id}; apply a frame explicitly`,
        );
      frame = next.frames.find((f) => f.id === matches[0].id);
      if (!frame) throw Object.assign(new Error("Tile import: missing frame " + matches[0].id + " used by " + instance.id), {
          importSource: { file: next.jsonName, pointer: next.kind === "tiled" ? "/tilesets" : `/levels/${next.levelIndex}/layerInstances`, item: matches[0].id }, assetId: old!.id,
        });
    }
    if (!frame) fail("choose an imported frame");
    operations.push({
      kind: "updateComponents",
      instanceId: instance.id,
      components: {
        ...components,
        visual: {
          ...visual,
          texture: next.id,
          asset: next.id,
          frame: { ...frame.uv },
        },
      } as unknown as (typeof operations)[number]["components"],
    });
  }
  if (!operations.length)
    fail(
      target
        ? "choose a sprite instance in the active fragment"
        : "no previous atlas references in the active fragment",
    );
  return { format: "ferrum2d.scene-placement.patch", version: 2, operations };
}
export function tileProviderAsset(
  asset: PlacementTileAsset,
): ScenePlacementSpriteAsset {
  return {
    id: asset.id,
    label: `${asset.name} (${asset.kind}) @${asset.id.slice(-6)}`,
    width: asset.width,
    height: asset.height,
    thumbnailUrl: asset.url,
    frames: asset.frames.map((f) => ({
      id: f.id,
      width: f.width,
      height: f.height,
      frame: f.uv,
    })),
  };
}
export function tileEvidence(a: PlacementTileAsset) {
  return {
    logicalId: a.name,
    identityDocument: a.identityDocument,
    assetId: a.id,
    kind: a.kind,
    lineage: a.lineage,
    levelIndex: a.levelIndex,
    ...(a.selection
      ? { tilesetKey: a.selection.key, selection: structuredClone(a.selection) }
      : {}),
    ...(a.dependencies?.length
      ? {
          dependencies: a.dependencies.map(({ source, name, sha256 }) => ({
            source,
            name,
            sha256,
          })),
        }
      : {}),
    jsonName: a.jsonName,
    pngName: a.pngName,
    jsonSha256: a.jsonSha256,
    pngSha256: a.pngSha256,
    width: a.width,
    height: a.height,
    frames: structuredClone(a.frames),
    layerNames: [...a.imported.layerNames],
    persisted: a.persisted,
  };
}
export function tileAssetReferenced(
  document: SceneAuthoringDocumentSpec,
  asset: PlacementTileAsset,
) {
  return JSON.stringify(document).includes(JSON.stringify(asset.id));
}
export function tileBundle(
  document: string,
  assets: readonly PlacementTileAsset[],
) {
  const base64 = (bytes: ArrayBuffer) => {
    let text = "";
    const array = new Uint8Array(bytes);
    for (let i = 0; i < array.length; i += 16384)
      text += String.fromCharCode(...array.subarray(i, i + 16384));
    return btoa(text);
  };
  return {
    format: "ferrum2d.tile-import.assets",
    version: 1,
    overwrite: false,
    document,
    revisions: assets.map((a) => ({
      ...tileEvidence(a),
      imported: structuredClone(a.imported),
    })),
    manifest: {
      textures: Object.fromEntries(assets.map((a) => [a.id, a.id + ".png"])),
      textureOptions: Object.fromEntries(
        assets.map((a) => [a.id, { colorSpace: "srgb" }]),
      ),
    },
    files: assets.flatMap((a) => [
      ...(a.dependencies ?? []).map((d, i) => ({
        path: `${a.id}.dep.${i}.tsj`,
        mediaType: "application/json",
        sha256: d.sha256,
        base64: base64(d.json),
      })),
      {
        path: a.id + ".json",
        mediaType: "application/json",
        sha256: a.jsonSha256,
        base64: base64(a.json),
      },
      {
        path: a.id + ".png",
        mediaType: "image/png",
        sha256: a.pngSha256,
        base64: base64(a.png),
      },
    ]),
  };
}
