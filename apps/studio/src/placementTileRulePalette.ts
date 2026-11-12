import { importTiledTilemap, importLDtkTilemap } from "@ferrum2d/ferrum-web/starter-scenes";
import { resolveTileDependencies, tileJson } from "./placementTileDependencies";
import { selectTileSource } from "./placementTileSelection";
import type { PlacementTileAsset } from "./placementTileAssets";

/** Reuse the public importer for named, unused tiles, including collision/height metadata. */
export function tileRulePalette(asset: PlacementTileAsset, names: ReadonlySet<string>) {
  const tiles = { ...asset.imported.tilemap.tiles }, frames = [...asset.frames];
  const missing = [...names].filter(name => !frames.some(frame => frame.id === name));
  if (!missing.length) return { tiles, frames };
  if (frames.length + missing.length > 256) throw Error("Autotile palette exceeds 256 frames");
  const raw = resolveTileDependencies(tileJson(asset.json), asset.kind, asset.dependencies ?? []).input;
  const { set } = selectTileSource(raw, asset.kind, asset.selection?.key, asset.levelIndex);
  const prefix = String(asset.kind === "tiled" ? set.name : set.identifier) + ".";
  const localIds = missing.map(name => {
    const suffix = name.startsWith(prefix) ? name.slice(prefix.length) : "";
    if (name.length > 256 || !/^(0|[1-9][0-9]*)$/.test(suffix) || !Number.isSafeInteger(Number(suffix)))
      throw Error("Autotile unknown frame " + name);
    return Number(suffix);
  });
  let palette: ReturnType<typeof importTiledTilemap> | ReturnType<typeof importLDtkTilemap>;
  if (asset.kind === "tiled") {
    palette = importTiledTilemap({ ...raw, width: missing.length, height: 1, tilesets: [set], layers: [{
      name: "palette", type: "tilelayer", width: missing.length, height: 1, data: localIds.map(id => Number(set.firstgid) + id),
    }] }, {texture: asset.id});
  } else {
    const size = Number(set.tileGridSize), padding = Number(set.padding ?? 0), spacing = Number(set.spacing ?? 0);
    const columns = Math.floor((Number(set.pxWid) - 2 * padding + spacing) / (size + spacing));
    palette = importLDtkTilemap({ ...raw, levels: [{ identifier: "palette", pxWid: missing.length * size, pxHei: size, layerInstances: [{
      __identifier: "palette", __type: "Tiles", __cWid: missing.length, __cHei: 1, __gridSize: size, __tilesetDefUid: set.uid,
      gridTiles: localIds.map((id, index) => ({t: id, f: 0, px: [index * size, 0], src: [padding + id % columns * (size + spacing), padding + Math.floor(id / columns) * (size + spacing)]})),
    }] }] }, {texture: asset.id});
  }
  let next = Math.max(0, ...Object.keys(tiles).map(Number)) + 1;
  for (const name of missing) {
    const definition = Object.values(palette.tilemap.tiles ?? {}).find(tile => tile.frame === name), frame = palette.atlas.frames?.[name];
    if (!definition || !frame) throw Error("Autotile unknown frame " + name);
    const uv = {u0: frame.uv?.u0 ?? 0, v0: frame.uv?.v0 ?? 0, u1: frame.uv?.u1 ?? 1, v1: frame.uv?.v1 ?? 1};
    const rect = [uv.u0 * asset.width, uv.v0 * asset.height, uv.u1 * asset.width, uv.v1 * asset.height];
    if (rect.some(n => !Number.isFinite(n) || Math.abs(n - Math.round(n)) > 1e-6) || rect[0] < 0 || rect[1] < 0 || rect[2] > asset.width || rect[3] > asset.height || rect[0] >= rect[2] || rect[1] >= rect[3])
      throw Error("Autotile frame must fit the source PNG");
    tiles[String(next++)] = definition;
    frames.push({id: name, width: Math.round(rect[2] - rect[0]), height: Math.round(rect[3] - rect[1]), uv});
  }
  return { tiles, frames };
}
