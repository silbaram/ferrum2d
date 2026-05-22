import init, {
  Engine,
  audio_event_bytes,
  audio_event_floats,
  collision_event_bytes,
  collision_event_u32s,
  physics_debug_line_bytes,
  physics_debug_line_floats,
  sprite_render_command_bytes,
  sprite_render_command_floats,
  version,
  wasm_memory,
} from "../pkg/ferrum_core.js";
import { decodeCollisionEvents, U32S_PER_COLLISION_EVENT } from "./collisionEventDecoder";
import type { CollisionEventBufferView, CollisionEventView } from "./collisionEventDecoder";
import {
  decodePhysicsDebugLines,
  FLOATS_PER_PHYSICS_DEBUG_LINE,
} from "./physicsDebugLineDecoder";
import type {
  PhysicsDebugLineBufferView,
  PhysicsDebugLineView,
} from "./physicsDebugLineDecoder";
import { decodeRenderCommands } from "./renderCommandDecoder";
import type { RenderCommandBufferView, RenderCommandView } from "./renderCommandDecoder";

export interface AudioEventView {
  soundId: number;
  volume: number;
  pitch: number;
}

export interface AudioEventBufferView {
  buffer: Float32Array;
  eventCount: number;
  floatsPerEvent: number;
}

const FLOATS_PER_COMMAND = 13;
const FLOATS_PER_AUDIO_EVENT = 3;
const BYTES_PER_F32 = Float32Array.BYTES_PER_ELEMENT;
const BYTES_PER_U32 = Uint32Array.BYTES_PER_ELEMENT;
const BYTES_PER_COMMAND = FLOATS_PER_COMMAND * BYTES_PER_F32;
const BYTES_PER_AUDIO_EVENT = FLOATS_PER_AUDIO_EVENT * BYTES_PER_F32;
const BYTES_PER_COLLISION_EVENT = U32S_PER_COLLISION_EVENT * BYTES_PER_U32;
const BYTES_PER_PHYSICS_DEBUG_LINE = FLOATS_PER_PHYSICS_DEBUG_LINE * BYTES_PER_F32;
export const EMPTY_AUDIO_EVENTS: readonly AudioEventView[] = Object.freeze([]);

export class WasmBridge {
  private readonly floatsPerCommand: number;
  private readonly floatsPerAudioEvent: number;
  private readonly u32sPerCollisionEvent: number;
  private readonly floatsPerPhysicsDebugLine: number;

