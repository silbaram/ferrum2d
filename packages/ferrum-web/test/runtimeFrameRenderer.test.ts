import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { RuntimeFrameRenderer } from "../src/runtimeFrameRenderer.js";
import type { RenderFrameState } from "../src/engineFramePipeline.js";
import type { FrameState, PhysicsFrameStats } from "../src/engineTypes.js";
import type { FerrumRuntimeFrame, FerrumRuntimeRenderer } from "../src/createFerrumRuntime.js";
import { GAME_STATE_CODE } from "../src/gameState.js";
import { emptyRendererStats } from "../src/renderer.js";
import type { RendererStats } from "../src/renderer.js";

test("frame rendering accepts a backend-neutral command sink without asset or lifecycle methods", () => {
  const order: string[] = [];
  const runtime = new RuntimeFrameRenderer({
    renderer: {
      render: () => { order.push("clear"); },
      renderCommands: () => { order.push("commands"); return emptyRendererStats(); },
    },
    shouldRenderPhysicsDebugLines: false,
    needsRuntimeFrame: false,
  });
  runtime.renderFrame(renderFrameState());
  deepEqual(order, ["clear", "commands"]);
});

test("custom renderer callbacks cannot detach the packet before submission", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const buffer = new Float32Array(memory.buffer, 0, 15);
  buffer[0] = 42;
  const frame = renderFrameState();
  frame.renderCommandBuffer = { ...frame.renderCommandBuffer, buffer, commandCount: 1 };
  const runtime = new RuntimeFrameRenderer({
    renderer: {
      isRenderReady: () => { memory.grow(1); return true; },
      render: () => { new Float32Array(memory.buffer)[0] = 99; memory.grow(1); },
      renderCommands: (packet) => {
        equal(packet.buffer.length, 15);
        equal(packet.buffer[0], 42);
        return emptyRendererStats();
      },
    },
    shouldRenderPhysicsDebugLines: false,
    needsRuntimeFrame: false,
  });
  runtime.renderFrame(frame);
});

test("built-in render consumer keeps the original native packet", () => {
  const frame = renderFrameState();
  const runtime = new RuntimeFrameRenderer({
    renderer: {
      render: () => {},
      renderCommands: (packet) => { equal(packet, frame.renderCommandBuffer); return emptyRendererStats(); },
    },
    borrowNativeBuffers: true,
    shouldRenderPhysicsDebugLines: false,
    needsRuntimeFrame: false,
  });
  runtime.renderFrame(frame);
});

test("unsupported debug rendering fails before touching the frame target", () => {
  const order: string[] = [];
  const runtime = new RuntimeFrameRenderer({
    renderer: {
      render: () => { order.push("clear"); },
      renderCommands: () => emptyRendererStats(),
    },
    shouldRenderPhysicsDebugLines: true,
    needsRuntimeFrame: false,
  });
  throws(() => runtime.renderFrame(renderFrameState({ includePhysicsDebugLines: true })), /Renderer does not support physics debug lines/);
  deepEqual(order, []);
});

test("unsupported spatial packets fail before providers, clear or GPU timing", () => {
  const order: string[] = [];
  const runtime = new RuntimeFrameRenderer({
    renderer: {
      render: () => { order.push("clear"); },
      renderCommands: () => emptyRendererStats(),
      beginGpuTiming: () => { order.push("gpu_begin"); },
    },
    lighting: () => { order.push("lighting"); return false; },
    shouldRenderPhysicsDebugLines: false,
    needsRuntimeFrame: false,
  });
  const frame = renderFrameState({ frameState: frameState() });
  frame.renderCommandBuffer = { ...frame.renderCommandBuffer, spatial: {
    version: 1, vertexStride: 11, camera: new Float32Array(28),
    terrain: new Float32Array(0), terrainVertexCount: 0, terrainRevision: 0,
    billboards: new Float32Array(0), billboardVertexCount: 0,
  } };
  throws(() => runtime.renderFrame(frame), /Renderer does not support spatial scene geometry/);
  deepEqual(order, []);
});

