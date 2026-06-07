import type { Engine } from "../pkg/ferrum_core";
import type {
  AssetHost,
  CreateEngineOptions,
  FrameHandler,
  FrameState,
  InputProvider,
  ViewportProvider,
} from "./engineTypes.js";
import type { InputSnapshot } from "./inputManager";
import type { ResolvedPhysicsSpec } from "./physicsSpec.js";
import { U32S_PER_COLLISION_EVENT } from "./collisionEventDecoder.js";
import { drainAudioEvents } from "./engineFrameAudio.js";
import { buildFrameState } from "./engineFrameState.js";
import { createEffectEventDispatchTarget, dispatchRuntimeEffectEvents } from "./effectEventRuntime.js";
import { BYTES_PER_EFFECT_EVENT } from "./effectEventDecoder.js";
import { U32S_PER_GAMEPLAY_EVENT } from "./gameplayEventDecoder.js";
import { FLOATS_PER_PHYSICS_DEBUG_LINE } from "./physicsDebugLineDecoder.js";
import type {
  CollisionEventBufferView,
  EffectEventBufferView,
  GameplayEventBufferView,
  PhysicsDebugLineBufferView,
  RenderCommandBufferView,
  WasmBridge,
} from "./wasmBridge";

export interface FramePipelineContext {
  bridge: WasmBridge;
  rustEngine: Engine;
  physicsSpec: ResolvedPhysicsSpec;
  onFrame?: FrameHandler;
  onRenderFrame?: RenderFrameHandler;
  needsFrameState?: boolean;
  needsPhysicsDebugLineBuffer?: boolean;
  inputProvider?: InputProvider;
  assetHost?: AssetHost;
  particlePresetExists?: (presetId: number) => boolean;
  viewportProvider?: ViewportProvider;
  lastViewportWidth?: number;
  lastViewportHeight?: number;
  viewportDirty?: boolean;
  options: CreateEngineOptions;
}

export interface RenderFrameState {
  renderCommandBuffer: RenderCommandBufferView;
  physicsDebugLineBuffer?: PhysicsDebugLineBufferView;
  cameraX: number;
  cameraY: number;
  frameState?: FrameState;
}

export type RenderFrameHandler = (state: RenderFrameState) => void;

const EMPTY_COLLISION_EVENT_BUFFER: CollisionEventBufferView = {
  buffer: new Uint32Array(0),
  eventCount: 0,
  u32sPerEvent: U32S_PER_COLLISION_EVENT,
};
const EMPTY_PHYSICS_DEBUG_LINE_BUFFER: PhysicsDebugLineBufferView = {
  buffer: new Float32Array(0),
  lineCount: 0,
  floatsPerLine: FLOATS_PER_PHYSICS_DEBUG_LINE,
};
const EMPTY_GAMEPLAY_EVENT_BUFFER: GameplayEventBufferView = {
  buffer: new Uint32Array(0),
  eventCount: 0,
  u32sPerEvent: U32S_PER_GAMEPLAY_EVENT,
};
const EMPTY_EFFECT_EVENT_BUFFER: EffectEventBufferView = {
  buffer: new DataView(new ArrayBuffer(0)),
  eventCount: 0,
  bytesPerEvent: BYTES_PER_EFFECT_EVENT,
};

