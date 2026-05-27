export type LightingColor3 = readonly [number, number, number];
export type LightingColor4 = readonly [number, number, number, number];

export interface PointLight2D {
  x: number;
  y: number;
  radius: number;
  color?: LightingColor3 | LightingColor4;
  intensity?: number;
  falloff?: number;
}

export interface TileOccluder2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LightingDebugOptions {
  tileOccluders?: boolean;
  color?: LightingColor4;
}

export interface LightingShadowOptions {
  enabled?: boolean;
  color?: LightingColor4;
  projectionLength?: number;
  maxDistance?: number;
}

export interface ShadowClipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShadowProjectionOptions {
  clipRect?: ShadowClipRect;
}

export interface LightingScene2D {
  enabled?: boolean;
  ambient?: LightingColor4;
  pointLights?: readonly PointLight2D[];
  tileOccluders?: readonly TileOccluder2D[];
  shadows?: boolean | LightingShadowOptions;
  debug?: LightingDebugOptions;
}

export interface ResolvedPointLight2D {
  x: number;
  y: number;
  radius: number;
  color: LightingColor4;
  intensity: number;
  falloff: number;
}

export interface ResolvedLightingDebugOptions {
  tileOccluders: boolean;
  color: LightingColor4;
}

export interface ResolvedLightingShadowOptions {
  enabled: boolean;
  color: LightingColor4;
  projectionLength: number;
  maxDistance?: number;
}

export interface ResolvedLightingScene2D {
  enabled: boolean;
  ambient: LightingColor4;
  pointLights: readonly ResolvedPointLight2D[];
  tileOccluders: readonly TileOccluder2D[];
  shadows: ResolvedLightingShadowOptions;
  debug: ResolvedLightingDebugOptions;
}

export interface TileOccluderGridInput {
  width: number;
  height: number;
  tileSize: number;
  data: readonly number[];
  solidTileIds?: readonly number[];
}

const DISABLED_LIGHTING_SCENE: ResolvedLightingScene2D = Object.freeze({
  enabled: false,
  ambient: Object.freeze([0, 0, 0, 0]) as unknown as LightingColor4,
  pointLights: Object.freeze([]) as unknown as readonly ResolvedPointLight2D[],
  tileOccluders: Object.freeze([]) as unknown as readonly TileOccluder2D[],
  shadows: Object.freeze({
    enabled: false,
    color: Object.freeze([0, 0, 0, 0.42]) as unknown as LightingColor4,
    projectionLength: 1024,
  }) as unknown as ResolvedLightingShadowOptions,
  debug: Object.freeze({
    tileOccluders: false,
    color: Object.freeze([1, 0.15, 0.05, 0.35]) as unknown as LightingColor4,
  }) as unknown as ResolvedLightingDebugOptions,
});

export function normalizeLightingScene(scene: LightingScene2D | false | undefined): ResolvedLightingScene2D {
  if (scene === undefined || scene === false || scene.enabled === false) {
    return DISABLED_LIGHTING_SCENE;
  }

  return {
    enabled: true,
    ambient: normalizeColor4(scene.ambient ?? [0, 0, 0, 0.45], "ambient"),
    pointLights: (scene.pointLights ?? []).map((light, index) => normalizePointLight(light, index)),
    tileOccluders: (scene.tileOccluders ?? []).map((occluder, index) => normalizeTileOccluder(occluder, index)),
    shadows: normalizeLightingShadows(scene.shadows),
    debug: {
      tileOccluders: scene.debug?.tileOccluders ?? false,
      color: normalizeColor4(scene.debug?.color ?? [1, 0.15, 0.05, 0.35], "debug.color"),
    },
  };
}

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

  for (let y = 0; y < height; y += 1) {
    let runStart = -1;
    for (let x = 0; x <= width; x += 1) {
      const solid = x < width && isSolidTile(input.data[y * width + x], solidTileIds);
      if (solid && runStart === -1) {
        runStart = x;
      } else if (!solid && runStart !== -1) {
        occluders.push({
          x: runStart * tileSize,
          y: y * tileSize,
          width: (x - runStart) * tileSize,
          height: tileSize,
        });
        runStart = -1;
      }
    }
  }

  return occluders;
}

export function distanceToTileOccluder(light: ResolvedPointLight2D, occluder: TileOccluder2D): number {
  const left = occluder.x;
  const top = occluder.y;
  const right = occluder.x + occluder.width;
  const bottom = occluder.y + occluder.height;
  const dx = Math.max(left - light.x, 0, light.x - right);
  const dy = Math.max(top - light.y, 0, light.y - bottom);
  return Math.hypot(dx, dy);
}

