import type { AssetManifest, LoadedAssets } from "./assetLoader.js";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";
import {
  resolveBitmapFontAtlas,
  resolveFontLoadingPolicy,
} from "./localization.js";
import type {
  BitmapFontAtlasSpec,
  BitmapFontPolicySpec,
  ResolvedBitmapFontAtlas,
} from "./localization.js";

export const WORLD_TEXT_MAX_GLYPHS = 4_096;
export const WORLD_TEXT_MAX_ID = 0x0007ffff;
const WORLD_TEXT_NO_ENTITY = 0xffffffff;

export type WorldTextAlignment = "left" | "center" | "right";
export type WorldTextColor = readonly [number, number, number, number];

export interface WorldTextSpec {
  fontId: number;
  text: string;
  x: number;
  y: number;
  scale?: number;
  color?: WorldTextColor;
  maxWidth?: number;
  alignment?: WorldTextAlignment;
  renderLayer?: number;
  floorId?: number;
  elevation?: number;
  /** 지정하면 x/y는 entity transform 기준 offset입니다. 생략하면 x/y는 월드 좌표입니다. */
  anchor?: GameplayEntityHandle;
}

export interface FerrumBitmapTextApi {
  /** atlas image/data asset을 로드하고 Rust glyph cache에 font를 등록합니다. */
  loadBitmapFont(fontId: number, policy: BitmapFontPolicySpec): Promise<ResolvedBitmapFontAtlas>;
  /** 이미 로드한 texture와 inline atlas metadata로 font를 등록합니다. */
  registerBitmapFont(fontId: number, textureId: number, atlas: BitmapFontAtlasSpec): boolean;
  removeBitmapFont(fontId: number): boolean;
  clearBitmapFonts(): void;
  /** 같은 textId의 text 내용이 같으면 숫자형 update만 사용해 Wasm 문자열 호출을 생략합니다. */
  setWorldText(textId: number, spec: WorldTextSpec): boolean;
  removeWorldText(textId: number): boolean;
  clearWorldTexts(): void;
  worldTextCount(): number;
  worldTextGlyphCount(): number;
}

export interface BitmapTextWasmEngine {
  register_bitmap_font(
    fontId: number,
    textureId: number,
    lineHeight: number,
    fallbackCodePoint: number,
    glyphCodePoints: Uint32Array,
    glyphMetrics: Float32Array,
    kerningCodePoints: Uint32Array,
    kerningAmounts: Float32Array,
  ): boolean;
  remove_bitmap_font(fontId: number): boolean;
  clear_bitmap_fonts(): void;
  set_world_text(
    textId: number,
    fontId: number,
    text: string,
    x: number,
    y: number,
    scale: number,
    r: number,
    g: number,
    b: number,
    a: number,
    maxWidth: number,
    alignmentCode: number,
    renderLayer: number,
    floorId: number,
    elevation: number,
    anchorEntityId: number,
    anchorEntityGeneration: number,
  ): boolean;
  update_world_text(
    textId: number,
    fontId: number,
    x: number,
    y: number,
    scale: number,
    r: number,
    g: number,
    b: number,
    a: number,
    maxWidth: number,
    alignmentCode: number,
    renderLayer: number,
    floorId: number,
    elevation: number,
    anchorEntityId: number,
    anchorEntityGeneration: number,
  ): boolean;
  remove_world_text(textId: number): boolean;
  clear_world_texts(): void;
  world_text_count(): number;
  world_text_glyph_count(): number;
}

export interface BitmapFontAssetHost {
  loadAssets(manifest: AssetManifest): Promise<LoadedAssets>;
}

export interface CreateBitmapTextApiOptions {
  rustEngine: BitmapTextWasmEngine;
  requireAlive(): void;
  requireAssetHost(): BitmapFontAssetHost;
}

interface ResolvedWorldTextSpec {
  fontId: number;
  text: string;
  x: number;
  y: number;
  scale: number;
  color: WorldTextColor;
  maxWidth: number;
  alignment: WorldTextAlignment;
  renderLayer: number;
  floorId: number;
  elevation: number;
  anchorEntityId: number;
  anchorEntityGeneration: number;
}

