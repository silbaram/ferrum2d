import { assetPipelineDiagnosticError } from "./diagnostics.js";
import type { ShooterAtlasFrameSpec } from "./gameSpec.js";
import type {
  LDtkTilemapImportOptions,
  LDtkTilesetFrameContext,
} from "./assetPipelineTypes.js";
import { textureValue } from "./assetPipelineValidation.js";
import { LDTK_ROOT_PATH } from "./assetPipelineLDtkConstants.js";
import type { LDtkTileRef } from "./assetPipelineLDtkTilesets.js";

export function ldtkTilesetFrameContext(tile: LDtkTileRef): LDtkTilesetFrameContext {
  return {
    gameTileId: tile.gameTileId,
    ldtkTileId: tile.ldtkTileId,
    tilesetUid: tile.tileset.uid,
    tilesetIdentifier: tile.tileset.identifier,
    srcX: tile.srcX,
    srcY: tile.srcY,
    relPath: tile.tileset.relPath,
  };
}

export function ldtkFrameName(context: LDtkTilesetFrameContext, options: LDtkTilemapImportOptions): string {
  const frameName = options.frameNameForTile?.(context)
    ?? `${options.frameNamePrefix ?? ""}${context.tilesetIdentifier}.${context.ldtkTileId}`;
  if (frameName.trim().length === 0) {
    throw assetPipelineDiagnosticError(`${LDTK_ROOT_PATH}.defs.tilesets`, "frameNameForTile must return a non-empty string");
  }
  return frameName;
}

export function ldtkAtlasFrameSpec(
  tile: LDtkTileRef,
  context: LDtkTilesetFrameContext,
  options: LDtkTilemapImportOptions,
): ShooterAtlasFrameSpec {
  return {
    texture: ldtkTexture(context, options),
    uv: {
      u0: tile.srcX / tile.tileset.imageWidth,
      v0: tile.srcY / tile.tileset.imageHeight,
      u1: (tile.srcX + tile.tileset.tileWidth) / tile.tileset.imageWidth,
      v1: (tile.srcY + tile.tileset.tileHeight) / tile.tileset.imageHeight,
    },
    size: {
      width: tile.tileset.tileWidth,
      height: tile.tileset.tileHeight,
    },
  };
}

function ldtkTexture(context: LDtkTilesetFrameContext, options: LDtkTilemapImportOptions): string | number {
  if (typeof options.texture === "function") {
    return textureValue(options.texture(context), `${LDTK_ROOT_PATH}.texture`);
  }
  if (options.texture !== undefined) {
    return textureValue(options.texture, `${LDTK_ROOT_PATH}.texture`);
  }
  return context.tilesetIdentifier;
}
