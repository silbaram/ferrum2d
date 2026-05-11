import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { decodeRenderCommands, type RenderCommandBufferView } from "../src/renderCommandDecoder.js";

test("decodeRenderCommands parses packed sprite command floats", () => {
  const view: RenderCommandBufferView = {
    buffer: new Float32Array([
      10, 20, 30, 40,
      0, 0.25, 0.5, 1,
      0.125, 0.25, 0.5, 1,
      7,
      -1, -2, 3, 4,
      0.5, 0.5, 1, 1,
      1, 0.875, 0.75, 0.625,
      3,
    ]),
    commandCount: 2,
    floatsPerCommand: 13,
  };

  const commands = decodeRenderCommands(view);

  equal(commands.length, 2);
  deepEqual(commands[0], {
    x: 10,
    y: 20,
    width: 30,
    height: 40,
    uv: [0, 0.25, 0.5, 1],
    color: [0.125, 0.25, 0.5, 1],
    textureId: 7,
  });
  deepEqual(commands[1], {
    x: -1,
    y: -2,
    width: 3,
    height: 4,
    uv: [0.5, 0.5, 1, 1],
    color: [1, 0.875, 0.75, 0.625],
    textureId: 3,
  });
});