export function createBitmapTextApi(options: CreateBitmapTextApiOptions): FerrumBitmapTextApi {
  const { rustEngine, requireAlive } = options;
  const textSpecs = new Map<number, ResolvedWorldTextSpec>();
  const fontLoadTails = new Map<number, Promise<unknown>>();

  const registerResolvedBitmapFont = (
    fontId: number,
    textureId: number,
    atlas: ResolvedBitmapFontAtlas,
    lineHeight = atlas.lineHeight,
  ): boolean => {
    const glyphCodePoints = new Uint32Array(atlas.glyphs.map((glyph) => glyph.codePoint));
    const glyphMetrics = new Float32Array(atlas.glyphs.flatMap((glyph) => [
      glyph.u0,
      glyph.v0,
      glyph.u1,
      glyph.v1,
      glyph.width,
      glyph.height,
      glyph.offsetX,
      glyph.offsetY,
      glyph.advance,
    ]));
    const kerningCodePoints = new Uint32Array(atlas.kernings.flatMap((kerning) => [
      kerning.leftCodePoint,
      kerning.rightCodePoint,
    ]));
    const kerningAmounts = new Float32Array(atlas.kernings.map((kerning) => kerning.amount));
    return rustEngine.register_bitmap_font(
      fontId,
      textureId,
      lineHeight,
      atlas.fallbackCodePoint ?? WORLD_TEXT_NO_ENTITY,
      glyphCodePoints,
      glyphMetrics,
      kerningCodePoints,
      kerningAmounts,
    );
  };

  return {
    loadBitmapFont: async (fontIdInput, policy) => {
      requireAlive();
      const fontId = uint32(fontIdInput, "bitmapFont.fontId");
      const resolvedPolicy = resolveFontLoadingPolicy({
        bitmapFonts: { [String(fontId)]: policy },
      }, { path: "bitmapFont.policy" }).bitmapFonts[0];
      const previous = fontLoadTails.get(fontId);
      const current = (previous === undefined
        ? Promise.resolve()
        : previous.catch(() => undefined)).then(async () => {
          requireAlive();
          const imageName = `__ferrum_bitmap_font_${fontId}_image`;
          const dataName = `__ferrum_bitmap_font_${fontId}_data`;
          const manifest: AssetManifest = {
            textures: { [imageName]: resolvedPolicy.image },
            ...(typeof resolvedPolicy.data === "string"
              ? { json: { [dataName]: resolvedPolicy.data } }
              : {}),
          };
          const loaded = await options.requireAssetHost().loadAssets(manifest);
          requireAlive();
          const atlas = typeof resolvedPolicy.data === "string"
            ? resolveBitmapFontAtlas(loaded.json[dataName], { path: `bitmapFont.${fontId}.data` })
            : resolvedPolicy.data;
          const textureId = loaded.textures.textureId(imageName);
          if (!registerResolvedBitmapFont(
            fontId,
            textureId,
            atlas,
            resolvedPolicy.lineHeight ?? atlas.lineHeight,
          )) {
            throw new Error(`Bitmap font ${fontId} was rejected by the Rust runtime.`);
          }
          return atlas;
        });
      fontLoadTails.set(fontId, current);
      try {
        return await current;
      } finally {
        if (fontLoadTails.get(fontId) === current) {
          fontLoadTails.delete(fontId);
        }
      }
    },
    registerBitmapFont: (fontIdInput, textureIdInput, atlasInput) => {
      requireAlive();
      const fontId = uint32(fontIdInput, "bitmapFont.fontId");
      const textureId = uint32(textureIdInput, "bitmapFont.textureId");
      const atlas = resolveBitmapFontAtlas(atlasInput, { path: `bitmapFont.${fontId}.atlas` });
      return registerResolvedBitmapFont(fontId, textureId, atlas);
    },
    removeBitmapFont: (fontIdInput) => {
      requireAlive();
      const fontId = uint32(fontIdInput, "bitmapFont.fontId");
      for (const [textId, spec] of textSpecs) {
        if (spec.fontId === fontId) {
          textSpecs.delete(textId);
        }
      }
      return rustEngine.remove_bitmap_font(fontId);
    },
    clearBitmapFonts: () => {
      requireAlive();
      rustEngine.clear_bitmap_fonts();
      textSpecs.clear();
    },
    setWorldText: (textIdInput, specInput) => {
      requireAlive();
      const textId = worldTextId(textIdInput);
      const spec = resolveWorldTextSpec(specInput, `worldText.${textId}`);
      const cached = textSpecs.get(textId);
      if (cached !== undefined && sameWorldTextSpec(cached, spec)) {
        return true;
      }
      const accepted = cached !== undefined && cached.text === spec.text
        ? rustEngine.update_world_text(
          textId,
          spec.fontId,
          spec.x,
          spec.y,
          spec.scale,
          spec.color[0],
          spec.color[1],
          spec.color[2],
          spec.color[3],
          spec.maxWidth,
          worldTextAlignmentCode(spec.alignment),
          spec.renderLayer,
          spec.floorId,
          spec.elevation,
          spec.anchorEntityId,
          spec.anchorEntityGeneration,
        )
        : rustEngine.set_world_text(
          textId,
          spec.fontId,
          spec.text,
          spec.x,
          spec.y,
          spec.scale,
          spec.color[0],
          spec.color[1],
          spec.color[2],
          spec.color[3],
          spec.maxWidth,
          worldTextAlignmentCode(spec.alignment),
          spec.renderLayer,
          spec.floorId,
          spec.elevation,
          spec.anchorEntityId,
          spec.anchorEntityGeneration,
        );
      if (accepted) {
        textSpecs.set(textId, spec);
      }
      return accepted;
    },
    removeWorldText: (textIdInput) => {
      requireAlive();
      const textId = worldTextId(textIdInput);
      const removed = rustEngine.remove_world_text(textId);
      if (removed) {
        textSpecs.delete(textId);
      }
      return removed;
    },
    clearWorldTexts: () => {
      requireAlive();
      rustEngine.clear_world_texts();
      textSpecs.clear();
    },
    worldTextCount: () => {
      requireAlive();
      return rustEngine.world_text_count();
    },
    worldTextGlyphCount: () => {
      requireAlive();
      return rustEngine.world_text_glyph_count();
    },
  };
}

