import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  AnimationTimelinePlayer,
  animationTimelineFrameAt,
  resolveAnimationTimelineSpec,
} from "../src/animationTimeline.js";
import type { AnimationTimelineSpec } from "../src/animationTimeline.js";

function sampleTimeline(): AnimationTimelineSpec {
  return {
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
        events: [{ frame: 1, id: "footstep", payload: { foot: "left" } }],
        transitions: [{ on: "attack", to: "attack" }],
      },
      attack: {
        frames: ["attack.0", "attack.1", "attack.2"],
        fps: 6,
        loop: false,
        events: [{ frame: 2, id: "hitbox", payload: { damage: 2 } }],
        transitions: [{ atEnd: true, to: "idle" }],
      },
    },
  };
}

test("resolveAnimationTimelineSpec fills defaults and validates transitions", () => {
  const timeline = resolveAnimationTimelineSpec(sampleTimeline());
  equal(timeline.initialState, "idle");
  equal(timeline.states.move.durationSeconds, 1);
  equal(timeline.states.attack.loop, false);
  equal(timeline.states.attack.transitions[0].atEnd, true);
});

test("animationTimelineFrameAt resolves looping and non-looping frame snapshots", () => {
  const timeline = resolveAnimationTimelineSpec(sampleTimeline());
  deepEqual(animationTimelineFrameAt(timeline, "move", 0.5), {
    state: "move",
    frameIndex: 1,
    frame: "move.1",
    elapsedSeconds: 0.5,
    loopCount: 0,
    completed: false,
  });
  equal(animationTimelineFrameAt(timeline, "attack", 1).frame, "attack.2");
  equal(animationTimelineFrameAt(timeline, "attack", 1).completed, true);
});

test("AnimationTimelinePlayer emits frame events and signal transitions", () => {
  const player = AnimationTimelinePlayer.create(sampleTimeline());
  equal(player.currentState(), "idle");
  equal(player.signal("move").transitioned, true);
  equal(player.currentState(), "move");

  const moveUpdate = player.update(0.5);
  equal(moveUpdate.events.length, 1);
  equal(moveUpdate.events[0].id, "footstep");
  deepEqual(moveUpdate.events[0].payload, { foot: "left" });

  const attackSignal = player.update(0.01, { signals: ["attack"] });
  equal(attackSignal.transitioned, true);
  equal(player.currentState(), "attack");

  const attackUpdate = player.update(0.5);
  equal(attackUpdate.events[0].id, "hitbox");
  equal(attackUpdate.transitioned, true);
  equal(player.currentState(), "idle");
});

test("AnimationTimelinePlayer caps emitted events per update", () => {
  const player = AnimationTimelinePlayer.create({
    states: {
      loop: {
        frameCount: 2,
        fps: 2,
        events: [{ frame: 0, id: "tick0" }, { frame: 1, id: "tick1" }],
      },
    },
  });
  const update = player.update(5, { maxEvents: 3 });
  deepEqual(update.events.map((event) => event.id), ["tick1", "tick0", "tick1"]);
});

test("resolveAnimationTimelineSpec rejects invalid timelines", () => {
  expectThrows(() => resolveAnimationTimelineSpec({ states: {} }), /at least one state/);
  expectThrows(() => resolveAnimationTimelineSpec({
    states: { idle: { frameCount: 0 } },
  }), /frameCount/);
  expectThrows(() => resolveAnimationTimelineSpec({
    states: { idle: { frameCount: 1, transitions: [{ to: "missing" }] } },
  }), /unknown state/);
  expectThrows(() => resolveAnimationTimelineSpec({
    states: { idle: { frameCount: 1, events: [{ frame: 2, id: "bad" }] } },
  }), /outside the frame range/);
});

function expectThrows(fn: () => void, pattern: RegExp): void {
  try {
    fn();
  } catch (error) {
    equal(error instanceof Error, true);
    equal(pattern.test(error instanceof Error ? error.message : String(error)), true);
    return;
  }
  throw new Error("Expected function to throw.");
}
