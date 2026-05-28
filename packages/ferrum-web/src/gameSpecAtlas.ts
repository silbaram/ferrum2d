import { MAX_ATLAS_ANIMATION_FRAMES } from "./gameSpecDefaults.js";
import {
  atlasTexture,
  gameSpecError,
  normalizedNumber,
  optionalObject,
  positiveNumber,
  requiredPositiveNumber,
} from "./gameSpecValidation.js";
import type {
  ResolvedShooterAtlasAnimation,
  ResolvedShooterAtlasAnimationState,
  ResolvedShooterAtlasFrame,
} from "./gameSpecTypes.js";

export function atlasFrameMap(value: unknown, path: string): Record<string, ResolvedShooterAtlasFrame> {
  const atlas = optionalObject(value, path);
  const frames = optionalObject(atlas.frames, `${path}.frames`);
  const resolved: Record<string, ResolvedShooterAtlasFrame> = {};

  for (const [name, frameValue] of Object.entries(frames)) {
    const framePath = `${path}.frames.${name}`;
    if (name.trim().length === 0) {
      throw gameSpecError(framePath, "frame name must be a non-empty string");
    }
    const frame = optionalObject(frameValue, framePath);
    const uv = optionalObject(frame.uv, `${framePath}.uv`);
    const size = optionalObject(frame.size, `${framePath}.size`);
    const u0 = normalizedNumber(uv.u0, `${framePath}.uv.u0`);
    const v0 = normalizedNumber(uv.v0, `${framePath}.uv.v0`);
    const u1 = normalizedNumber(uv.u1, `${framePath}.uv.u1`);
    const v1 = normalizedNumber(uv.v1, `${framePath}.uv.v1`);
    if (u1 <= u0) {
      throw gameSpecError(`${framePath}.uv.u1`, "must be greater than uv.u0");
    }
    if (v1 <= v0) {
      throw gameSpecError(`${framePath}.uv.v1`, "must be greater than uv.v0");
    }

    resolved[name] = {
      name,
      texture: atlasTexture(frame.texture, `${framePath}.texture`),
      width: requiredPositiveNumber(size.width, `${framePath}.size.width`),
      height: requiredPositiveNumber(size.height, `${framePath}.size.height`),
      u0,
      v0,
      u1,
      v1,
    };
  }

  return resolved;
}

export function prefabAtlasFrame(
  value: unknown,
  animation: unknown,
  path: string,
  atlasFrames: Record<string, ResolvedShooterAtlasFrame>,
): ResolvedShooterAtlasFrame | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (animation !== undefined) {
    throw gameSpecError(`${path}.frame`, "cannot be combined with animation");
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw gameSpecError(`${path}.frame`, "must be a non-empty atlas frame name");
  }

  const frameName = value.trim();
  const frame = atlasFrames[frameName];
  if (!frame) {
    throw gameSpecError(`${path}.frame`, "must reference a frame in atlas.frames");
  }
  return frame;
}

export function prefabAtlasAnimation(
  value: unknown,
  path: string,
  atlasFrames: Record<string, ResolvedShooterAtlasFrame>,
): ResolvedShooterAtlasAnimation | undefined {
  if (value === undefined) {
    return undefined;
  }
  const animation = optionalObject(value, path);
  if (animation.atlas === undefined) {
    return undefined;
  }
  if (
    animation.frames !== undefined
    || animation.states !== undefined
    || animation.columns !== undefined
    || animation.rows !== undefined
  ) {
    throw gameSpecError(`${path}.atlas`, "cannot be combined with sprite sheet animation fields");
  }

  const atlas = optionalObject(animation.atlas, `${path}.atlas`);
  const idle = atlasAnimationState(atlas.idle, `${path}.atlas.idle`, atlasFrames);
  const move = atlasAnimationState(atlas.move, `${path}.atlas.move`, atlasFrames, idle);
  validateAtlasAnimationFrameGroup(idle.frames, `${path}.atlas`, idle.frames[0], 0);
  validateAtlasAnimationFrameGroup(move.frames, `${path}.atlas`, idle.frames[0], idle.frames.length);
  const firstFrame = idle.frames[0];
  return {
    texture: firstFrame.texture,
    width: firstFrame.width,
    height: firstFrame.height,
    idle,
    move,
  };
}

function atlasAnimationState(
  value: unknown,
  path: string,
  atlasFrames: Record<string, ResolvedShooterAtlasFrame>,
  fallback?: ResolvedShooterAtlasAnimationState,
): ResolvedShooterAtlasAnimationState {
  if (value === undefined) {
    if (fallback) {
      return fallback;
    }
    throw gameSpecError(path, "must be provided when atlas animation is used");
  }

  const state = optionalObject(value, path);
  if (!Array.isArray(state.frames)) {
    throw gameSpecError(`${path}.frames`, "must be a non-empty array of atlas frame names");
  }
  if (state.frames.length === 0) {
    throw gameSpecError(`${path}.frames`, "must contain at least one atlas frame name");
  }
  if (state.frames.length > MAX_ATLAS_ANIMATION_FRAMES) {
    throw gameSpecError(`${path}.frames`, `must contain at most ${MAX_ATLAS_ANIMATION_FRAMES} frame names`);
  }

  return {
    frames: state.frames.map((frameName, index) =>
      atlasFrameReference(frameName, `${path}.frames.${index}`, atlasFrames),
    ),
    fps: positiveNumber(state.fps, `${path}.fps`, 1),
  };
}

function validateAtlasAnimationFrameGroup(
  frames: readonly ResolvedShooterAtlasFrame[],
  path: string,
  expected: ResolvedShooterAtlasFrame,
  offset: number,
): void {
  for (const [index, frame] of frames.entries()) {
    const framePath = `${path}.frames.${offset + index}`;
    if (frame.texture !== expected.texture) {
      throw gameSpecError(framePath, "all atlas animation frames must use the same texture");
    }
    if (frame.width !== expected.width || frame.height !== expected.height) {
      throw gameSpecError(framePath, "all atlas animation frames must use the same size");
    }
  }
}

export function atlasFrameReference(
  value: unknown,
  path: string,
  atlasFrames: Record<string, ResolvedShooterAtlasFrame>,
): ResolvedShooterAtlasFrame {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw gameSpecError(path, "must be a non-empty atlas frame name");
  }
  const frameName = value.trim();
  const frame = atlasFrames[frameName];
  if (!frame) {
    throw gameSpecError(path, "must reference a frame in atlas.frames");
  }
  return frame;
}
