import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  applyVirtualControlStateToSnapshot,
  DEFAULT_VIRTUAL_CONTROL_BUTTONS,
} from "../src/virtualControls.js";
import type { InputSnapshot } from "../src/inputManager.js";
import type { VirtualControlsState } from "../src/virtualControls.js";

test("applyVirtualControlStateToSnapshot merges joystick directions and default buttons", () => {
  const merged = applyVirtualControlStateToSnapshot(input({ a: true }), state({
    w: true,
    d: true,
    buttons: { primary: true, menu: true },
    virtualButtons: { primary: true, menu: true },
  }));

  deepEqual(merged, {
    w: true,
    a: true,
    s: false,
    d: true,
    space: true,
    enter: true,
    mouseLeft: true,
    mouseX: 0,
    mouseY: 0,
  });
});

test("applyVirtualControlStateToSnapshot supports JSON-friendly custom button bindings", () => {
  const merged = applyVirtualControlStateToSnapshot(input(), state({
    buttons: { pause: true },
    virtualButtons: { pause: true },
  }), [{
    id: "pause",
    label: "Pause",
    controls: ["enter"],
    virtualButton: "pause",
  }]);

  equal(merged.enter, true);
  equal(merged.space, false);
});

test("DEFAULT_VIRTUAL_CONTROL_BUTTONS keeps primary and menu defaults stable", () => {
  deepEqual(DEFAULT_VIRTUAL_CONTROL_BUTTONS.map((button) => ({
    id: button.id,
    controls: button.controls,
    virtualButton: button.virtualButton,
  })), [
    { id: "primary", controls: ["space", "mouseLeft"], virtualButton: "primary" },
    { id: "menu", controls: ["enter"], virtualButton: "menu" },
  ]);
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

function state(overrides: Partial<VirtualControlsState> = {}): VirtualControlsState {
  return {
    w: false,
    a: false,
    s: false,
    d: false,
    buttons: {},
    virtualButtons: {},
    ...overrides,
  };
}
