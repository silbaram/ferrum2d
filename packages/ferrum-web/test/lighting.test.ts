import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  createShadowProjectionScratch,
  deriveTileOccludersFromTilemapGrid,
  distanceSquaredToTileOccluder,
  distanceToTileOccluder,
  MAX_TILE_OCCLUDER_SHADOW_TRIANGLE_FLOATS,
  normalizeLightingScene,
  projectTileOccluderShadowTriangles,
  writeTileOccluderShadowTrianglesInto,
} from "../src/lighting.js";
import type { LightingScene2D } from "../src/lighting.js";
import { createResolvedLightingScene, resolveLightingSceneInto } from "../src/lightingNormalize.js";

test("normalizeLightingScene resolves ambient, point lights, and debug options", () => {
  const scene = normalizeLightingScene({
    ambient: [0, 0, 0, 0.5],
    pointLights: [{
      x: 16,
      y: 24,
      radius: 48,
      color: [1, 0.8, 0.6],
      intensity: 1.5,
      falloff: 3,
    }],
    tileOccluders: [{ x: 0, y: 8, width: 16, height: 8 }],
    shadows: { color: [0, 0, 0, 0.5], projectionLength: 256, maxDistance: 128 },
    debug: { tileOccluders: true },
  });

  equal(scene.enabled, true);
  deepEqual(scene.ambient, [0, 0, 0, 0.5]);
  deepEqual(scene.pointLights, [{
    x: 16,
    y: 24,
    radius: 48,
    color: [1, 0.8, 0.6, 1],
    intensity: 1.5,
    falloff: 3,
  }]);
  deepEqual(scene.tileOccluders, [{ x: 0, y: 8, width: 16, height: 8 }]);
  deepEqual(scene.shadows, {
    enabled: true,
    color: [0, 0, 0, 0.5],
    projectionLength: 256,
    maxDistance: 128,
  });
  deepEqual(scene.debug, {
    tileOccluders: true,
    color: [1, 0.15, 0.05, 0.35],
  });
});

test("normalizeLightingScene disables omitted or false scenes", () => {
  equal(normalizeLightingScene(undefined).enabled, false);
  equal(normalizeLightingScene(false).enabled, false);
  equal(normalizeLightingScene({ enabled: false }).enabled, false);
  equal(normalizeLightingScene({ shadows: true }).shadows.enabled, true);
  equal(normalizeLightingScene({ shadows: false }).shadows.enabled, false);
});

test("normalizeLightingScene returns independent enabled scene copies", () => {
  const input = {
    pointLights: [{ x: 1, y: 2, radius: 3, color: [0.1, 0.2, 0.3, 0.4] as const }],
    tileOccluders: [{ x: 4, y: 5, width: 6, height: 7 }],
  };
  const first = normalizeLightingScene(input);
  const second = normalizeLightingScene(input);

  equal(first === second, false);
  equal(first.ambient === second.ambient, false);
  equal(first.pointLights === second.pointLights, false);
  equal(first.pointLights[0] === second.pointLights[0], false);
  equal(first.pointLights[0]?.color === second.pointLights[0]?.color, false);
  equal(first.tileOccluders === second.tileOccluders, false);
  equal(first.tileOccluders[0] === second.tileOccluders[0], false);
});

test("normalizeLightingScene rejects invalid light values", () => {
  throwsMessage(() => normalizeLightingScene({
    pointLights: [{ x: 0, y: 0, radius: 0 }],
  }), /pointLights\[0\]\.radius/);
  throwsMessage(() => normalizeLightingScene({
    ambient: [0, 0, 0, 2],
  }), /ambient\[3\]/);
  throwsMessage(() => normalizeLightingScene({
    shadows: { projectionLength: 0 },
  }), /shadows\.projectionLength/);
});

