import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { SoundRegistry } from "../src/soundRegistry.js";
import { TextureRegistry } from "../src/textureRegistry.js";
import { createBitmapTextApi } from "../src/worldText.js";
import type { BitmapTextWasmEngine } from "../src/worldText.js";
import {
  BITMAP_FONT_ATLAS_FORMAT,
  BITMAP_FONT_ATLAS_VERSION,
} from "../src/localization.js";

const TEST_ATLAS = {
  format: BITMAP_FONT_ATLAS_FORMAT,
  version: BITMAP_FONT_ATLAS_VERSION,
  lineHeight: 12,
  fallback: "A",
  glyphs: {
    A: {
      uv: { u0: 0, v0: 0, u1: 0.5, v1: 1 },
      size: { width: 8, height: 10 },
      advance: 9,
    },
    V: {
      uv: { u0: 0.5, v0: 0, u1: 1, v1: 1 },
      size: { width: 8, height: 10 },
      advance: 9,
    },
  },
  kernings: [{ left: "A", right: "V", amount: -1 }],
} as const;

test("bitmap text API sends bulk font metadata and skips unchanged Wasm strings", () => {
  const wasm = new FakeBitmapTextWasm();
  const api = createBitmapTextApi({
    rustEngine: wasm,
    requireAlive: () => undefined,
    requireAssetHost: () => { throw new Error("asset host is not used"); },
  });

  equal(api.registerBitmapFont(3, 9, TEST_ATLAS), true);
  equal(wasm.registerCalls, 1);
  deepEqual([...wasm.glyphCodePoints], [65, 86]);
  equal(wasm.glyphMetrics.length, 18);
  deepEqual([...wasm.kerningCodePoints], [65, 86]);
  deepEqual([...wasm.kerningAmounts], [-1]);

  const spec = {
    fontId: 3,
    text: "AVA",
    x: 100,
    y: 80,
    alignment: "center" as const,
    color: [1, 0.5, 0.25, 1] as const,
    anchor: { entityId: 7, entityGeneration: 2 },
  };
  equal(api.setWorldText(1, spec), true);
  equal(api.setWorldText(1, spec), true);
  equal(wasm.setTextCalls, 1);
  equal(wasm.lastText, "AVA");
  equal(wasm.lastAlignmentCode, 1);
  equal(wasm.lastAnchorEntityId, 7);

  equal(api.setWorldText(1, { ...spec, x: 101 }), true);
  equal(wasm.setTextCalls, 1);
  equal(wasm.updateTextCalls, 1);

  equal(api.setWorldText(1, { ...spec, text: "AV" }), true);
  equal(wasm.setTextCalls, 2);
  equal(api.removeBitmapFont(3), true);
  equal(api.setWorldText(1, { ...spec, text: "AV" }), true);
  equal(wasm.setTextCalls, 3);
});

test("loadBitmapFont consumes BitmapFontPolicySpec image and data assets", async () => {
  const wasm = new FakeBitmapTextWasm();
  const textureRegistry = new TextureRegistry();
  const manifests: unknown[] = [];
  const api = createBitmapTextApi({
    rustEngine: wasm,
    requireAlive: () => undefined,
    requireAssetHost: () => ({
      loadAssets: async (manifest) => {
        manifests.push(manifest);
        const imageName = Object.keys(manifest.textures ?? {})[0];
        const imageUrl = Object.values(manifest.textures ?? {})[0];
        textureRegistry.reserve(imageName, imageUrl);
        const dataName = Object.keys(manifest.json ?? {})[0];
        return {
          textures: textureRegistry,
          sounds: new SoundRegistry(),
          json: { [dataName]: TEST_ATLAS },
          progress: { loaded: 2, total: 2, ratio: 1 },
        };
      },
    }),
  });

  const atlas = await api.loadBitmapFont(4, {
    image: "/fonts/pixel.png",
    data: "/fonts/pixel.json",
    lineHeight: 14,
  });

  equal(manifests.length, 1);
  equal(atlas.glyphs.length, 2);
  equal(wasm.registerCalls, 1);
  equal(wasm.lastLineHeight, 14);
  equal(wasm.lastTextureId, 1);
});

