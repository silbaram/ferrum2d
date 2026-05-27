import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  SPRITE_RENDER_COMMAND_FLOATS,
  resolveSpriteMaterialPreset,
  spriteMaterialPasses,
  spriteMaterialPassRequiresCommandCopy,
  writeSpriteMaterialPassCommands,
} from "../src/spriteMaterial.js";
import type { RenderCommandBufferView } from "../src/renderCommandDecoder.js";

function commandBuffer(): RenderCommandBufferView {
  return {
    buffer: new Float32Array([
      10, 20, 8, 8,
      0, 0, 1, 1,
      0.2, 0.4, 0.6, 0.75,
      3, 0,
    ]),
    commandCount: 1,
    floatsPerCommand: 14,
  };
}

test("resolveSpriteMaterialPreset exposes built-in flash/additive/outline presets", () => {
  const flash = resolveSpriteMaterialPreset("flash");
  equal(flash.colorMix?.amount, 0.65);
  equal(flash.blendMode, "alpha");

  const additive = resolveSpriteMaterialPreset("additive");
  equal(additive.blendMode, "additive");

  const outline = resolveSpriteMaterialPreset("outline");
  equal(outline.outline?.thickness, 2);
  equal(spriteMaterialPasses(outline).length, 5);
});

test("spriteMaterialPasses builds outline passes before the base sprite pass", () => {
  const material = resolveSpriteMaterialPreset({
    blendMode: "additive",
    outline: { thickness: 3, directions: "diagonal", color: [1, 0, 0, 0.8] },
  });
  const passes = spriteMaterialPasses(material);
  deepEqual(passes.map((pass) => pass.kind), ["outline", "outline", "outline", "outline", "base"]);
  equal(passes[0].offsetX, -3);
  equal(passes[0].offsetY, -3);
  equal(passes[4].blendMode, "additive");
});

test("writeSpriteMaterialPassCommands offsets and recolors a command copy", () => {
  const pass = spriteMaterialPasses(resolveSpriteMaterialPreset("outline"))[0];
  equal(spriteMaterialPassRequiresCommandCopy(pass), true);
  const written = writeSpriteMaterialPassCommands(commandBuffer(), 0, 1, pass, new Float32Array(14));
  equal(written[0], 8);
  equal(written[1], 20);
  deepEqual(Array.from(written.slice(8, 11)), [0, 0, 0]);
  ok(Math.abs(written[11] - 0.9) < 0.00001);
  equal(written[12], 3);
  equal(written[13], 0);
});

test("writeSpriteMaterialPassCommands can mix flash color while preserving alpha", () => {
  const pass = spriteMaterialPasses(resolveSpriteMaterialPreset({
    colorMix: { color: [1, 1, 1, 1], amount: 0.5, preserveAlpha: true },
  }))[0];
  const written = writeSpriteMaterialPassCommands(commandBuffer(), 0, 1, pass, new Float32Array(14));
  ok(Math.abs(written[8] - 0.6) < 0.00001);
  ok(Math.abs(written[9] - 0.7) < 0.00001);
  ok(Math.abs(written[10] - 0.8) < 0.00001);
  ok(Math.abs(written[11] - 0.75) < 0.00001);
});

test("writeSpriteMaterialPassCommands normalizes legacy 13-float commands for GPU upload", () => {
  const pass = spriteMaterialPasses(resolveSpriteMaterialPreset("unlit"))[0];
  const legacyCommands: RenderCommandBufferView = {
    buffer: new Float32Array([
      10, 20, 8, 8,
      0, 0, 1, 1,
      0.2, 0.4, 0.6, 0.75,
      3,
      -4, -5, 6, 7,
      0.1, 0.2, 0.3, 0.4,
      1, 0.9, 0.8, 0.7,
      9,
    ]),
    commandCount: 2,
    floatsPerCommand: 13,
  };

  const written = writeSpriteMaterialPassCommands(
    legacyCommands,
    0,
    2,
    pass,
    new Float32Array(2 * SPRITE_RENDER_COMMAND_FLOATS),
  );

  equal(written.length, 2 * SPRITE_RENDER_COMMAND_FLOATS);
  deepEqual(
    Array.from(written.slice(0, SPRITE_RENDER_COMMAND_FLOATS)),
    Array.from(new Float32Array([
      10, 20, 8, 8,
      0, 0, 1, 1,
      0.2, 0.4, 0.6, 0.75,
      3, 0,
    ])),
  );
  deepEqual(
    Array.from(written.slice(SPRITE_RENDER_COMMAND_FLOATS, 2 * SPRITE_RENDER_COMMAND_FLOATS)),
    Array.from(new Float32Array([
      -4, -5, 6, 7,
      0.1, 0.2, 0.3, 0.4,
      1, 0.9, 0.8, 0.7,
      9, 0,
    ])),
  );
});

test("resolveSpriteMaterialPreset rejects invalid material values", () => {
  expectThrow(() => resolveSpriteMaterialPreset("missing" as "unlit"), /Unknown sprite material preset/);
  expectThrow(() => resolveSpriteMaterialPreset({ outline: { thickness: 0 } }), /outline\.thickness/);
  expectThrow(() => resolveSpriteMaterialPreset({ colorMix: { amount: 2 } }), /colorMix\.amount/);
});

function expectThrow(callback: () => void, pattern: RegExp): void {
  try {
    callback();
  } catch (error) {
    ok(pattern.test(error instanceof Error ? error.message : String(error)));
    return;
  }
  throw new Error(`Expected callback to throw ${pattern}.`);
}