test("resolveLightingSceneInto reuses resolved lighting objects for dynamic providers", () => {
  const target = createResolvedLightingScene();
  const source = {
    ambient: [0, 0, 0, 0.25],
    pointLights: [{ x: 10, y: 20, radius: 30, color: [1, 0.5, 0.25], intensity: 2 }],
    tileOccluders: [{ x: 1, y: 2, width: 3, height: 4 }],
    shadows: { enabled: true, color: [0, 0, 0, 0.5], projectionLength: 64, maxDistance: 96 },
    debug: { tileOccluders: true, color: [1, 0, 0, 0.2] },
  } satisfies LightingScene2D;
  const first = resolveLightingSceneInto(target, source);
  const ambient = first.ambient;
  const pointLights = first.pointLights;
  const pointLight = pointLights[0];
  const pointLightColor = pointLight.color;
  const tileOccluders = first.tileOccluders;
  const tileOccluder = tileOccluders[0];
  const shadowOptions = first.shadows;
  const shadowColor = shadowOptions.color;
  const debugOptions = first.debug;
  const debugColor = debugOptions.color;

  source.pointLights[0].x = 999;
  source.tileOccluders[0].width = 999;
  source.shadows.maxDistance = 999;
  source.debug.color[3] = 1;
  deepEqual(first.pointLights[0], {
    x: 10,
    y: 20,
    radius: 30,
    color: [1, 0.5, 0.25, 1],
    intensity: 2,
    falloff: 2,
  });
  deepEqual(first.tileOccluders[0], { x: 1, y: 2, width: 3, height: 4 });
  equal(first.shadows.maxDistance, 96);
  deepEqual(first.debug.color, [1, 0, 0, 0.2]);

  const second = resolveLightingSceneInto(first, {
    ambient: [0, 0, 0, 0.4],
    pointLights: [
      { x: 11, y: 21, radius: 31, color: [0.2, 0.3, 0.4, 0.5], intensity: 3, falloff: 4 },
      { x: 12, y: 22, radius: 32 },
    ],
    tileOccluders: [
      { x: 5, y: 6, width: 7, height: 8 },
      { x: 9, y: 10, width: 11, height: 12 },
    ],
    shadows: true,
  });
  const extraPointLight = second.pointLights[1];
  const extraTileOccluder = second.tileOccluders[1];

  const third = resolveLightingSceneInto(second, {
    ambient: [0, 0, 0, 0.4],
    pointLights: [{ x: 13, y: 23, radius: 33, color: [0.6, 0.7, 0.8], intensity: 3, falloff: 4 }],
    tileOccluders: [{ x: 5, y: 6, width: 7, height: 8 }],
    shadows: true,
  });

  equal(third, first);
  equal(third.ambient, ambient);
  equal(third.pointLights, pointLights);
  equal(third.pointLights.length, 1);
  equal(third.pointLights[0], pointLight);
  equal(third.pointLights[0]?.color, pointLightColor);
  equal(extraPointLight !== third.pointLights[0], true);
  equal(third.tileOccluders, tileOccluders);
  equal(third.tileOccluders.length, 1);
  equal(third.tileOccluders[0], tileOccluder);
  equal(extraTileOccluder !== third.tileOccluders[0], true);
  equal(third.shadows, shadowOptions);
  equal(third.shadows.color, shadowColor);
  equal(third.debug, debugOptions);
  equal(third.debug.color, debugColor);
  equal(third.shadows.maxDistance, undefined);
  deepEqual(third, {
    enabled: true,
    ambient: [0, 0, 0, 0.4],
    pointLights: [{
      x: 13,
      y: 23,
      radius: 33,
      color: [0.6, 0.7, 0.8, 1],
      intensity: 3,
      falloff: 4,
    }],
    tileOccluders: [{ x: 5, y: 6, width: 7, height: 8 }],
    shadows: {
      enabled: true,
      color: [0, 0, 0, 0.42],
      projectionLength: 1024,
    },
    debug: {
      tileOccluders: false,
      color: [1, 0.15, 0.05, 0.35],
    },
  });

  resolveLightingSceneInto(third, false);
  equal(third.enabled, false);
  equal(third.pointLights.length, 0);
  equal(third.tileOccluders.length, 0);
  deepEqual(third.ambient, [0, 0, 0, 0]);
});

