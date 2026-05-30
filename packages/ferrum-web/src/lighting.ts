export type * from "./lightingTypes.js";
export { normalizeLightingScene } from "./lightingNormalize.js";
export {
  deriveHd2dTileOccludersFromTilemapGrid,
  deriveTileOccludersFromTilemapGrid,
  distanceSquaredToTileOccluder,
  distanceToTileOccluder,
} from "./lightingTileOccluders.js";
export {
  createShadowProjectionScratch,
  MAX_TILE_OCCLUDER_SHADOW_TRIANGLE_FLOATS,
  projectTileOccluderShadowTriangles,
  writeTileOccluderShadowTrianglesInto,
} from "./lightingShadows.js";
