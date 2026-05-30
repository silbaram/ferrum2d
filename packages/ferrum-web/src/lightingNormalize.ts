import type {
  LightingScene2D,
  LightingShadowOptions,
  PointLight2D,
  ResolvedLightingDebugOptions,
  ResolvedLightingScene2D,
  ResolvedLightingShadowOptions,
  ResolvedPointLight2D,
  TileOccluder2D,
} from "./lightingTypes.js";
import {
  finiteNumber,
  nonNegativeNumber,
  positiveNumber,
} from "./lightingValidation.js";

type MutableLightingColor4 = [number, number, number, number];

interface MutableResolvedPointLight2D extends ResolvedPointLight2D {
  color: MutableLightingColor4;
}

interface MutableResolvedLightingShadowOptions extends ResolvedLightingShadowOptions {
  color: MutableLightingColor4;
}

interface MutableResolvedLightingDebugOptions extends ResolvedLightingDebugOptions {
  color: MutableLightingColor4;
}

interface MutableResolvedLightingScene2D extends ResolvedLightingScene2D {
  ambient: MutableLightingColor4;
  pointLights: MutableResolvedPointLight2D[];
  tileOccluders: TileOccluder2D[];
  shadows: MutableResolvedLightingShadowOptions;
  debug: MutableResolvedLightingDebugOptions;
}

export interface LightingSceneResolveCache {
  tileOccludersInput?: readonly TileOccluder2D[];
  tileOccluders: TileOccluder2D[];
  tileOccluderStaging: TileOccluder2D[];
}

const DEFAULT_DISABLED_AMBIENT: MutableLightingColor4 = [0, 0, 0, 0];
const DEFAULT_AMBIENT: MutableLightingColor4 = [0, 0, 0, 0.45];
const DEFAULT_LIGHT_COLOR: MutableLightingColor4 = [1, 0.92, 0.72, 1];
const DEFAULT_SHADOW_COLOR: MutableLightingColor4 = [0, 0, 0, 0.42];
const DEFAULT_DEBUG_COLOR: MutableLightingColor4 = [1, 0.15, 0.05, 0.35];
const EMPTY_TILE_OCCLUDERS: readonly TileOccluder2D[] = [];

const DISABLED_LIGHTING_SCENE: ResolvedLightingScene2D = Object.freeze({
  enabled: false,
  ambient: Object.freeze([0, 0, 0, 0]) as unknown as [number, number, number, number],
  pointLights: Object.freeze([]) as unknown as readonly ResolvedPointLight2D[],
  tileOccluders: Object.freeze([]) as unknown as readonly TileOccluder2D[],
  shadows: Object.freeze({
    enabled: false,
    color: Object.freeze([0, 0, 0, 0.42]) as unknown as [number, number, number, number],
    projectionLength: 1024,
  }) as unknown as ResolvedLightingShadowOptions,
  debug: Object.freeze({
    tileOccluders: false,
    color: Object.freeze([1, 0.15, 0.05, 0.35]) as unknown as [number, number, number, number],
  }) as unknown as ResolvedLightingDebugOptions,
});

export function normalizeLightingScene(scene: LightingScene2D | false | undefined): ResolvedLightingScene2D {
  if (scene === undefined || scene === false || scene.enabled === false) {
    return DISABLED_LIGHTING_SCENE;
  }

  return resolveLightingSceneInto(createResolvedLightingScene(), scene);
}

export function createResolvedLightingScene(): ResolvedLightingScene2D {
  return {
    enabled: false,
    ambient: [0, 0, 0, 0],
    pointLights: [],
    tileOccluders: [],
    shadows: {
      enabled: false,
      color: [0, 0, 0, 0.42],
      projectionLength: 1024,
    },
    debug: {
      tileOccluders: false,
      color: [1, 0.15, 0.05, 0.35],
    },
  };
}

export function createLightingSceneResolveCache(): LightingSceneResolveCache {
  return {
    tileOccluders: [],
    tileOccluderStaging: [],
  };
}