export function projectTileOccluderShadowTriangles(
  occluder: TileOccluder2D,
  light: ResolvedPointLight2D,
  projectionLength: number,
  options: ShadowProjectionOptions = {},
): readonly number[] | undefined {
  if (containsPoint(occluder, light.x, light.y)) {
    return undefined;
  }

  const corners = occluderCorners(occluder);
  const anglePoints = corners
    .map((point) => ({ point, angle: Math.atan2(point.y - light.y, point.x - light.x) }))
    .sort((a, b) => a.angle - b.angle);
  const silhouette = silhouetteCorners(anglePoints);
  const startFar = extrudePoint(silhouette.start, light, projectionLength);
  const endFar = extrudePoint(silhouette.end, light, projectionLength);
  if (!startFar || !endFar) {
    return undefined;
  }

  const polygon = options.clipRect === undefined
    ? [silhouette.start, silhouette.end, endFar, startFar]
    : clipPolygonToRect([silhouette.start, silhouette.end, endFar, startFar], options.clipRect);
  return triangulatePolygon(polygon);
}

function normalizePointLight(light: PointLight2D, index: number): ResolvedPointLight2D {
  const path = `pointLights[${index}]`;
  return {
    x: finiteNumber(light.x, `${path}.x`),
    y: finiteNumber(light.y, `${path}.y`),
    radius: positiveNumber(light.radius, `${path}.radius`),
    color: normalizeColor4(light.color ?? [1, 0.92, 0.72, 1], `${path}.color`),
    intensity: nonNegativeNumber(light.intensity ?? 1, `${path}.intensity`),
    falloff: positiveNumber(light.falloff ?? 2, `${path}.falloff`),
  };
}

function normalizeTileOccluder(occluder: TileOccluder2D, index: number): TileOccluder2D {
  const path = `tileOccluders[${index}]`;
  return {
    x: finiteNumber(occluder.x, `${path}.x`),
    y: finiteNumber(occluder.y, `${path}.y`),
    width: positiveNumber(occluder.width, `${path}.width`),
    height: positiveNumber(occluder.height, `${path}.height`),
  };
}

function normalizeLightingShadows(shadows: boolean | LightingShadowOptions | undefined): ResolvedLightingShadowOptions {
  if (shadows === undefined || shadows === false) {
    return {
      enabled: false,
      color: [0, 0, 0, 0.42],
      projectionLength: 1024,
    };
  }

  if (shadows === true) {
    return {
      enabled: true,
      color: [0, 0, 0, 0.42],
      projectionLength: 1024,
    };
  }

  if (shadows.enabled === false) {
    return {
      enabled: false,
      color: [0, 0, 0, 0.42],
      projectionLength: 1024,
    };
  }

  return {
    enabled: true,
    color: normalizeColor4(shadows.color ?? [0, 0, 0, 0.42], "shadows.color"),
    projectionLength: positiveNumber(shadows.projectionLength ?? 1024, "shadows.projectionLength"),
    maxDistance: shadows.maxDistance === undefined
      ? undefined
      : positiveNumber(shadows.maxDistance, "shadows.maxDistance"),
  };
}

function normalizeColor4(color: LightingColor3 | LightingColor4, path: string): LightingColor4 {
  const length = color.length;
  if (length !== 3 && length !== 4) {
    throw new Error(`${path} must contain 3 or 4 normalized color channels.`);
  }
  return [
    normalizedChannel(color[0], `${path}[0]`),
    normalizedChannel(color[1], `${path}[1]`),
    normalizedChannel(color[2], `${path}[2]`),
    normalizedChannel(length === 4 ? color[3] : 1, `${path}[3]`),
  ];
}

function isSolidTile(tileId: number, solidTileIds: ReadonlySet<number> | undefined): boolean {
  if (!Number.isInteger(tileId)) {
    throw new Error(`Tile occluder grid data must contain integer tile ids, got ${tileId}.`);
  }
  return solidTileIds === undefined ? tileId > 0 : solidTileIds.has(tileId);
}

function normalizedChannel(value: number, path: string): number {
  const channel = finiteNumber(value, path);
  if (channel < 0 || channel > 1) {
    throw new Error(`${path} must be between 0 and 1.`);
  }
  return channel;
}

