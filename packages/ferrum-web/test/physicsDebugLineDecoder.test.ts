import { deepEqual } from "node:assert/strict";
import { test } from "node:test";
import { decodePhysicsDebugLines } from "../src/physicsDebugLineDecoder.js";

test("decodePhysicsDebugLines parses packed debug line floats", () => {
  const lines = decodePhysicsDebugLines({
    buffer: new Float32Array([
      1, 2, 3, 4, 1, 0.5, 0.25, 1,
      -1, -2, -3, -4, 0.125, 0.25, 0.5, 0.75,
    ]),
    lineCount: 2,
    floatsPerLine: 8,
  });

  deepEqual(lines, [
    { x0: 1, y0: 2, x1: 3, y1: 4, color: [1, 0.5, 0.25, 1] },
    { x0: -1, y0: -2, x1: -3, y1: -4, color: [0.125, 0.25, 0.5, 0.75] },
  ]);
});