test("loadBitmapFont serializes concurrent loads for the same font id", async () => {
  const wasm = new FakeBitmapTextWasm();
  const textureRegistry = new TextureRegistry();
  const manifests: Array<{ textures?: Record<string, string> }> = [];
  let releaseFirstLoad: () => void = () => undefined;
  const firstLoadGate = new Promise<void>((resolve) => {
    releaseFirstLoad = resolve;
  });
  const api = createBitmapTextApi({
    rustEngine: wasm,
    requireAlive: () => undefined,
    requireAssetHost: () => ({
      loadAssets: async (manifest) => {
        manifests.push(manifest);
        if (manifests.length === 1) {
          await firstLoadGate;
        }
        const imageName = Object.keys(manifest.textures ?? {})[0];
        const imageUrl = Object.values(manifest.textures ?? {})[0];
        textureRegistry.reserve(imageName, imageUrl);
        return {
          textures: textureRegistry,
          sounds: new SoundRegistry(),
          json: {},
          progress: { loaded: 1, total: 1, ratio: 1 },
        };
      },
    }),
  });

  const first = api.loadBitmapFont(4, { image: "/fonts/first.png", data: TEST_ATLAS });
  const second = api.loadBitmapFont(4, { image: "/fonts/second.png", data: TEST_ATLAS });
  await Promise.resolve();
  equal(manifests.length, 1);

  releaseFirstLoad();
  await first;
  await second;

  equal(manifests.length, 2);
  deepEqual(manifests.map((manifest) => Object.values(manifest.textures ?? {})[0]), [
    "/fonts/first.png",
    "/fonts/second.png",
  ]);
  equal(wasm.registerCalls, 2);
});

class FakeBitmapTextWasm implements BitmapTextWasmEngine {
  registerCalls = 0;
  setTextCalls = 0;
  updateTextCalls = 0;
  glyphCodePoints = new Uint32Array();
  glyphMetrics = new Float32Array();
  kerningCodePoints = new Uint32Array();
  kerningAmounts = new Float32Array();
  lastLineHeight = 0;
  lastTextureId = 0;
  lastText = "";
  lastAlignmentCode = 0;
  lastAnchorEntityId = 0;

  register_bitmap_font(
    _fontId: number,
    textureId: number,
    lineHeight: number,
    _fallbackCodePoint: number,
    glyphCodePoints: Uint32Array,
    glyphMetrics: Float32Array,
    kerningCodePoints: Uint32Array,
    kerningAmounts: Float32Array,
  ): boolean {
    this.registerCalls += 1;
    this.lastTextureId = textureId;
    this.lastLineHeight = lineHeight;
    this.glyphCodePoints = new Uint32Array(glyphCodePoints);
    this.glyphMetrics = new Float32Array(glyphMetrics);
    this.kerningCodePoints = new Uint32Array(kerningCodePoints);
    this.kerningAmounts = new Float32Array(kerningAmounts);
    return true;
  }

  remove_bitmap_font(_fontId: number): boolean { return true; }
  clear_bitmap_fonts(): void {}

  set_world_text(
    _textId: number,
    _fontId: number,
    text: string,
    _x: number,
    _y: number,
    _scale: number,
    _r: number,
    _g: number,
    _b: number,
    _a: number,
    _maxWidth: number,
    alignmentCode: number,
    _renderLayer: number,
    _floorId: number,
    _elevation: number,
    anchorEntityId: number,
    _anchorEntityGeneration: number,
  ): boolean {
    this.setTextCalls += 1;
    this.lastText = text;
    this.lastAlignmentCode = alignmentCode;
    this.lastAnchorEntityId = anchorEntityId;
    return true;
  }

  update_world_text(
    _textId: number,
    _fontId: number,
    _x: number,
    _y: number,
    _scale: number,
    _r: number,
    _g: number,
    _b: number,
    _a: number,
    _maxWidth: number,
    alignmentCode: number,
    _renderLayer: number,
    _floorId: number,
    _elevation: number,
    anchorEntityId: number,
    _anchorEntityGeneration: number,
  ): boolean {
    this.updateTextCalls += 1;
    this.lastAlignmentCode = alignmentCode;
    this.lastAnchorEntityId = anchorEntityId;
    return true;
  }

  remove_world_text(_textId: number): boolean { return true; }
  clear_world_texts(): void {}
  world_text_count(): number { return 1; }
  world_text_glyph_count(): number { return 3; }
}
