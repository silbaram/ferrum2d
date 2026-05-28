import type { RenderCommandBufferView } from "./renderCommandDecoder";

export const SPRITE_RENDER_COMMAND_FLOATS = 14;
const LEGACY_SPRITE_RENDER_COMMAND_FLOATS = 13;

export type SpriteMaterialPresetName = "unlit" | "flash" | "additive" | "outline";
export type SpriteMaterialBlendMode = "alpha" | "additive";
export type SpriteMaterialOutlineDirections = "cardinal" | "diagonal" | "eight";
export type SpriteMaterialColor = readonly [number, number, number, number];

export interface SpriteMaterialColorMix {
  color?: SpriteMaterialColor;
  amount?: number;
  preserveAlpha?: boolean;
}

export interface SpriteMaterialOutlineOptions {
  color?: SpriteMaterialColor;
  thickness?: number;
  directions?: SpriteMaterialOutlineDirections;
}

export interface SpriteMaterialPreset {
  name?: string;
  blendMode?: SpriteMaterialBlendMode;
  colorMix?: SpriteMaterialColorMix;
  outline?: boolean | SpriteMaterialOutlineOptions;
}

export type SpriteMaterialPresetInput = SpriteMaterialPresetName | SpriteMaterialPreset | false | undefined;

export interface ResolvedSpriteMaterialColorMix {
  color: SpriteMaterialColor;
  amount: number;
  preserveAlpha: boolean;
}

export interface ResolvedSpriteMaterialOutline {
  color: SpriteMaterialColor;
  thickness: number;
  directions: SpriteMaterialOutlineDirections;
}

export interface ResolvedSpriteMaterialPreset {
  name: string;
  blendMode: SpriteMaterialBlendMode;
  colorMix?: ResolvedSpriteMaterialColorMix;
  outline?: ResolvedSpriteMaterialOutline;
}

export interface SpriteMaterialPass {
  kind: "outline" | "base";
  blendMode: SpriteMaterialBlendMode;
  offsetX: number;
  offsetY: number;
  colorOverride?: SpriteMaterialColor;
  colorMix?: ResolvedSpriteMaterialColorMix;
}

export const SPRITE_MATERIAL_PRESETS: Readonly<Record<SpriteMaterialPresetName, SpriteMaterialPreset>> = Object.freeze({
  unlit: Object.freeze({
    name: "unlit",
    blendMode: "alpha",
  }),
  flash: Object.freeze({
    name: "flash",
    blendMode: "alpha",
    colorMix: Object.freeze({
      color: Object.freeze([1, 1, 1, 1]) as unknown as SpriteMaterialColor,
      amount: 0.65,
      preserveAlpha: true,
    }),
  }),
  additive: Object.freeze({
    name: "additive",
    blendMode: "additive",
  }),
  outline: Object.freeze({
    name: "outline",
    blendMode: "alpha",
    outline: Object.freeze({
      color: Object.freeze([0, 0, 0, 0.9]) as unknown as SpriteMaterialColor,
      thickness: 2,
      directions: "cardinal",
    }),
  }),
});

export const DEFAULT_SPRITE_MATERIAL_PRESET: ResolvedSpriteMaterialPreset =
  Object.freeze(resolveSpriteMaterialPreset("unlit"));

export function resolveSpriteMaterialPreset(input: SpriteMaterialPresetInput): ResolvedSpriteMaterialPreset {
  if (input === undefined || input === false) {
    return {
      name: "unlit",
      blendMode: "alpha",
    };
  }
  if (typeof input === "string") {
    const preset = SPRITE_MATERIAL_PRESETS[input];
    if (preset === undefined) {
      throw new Error(`Unknown sprite material preset '${input}'.`);
    }
    return resolveSpriteMaterialPreset(preset);
  }

  return {
    name: input.name ?? "custom",
    blendMode: normalizeBlendMode(input.blendMode ?? "alpha"),
    ...(input.colorMix === undefined ? {} : { colorMix: normalizeColorMix(input.colorMix) }),
    ...(input.outline === undefined || input.outline === false
      ? {}
      : { outline: normalizeOutline(input.outline) }),
  };
}

