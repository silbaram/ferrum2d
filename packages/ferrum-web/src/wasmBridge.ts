import init, { Engine, memory, version } from "../pkg/ferrum_core";

export interface RenderCommandView {
  x: number;
  y: number;
  width: number;
  height: number;
  uv: [number, number, number, number];
  color: [number, number, number, number];
}

const FLOATS_PER_COMMAND = 12;
const BYTES_PER_COMMAND = FLOATS_PER_COMMAND * 4;

export class WasmBridge {
  private constructor(private readonly engineInstance: Engine) {}

  static async init(): Promise<WasmBridge> {
    await init();
    return new WasmBridge(new Engine());
  }

  engine(): Engine {
    return this.engineInstance;
  }

  version(): string {
    return version();
  }

  readRenderCommands(): RenderCommandView[] {
    const ptr = this.engineInstance.render_command_ptr();
    const len = this.engineInstance.render_command_len();
    const start = ptr / 4;
    const floats = new Float32Array(memory.buffer, start * 4, len * FLOATS_PER_COMMAND);

    const commands: RenderCommandView[] = [];
    for (let i = 0; i < len; i += 1) {
      const offset = i * FLOATS_PER_COMMAND;
      commands.push({
        x: floats[offset],
        y: floats[offset + 1],
        width: floats[offset + 2],
        height: floats[offset + 3],
        uv: [floats[offset + 4], floats[offset + 5], floats[offset + 6], floats[offset + 7]],
        color: [
          floats[offset + 8],
          floats[offset + 9],
          floats[offset + 10],
          floats[offset + 11],
        ],
      });
    }
    void BYTES_PER_COMMAND;
    return commands;
  }
}
