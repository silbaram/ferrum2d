import './nativeRuntimeTestHelper.js';
import { test } from 'node:test';
import { deepEqual, equal, ok, throws } from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readSpatialReceiverMasks, supportsSpatialReceiverMasks, validateSpatialReceiverMasks } from '../src/spatialReceiverMasks.js';
import { snapshotRenderFrameBuffers } from '../src/frameBufferSnapshot.js';
import type { SpatialRenderBufferView } from '../src/dataSceneSpatial.js';

function setup() {
  const memory = new WebAssembly.Memory({ initial: 2 });
  const write = (pointer: number, values: number[]) => new Uint32Array(memory.buffer, pointer, values.length).set(values);
  write(64, [0, 3]); write(80, [255, 255, 1, 0]); write(96, [2, 3]);
  const native = {
    spatial_receiver_mask_abi_version: () => 1, spatial_receiver_mask_size: () => 8,
    configure_spatial_scene_receiver_masks: () => true,
    spatial_terrain_receiver_mask_ptr: () => 64, spatial_terrain_receiver_mask_len: () => 1,
    spatial_billboard_receiver_mask_ptr: () => 80, spatial_billboard_receiver_mask_len: () => 2,
    spatial_model_receiver_mask_ptr: () => 96, spatial_model_receiver_mask_len: () => 1,
  };
  const words = new Uint32Array(memory.buffer, 256, 20);
  const frame: SpatialRenderBufferView = {
    version: 1, vertexStride: 11, camera: new Float32Array(28), terrain: new Float32Array(36 * 11),
    terrainVertexCount: 36, terrainRevision: 1, billboards: new Float32Array(12 * 11), billboardVertexCount: 12,
    models: { version: 1, stride: 20, words, values: new Float32Array(memory.buffer, 256, 20), assets: new Map() },
  };
  return { memory, native, frame, write };
}

test('Spatial receiver reader keeps independent streams and owned deferred copies after memory growth', () => {
  const { native, memory, frame } = setup();
  equal(readSpatialReceiverMasks({}, memory, frame), undefined); ok(supportsSpatialReceiverMasks(native));
  const masks = readSpatialReceiverMasks(native, memory, frame)!;
  deepEqual([...masks.terrain], [0, 3]); deepEqual([...masks.billboards], [255, 255, 1, 0]); deepEqual([...masks.models], [2, 3]);
  ok(validateSpatialReceiverMasks({ ...frame, receiverMasks: masks }));
  const owned = snapshotRenderFrameBuffers({ renderCommandBuffer: { buffer: new Float32Array(), commandCount: 0, floatsPerCommand: 15, spatial: { ...frame, receiverMasks: masks } }, cameraX: 0, cameraY: 0 });
  memory.grow(1); equal(masks.terrain.length, 0);
  const copied = owned.renderCommandBuffer.spatial!.receiverMasks!;
  deepEqual([...copied.terrain], [0, 3]); deepEqual([...copied.billboards], [255, 255, 1, 0]); deepEqual([...copied.models], [2, 3]);
  ok(owned.renderCommandBuffer.spatial!.models!.words.buffer === owned.renderCommandBuffer.spatial!.models!.values.buffer);
});

test('Spatial receiver reader rejects partial/version/size, pointers, counts and malformed channels', () => {
  const { native, memory, frame, write } = setup();
  for (const changed of [
    { spatial_receiver_mask_abi_version: () => 2 }, { spatial_receiver_mask_size: () => 4 },
    { configure_spatial_scene_receiver_masks: undefined }, { spatial_model_receiver_mask_ptr: undefined },
    { spatial_billboard_receiver_mask_ptr: () => 81 }, { spatial_model_receiver_mask_ptr: () => memory.buffer.byteLength - 4 },
    { spatial_terrain_receiver_mask_len: () => 2 }, { spatial_model_receiver_mask_len: () => -1 },
    { spatial_billboard_receiver_mask_len: () => 0.5 },
  ]) throws(() => readSpatialReceiverMasks({ ...native, ...changed }, memory, frame), /mask/);
  write(96, [256, 3]); throws(() => readSpatialReceiverMasks(native, memory, frame), /channel/);
  write(64, [255, 255]); write(80, [255, 255, 255, 255]); write(96, [255, 255]);
  equal(validateSpatialReceiverMasks({ ...frame, receiverMasks: readSpatialReceiverMasks(native, memory, frame) }), false);
  equal(readSpatialReceiverMasks({ ...native, spatial_terrain_receiver_mask_len: () => 0, spatial_billboard_receiver_mask_len: () => 0, spatial_model_receiver_mask_len: () => 0 }, memory, frame), undefined);
});

test('generated visible receiver rows may exceed authored billboard count without losing alignment', () => {
  const count = 10001, data = new Uint32Array(count * 2).fill(255); data[data.length - 1] = 0;
  ok(validateSpatialReceiverMasks({ terrainVertexCount: 0, billboardVertexCount: count * 6,
    receiverMasks: { version: 1, stride: 2, terrain: new Uint32Array(), billboards: data, models: new Uint32Array() } }));
  throws(() => validateSpatialReceiverMasks({ terrainVertexCount: 0, billboardVertexCount: 6,
    receiverMasks: { version: 1, stride: 2, terrain: new Uint32Array(), billboards: data, models: new Uint32Array() } }), /Misaligned/);
});

test('actual native Spatial sidecars retain old geometry/material/model ABIs and explicit zero', async () => {
  const core = await import('../pkg/ferrum_core.js');
  const wasm = core.initSync({ module: await readFile(new URL('../pkg/ferrum_core_bg.wasm', import.meta.url)) }), native = new core.Engine();
  try {
    native.use_data_scene(); native.set_viewport_size(400, 300);
    ok(native.spawn_data_scene_entity(0, 0, 0, 0, 7, 32, 64, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, true, true, 8, 8, 0, 0, 0, 0, 0, 0, new Float32Array()));
    const handle = [native.data_scene_entity_id(), native.data_scene_entity_generation()];
    ok(native.configure_spatial_scene_receiver_masks(
      new Float32Array([0, 0, 100, 200, 0, 16, 0, 200, .1, 1000, 400, 300]),
      new Float32Array([-32, -32, 64, 64, 0, 16, 16, 1, 1, 1, 1]), new Uint32Array([1, 0, 16777215, 1]),
      new Uint32Array(handle), new Float32Array([1, .5, 0]), new Uint32Array(), new Float32Array(), new Uint32Array(), new Float32Array(),
      new Uint32Array(), new Uint32Array(), new Uint32Array(), new Float32Array(), new Uint32Array([0, 1]), new Uint32Array([1, 0]), new Uint32Array()));
    native.update(0);
    const masks = readSpatialReceiverMasks(native, wasm.memory, { terrainVertexCount: native.spatial_terrain_len(), billboardVertexCount: native.spatial_billboard_len() })!;
    deepEqual([...masks.terrain], [0, 1]); deepEqual([...masks.billboards], [1, 0]); equal(masks.models.length, 0);
    equal(native.spatial_material_abi_version(), 1); equal(native.spatial_model_stride(), 20);
    native.clear_spatial_scene(); equal(native.spatial_terrain_receiver_mask_len(), 0);
  } finally { native.free(); }
});
