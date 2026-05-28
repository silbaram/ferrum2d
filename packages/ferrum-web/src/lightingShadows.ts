import type {
  ResolvedPointLight2D,
  ShadowClipRect,
  ShadowProjectionAnglePoint,
  ShadowProjectionOptions,
  ShadowProjectionPoint,
  ShadowProjectionScratch,
  TileOccluder2D,
} from "./lightingTypes.js";
import { finiteNumber, positiveNumber } from "./lightingValidation.js";

export const MAX_TILE_OCCLUDER_SHADOW_TRIANGLE_FLOATS = 36;

const TWO_PI = Math.PI * 2;
const SHADOW_EPSILON = 0.0001;
const CLIP_LEFT = 0;
const CLIP_RIGHT = 1;
const CLIP_TOP = 2;
const CLIP_BOTTOM = 3;
type ClipBoundary = typeof CLIP_LEFT | typeof CLIP_RIGHT | typeof CLIP_TOP | typeof CLIP_BOTTOM;

export function projectTileOccluderShadowTriangles(
  occluder: TileOccluder2D,
  light: ResolvedPointLight2D,
  projectionLength: number,
  options: ShadowProjectionOptions = {},
): readonly number[] | undefined {
  const triangles: number[] = [];
  const floatCount = writeTileOccluderShadowTrianglesInto(
    triangles,
    0,
    occluder,
    light,
    projectionLength,
    createShadowProjectionScratch(),
    options.clipRect,
  );
  if (floatCount === 0) {
    return undefined;
  }
  triangles.length = floatCount;
  return triangles;
}

export function createShadowProjectionScratch(): ShadowProjectionScratch {
  const corners = createPointArray(4);
  return {
    corners,
    anglePoints: corners.map((point) => ({ point, angle: 0 })),
    polygon: createPointArray(8),
    clipA: createPointArray(8),
    clipB: createPointArray(8),
    startFar: createPoint(),
    endFar: createPoint(),
    result: [],
  };
}

export function writeTileOccluderShadowTrianglesInto(
  target: number[] | Float32Array,
  targetOffset: number,
  occluder: TileOccluder2D,
  light: ResolvedPointLight2D,
  projectionLength: number,
  scratch: ShadowProjectionScratch,
  clipRect?: ShadowClipRect,
): number {
  if (containsPoint(occluder, light.x, light.y)) {
    return 0;
  }

  writeOccluderCorners(scratch.corners, occluder);
  const anglePoints = scratch.anglePoints;
  for (let index = 0; index < anglePoints.length; index += 1) {
    const point = anglePoints[index].point;
    anglePoints[index].angle = Math.atan2(point.y - light.y, point.x - light.x);
  }
  anglePoints.sort((a, b) => a.angle - b.angle);

  const gapIndex = largestAngleGapIndex(anglePoints);
  const start = anglePoints[(gapIndex + 1) % anglePoints.length].point;
  const end = anglePoints[gapIndex].point;
  if (
    !extrudePointInto(start, light, projectionLength, scratch.startFar)
    || !extrudePointInto(end, light, projectionLength, scratch.endFar)
  ) {
    return 0;
  }

  copyPoint(scratch.polygon[0], start);
  copyPoint(scratch.polygon[1], end);
  copyPoint(scratch.polygon[2], scratch.endFar);
  copyPoint(scratch.polygon[3], scratch.startFar);

  let points = scratch.polygon;
  let pointCount = 4;
  if (clipRect !== undefined) {
    pointCount = clipPolygonToRectInto(points, pointCount, clipRect, scratch);
    points = scratch.result;
  }

  return writeTriangulatedPolygonInto(points, pointCount, target, targetOffset);
}

function createPoint(): ShadowProjectionPoint {
  return { x: 0, y: 0 };
}

function createPointArray(length: number): ShadowProjectionPoint[] {
  return Array.from({ length }, () => createPoint());
}

function writeOccluderCorners(points: ShadowProjectionPoint[], occluder: TileOccluder2D): void {
  const left = occluder.x;
  const top = occluder.y;
  const right = occluder.x + occluder.width;
  const bottom = occluder.y + occluder.height;
  writePoint(points, 0, left, top);
  writePoint(points, 1, right, top);
  writePoint(points, 2, right, bottom);
  writePoint(points, 3, left, bottom);
}

function largestAngleGapIndex(anglePoints: readonly ShadowProjectionAnglePoint[]): number {
  let largestGap = Number.NEGATIVE_INFINITY;
  let gapIndex = 0;
  for (let index = 0; index < anglePoints.length; index += 1) {
    const nextIndex = (index + 1) % anglePoints.length;
    const current = anglePoints[index].angle;
    const next = anglePoints[nextIndex].angle + (nextIndex === 0 ? TWO_PI : 0);
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      gapIndex = index;
    }
  }
  return gapIndex;
}

function extrudePointInto(
  point: ShadowProjectionPoint,
  light: ResolvedPointLight2D,
  length: number,
  target: ShadowProjectionPoint,
): boolean {
  const dx = point.x - light.x;
  const dy = point.y - light.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= SHADOW_EPSILON) {
    return false;
  }
  target.x = point.x + (dx / distance) * length;
  target.y = point.y + (dy / distance) * length;
  return true;
}

