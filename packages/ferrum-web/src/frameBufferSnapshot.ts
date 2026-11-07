import type { FrameState } from "./engineTypes.js";
import type { RenderFrameState } from "./engineFramePipeline.js";
import type { RenderCommandBufferView } from "./renderCommandDecoder.js";
import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";

const ownedFrames = new WeakSet<FrameState>();

/** Preserve one presented frame across callbacks that may mutate/grow Wasm memory.
 * Only extension paths with a later consumer pay for these copies; the normal
 * update -> immediate GPU submission path continues to borrow native buffers.
 */
export function snapshotFrameBuffers(frame: FrameState): FrameState {
  if (ownedFrames.has(frame)) return frame;
  const effects = frame.effectEventBuffer;
  const result: FrameState = {
    ...frame,
    renderCommandBuffer: snapshotRenderCommandBuffer(frame.renderCommandBuffer),
    collisionEventBuffer: { ...frame.collisionEventBuffer, buffer: frame.collisionEventBuffer.buffer.slice() },
    gameplayEventBuffer: { ...frame.gameplayEventBuffer, buffer: frame.gameplayEventBuffer.buffer.slice() },
    effectEventBuffer: { ...effects, buffer: new DataView(
      effects.buffer.buffer.slice(effects.buffer.byteOffset, effects.buffer.byteOffset + effects.buffer.byteLength),
    ) },
    physicsDebugLineBuffer: { ...frame.physicsDebugLineBuffer, buffer: frame.physicsDebugLineBuffer.buffer.slice() },
  };
  ownedFrames.add(result);
  return result;
}

export function snapshotRenderFrameBuffers(frame: RenderFrameState): RenderFrameState {
  const state = frame.frameState === undefined ? undefined : snapshotFrameBuffers(frame.frameState);
  return {
    ...frame,
    renderCommandBuffer: state && frame.renderCommandBuffer === frame.frameState?.renderCommandBuffer
      ? state.renderCommandBuffer : snapshotRenderCommandBuffer(frame.renderCommandBuffer),
    ...(state === undefined ? {} : { frameState: state }),
    ...(frame.physicsDebugLineBuffer === undefined ? {} : {
      physicsDebugLineBuffer: state && frame.physicsDebugLineBuffer === frame.frameState?.physicsDebugLineBuffer
        ? state.physicsDebugLineBuffer : {
        ...frame.physicsDebugLineBuffer, buffer: frame.physicsDebugLineBuffer.buffer.slice(),
      },
    }),
  };
}

function snapshotRenderCommandBuffer(view: RenderCommandBufferView): RenderCommandBufferView {
  return {
    ...view,
    buffer: view.buffer.slice(),
    ...(view.groundShadowProjection === undefined ? {} : { groundShadowProjection: view.groundShadowProjection.slice() }),
    ...(view.groundShadowVolumes===undefined?{}:{groundShadowVolumes:{...view.groundShadowVolumes,buffer:view.groundShadowVolumes.buffer.slice()}}),
    ...(view.spriteNormalMaterials === undefined ? {} : {
      spriteNormalMaterials: { ...view.spriteNormalMaterials, buffer: view.spriteNormalMaterials.buffer.slice() },
    }),
    ...(view.spatial === undefined ? {} : { spatial: snapshotSpatial(view.spatial) }),
  };
}

function snapshotSpatial(view: SpatialRenderBufferView): SpatialRenderBufferView {
  const models = view.models;
  // Preserve the u32/f32 aliases over one owned model command packet.
  const modelWords = models?.words.slice();
  return {
    ...view,
    camera: view.camera.slice(),
    terrain: view.terrain.slice(),
    billboards: view.billboards.slice(),
    ...(view.version === 2 ? { version: 2, terrainDrawRanges: view.terrainDrawRanges.slice() } : {}),
    ...(view.presentation === undefined ? {} : { presentation: view.presentation.slice() }),
    ...(models === undefined || modelWords === undefined ? {} : { models: {
      ...models, words: modelWords, values: new Float32Array(modelWords.buffer), assets: new Map(models.assets),
    } }),
    ...(view.materials === undefined ? {} : { materials: {
      ...view.materials, terrain: view.materials.terrain.slice(), billboards: view.materials.billboards.slice(),
    } }),
    ...(view.debug === undefined ? {} : { debug: { ...view.debug, vertices: view.debug.vertices.slice() } }),
    ...(view.environment === undefined ? {} : { environment: {
      ...view.environment,
      values: view.environment.values.slice(), shadowMatrices: view.environment.shadowMatrices.slice(),
      shadowCasters: view.environment.shadowCasters.slice(),
      ...(view.environment.shadowSubmission === undefined ? {} : { shadowSubmission: {
        ...view.environment.shadowSubmission, ranges: view.environment.shadowSubmission.ranges.slice(),
      } }),
    } }),
  } as SpatialRenderBufferView;
}
