import { assetPipelineDiagnosticError } from "./diagnostics.js";
import type { ShooterTilemapSpec } from "./gameSpec.js";
import {
  arrayValue,
  finiteNumber,
  nonNegativeInteger,
  objectValue,
  optionalArray,
  optionalBoolean,
  optionalString,
  positiveInteger,
  positiveNumber,
} from "./assetPipelineValidation.js";
import type { JsonRecord } from "./assetPipelineValidation.js";
import { LDTK_RAW_INT_GRID_SOLID_TILE_ID } from "./assetPipelineLDtkConstants.js";
import {
  ldtkGridCoordinate,
  ldtkNumberPair,
} from "./assetPipelineLDtkValues.js";
import {
  type LDtkTileRef,
  type LDtkTileset,
  ldtkImportedTile,
} from "./assetPipelineLDtkTilesets.js";

export function ldtkLayer(
  value: unknown,
  options: {
    path: string;
    fallbackName: string;
    tilesets: Map<number, LDtkTileset>;
    includeHiddenLayers: boolean;
    collisionLayerNames: Set<string>;
    importedTiles: Map<string, LDtkTileRef>;
    originX: number;
    originY: number;
  },
): NonNullable<ShooterTilemapSpec["layers"]>[number] | undefined {
  const layer = objectValue(value, options.path);
  const name = optionalString(layer.__identifier, `${options.path}.__identifier`) ?? options.fallbackName;
  const visible = optionalBoolean(layer.visible, `${options.path}.visible`) ?? true;
  if (!visible && !options.includeHiddenLayers) {
    return undefined;
  }

  const type = optionalString(layer.__type, `${options.path}.__type`) ?? "Tiles";
  if (type !== "Tiles" && type !== "AutoLayer" && type !== "IntGrid") {
    return undefined;
  }

  const tileEntries = ldtkLayerTileEntries(layer, options.path);
  if (tileEntries.length === 0) {
    if (type === "IntGrid") {
      if (options.collisionLayerNames.has(name)) {
        return ldtkRawIntGridLayer(layer, {
          path: options.path,
          name,
          originX: options.originX,
          originY: options.originY,
        });
      }
      return undefined;
    }
    return undefined;
  }

  const columns = positiveInteger(layer.__cWid, `${options.path}.__cWid`);
  const rows = positiveInteger(layer.__cHei, `${options.path}.__cHei`);
  const tileWidth = positiveNumber(layer.__gridSize, `${options.path}.__gridSize`);
  const tileHeight = tileWidth;
  const tilesetUid = positiveInteger(layer.__tilesetDefUid, `${options.path}.__tilesetDefUid`);
  const tileset = options.tilesets.get(tilesetUid);
  if (!tileset) {
    throw assetPipelineDiagnosticError(`${options.path}.__tilesetDefUid`, `tileset uid ${tilesetUid} was not found`);
  }

  const data = Array.from({ length: columns * rows }, () => 0);
  for (const tileEntry of tileEntries) {
    const tile = ldtkTileInstance(tileEntry.value, {
      path: tileEntry.path,
      tileset,
      gridSize: tileWidth,
      columns,
      rows,
      importedTiles: options.importedTiles,
    });
    const cellIndex = tile.row * columns + tile.column;
    if (data[cellIndex] !== 0) {
      throw assetPipelineDiagnosticError(tileEntry.path, "multiple LDtk tiles in the same grid cell are not supported");
    }
    data[cellIndex] = tile.ref.gameTileId;
  }

  return {
    name,
    columns,
    rows,
    tileWidth,
    tileHeight,
    origin: {
      x: options.originX + finiteNumber(layer.__pxTotalOffsetX, `${options.path}.__pxTotalOffsetX`, 0),
      y: options.originY + finiteNumber(layer.__pxTotalOffsetY, `${options.path}.__pxTotalOffsetY`, 0),
    },
    collision: options.collisionLayerNames.has(name),
    data,
  };
}

function ldtkRawIntGridLayer(
  layer: JsonRecord,
  options: {
    path: string;
    name: string;
    originX: number;
    originY: number;
  },
): NonNullable<ShooterTilemapSpec["layers"]>[number] {
  const columns = positiveInteger(layer.__cWid, `${options.path}.__cWid`);
  const rows = positiveInteger(layer.__cHei, `${options.path}.__cHei`);
  const tileWidth = positiveNumber(layer.__gridSize, `${options.path}.__gridSize`);
  const intGridCsv = ldtkIntGridCsv(layer.intGridCsv, {
    path: `${options.path}.intGridCsv`,
    expectedLength: columns * rows,
  });

  return {
    name: options.name,
    columns,
    rows,
    tileWidth,
    tileHeight: tileWidth,
    origin: {
      x: options.originX + finiteNumber(layer.__pxTotalOffsetX, `${options.path}.__pxTotalOffsetX`, 0),
      y: options.originY + finiteNumber(layer.__pxTotalOffsetY, `${options.path}.__pxTotalOffsetY`, 0),
    },
    collision: true,
    collisionOnly: true,
    data: intGridCsv.map((value) => value === 0 ? 0 : LDTK_RAW_INT_GRID_SOLID_TILE_ID),
  };
}