function clipPolygonToRectInto(
  points: readonly ShadowProjectionPoint[],
  pointCount: number,
  rect: ShadowClipRect,
  scratch: ShadowProjectionScratch,
): number {
  const left = finiteNumber(rect.x, "clipRect.x");
  const top = finiteNumber(rect.y, "clipRect.y");
  const right = left + positiveNumber(rect.width, "clipRect.width");
  const bottom = top + positiveNumber(rect.height, "clipRect.height");

  let source = points;
  let sourceCount = pointCount;
  sourceCount = clipPolygonBoundaryInto(source, sourceCount, scratch.clipA, CLIP_LEFT, left);
  source = scratch.clipA;
  sourceCount = clipPolygonBoundaryInto(source, sourceCount, scratch.clipB, CLIP_RIGHT, right);
  source = scratch.clipB;
  sourceCount = clipPolygonBoundaryInto(source, sourceCount, scratch.clipA, CLIP_TOP, top);
  source = scratch.clipA;
  sourceCount = clipPolygonBoundaryInto(source, sourceCount, scratch.clipB, CLIP_BOTTOM, bottom);
  scratch.result = scratch.clipB;
  return sourceCount;
}

function clipPolygonBoundaryInto(
  input: readonly ShadowProjectionPoint[],
  inputCount: number,
  output: ShadowProjectionPoint[],
  boundary: ClipBoundary,
  value: number,
): number {
  if (inputCount === 0) {
    return 0;
  }

  let outputCount = 0;
  let previous = input[inputCount - 1];
  let previousInside = isInsideBoundary(previous, boundary, value);
  for (let index = 0; index < inputCount; index += 1) {
    const current = input[index];
    const currentInside = isInsideBoundary(current, boundary, value);
    if (currentInside) {
      if (!previousInside) {
        outputCount = writeBoundaryIntersection(output, outputCount, previous, current, boundary, value);
      }
      outputCount = writeUniquePoint(output, outputCount, current.x, current.y);
    } else if (previousInside) {
      outputCount = writeBoundaryIntersection(output, outputCount, previous, current, boundary, value);
    }
    previous = current;
    previousInside = currentInside;
  }
  if (outputCount > 1 && samePoint(output[0], output[outputCount - 1])) {
    outputCount -= 1;
  }
  return outputCount;
}

function isInsideBoundary(point: ShadowProjectionPoint, boundary: ClipBoundary, value: number): boolean {
  if (boundary === CLIP_LEFT) return point.x >= value;
  if (boundary === CLIP_RIGHT) return point.x <= value;
  if (boundary === CLIP_TOP) return point.y >= value;
  return point.y <= value;
}

function writeBoundaryIntersection(
  output: ShadowProjectionPoint[],
  outputCount: number,
  start: ShadowProjectionPoint,
  end: ShadowProjectionPoint,
  boundary: ClipBoundary,
  value: number,
): number {
  if (boundary === CLIP_LEFT || boundary === CLIP_RIGHT) {
    const dx = end.x - start.x;
    if (Math.abs(dx) <= SHADOW_EPSILON) {
      return writeUniquePoint(output, outputCount, value, start.y);
    }
    const t = (value - start.x) / dx;
    return writeUniquePoint(output, outputCount, value, start.y + (end.y - start.y) * t);
  }

  const dy = end.y - start.y;
  if (Math.abs(dy) <= SHADOW_EPSILON) {
    return writeUniquePoint(output, outputCount, start.x, value);
  }
  const t = (value - start.y) / dy;
  return writeUniquePoint(output, outputCount, start.x + (end.x - start.x) * t, value);
}

function writeUniquePoint(
  points: ShadowProjectionPoint[],
  index: number,
  x: number,
  y: number,
): number {
  const previous = points[index - 1];
  if (previous && sameCoordinates(previous, x, y)) {
    return index;
  }
  writePoint(points, index, x, y);
  return index + 1;
}

function writePoint(
  points: ShadowProjectionPoint[],
  index: number,
  x: number,
  y: number,
): void {
  const point = points[index] ?? createPoint();
  points[index] = point;
  point.x = x;
  point.y = y;
}

function copyPoint(target: ShadowProjectionPoint, source: ShadowProjectionPoint): void {
  target.x = source.x;
  target.y = source.y;
}

function samePoint(a: ShadowProjectionPoint, b: ShadowProjectionPoint): boolean {
  return sameCoordinates(a, b.x, b.y);
}

function sameCoordinates(point: ShadowProjectionPoint, x: number, y: number): boolean {
  return Math.abs(point.x - x) <= SHADOW_EPSILON && Math.abs(point.y - y) <= SHADOW_EPSILON;
}

function writeTriangulatedPolygonInto(
  points: readonly ShadowProjectionPoint[],
  pointCount: number,
  target: number[] | Float32Array,
  targetOffset: number,
): number {
  if (pointCount < 3) {
    return 0;
  }
  let offset = targetOffset;
  const anchor = points[0];
  for (let index = 1; index < pointCount - 1; index += 1) {
    offset = writeTrianglePoint(target, offset, anchor);
    offset = writeTrianglePoint(target, offset, points[index]);
    offset = writeTrianglePoint(target, offset, points[index + 1]);
  }
  return offset - targetOffset;
}

function writeTrianglePoint(
  target: number[] | Float32Array,
  offset: number,
  point: ShadowProjectionPoint,
): number {
  writeTriangleFloat(target, offset, point.x);
  writeTriangleFloat(target, offset + 1, point.y);
  return offset + 2;
}

function writeTriangleFloat(target: number[] | Float32Array, offset: number, value: number): void {
  if (!Array.isArray(target) && offset >= target.length) {
    throw new Error("shadow triangle projection target buffer is too small.");
  }
  target[offset] = value;
}

function containsPoint(occluder: TileOccluder2D, x: number, y: number): boolean {
  return x >= occluder.x
    && x <= occluder.x + occluder.width
    && y >= occluder.y
    && y <= occluder.y + occluder.height;
}
