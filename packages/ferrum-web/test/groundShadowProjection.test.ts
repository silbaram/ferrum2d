import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { groundShadowProjection } from "../src/groundShadowProjection.js";
import type { RenderCommandBufferView } from "../src/renderCommandDecoder.js";

test("alpha shadow buffers require finite frame metadata; existing commands remain compatible", () => {
  const commands: RenderCommandBufferView = { buffer: new Float32Array(15), commandCount: 1, floatsPerCommand: 15 };
  deepEqual(groundShadowProjection(commands), [1, 0, 1]);
  commands.buffer[13] = 36;
  throws(() => groundShadowProjection(commands), /require groundShadowProjection/);
  for (const values of [[1, 0], [1, 0, NaN], [0, 0, 1], [1, 0, 0], [1, 1, 1], [1, 0, 101]]) {
    commands.groundShadowProjection = new Float32Array(values);
    throws(() => groundShadowProjection(commands), /normalized direction/);
  }
  commands.groundShadowProjection = new Float32Array([0.6, 0.8, 0.01]);
  equal(groundShadowProjection(commands), commands.groundShadowProjection);
});
