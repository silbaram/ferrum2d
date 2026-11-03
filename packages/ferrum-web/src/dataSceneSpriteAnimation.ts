import type { Engine } from "../pkg/ferrum_core.js";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";
import type { DataSceneSpriteFrameSpec } from "./dataSceneComponents.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import { physicsEntityHandle } from "./physicsHandles.js";

/** IDs are stable caller-defined integers in [0, 65535]; textures are shared independently. */
export interface DataSceneSpriteClipSpec {
  id: number;
  frames: readonly DataSceneSpriteFrameSpec[];
  /** Exactly one of fps or frameDurationsMs is required. */
  fps?: number;
  /** Original-frame durations in milliseconds, each in [1, 1_000_000]. */
  frameDurationsMs?: readonly number[];
  loop?: boolean;
  /** Defaults to forward when omitted. */
  direction?: DataSceneSpriteAnimationDirection;
  /** Defaults to false; events are read through onFrame.gameplayEvents. */
  emitEvents?: boolean;
}
export type DataSceneSpriteAnimationDirection = "forward" | "reverse" | "pingpong";
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
  let totalFrames = 0;
  const clips = Array.from(input.clips, (value, index): DataSceneSpriteClipSpec => {
    const label = `${path}.clips[${index}]`;
    const clip = record(value, label);
    const id = integer(clip.id, 65535, `${label}.id`);
    if (ids.has(id)) fail(`${label}.id`, "must be unique");
    ids.add(id);
    if ((clip.fps === undefined) === (clip.frameDurationsMs === undefined)) fail(label, "requires exactly one of fps or frameDurationsMs");
    const fps = clip.fps === undefined ? undefined : finite(clip.fps, `${label}.fps`);
    if (fps !== undefined && (fps < 0.001 || fps > 1000)) fail(`${label}.fps`, "must be in [0.001, 1000]");
    if (!Array.isArray(clip.frames) || clip.frames.length < 1 || clip.frames.length > 256) fail(`${label}.frames`, "must contain 1..256 frames");
    totalFrames += clip.frames.length;
    if (totalFrames > 4096) fail(`${path}.clips`, "must contain at most 4096 original frames in total");
    let frameDurationsMs: number[] | undefined;
    if (clip.frameDurationsMs !== undefined) {
      if (!Array.isArray(clip.frameDurationsMs) || clip.frameDurationsMs.length !== clip.frames.length) fail(`${label}.frameDurationsMs`, "must match frames length");
      frameDurationsMs = Array.from(clip.frameDurationsMs, (value, frameIndex) => {
        const p = `${label}.frameDurationsMs[${frameIndex}]`;
        const duration = finite(value, p);
        if (duration < 1 || duration > 1_000_000) fail(p, "must be in [1, 1000000]");
        return duration;
      });
    }
    const direction = clip.direction;
    if (direction !== undefined && direction !== "forward" && direction !== "reverse" && direction !== "pingpong") fail(`${label}.direction`, "must be forward, reverse or pingpong");
    const emitEvents = clip.emitEvents === undefined ? undefined : optionalBoolean(clip.emitEvents, false, `${label}.emitEvents`);
    const frames = Array.from(clip.frames, (value, frameIndex) => {
      const p = `${label}.frames[${frameIndex}]`;
      const frame = record(value, p);
      const u0 = finite(frame.u0 ?? 0, `${p}.u0`), v0 = finite(frame.v0 ?? 0, `${p}.v0`);
      const u1 = finite(frame.u1 ?? 1, `${p}.u1`), v1 = finite(frame.v1 ?? 1, `${p}.v1`);
      if (u0 < 0 || v0 < 0 || u1 > 1 || v1 > 1 || Math.fround(u1) <= Math.fround(u0) || Math.fround(v1) <= Math.fround(v0)) fail(p, "must have positive UV area in [0, 1] after f32 conversion");
      return { u0, v0, u1, v1 };
    });
    return { id, frames,
      ...(fps === undefined ? {} : { fps }),
      ...(frameDurationsMs === undefined ? {} : { frameDurationsMs }),
      loop: optionalBoolean(clip.loop, true, `${label}.loop`),
      ...(direction === undefined ? {} : { direction }),
      ...(emitEvents === undefined ? {} : { emitEvents }),
    };
  });
  const initialClip = integer(input.initialClip ?? clips[0].id, 65535, `${path}.initialClip`);
  if (!ids.has(initialClip)) fail(`${path}.initialClip`, "must reference a configured clip");
  return { clips, initialClip };
}