function resolveWorldTextSpec(spec: WorldTextSpec, path: string): ResolvedWorldTextSpec {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw new Error(`${path} must be an object.`);
  }
  if (typeof spec.text !== "string") {
    throw new Error(`${path}.text must be a string.`);
  }
  if (unicodeCharacterCountExceeds(spec.text, WORLD_TEXT_MAX_GLYPHS)) {
    throw new Error(`${path}.text must contain at most ${WORLD_TEXT_MAX_GLYPHS} Unicode characters.`);
  }
  const color = spec.color ?? [1, 1, 1, 1];
  if (color.length !== 4) {
    throw new Error(`${path}.color must contain exactly four channels.`);
  }
  const anchorEntityId = spec.anchor === undefined
    ? WORLD_TEXT_NO_ENTITY
    : uint32(spec.anchor.entityId, `${path}.anchor.entityId`);
  const anchorEntityGeneration = spec.anchor === undefined
    ? 0
    : uint32(spec.anchor.entityGeneration, `${path}.anchor.entityGeneration`);
  return {
    fontId: uint32(spec.fontId, `${path}.fontId`),
    text: spec.text,
    x: finite(spec.x, `${path}.x`),
    y: finite(spec.y, `${path}.y`),
    scale: positiveFinite(spec.scale ?? 1, `${path}.scale`),
    color: [
      unit(color[0], `${path}.color.0`),
      unit(color[1], `${path}.color.1`),
      unit(color[2], `${path}.color.2`),
      unit(color[3], `${path}.color.3`),
    ],
    maxWidth: nonNegativeFinite(spec.maxWidth ?? 0, `${path}.maxWidth`),
    alignment: worldTextAlignment(spec.alignment, `${path}.alignment`),
    renderLayer: int32(spec.renderLayer ?? 0, `${path}.renderLayer`),
    floorId: uint32(spec.floorId ?? 0, `${path}.floorId`),
    elevation: finite(spec.elevation ?? 0, `${path}.elevation`),
    anchorEntityId,
    anchorEntityGeneration,
  };
}

function unicodeCharacterCountExceeds(value: string, limit: number): boolean {
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > limit) {
      return true;
    }
  }
  return false;
}

function sameWorldTextSpec(left: ResolvedWorldTextSpec, right: ResolvedWorldTextSpec): boolean {
  return left.fontId === right.fontId
    && left.text === right.text
    && left.x === right.x
    && left.y === right.y
    && left.scale === right.scale
    && left.color[0] === right.color[0]
    && left.color[1] === right.color[1]
    && left.color[2] === right.color[2]
    && left.color[3] === right.color[3]
    && left.maxWidth === right.maxWidth
    && left.alignment === right.alignment
    && left.renderLayer === right.renderLayer
    && left.floorId === right.floorId
    && left.elevation === right.elevation
    && left.anchorEntityId === right.anchorEntityId
    && left.anchorEntityGeneration === right.anchorEntityGeneration;
}

function worldTextAlignment(value: unknown, path: string): WorldTextAlignment {
  if (value === undefined || value === "left") return "left";
  if (value === "center" || value === "right") return value;
  throw new Error(`${path} must be left, center, or right.`);
}

function worldTextAlignmentCode(value: WorldTextAlignment): number {
  if (value === "center") return 1;
  if (value === "right") return 2;
  return 0;
}

function worldTextId(value: number): number {
  const id = uint32(value, "worldText.textId");
  if (id > WORLD_TEXT_MAX_ID) {
    throw new Error(`worldText.textId must be at most ${WORLD_TEXT_MAX_ID}.`);
  }
  return id;
}

function uint32(value: number, path: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${path} must be an unsigned 32-bit integer.`);
  }
  return value;
}

function int32(value: number, path: string): number {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new Error(`${path} must be a signed 32-bit integer.`);
  }
  return value;
}

function finite(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function positiveFinite(value: number, path: string): number {
  const next = finite(value, path);
  if (next <= 0) {
    throw new Error(`${path} must be greater than 0.`);
  }
  return next;
}

function nonNegativeFinite(value: number, path: string): number {
  const next = finite(value, path);
  if (next < 0) {
    throw new Error(`${path} must be at least 0.`);
  }
  return next;
}

function unit(value: number, path: string): number {
  const next = finite(value, path);
  if (next < 0 || next > 1) {
    throw new Error(`${path} must be between 0 and 1.`);
  }
  return next;
}