export function runFrame(context: FramePipelineContext, deltaSeconds: number): void {
  const effectEventRuntime = context.options.effectEvents === false ? undefined : context.options.effectEvents;
  const shouldDispatchEffectEvents = effectEventRuntime !== undefined;
  const requestedFrameState = context.needsFrameState ?? context.onFrame !== undefined;
  const needsFrameState = requestedFrameState || shouldDispatchEffectEvents;
  const needsRenderFrame = context.onRenderFrame !== undefined;
  const shouldReadPhysicsDebugLineBuffer =
    context.needsPhysicsDebugLineBuffer === true
    || (needsFrameState && context.options.includePhysicsDebugLines === true);
  const needsRenderCommandBuffer = needsFrameState || needsRenderFrame;
  const input = pushInput(context.rustEngine, context.inputProvider);
  pushViewport(context);
  const rustUpdateTimeMs = updateRust(
    context.rustEngine,
    deltaSeconds,
    needsFrameState,
    needsRenderCommandBuffer,
    needsFrameState,
    shouldReadPhysicsDebugLineBuffer,
  );
  const shouldIncludeAudioEvents = needsFrameState && (context.options.includeAudioEvents ?? true);
  const audioEvents = drainAudioEvents(
    context.bridge,
    context.rustEngine,
    context.assetHost,
    shouldIncludeAudioEvents,
  );
  if (!needsFrameState && !needsRenderFrame) {
    return;
  }
  const renderCommandBuffer = context.bridge.readRenderCommandBuffer();
  let frameState: FrameState | undefined;
  let physicsDebugLineBuffer: PhysicsDebugLineBufferView | undefined;

  if (needsFrameState) {
    const frameTelemetryBuffer = context.bridge.readFrameTelemetryBuffer();
    const collisionEventBuffer = context.options.includeCollisionEvents === true
      ? context.bridge.readCollisionEventBuffer()
      : EMPTY_COLLISION_EVENT_BUFFER;
    const gameplayEventBuffer = context.options.includeGameplayEvents === false
      ? EMPTY_GAMEPLAY_EVENT_BUFFER
      : context.bridge.readGameplayEventBuffer();
    const effectEventBuffer = context.options.includeEffectEvents === false && !shouldDispatchEffectEvents
      ? EMPTY_EFFECT_EVENT_BUFFER
      : context.bridge.readEffectEventBuffer();
    physicsDebugLineBuffer = shouldReadPhysicsDebugLineBuffer
      ? context.bridge.readPhysicsDebugLineBuffer()
      : EMPTY_PHYSICS_DEBUG_LINE_BUFFER;
    frameState = buildFrameState({
      bridge: context.bridge,
      deltaSeconds,
      rustUpdateTimeMs,
      input,
      audioEvents,
      frameTelemetryBuffer,
      renderCommandBuffer,
      collisionEventBuffer,
      gameplayEventBuffer,
      effectEventBuffer,
      physicsDebugLineBuffer,
      physicsSpec: context.physicsSpec,
      options: shouldDispatchEffectEvents && context.options.includeEffectEvents === false
        ? { ...context.options, includeEffectEvents: true }
        : context.options,
    });
  } else if (shouldReadPhysicsDebugLineBuffer) {
    physicsDebugLineBuffer = context.bridge.readPhysicsDebugLineBuffer();
  }

  if (effectEventRuntime !== undefined && frameState !== undefined) {
    dispatchRuntimeEffectEvents(
      frameState,
      effectEventRuntime,
      createEffectEventDispatchTarget({
        assetHost: context.assetHost,
        assetValidation: effectEventRuntime.assetValidation,
        hasSoundEffect: effectEventRuntime.hasSoundEffect,
        hasParticlePreset: effectEventRuntime.hasParticlePreset ?? context.particlePresetExists,
        spawnParticleBurst: (presetId, x, y) => context.rustEngine.spawn_particle_burst(presetId, x, y),
        shakeCameraEffect: effectEventRuntime.shakeCameraEffect,
        applyCustomEffect: effectEventRuntime.applyCustomEffect,
        path: effectEventRuntime.path,
        target: effectEventRuntime.target,
      }),
    );
  }

  if (context.onRenderFrame) {
    const needsDebugCamera = physicsDebugLineBuffer !== undefined;
    context.onRenderFrame({
      renderCommandBuffer,
      physicsDebugLineBuffer,
      cameraX: frameState?.cameraX ?? (needsDebugCamera ? context.rustEngine.camera_x() : 0),
      cameraY: frameState?.cameraY ?? (needsDebugCamera ? context.rustEngine.camera_y() : 0),
      frameState,
    });
  }
  if (context.onFrame && frameState) {
    context.onFrame(frameState);
  }
}

function pushInput(rustEngine: Engine, inputProvider?: InputProvider): InputSnapshot | undefined {
  const input = inputProvider?.();
  if (!input) {
    return undefined;
  }
  rustEngine.set_input(
    input.w,
    input.a,
    input.s,
    input.d,
    input.space,
    input.enter,
    input.mouseLeft,
    input.mouseX,
    input.mouseY,
  );
  return input;
}

function pushViewport(context: FramePipelineContext): void {
  const viewport = context.viewportProvider?.();
  if (!viewport) {
    return;
  }
  if (
    context.viewportDirty === true
    || viewport.width !== context.lastViewportWidth
    || viewport.height !== context.lastViewportHeight
  ) {
    context.rustEngine.set_viewport_size(viewport.width, viewport.height);
    context.lastViewportWidth = viewport.width;
    context.lastViewportHeight = viewport.height;
    context.viewportDirty = false;
  }
}

function updateRust(
  rustEngine: Engine,
  deltaSeconds: number,
  measure: boolean,
  renderCommands: boolean,
  frameTelemetry: boolean,
  physicsDebugLines: boolean,
): number {
  if (!measure) {
    rustEngine.update_frame(deltaSeconds, renderCommands, frameTelemetry, physicsDebugLines);
    return 0;
  }
  const updateStartMs = performance.now();
  rustEngine.update_frame(deltaSeconds, renderCommands, frameTelemetry, physicsDebugLines);
  return performance.now() - updateStartMs;
}
