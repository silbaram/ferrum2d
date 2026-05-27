import type { RenderCommandBufferView } from "./renderCommandDecoder";
import type { PostProcessStackInput } from "./cameraPostProcessing";

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
  /** WebGL draw calls submitted by the lighting pass for the current frame. */
  lightingDrawCalls: number;
  /** Point lights consumed by the lighting pass for the current frame. */
  pointLightCount: number;
  /** Tile occluder debug rectangles rendered by the lighting pass for the current frame. */
  tileOccluderCount: number;
  /** Shadow projection draw calls submitted by the lighting pass for the current frame. */
  shadowDrawCalls: number;
  /** Tile occluder shadow projections rendered by the lighting pass for the current frame. */
  shadowCasterCount: number;
  /** Fullscreen post-processing draw calls submitted for the current frame. */
  postProcessDrawCalls: number;
  /** Fullscreen post-processing passes consumed for the current frame. */
  postProcessPassCount: number;
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
  {
    field: "lightingDrawCalls",
    label: "lighting draw calls",
    unit: "count",
    description: "WebGL draw calls submitted by the lighting pass for the current frame.",
  },
  {
    field: "pointLightCount",
    label: "point lights",
    unit: "count",
    description: "Point lights consumed by the lighting pass for the current frame.",
  },
  {
    field: "tileOccluderCount",
    label: "tile occluders",
    unit: "count",
    description: "Tile occluder debug rectangles rendered by the lighting pass for the current frame.",
  },
  {
    field: "shadowDrawCalls",
    label: "shadow draw calls",
    unit: "count",
    description: "Shadow projection draw calls submitted by the lighting pass for the current frame.",
  },
  {
    field: "shadowCasterCount",
    label: "shadow casters",
    unit: "count",
    description: "Tile occluder shadow projections rendered by the lighting pass for the current frame.",
  },
  {
    field: "postProcessDrawCalls",
    label: "post-process draw calls",
    unit: "count",
    description: "Fullscreen post-processing draw calls submitted for the current frame.",
  },
  {
    field: "postProcessPassCount",
    label: "post-process passes",
    unit: "count",
    description: "Fullscreen post-processing passes consumed for the current frame.",
  },
];

export interface Renderer {
  render(): void;
  resize(): void;
  stats(): RendererStats;
  setPostProcess?(postProcess: PostProcessStackInput): void;
  renderPostProcess?(postProcess?: PostProcessStackInput): RendererStats;
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
    lightingDrawCalls: 0,
    pointLightCount: 0,
    tileOccluderCount: 0,
    shadowDrawCalls: 0,
    shadowCasterCount: 0,
    postProcessDrawCalls: 0,
    postProcessPassCount: 0,
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
    lightingDrawCalls: 0,
    pointLightCount: 0,
    tileOccluderCount: 0,
    shadowDrawCalls: 0,
    shadowCasterCount: 0,
    postProcessDrawCalls: 0,
    postProcessPassCount: 0,
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

export function rendererStatsWithLighting(
  stats: RendererStats,
  lightingDrawCalls: number,
  pointLightCount: number,
  tileOccluderCount: number,
  shadowDrawCalls = 0,
  shadowCasterCount = 0,
): RendererStats {
  return {
    ...stats,
    drawCalls: stats.drawCalls + lightingDrawCalls,
    lightingDrawCalls,
    pointLightCount,
    tileOccluderCount,
    shadowDrawCalls,
    shadowCasterCount,
  };
}

export function rendererStatsWithPostProcess(
  stats: RendererStats,
  postProcessDrawCalls: number,
  postProcessPassCount: number,
): RendererStats {
  return {
    ...stats,
    drawCalls: stats.drawCalls + postProcessDrawCalls,
    postProcessDrawCalls,
    postProcessPassCount,
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
