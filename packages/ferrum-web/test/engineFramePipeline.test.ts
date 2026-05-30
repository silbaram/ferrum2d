import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { runFrame } from "../src/engineFramePipeline.js";
import type { FramePipelineContext } from "../src/engineFramePipeline.js";
import type { ResolvedPhysicsSpec } from "../src/physicsSpec.js";
import { SoundRegistry } from "../src/soundRegistry.js";
import { TextureRegistry } from "../src/textureRegistry.js";

class FakeEngine {
  readonly order: string[];
  clearAudioCount = 0;
  readonly updateCalls: Array<{
    renderCommands: boolean;
    frameTelemetry: boolean;
    physicsDebugLines: boolean;
  }> = [];

  constructor(order: string[] = []) {
    this.order = order;
  }

  set_input(): void {
    this.order.push("input");
  }

  set_viewport_size(): void {
    this.order.push("viewport");
  }

  update(): void {
    this.order.push("update");
  }

  update_frame(
    _deltaSeconds: number,
    renderCommands: boolean,
    frameTelemetry: boolean,
    physicsDebugLines: boolean,
  ): void {
    this.updateCalls.push({ renderCommands, frameTelemetry, physicsDebugLines });
    this.order.push("update");
  }

  clear_audio_events(): void {
    this.clearAudioCount += 1;
    this.order.push("clear_audio");
  }

  time(): number { return 1; }
  score(): number { return 2; }
  entity_count(): number { return 3; }
  game_state(): number { return 4; }
  sprite_count(): number { return 5; }
  camera_x(): number { return 6; }
  camera_y(): number { return 7; }
  fixed_timestep_enabled(): boolean { return true; }
  physics_fixed_steps(): number { return 8; }
  fixed_timestep_alpha(): number { return 0.5; }
  fixed_timestep_consumed_seconds(): number { return 0.016; }
  fixed_timestep_dropped_seconds(): number { return 0; }
  physics_kinematic_moves(): number { return 9; }
  physics_kinematic_hits(): number { return 10; }
  physics_kinematic_entity_hits(): number { return 11; }
  physics_kinematic_tile_hits(): number { return 12; }
  physics_solid_candidate_checks(): number { return 13; }
  physics_tile_candidate_checks(): number { return 14; }
  physics_collision_pairs(): number { return 15; }
  physics_collision_solid_pairs(): number { return 16; }
  physics_collision_trigger_pairs(): number { return 17; }
  collision_enter_count(): number { return 1; }
  collision_stay_count(): number { return 2; }
  collision_exit_count(): number { return 3; }
  collision_hit_count(): number { return 4; }
  collision_trigger_enter_count(): number { return 5; }
  collision_trigger_stay_count(): number { return 6; }
  collision_trigger_exit_count(): number { return 7; }
  rigid_body_step_ccd_checks(): number { return 18; }
  rigid_body_step_ccd_hits(): number { return 19; }
  rigid_body_step_sleeping_bodies(): number { return 20; }
  rigid_body_step_broken_joints(): number { return 21; }
}

class FakeBridge {
  decodeAudioCount = 0;

  constructor(
    private readonly order: string[],
    private readonly audioEventCount = 1,
  ) {}

  readAudioEventBuffer(): unknown {
    this.order.push("read_audio");
    return {
      buffer: new Float32Array(0),
      eventCount: this.audioEventCount,
      floatsPerEvent: 5,
    };
  }

  decodeAudioEvents(): readonly unknown[] {
    this.decodeAudioCount += 1;
    this.order.push("decode_audio");
    return [{ soundId: 1, volume: 0.5, playbackRate: 1, channelId: 1 }];
  }

  readRenderCommandBuffer(): unknown {
    this.order.push("read_render");
    return {
      buffer: new Float32Array(0),
      commandCount: 0,
      floatsPerCommand: 14,
    };
  }

  readFrameTelemetryBuffer(): unknown {
    this.order.push("read_telemetry");
    return {
      buffer: new Float64Array([
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        1,
        8,
        0.5,
        0.016,
        0,
        9,
        10,
        11,
        12,
        13,
        14,
        15,
        16,
        17,
        18,
        19,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        18,
        19,
        20,
        21,
        2,
        4,
        32,
      ]),
      f64sPerFrame: 37,
    };
  }

  readCollisionEventBuffer(): unknown {
    this.order.push("read_collision");
    return {
      buffer: new Uint32Array(0),
      eventCount: 0,
      u32sPerEvent: 6,
    };
  }

  readPhysicsDebugLineBuffer(): unknown {
    this.order.push("read_debug");
    return {
      buffer: new Float32Array(0),
      lineCount: 0,
      floatsPerLine: 8,
    };
  }

