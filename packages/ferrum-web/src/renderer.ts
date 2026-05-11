import type { RenderCommandBufferView } from "./renderCommandDecoder";

export interface RendererStats {
  drawCalls: number;
  batchCount: number;
  spriteCount: number;
  renderCommandCount: number;
  textureBindCount: number;
  textureSwitchCount: number;
}

export interface Renderer {
  render(): void;
  resize(): void;
  stats(): RendererStats;
  destroy(): void;
}

export function emptyRendererStats(): RendererStats {
  return {
    drawCalls: 0,
    batchCount: 0,
    spriteCount: 0,
    renderCommandCount: 0,
    textureBindCount: 0,
    textureSwitchCount: 0,
  };
}

export function rendererStatsForCommands(
  commands: RenderCommandBufferView,
  drawCalls: number,
  textureSwitchCount = estimateTextureSwitchCount(commands),
): RendererStats {
  return {
    drawCalls,
    batchCount: drawCalls,
    spriteCount: commands.commandCount,
    renderCommandCount: commands.commandCount,
    textureBindCount: drawCalls,
    textureSwitchCount,
  };
}

export function estimateTextureSwitchCount(commands: RenderCommandBufferView): number {
  if (commands.commandCount <= 1) {
    return 0;
  }

  let switches = 0;
  let previousTextureId = textureIdAt(commands, 0);
  for (let i = 1; i < commands.commandCount; i += 1) {
    const textureId = textureIdAt(commands, i);
    if (textureId !== previousTextureId) {
      switches += 1;
      previousTextureId = textureId;
    }
  }
  return switches;
}

function textureIdAt(commands: RenderCommandBufferView, commandIndex: number): number {
  const offset = commandIndex * commands.floatsPerCommand;
  return Math.trunc(commands.buffer[offset + 12]);
}
