import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  emptyRendererStats,
  estimateTextureSwitchCount,
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