/** Native elapsed-phase limit for a validated clip; no playback state is owned here. */
export function dataSceneSpriteClipDurationSeconds(clip: DataSceneSpriteClipSpec): number {
  const count = clip.frames.length;
  const pingpong = clip.direction === "pingpong" && count > 1;
  const stepCount = pingpong ? count * 2 - (clip.loop === false ? 1 : 2) : count;
  // Preserve the legacy division exactly; summing 1/fps can change old save boundaries.
  if (clip.frameDurationsMs === undefined) return stepCount / Math.fround(clip.fps!);
  let duration = 0;
  for (let step = 0; step < stepCount; step++) {
    const frame = clip.direction === "reverse" ? count - 1 - step : step < count ? step : count * 2 - 2 - step;
    duration += Math.fround(clip.frameDurationsMs[frame]) / 1000;
  }
  return duration;
}

export function configureDataSceneSpriteAnimation(engine: Engine, entity: GameplayEntityHandle, input: DataSceneSpriteAnimationSetSpec): boolean {
  const handle = physicsEntityHandle(entity);
  return prepareDataSceneSpriteAnimation(engine, input)(handle);
}

/** Cold-path plan; validate config/capability before a runtime target spawns an entity. */
export function prepareDataSceneSpriteAnimation(engine: Engine, input: DataSceneSpriteAnimationSetSpec): (entity: GameplayEntityHandle) => boolean {
  const spec = resolveDataSceneSpriteAnimationSet(input);
  const frames = new Float32Array(spec.clips.flatMap((clip) => clip.frames.flatMap((frame) => [frame.u0 ?? 0, frame.v0 ?? 0, frame.u1 ?? 1, frame.v1 ?? 1])));
  if (spec.clips.some((clip) => clip.frames.length > 32 || clip.frameDurationsMs !== undefined || clip.direction !== undefined || clip.emitEvents !== undefined)) {
    // A structural capability keeps old generated Wasm declarations loadable until rebuilt.
    const api = engine as Engine & { configure_data_scene_sprite_clips_v2?: (id: number, generation: number, descriptors: Float32Array, frames: Float32Array, durationsMs: Float32Array, initialClip: number) => boolean };
    if (typeof api.configure_data_scene_sprite_clips_v2 !== "function") throw new Error("Extended Data Scene sprite animation requires compatible Wasm with configure_data_scene_sprite_clips_v2.");
    const configure = api.configure_data_scene_sprite_clips_v2.bind(api);
    const descriptors = new Float32Array(spec.clips.flatMap((clip) => [clip.id, clip.frames.length, clip.fps ?? 0, clip.loop ? 1 : 0, clip.direction === "reverse" ? 1 : clip.direction === "pingpong" ? 2 : 0, clip.emitEvents ? 1 : 0, clip.frameDurationsMs === undefined ? 0 : 1]));
    const durationsMs = new Float32Array(spec.clips.flatMap((clip) => clip.frameDurationsMs === undefined ? [] : [...clip.frameDurationsMs]));
    return entity => { const handle = physicsEntityHandle(entity); return configure(handle.entityId, handle.entityGeneration, descriptors, frames, durationsMs, spec.initialClip ?? spec.clips[0].id); };
  }
  const descriptors = new Float32Array(spec.clips.flatMap((clip) => [clip.id, clip.frames.length, clip.fps!, clip.loop ? 1 : 0]));
  const configure = engine.configure_data_scene_sprite_clips.bind(engine);
  return entity => { const handle = physicsEntityHandle(entity); return configure(handle.entityId, handle.entityGeneration, descriptors, frames, spec.initialClip ?? spec.clips[0].id); };
}

export function updateDataSceneSpriteAnimations(engine: Engine, updates: readonly DataSceneSpriteAnimationUpdate[]): boolean {
  if (!Array.isArray(updates)) fail("animationUpdates", "must be an array");
  const values = new Uint32Array(updates.length * 8);
  for (let index = 0; index < updates.length; index++) {
    const update = updates[index];
    const path = `animationUpdates[${index}]`;
    // Indexed traversal also validates sparse array entries before the atomic native call.
    record(update, path);
    record(update.entity, `${path}.entity`);
    const handle = physicsEntityHandle(update.entity);
    let mask = 0;
    if (update.clip !== undefined) mask |= 1 | (optionalBoolean(update.restart, true, "restart") ? 32 : 0);
    else if (update.restart !== undefined) fail("restart", "requires clip");
    if (update.frame !== undefined) mask |= 2;
    if (update.flipX !== undefined) mask |= 4;
    if (update.flipY !== undefined) mask |= 8;
    if (update.paused !== undefined) mask |= 16;
    values.set([handle.entityId, handle.entityGeneration, mask,
      integer(update.clip === undefined ? 0 : update.clip, 65535, `${path}.clip`), integer(update.frame === undefined ? 0 : update.frame, 255, `${path}.frame`),
      +optionalBoolean(update.flipX, false, "flipX"), +optionalBoolean(update.flipY, false, "flipY"),
      +optionalBoolean(update.paused, false, "paused")], index * 8);
  }
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