test("resolveLightingSceneInto supports atomic staging after validation failures", () => {
  const current = resolveLightingSceneInto(createResolvedLightingScene(), {
    ambient: [0, 0, 0, 0.3],
    pointLights: [{ x: 1, y: 2, radius: 3 }],
    shadows: { enabled: true, maxDistance: 32 },
  });
  const staging = createResolvedLightingScene();

  throwsMessage(() => resolveLightingSceneInto(staging, {
    ambient: [0, 0, 0, 0.9],
    pointLights: [{ x: 9, y: 9, radius: 0 }],
  }), /pointLights\[0\]\.radius/);

  deepEqual(current, {
    enabled: true,
    ambient: [0, 0, 0, 0.3],
    pointLights: [{
      x: 1,
      y: 2,
      radius: 3,
      color: [1, 0.92, 0.72, 1],
      intensity: 1,
      falloff: 2,
    }],
    tileOccluders: [],
    shadows: {
      enabled: true,
      color: [0, 0, 0, 0.42],
      projectionLength: 1024,
      maxDistance: 32,
    },
    debug: {
      tileOccluders: false,
      color: [1, 0.15, 0.05, 0.35],
    },
  });
});

test("deriveTileOccludersFromTilemapGrid merges solid tile runs", () => {
  deepEqual(deriveTileOccludersFromTilemapGrid({
    width: 5,
    height: 2,
    tileSize: 16,
    data: [
      0, 1, 1, 0, 2,
      3, 3, 0, 0, 0,
    ],
  }), [
    { x: 16, y: 0, width: 32, height: 16 },
    { x: 64, y: 0, width: 16, height: 16 },
    { x: 0, y: 16, width: 32, height: 16 },
  ]);
});

test("deriveTileOccludersFromTilemapGrid merges matching vertical tile runs", () => {
  deepEqual(deriveTileOccludersFromTilemapGrid({
    width: 4,
    height: 3,
    tileSize: 8,
    data: [
      1, 1, 0, 1,
      1, 1, 0, 1,
      1, 0, 0, 1,
    ],
  }), [
    { x: 0, y: 0, width: 16, height: 16 },
    { x: 24, y: 0, width: 8, height: 24 },
    { x: 0, y: 16, width: 8, height: 8 },
  ]);
});

test("deriveTileOccludersFromTilemapGrid preserves gaps and different-width runs", () => {
  deepEqual(deriveTileOccludersFromTilemapGrid({
    width: 3,
    height: 4,
    tileSize: 8,
    data: [
      1, 0, 1,
      1, 0, 0,
      0, 0, 1,
      1, 1, 1,
    ],
  }), [
    { x: 0, y: 0, width: 8, height: 16 },
    { x: 16, y: 0, width: 8, height: 8 },
    { x: 16, y: 16, width: 8, height: 8 },
    { x: 0, y: 24, width: 24, height: 8 },
  ]);
});

function throwsMessage(fn: () => void, pattern: RegExp): void {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    equal(pattern.test(message), true);
    return;
  }
  throw new Error("Expected function to throw.");
}

test("deriveTileOccludersFromTilemapGrid supports explicit solid tile ids", () => {
  deepEqual(deriveTileOccludersFromTilemapGrid({
    width: 4,
    height: 1,
    tileSize: 8,
    data: [1, 2, 3, 2],
    solidTileIds: [2],
  }), [
    { x: 8, y: 0, width: 8, height: 8 },
    { x: 24, y: 0, width: 8, height: 8 },
  ]);
});