  decodeCollisionEvents(): readonly unknown[] {
    this.order.push("decode_collision");
    return [];
  }

  decodePhysicsDebugLines(): readonly unknown[] {
    this.order.push("decode_debug");
    return [];
  }

  readRenderCommands(): unknown[] {
    this.order.push("read_legacy_commands");
    return [];
  }
}

test("runFrame preserves input, viewport, update, audio, buffer, callback order", () => {
  const order: string[] = [];
  const bridge = new FakeBridge(order);
  const engine = new FakeEngine(order);
  const context = framePipelineContext({
    bridge,
    engine,
    order,
    onFrame: (frame) => {
      order.push("on_frame");
      equal(frame.timeSeconds, 1);
      equal(frame.frameTimeMs, 16);
      equal(frame.score, 2);
      equal(frame.entityCount, 3);
      equal(frame.gameState, 4);
      equal(frame.spriteCount, 5);
      equal(frame.mouseX, 20);
      equal(frame.mouseY, 30);
      equal(frame.cameraX, 6);
      equal(frame.cameraY, 7);
      equal(frame.playerFloorId, 2);
      equal(frame.playerElevation, 4);
      equal(frame.playerHeight, 32);
      equal(frame.audioEventCount, 1);
      equal(frame.audioEvents.length, 1);
      equal(frame.physics.fixedTimestepEnabled, true);
      equal(frame.physics.fixedSteps, 8);
      equal(frame.physics.kinematicMoves, 9);
      equal(frame.physics.hd2dFilteredEntityCandidates, 15);
      equal(frame.physics.hd2dFilteredTileCandidates, 16);
      equal(frame.physics.ccdChecks, 18);
      equal(frame.physics.brokenJoints, 21);
      equal(frame.physics.collisionLifecycleEventsEnabled, false);
      equal(frame.physics.collisionEventCount, 0);
      equal(frame.collisionEventBuffer.eventCount, 0);
      equal(frame.physicsDebugLineBuffer.lineCount, 0);
    },
  });

  runFrame(context, 0.016);

  deepEqual(engine.updateCalls, [
    { renderCommands: true, frameTelemetry: true, physicsDebugLines: false },
  ]);
  deepEqual(order, [
    "input",
    "viewport",
    "update",
    "read_audio",
    "play_audio_buffer",
    "decode_audio",
    "clear_audio",
    "read_render",
    "read_telemetry",
    "on_frame",
  ]);
});

test("runFrame skips frame buffer reads when no onFrame handler is registered", () => {
  const order: string[] = [];
  const bridge = new FakeBridge(order, 0);
  const engine = new FakeEngine(order);
  const context = framePipelineContext({ bridge, engine, order });
  context.onFrame = undefined;

  runFrame(context, 0.016);

  deepEqual(engine.updateCalls, [
    { renderCommands: false, frameTelemetry: false, physicsDebugLines: false },
  ]);
  deepEqual(order, ["input", "viewport", "update", "read_audio"]);
  equal(engine.clearAudioCount, 0);
  equal(bridge.decodeAudioCount, 0);
});

test("runFrame render-only path avoids full FrameState buffer reads", () => {
  const order: string[] = [];
  const bridge = new FakeBridge(order, 0);
  const engine = new FakeEngine(order);
  const context = framePipelineContext({ bridge, engine, order });
  context.onFrame = undefined;
  context.onRenderFrame = (frame) => {
    order.push("render_frame");
    equal(frame.frameState, undefined);
    equal(frame.renderCommandBuffer.commandCount, 0);
    equal(frame.physicsDebugLineBuffer, undefined);
  };
  context.needsFrameState = false;

  runFrame(context, 0.016);

  deepEqual(engine.updateCalls, [
    { renderCommands: true, frameTelemetry: false, physicsDebugLines: false },
  ]);
  deepEqual(order, [
    "input",
    "viewport",
    "update",
    "read_audio",
    "read_render",
    "render_frame",
  ]);
  equal(bridge.decodeAudioCount, 0);
});

test("runFrame render-only path reads physics debug buffer only when requested", () => {
  const order: string[] = [];
  const bridge = new FakeBridge(order, 0);
  const engine = new FakeEngine(order);
  const context = framePipelineContext({ bridge, engine, order });
  context.onFrame = undefined;
  context.onRenderFrame = (frame) => {
    order.push("render_frame");
    equal(frame.frameState, undefined);
    equal(frame.physicsDebugLineBuffer?.lineCount, 0);
    equal(frame.cameraX, 6);
    equal(frame.cameraY, 7);
  };
  context.needsFrameState = false;
  context.needsPhysicsDebugLineBuffer = true;

  runFrame(context, 0.016);

  deepEqual(engine.updateCalls, [
    { renderCommands: true, frameTelemetry: false, physicsDebugLines: true },
  ]);
  deepEqual(order, [
    "input",
    "viewport",
    "update",
    "read_audio",
    "read_render",
    "read_debug",
    "render_frame",
  ]);
  equal(bridge.decodeAudioCount, 0);
});

