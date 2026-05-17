import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  emptyRendererStats,
  estimateTextureSwitchCount,
  RENDERER_STATS_FIELD_CONTRACT,
  rendererStatsForCommands,
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
  });
});
