import {
  createShadowProjectionScratch,
  MAX_TILE_OCCLUDER_SHADOW_TRIANGLE_FLOATS,
  writeTileOccluderShadowTrianglesInto,
} from "./lightingShadows.js";
import { distanceSquaredToTileOccluder } from "./lightingTileOccluders.js";
import type {
  ResolvedLightingShadowOptions,
  ResolvedPointLight2D,
  ShadowClipRect,
  ShadowProjectionScratch,
  TileOccluder2D,
} from "./lightingTypes.js";

export interface CachedLightingShadowGeometry {
  readonly positions: Float32Array;
  readonly floatCount: number;
  readonly casterCount: number;
  readonly revision: number;
}

interface MutableCachedLightingShadowGeometry extends CachedLightingShadowGeometry {
  positions: Float32Array;
  floatCount: number;
  casterCount: number;
  revision: number;
  occluderVersion: number;
  lightX: number;
  lightY: number;
  lightRadius: number;
  projectionLength: number;
  maxDistance: number;
  clipX: number;
  clipY: number;
  clipWidth: number;
  clipHeight: number;
}

export class LightingShadowGeometryCache {
  private readonly occluderSnapshot: TileOccluder2D[] = [];
  private occluderVersion = 0;
  private readonly lightEntries: MutableCachedLightingShadowGeometry[] = [];
  private readonly shadowProjectionScratch: ShadowProjectionScratch = createShadowProjectionScratch();

  syncOccluders(occluders: readonly TileOccluder2D[]): number {
    if (this.occludersMatchSnapshot(occluders)) {
      return this.occluderVersion;
    }

    ensureTileOccluderCapacity(this.occluderSnapshot, occluders.length);
    for (let index = 0; index < occluders.length; index += 1) {
      const source = occluders[index];
      const target = this.occluderSnapshot[index];
      target.x = source.x;
      target.y = source.y;
      target.width = source.width;
      target.height = source.height;
    }
    this.occluderSnapshot.length = occluders.length;
    this.occluderVersion += 1;
    return this.occluderVersion;
  }

  resolveLightGeometry(
    lightIndex: number,
    occluderVersion: number,
    occluders: readonly TileOccluder2D[],
    light: ResolvedPointLight2D,
    shadows: ResolvedLightingShadowOptions,
    clipRect: ShadowClipRect,
  ): CachedLightingShadowGeometry {
    const maxDistance = shadows.maxDistance ?? light.radius;
    const projectionLength = Math.max(shadows.projectionLength, light.radius);
    const entry = this.entry(lightIndex);
    if (isEntryValid(entry, occluderVersion, light, projectionLength, maxDistance, clipRect)) {
      return entry;
    }

    ensurePositionCapacity(entry, occluders.length * MAX_TILE_OCCLUDER_SHADOW_TRIANGLE_FLOATS);
    const maxDistanceSquared = maxDistance * maxDistance;
    let shadowFloatCount = 0;
    let casterCount = 0;
    for (const occluder of occluders) {
      if (distanceSquaredToTileOccluder(light, occluder) > maxDistanceSquared) {
        continue;
      }

      const written = writeTileOccluderShadowTrianglesInto(
        entry.positions,
        shadowFloatCount,
        occluder,
        light,
        projectionLength,
        this.shadowProjectionScratch,
        clipRect,
      );
      if (written === 0) {
        continue;
      }
      shadowFloatCount += written;
      casterCount += 1;
    }

    entry.floatCount = shadowFloatCount;
    entry.casterCount = casterCount;
    entry.occluderVersion = occluderVersion;
    entry.lightX = light.x;
    entry.lightY = light.y;
    entry.lightRadius = light.radius;
    entry.projectionLength = projectionLength;
    entry.maxDistance = maxDistance;
    entry.clipX = clipRect.x;
    entry.clipY = clipRect.y;
    entry.clipWidth = clipRect.width;
    entry.clipHeight = clipRect.height;
    entry.revision += 1;
    return entry;
  }

  private occludersMatchSnapshot(occluders: readonly TileOccluder2D[]): boolean {
    if (occluders.length !== this.occluderSnapshot.length) {
      return false;
    }
    for (let index = 0; index < occluders.length; index += 1) {
      const source = occluders[index];
      const cached = this.occluderSnapshot[index];
      if (
        source.x !== cached.x ||
        source.y !== cached.y ||
        source.width !== cached.width ||
        source.height !== cached.height
      ) {
        return false;
      }
    }
    return true;
  }

  private entry(lightIndex: number): MutableCachedLightingShadowGeometry {
    let entry = this.lightEntries[lightIndex];
    if (entry === undefined) {
      entry = {
        positions: new Float32Array(MAX_TILE_OCCLUDER_SHADOW_TRIANGLE_FLOATS),
        floatCount: 0,
        casterCount: 0,
        revision: 0,
        occluderVersion: -1,
        lightX: 0,
        lightY: 0,
        lightRadius: 0,
        projectionLength: 0,
        maxDistance: 0,
        clipX: 0,
        clipY: 0,
        clipWidth: 0,
        clipHeight: 0,
      };
      this.lightEntries[lightIndex] = entry;
    }
    return entry;
  }
}

function isEntryValid(
  entry: MutableCachedLightingShadowGeometry,
  occluderVersion: number,
  light: ResolvedPointLight2D,
  projectionLength: number,
  maxDistance: number,
  clipRect: ShadowClipRect,
): boolean {
  return entry.occluderVersion === occluderVersion &&
    entry.lightX === light.x &&
    entry.lightY === light.y &&
    entry.lightRadius === light.radius &&
    entry.projectionLength === projectionLength &&
    entry.maxDistance === maxDistance &&
    entry.clipX === clipRect.x &&
    entry.clipY === clipRect.y &&
    entry.clipWidth === clipRect.width &&
    entry.clipHeight === clipRect.height;
}

function ensurePositionCapacity(entry: MutableCachedLightingShadowGeometry, floatCount: number): void {
  if (entry.positions.length >= floatCount) {
    return;
  }
  entry.positions = new Float32Array(nextPowerOfTwo(floatCount));
}

function ensureTileOccluderCapacity(target: TileOccluder2D[], count: number): void {
  for (let index = target.length; index < count; index += 1) {
    target[index] = { x: 0, y: 0, width: 1, height: 1 };
  }
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(value, 1)));
}
