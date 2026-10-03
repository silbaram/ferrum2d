import { deepEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { resolveDataSceneSpriteAnimationSet } from "../src/dataSceneSpriteAnimation.js";
import { resolveDataSceneComponentsSpec } from "../src/dataSceneComponents.js";

test("clip authoring survives visual normalization and rejects ambiguous legacy animation", () => {
  const animationSet = { clips: [{ id: 3, frames: [{ u1: 0.5 }], fps: 8 }] };
  const visual = { kind: "sprite", texture: "atlas", width: 32, height: 64, animationSet };
  const result = resolveDataSceneComponentsSpec({ visual, collider: "none", layer: "player" });
  if (result.mode !== "inline") throw new Error("expected inline");
  deepEqual(result.sprite.animationSet, { initialClip: 3, clips: [{ id: 3, frames: [{ u0: 0, v0: 0, u1: 0.5, v1: 1 }], fps: 8, loop: true }] });
  throws(() => resolveDataSceneComponentsSpec({ visual: { ...visual, animation: { frameCount: 4, fps: 8 } }, collider: "none", layer: "player" }), /mutually exclusive/);
});

test("bad clips, frames and f32-collapsed UV rectangles fail with authoring diagnostics", () => {
  const clip = { id: 0, frames: [{}], fps: 8 };
  for (const value of [
    { clips: [] }, { clips: [clip, clip] }, { clips: [clip], initialClip: 2 },
    { clips: [{ ...clip, fps: Infinity }] }, { clips: [{ ...clip, loop: 1 }] },
    { clips: [{ ...clip, frames: [{ u0: 0.5, u1: 0.5 + Number.EPSILON }] }] },
    { clips: [{ ...clip, frames: [{ u0: 1, u1: 0 }] }] },
  ]) throws(() => resolveDataSceneSpriteAnimationSet(value));
});
