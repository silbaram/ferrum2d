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
import { drainAudioEvents } from "./engineFrameAudio.js";
import { buildFrameState } from "./engineFrameState.js";
import type {
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
  viewportProvider?: ViewportProvider;
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

export function runFrame(context: FramePipelineContext, deltaSeconds: number): void {
  const input = pushInput(context.rustEngine, context.inputProvider);
  pushViewport(context.rustEngine, context.viewportProvider);
  const rustUpdateTimeMs = updateRust(context.rustEngine, deltaSeconds);
  const needsFrameState = context.needsFrameState ?? context.onFrame !== undefined;
  const needsRenderFrame = context.onRenderFrame !== undefined;
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
    const collisionEventBuffer = context.bridge.readCollisionEventBuffer();
    physicsDebugLineBuffer = context.bridge.readPhysicsDebugLineBuffer();
    frameState = buildFrameState({
      bridge: context.bridge,
      rustEngine: context.rustEngine,
      deltaSeconds,
      rustUpdateTimeMs,
      input,
      audioEvents,
      renderCommandBuffer,
      collisionEventBuffer,
      physicsDebugLineBuffer,
      physicsSpec: context.physicsSpec,
      options: context.options,
    });
  } else if (context.needsPhysicsDebugLineBuffer) {
    physicsDebugLineBuffer = context.bridge.readPhysicsDebugLineBuffer();
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

function pushViewport(rustEngine: Engine, viewportProvider?: ViewportProvider): void {
  const viewport = viewportProvider?.();
  if (viewport) {
    rustEngine.set_viewport_size(viewport.width, viewport.height);
  }
}

function updateRust(rustEngine: Engine, deltaSeconds: number): number {
  const updateStartMs = performance.now();
  rustEngine.update(deltaSeconds);
  return performance.now() - updateStartMs;
}