test("projectTileOccluderShadowTriangles derives two shadow triangles outside the light", () => {
  const scene = normalizeLightingScene({
    pointLights: [{ x: 64, y: 32, radius: 96 }],
    tileOccluders: [{ x: 16, y: 16, width: 16, height: 16 }],
  });
  const light = scene.pointLights[0];
  const occluder = scene.tileOccluders[0];
  const triangles = projectTileOccluderShadowTriangles(occluder, light, 128);

  equal(distanceToTileOccluder(light, occluder), 32);
  equal(distanceSquaredToTileOccluder(light, occluder), 1024);
  equal(triangles?.length, 12);
  equal(projectTileOccluderShadowTriangles({ x: 60, y: 28, width: 8, height: 8 }, light, 128), undefined);
});

test("distanceSquaredToTileOccluder preserves shadow culling edge semantics", () => {
  const scene = normalizeLightingScene({
    pointLights: [{ x: 0, y: 0, radius: 10 }],
  });
  const light = scene.pointLights[0];
  const maxDistanceSquared = light.radius * light.radius;

  equal(distanceSquaredToTileOccluder(light, { x: -2, y: -2, width: 4, height: 4 }), 0);
  equal(distanceSquaredToTileOccluder(light, { x: 10, y: -1, width: 2, height: 2 }), maxDistanceSquared);
  ok(distanceSquaredToTileOccluder(light, { x: 10.01, y: -1, width: 2, height: 2 }) > maxDistanceSquared);
});

test("writeTileOccluderShadowTrianglesInto matches the compatibility projection wrapper", () => {
  const scene = normalizeLightingScene({
    pointLights: [{ x: 80, y: 48, radius: 96 }],
    tileOccluders: [{ x: 24, y: 24, width: 16, height: 16 }],
  });
  const light = scene.pointLights[0];
  const occluder = scene.tileOccluders[0];
  const expected = projectTileOccluderShadowTriangles(occluder, light, 240, {
    clipRect: { x: 0, y: 0, width: 96, height: 72 },
  });
  if (expected === undefined) {
    throw new Error("Expected shadow triangles.");
  }

  const target = new Float32Array(MAX_TILE_OCCLUDER_SHADOW_TRIANGLE_FLOATS);
  const written = writeTileOccluderShadowTrianglesInto(
    target,
    0,
    occluder,
    light,
    240,
    createShadowProjectionScratch(),
    { x: 0, y: 0, width: 96, height: 72 },
  );

  equal(written, expected.length);
  const actual = Array.from(target.slice(0, written));
  for (let index = 0; index < expected.length; index += 1) {
    ok(Math.abs(actual[index] - expected[index]) < 0.00001);
  }
  equal(writeTileOccluderShadowTrianglesInto(
    target,
    0,
    { x: 76, y: 44, width: 8, height: 8 },
    light,
    240,
    createShadowProjectionScratch(),
  ), 0);
});

test("projectTileOccluderShadowTriangles clips projected edges to a viewport rect", () => {
  const scene = normalizeLightingScene({
    pointLights: [{ x: 80, y: 48, radius: 96 }],
    tileOccluders: [{ x: 24, y: 24, width: 16, height: 16 }],
  });
  const light = scene.pointLights[0];
  const occluder = scene.tileOccluders[0];
  const unclipped = projectTileOccluderShadowTriangles(occluder, light, 240);
  const clipped = projectTileOccluderShadowTriangles(occluder, light, 240, {
    clipRect: { x: 0, y: 0, width: 96, height: 72 },
  });

  ok(unclipped?.some((value, index) => (
    index % 2 === 0
      ? value < 0 || value > 96
      : value < 0 || value > 72
  )));
  if (clipped === undefined) {
    throw new Error("Expected clipped shadow triangles.");
  }
  ok(clipped.length >= 6);
  ok(clipped.every((value, index) => (
    index % 2 === 0
      ? value >= -0.0001 && value <= 96.0001
      : value >= -0.0001 && value <= 72.0001
  )));
});
