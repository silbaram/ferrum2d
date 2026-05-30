import { assetPipelineDiagnosticError } from "./diagnostics.js";
import type {
  ShooterAtlasFrameSpec,
  ShooterAtlasSpec,
  ShooterGameSpec,
  ShooterTileSpec,
  ShooterTilemapSpec,
} from "./gameSpec.js";
import type {
  LDtkEntityInstance,
  LDtkTilemapImportOptions,
  LDtkTilemapImportResult,
} from "./assetPipelineTypes.js";
import {
  finiteNumber,
  objectValue,
} from "./assetPipelineValidation.js";
import { LDTK_ROOT_PATH } from "./assetPipelineLDtkConstants.js";
import { ldtkEntityLayer } from "./assetPipelineLDtkEntities.js";
import {
  ldtkAtlasFrameSpec,
  ldtkFrameName,
  ldtkTilesetFrameContext,
} from "./assetPipelineLDtkFrames.js";
import { ldtkLayer } from "./assetPipelineLDtkLayers.js";
import { ldtkLevel } from "./assetPipelineLDtkLevels.js";
import {
  type LDtkTileRef,
  ldtkTilesets,
} from "./assetPipelineLDtkTilesets.js";

export function importLDtkTilemap(
  input: unknown,
  options: LDtkTilemapImportOptions = {},
): LDtkTilemapImportResult {
  const root = objectValue(input, LDTK_ROOT_PATH);
  const tilesets = ldtkTilesets(root.defs, `${LDTK_ROOT_PATH}.defs`);
  const level = ldtkLevel(root, options);
  const collisionLayerNames = new Set(options.collisionLayerNames ?? []);
  const importedTiles = new Map<string, LDtkTileRef>();
  const layers: NonNullable<ShooterTilemapSpec["layers"]> = [];
  const entities: LDtkEntityInstance[] = [];
  const originX = finiteNumber(options.origin?.x, `${LDTK_ROOT_PATH}.origin.x`, 0);
  const originY = finiteNumber(options.origin?.y, `${LDTK_ROOT_PATH}.origin.y`, 0);

  for (const [index, entry] of level.layers.entries()) {
    const path = `${level.path}.layerInstances.${index}`;
    entities.push(...ldtkEntityLayer(entry, {
      path,
      fallbackName: `layer-${index}`,
      layerIndex: index,
      includeHiddenLayers: options.includeHiddenLayers === true,
      originX,
      originY,
    }));
    const imported = ldtkLayer(entry, {
      path,
      fallbackName: `layer-${index}`,
      tilesets,
      includeHiddenLayers: options.includeHiddenLayers === true,
      collisionLayerNames,
      importedTiles,
      originX,
      originY,
    });
    if (imported) {
      layers.push(imported);
    }
  }

  if (layers.length === 0) {
    throw assetPipelineDiagnosticError(`${level.path}.layerInstances`, "must contain at least one supported LDtk tile layer");
  }

  const atlasFrames: Record<string, ShooterAtlasFrameSpec> = {};
  const tiles: Record<string, ShooterTileSpec> = {};
  const usedFrameNames = new Set<string>();
  const tileRefs = [...importedTiles.values()].sort((a, b) => a.gameTileId - b.gameTileId);

  for (const tile of tileRefs) {
    const context = ldtkTilesetFrameContext(tile);
    const frameName = ldtkFrameName(context, options);
    if (usedFrameNames.has(frameName)) {
      throw assetPipelineDiagnosticError(tile.path, `duplicate imported frame name '${frameName}'`);
    }
    usedFrameNames.add(frameName);
    tiles[String(tile.gameTileId)] = {
      frame: frameName,
      ...(tile.heightMetadata ?? {}),
      ...(tile.hd2dMetadata ?? {}),
      ...(tile.slope ? { slope: tile.slope } : {}),
      ...(tile.oneWayPlatform ? { oneWayPlatform: true } : {}),
    };
    atlasFrames[frameName] = ldtkAtlasFrameSpec(tile, context, options);
  }

  const tileWidth = layers[0]?.tileWidth ?? 1;
  const tileHeight = layers[0]?.tileHeight ?? 1;
  const tilemap: ShooterTilemapSpec = {
    tileWidth,
    tileHeight,
    origin: { x: originX, y: originY },
    tiles,
    layers,
  };
  const atlas: ShooterAtlasSpec = { frames: atlasFrames };

  return {
    gameSpec: { atlas, tilemap },
    atlas,
    tilemap,
    usedTileIds: tileRefs.map((tile) => tile.gameTileId),
    layerNames: layers.map((layer, index) => layer.name ?? `layer-${index}`),
    entities,
    tilesetNames: [...new Set(tileRefs.map((tile) => tile.tileset.identifier))],
    levelIdentifier: level.identifier,
    levelIid: level.iid,
    width: level.width,
    height: level.height,
    tileWidth,
    tileHeight,
  };
}

export function importLDtkGameSpec(
  input: unknown,
  options: LDtkTilemapImportOptions = {},
): Pick<ShooterGameSpec, "atlas" | "tilemap"> {
  return importLDtkTilemap(input, options).gameSpec;
}