test("runFrame clears audio events when audio host throws", () => {
  const order: string[] = [];
  const bridge = new FakeBridge(order);
  const engine = new FakeEngine(order);
  const context = framePipelineContext({
    bridge,
    engine,
    order,
    playAudioEventBuffer: () => {
      order.push("play_audio_buffer");
      throw new Error("audio failed");
    },
  });

  let thrownError: unknown;
  try {
    runFrame(context, 0.016);
  } catch (error) {
    thrownError = error;
  }

  if (!(thrownError instanceof Error)) {
    throw new Error("Expected runFrame to throw an Error");
  }
  equal(thrownError.message, "audio failed");
  equal(engine.clearAudioCount, 1);
  deepEqual(order, [
    "input",
    "viewport",
    "update",
    "read_audio",
    "play_audio_buffer",
    "clear_audio",
  ]);
});

test("runFrame avoids decoded audio objects when includeAudioEvents is false and buffer playback is available", () => {
  const order: string[] = [];
  const bridge = new FakeBridge(order);
  const engine = new FakeEngine(order);
  const context = framePipelineContext({
    bridge,
    engine,
    order,
    options: { includeAudioEvents: false },
    onFrame: (frame) => {
      order.push("on_frame");
      equal(frame.audioEventCount, 1);
      equal(frame.audioEvents.length, 0);
    },
  });

  runFrame(context, 0.016);

  equal(bridge.decodeAudioCount, 0);
  equal(order.includes("decode_audio"), false);
});

test("runFrame omits FrameState audio objects when includeAudioEvents is false and legacy audio playback decodes", () => {
  const order: string[] = [];
  const bridge = new FakeBridge(order);
  const engine = new FakeEngine(order);
  const context = framePipelineContext({
    bridge,
    engine,
    order,
    options: { includeAudioEvents: false },
    playAudioEventBuffer: null,
    playAudioEvents: (events) => {
      order.push("play_audio_events");
      equal(events.length, 1);
    },
    onFrame: (frame) => {
      order.push("on_frame");
      equal(frame.audioEventCount, 1);
      equal(frame.audioEvents.length, 0);
    },
  });

  runFrame(context, 0.016);

  equal(bridge.decodeAudioCount, 1);
  deepEqual(order, [
    "input",
    "viewport",
    "update",
    "read_audio",
    "decode_audio",
    "play_audio_events",
    "clear_audio",
    "read_render",
    "read_telemetry",
    "on_frame",
  ]);
});

test("runFrame builds optional FrameState decoded views only when requested", () => {
  const order: string[] = [];
  const bridge = new FakeBridge(order, 0);
  const engine = new FakeEngine(order);
  const context = framePipelineContext({
    bridge,
    engine,
    order,
    options: {
      includeCollisionEvents: true,
      includePhysicsDebugLines: true,
      includeDeprecatedRenderCommands: true,
    },
    onFrame: (frame) => {
      order.push("on_frame");
      equal(frame.physics.collisionLifecycleEventsEnabled, true);
      equal(frame.physics.collisionEventCount, 28);
      equal(frame.collisionEvents.length, 0);
      equal(frame.physicsDebugLines.length, 0);
      equal(frame.renderCommands.length, 0);
    },
  });

  runFrame(context, 0.016);

  deepEqual(engine.updateCalls, [
    { renderCommands: true, frameTelemetry: true, physicsDebugLines: true },
  ]);
  deepEqual(order, [
    "input",
    "viewport",
    "update",
    "read_audio",
    "read_render",
    "read_telemetry",
    "read_collision",
    "read_debug",
    "decode_collision",
    "decode_debug",
    "on_frame",
  ]);
});

test("runFrame only reads optional FrameState buffers when requested", () => {
  const order: string[] = [];
  const bridge = new FakeBridge(order, 0);
  const engine = new FakeEngine(order);
  const context = framePipelineContext({
    bridge,
    engine,
    order,
    onFrame: (frame) => {
      order.push("on_frame");
      equal(frame.collisionEventBuffer.eventCount, 0);
      equal(frame.physicsDebugLineBuffer.lineCount, 0);
      equal(frame.collisionEvents.length, 0);
      equal(frame.physicsDebugLines.length, 0);
    },
  });

  runFrame(context, 0.016);

  equal(order.includes("read_collision"), false);
  equal(order.includes("read_debug"), false);
  equal(order.includes("read_telemetry"), true);
});

