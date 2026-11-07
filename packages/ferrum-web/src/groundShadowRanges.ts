import type { RenderCommandBufferView } from "./renderCommandDecoder.js";

interface Range { textureId: number; start: number; end: number; }

export function isGroundShadow(flags: number): boolean {
  return (flags & 4) !== 0 && (flags & 56) !== 0;
}

export function groundShadowCount(commands: RenderCommandBufferView): number {
  if (commands.floatsPerCommand <= 13) return 0;
  let count=0;
  for (let i = 0; i < commands.commandCount; i++) {
    if (isGroundShadow(commands.buffer[i * commands.floatsPerCommand + 13])) count++;
  }
  return count;
}

/** Original command indices preserve texture UVs, transforms and native ordering. */
export function groundShadowRanges(commands: RenderCommandBufferView, ranges: Range[], receivers = false): Range[] {
  let count = 0;
  for (let i = 0; i < commands.commandCount; i++) {
    const offset = i * commands.floatsPerCommand;
    const flags = commands.floatsPerCommand > 13 ? commands.buffer[offset + 13] : 0;
    if (receivers ? (flags & 4) !== 0 : !isGroundShadow(flags)) continue;
    const textureId = Math.trunc(commands.buffer[offset + 12]);
    const previous = ranges[count - 1];
    if (previous && previous.end === i && previous.textureId === textureId) previous.end++;
    else {
      const range = ranges[count] ?? (ranges[count] = { textureId, start: i, end: i + 1 });
      range.textureId = textureId; range.start = i; range.end = i + 1; count++;
    }
  }
  ranges.length = count;
  return ranges;
}
