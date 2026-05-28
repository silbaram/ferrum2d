import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { RuntimeFrameRenderer } from "../src/runtimeFrameRenderer.js";
import type { RenderFrameState } from "../src/engineFramePipeline.js";
import type { FrameState, PhysicsFrameStats } from "../src/engineTypes.js";
import type { FerrumRuntimeFrame, FerrumRuntimeRenderer } from "../src/createFerrumRuntime.js";
import { emptyRendererStats } from "../src/renderer.js";
import type { RendererStats } from "../src/renderer.js";

test("RuntimeFrameRenderer preserves dynamic provider, render, overlay, profiler, and onFrame order", () => {
  const order: string[] = [];
  const postProcessStats = rendererStats({ drawCalls: 7, postProcessDrawCalls: 1, postProcessPassCount: 1 });
  const renderer = fakeRuntimeRenderer(order, { postProcess: postProcessStats });
  let onFrameRuntimeFrame: FerrumRuntimeFrame | undefined;
  const runtimeFrameRenderer = new RuntimeFrameRenderer({
    renderer,
    lighting: (frame) => {
      order.push(`lighting_provider:${frame.score}`);
      return false;
    },
    spriteMaterial: (frame) => {
      order.push(`sprite_provider:${frame.score}`);
      return false;
    },
    postProcess: (frame) => {
      order.push(`post_provider:${frame.score}`);
      return false;
    },
    shouldRenderPhysicsDebugLines: true,
    needsRuntimeFrame: true,
    debugOverlay: {
      update: (metrics: unknown) => {
        order.push("debug_update");
        equal((metrics as { drawCalls: number }).drawCalls, postProcessStats.drawCalls);
      },
    } as never,
    uiOverlay: {
      update: () => {
        order.push("ui_update");
      },
    } as never,
    uiState: (runtimeFrame) => {
      order.push("ui_state");
      equal(runtimeFrame.rendererStats, postProcessStats);
      return {};
    },
    profiler: {
      recordFrame: () => {
        order.push("profiler_record");
        return { passed: true, violations: [] };
      },
    } as never,
    onFrame: (runtimeFrame) => {
      order.push("on_frame");
      onFrameRuntimeFrame = runtimeFrame;
    },
    now: steppedNow(100, 200, 250),
  });

  runtimeFrameRenderer.renderFrame(renderFrameState({ frameState: frameState(), includePhysicsDebugLines: true }));

  deepEqual(order, [
    "lighting_provider:99",
    "set_lighting",
    "sprite_provider:99",
    "set_sprite",
    "post_provider:99",
    "set_post",
    "render",
    "render_commands",
    "render_debug:11,22",
    "post_process",
    "debug_update",
    "ui_state",
    "ui_update",
    "profiler_record",
    "on_frame",
  ]);
  equal(onFrameRuntimeFrame?.rendererStats, postProcessStats);
  equal(onFrameRuntimeFrame?.renderTimeMs, 50);
  equal(onFrameRuntimeFrame?.fps, 62.5);
});

test("RuntimeFrameRenderer render-only fast path does not require FrameState", () => {
  const order: string[] = [];
  const renderer = fakeRuntimeRenderer(order);
  const runtimeFrameRenderer = new RuntimeFrameRenderer({
    renderer,
    shouldRenderPhysicsDebugLines: false,
    needsRuntimeFrame: false,
    onFrame: () => {
      throw new Error("onFrame should not run in render-only mode");
    },
  });

  runtimeFrameRenderer.renderFrame(renderFrameState());

  deepEqual(order, [
    "render",
    "render_commands",
    "post_process",
  ]);
});

test("RuntimeFrameRenderer supports dynamic providers without runtime diagnostics", () => {
  const order: string[] = [];
  const renderer = fakeRuntimeRenderer(order);
  const runtimeFrameRenderer = new RuntimeFrameRenderer({
    renderer,
    lighting: (frame) => {
      order.push(`lighting_provider:${frame.timeSeconds}`);
      return false;
    },
    shouldRenderPhysicsDebugLines: false,
    needsRuntimeFrame: false,
  });

  runtimeFrameRenderer.renderFrame(renderFrameState({ frameState: frameState({ timeSeconds: 12 }) }));

  deepEqual(order, [
    "lighting_provider:12",
    "set_lighting",
    "render",
    "render_commands",
    "post_process",
  ]);
});

