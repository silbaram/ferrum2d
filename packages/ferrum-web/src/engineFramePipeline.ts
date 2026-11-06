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
import { readPhysicsDiagnostics } from "./physicsDiagnostics.js";
import { snapshotFrameBuffers } from "./frameBufferSnapshot.js";
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
  /** Internal lifetime check; callbacks may synchronously destroy the engine. */
  isAlive?: () => boolean;
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
  if (context.isAlive?.() === false) return;
  const effectEventRuntime = context.options.effectEvents === false ? undefined : context.options.effectEvents;
  const shouldDispatchEffectEvents = effectEventRuntime !== undefined;
  const requestedFrameState = context.needsFrameState ?? context.onFrame !== undefined;
  const needsFrameState = requestedFrameState || shouldDispatchEffectEvents;
  const needsRenderFrame = context.onRenderFrame !== undefined;
  const shouldReadPhysicsDebugLineBuffer =
    context.needsPhysicsDebugLineBuffer === true
    || (needsFrameState && context.options.includePhysicsDebugLines === true);
  const needsRenderCommandBuffer = needsFrameState || needsRenderFrame;
  const input = context.inputProvider?.();
  if (context.isAlive?.() === false) return;
  pushInput(context.rustEngine, input);
  pushViewport(context);
  if (context.isAlive?.() === false) return;
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
    context.isAlive,
  );
  if (context.isAlive?.() === false) return;
  if (!needsFrameState && !needsRenderFrame) {
    return;
  }
  // The diagnostics query returns an allocated native Vec and can grow memory.
  // Complete it before borrowing any of this frame's telemetry/event/render views.
  const diagnosticsEngine = needsFrameState ? context.bridge.engine?.() : undefined;
  const physicsDiagnostics = diagnosticsEngine?.physics_diagnostics_enabled?.()
    ? readPhysicsDiagnostics(diagnosticsEngine) : undefined;
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
      physicsDiagnostics,
      options: shouldDispatchEffectEvents && context.options.includeEffectEvents === false
        ? { ...context.options, includeEffectEvents: true }
        : context.options,
    });
  } else if (shouldReadPhysicsDebugLineBuffer) {
    physicsDebugLineBuffer = context.bridge.readPhysicsDebugLineBuffer();
  }

  // Later public consumers must observe this frame even if an earlier renderer
  // or extension callback rebuilds the scene or grows native memory.
  if (frameState !== undefined && (
    effectEventRuntime?.onDispatchSummary !== undefined
    || (context.onFrame !== undefined && (needsRenderFrame || shouldDispatchEffectEvents))
  )) frameState = snapshotFrameBuffers(frameState);

  if (context.onRenderFrame) {
    const needsDebugCamera = physicsDebugLineBuffer !== undefined;
    context.onRenderFrame({
      renderCommandBuffer: frameState?.renderCommandBuffer ?? renderCommandBuffer,
      physicsDebugLineBuffer: physicsDebugLineBuffer === undefined ? undefined : frameState?.physicsDebugLineBuffer ?? physicsDebugLineBuffer,
      cameraX: frameState?.cameraX ?? (needsDebugCamera ? context.rustEngine.camera_x() : 0),
      cameraY: frameState?.cameraY ?? (needsDebugCamera ? context.rustEngine.camera_y() : 0),
      frameState,
    });
  }

  // Effect/native work runs only after GPU consumers have finished borrowing.
  if (context.isAlive?.() === false) return;
  if (effectEventRuntime !== undefined && frameState !== undefined) {
    const target = createEffectEventDispatchTarget({
      assetHost: context.assetHost,
      assetValidation: effectEventRuntime.assetValidation,
      hasSoundEffect: effectEventRuntime.hasSoundEffect,
      hasParticlePreset: effectEventRuntime.hasParticlePreset ?? context.particlePresetExists,
      spawnParticleBurst: (presetId, x, y) => context.isAlive?.() === false
        ? 0 : context.rustEngine.spawn_particle_burst(presetId, x, y),
      shakeCameraEffect: effectEventRuntime.shakeCameraEffect,
      applyCustomEffect: effectEventRuntime.applyCustomEffect,
      path: effectEventRuntime.path,
      target: effectEventRuntime.target,
    });
    if (context.isAlive?.() === false) return;
    dispatchRuntimeEffectEvents(
      frameState,
      { ...effectEventRuntime, onDispatchSummary: guardFrameCallback(effectEventRuntime.onDispatchSummary, context.isAlive, effectEventRuntime) },
      {
        playSoundEffect: guardFrameCallback(target.playSoundEffect, context.isAlive, target),
        spawnParticleEffect: guardFrameCallback(target.spawnParticleEffect, context.isAlive, target),
        shakeCameraEffect: guardFrameCallback(target.shakeCameraEffect, context.isAlive, target),
        applyCustomEffect: guardFrameCallback(target.applyCustomEffect, context.isAlive, target),
      },
    );
  }

  if (context.isAlive?.() === false) return;
  if (context.onFrame && frameState) {
    context.onFrame(frameState);
  }
}

function guardFrameCallback<Args extends unknown[]>(callback: ((...args: Args) => void) | undefined,
  isAlive: (() => boolean) | undefined, receiver: unknown): ((...args: Args) => void) | undefined {
  if (!callback) return undefined;
  return (...args) => { if (isAlive?.() !== false) callback.apply(receiver, args); };
}

function pushInput(rustEngine: Engine, input: InputSnapshot | undefined): void {
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
}

function pushViewport(context: FramePipelineContext): void {
  const viewport = context.viewportProvider?.();
  if (!viewport || context.isAlive?.() === false) {
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
