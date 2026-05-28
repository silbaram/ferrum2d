import { assetPipelineDiagnosticError } from "./diagnostics.js";
import type { ShooterAtlasFrameSpec } from "./gameSpec.js";
import type {
  AsepriteAtlasFrameSizeSource,
  AsepriteAtlasImportOptions,
  AsepriteAtlasImportResult,
} from "./assetPipelineTypes.js";
import {
  nonNegativeNumber,
  objectValue,
  optionalBoolean,
  optionalObject,
  optionalString,
  positiveNumber,
  requiredString,
  textureValue,
} from "./assetPipelineValidation.js";
import type { JsonRecord } from "./assetPipelineValidation.js";

const ASEPRITE_ROOT_PATH = "assetPipeline.aseprite";

interface AsepriteFrameEntry {
  rawName: string;
  value: JsonRecord;
  path: string;
}

export function importAsepriteAtlas(
  input: unknown,
  options: AsepriteAtlasImportOptions,
): AsepriteAtlasImportResult {
  const texture = textureValue(options.texture, `${ASEPRITE_ROOT_PATH}.texture`);
  const root = objectValue(input, ASEPRITE_ROOT_PATH);
  const meta = objectValue(root.meta, `${ASEPRITE_ROOT_PATH}.meta`);
  const size = objectValue(meta.size, `${ASEPRITE_ROOT_PATH}.meta.size`);
  const width = positiveNumber(size.w, `${ASEPRITE_ROOT_PATH}.meta.size.w`);
  const height = positiveNumber(size.h, `${ASEPRITE_ROOT_PATH}.meta.size.h`);
  const image = optionalString(meta.image, `${ASEPRITE_ROOT_PATH}.meta.image`);
  const frames: Record<string, ShooterAtlasFrameSpec> = {};
  const frameNames: string[] = [];
  const usedNames = new Set<string>();

  for (const entry of asepriteFrames(root.frames, `${ASEPRITE_ROOT_PATH}.frames`)) {
    const frameName = normalizeFrameName(entry.rawName, options);
    if (frameName.length === 0) {
      throw assetPipelineDiagnosticError(entry.path, "frame name must not be empty");
    }
    if (usedNames.has(frameName)) {
      throw assetPipelineDiagnosticError(entry.path, `duplicate imported frame name '${frameName}'`);
    }
    usedNames.add(frameName);
    frameNames.push(frameName);
    frames[frameName] = asepriteFrameSpec(entry, texture, width, height, options.sizeSource ?? "frame");
  }

  return {
    atlas: { frames },
    frameNames,
    image,
    width,
    height,
  };
}

export function importAsepriteAtlasFrames(
  input: unknown,
  options: AsepriteAtlasImportOptions,
): Record<string, ShooterAtlasFrameSpec> {
  return importAsepriteAtlas(input, options).atlas.frames ?? {};
}

function asepriteFrames(value: unknown, path: string): AsepriteFrameEntry[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      const entryPath = `${path}.${index}`;
      const record = objectValue(entry, entryPath);
      return {
        rawName: requiredString(record.filename, `${entryPath}.filename`),
        value: record,
        path: entryPath,
      };
    });
  }

  const record = objectValue(value, path);
  return Object.entries(record).map(([rawName, entry]) => ({
    rawName,
    value: objectValue(entry, `${path}.${rawName}`),
    path: `${path}.${rawName}`,
  }));
}

function asepriteFrameSpec(
  entry: AsepriteFrameEntry,
  texture: string | number,
  atlasWidth: number,
  atlasHeight: number,
  sizeSource: AsepriteAtlasFrameSizeSource,
): ShooterAtlasFrameSpec {
  const rotated = optionalBoolean(entry.value.rotated, `${entry.path}.rotated`);
  if (rotated === true) {
    throw assetPipelineDiagnosticError(entry.path, "rotated Aseprite frames are not supported");
  }

  const frame = objectValue(entry.value.frame, `${entry.path}.frame`);
  const x = nonNegativeNumber(frame.x, `${entry.path}.frame.x`);
  const y = nonNegativeNumber(frame.y, `${entry.path}.frame.y`);
  const width = positiveNumber(frame.w, `${entry.path}.frame.w`);
  const height = positiveNumber(frame.h, `${entry.path}.frame.h`);
  if (x + width > atlasWidth) {
    throw assetPipelineDiagnosticError(`${entry.path}.frame.w`, "frame exceeds atlas width");
  }
  if (y + height > atlasHeight) {
    throw assetPipelineDiagnosticError(`${entry.path}.frame.h`, "frame exceeds atlas height");
  }

  const sourceSize = optionalObject(entry.value.sourceSize, `${entry.path}.sourceSize`);
  const displayWidth = sizeSource === "source" && sourceSize.w !== undefined
    ? positiveNumber(sourceSize.w, `${entry.path}.sourceSize.w`)
    : width;
  const displayHeight = sizeSource === "source" && sourceSize.h !== undefined
    ? positiveNumber(sourceSize.h, `${entry.path}.sourceSize.h`)
    : height;

  return {
    texture,
    uv: {
      u0: x / atlasWidth,
      v0: y / atlasHeight,
      u1: (x + width) / atlasWidth,
      v1: (y + height) / atlasHeight,
    },
    size: {
      width: displayWidth,
      height: displayHeight,
    },
  };
}

function normalizeFrameName(rawName: string, options: AsepriteAtlasImportOptions): string {
  const stripped = options.stripFrameExtension === false
    ? rawName
    : rawName.replace(/\.[^/.\\]+$/, "");
  return `${options.frameNamePrefix ?? ""}${stripped}`;
}
