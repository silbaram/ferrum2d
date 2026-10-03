import type { Engine } from "../pkg/ferrum_core.js";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";
import type { DataSceneSpriteFrameSpec } from "./dataSceneComponents.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import { physicsEntityHandle } from "./physicsHandles.js";

/** IDs are stable caller-defined integers in [0, 65535]; textures are shared independently. */
export interface DataSceneSpriteClipSpec {
  id: number;
  frames: readonly DataSceneSpriteFrameSpec[];
  fps: number;
  loop?: boolean;
}
export interface DataSceneSpriteAnimationSetSpec {
  clips: readonly DataSceneSpriteClipSpec[];
  initialClip?: number;
}
export interface DataSceneSpriteAnimationUpdate {
  entity: GameplayEntityHandle;
  clip?: number;
  /** Defaults to true when clip is supplied. false preserves seconds, wrapping/clamping to the new clip. */
  restart?: boolean;
  /** Zero-based frame within the selected clip; does not implicitly pause. */
  frame?: number;
  flipX?: boolean;
  flipY?: boolean;
  paused?: boolean;
}
export interface DataSceneSpriteAnimationState {
  clip: number;
  frame: number;
  elapsedSeconds: number;
  paused: boolean;
  finished: boolean;
  flipX: boolean;
  flipY: boolean;
}

export function resolveDataSceneSpriteAnimationSet(value: unknown, path = "animationSet"): DataSceneSpriteAnimationSetSpec {
  const input = record(value, path);
  if (!Array.isArray(input.clips) || input.clips.length < 1 || input.clips.length > 64) fail(`${path}.clips`, "must contain 1..64 clips");
  const ids = new Set<number>();
  const clips = input.clips.map((value, index): DataSceneSpriteClipSpec => {
    const label = `${path}.clips[${index}]`;
    const clip = record(value, label);
    const id = integer(clip.id, 65535, `${label}.id`);
    if (ids.has(id)) fail(`${label}.id`, "must be unique");
    ids.add(id);
    const fps = finite(clip.fps, `${label}.fps`);
    if (fps < 0.001 || fps > 1000) fail(`${label}.fps`, "must be in [0.001, 1000]");
    if (!Array.isArray(clip.frames) || clip.frames.length < 1 || clip.frames.length > 32) fail(`${label}.frames`, "must contain 1..32 frames");
    const frames = clip.frames.map((value, frameIndex) => {
      const p = `${label}.frames[${frameIndex}]`;
      const frame = record(value, p);
      const u0 = finite(frame.u0 ?? 0, `${p}.u0`), v0 = finite(frame.v0 ?? 0, `${p}.v0`);
      const u1 = finite(frame.u1 ?? 1, `${p}.u1`), v1 = finite(frame.v1 ?? 1, `${p}.v1`);
      if (u0 < 0 || v0 < 0 || u1 > 1 || v1 > 1 || Math.fround(u1) <= Math.fround(u0) || Math.fround(v1) <= Math.fround(v0)) fail(p, "must have positive UV area in [0, 1] after f32 conversion");
      return { u0, v0, u1, v1 };
    });
    return { id, frames, fps, loop: optionalBoolean(clip.loop, true, `${label}.loop`) };
  });
  const initialClip = integer(input.initialClip ?? clips[0].id, 65535, `${path}.initialClip`);
  if (!ids.has(initialClip)) fail(`${path}.initialClip`, "must reference a configured clip");
  return { clips, initialClip };
}

export function configureDataSceneSpriteAnimation(engine: Engine, entity: GameplayEntityHandle, input: DataSceneSpriteAnimationSetSpec): boolean {
  const handle = physicsEntityHandle(entity);
  const spec = resolveDataSceneSpriteAnimationSet(input);
  const descriptors = new Float32Array(spec.clips.flatMap((clip) => [clip.id, clip.frames.length, clip.fps, clip.loop ? 1 : 0]));
  const frames = new Float32Array(spec.clips.flatMap((clip) => clip.frames.flatMap((frame) => [frame.u0 ?? 0, frame.v0 ?? 0, frame.u1 ?? 1, frame.v1 ?? 1])));
  return engine.configure_data_scene_sprite_clips(handle.entityId, handle.entityGeneration, descriptors, frames, spec.initialClip ?? spec.clips[0].id);
}

export function updateDataSceneSpriteAnimations(engine: Engine, updates: readonly DataSceneSpriteAnimationUpdate[]): boolean {
  const values = new Uint32Array(updates.length * 8);
  updates.forEach((update, index) => {
    const handle = physicsEntityHandle(update.entity);
    let mask = 0;
    if (update.clip !== undefined) mask |= 1 | (optionalBoolean(update.restart, true, "restart") ? 32 : 0);
    else if (update.restart !== undefined) fail("restart", "requires clip");
    if (update.frame !== undefined) mask |= 2;
    if (update.flipX !== undefined) mask |= 4;
    if (update.flipY !== undefined) mask |= 8;
    if (update.paused !== undefined) mask |= 16;
    values.set([handle.entityId, handle.entityGeneration, mask,
      integer(update.clip ?? 0, 65535, "clip"), integer(update.frame ?? 0, 31, "frame"),
      +optionalBoolean(update.flipX, false, "flipX"), +optionalBoolean(update.flipY, false, "flipY"),
      +optionalBoolean(update.paused, false, "paused")], index * 8);
  });
  return engine.update_data_scene_sprite_animations(values);
}

export function dataSceneSpriteAnimationState(engine: Engine, entity: GameplayEntityHandle): DataSceneSpriteAnimationState | undefined {
  const handle = physicsEntityHandle(entity);
  const state = engine.data_scene_sprite_animation_state(handle.entityId, handle.entityGeneration);
  return state.length === 0 ? undefined : { clip: state[0], frame: state[1], elapsedSeconds: state[2], paused: state[3] !== 0, finished: state[4] !== 0, flipX: state[5] !== 0, flipY: state[6] !== 0 };
}

function fail(path: string, message: string): never { throw sceneCompositionDiagnosticError(path, message); }
function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "must be an object");
  return value as Record<string, unknown>;
}
function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value))) fail(path, "must be a finite f32 number");
  return value;
}
function integer(value: unknown, max: number, path: string): number {
  const n = finite(value, path);
  if (!Number.isInteger(n) || n < 0 || n > max) fail(path, `must be an integer in [0, ${max}]`);
  return n;
}
function optionalBoolean(value: unknown, fallback: boolean, path: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail(path, "must be boolean");
  return value;
}
