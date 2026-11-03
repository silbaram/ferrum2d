import { deepEqual } from "node:assert/strict";
import { test } from "node:test";
import {
  GAMEPLAY_EVENT_KIND_SPRITE_ANIMATION_FRAME,
  GAMEPLAY_EVENT_KIND_SPRITE_ANIMATION_COMPLETED,
  GAMEPLAY_EVENT_KIND_SPRITE_ANIMATION_OVERFLOW,
  resolveDataSceneSpriteAnimationSet,
  type DataSceneSpriteAnimationDirection,
  type DataSceneSpriteClipSpec,
} from "../src/core.js";
import type { DataSceneSpriteAnimationDirection as AuthoringDirection } from "../src/authoring.js";
import type { DataSceneSpriteAnimationDirection as RootDirection } from "../src/index.js";

test("public animation facades expose timing, direction and event ABI contracts", () => {
  const directions: [DataSceneSpriteAnimationDirection, AuthoringDirection, RootDirection] = ["forward", "reverse", "pingpong"];
  const clips: DataSceneSpriteClipSpec[] = directions.map((direction, id) => ({ id, frames: [{}], frameDurationsMs: [125], direction, emitEvents: true }));
  deepEqual(resolveDataSceneSpriteAnimationSet({ clips }).clips.map((clip) => clip.direction), directions);
  deepEqual([GAMEPLAY_EVENT_KIND_SPRITE_ANIMATION_FRAME, GAMEPLAY_EVENT_KIND_SPRITE_ANIMATION_COMPLETED, GAMEPLAY_EVENT_KIND_SPRITE_ANIMATION_OVERFLOW], [12, 13, 14]);
});
