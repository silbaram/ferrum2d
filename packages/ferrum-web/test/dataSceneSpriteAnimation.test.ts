import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import { configureDataSceneSpriteAnimation, prepareDataSceneSpriteAnimation, dataSceneSpriteClipDurationSeconds, resolveDataSceneSpriteAnimationSet, updateDataSceneSpriteAnimations, type DataSceneSpriteClipSpec } from "../src/dataSceneSpriteAnimation.js";
import { resolveDataSceneComponentsSpec } from "../src/dataSceneComponents.js";
import { validateDataSceneProgress } from "../src/dataSceneProgress.js";

test("cold animation plans validate before entity creation and own their input buffers", () => {
  let calls = 0;
  const engine = { configure_data_scene_sprite_clips_v2(...args: unknown[]) {
    equal(this, engine); calls++; deepEqual([...args[4] as Float32Array], [90, 180]); return true;
  } } as unknown as Engine;
  const input = { clips: [{ id: 0, frames: [{}, {}], frameDurationsMs: [90, 180] }] };
  const plan = prepareDataSceneSpriteAnimation(engine, input);
  equal(calls, 0); input.clips[0].frameDurationsMs[0] = 1;
  equal(plan({ entityId: 1, entityGeneration: 2 }), true); equal(calls, 1);
  throws(() => prepareDataSceneSpriteAnimation({} as Engine, input), /requires compatible Wasm/);
  throws(() => prepareDataSceneSpriteAnimation(engine, { clips: [{ id: 0, fps: 8, frameDurationsMs: [90], frames: [{}] }] }), /exactly one/);
  equal(calls, 1);
});

test("clip authoring survives visual normalization and rejects ambiguous legacy animation", () => {
  const animationSet = { clips: [{ id: 3, frames: [{ u1: 0.5 }], fps: 8 }] };
  const visual = { kind: "sprite", texture: "atlas", width: 32, height: 64, animationSet };
  const result = resolveDataSceneComponentsSpec({ visual, collider: "none", layer: "player" });
  if (result.mode !== "inline") throw new Error("expected inline");
  deepEqual(result.sprite.animationSet, { initialClip: 3, clips: [{ id: 3, frames: [{ u0: 0, v0: 0, u1: 0.5, v1: 1 }], fps: 8, loop: true }] });
  throws(() => resolveDataSceneComponentsSpec({ visual: { ...visual, animation: { frameCount: 4, fps: 8 } }, collider: "none", layer: "player" }), /mutually exclusive/);
});

test("extended clips preserve authored timing, direction and explicit event settings without new defaults", () => {
  const durations = [1, 120.125, 1_000_000];
  const result = resolveDataSceneSpriteAnimationSet({ clips: [{ id: 7, frames: [{}, {}, {}], frameDurationsMs: durations, direction: "pingpong", emitEvents: true }] });
  deepEqual(result.clips[0], { id: 7, frames: Array.from({ length: 3 }, () => ({ u0: 0, v0: 0, u1: 1, v1: 1 })), frameDurationsMs: durations, loop: true, direction: "pingpong", emitEvents: true });
  durations[0] = 99;
  equal(result.clips[0].frameDurationsMs![0], 1);
  deepEqual(resolveDataSceneSpriteAnimationSet({ clips: [{ id: 0, fps: 8, frames: [{}] }] }).clips[0], { id: 0, frames: [{ u0: 0, v0: 0, u1: 1, v1: 1 }], fps: 8, loop: true });
});

test("clips enforce exclusive timing, finite per-frame durations, direction and event flags", () => {
  const clip = { id: 0, frames: [{}, {}], frameDurationsMs: [10, 30] };
  for (const change of [
    { fps: 2 }, { frameDurationsMs: undefined }, { frameDurationsMs: [10] },
    { frameDurationsMs: "10,30" }, { frameDurationsMs: [0, 30] },
    { frameDurationsMs: [1_000_001, 30] }, { frameDurationsMs: [NaN, 30] },
    { frameDurationsMs: [Infinity, 30] }, { frameDurationsMs: new Array(2) },
    { direction: "sideways" }, { direction: null }, { emitEvents: 1 }, { emitEvents: null },
  ]) throws(() => resolveDataSceneSpriteAnimationSet({ clips: [{ ...clip, ...change }] }));
});

