export interface PhysicsDebugLineView {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: [number, number, number, number];
}

export interface PhysicsDebugLineBufferView {
  buffer: Float32Array;
  lineCount: number;
  floatsPerLine: number;
}

export const FLOATS_PER_PHYSICS_DEBUG_LINE = 8;
export const EMPTY_PHYSICS_DEBUG_LINES: readonly PhysicsDebugLineView[] = Object.freeze([]);

export function decodePhysicsDebugLines(
  view: PhysicsDebugLineBufferView,
): readonly PhysicsDebugLineView[] {
  if (view.lineCount === 0) {
    return EMPTY_PHYSICS_DEBUG_LINES;
  }

  const lines: PhysicsDebugLineView[] = [];
  for (let i = 0; i < view.lineCount; i += 1) {
    const offset = i * view.floatsPerLine;
    lines.push({
      x0: view.buffer[offset],
      y0: view.buffer[offset + 1],
      x1: view.buffer[offset + 2],
      y1: view.buffer[offset + 3],
      color: [
        view.buffer[offset + 4],
        view.buffer[offset + 5],
        view.buffer[offset + 6],
        view.buffer[offset + 7],
      ],
    });
  }
  return lines;
}
