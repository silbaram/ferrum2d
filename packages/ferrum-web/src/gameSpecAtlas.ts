import { MAX_ATLAS_ANIMATION_FRAMES } from "./gameSpecDefaults.js";
import {
  atlasTexture,
  booleanValue,
  gameSpecError,
  nonNegativeInteger,
  normalizedNumber,
  optionalObject,
  positiveNumber,
  requiredPositiveNumber,
} from "./gameSpecValidation.js";
import type {
  ResolvedShooterAtlasAnimation,
  ResolvedShooterAtlasAnimationClip,
  ResolvedShooterAtlasAnimationFrameEvent,
  ResolvedShooterAtlasAnimationState,
  ResolvedShooterAtlasFrame,
  ShooterAtlasAnimationFrameEventKind,
} from "./gameSpecTypes.js";

const ATLAS_ANIMATION_CLIP_IDS = {
  idle: 0,
  move: 1,
  attack: 2,
  die: 3,
} as const;

const ATLAS_ANIMATION_EVENT_KIND_CODES: Record<ShooterAtlasAnimationFrameEventKind, number> = {
  hitbox: 1,
  sound: 2,
  effect: 3,
  custom: 4,
};

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
  const idle = atlasAnimationState(
    atlas.idle,
    `${path}.atlas.idle`,
    atlasFrames,
    undefined,
    true,
  );
  const move = atlasAnimationState(atlas.move, `${path}.atlas.move`, atlasFrames, idle, true);
  const clips: ResolvedShooterAtlasAnimationClip[] = [
    { ...idle, clipId: ATLAS_ANIMATION_CLIP_IDS.idle, name: "idle" },
    { ...move, clipId: ATLAS_ANIMATION_CLIP_IDS.move, name: "move" },
  ];
  const attack = optionalAtlasAnimationState(
    atlas.attack,
    `${path}.atlas.attack`,
    atlasFrames,
    false,
  );
  if (attack) {
    clips.push({ ...attack, clipId: ATLAS_ANIMATION_CLIP_IDS.attack, name: "attack" });
  }
  const die = optionalAtlasAnimationState(atlas.die, `${path}.atlas.die`, atlasFrames, false);
  if (die) {
    clips.push({ ...die, clipId: ATLAS_ANIMATION_CLIP_IDS.die, name: "die" });
  }
  validateAtlasAnimationTextures(clips, `${path}.atlas`, idle.frames[0]);
  const firstFrame = idle.frames[0];
  return {
    texture: firstFrame.texture,
    width: firstFrame.width,
    height: firstFrame.height,
    idle,
    move,
    clips,
  };
}

function atlasAnimationState(
  value: unknown,
  path: string,
  atlasFrames: Record<string, ResolvedShooterAtlasFrame>,
  fallback?: ResolvedShooterAtlasAnimationState,
  defaultLoop = true,
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
    loop: booleanValue(state.loop, `${path}.loop`, defaultLoop),
    events: atlasAnimationFrameEvents(state.events, `${path}.events`, state.frames.length),
  };
}

function optionalAtlasAnimationState(
  value: unknown,
  path: string,
  atlasFrames: Record<string, ResolvedShooterAtlasFrame>,
  defaultLoop: boolean,
): ResolvedShooterAtlasAnimationState | undefined {
  if (value === undefined) {
    return undefined;
  }
  return atlasAnimationState(value, path, atlasFrames, undefined, defaultLoop);
}

function validateAtlasAnimationTextures(
  clips: readonly ResolvedShooterAtlasAnimationClip[],
  path: string,
  expected: ResolvedShooterAtlasFrame,
): void {
  for (const clip of clips) {
    for (const [index, frame] of clip.frames.entries()) {
      const framePath = `${path}.${clip.name}.frames.${index}`;
      if (frame.texture !== expected.texture) {
        throw gameSpecError(framePath, "all atlas animation frames must use the same texture");
      }
    }
  }
}

function atlasAnimationFrameEvents(
  value: unknown,
  path: string,
  frameCount: number,
): ResolvedShooterAtlasAnimationFrameEvent[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw gameSpecError(path, "must be an array");
  }
  return value.map((eventValue, index) => {
    const eventPath = `${path}.${index}`;
    const event = optionalObject(eventValue, eventPath);
    const frame = nonNegativeInteger(event.frame, `${eventPath}.frame`, 0);
    if (frame >= frameCount) {
      throw gameSpecError(`${eventPath}.frame`, "must reference a frame in the animation state");
    }
    const kind = atlasAnimationEventKind(event.kind, `${eventPath}.kind`);
    const token = nonNegativeInteger(event.token, `${eventPath}.token`, index + 1);
    if (token === 0) {
      throw gameSpecError(`${eventPath}.token`, "must be greater than 0");
    }
    return {
      frame,
      eventKind: ATLAS_ANIMATION_EVENT_KIND_CODES[kind],
      token,
    };
  });
}

function atlasAnimationEventKind(value: unknown, path: string): ShooterAtlasAnimationFrameEventKind {
  if (value === undefined) {
    return "custom";
  }
  if (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ATLAS_ANIMATION_EVENT_KIND_CODES, value)
  ) {
    return value as ShooterAtlasAnimationFrameEventKind;
  }
  throw gameSpecError(path, "must be one of hitbox, sound, effect, or custom");
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