test("animation sets permit 256 frames per clip and 4096 original frames total", () => {
  const frames = Array.from({ length: 256 }, () => ({}));
  const clip = { id: 0, frames, fps: 10 };
  equal(resolveDataSceneSpriteAnimationSet({ clips: [clip] }).clips[0].frames.length, 256);
  const clips = Array.from({ length: 16 }, (_, id) => ({ ...clip, id }));
  equal(resolveDataSceneSpriteAnimationSet({ clips }).clips.length, 16);
  throws(() => resolveDataSceneSpriteAnimationSet({ clips: [{ ...clip, frames: [...frames, {}] }] }), /1\.\.256/);
  throws(() => resolveDataSceneSpriteAnimationSet({ clips: [...clips, { id: 16, frames: [{}], fps: 10 }] }), /4096/);
  equal(resolveDataSceneSpriteAnimationSet({ clips: Array.from({ length: 64 }, (_, id) => ({ id, frames: [{}], fps: 10 })) }).clips.length, 64);
  throws(() => resolveDataSceneSpriteAnimationSet({ clips: Array.from({ length: 65 }, (_, id) => ({ id, frames: [{}], fps: 10 })) }), /1\.\.64/);
});

test("duration limits follow original-frame timing and complete nonlooping pingpong returns", () => {
  const base = { id: 0, frames: [{}, {}, {}], fps: 7.1 };
  equal(dataSceneSpriteClipDurationSeconds(base), 3 / Math.fround(7.1));
  equal(dataSceneSpriteClipDurationSeconds({ ...base, direction: "reverse" }), 3 / Math.fround(7.1));
  equal(dataSceneSpriteClipDurationSeconds({ ...base, direction: "pingpong" }), 4 / Math.fround(7.1));
  equal(dataSceneSpriteClipDurationSeconds({ ...base, direction: "pingpong", loop: false }), 5 / Math.fround(7.1));
  const timed = { id: 0, frames: [{}, {}, {}], frameDurationsMs: [10.123456789, 200.123456789, 30.123456789] };
  const [a, b, c] = timed.frameDurationsMs.map((ms) => Math.fround(ms) / 1000);
  equal(dataSceneSpriteClipDurationSeconds(timed), a + b + c);
  equal(dataSceneSpriteClipDurationSeconds({ ...timed, direction: "reverse" }), c + b + a);
  equal(dataSceneSpriteClipDurationSeconds({ ...timed, direction: "pingpong" }), a + b + c + b);
  equal(dataSceneSpriteClipDurationSeconds({ ...timed, direction: "pingpong", loop: false }), a + b + c + b + a);
  equal(dataSceneSpriteClipDurationSeconds({ ...timed, frames: [{}], frameDurationsMs: [125], direction: "pingpong", loop: false }), 0.125);
  equal(dataSceneSpriteClipDurationSeconds({ ...base, frames: [{}, {}], direction: "pingpong" }), 2 / Math.fround(7.1));
});

test("legacy clip configuration keeps the existing Wasm ABI", () => {
  let received: unknown[] = [];
  // Only this setup call is exercised; no native Engine is instantiated.
  const engine = { configure_data_scene_sprite_clips: (...args: unknown[]) => { received = args; return true; } } as unknown as Engine;
  equal(configureDataSceneSpriteAnimation(engine, { entityId: 4, entityGeneration: 2 }, { clips: [{ id: 6, fps: 7.1, frames: [{}, {}] }] }), true);
  deepEqual(received, [4, 2, new Float32Array([6, 2, 7.1, 1]), new Float32Array([0, 0, 1, 1, 0, 0, 1, 1]), 6]);
});

test("v2 setup batches mixed timed and FPS clips and refuses unsupported Wasm", () => {
  let received: unknown[] = [];
  // The optional capability is the only native method needed by this test.
  const engine = { configure_data_scene_sprite_clips_v2: (...args: unknown[]) => { received = args; return false; } } as unknown as Engine;
  const spec = { initialClip: 9, clips: [
    { id: 6, fps: 8, frames: [{}], direction: "reverse" as const, emitEvents: false },
    { id: 9, frameDurationsMs: [100.1234567, 300], frames: [{}, {}], direction: "pingpong" as const, emitEvents: true, loop: false },
  ] };
  equal(configureDataSceneSpriteAnimation(engine, { entityId: 4, entityGeneration: 2 }, spec), false);
  deepEqual(received, [4, 2, new Float32Array([6, 1, 8, 1, 1, 0, 0, 9, 2, 0, 0, 2, 1, 1]), new Float32Array([0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]), new Float32Array([100.1234567, 300]), 9]);
  // Incompatible engines must fail before calling the old setup method.
  const old = { configure_data_scene_sprite_clips: () => { throw Error("old ABI must not be called"); } } as unknown as Engine;
  for (const clip of [
    { id: 0, fps: 8, frames: [{}], direction: "forward" as const },
    { id: 0, fps: 8, frames: [{}], emitEvents: false },
    { id: 0, frames: [{}], frameDurationsMs: [100] },
    { id: 0, fps: 8, frames: Array.from({ length: 33 }, () => ({})) },
  ]) throws(() => configureDataSceneSpriteAnimation(old, { entityId: 4, entityGeneration: 2 }, { clips: [clip] }), /requires compatible Wasm.*v2/);
});

