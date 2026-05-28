import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  BREAKOUT_INPUT_ACTION_PROFILE,
  DEFAULT_INPUT_ACTION_PROFILE,
  INPUT_ACTION_PROFILES,
  PLATFORMER_INPUT_ACTION_PROFILE,
  resolveInputActionState,
  TOPDOWN_SHOOTER_INPUT_ACTION_PROFILE,
  type InputActionProfile,
} from "../src/inputProfile.js";
import type { InputSnapshot } from "../src/inputManager.js";

test("resolveInputActionState maps default movement and actions", () => {
  const state = resolveInputActionState(input({ w: true, d: true, mouseLeft: true }));

  equal(state.actions.moveUp, true);
  equal(state.actions.moveRight, true);
  equal(state.actions.primary, true);
  equal(state.axes.moveX, 1);
  equal(state.axes.moveY, -1);
  deepEqual(state.pressedActions, ["moveUp", "moveRight", "primary"]);
});

test("resolveInputActionState supports virtual button profiles", () => {
  const profile: InputActionProfile = {
    actions: {
      jump: [{ control: "space" }, { virtualButton: "jump" }],
      pause: [{ virtualButton: "pause" }],
    },
    axes: {},
  };
  const state = resolveInputActionState(input(), profile, {
    virtualButtons: {
      jump: true,
      pause: false,
    },
  });

  equal(state.actions.jump, true);
  equal(state.actions.pause, false);
});

test("resolveInputActionState accepts JSON-round-tripped profiles", () => {
  const profile = JSON.parse(JSON.stringify(DEFAULT_INPUT_ACTION_PROFILE)) as InputActionProfile;
  const state = resolveInputActionState(input({ enter: true }), profile);

  equal(state.actions.menu, true);
  equal(state.axes.moveX, 0);
});

test("genre input action profile presets map expected actions and axes", () => {
  const topdown = resolveInputActionState(input({ w: true, mouseLeft: true }), TOPDOWN_SHOOTER_INPUT_ACTION_PROFILE);
  equal(topdown.actions.fire, true);
  equal(topdown.axes.moveY, -1);

  const platformer = resolveInputActionState(input({ d: true }), PLATFORMER_INPUT_ACTION_PROFILE, {
    virtualButtons: { primary: true },
  });
  equal(platformer.actions.jump, true);
  equal(platformer.axes.moveX, 1);

  const breakout = resolveInputActionState(input({ a: true, space: true }), BREAKOUT_INPUT_ACTION_PROFILE);
  equal(breakout.actions.launch, true);
  equal(breakout.axes.paddleX, -1);
});

test("input action profile preset map is JSON-friendly", () => {
  const profiles = JSON.parse(JSON.stringify(INPUT_ACTION_PROFILES)) as Record<string, InputActionProfile>;
  equal(resolveInputActionState(input({ mouseLeft: true }), profiles.topdownShooter).actions.fire, true);
  equal(resolveInputActionState(input({ space: true }), profiles.breakout).actions.launch, true);
});

test("resolveInputActionState rejects unknown axis action references", () => {
  try {
    resolveInputActionState(input(), {
      actions: { moveLeft: [{ control: "a" }] },
      axes: { moveX: { negative: "moveLeft", positive: "moveRight" } },
    });
  } catch (error) {
    equal(error instanceof Error ? error.message : String(error), "input.profile.axes.moveX.positive references unknown action 'moveRight'.");
    return;
  }
  throw new Error("expected profile validation to fail");
});

test("resolveInputActionState rejects inherited axis action references", () => {
  const actions = Object.create({ toString: [{ control: "space" }] }) as InputActionProfile["actions"];
  actions.moveLeft = [{ control: "a" }];

  try {
    resolveInputActionState(input(), {
      actions,
      axes: { moveX: { negative: "moveLeft", positive: "toString" } },
    });
  } catch (error) {
    equal(error instanceof Error ? error.message : String(error), "input.profile.axes.moveX.positive references unknown action 'toString'.");
    return;
  }
  throw new Error("expected inherited action validation to fail");
});

function input(overrides: Partial<InputSnapshot> = {}): InputSnapshot {
  return {
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
    enter: false,
    mouseLeft: false,
    mouseX: 0,
    mouseY: 0,
    ...overrides,
  };
}