  private constructor(
    private readonly engineInstance: Engine,
    private readonly memory: WebAssembly.Memory,
  ) {
    const rustFloatsPerCommand = sprite_render_command_floats();
    const rustBytesPerCommand = sprite_render_command_bytes();
    if (rustFloatsPerCommand !== FLOATS_PER_COMMAND) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust sprite_render_command_floats=${rustFloatsPerCommand}, TS FLOATS_PER_COMMAND=${FLOATS_PER_COMMAND}. ` +
          "SpriteRenderCommand ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    if (rustBytesPerCommand !== BYTES_PER_COMMAND) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust sprite_render_command_bytes=${rustBytesPerCommand}, TS BYTES_PER_COMMAND=${BYTES_PER_COMMAND}. ` +
          "SpriteRenderCommand ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    const rustFloatsPerAudioEvent = audio_event_floats();
    const rustBytesPerAudioEvent = audio_event_bytes();
    if (rustFloatsPerAudioEvent !== FLOATS_PER_AUDIO_EVENT) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust audio_event_floats=${rustFloatsPerAudioEvent}, TS FLOATS_PER_AUDIO_EVENT=${FLOATS_PER_AUDIO_EVENT}. ` +
          "AudioEvent ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    if (rustBytesPerAudioEvent !== BYTES_PER_AUDIO_EVENT) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust audio_event_bytes=${rustBytesPerAudioEvent}, TS BYTES_PER_AUDIO_EVENT=${BYTES_PER_AUDIO_EVENT}. ` +
          "AudioEvent ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    const rustU32sPerCollisionEvent = collision_event_u32s();
    const rustBytesPerCollisionEvent = collision_event_bytes();
    if (rustU32sPerCollisionEvent !== U32S_PER_COLLISION_EVENT) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust collision_event_u32s=${rustU32sPerCollisionEvent}, TS U32S_PER_COLLISION_EVENT=${U32S_PER_COLLISION_EVENT}. ` +
          "CollisionEvent ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    if (rustBytesPerCollisionEvent !== BYTES_PER_COLLISION_EVENT) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust collision_event_bytes=${rustBytesPerCollisionEvent}, TS BYTES_PER_COLLISION_EVENT=${BYTES_PER_COLLISION_EVENT}. ` +
          "CollisionEvent ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    const rustFloatsPerPhysicsDebugLine = physics_debug_line_floats();
    const rustBytesPerPhysicsDebugLine = physics_debug_line_bytes();
    if (rustFloatsPerPhysicsDebugLine !== FLOATS_PER_PHYSICS_DEBUG_LINE) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust physics_debug_line_floats=${rustFloatsPerPhysicsDebugLine}, TS FLOATS_PER_PHYSICS_DEBUG_LINE=${FLOATS_PER_PHYSICS_DEBUG_LINE}. ` +
          "PhysicsDebugLine ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    if (rustBytesPerPhysicsDebugLine !== BYTES_PER_PHYSICS_DEBUG_LINE) {
      throw new Error(
        `[Ferrum2D ABI mismatch] Rust physics_debug_line_bytes=${rustBytesPerPhysicsDebugLine}, TS BYTES_PER_PHYSICS_DEBUG_LINE=${BYTES_PER_PHYSICS_DEBUG_LINE}. ` +
          "PhysicsDebugLine ABI 변경 시 Rust/TypeScript를 함께 수정하세요.",
      );
    }
    this.floatsPerCommand = rustFloatsPerCommand;
    this.floatsPerAudioEvent = rustFloatsPerAudioEvent;
    this.u32sPerCollisionEvent = rustU32sPerCollisionEvent;
    this.floatsPerPhysicsDebugLine = rustFloatsPerPhysicsDebugLine;
  }

  static async init(): Promise<WasmBridge> {
    await init();
    const memory = wasm_memory();
    return new WasmBridge(new Engine(), memory);
  }

  engine(): Engine {
    return this.engineInstance;
  }

  version(): string {
    return version();
  }

  readRenderCommandBuffer(): RenderCommandBufferView {
    const ptr = this.engineInstance.render_command_ptr();
    const commandCount = this.engineInstance.render_command_len();
    return {
      buffer: new Float32Array(this.memory.buffer, ptr, commandCount * this.floatsPerCommand),
      commandCount,
      floatsPerCommand: this.floatsPerCommand,
    };
  }

  readRenderCommands(): RenderCommandView[] {
    return decodeRenderCommands(this.readRenderCommandBuffer());
  }

  readAudioEventBuffer(): AudioEventBufferView {
    const ptr = this.engineInstance.audio_event_ptr();
    const eventCount = this.engineInstance.audio_event_len();
    return {
      buffer: new Float32Array(this.memory.buffer, ptr, eventCount * this.floatsPerAudioEvent),
      eventCount,
      floatsPerEvent: this.floatsPerAudioEvent,
    };
  }

  readAudioEvents(): readonly AudioEventView[] {
    return this.decodeAudioEvents(this.readAudioEventBuffer());
  }

  readCollisionEventBuffer(): CollisionEventBufferView {
    const ptr = this.engineInstance.collision_event_ptr();
    const eventCount = this.engineInstance.collision_event_len();
    return {
      buffer: new Uint32Array(this.memory.buffer, ptr, eventCount * this.u32sPerCollisionEvent),
      eventCount,
      u32sPerEvent: this.u32sPerCollisionEvent,
    };
  }

  readCollisionEvents(): readonly CollisionEventView[] {
    return this.decodeCollisionEvents(this.readCollisionEventBuffer());
  }

  readPhysicsDebugLineBuffer(): PhysicsDebugLineBufferView {
    const ptr = this.engineInstance.physics_debug_line_ptr();
    const lineCount = this.engineInstance.physics_debug_line_len();
    return {
      buffer: new Float32Array(
        this.memory.buffer,
        ptr,
        lineCount * this.floatsPerPhysicsDebugLine,
      ),
      lineCount,
      floatsPerLine: this.floatsPerPhysicsDebugLine,
    };
  }

  readPhysicsDebugLines(): readonly PhysicsDebugLineView[] {
    return this.decodePhysicsDebugLines(this.readPhysicsDebugLineBuffer());
  }

  decodeCollisionEvents(view: CollisionEventBufferView): readonly CollisionEventView[] {
    return decodeCollisionEvents(view);
  }

  decodePhysicsDebugLines(view: PhysicsDebugLineBufferView): readonly PhysicsDebugLineView[] {
    return decodePhysicsDebugLines(view);
  }

  decodeAudioEvents(view: AudioEventBufferView): readonly AudioEventView[] {
    if (view.eventCount === 0) {
      return EMPTY_AUDIO_EVENTS;
    }

    const events: AudioEventView[] = [];
    for (let i = 0; i < view.eventCount; i += 1) {
      const offset = i * view.floatsPerEvent;
      events.push({
        soundId: Math.trunc(view.buffer[offset]),
        volume: view.buffer[offset + 1],
        pitch: view.buffer[offset + 2],
      });
    }
    return events;
  }
}

export { decodeRenderCommands };
export { decodeCollisionEvents };
export { decodePhysicsDebugLines };
export type {
  CollisionEventBufferView,
  CollisionEventKind,
  CollisionEventView,
} from "./collisionEventDecoder";
export type { PhysicsDebugLineBufferView, PhysicsDebugLineView };
export type { RenderCommandBufferView, RenderCommandView };