export function spriteMaterialPasses(material: ResolvedSpriteMaterialPreset): readonly SpriteMaterialPass[] {
  const passes: SpriteMaterialPass[] = [];
  if (material.outline !== undefined) {
    const offsets = outlineOffsets(material.outline.thickness, material.outline.directions);
    for (const [offsetX, offsetY] of offsets) {
      passes.push({
        kind: "outline",
        blendMode: "alpha",
        offsetX,
        offsetY,
        colorOverride: material.outline.color,
      });
    }
  }

  passes.push({
    kind: "base",
    blendMode: material.blendMode,
    offsetX: 0,
    offsetY: 0,
    ...(material.colorMix === undefined ? {} : { colorMix: material.colorMix }),
  });
  return passes;
}

export function spriteMaterialPassRequiresCommandCopy(pass: SpriteMaterialPass): boolean {
  return pass.offsetX !== 0
    || pass.offsetY !== 0
    || pass.colorOverride !== undefined
    || pass.colorMix !== undefined;
}

export function writeSpriteMaterialPassCommands(
  source: RenderCommandBufferView,
  startCommand: number,
  endCommand: number,
  pass: SpriteMaterialPass,
  target: Float32Array,
): Float32Array {
  const floatCount = writeSpriteMaterialPassCommandsInto(source, startCommand, endCommand, pass, target);
  return target.subarray(0, floatCount);
}

export function writeSpriteMaterialPassCommandsInto(
  source: RenderCommandBufferView,
  startCommand: number,
  endCommand: number,
  pass: SpriteMaterialPass,
  target: Float32Array,
): number {
  const commandCount = endCommand - startCommand;
  if (commandCount <= 0) {
    return 0;
  }
  assertSupportedCommandLayout(source);
  const floatCount = commandCount * SPRITE_RENDER_COMMAND_FLOATS;
  if (target.length < floatCount) {
    throw new Error("sprite render command staging buffer is too small for the requested command range.");
  }
  if (startCommand < 0 || endCommand > source.commandCount || source.buffer.length < endCommand * source.floatsPerCommand) {
    throw new Error("sprite render command range is outside the source buffer.");
  }

  for (let commandIndex = 0; commandIndex < commandCount; commandIndex += 1) {
    const sourceOffset = (startCommand + commandIndex) * source.floatsPerCommand;
    const targetOffset = commandIndex * SPRITE_RENDER_COMMAND_FLOATS;
    writeCanonicalSpriteCommand(source.buffer, sourceOffset, source.floatsPerCommand, target, targetOffset);
    target[targetOffset] += pass.offsetX;
    target[targetOffset + 1] += pass.offsetY;
    if (pass.colorOverride !== undefined) {
      target[targetOffset + 8] = pass.colorOverride[0];
      target[targetOffset + 9] = pass.colorOverride[1];
      target[targetOffset + 10] = pass.colorOverride[2];
      target[targetOffset + 11] = pass.colorOverride[3];
    } else if (pass.colorMix !== undefined) {
      const mix = pass.colorMix;
      const inverse = 1 - mix.amount;
      target[targetOffset + 8] = target[targetOffset + 8] * inverse + mix.color[0] * mix.amount;
      target[targetOffset + 9] = target[targetOffset + 9] * inverse + mix.color[1] * mix.amount;
      target[targetOffset + 10] = target[targetOffset + 10] * inverse + mix.color[2] * mix.amount;
      if (!mix.preserveAlpha) {
        target[targetOffset + 11] = target[targetOffset + 11] * inverse + mix.color[3] * mix.amount;
      }
    }
  }

  return floatCount;
}

function assertSupportedCommandLayout(source: RenderCommandBufferView): void {
  if (
    !Number.isInteger(source.floatsPerCommand)
    || source.floatsPerCommand < LEGACY_SPRITE_RENDER_COMMAND_FLOATS
  ) {
    throw new Error("sprite render command buffers must contain at least 13 floats per command.");
  }
}

