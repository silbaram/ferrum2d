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

const DEFAULT_DISABLED_AMBIENT: MutableLightingColor4 = [0, 0, 0, 0];
const DEFAULT_AMBIENT: MutableLightingColor4 = [0, 0, 0, 0.45];
const DEFAULT_LIGHT_COLOR: MutableLightingColor4 = [1, 0.92, 0.72, 1];
const DEFAULT_SHADOW_COLOR: MutableLightingColor4 = [0, 0, 0, 0.42];
const DEFAULT_DEBUG_COLOR: MutableLightingColor4 = [1, 0.15, 0.05, 0.35];

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

export function resolveLightingSceneInto(
  target: ResolvedLightingScene2D,
  scene: LightingScene2D | false | undefined,
): ResolvedLightingScene2D {
  const mutableTarget = target as MutableResolvedLightingScene2D;
  if (scene === undefined || scene === false || scene.enabled === false) {
    mutableTarget.enabled = false;
    writeColor4Into(mutableTarget.ambient, DEFAULT_DISABLED_AMBIENT);
    mutableTarget.pointLights.length = 0;
    mutableTarget.tileOccluders.length = 0;
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

  const tileOccluders = scene.tileOccluders ?? [];
  ensureTileOccluderCapacity(mutableTarget.tileOccluders, tileOccluders.length);
  for (let index = 0; index < tileOccluders.length; index += 1) {
    resolveTileOccluderInto(mutableTarget.tileOccluders[index], tileOccluders[index], index);
  }
  mutableTarget.tileOccluders.length = tileOccluders.length;

  resolveLightingShadowsInto(mutableTarget.shadows, scene.shadows);
  mutableTarget.debug.tileOccluders = scene.debug?.tileOccluders ?? false;
  writeNormalizedColor4Into(mutableTarget.debug.color, scene.debug?.color ?? DEFAULT_DEBUG_COLOR, "debug.color");
  return mutableTarget;
}

function resolvePointLightInto(target: MutableResolvedPointLight2D, light: PointLight2D, index: number): void {
  const path = `pointLights[${index}]`;
  target.x = finiteNumber(light.x, `${path}.x`);
  target.y = finiteNumber(light.y, `${path}.y`);
  target.radius = positiveNumber(light.radius, `${path}.radius`);
  writeNormalizedColor4Into(target.color, light.color ?? DEFAULT_LIGHT_COLOR, `${path}.color`);
  target.intensity = nonNegativeNumber(light.intensity ?? 1, `${path}.intensity`);
  target.falloff = positiveNumber(light.falloff ?? 2, `${path}.falloff`);
}

function resolveTileOccluderInto(target: TileOccluder2D, occluder: TileOccluder2D, index: number): void {
  const path = `tileOccluders[${index}]`;
  target.x = finiteNumber(occluder.x, `${path}.x`);
  target.y = finiteNumber(occluder.y, `${path}.y`);
  target.width = positiveNumber(occluder.width, `${path}.width`);
  target.height = positiveNumber(occluder.height, `${path}.height`);
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
