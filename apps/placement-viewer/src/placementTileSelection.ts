import {
  readTileDependencies,
  resolveTileDependencies,
  tileJson,
} from "./placementTileDependencies";
import type { TileSourceKind } from "./placementTileAssets";
export interface PlacementTileSourceChoice {
  key: string;
  name: string;
  image: string;
  index: number;
}
export interface PlacementTileSelection {
  key: string;
  name: string;
  sourceTilesets: number;
  omittedTileInstances: number;
}
function fail(message: string): never {
  throw Error("Tile import: " + message);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("expected an object");
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail("expected an array");
  return value;
}
function integer(value: unknown, min: number, max: number) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    fail("invalid tileset integer");
  return value;
}
function sets(root: Record<string, unknown>, kind: TileSourceKind) {
  return array(
    kind === "tiled" ? root.tilesets : object(root.defs).tilesets,
  ).map(object);
}
/** Low-cost metadata only: no PNG decode, network access, or runtime allocation. */
export function tileSourceChoices(
  input: unknown,
  kind: TileSourceKind,
): PlacementTileSourceChoice[] {
  const entries = sets(object(input), kind);
  if (!entries.length || entries.length > 8)
    fail("choose a document with 1..8 embedded tilesets");
  const keys = new Set<string>();
  return entries.map((set, index) => {
    if (kind === "tiled" && set.source !== undefined)
      fail("external tilesets are unsupported; choose embedded tilesets");
    const name = kind === "tiled" ? set.name : set.identifier;
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim() !== name ||
      name.length > 256
    )
      fail("tileset names require 1..256 characters");
    const key =
      kind === "tiled"
        ? `tiled:${name}`
        : `ldtk:${integer(set.uid, 1, Number.MAX_SAFE_INTEGER)}`;
    if (keys.has(key)) fail("duplicate tileset identity");
    keys.add(key);
    const image = kind === "tiled" ? set.image : set.relPath;
    if (typeof image !== "string" || !image.length || image.length > 1024)
      fail("missing tileset image");
    return { key, name, image, index };
  });
}
export async function readTileSourceChoices(
  file: File,
  kind: TileSourceKind,
  signal: AbortSignal,
  files: readonly File[] = [],
) {
  const { json, dependencies } = await readTileDependencies(
    file,
    files,
    signal,
  );
  return tileSourceChoices(
    resolveTileDependencies(tileJson(json), kind, dependencies).input,
    kind,
  );
}
/** Explicit single-PNG projection; original JSON bytes are retained by the owning asset. */
export function selectTileSource(
  root: Record<string, unknown>,
  kind: TileSourceKind,
  key: string | undefined,
  levelIndex: number,
) {
  const choices = tileSourceChoices(root, kind);
  const chosen = key
    ? choices.find((c) => c.key === key)
    : choices.length === 1
      ? choices[0]
      : undefined;
  if (!chosen) fail("choose a tileset present in the source");
  const entries = sets(root, kind),
    set = entries[chosen.index];
  if (choices.length === 1) return { input: root, set, selection: undefined };
  let omittedTileInstances = 0;
  let input: Record<string, unknown>;
  if (kind === "tiled") {
    const ranges = entries
      .map((s, index) => ({
        first: integer(s.firstgid, 1, 0x0fffffff),
        count: integer(s.tilecount, 1, 0x0fffffff),
        index,
      }))
      .sort((a, b) => a.first - b.first);
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (
        r.first + r.count > 0x10000000 ||
        (i && ranges[i - 1].first + ranges[i - 1].count > r.first)
      )
        fail("overlapping tileset GID ranges");
    }
    let layerCount = 0,
      cells = 0;
    const layers = (values: unknown[]): unknown[] => {
      return values.map((value) => {
        if (++layerCount > 16) fail("layer budget exceeds 16");
        const layer = object(value);
        if (layer.type === "group")
          fail("flatten Tiled group layers before importing");
        if (layer.type !== "tilelayer") return layer;
        const data = array(layer.data);
        cells += data.length;
        if (cells > 65_536) fail("cell budget exceeded");
        return {
          ...layer,
          data: data.map((value) => {
            const gid = integer(value, 0, 0xffffffff);
            if ((gid & 0xf0000000) !== 0)
              fail("flipped/rotated tiles are unsupported");
            if (!gid) return 0;
            const owner = ranges.find(
              (r) => gid >= r.first && gid < r.first + r.count,
            );
            if (!owner) fail("tile GID has no tileset");
            if (owner.index === chosen.index) return gid;
            omittedTileInstances++;
            return 0;
          }),
        };
      });
    };
    input = { ...root, tilesets: [set], layers: layers(array(root.layers)) };
  } else {
    const levels = array(root.levels),
      level = object(levels[levelIndex]),
      layers = array(level.layerInstances);
    const known = new Set(
      entries.map((s) => integer(s.uid, 1, Number.MAX_SAFE_INTEGER)),
    );
    let tiles = 0;
    const projected = layers.map((value) => {
      const layer = object(value);
      if (layer.__type === "Entities") return layer;
      let count = 0;
      for (const field of ["gridTiles", "autoLayerTiles"]) {
        const entries = array(layer[field] ?? []);
        count += entries.length;
        tiles += entries.length;
        if (tiles > 65_536) fail("tile instance budget exceeded");
        for (const value of entries)
          if ((object(value).f ?? 0) !== 0)
            fail("flipped/rotated tiles are unsupported");
      }
      if (
        count &&
        !known.has(integer(layer.__tilesetDefUid, 1, Number.MAX_SAFE_INTEGER))
      )
        fail("layer tileset UID was not found");
      if (layer.__tilesetDefUid === set.uid) return layer;
      omittedTileInstances += count;
      return { ...layer, gridTiles: [], autoLayerTiles: [] };
    });
    input = {
      ...root,
      defs: { ...object(root.defs), tilesets: [set] },
      levels: levels.map((value, i) =>
        i === levelIndex ? { ...level, layerInstances: projected } : value,
      ),
    };
  }
  return {
    input,
    set,
    selection: {
      key: chosen.key,
      name: chosen.name,
      sourceTilesets: choices.length,
      omittedTileInstances,
    } satisfies PlacementTileSelection,
  };
}
