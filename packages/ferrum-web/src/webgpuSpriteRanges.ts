import type { RenderCommandBufferView } from "./renderCommandDecoder";

const SPRITE_TEXTURE_ID_FIELD = 12;

export interface WebGpuSpriteRange {
  textureId: number;
  start: number;
  end: number;
}

export function spriteRanges(
  commands: RenderCommandBufferView,
  ranges: WebGpuSpriteRange[],
): WebGpuSpriteRange[] {
  if (commands.commandCount === 0) {
    ranges.length = 0;
    return ranges;
  }

  let rangeCount = 0;
  let start = 0;
  let currentTextureId = textureIdAt(commands, 0);
  for (let index = 1; index < commands.commandCount; index += 1) {
    const nextTextureId = textureIdAt(commands, index);
    if (nextTextureId === currentTextureId) {
      continue;
    }
    writeSpriteRange(ranges, rangeCount, currentTextureId, start, index);
    rangeCount += 1;
    start = index;
    currentTextureId = nextTextureId;
  }
  writeSpriteRange(ranges, rangeCount, currentTextureId, start, commands.commandCount);
  rangeCount += 1;
  ranges.length = rangeCount;
  return ranges;
}

function textureIdAt(commands: RenderCommandBufferView, commandIndex: number): number {
  const offset = commandIndex * commands.floatsPerCommand;
  return Math.trunc(commands.buffer[offset + SPRITE_TEXTURE_ID_FIELD]);
}

function writeSpriteRange(
  ranges: WebGpuSpriteRange[],
  index: number,
  textureId: number,
  start: number,
  end: number,
): void {
  const range = ranges[index];
  if (range === undefined) {
    ranges.push({ textureId, start, end });
    return;
  }
  range.textureId = textureId;
  range.start = start;
  range.end = end;
}
