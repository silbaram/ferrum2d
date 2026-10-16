import { test } from "node:test";
import { equal } from "node:assert/strict";
import { SpatialShadowCache } from "../src/spatialShadowCache.js";
import { compileSpatialEnvironment } from "../src/spatialEnvironment.js";
import type { SpatialRenderBufferView } from "../src/dataSceneSpatial.js";

test("shadow cache invalidates native geometry, light, atlas/alpha texture and stream changes", () => {
  const cache = new SpatialShadowCache();
  const frame: SpatialRenderBufferView = {
    version: 2, vertexStride: 11, terrainRevision: 3, camera: new Float32Array(28),
    terrain: new Float32Array(33), terrainVertexCount: 3, terrainDrawRanges: new Uint32Array(),
    billboards: new Float32Array(), billboardVertexCount: 0,
    environment: {
      version: 1, values: compileSpatialEnvironment({ lighting: { lights: [{ position: { x: 0, y: 0, elevation: 20 }, radius: 100 }], shadows: { lightIndex: 0 } } }),
      shadowMatrices: new Float32Array(96), shadowCasters: new Float32Array(), shadowCasterVertexCount: 0,
      shadowSubmission: { version: 1, revision: 2, ranges: new Uint32Array() },
    },
  };
  let revision = 0;
  const textures = { texture: () => ({}), textureRevision: () => revision };
  equal(cache.matches(frame, textures), false); cache.commit(frame);
  equal(cache.matches(frame, textures), true);
  frame.environment!.values[60] += 50;
  equal(cache.matches(frame, textures), true, "focus does not change the shadow map");
  frame.environment!.values[12] += 5;
  equal(cache.matches(frame, textures), false, "point-light radial depth changes even in manually supplied packets");
  cache.commit(frame);
  frame.terrainRevision++; equal(cache.matches(frame, textures), false); cache.commit(frame);
  frame.environment!.shadowSubmission!.revision++; equal(cache.matches(frame, textures), false); cache.commit(frame);
  frame.environment!.shadowMatrices[0]++; equal(cache.matches(frame, textures), false); cache.commit(frame);
  revision++; equal(cache.matches(frame, textures), false); cache.commit(frame);
  equal(cache.matches(frame, textures), true);
  equal(cache.matches(frame, { texture: () => ({}) }), false, "untracked mutable texture must redraw");
  frame.terrain = frame.terrain.slice(); equal(cache.matches(frame, textures), false);
  frame.environment!.shadowSubmission = undefined;
  equal(cache.matches(frame, textures), false, "legacy/deferred packets cannot reuse untracked geometry");
});