function ldtkIntGridCsv(
  value: unknown,
  options: { path: string; expectedLength: number },
): number[] {
  const values = arrayValue(value, options.path);
  if (values.length !== options.expectedLength) {
    throw assetPipelineDiagnosticError(options.path, `must contain exactly ${options.expectedLength} IntGrid values`);
  }
  return values.map((entry, index) => nonNegativeInteger(entry, `${options.path}.${index}`));
}

function ldtkLayerTileEntries(layer: JsonRecord, path: string): Array<{ value: unknown; path: string }> {
  const entries: Array<{ value: unknown; path: string }> = [];
  for (const [field, values] of [
    ["gridTiles", optionalArray(layer.gridTiles, `${path}.gridTiles`)],
    ["autoLayerTiles", optionalArray(layer.autoLayerTiles, `${path}.autoLayerTiles`)],
  ] as const) {
    values.forEach((value, index) => {
      entries.push({ value, path: `${path}.${field}.${index}` });
    });
  }
  return entries;
}

function ldtkTileInstance(
  value: unknown,
  options: {
    path: string;
    tileset: LDtkTileset;
    gridSize: number;
    columns: number;
    rows: number;
    importedTiles: Map<string, LDtkTileRef>;
  },
): { column: number; row: number; ref: LDtkTileRef } {
  const tile = objectValue(value, options.path);
  const flags = nonNegativeInteger(tile.f ?? 0, `${options.path}.f`);
  if (flags !== 0) {
    throw assetPipelineDiagnosticError(`${options.path}.f`, "flipped LDtk tiles are not supported");
  }
  const [pxX, pxY] = ldtkNumberPair(tile.px, `${options.path}.px`);
  const [srcX, srcY] = ldtkNumberPair(tile.src, `${options.path}.src`);
  const column = ldtkGridCoordinate(pxX, options.gridSize, `${options.path}.px.0`);
  const row = ldtkGridCoordinate(pxY, options.gridSize, `${options.path}.px.1`);
  if (column >= options.columns) {
    throw assetPipelineDiagnosticError(`${options.path}.px.0`, "tile exceeds layer width");
  }
  if (row >= options.rows) {
    throw assetPipelineDiagnosticError(`${options.path}.px.1`, "tile exceeds layer height");
  }

  const ldtkTileId = ldtkTileIdValue(tile.t, {
    path: `${options.path}.t`,
    srcX,
    srcY,
    tileset: options.tileset,
  });
  return {
    column,
    row,
    ref: ldtkImportedTile({
      ldtkTileId,
      srcX,
      srcY,
      tileset: options.tileset,
      path: options.path,
      importedTiles: options.importedTiles,
    }),
  };
}

function ldtkTileIdValue(
  value: unknown,
  options: { path: string; srcX: number; srcY: number; tileset: LDtkTileset },
): number {
  const sourcePath = options.path.replace(/\.t$/, ".src");
  ldtkValidateSource(options.srcX, options.srcY, options.tileset, sourcePath);
  if (value !== undefined) {
    return nonNegativeInteger(value, options.path);
  }
  const column = ldtkGridCoordinate(
    options.srcX - options.tileset.padding,
    options.tileset.tileWidth + options.tileset.spacing,
    `${sourcePath}.0`,
  );
  const row = ldtkGridCoordinate(
    options.srcY - options.tileset.padding,
    options.tileset.tileHeight + options.tileset.spacing,
    `${sourcePath}.1`,
  );
  return row * options.tileset.columns + column;
}

function ldtkValidateSource(srcX: number, srcY: number, tileset: LDtkTileset, path: string): void {
  if (srcX < tileset.padding) {
    throw assetPipelineDiagnosticError(`${path}.0`, "tile source must be inside tileset padding");
  }
  if (srcY < tileset.padding) {
    throw assetPipelineDiagnosticError(`${path}.1`, "tile source must be inside tileset padding");
  }
  if (srcX + tileset.tileWidth > tileset.imageWidth) {
    throw assetPipelineDiagnosticError(`${path}.0`, "tile source exceeds tileset image width");
  }
  if (srcY + tileset.tileHeight > tileset.imageHeight) {
    throw assetPipelineDiagnosticError(`${path}.1`, "tile source exceeds tileset image height");
  }
}
