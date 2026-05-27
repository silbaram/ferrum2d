import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  deriveTileOccludersFromTilemapGrid,
  distanceToTileOccluder,
  normalizeLightingScene,
  projectTileOccluderShadowTriangles,
} from "../src/lighting.js";

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

test("deriveTileOccludersFromTilemapGrid merges solid horizontal tile runs", () => {
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
  equal(triangles?.length, 12);
  equal(projectTileOccluderShadowTriangles({ x: 60, y: 28, width: 8, height: 8 }, light, 128), undefined);
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