function positiveInteger(value: number, path: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} must be a positive integer.`);
  }
  return value;
}

function positiveNumber(value: number, path: string): number {
  const number = finiteNumber(value, path);
  if (number <= 0) {
    throw new Error(`${path} must be greater than 0.`);
  }
  return number;
}

function nonNegativeNumber(value: number, path: string): number {
  const number = finiteNumber(value, path);
  if (number < 0) {
    throw new Error(`${path} must be greater than or equal to 0.`);
  }
  return number;
}

function finiteNumber(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

interface Point2D {
  x: number;
  y: number;
}

interface AnglePoint {
  point: Point2D;
  angle: number;
}

const TWO_PI = Math.PI * 2;
const SHADOW_EPSILON = 0.0001;

function silhouetteCorners(anglePoints: readonly AnglePoint[]): { start: Point2D; end: Point2D } {
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

  return {
    start: anglePoints[(gapIndex + 1) % anglePoints.length].point,
    end: anglePoints[gapIndex].point,
  };
}

function occluderCorners(occluder: TileOccluder2D): Point2D[] {
  const left = occluder.x;
  const top = occluder.y;
  const right = occluder.x + occluder.width;
  const bottom = occluder.y + occluder.height;
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

function extrudePoint(point: Point2D, light: ResolvedPointLight2D, length: number): Point2D | undefined {
  const dx = point.x - light.x;
  const dy = point.y - light.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= SHADOW_EPSILON) {
    return undefined;
  }
  return {
    x: point.x + (dx / distance) * length,
    y: point.y + (dy / distance) * length,
  };
}

function clipPolygonToRect(points: readonly Point2D[], rect: ShadowClipRect): Point2D[] {
  const left = finiteNumber(rect.x, "clipRect.x");
  const top = finiteNumber(rect.y, "clipRect.y");
  const right = left + positiveNumber(rect.width, "clipRect.width");
  const bottom = top + positiveNumber(rect.height, "clipRect.height");
  return clipPolygon(
    clipPolygon(
      clipPolygon(
        clipPolygon(points, (point) => point.x >= left, (start, end) => intersectVertical(start, end, left)),
        (point) => point.x <= right,
        (start, end) => intersectVertical(start, end, right),
      ),
      (point) => point.y >= top,
      (start, end) => intersectHorizontal(start, end, top),
    ),
    (point) => point.y <= bottom,
    (start, end) => intersectHorizontal(start, end, bottom),
  );
}

function clipPolygon(
  points: readonly Point2D[],
  inside: (point: Point2D) => boolean,
  intersect: (start: Point2D, end: Point2D) => Point2D,
): Point2D[] {
  if (points.length === 0) {
    return [];
  }

  const output: Point2D[] = [];
  let previous = points[points.length - 1];
  let previousInside = inside(previous);
  for (const current of points) {
    const currentInside = inside(current);
    if (currentInside) {
      if (!previousInside) {
        pushPoint(output, intersect(previous, current));
      }
      pushPoint(output, current);
    } else if (previousInside) {
      pushPoint(output, intersect(previous, current));
    }
    previous = current;
    previousInside = currentInside;
  }
  if (output.length > 1 && samePoint(output[0], output[output.length - 1])) {
    output.pop();
  }
  return output;
}

function intersectVertical(start: Point2D, end: Point2D, x: number): Point2D {
  const dx = end.x - start.x;
  if (Math.abs(dx) <= SHADOW_EPSILON) {
    return { x, y: start.y };
  }
  const t = (x - start.x) / dx;
  return interpolatePoint(start, end, t);
}

function intersectHorizontal(start: Point2D, end: Point2D, y: number): Point2D {
  const dy = end.y - start.y;
  if (Math.abs(dy) <= SHADOW_EPSILON) {
    return { x: start.x, y };
  }
  const t = (y - start.y) / dy;
  return interpolatePoint(start, end, t);
}

function interpolatePoint(start: Point2D, end: Point2D, t: number): Point2D {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

function pushPoint(points: Point2D[], point: Point2D): void {
  const previous = points[points.length - 1];
  if (!previous || !samePoint(previous, point)) {
    points.push(point);
  }
}

function samePoint(a: Point2D, b: Point2D): boolean {
  return Math.abs(a.x - b.x) <= SHADOW_EPSILON && Math.abs(a.y - b.y) <= SHADOW_EPSILON;
}

function triangulatePolygon(points: readonly Point2D[]): number[] | undefined {
  if (points.length < 3) {
    return undefined;
  }
  const triangles: number[] = [];
  const anchor = points[0];
  for (let index = 1; index < points.length - 1; index += 1) {
    triangles.push(
      anchor.x, anchor.y,
      points[index].x, points[index].y,
      points[index + 1].x, points[index + 1].y,
    );
  }
  return triangles;
}

function containsPoint(occluder: TileOccluder2D, x: number, y: number): boolean {
  return x >= occluder.x
    && x <= occluder.x + occluder.width
    && y >= occluder.y
    && y <= occluder.y + occluder.height;
}
