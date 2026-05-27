#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  AnimationTimelinePlayer,
  animationTimelineFrameAt,
  resolveAnimationTimelineSpec,
} from "../packages/ferrum-web/dist/index.js";

const timeline = resolveAnimationTimelineSpec({
  initialState: "idle",
  states: {
    idle: {
      frames: ["idle.0", "idle.1"],
      fps: 2,
      transitions: [{ on: "move", to: "move" }],
    },
    move: {
      frames: ["move.0", "move.1", "move.2"],
      fps: 3,
      events: [{ frame: 1, id: "footstep", payload: { sound: "step" } }],
      transitions: [{ on: "attack", to: "attack" }],
    },
    attack: {
      frames: ["attack.0", "attack.1", "attack.2"],
      fps: 6,
      loop: false,
      events: [{ frame: 2, id: "hitbox", payload: { damage: 3 } }],
      transitions: [{ atEnd: true, to: "idle" }],
    },
  },
});

const player = AnimationTimelinePlayer.create(timeline);
assert.equal(animationTimelineFrameAt(timeline, "move", 0.5).frame, "move.1");
assert.equal(player.signal("move").transitioned, true);
const move = player.update(0.5);
assert.equal(move.events[0]?.id, "footstep");
assert.equal(player.update(0.01, { signals: ["attack"] }).transitioned, true);
const attack = player.update(0.5);
assert.equal(attack.events[0]?.id, "hitbox");
assert.equal(attack.transitioned, true);
assert.equal(player.currentState(), "idle");

console.log(JSON.stringify({
  animationTimelineSmoke: {
    initialState: timeline.initialState,
    moveEvent: move.events[0]?.id,
    attackEvent: attack.events[0]?.id,
    finalState: player.currentState(),
  },
}, null, 2));
