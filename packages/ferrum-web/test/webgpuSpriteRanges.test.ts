import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import type { RenderCommandBufferView } from "../src/renderCommandDecoder.js";
import { spriteRanges } from "../src/webgpuSpriteRanges.js";
import type { WebGpuSpriteRange } from "../src/webgpuSpriteRanges.js";

const FLOATS_PER_COMMAND = 14;
const LEGACY_FLOATS_PER_COMMAND = 13;
const SPRITE_TEXTURE_ID_FIELD = 12;

function commandBufferForTextures(
  textureIds: readonly number[],
  floatsPerCommand = FLOATS_PER_COMMAND,
): RenderCommandBufferView {
  const buffer = new Float32Array(textureIds.length * floatsPerCommand);
  textureIds.forEach((textureId, index) => {
    buffer[index * floatsPerCommand + SPRITE_TEXTURE_ID_FIELD] = textureId;
  });
  return {
    buffer,
    commandCount: textureIds.length,
    floatsPerCommand,
  };
}

test("spriteRanges groups consecutive WebGPU sprite commands by texture id", () => {
  const ranges = spriteRanges(commandBufferForTextures([1, 1, 3, 3, 3, 2]), []);
  deepEqual(ranges, [
    { textureId: 1, start: 0, end: 2 },
    { textureId: 3, start: 2, end: 5 },
    { textureId: 2, start: 5, end: 6 },
  ]);
});

test("spriteRanges returns one range when every command uses one texture", () => {
  const ranges = spriteRanges(commandBufferForTextures([5, 5, 5]), []);
  deepEqual(ranges, [{ textureId: 5, start: 0, end: 3 }]);
});

test("spriteRanges respects legacy 13-float command stride", () => {
  const ranges = spriteRanges(commandBufferForTextures([2, 4, 4], LEGACY_FLOATS_PER_COMMAND), []);
  deepEqual(ranges, [
    { textureId: 2, start: 0, end: 1 },
    { textureId: 4, start: 1, end: 3 },
  ]);
});

test("spriteRanges reuses scratch range objects and trims stale entries", () => {
  const firstRange: WebGpuSpriteRange = { textureId: 99, start: -1, end: -1 };
  const secondRange: WebGpuSpriteRange = { textureId: 98, start: -1, end: -1 };
  const staleRange: WebGpuSpriteRange = { textureId: 97, start: -1, end: -1 };
  const scratch = [firstRange, secondRange, staleRange];

  const ranges = spriteRanges(commandBufferForTextures([7, 8, 8]), scratch);

  equal(ranges, scratch);
  equal(ranges[0], firstRange);
  equal(ranges[1], secondRange);
  equal(ranges.length, 2);
  deepEqual(ranges, [
    { textureId: 7, start: 0, end: 1 },
    { textureId: 8, start: 1, end: 3 },
  ]);
});

test("spriteRanges clears scratch ranges for empty command buffers", () => {
  const scratch: WebGpuSpriteRange[] = [{ textureId: 1, start: 0, end: 1 }];
  const ranges = spriteRanges(commandBufferForTextures([]), scratch);
  equal(ranges, scratch);
  equal(ranges.length, 0);
});
