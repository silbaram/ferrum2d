import { equal, deepEqual } from "node:assert/strict";
import { test } from "node:test";
import { snapshotRenderFrameBuffers } from "../src/frameBufferSnapshot.js";
import type { SpatialRenderBufferView } from "../src/dataSceneSpatial.js";

test("callback snapshots retain all spatial sidecars and native model aliases after memory growth", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const floats = new Float32Array(memory.buffer, 0, 64);
  floats.fill(0.5);
  const words = new Uint32Array(memory.buffer, 512, 20);
  words[0] = 7;
  const values = new Float32Array(memory.buffer, 512, 20);
  values[4] = 3.5;
  const range = new Uint32Array(memory.buffer, 1024, 2);
  range.set([0, 3]);
  const spatial: SpatialRenderBufferView = {
    version: 2, vertexStride: 11, camera: floats.subarray(0, 16),
    terrain: floats.subarray(16, 49), terrainVertexCount: 3, terrainRevision: 1,
    terrainDrawRanges: range, billboards: floats.subarray(16, 49), billboardVertexCount: 3,
    presentation: floats.subarray(0, 6),
    models: { version: 1, stride: 20, words, values, assets: new Map() },
    materials: { version: 1, terrain: words.subarray(0, 2), billboards: words.subarray(0, 2) },
    debug: { version: 1, vertexStride: 11, vertices: floats.subarray(0, 22), vertexCount: 2, depthTest: true, truncated: false },
    environment: { version: 1, values: floats, shadowMatrices: floats, shadowCasters: floats,
      shadowCasterVertexCount: 0, shadowSubmission: { version: 1, revision: 1, ranges: range } },
  };
  const frame = snapshotRenderFrameBuffers({
    renderCommandBuffer: { buffer: floats.subarray(0, 15), commandCount: 1, floatsPerCommand: 15,
      groundShadowProjection: floats.subarray(0, 3),groundShadowVolumes:{version:1,stride:3,vertexCount:3,casterCount:1,buffer:floats.subarray(0,9)}, spriteNormalMaterials: { version: 1, stride: 2, buffer: words.subarray(0, 2) }, spatial },
    physicsDebugLineBuffer: { buffer: floats.subarray(0, 8), lineCount: 1, floatsPerLine: 8 },
    cameraX: 1, cameraY: 2,
  });
  floats.fill(0); words.fill(0); range.fill(0);
  memory.grow(1);
  const captured = frame.renderCommandBuffer.spatial!;
  equal(frame.renderCommandBuffer.buffer[0], 0.5);
  equal(frame.renderCommandBuffer.groundShadowProjection![0], 0.5);
  equal(frame.renderCommandBuffer.groundShadowVolumes!.buffer[0],0.5);
  equal(frame.renderCommandBuffer.groundShadowVolumes!.vertexCount,3);
  equal(frame.renderCommandBuffer.spriteNormalMaterials!.buffer[0], 7);
  equal(frame.physicsDebugLineBuffer!.buffer[0], 0.5);
  equal(captured.camera[0], 0.5); equal(captured.terrain[0], 0.5); equal(captured.billboards[0], 0.5);
  equal(captured.presentation![0], 0.5); equal(captured.debug!.vertices[0], 0.5);
  equal(captured.materials!.terrain[0], 7); equal(captured.materials!.billboards[0], 7);
  equal(captured.models!.words[0], 7); equal(captured.models!.values[4], 3.5);
  equal(captured.models!.words.buffer, captured.models!.values.buffer);
  equal(captured.environment!.values[0], 0.5);
  equal(captured.environment!.shadowMatrices[0], 0.5);
  equal(captured.environment!.shadowCasters[0], 0.5);
  deepEqual([...captured.environment!.shadowSubmission!.ranges], [0, 3]);
  deepEqual([...captured.terrainDrawRanges!], [0, 3]);
});