function fakeRuntimeRenderer(
  order: string[],
  stats: {
    commands?: RendererStats;
    physicsDebugLines?: RendererStats;
    postProcess?: RendererStats;
  } = {},
): FerrumRuntimeRenderer {
  const commandStats = stats.commands ?? rendererStats({ drawCalls: 1, batchCount: 1, renderCommandCount: 2 });
  const debugStats = stats.physicsDebugLines ?? rendererStats({ drawCalls: 2, physicsDebugLineCount: 3 });
  const postProcessStats = stats.postProcess ?? rendererStats({ drawCalls: 3, postProcessDrawCalls: 1 });
  return {
    render: () => {
      order.push("render");
    },
    resize: () => undefined,
    stats: () => commandStats,
    destroy: () => undefined,
    loadTexture: async () => undefined,
    renderCommands: () => {
      order.push("render_commands");
      return commandStats;
    },
    renderPhysicsDebugLines: (_lines: unknown, camera: { x: number; y: number }) => {
      order.push(`render_debug:${camera.x},${camera.y}`);
      return debugStats;
    },
    viewportSize: () => ({ width: 640, height: 360 }),
    setLighting: () => {
      order.push("set_lighting");
    },
    setSpriteMaterial: () => {
      order.push("set_sprite");
    },
    setPostProcess: () => {
      order.push("set_post");
    },
    renderPostProcess: () => {
      order.push("post_process");
      return postProcessStats;
    },
  } as unknown as FerrumRuntimeRenderer;
}

function rendererStats(overrides: Partial<RendererStats> = {}): RendererStats {
  return {
    ...emptyRendererStats(),
    ...overrides,
  };
}

function renderFrameState(args: {
  frameState?: FrameState;
  includePhysicsDebugLines?: boolean;
} = {}): RenderFrameState {
  return {
    renderCommandBuffer: {
      buffer: new Float32Array(0),
      commandCount: 2,
      floatsPerCommand: 14,
    } as never,
    ...(args.includePhysicsDebugLines
      ? {
          physicsDebugLineBuffer: {
            buffer: new Float32Array(0),
            lineCount: 3,
            floatsPerLine: 8,
          } as never,
        }
      : {}),
    cameraX: 11,
    cameraY: 22,
    ...(args.frameState === undefined ? {} : { frameState: args.frameState }),
  };
}

function frameState(overrides: Partial<FrameState> = {}): FrameState {
  return {
    timeSeconds: 1,
    frameTimeMs: 16,
    rustUpdateTimeMs: 2,
    score: 99,
    entityCount: 4,
    gameState: 1,
    spriteCount: 5,
    mouseX: 6,
    mouseY: 7,
    cameraX: 11,
    cameraY: 22,
    audioEventCount: 2,
    audioEvents: [],
    physics: physicsFrameStats(),
    collisionEventBuffer: {
      buffer: new Uint32Array(0),
      eventCount: 0,
      u32sPerEvent: 5,
    } as never,
    collisionEvents: [],
    physicsDebugLineBuffer: {
      buffer: new Float32Array(0),
      lineCount: 0,
      floatsPerLine: 8,
    } as never,
    physicsDebugLines: [],
    renderCommands: [],
    renderCommandBuffer: {
      buffer: new Float32Array(0),
      commandCount: 2,
      floatsPerCommand: 14,
    } as never,
    ...overrides,
  };
}

function physicsFrameStats(): PhysicsFrameStats {
  return {
    mode: "arcade",
    gravityX: 0,
    gravityY: 0,
    continuous: false,
    fixedTimestepEnabled: true,
    fixedStepSeconds: 1 / 60,
    fixedSteps: 1,
    fixedAlpha: 0,
    fixedConsumedSeconds: 0,
    fixedDroppedSeconds: 0,
    kinematicMoves: 0,
    kinematicHits: 0,
    kinematicEntityHits: 0,
    kinematicTileHits: 0,
    solidCandidateChecks: 0,
    tileCandidateChecks: 0,
    collisionPairs: 0,
    collisionSolidPairs: 0,
    collisionTriggerPairs: 0,
    collisionEnterEvents: 0,
    collisionStayEvents: 0,
    collisionExitEvents: 0,
    collisionHitEvents: 0,
    collisionTriggerEnterEvents: 0,
    collisionTriggerStayEvents: 0,
    collisionTriggerExitEvents: 0,
    collisionEventCount: 0,
    ccdChecks: 0,
    ccdHits: 0,
    sleepingBodies: 0,
    brokenJoints: 0,
  };
}

function steppedNow(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}
