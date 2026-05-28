import { equal } from "node:assert/strict";
import { test } from "node:test";
import { webGpuSpriteStagingCapacity } from "../src/webgpuSpritePass.js";

test("webGpuSpriteStagingCapacity grows material staging buffers by powers of two", () => {
  equal(webGpuSpriteStagingCapacity(0), 1);
  equal(webGpuSpriteStagingCapacity(1), 1);
  equal(webGpuSpriteStagingCapacity(14), 16);
  equal(webGpuSpriteStagingCapacity(16), 16);
  equal(webGpuSpriteStagingCapacity(17), 32);
});