test("optional debug capability retains the injected renderer receiver", () => {
  let debugCalls = 0;
  const renderer = {
    render() {},
    renderCommands: () => emptyRendererStats(),
    renderPhysicsDebugLines() {
      equal(this, renderer);
      debugCalls++;
      return emptyRendererStats();
    },
  };
  const runtime = new RuntimeFrameRenderer({ renderer, shouldRenderPhysicsDebugLines: true, needsRuntimeFrame: false });
  runtime.renderFrame(renderFrameState({ includePhysicsDebugLines: true }));
  equal(debugCalls, 1);
});

test("custom consumers must opt into volume sidecars before clear or provider callbacks",()=>{
  let clears=0;
  const frame=renderFrameState();
  frame.renderCommandBuffer.groundShadowVolumes={version:1,stride:3,vertexCount:3,casterCount:1,buffer:new Float32Array([0,0,1,10,0,1,0,10,1])};
  const renderer={render(){clears++;},renderCommands:()=>emptyRendererStats()};
  const runtime=new RuntimeFrameRenderer({renderer,needsRuntimeFrame:false,shouldRenderPhysicsDebugLines:false});
  throws(()=>runtime.renderFrame(frame),/does not support ground shadow volume/);equal(clears,0);
  const capable=new RuntimeFrameRenderer({renderer:{...renderer,supportsGroundShadowVolumes:true},needsRuntimeFrame:false,shouldRenderPhysicsDebugLines:false});
  capable.renderFrame(frame);equal(clears,1);
});

test("runtime brackets all GPU passes and publishes delayed query plus Wasm capacity", () => {
  const order: string[] = [];
  const renderer = fakeRuntimeRenderer(order);
  renderer.beginGpuTiming = () => { order.push("gpu_begin"); };
  renderer.endGpuTiming = () => { order.push("gpu_end"); };
  renderer.gpuTimingStats = () => ({ status: "ready", elapsedMs: 2.5, frameId: 7, pendingQueryCount: 1 });
  let published: FerrumRuntimeFrame | undefined;
  const runtime = new RuntimeFrameRenderer({ renderer, shouldRenderPhysicsDebugLines: true, needsRuntimeFrame: true,
    onFrame: (frame) => { published = frame; } });
  runtime.renderFrame(renderFrameState({ frameState: frameState({ wasmLinearMemoryBytes: 65536 }), includePhysicsDebugLines: true }));
  deepEqual(order, ["gpu_begin", "render", "render_commands", "render_debug:11,22", "post_process", "gpu_end"]);
  equal(published?.debugMetrics.gpuFrameTimeMs, 2.5);
  equal(published?.debugMetrics.gpuFrameId, 7);
  equal(published?.debugMetrics.wasmLinearMemoryBytes, 65536);
  renderer.gpuTimingStats = () => ({ status: "pending", pendingQueryCount: 2 });
  runtime.renderFrame(renderFrameState({ frameState: frameState() }));
  equal(published?.debugMetrics.gpuFrameTimeMs, undefined);
});

test("runtime closes its GPU query when a render pass throws", () => {
  const order: string[] = [];
  const renderer = fakeRuntimeRenderer(order);
  renderer.beginGpuTiming = () => { order.push("gpu_begin"); };
  renderer.endGpuTiming = (discard) => { order.push("gpu_end"); equal(discard, true); };
  renderer.renderCommands = () => { throw new Error("render failed"); };
  const runtime = new RuntimeFrameRenderer({ renderer, shouldRenderPhysicsDebugLines: false, needsRuntimeFrame: false });
  throws(() => runtime.renderFrame(renderFrameState()), /render failed/);
  deepEqual(order, ["gpu_begin", "render", "gpu_end"]);
});

