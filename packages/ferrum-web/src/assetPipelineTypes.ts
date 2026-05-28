import type {
  ShooterAtlasFrameSpec,
  ShooterAtlasSpec,
  ShooterGameSpec,
  ShooterTilemapSpec,
} from "./gameSpec.js";

export type AsepriteAtlasFrameSizeSource = "frame" | "source";

export interface AsepriteAtlasImportOptions {
  texture: string | number;
  frameNamePrefix?: string;
  stripFrameExtension?: boolean;
  sizeSource?: AsepriteAtlasFrameSizeSource;
}

export interface AsepriteAtlasImportResult {
  atlas: ShooterAtlasSpec;
  frameNames: string[];
  image?: string;
  width: number;
  height: number;
}

export interface TiledTilesetFrameContext {
  firstGid: number;
  gid: number;
  localId: number;
  tilesetName: string;
}

export interface TiledLayerCompressionContext {
  compression: string;
  path: string;
  expectedByteLength: number;
}

export type TiledLayerDataDecoder = (
  data: Uint8Array,
  context: TiledLayerCompressionContext,
) => Uint8Array | ArrayBuffer;

export interface TiledTilemapImportOptions {
  externalTilesets?: Record<string, unknown>;
  texture?: string | number | ((context: TiledTilesetFrameContext) => string | number);
  frameNamePrefix?: string;
  frameNameForGid?: (context: TiledTilesetFrameContext) => string;
  decodeCompressedLayerData?: TiledLayerDataDecoder;
  collisionLayerNames?: readonly string[];
  includeHiddenLayers?: boolean;
  origin?: {
    x?: number;
    y?: number;
  };
}

export interface TiledTilemapImportResult {
  gameSpec: Pick<ShooterGameSpec, "atlas" | "tilemap">;
  atlas: ShooterAtlasSpec;
  tilemap: ShooterTilemapSpec;
  usedGids: number[];
  layerNames: string[];
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
}

export interface LDtkTilesetFrameContext {
  gameTileId: number;
  ldtkTileId: number;
  tilesetUid: number;
  tilesetIdentifier: string;
  srcX: number;
  srcY: number;
  relPath?: string;
}

export interface LDtkEntityInstance {
  identifier: string;
  iid?: string;
  defUid?: number;
  layerName: string;
  layerIndex: number;
  x: number;
  y: number;
  gridX: number;
  gridY: number;
  width: number;
  height: number;
  fields: Record<string, unknown>;
  fieldTypes: Record<string, string>;
}

export interface LDtkTilemapImportOptions {
  levelIdentifier?: string;
  levelIid?: string;
  levelIndex?: number;
  externalLevels?: Record<string, unknown>;
  texture?: string | number | ((context: LDtkTilesetFrameContext) => string | number);
  frameNamePrefix?: string;
  frameNameForTile?: (context: LDtkTilesetFrameContext) => string;
  collisionLayerNames?: readonly string[];
  includeHiddenLayers?: boolean;
  origin?: {
    x?: number;
    y?: number;
  };
}

export interface LDtkTilemapImportResult {
  gameSpec: Pick<ShooterGameSpec, "atlas" | "tilemap">;
  atlas: ShooterAtlasSpec;
  tilemap: ShooterTilemapSpec;
  usedTileIds: number[];
  layerNames: string[];
  entities: LDtkEntityInstance[];
  tilesetNames: string[];
  levelIdentifier: string;
  levelIid?: string;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
}
