import type { Engine } from "../pkg/ferrum_core.js";
import type { DataSceneSpatialSpec, SpatialRenderBufferView } from "./dataSceneSpatial.js";
import { requestsSpatialMaskPair } from "./spatialLightChannels.js";

/** Optional borrowed v1 receiver streams; empty arrays mean default255/255. */
export interface SpatialReceiverMaskBufferView {
  version: 1;
  stride: 2;
  /** Full static surface slots, including neutral non-rendered proxies. */
  terrain: Uint32Array;
  /** Actual visible/generated quad order. */
  billboards: Uint32Array;
  /** Actual ModelDraw order, including resident camera-culled instances. */
  models: Uint32Array;
}
type NativeMasks = Pick<Engine,
  "spatial_receiver_mask_abi_version" | "spatial_receiver_mask_size" |
  "spatial_terrain_receiver_mask_ptr" | "spatial_terrain_receiver_mask_len" |
  "spatial_billboard_receiver_mask_ptr" | "spatial_billboard_receiver_mask_len" |
  "spatial_model_receiver_mask_ptr" | "spatial_model_receiver_mask_len" |
  "configure_spatial_scene_receiver_masks">;
const names = ["spatial_receiver_mask_abi_version", "spatial_receiver_mask_size",
  "spatial_terrain_receiver_mask_ptr", "spatial_terrain_receiver_mask_len",
  "spatial_billboard_receiver_mask_ptr", "spatial_billboard_receiver_mask_len",
  "spatial_model_receiver_mask_ptr", "spatial_model_receiver_mask_len", "configure_spatial_scene_receiver_masks"] as const;
type Counts = Pick<SpatialRenderBufferView, "terrainVertexCount" | "billboardVertexCount" | "models">;
const limits = [256, Math.floor(64 * 1024 * 1024 / (44 * 6)), 1024];

/** Private batching key only; public material/model flags and reserved words stay intact. */
export function spatialReceiverMaskCode(data: Uint32Array | undefined, index: number): number {
  return data?.length ? data[index * 2] | data[index * 2 + 1] << 8 : 65535;
}

export function requestsSpatialReceiverMasks(spec?: DataSceneSpatialSpec): boolean {
  return !!spec && (spec.terrain.some(requestsSpatialMaskPair) || Object.values(spec.billboards).some(requestsSpatialMaskPair)
    || Object.values(spec.models ?? {}).some(requestsSpatialMaskPair));
}

export function supportsSpatialReceiverMasks(engine: unknown): engine is NativeMasks {
  const native = engine as Partial<NativeMasks>;
  return !!native && names.every(name => typeof native[name] === "function")
    && native.spatial_receiver_mask_abi_version!() === 1 && native.spatial_receiver_mask_size!() === 8;
}
export function validateSpatialReceiverMasks(frame: Counts & { receiverMasks?: SpatialReceiverMaskBufferView }): boolean {
  const masks = frame.receiverMasks;
  if (!masks) return false;
  if (masks.version !== 1 || masks.stride !== 2) throw Error("Invalid Spatial receiver mask ABI");
  const counts = [frame.terrainVertexCount / 36, frame.billboardVertexCount / 6, (frame.models?.words.length ?? 0) / 20];
  let custom = false;
  for (const [i, data] of [masks.terrain, masks.billboards, masks.models].entries()) {
    if (!(data instanceof Uint32Array) || data.length % 2 || data.length && (!Number.isSafeInteger(counts[i]) || counts[i] < 0 || counts[i] > limits[i] || data.length !== counts[i] * 2))
      throw Error("Misaligned Spatial receiver mask stream");
    for (const value of data) {
      if (value > 255) throw Error("Invalid Spatial receiver mask channel");
      custom ||= value !== 255;
    }
  }
  return custom;
}
export function readSpatialReceiverMasks(engine: unknown, memory: WebAssembly.Memory, frame: Counts): SpatialReceiverMaskBufferView | undefined {
  const native = engine as Partial<NativeMasks>;
  if (names.every(name => native[name] === undefined)) return undefined;
  if (!supportsSpatialReceiverMasks(native)) throw Error("Unsupported Spatial receiver mask ABI");
  const lengths = [native.spatial_terrain_receiver_mask_len(), native.spatial_billboard_receiver_mask_len(), native.spatial_model_receiver_mask_len()];
  if (lengths.every(length => length === 0)) return undefined;
  const pointers = [native.spatial_terrain_receiver_mask_ptr(), native.spatial_billboard_receiver_mask_ptr(), native.spatial_model_receiver_mask_ptr()];
  const arrays = lengths.map((length, i) => {
    if (!Number.isSafeInteger(length) || length < 0 || length > limits[i]) throw Error("Invalid Spatial receiver mask count");
    if (length === 0) return new Uint32Array();
    const pointer = pointers[i];
    if (!Number.isSafeInteger(pointer) || pointer < 0 || pointer % 4 || pointer + length * 8 > memory.buffer.byteLength)
      throw Error("Misaligned Spatial receiver mask buffer");
    return new Uint32Array(memory.buffer, pointer, length * 2);
  });
  const masks: SpatialReceiverMaskBufferView = { version: 1, stride: 2, terrain: arrays[0], billboards: arrays[1], models: arrays[2] };
  validateSpatialReceiverMasks({ ...frame, receiverMasks: masks });
  return masks;
}
