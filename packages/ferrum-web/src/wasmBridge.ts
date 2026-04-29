import init, {
  Engine,
  sprite_render_command_bytes,
  sprite_render_command_floats,
  version,
  wasm_memory,
} from "../pkg/ferrum_core";

export interface RenderCommandView {
  x: number;
  y: number;
  width: number;
  height: number;
  uv: [number, number, number, number];
  color: [number, number, number, number];
}

export interface RenderCommandBufferView {
  buffer: Float32Array;
  commandCount: number;
  floatsPerCommand: number;
}

const FLOATS_PER_COMMAND = 12;
const BYTES_PER_F32 = Float32Array.BYTES_PER_ELEMENT;
const BYTES_PER_COMMAND = FLOATS_PER_COMMAND * BYTES_PER_F32;

export class WasmBridge {
  private readonly floatsPerCommand: number;

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
    this.floatsPerCommand = rustFloatsPerCommand;
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
    const view = this.readRenderCommandBuffer();
    const commands: RenderCommandView[] = [];
    for (let i = 0; i < view.commandCount; i += 1) {
      const offset = i * view.floatsPerCommand;
      commands.push({
        x: view.buffer[offset],
        y: view.buffer[offset + 1],
        width: view.buffer[offset + 2],
        height: view.buffer[offset + 3],
        uv: [view.buffer[offset + 4], view.buffer[offset + 5], view.buffer[offset + 6], view.buffer[offset + 7]],
        color: [view.buffer[offset + 8], view.buffer[offset + 9], view.buffer[offset + 10], view.buffer[offset + 11]],
      });
    }
    return commands;
  }
}