test("RuntimeFrameRenderer preserves dynamic provider, render, overlay, profiler, and onFrame order", () => {
  const order: string[] = [];
  const postProcessStats = rendererStats({ drawCalls: 7, postProcessDrawCalls: 1, postProcessPassCount: 1, normalDrawCalls: 2 });
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
        equal((metrics as { normalDrawCalls: number }).normalDrawCalls, 2);
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
    animationTimeline: {
      update: () => {
        order.push("animation_timeline_update");
        return undefined;
      },
    } as never,
    cutscene: {
      update: () => {
        order.push("cutscene_update");
        return undefined;
      },
    } as never,
    levelStreaming: {
      update: () => {
        order.push("level_streaming_update");
        return undefined;
      },
    } as never,
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
    "animation_timeline_update",
    "cutscene_update",
    "level_streaming_update",
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
    physicsDebugLineComposer: () => {
      throw new Error("disabled debug line composer should not run");
    },
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

test("RuntimeFrameRenderer composes physics debug lines before renderer stats are published", () => {
  const order: string[] = [];
  const baseRenderer = fakeRuntimeRenderer(order);
  const composedStats = rendererStats({ drawCalls: 2, physicsDebugLineCount: 5 });
  const renderer = {
    ...baseRenderer,
    renderPhysicsDebugLines: (lines: { lineCount: number }, camera: { x: number; y: number }) => {
      order.push(`render_debug:${lines.lineCount}:${camera.x},${camera.y}`);
      composedStats.physicsDebugLineCount = lines.lineCount;
      return composedStats;
    },
    renderPostProcess: () => {
      order.push("post_process");
      return composedStats;
    },
  } satisfies FerrumRuntimeRenderer;
  let publishedLineCount = 0;
  const runtimeFrameRenderer = new RuntimeFrameRenderer({
    renderer,
    shouldRenderPhysicsDebugLines: true,
    physicsDebugLineComposer: (lines) => {
      order.push(`compose_debug:${lines.lineCount}`);
      return {
        buffer: new Float32Array(5 * 8),
        lineCount: 5,
        floatsPerLine: 8,
      };
    },
    needsRuntimeFrame: true,
    onFrame: ({ rendererStats }) => {
      publishedLineCount = rendererStats.physicsDebugLineCount;
    },
  });

  runtimeFrameRenderer.renderFrame(renderFrameState({
    frameState: frameState(),
    includePhysicsDebugLines: true,
  }));

  deepEqual(order, [
    "render",
    "render_commands",
    "compose_debug:3",
    "render_debug:5:11,22",
    "post_process",
  ]);
  equal(publishedLineCount, 5);
});

test("RuntimeFrameRenderer labels expanded lifecycle states", () => {
  const order: string[] = [];
  let gameState: unknown;
  const runtimeFrameRenderer = new RuntimeFrameRenderer({
    renderer: fakeRuntimeRenderer(order),
    shouldRenderPhysicsDebugLines: false,
    needsRuntimeFrame: true,
    debugOverlay: {
      update: (metrics: { gameState: string }) => {
        gameState = metrics.gameState;
      },
    } as never,
    now: () => 0,
  });

  runtimeFrameRenderer.renderFrame(renderFrameState({
    frameState: frameState({ gameState: GAME_STATE_CODE.levelComplete }),
  }));

  equal(gameState, "LevelComplete");
});

test("RuntimeFrameRenderer reports collision pair count when lifecycle tracking is disabled", () => {
  const order: string[] = [];
  const renderer = fakeRuntimeRenderer(order);
  let debugMetrics: Record<string, unknown> | undefined;
  const runtimeFrameRenderer = new RuntimeFrameRenderer({
    renderer,
    shouldRenderPhysicsDebugLines: false,
    needsRuntimeFrame: true,
    debugOverlay: {
      update: (metrics: unknown) => {
        debugMetrics = metrics as Record<string, unknown>;
      },
    } as never,
  });
  const physics = {
    ...physicsFrameStats(),
    collisionLifecycleEventsEnabled: false,
    solidCandidateChecks: 3,
    tileCandidateChecks: 5,
    collisionPairs: 4,
    collisionEventCount: 7,
  };

  runtimeFrameRenderer.renderFrame(renderFrameState({ frameState: frameState({ physics }) }));

  equal(debugMetrics?.physicsSolidCandidateChecks, 3);
  equal(debugMetrics?.physicsTileCandidateChecks, 5);
  equal(debugMetrics?.collisionPairCount, 4);
  equal(debugMetrics?.collisionEventCount, undefined);
});

test("RuntimeFrameRenderer includes collision metrics when lifecycle tracking is enabled", () => {
  const order: string[] = [];
  const renderer = fakeRuntimeRenderer(order);
  let debugMetrics: Record<string, unknown> | undefined;
  const runtimeFrameRenderer = new RuntimeFrameRenderer({
    renderer,
    shouldRenderPhysicsDebugLines: false,
    needsRuntimeFrame: true,
    debugOverlay: {
      update: (metrics: unknown) => {
        debugMetrics = metrics as Record<string, unknown>;
      },
    } as never,
  });
  const physics = {
    ...physicsFrameStats(),
    collisionLifecycleEventsEnabled: true,
    collisionPairs: 4,
    collisionEventCount: 7,
  };

  runtimeFrameRenderer.renderFrame(renderFrameState({ frameState: frameState({ physics }) }));

  equal(debugMetrics?.collisionPairCount, 4);
  equal(debugMetrics?.collisionEventCount, 7);
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

test("RuntimeFrameRenderer skips repeated primitive visual provider setter calls", () => {
  const order: string[] = [];
  const renderer = fakeRuntimeRenderer(order);
  const runtimeFrameRenderer = new RuntimeFrameRenderer({
    renderer,
    spriteMaterial: (frame) => {
      order.push(`sprite_provider:${frame.score}`);
      return frame.score > 0 ? "flash" : false;
    },
    postProcess: () => {
      order.push("post_provider");
      return false;
    },
    shouldRenderPhysicsDebugLines: false,
    needsRuntimeFrame: false,
  });

  runtimeFrameRenderer.renderFrame(renderFrameState({ frameState: frameState({ score: 1 }) }));
  runtimeFrameRenderer.renderFrame(renderFrameState({ frameState: frameState({ score: 2 }) }));
  runtimeFrameRenderer.renderFrame(renderFrameState({ frameState: frameState({ score: 0 }) }));

  deepEqual(order, [
    "sprite_provider:1",
    "set_sprite",
    "post_provider",
    "set_post",
    "render",
    "render_commands",
    "post_process",
    "sprite_provider:2",
    "post_provider",
    "render",
    "render_commands",
    "post_process",
    "sprite_provider:0",
    "set_sprite",
    "post_provider",
    "render",
    "render_commands",
    "post_process",
  ]);
});

test("RuntimeFrameRenderer still applies object visual provider values every frame", () => {
  const order: string[] = [];
  const renderer = fakeRuntimeRenderer(order);
  const postProcess = { opacity: 0.5 };
  const spriteMaterial = { name: "custom" };
  const runtimeFrameRenderer = new RuntimeFrameRenderer({
    renderer,
    spriteMaterial: () => spriteMaterial,
    postProcess: () => postProcess,
    shouldRenderPhysicsDebugLines: false,
    needsRuntimeFrame: false,
  });

  runtimeFrameRenderer.renderFrame(renderFrameState({ frameState: frameState() }));
  runtimeFrameRenderer.renderFrame(renderFrameState({ frameState: frameState() }));

  deepEqual(order, [
    "set_sprite",
    "set_post",
    "render",
    "render_commands",
    "post_process",
    "set_sprite",
    "set_post",
    "render",
    "render_commands",
    "post_process",
  ]);
});

test("failed primitive provider setters are retried instead of caching unapplied values", () => {
  for (const kind of ["spriteMaterial", "postProcess"] as const) {
    const renderer=fakeRuntimeRenderer([]);
    let calls=0;
    const apply=()=>{if(++calls===1)throw Error("transient setter failure");};
    if(kind==="spriteMaterial")renderer.setSpriteMaterial=apply;
    else renderer.setPostProcess=apply;
    const runtime=new RuntimeFrameRenderer({renderer,[kind]:()=>false,
      shouldRenderPhysicsDebugLines:false,needsRuntimeFrame:false});
    const frame=renderFrameState({frameState:frameState()});
    throws(()=>runtime.renderFrame(frame),/transient setter failure/);
    runtime.renderFrame(frame);
    equal(calls,2,kind+" retries after failure");
    runtime.renderFrame(frame);
    equal(calls,2,kind+" caches only after success");
  }
});

test("unavailable renderers skip providers and submissions while runtime frames keep publishing", () => {
  const order:string[]=[], published:RendererStats[]=[];
  let ready=false;
  const renderer={...fakeRuntimeRenderer(order),
    isRenderReady(){equal(this,renderer);return ready;},
    beginGpuTiming(){order.push("gpu_begin");},endGpuTiming(){order.push("gpu_end");},
  };
  const runtime=new RuntimeFrameRenderer({renderer,
    spriteMaterial:()=>{order.push("material_provider");return {paletteSwap:[{textureId:1,colors:[{from:"#ff0000",to:"#00ff00"}]}]};},
    lighting:()=>{order.push("light_provider");return false;},
    postProcess:()=>{order.push("post_provider");return false;},
    shouldRenderPhysicsDebugLines:true,needsRuntimeFrame:true,
    onFrame:frame=>published.push(frame.rendererStats),
  });
  const frame=renderFrameState({frameState:frameState(),includePhysicsDebugLines:true});
  runtime.renderFrame(frame);runtime.renderFrame(frame);
  deepEqual(order,[]);equal(published.length,2);
  deepEqual(published[0],emptyRendererStats());deepEqual(published[1],emptyRendererStats());
  ready=true;runtime.renderFrame(frame);
  equal(published.length,3);
  deepEqual(order,["light_provider","set_lighting","material_provider","set_sprite","post_provider","set_post",
    "gpu_begin","render","render_commands","render_debug:11,22","post_process","gpu_end"]);
});

test("dynamic providers preserve the presented packet through native growth and scene replacement", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const buffer = new Float32Array(memory.buffer, 0, 15);
  buffer[0] = 42;
  const view = { buffer, commandCount: 1, floatsPerCommand: 15 };
  const state = frameState({ renderCommandBuffer: view });
  let draws = 0;
  const renderer = {
    render() {}, setLighting() {}, setPostProcess() {},
    renderCommands(packet: typeof view) {
      equal(packet.buffer.length, 15);
      equal(packet.buffer[0], 42);
      draws++;
      return emptyRendererStats();
    },
  };
  const runtime = new RuntimeFrameRenderer({
    renderer, shouldRenderPhysicsDebugLines: false, needsRuntimeFrame: true,
    lighting(frame) {
      buffer.fill(0);
      memory.grow(1);
      equal(frame.renderCommandBuffer.buffer[0], 42);
      return false;
    },
    postProcess(frame) { equal(frame.renderCommandBuffer.buffer[0], 42); return false; },
    onFrame(frame) { equal(frame.frame.renderCommandBuffer.buffer[0], 42); },
  });
  runtime.renderFrame({ ...renderFrameState({ frameState: state }), renderCommandBuffer: view });
  equal(draws, 1);
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
  };
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
      floatsPerCommand: 15,
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
    actionDiagnostics: {
      triggerAttempts: 0,
      triggerFailures: 0,
      triggerFailureEventsPushed: 0,
      triggerCommitSkips: 0,
      failureReasonCounts: [],
    },
    spawnDiagnostics: {
      commandsDrained: 0,
      projectileSpawns: 0,
      projectileArcsApplied: 0,
      projectileShootAudioEventsPushed: 0,
      prefabSpawns: 0,
      prefabSpawnedPayloads: 0,
      prefabSpawnedEventsPushed: 0,
    },
    audioEventCount: 2,
    audioEvents: [],
    physics: physicsFrameStats(),
    collisionEventBuffer: {
      buffer: new Uint32Array(0),
      eventCount: 0,
      u32sPerEvent: 5,
    } as never,
    collisionEvents: [],
    gameplayEventBuffer: {
      buffer: new Uint32Array(0),
      eventCount: 0,
      u32sPerEvent: 8,
    } as never,
    gameplayEvents: [],
    effectEventBuffer: {
      buffer: new DataView(new ArrayBuffer(0)),
      eventCount: 0,
      bytesPerEvent: 40,
    } as never,
    effectEvents: [],
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
      floatsPerCommand: 15,
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
    hd2dFilteredEntityCandidates: 0,
    hd2dFilteredTileCandidates: 0,
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

test("RuntimeFrameRenderer carries real resource statistics to overlay and profiler", () => {
  const renderer = fakeRuntimeRenderer([]);
  renderer.resourceStats = () => ({ textureCount: 7, bufferCount: 5, programCount: 5,
    renderTargetCount: 3, unmeasuredTextureCount: 0, textureBytes: 1000, bufferBytes: 24, estimatedBytes: 1024 });
  let overlayMetrics: unknown;
  let profilerMetrics: unknown;
  const frameRenderer = new RuntimeFrameRenderer({ renderer, needsRuntimeFrame: true, shouldRenderPhysicsDebugLines: false,
    debugOverlay: { update: (value: unknown) => { overlayMetrics = value; } } as never,
    profiler: { recordFrame: (value: unknown) => { profilerMetrics = value; } } as never,
    onFrame: ({ debugMetrics }) => {
      equal(debugMetrics.gpuTextureCount, 7);
      equal(debugMetrics.gpuRenderTargetCount, 3);
      equal(debugMetrics.gpuEstimatedBytes, 1024);
      equal(debugMetrics, overlayMetrics);
      equal(debugMetrics, profilerMetrics);
    },
  });
  frameRenderer.renderFrame(renderFrameState({ frameState: frameState() }));
});

test('automatic profiler trace uses the issuing renderer ID and records spatial costs with unclamped intervals',async()=>{
 const {RuntimeProfiler}=await import('../src/runtimeProfiler.js');
 const order:string[]=[],renderer=fakeRuntimeRenderer(order),profiler=new RuntimeProfiler({frameTrace:{beforeFrames:1,afterFrames:1}});
 let now=0,id=40,lastStats:RendererStats=emptyRendererStats();
 renderer.renderPostProcess=()=>lastStats;
 renderer.beginGpuTiming=()=>{id++;};
 renderer.gpuTimingStats=()=>id===41?{status:'pending',currentFrameId:id,pendingQueryCount:1}:{status:'ready',currentFrameId:id,frameId:id-1,elapsedMs:id===43?39:5,pendingQueryCount:1};
 renderer.renderCommands=()=>{now+=2;return lastStats={...emptyRendererStats(),spatial:{modelCount:216,visibleModelCount:200,modelDrawCalls:196,modelInstancedDrawCalls:4,modelTriangleCount:8000,modelUploadBytes:id===42?69360:0,modelInstanceUploadBytes:16000,shadowDrawCalls:400,shadowPassCount:7,shadowUploadBytes:1000,shadowCacheHit:false,effectDrawCalls:1,authoredLightCount:16,lightCount:4,contributingLightCount:3,pendingLightCount:2,retainedLightCount:1,fadingLightCount:2,culledLightCount:3,droppedLightCount:7,disabledLightCount:0}} as RendererStats;};
 const r=new RuntimeFrameRenderer({renderer,profiler,shouldRenderPhysicsDebugLines:false,needsRuntimeFrame:true,now:()=>now});
 r.renderFrame(renderFrameState({frameState:frameState()}));now=40;
 r.renderFrame(renderFrameState({frameState:frameState()}));now=56;
 r.renderFrame(renderFrameState({frameState:frameState()}));
 const capture=profiler.snapshot().frameTrace!.captures[0];equal(capture.triggerFrameId,42);
 deepEqual(capture.frames.map(f=>f.rendererFrameId),[41,42,43]);equal(capture.frames[1].frameIntervalMs,40);
 equal(capture.frames[1].gpuFrameTimeMs,39);equal(capture.frames[1].modelUploadBytes,69360);equal(capture.frames[1].spatialShadowDrawCalls,400);
 equal(capture.frames[1].spatialAuthoredLightCount,16); equal(capture.frames[1].spatialSelectedLightCount,4);
 equal(capture.frames[1].spatialContributingLightCount,3); equal(capture.frames[1].spatialPendingLightCount,2);
 equal(capture.frames[1].spatialRetainedLightCount,1); equal(capture.frames[1].spatialFadingLightCount,2);
 equal(capture.frames[1].spatialCulledLightCount,3); equal(capture.frames[1].spatialDroppedLightCount,7); equal(capture.frames[1].spatialDisabledLightCount,0);
 equal(capture.frames[1].spatialShadowCacheHit,false);equal(capture.frames[2].gpuFrameTimeMs,undefined);
});


test("runtime destruction inside a provider skips GPU submission and remaining consumers", () => {
  let alive = true;
  const order: string[] = [];
  const renderer = fakeRuntimeRenderer(order);
  renderer.setLighting = () => { throw Error("setter after destruction"); };
  const runtime = new RuntimeFrameRenderer({
    renderer, isAlive: () => alive,
    lighting: () => { alive = false; return false; },
    needsRuntimeFrame: true, shouldRenderPhysicsDebugLines: false,
    onFrame: () => { throw Error("published after destruction"); },
  });
  runtime.renderFrame(renderFrameState({ frameState: frameState() }));
  deepEqual(order, []);
});

for (const phase of ["isRenderReady", "beginGpuTiming", "render", "renderCommands"] as const) {
  test(`runtime destruction inside renderer ${phase} stops subsequent passes`, () => {
    let alive = true;
    const order: string[] = [];
    const visit = (name: string) => { equal(alive, true); order.push(name); if (name === phase) alive = false; };
    const runtime = new RuntimeFrameRenderer({
      renderer: {
        isRenderReady: () => { visit("isRenderReady"); return true; },
        beginGpuTiming: () => { visit("beginGpuTiming"); },
        render: () => { visit("render"); },
        renderCommands: () => { visit("renderCommands"); return emptyRendererStats(); },
        renderPostProcess: () => { throw Error("post process after destruction"); },
        endGpuTiming: () => { throw Error("end query after destruction"); },
      },
      isAlive: () => alive, needsRuntimeFrame: false, shouldRenderPhysicsDebugLines: false,
    });
    runtime.renderFrame(renderFrameState());
    equal(order[order.length - 1], phase);
  });
}


for (const phase of ["gpuTimingStats", "resourceStats"] as const) {
  test(`destruction inside ${phase} skips subsequent stats and labels`, () => {
    let alive = true;
    const renderer = fakeRuntimeRenderer([]);
    renderer.gpuTimingStats = () => {
      if (phase === "gpuTimingStats") alive = false;
      return { status: "unsupported", pendingQueryCount: 0 };
    };
    renderer.resourceStats = () => {
      equal(alive, true);
      alive = false;
      return {} as ReturnType<NonNullable<typeof renderer.resourceStats>>;
    };
    const runtime = new RuntimeFrameRenderer({
      renderer, isAlive: () => alive, needsRuntimeFrame: true, shouldRenderPhysicsDebugLines: false,
      gameStateLabel: () => { throw Error("label after destruction"); },
      onFrame: () => { throw Error("publish after destruction"); },
    });
    runtime.renderFrame(renderFrameState({ frameState: frameState() }));
    equal(alive, false);
  });
}