function writeCanonicalSpriteCommand(
  source: Float32Array,
  sourceOffset: number,
  sourceFloatsPerCommand: number,
  target: Float32Array,
  targetOffset: number,
): void {
  target[targetOffset] = source[sourceOffset];
  target[targetOffset + 1] = source[sourceOffset + 1];
  target[targetOffset + 2] = source[sourceOffset + 2];
  target[targetOffset + 3] = source[sourceOffset + 3];
  target[targetOffset + 4] = source[sourceOffset + 4];
  target[targetOffset + 5] = source[sourceOffset + 5];
  target[targetOffset + 6] = source[sourceOffset + 6];
  target[targetOffset + 7] = source[sourceOffset + 7];
  target[targetOffset + 8] = source[sourceOffset + 8];
  target[targetOffset + 9] = source[sourceOffset + 9];
  target[targetOffset + 10] = source[sourceOffset + 10];
  target[targetOffset + 11] = source[sourceOffset + 11];
  target[targetOffset + 12] = source[sourceOffset + 12];
  target[targetOffset + 13] = sourceFloatsPerCommand > LEGACY_SPRITE_RENDER_COMMAND_FLOATS
    ? source[sourceOffset + 13]
    : 0;
}

function normalizeBlendMode(value: SpriteMaterialBlendMode): SpriteMaterialBlendMode {
  if (value !== "alpha" && value !== "additive") {
    throw new Error(`sprite material blendMode must be 'alpha' or 'additive', got '${value}'.`);
  }
  return value;
}

function normalizeColorMix(input: SpriteMaterialColorMix): ResolvedSpriteMaterialColorMix {
  return {
    color: normalizeColor(input.color ?? [1, 1, 1, 1], "colorMix.color"),
    amount: normalizedNumber(input.amount ?? 0.5, "colorMix.amount"),
    preserveAlpha: input.preserveAlpha ?? true,
  };
}

function normalizeOutline(input: true | SpriteMaterialOutlineOptions): ResolvedSpriteMaterialOutline {
  const options = input === true ? {} : input;
  const directions = options.directions ?? "cardinal";
  if (directions !== "cardinal" && directions !== "diagonal" && directions !== "eight") {
    throw new Error(`sprite material outline directions must be 'cardinal', 'diagonal', or 'eight', got '${directions}'.`);
  }
  return {
    color: normalizeColor(options.color ?? [0, 0, 0, 0.9], "outline.color"),
    thickness: positiveNumber(options.thickness ?? 2, "outline.thickness"),
    directions,
  };
}

function outlineOffsets(
  thickness: number,
  directions: SpriteMaterialOutlineDirections,
): Array<readonly [number, number]> {
  const cardinal: Array<readonly [number, number]> = [
    [-thickness, 0],
    [thickness, 0],
    [0, -thickness],
    [0, thickness],
  ];
  if (directions === "cardinal") {
    return cardinal;
  }
  const diagonal: Array<readonly [number, number]> = [
    [-thickness, -thickness],
    [thickness, -thickness],
    [-thickness, thickness],
    [thickness, thickness],
  ];
  return directions === "diagonal" ? diagonal : [...cardinal, ...diagonal];
}

function normalizeColor(input: SpriteMaterialColor, path: string): SpriteMaterialColor {
  if (input.length !== 4) {
    throw new Error(`${path} must contain 4 normalized color channels.`);
  }
  return [
    normalizedNumber(input[0], `${path}[0]`),
    normalizedNumber(input[1], `${path}[1]`),
    normalizedNumber(input[2], `${path}[2]`),
    normalizedNumber(input[3], `${path}[3]`),
  ];
}

function normalizedNumber(value: number, path: string): number {
  const number = finiteNumber(value, path);
  if (number < 0 || number > 1) {
    throw new Error(`${path} must be between 0 and 1.`);
  }
  return number;
}

function positiveNumber(value: number, path: string): number {
  const number = finiteNumber(value, path);
  if (number <= 0) {
    throw new Error(`${path} must be greater than 0.`);
  }
  return number;
}

function finiteNumber(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}