test("seek accepts original frame index 255 and rejects indices beyond the clip limit", () => {
  let received: Uint32Array = new Uint32Array();
  // The packed batch is decoded by native code; this stub captures the boundary.
  const engine = { update_data_scene_sprite_animations: (values: Uint32Array) => { received = values; return true; } } as unknown as Engine;
  equal(updateDataSceneSpriteAnimations(engine, [{ entity: { entityId: 4, entityGeneration: 2 }, frame: 255 }]), true);
  deepEqual([...received], [4, 2, 2, 0, 255, 0, 0, 0]);
  for (const frame of [-1, 256, 0.5, Infinity]) throws(() => updateDataSceneSpriteAnimations(engine, [{ entity: { entityId: 4, entityGeneration: 2 }, frame }]), /frame/);
});

test("malformed animation batches never invoke native updates or coerce null into clip or frame zero", () => {
  let calls = 0;
  // A malformed later item must not send even the preceding valid item to native code.
  const engine = { update_data_scene_sprite_animations: () => { calls++; return true; } } as unknown as Engine;
  const entity = { entityId: 4, entityGeneration: 2 };
  const valid = { entity, clip: 3 };
  const sparse = Object.assign(new Array(2), { 0: valid });
  for (const input of [
    null, {}, [null], [valid, undefined], sparse,
    [valid, { entity, clip: null }], [valid, { entity, frame: null }],
    [valid, { entity: null }],
  ]) {
    throws(() => updateDataSceneSpriteAnimations(engine, input as Parameters<typeof updateDataSceneSpriteAnimations>[1]));
    equal(calls, 0);
  }
  equal(updateDataSceneSpriteAnimations(engine, []), true);
  equal(calls, 1);
});

test("authored progress accepts expanded clip phases and enforces loop and completed boundaries", () => {
  const base: DataSceneSpriteClipSpec = { id: 6, frames: [{}, {}, {}], frameDurationsMs: [100, 250, 50], direction: "pingpong" };
  const document = (clip: DataSceneSpriteClipSpec) => ({
    format: "ferrum2d.consumer.scene-authoring", version: 1,
    sceneComposition: { initialFragment: "arena", prefabs: { actor: { props: { components: { visual: { kind: "sprite", texture: 1, width: 8, height: 8, animationSet: { clips: [clip] } }, collider: "none", layer: "player" } } } }, fragments: { arena: { instances: [{ id: "actor", prefab: "actor", x: 0, y: 0 }] } } },
    behaviorRecipes: { entities: {} },
  });
  const progress = (elapsedSeconds: number) => ({ instances: [{ id: "actor", removed: false, interactionConsumed: false, animation: { clip: 6, elapsedSeconds, paused: false, flipX: false, flipY: false } }], navigation: null });
  validateDataSceneProgress(progress(0.5), document(base));
  throws(() => validateDataSceneProgress(progress(dataSceneSpriteClipDurationSeconds(base)), document(base)), /clip duration/);
  const nonloop = { ...base, loop: false };
  validateDataSceneProgress(progress(dataSceneSpriteClipDurationSeconds(nonloop)), document(nonloop));
  throws(() => validateDataSceneProgress(progress(dataSceneSpriteClipDurationSeconds(nonloop) + 0.001), document(nonloop)), /clip duration/);
  validateDataSceneProgress({ instances: [{ id: "actor", removed: false, interactionConsumed: false }], navigation: null }, document(base));
});

test("bad clips, frames and f32-collapsed UV rectangles fail with authoring diagnostics", () => {
  const clip = { id: 0, frames: [{}], fps: 8 };
  for (const value of [
    { clips: [] }, { clips: new Array(1) }, { clips: [clip, clip] }, { clips: [clip], initialClip: 2 },
    { clips: [{ ...clip, frames: new Array(2) }] },
    { clips: [{ ...clip, fps: Infinity }] }, { clips: [{ ...clip, loop: 1 }] },
    { clips: [{ ...clip, frames: [{ u0: 0.5, u1: 0.5 + Number.EPSILON }] }] },
    { clips: [{ ...clip, frames: [{ u0: 1, u1: 0 }] }] },
  ]) throws(() => resolveDataSceneSpriteAnimationSet(value));
});
