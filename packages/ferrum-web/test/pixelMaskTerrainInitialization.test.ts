// This file runs in its own Node test process; do not import the native init helper.
import { throws } from "node:assert/strict";
import { test } from "node:test";
import { createPixelMaskTerrain } from "../src/pixelMaskTerrain.js";

test("PixelMaskTerrain fails closed before native initialization", () => {
  throws(() => createPixelMaskTerrain({ width: 1, height: 1 }), /requires initialized Ferrum2D Wasm/);
});