test("runFrame avoids update timing on render-only path and measures full FrameState path", () => {
  let nowCalls = 0;
  const previousNow = performance.now;
  Object.defineProperty(performance, "now", {
    configurable: true,
    value: () => {
      nowCalls += 1;
      return nowCalls;
    },
  });

  try {
    const renderOnlyOrder: string[] = [];
    const renderOnlyContext = framePipelineContext({
      bridge: new FakeBridge(renderOnlyOrder, 0),
      engine: new FakeEngine(renderOnlyOrder),
      order: renderOnlyOrder,
    });
    renderOnlyContext.onFrame = undefined;
    renderOnlyContext.onRenderFrame = () => {};
    renderOnlyContext.needsFrameState = false;

    runFrame(renderOnlyContext, 0.016);
    equal(nowCalls, 0);

    const fullFrameOrder: string[] = [];
    const fullFrameContext = framePipelineContext({
      bridge: new FakeBridge(fullFrameOrder, 0),
      engine: new FakeEngine(fullFrameOrder),
      order: fullFrameOrder,
    });
    runFrame(fullFrameContext, 0.016);
    equal(nowCalls, 2);
  } finally {
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: previousNow,
    });
  }
});

test("runFrame pushes viewport only when changed or invalidated", () => {
  const order: string[] = [];
  const bridge = new FakeBridge(order, 0);
  const engine = new FakeEngine(order);
  const context = framePipelineContext({ bridge, engine, order });

  runFrame(context, 0.016);
  runFrame(context, 0.016);
  equal(order.filter((entry) => entry === "viewport").length, 1);

  context.viewportProvider = () => ({ width: 800, height: 360 });
  runFrame(context, 0.016);
  equal(order.filter((entry) => entry === "viewport").length, 2);

  context.viewportDirty = true;
  runFrame(context, 0.016);
  equal(order.filter((entry) => entry === "viewport").length, 3);
});

function framePipelineContext(args: {
  bridge: FakeBridge;
  engine: FakeEngine;
  order: string[];
  options?: FramePipelineContext["options"];
  onFrame?: FramePipelineContext["onFrame"];
  playAudioEventBuffer?: ((events: unknown) => void) | null;
  playAudioEvents?: ((events: readonly unknown[]) => void) | null;
}): FramePipelineContext {
  const {
    bridge,
    engine,
    order,
    options = {},
    onFrame = () => {
      order.push("on_frame");
    },
    playAudioEventBuffer,
    playAudioEvents,
  } = args;
  const assetHost: NonNullable<FramePipelineContext["assetHost"]> = {
    loadAssets: async () => ({
      textures: new TextureRegistry(),
      sounds: new SoundRegistry(),
      json: {},
      progress: { loaded: 0, total: 0, ratio: 1 },
    }),
    textureId: () => 0,
  };
  if (playAudioEventBuffer !== null) {
    assetHost.playAudioEventBuffer = playAudioEventBuffer ?? (() => {
      order.push("play_audio_buffer");
    });
  }
  if (playAudioEvents) {
    assetHost.playAudioEvents = playAudioEvents as NonNullable<FramePipelineContext["assetHost"]>["playAudioEvents"];
  }
  return {
    bridge: bridge as unknown as FramePipelineContext["bridge"],
    rustEngine: engine as unknown as FramePipelineContext["rustEngine"],
    physicsSpec: physicsSpec(),
    onFrame,
    inputProvider: () => ({
      w: true,
      a: false,
      s: false,
      d: true,
      space: false,
      enter: false,
      mouseLeft: true,
      mouseX: 20,
      mouseY: 30,
    }),
    viewportProvider: () => ({ width: 640, height: 360 }),
    assetHost,
    options,
  };
}

function physicsSpec(): ResolvedPhysicsSpec {
  return {
    mode: "arcade",
    gravityX: 0,
    gravityY: 0,
    continuous: false,
    hd2d: {
      enabled: false,
      defaultHeight: 0,
      maxStepHeight: 0,
      maxDropHeight: 0,
    },
    solver: {
      fixedTimestep: true,
      stepSeconds: 1 / 60,
      velocityIterations: 1,
      positionIterations: 1,
      sleep: false,
    },
    materials: {},
    layers: {},
    bodies: {},
    joints: {},
    debug: {
      enabled: false,
      colliders: false,
      contacts: false,
      manifolds: false,
      broadphase: false,
      joints: false,
      sleeping: false,
      layers: false,
      ccd: false,
    },
  };
}
