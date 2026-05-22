import type { RenderCommandBufferView } from "./renderCommandDecoder";

export interface RendererStats {
  /** WebGL draw calls submitted by the renderer for the current frame. */
  drawCalls: number;
  /** Texture-contiguous sprite batches rendered for the current frame. */
  batchCount: number;
  /** Sprite commands consumed by the renderer for the current frame. */
  spriteCount: number;
  /** Raw render commands read from the Wasm command buffer for the current frame. */
  renderCommandCount: number;
  /** WebGL texture bind operations implied by rendered batches for the current frame. */
  textureBindCount: number;
  /** Adjacent texture_id changes used by texture-id batching; explicit single-texture rendering reports 0. */
  textureSwitchCount: number;
  /** Physics debug line primitives rendered by the debug line pass for the current frame. */
  physicsDebugLineCount: number;
}

export type RendererStatsUnit = "count";

export interface RendererStatsFieldContract {
  field: keyof RendererStats;
  label: string;
  unit: RendererStatsUnit;
  description: string;
}

export const RENDERER_STATS_FIELD_CONTRACT: readonly RendererStatsFieldContract[] = [
  {
    field: "drawCalls",
    label: "draw calls",
    unit: "count",
    description: "WebGL draw calls submitted by the renderer for the current frame.",
  },
  {
    field: "batchCount",
    label: "batches",
    unit: "count",
    description: "Texture-contiguous sprite batches rendered for the current frame.",
  },
  {
    field: "spriteCount",
    label: "sprites",
    unit: "count",
    description: "Sprite commands consumed by the renderer for the current frame.",
  },
  {
    field: "renderCommandCount",
    label: "render commands",
    unit: "count",
    description: "Raw render commands read from the Wasm command buffer for the current frame.",
  },
  {
    field: "textureBindCount",
    label: "texture binds",
    unit: "count",
    description: "WebGL texture bind operations implied by rendered batches for the current frame.",
  },
  {
    field: "textureSwitchCount",
    label: "texture switches",
    unit: "count",
    description: "Adjacent texture_id changes used by texture-id batching; explicit single-texture rendering reports 0.",
  },
  {
    field: "physicsDebugLineCount",
    label: "physics debug lines",
    unit: "count",
    description: "Physics debug line primitives rendered by the debug line pass for the current frame.",
  },
];

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
    physicsDebugLineCount: 0,
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
    physicsDebugLineCount: 0,
  };
}

export function rendererStatsWithPhysicsDebugLines(
  stats: RendererStats,
  lineCount: number,
  drawCalls: number,
): RendererStats {
  return {
    ...stats,
    drawCalls: stats.drawCalls + drawCalls,
    physicsDebugLineCount: lineCount,
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