export function resolveLightingSceneInto(
  target: ResolvedLightingScene2D,
  scene: LightingScene2D | false | undefined,
  cache?: LightingSceneResolveCache,
): ResolvedLightingScene2D {
  const mutableTarget = target as MutableResolvedLightingScene2D;
  if (scene === undefined || scene === false || scene.enabled === false) {
    mutableTarget.enabled = false;
    writeColor4Into(mutableTarget.ambient, DEFAULT_DISABLED_AMBIENT);
    mutableTarget.pointLights.length = 0;
    writeEmptyTileOccludersInto(mutableTarget, cache);
    writeDisabledShadowsInto(mutableTarget.shadows);
    mutableTarget.debug.tileOccluders = false;
    writeColor4Into(mutableTarget.debug.color, DEFAULT_DEBUG_COLOR);
    return mutableTarget;
  }

  mutableTarget.enabled = true;
  writeNormalizedColor4Into(mutableTarget.ambient, scene.ambient ?? DEFAULT_AMBIENT, "ambient");

  const pointLights = scene.pointLights ?? [];
  ensurePointLightCapacity(mutableTarget.pointLights, pointLights.length);
  for (let index = 0; index < pointLights.length; index += 1) {
    resolvePointLightInto(mutableTarget.pointLights[index], pointLights[index], index);
  }
  mutableTarget.pointLights.length = pointLights.length;

  const tileOccluders = scene.tileOccluders ?? EMPTY_TILE_OCCLUDERS;
  const resolvedTileOccluders = resolveTileOccluders(tileOccluders, mutableTarget, cache);

  resolveLightingShadowsInto(mutableTarget.shadows, scene.shadows);
  mutableTarget.debug.tileOccluders = scene.debug?.tileOccluders ?? false;
  writeNormalizedColor4Into(mutableTarget.debug.color, scene.debug?.color ?? DEFAULT_DEBUG_COLOR, "debug.color");
  mutableTarget.tileOccluders = resolvedTileOccluders;
  return mutableTarget;
}

function writeEmptyTileOccludersInto(
  target: MutableResolvedLightingScene2D,
  cache: LightingSceneResolveCache | undefined,
): void {
  if (cache !== undefined && target.tileOccluders === cache.tileOccluders) {
    target.tileOccluders = [];
    return;
  }
  target.tileOccluders.length = 0;
}

function resolveTileOccluders(
  source: readonly TileOccluder2D[],
  target: MutableResolvedLightingScene2D,
  cache: LightingSceneResolveCache | undefined,
): TileOccluder2D[] {
  if (cache === undefined) {
    ensureTileOccluderCapacity(target.tileOccluders, source.length);
    for (let index = 0; index < source.length; index += 1) {
      resolveTileOccluderInto(target.tileOccluders[index], source[index], index);
    }
    target.tileOccluders.length = source.length;
    return target.tileOccluders;
  }

  if (cache.tileOccludersInput === source && tileOccludersMatch(source, cache.tileOccluders)) {
    return cache.tileOccluders;
  }

  ensureTileOccluderCapacity(cache.tileOccluderStaging, source.length);
  for (let index = 0; index < source.length; index += 1) {
    resolveTileOccluderInto(cache.tileOccluderStaging[index], source[index], index);
  }
  cache.tileOccluderStaging.length = source.length;
  const previousTileOccluders = cache.tileOccluders;
  cache.tileOccluders = cache.tileOccluderStaging;
  cache.tileOccluderStaging = previousTileOccluders;
  cache.tileOccludersInput = source;
  return cache.tileOccluders;
}

function tileOccludersMatch(source: readonly TileOccluder2D[], cached: readonly TileOccluder2D[]): boolean {
  if (source.length !== cached.length) {
    return false;
  }
  for (let index = 0; index < source.length; index += 1) {
    const sourceOccluder = source[index];
    const cachedOccluder = cached[index];
    if (
      sourceOccluder.x !== cachedOccluder.x ||
      sourceOccluder.y !== cachedOccluder.y ||
      sourceOccluder.width !== cachedOccluder.width ||
      sourceOccluder.height !== cachedOccluder.height
    ) {
      return false;
    }
  }
  return true;
}

function resolvePointLightInto(target: MutableResolvedPointLight2D, light: PointLight2D, index: number): void {
  target.x = finiteIndexedNumber(light.x, "pointLights", index, "x");
  target.y = finiteIndexedNumber(light.y, "pointLights", index, "y");
  target.radius = positiveIndexedNumber(light.radius, "pointLights", index, "radius");
  writeIndexedNormalizedColor4Into(target.color, light.color ?? DEFAULT_LIGHT_COLOR, "pointLights", index, "color");
  target.intensity = nonNegativeIndexedNumber(light.intensity ?? 1, "pointLights", index, "intensity");
  target.falloff = positiveIndexedNumber(light.falloff ?? 2, "pointLights", index, "falloff");
}

function resolveTileOccluderInto(target: TileOccluder2D, occluder: TileOccluder2D, index: number): void {
  target.x = finiteIndexedNumber(occluder.x, "tileOccluders", index, "x");
  target.y = finiteIndexedNumber(occluder.y, "tileOccluders", index, "y");
  target.width = positiveIndexedNumber(occluder.width, "tileOccluders", index, "width");
  target.height = positiveIndexedNumber(occluder.height, "tileOccluders", index, "height");
}

