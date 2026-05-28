import type {
  ResolvedPointLight2D,
  TileOccluder2D,
  TileOccluderGridInput,
} from "./lightingTypes.js";
import { positiveInteger, positiveNumber } from "./lightingValidation.js";

export function deriveTileOccludersFromTilemapGrid(input: TileOccluderGridInput): TileOccluder2D[] {
  const width = positiveInteger(input.width, "width");
  const height = positiveInteger(input.height, "height");
  const tileSize = positiveNumber(input.tileSize, "tileSize");
  if (input.data.length !== width * height) {
    throw new Error(`Tile occluder grid data length must be width * height, got ${input.data.length}.`);
  }

  const solidTileIds = input.solidTileIds === undefined
    ? undefined
    : new Set(input.solidTileIds.map((tileId, index) => positiveInteger(tileId, `solidTileIds[${index}]`)));
  const occluders: TileOccluder2D[] = [];
  let activeOccluders: TileOccluder2D[] = [];
  let nextActiveOccluders: TileOccluder2D[] = [];

  for (let y = 0; y < height; y += 1) {
    nextActiveOccluders.length = 0;
    const rowY = y * tileSize;
    let runStart = -1;
    for (let x = 0; x <= width; x += 1) {
      const solid = x < width && isSolidTile(input.data[y * width + x], solidTileIds);
      if (solid && runStart === -1) {
        runStart = x;
      } else if (!solid && runStart !== -1) {
        const runX = runStart * tileSize;
        const runWidth = (x - runStart) * tileSize;
        const activeIndex = findVerticallyMergeableOccluder(activeOccluders, runX, runWidth, rowY);
        if (activeIndex === -1) {
          nextActiveOccluders.push({
            x: runX,
            y: rowY,
            width: runWidth,
            height: tileSize,
          });
        } else {
          const occluder = activeOccluders[activeIndex];
          activeOccluders.splice(activeIndex, 1);
          occluder.height += tileSize;
          nextActiveOccluders.push(occluder);
        }
        runStart = -1;
      }
    }
    occluders.push(...activeOccluders);
    const previousActiveOccluders = activeOccluders;
    activeOccluders = nextActiveOccluders;
    nextActiveOccluders = previousActiveOccluders;
  }

  occluders.push(...activeOccluders);
  occluders.sort(compareTileOccludersByPosition);
  return occluders;
}

export function distanceSquaredToTileOccluder(light: ResolvedPointLight2D, occluder: TileOccluder2D): number {
  const left = occluder.x;
  const top = occluder.y;
  const right = occluder.x + occluder.width;
  const bottom = occluder.y + occluder.height;
  const dx = Math.max(left - light.x, 0, light.x - right);
  const dy = Math.max(top - light.y, 0, light.y - bottom);
  return dx * dx + dy * dy;
}

export function distanceToTileOccluder(light: ResolvedPointLight2D, occluder: TileOccluder2D): number {
  return Math.sqrt(distanceSquaredToTileOccluder(light, occluder));
}

function isSolidTile(tileId: number, solidTileIds: ReadonlySet<number> | undefined): boolean {
  if (!Number.isInteger(tileId)) {
    throw new Error(`Tile occluder grid data must contain integer tile ids, got ${tileId}.`);
  }
  return solidTileIds === undefined ? tileId > 0 : solidTileIds.has(tileId);
}

function findVerticallyMergeableOccluder(
  occluders: readonly TileOccluder2D[],
  x: number,
  width: number,
  y: number,
): number {
  for (let index = 0; index < occluders.length; index += 1) {
    const occluder = occluders[index];
    if (occluder.x === x && occluder.width === width && occluder.y + occluder.height === y) {
      return index;
    }
  }
  return -1;
}

function compareTileOccludersByPosition(a: TileOccluder2D, b: TileOccluder2D): number {
  return a.y - b.y || a.x - b.x || a.height - b.height || a.width - b.width;
}
