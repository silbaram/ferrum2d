import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  emptyRendererStats,
  estimateTextureSwitchCount,
  RENDERER_STATS_FIELD_CONTRACT,
  rendererStatsForCommands,
  rendererStatsWithLighting,
  rendererStatsWithPostProcess,
  rendererStatsWithPhysicsDebugLines,
} from "../src/renderer.js";
import type { RenderCommandBufferView } from "../src/renderCommandDecoder.js";

function commandBuffer(textureIds: number[]): RenderCommandBufferView {
  const floatsPerCommand = 13;
  const buffer = new Float32Array(textureIds.length * floatsPerCommand);
  for (let i = 0; i < textureIds.length; i += 1) {
    buffer[i * floatsPerCommand + 12] = textureIds[i];
  }
  return {
    buffer,
    commandCount: textureIds.length,
    floatsPerCommand,
  };
}

test("emptyRendererStats returns zeroed counters", () => {
  deepEqual(emptyRendererStats(), {
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
  });
});

test("RendererStats field contract fixes labels and units", () => {
  deepEqual(RENDERER_STATS_FIELD_CONTRACT.map(({ field, label, unit }) => ({
    field,
    label,
    unit,
  })), [
    { field: "drawCalls", label: "draw calls", unit: "count" },
    { field: "batchCount", label: "batches", unit: "count" },
    { field: "spriteCount", label: "sprites", unit: "count" },
    { field: "renderCommandCount", label: "render commands", unit: "count" },
    { field: "textureBindCount", label: "texture binds", unit: "count" },
    { field: "textureSwitchCount", label: "texture switches", unit: "count" },
    { field: "physicsDebugLineCount", label: "physics debug lines", unit: "count" },
    { field: "lightingDrawCalls", label: "lighting draw calls", unit: "count" },
    { field: "pointLightCount", label: "point lights", unit: "count" },
    { field: "tileOccluderCount", label: "tile occluders", unit: "count" },
    { field: "shadowDrawCalls", label: "shadow draw calls", unit: "count" },
    { field: "shadowCasterCount", label: "shadow casters", unit: "count" },
    { field: "postProcessDrawCalls", label: "post-process draw calls", unit: "count" },
    { field: "postProcessPassCount", label: "post-process passes", unit: "count" },
  ]);
});

test("estimateTextureSwitchCount counts adjacent texture id changes", () => {
  equal(estimateTextureSwitchCount(commandBuffer([])), 0);
  equal(estimateTextureSwitchCount(commandBuffer([2])), 0);
  equal(estimateTextureSwitchCount(commandBuffer([1, 1, 2, 2, 1])), 2);
});

test("rendererStatsForCommands derives command and texture counters", () => {
  deepEqual(rendererStatsForCommands(commandBuffer([1, 1, 2, 2, 1]), 3), {
    drawCalls: 3,
    batchCount: 3,
    spriteCount: 5,
    renderCommandCount: 5,
    textureBindCount: 3,
    textureSwitchCount: 2,
    physicsDebugLineCount: 0,
    lightingDrawCalls: 0,
    pointLightCount: 0,
    tileOccluderCount: 0,
    shadowDrawCalls: 0,
    shadowCasterCount: 0,
    postProcessDrawCalls: 0,
    postProcessPassCount: 0,
  });
});

test("rendererStatsWithPhysicsDebugLines adds debug line draw calls", () => {
  deepEqual(rendererStatsWithPhysicsDebugLines(rendererStatsForCommands(commandBuffer([1]), 1), 2, 1), {
    drawCalls: 2,
    batchCount: 1,
    spriteCount: 1,
    renderCommandCount: 1,
    textureBindCount: 1,
    textureSwitchCount: 0,
    physicsDebugLineCount: 2,
    lightingDrawCalls: 0,
    pointLightCount: 0,
    tileOccluderCount: 0,
    shadowDrawCalls: 0,
    shadowCasterCount: 0,
    postProcessDrawCalls: 0,
    postProcessPassCount: 0,
  });
});

test("rendererStatsWithLighting adds lighting pass counters", () => {
  deepEqual(rendererStatsWithLighting(rendererStatsForCommands(commandBuffer([1]), 1), 3, 2, 4, 1, 1), {
    drawCalls: 4,
    batchCount: 1,
    spriteCount: 1,
    renderCommandCount: 1,
    textureBindCount: 1,
    textureSwitchCount: 0,
    physicsDebugLineCount: 0,
    lightingDrawCalls: 3,
    pointLightCount: 2,
    tileOccluderCount: 4,
    shadowDrawCalls: 1,
    shadowCasterCount: 1,
    postProcessDrawCalls: 0,
    postProcessPassCount: 0,
  });
});

test("rendererStatsWithPostProcess adds fullscreen pass counters", () => {
  deepEqual(rendererStatsWithPostProcess(rendererStatsForCommands(commandBuffer([1]), 1), 2, 2), {
    drawCalls: 3,
    batchCount: 1,
    spriteCount: 1,
    renderCommandCount: 1,
    textureBindCount: 1,
    textureSwitchCount: 0,
    physicsDebugLineCount: 0,
    lightingDrawCalls: 0,
    pointLightCount: 0,
    tileOccluderCount: 0,
    shadowDrawCalls: 0,
    shadowCasterCount: 0,
    postProcessDrawCalls: 2,
    postProcessPassCount: 2,
  });
});