function resolveLightingShadowsInto(
  target: MutableResolvedLightingShadowOptions,
  shadows: boolean | LightingShadowOptions | undefined,
): void {
  if (shadows === undefined || shadows === false) {
    writeDisabledShadowsInto(target);
    return;
  }

  if (shadows === true) {
    target.enabled = true;
    writeColor4Into(target.color, DEFAULT_SHADOW_COLOR);
    target.projectionLength = 1024;
    delete target.maxDistance;
    return;
  }

  if (shadows.enabled === false) {
    writeDisabledShadowsInto(target);
    return;
  }

  target.enabled = true;
  writeNormalizedColor4Into(target.color, shadows.color ?? DEFAULT_SHADOW_COLOR, "shadows.color");
  target.projectionLength = positiveNumber(shadows.projectionLength ?? 1024, "shadows.projectionLength");
  if (shadows.maxDistance === undefined) {
    delete target.maxDistance;
  } else {
    target.maxDistance = positiveNumber(shadows.maxDistance, "shadows.maxDistance");
  }
}

function writeDisabledShadowsInto(target: MutableResolvedLightingShadowOptions): void {
  target.enabled = false;
  writeColor4Into(target.color, DEFAULT_SHADOW_COLOR);
  target.projectionLength = 1024;
  delete target.maxDistance;
}

function ensurePointLightCapacity(target: MutableResolvedPointLight2D[], count: number): void {
  for (let index = target.length; index < count; index += 1) {
    target[index] = {
      x: 0,
      y: 0,
      radius: 1,
      color: [1, 0.92, 0.72, 1],
      intensity: 1,
      falloff: 2,
    };
  }
}

function ensureTileOccluderCapacity(target: TileOccluder2D[], count: number): void {
  for (let index = target.length; index < count; index += 1) {
    target[index] = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    };
  }
}

function writeNormalizedColor4Into(
  target: MutableLightingColor4,
  color: readonly [number, number, number] | readonly [number, number, number, number],
  path: string,
): void {
  const length = color.length;
  if (length !== 3 && length !== 4) {
    throw new Error(`${path} must contain 3 or 4 normalized color channels.`);
  }
  target[0] = normalizedChannel(color[0], `${path}[0]`);
  target[1] = normalizedChannel(color[1], `${path}[1]`);
  target[2] = normalizedChannel(color[2], `${path}[2]`);
  target[3] = normalizedChannel(length === 4 ? color[3] : 1, `${path}[3]`);
}

function writeColor4Into(target: MutableLightingColor4, color: readonly [number, number, number, number]): void {
  target[0] = color[0];
  target[1] = color[1];
  target[2] = color[2];
  target[3] = color[3];
}

function normalizedChannel(value: number, path: string): number {
  const channel = finiteNumber(value, path);
  if (channel < 0 || channel > 1) {
    throw new Error(`${path} must be between 0 and 1.`);
  }
  return channel;
}

function writeIndexedNormalizedColor4Into(
  target: MutableLightingColor4,
  color: readonly [number, number, number] | readonly [number, number, number, number],
  collection: string,
  index: number,
  field: string,
): void {
  const length = color.length;
  if (length !== 3 && length !== 4) {
    throw new Error(`${collection}[${index}].${field} must contain 3 or 4 normalized color channels.`);
  }
  target[0] = indexedNormalizedChannel(color[0], collection, index, field, 0);
  target[1] = indexedNormalizedChannel(color[1], collection, index, field, 1);
  target[2] = indexedNormalizedChannel(color[2], collection, index, field, 2);
  target[3] = indexedNormalizedChannel(length === 4 ? color[3] : 1, collection, index, field, 3);
}

function indexedNormalizedChannel(
  value: number,
  collection: string,
  index: number,
  field: string,
  channelIndex: number,
): number {
  const channel = finiteIndexedColorChannel(value, collection, index, field, channelIndex);
  if (channel < 0 || channel > 1) {
    throw new Error(`${collection}[${index}].${field}[${channelIndex}] must be between 0 and 1.`);
  }
  return channel;
}

function finiteIndexedColorChannel(
  value: number,
  collection: string,
  index: number,
  field: string,
  channelIndex: number,
): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${collection}[${index}].${field}[${channelIndex}] must be a finite number.`);
  }
  return value;
}

function finiteIndexedNumber(value: number, collection: string, index: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${collection}[${index}].${field} must be a finite number.`);
  }
  return value;
}

function positiveIndexedNumber(value: number, collection: string, index: number, field: string): number {
  const number = finiteIndexedNumber(value, collection, index, field);
  if (number <= 0) {
    throw new Error(`${collection}[${index}].${field} must be greater than 0.`);
  }
  return number;
}

function nonNegativeIndexedNumber(value: number, collection: string, index: number, field: string): number {
  const number = finiteIndexedNumber(value, collection, index, field);
  if (number < 0) {
    throw new Error(`${collection}[${index}].${field} must be greater than or equal to 0.`);
  }
  return number;
}
