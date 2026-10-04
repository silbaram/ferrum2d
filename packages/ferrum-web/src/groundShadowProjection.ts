import type { RenderCommandBufferView } from "./renderCommandDecoder.js";

const DEFAULT_PROJECTION = [1, 0, 1] as const;

/** Frame metadata is mandatory for alpha shadows; ordinary/legacy buffers need no metadata. */
export function groundShadowProjection(commands: RenderCommandBufferView): Float32Array | readonly [number, number, number] {
  const projection = commands.groundShadowProjection;
  if (projection !== undefined) {
    if (projection.length !== 3 || !projection.every(Number.isFinite)
      || Math.abs(Math.hypot(projection[0], projection[1]) - 1) > 0.00001
      || projection[2] < Math.fround(0.01) || projection[2] > 100) {
      throw new Error("groundShadowProjection must contain a normalized direction and length scale in [0.01, 100].");
    }
    return projection;
  }
  if (commands.floatsPerCommand > 13) {
    for (let i = 0; i < commands.commandCount; i += 1) {
      if ((commands.buffer[i * commands.floatsPerCommand + 13] & 32) !== 0) {
        throw new Error("Alpha ground shadow commands require groundShadowProjection metadata.");
      }
    }
  }
  return DEFAULT_PROJECTION;
}
