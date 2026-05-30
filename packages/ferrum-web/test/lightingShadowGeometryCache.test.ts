import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { normalizeLightingScene } from "../src/lighting.js";
import { LightingShadowGeometryCache } from "../src/lightingShadowGeometryCache.js";
import type { ResolvedLightingShadowOptions, ShadowClipRect, TileOccluder2D } from "../src/lighting.js";

test("LightingShadowGeometryCache reuses unchanged light and occluder geometry", () => {
  const cache = new LightingShadowGeometryCache();
  const occluders: TileOccluder2D[] = [{ x: 24, y: 24, width: 16, height: 16 }];
  const scene = normalizeLightingScene({
    pointLights: [{ x: 80, y: 48, radius: 96 }],
    shadows: { enabled: true, color: [0, 0, 0, 0.5], projectionLength: 160 },
  });
  const clipRect: ShadowClipRect = { x: 0, y: 0, width: 200, height: 120 };
  const occluderVersion = cache.syncOccluders(occluders);

  const first = cache.resolveLightGeometry(0, occluderVersion, occluders, scene.pointLights[0], scene.shadows, clipRect);
  const firstRevision = first.revision;
  const second = cache.resolveLightGeometry(0, occluderVersion, occluders, scene.pointLights[0], scene.shadows, clipRect);

  equal(second, first);
  equal(second.revision, firstRevision);
  ok(second.floatCount > 0);
  equal(second.casterCount, 1);
});

test("LightingShadowGeometryCache invalidates on light, shadow, viewport, and occluder changes", () => {
  const cache = new LightingShadowGeometryCache();
  const occluders: TileOccluder2D[] = [{ x: 24, y: 24, width: 16, height: 16 }];
  const scene = normalizeLightingScene({
    pointLights: [{ x: 80, y: 48, radius: 96 }],
    shadows: { enabled: true, color: [0, 0, 0, 0.5], projectionLength: 160 },
  });
  const clipRect: ShadowClipRect = { x: 0, y: 0, width: 200, height: 120 };
  let occluderVersion = cache.syncOccluders(occluders);
  const first = cache.resolveLightGeometry(0, occluderVersion, occluders, scene.pointLights[0], scene.shadows, clipRect);
  let revision = first.revision;

  cache.resolveLightGeometry(0, occluderVersion, occluders, { ...scene.pointLights[0], x: 82 }, scene.shadows, clipRect);
  ok(first.revision > revision);
  revision = first.revision;

  const longerProjection: ResolvedLightingShadowOptions = {
    ...scene.shadows,
    projectionLength: scene.shadows.projectionLength + 32,
  };
  cache.resolveLightGeometry(0, occluderVersion, occluders, scene.pointLights[0], longerProjection, clipRect);
  ok(first.revision > revision);
  revision = first.revision;

  cache.resolveLightGeometry(
    0,
    occluderVersion,
    occluders,
    scene.pointLights[0],
    scene.shadows,
    { ...clipRect, width: 240 },
  );
  ok(first.revision > revision);
  revision = first.revision;

  occluders[0].x = 32;
  occluderVersion = cache.syncOccluders(occluders);
  cache.resolveLightGeometry(0, occluderVersion, occluders, scene.pointLights[0], scene.shadows, clipRect);
  ok(first.revision > revision);
});
