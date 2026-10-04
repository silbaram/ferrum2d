import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { InputManager } from "../src/inputManager.js";
import { VirtualControls } from "../src/virtualControls.js";

type Listener = (event: Record<string, unknown>) => void;

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener, _options?: unknown): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Record<string, unknown>): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeCanvas extends FakeEventTarget {
  getBoundingClientRect(): { left: number; top: number } {
    return { left: 10, top: 20 };
  }
}

function keyEvent(code: string): Record<string, unknown> {
  const event = {
    code,
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
  };
  return event;
}

function preventableEvent(fields: Record<string, unknown>): Record<string, unknown> {
  const event = {
    ...fields,
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
  };
  return event;
}

function touchList(...touches: Array<{ identifier: number; clientX: number; clientY: number }>): TouchList {
  return {
    length: touches.length,
    item(index: number): Touch | null {
      return (touches[index] as Touch | undefined) ?? null;
    },
  } as TouchList;
}

function gamepadButton(pressed: boolean, value = pressed ? 1 : 0): GamepadButton {
  return { pressed, touched: pressed, value };
}

function gamepadSnapshot(
  axes: readonly number[],
  buttons: readonly GamepadButton[],
): Gamepad {
  return {
    axes,
    buttons,
    connected: true,
    id: "fake-gamepad",
    index: 0,
    mapping: "standard",
    timestamp: 1,
  } as Gamepad;
}

function withWindowAndNavigator(
  fakeWindow: FakeEventTarget,
  navigatorValue: Pick<Navigator, "getGamepads"> | undefined,
  run: () => void,
): void {
  const previousWindow = (globalThis as unknown as { window?: unknown }).window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  (globalThis as unknown as { window: unknown }).window = fakeWindow;
  if (navigatorValue) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: navigatorValue,
    });
  }
  try {
    run();
  } finally {
    (globalThis as unknown as { window?: unknown }).window = previousWindow;
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      delete (globalThis as unknown as { navigator?: unknown }).navigator;
    }
  }
}

test("InputManager snapshot reflects keyboard and mouse state", () => {
  const fakeWindow = new FakeEventTarget();
  const canvas = new FakeCanvas();
  withWindowAndNavigator(fakeWindow, undefined, () => {
    const input = new InputManager(canvas as unknown as HTMLCanvasElement);
    fakeWindow.dispatch("keydown", keyEvent("KeyW"));
    fakeWindow.dispatch("keydown", keyEvent("Enter"));
    canvas.dispatch("mousemove", { clientX: 42, clientY: 63 });
    canvas.dispatch("mousedown", { button: 0 });

    let snapshot = input.snapshot();
    equal(snapshot.w, true);
    equal(snapshot.enter, true);
    equal(snapshot.mouseLeft, true);
    equal(snapshot.mouseX, 32);
    equal(snapshot.mouseY, 43);
    const pressedSnapshot = snapshot;

    fakeWindow.dispatch("keyup", keyEvent("KeyW"));
    fakeWindow.dispatch("keyup", keyEvent("Enter"));
    fakeWindow.dispatch("mouseup", { button: 0 });
    snapshot = input.snapshot();

    ok(snapshot !== pressedSnapshot);
    equal(pressedSnapshot.w, true);
    equal(snapshot.w, false);
    equal(snapshot.enter, false);
    equal(snapshot.mouseLeft, false);
    input.destroy();
    input.destroy();
    equal(fakeWindow.listenerCount("keydown"), 0);
    equal(fakeWindow.listenerCount("keyup"), 0);
    equal(fakeWindow.listenerCount("mouseup"), 0);
    equal(fakeWindow.listenerCount("pointerup"), 0);
    equal(fakeWindow.listenerCount("pointercancel"), 0);
    equal(fakeWindow.listenerCount("touchend"), 0);
    equal(fakeWindow.listenerCount("touchcancel"), 0);
    equal(canvas.listenerCount("mousemove"), 0);
    equal(canvas.listenerCount("mousedown"), 0);
    equal(canvas.listenerCount("pointerdown"), 0);
    equal(canvas.listenerCount("pointermove"), 0);
    equal(canvas.listenerCount("touchstart"), 0);
    equal(canvas.listenerCount("touchmove"), 0);

    fakeWindow.dispatch("keydown", keyEvent("KeyW"));
    canvas.dispatch("mousedown", { button: 0 });
    snapshot = input.snapshot();
    equal(snapshot.w, false);
    equal(snapshot.mouseLeft, false);
  });
});

test("InputManager maps non-mouse pointer drags to movement gestures", () => {
  const fakeWindow = new FakeEventTarget();
  const canvas = new FakeCanvas();
  withWindowAndNavigator(fakeWindow, undefined, () => {
    const input = new InputManager(canvas as unknown as HTMLCanvasElement, {
      pointerGestureThreshold: 10,
    });

    canvas.dispatch("pointerdown", preventableEvent({
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 30,
      clientY: 40,
    }));
    canvas.dispatch("pointermove", preventableEvent({
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 54,
      clientY: 25,
    }));

    let snapshot = input.snapshot();
    equal(snapshot.mouseLeft, true);
    equal(snapshot.mouseX, 44);
    equal(snapshot.mouseY, 5);
    equal(snapshot.w, true);
    equal(snapshot.d, true);

    fakeWindow.dispatch("pointerup", { pointerId: 7 });
    snapshot = input.snapshot();
    equal(snapshot.mouseLeft, false);
    equal(snapshot.w, false);
    equal(snapshot.d, false);
    input.destroy();
  });
});

test("InputManager keeps touch fallback behavior for browsers without pointer events", () => {
  const fakeWindow = new FakeEventTarget();
  const canvas = new FakeCanvas();
  withWindowAndNavigator(fakeWindow, undefined, () => {
    const input = new InputManager(canvas as unknown as HTMLCanvasElement, {
      pointerGestureThreshold: 8,
    });

    canvas.dispatch("touchstart", preventableEvent({
      changedTouches: touchList({ identifier: 3, clientX: 20, clientY: 30 }),
    }));
    canvas.dispatch("touchmove", preventableEvent({
      changedTouches: touchList({ identifier: 3, clientX: 8, clientY: 54 }),
    }));

    let snapshot = input.snapshot();
    equal(snapshot.mouseLeft, true);
    equal(snapshot.mouseX, -2);
    equal(snapshot.mouseY, 34);
    equal(snapshot.a, true);
    equal(snapshot.s, true);

    fakeWindow.dispatch("touchend", {
      changedTouches: touchList({ identifier: 3, clientX: 8, clientY: 54 }),
    });
    snapshot = input.snapshot();
    equal(snapshot.mouseLeft, false);
    equal(snapshot.a, false);
    equal(snapshot.s, false);
    input.destroy();
  });
});

test("InputManager folds gamepad axes and buttons into snapshots", () => {
  const fakeWindow = new FakeEventTarget();
  const canvas = new FakeCanvas();
  const buttons = Array.from({ length: 10 }, () => gamepadButton(false));
  buttons[0] = gamepadButton(true);
  buttons[7] = gamepadButton(false, 0.75);
  buttons[9] = gamepadButton(true);
  withWindowAndNavigator(fakeWindow, {
    getGamepads: () => [gamepadSnapshot([0.8, -0.7], buttons)],
  }, () => {
    const input = new InputManager(canvas as unknown as HTMLCanvasElement, {
      gamepadDeadzone: 0.25,
    });
    const snapshot = input.snapshot();
    equal(snapshot.w, true);
    equal(snapshot.d, true);
    equal(snapshot.space, true);
    equal(snapshot.enter, true);
    equal(snapshot.mouseLeft, true);
    input.destroy();
  });
});

test("InputManager can disable gamepad polling", () => {
  const fakeWindow = new FakeEventTarget();
  const canvas = new FakeCanvas();
  withWindowAndNavigator(fakeWindow, {
    getGamepads: () => [gamepadSnapshot([1, -1], [gamepadButton(true)])],
  }, () => {
    const input = new InputManager(canvas as unknown as HTMLCanvasElement, {
      gamepad: false,
    });
    const snapshot = input.snapshot();
    equal(snapshot.w, false);
    equal(snapshot.d, false);
    equal(snapshot.space, false);
    input.destroy();
  });
});

test("InputManager supports JSON-friendly gamepad remapping", () => {
  const fakeWindow = new FakeEventTarget();
  const canvas = new FakeCanvas();
  const buttons = Array.from({ length: 12 }, () => gamepadButton(false));
  buttons[2] = gamepadButton(true);
  buttons[4] = gamepadButton(true);
  buttons[11] = gamepadButton(true);
  withWindowAndNavigator(fakeWindow, {
    getGamepads: () => [gamepadSnapshot([0, 0, -0.9, 0.8], buttons)],
  }, () => {
    const input = new InputManager(canvas as unknown as HTMLCanvasElement, {
      gamepadDeadzone: 0.25,
      gamepadMapping: {
        moveXAxis: 2,
        moveYAxis: 3,
        actionButtons: [2],
        menuButtons: [11],
        pointerButtons: [4],
      },
    });
    const snapshot = input.snapshot();
    equal(snapshot.a, true);
    equal(snapshot.s, true);
    equal(snapshot.space, true);
    equal(snapshot.enter, true);
    equal(snapshot.mouseLeft, true);
    input.destroy();
  });
});


test("key aliases keep movement held until the last physical key is released", () => {
  const win = new FakeEventTarget();
  withWindowAndNavigator(win, undefined, () => {
    const aliases = ["KeyW", "ArrowUp"];
    const input = new InputManager(new FakeCanvas() as unknown as HTMLCanvasElement, {
      keyBindings: { w: aliases, space: [] }, gamepad: false,
    });
    aliases.length = 0; // The manager owns a copy of authoring data.
    win.dispatch("keydown", keyEvent("KeyW"));
    win.dispatch("keydown", keyEvent("ArrowUp"));
    win.dispatch("keyup", keyEvent("KeyW"));
    equal(input.snapshot().w, true);
    equal(input.actionSnapshot().axes.moveY, -1);
    win.dispatch("keyup", keyEvent("ArrowUp"));
    equal(input.snapshot().w, false);
    const space = keyEvent("Space");
    win.dispatch("keydown", space);
    equal(input.snapshot().space, false);
    equal(space.prevented, false);
    input.destroy();
  });
});

test("named actions retain short taps and expose held separately from consumable edges", () => {
  const win = new FakeEventTarget();
  withWindowAndNavigator(win, undefined, () => {
    const profile = { actions: {
      interact: [{ code: "KeyE" }], sprint: [{ code: "ShiftLeft" }, { code: "ShiftRight" }],
    } };
    const input = new InputManager(new FakeCanvas() as unknown as HTMLCanvasElement, { actionProfile: profile, gamepad: false });
    profile.actions.interact[0].code = "KeyQ";
    win.dispatch("keydown", keyEvent("KeyE"));
    win.dispatch("keyup", keyEvent("KeyE"));
    win.dispatch("keydown", keyEvent("ShiftLeft"));
    input.snapshot(); // Legacy sampling never consumes edges.
    const first = input.actionSnapshot();
    deepEqual(first.justPressedActions, ["interact", "sprint"]);
    deepEqual(first.releasedActions, ["interact"]);
    deepEqual(first.pressedActions, ["sprint"]);
    equal(first.actions.interact, false);
    const second = input.actionSnapshot();
    deepEqual(second.justPressedActions, []);
    deepEqual(second.releasedActions, []);
    equal(second.actions.sprint, true);
    input.clear();
    deepEqual(input.actionSnapshot().releasedActions, []);
    equal(input.actionSnapshot().actions.sprint, false);
    input.destroy();
  });
});

test("disable, clear, blur and visibility cancel held input without resurrecting repeats", () => {
  const win = new FakeEventTarget();
  const doc = Object.assign(new FakeEventTarget(), { defaultView: win, hidden: false });
  const canvas = Object.assign(new FakeCanvas(), { ownerDocument: doc });
  withWindowAndNavigator(win, undefined, () => {
    const input = new InputManager(canvas as unknown as HTMLCanvasElement, { gamepad: false });
    win.dispatch("keydown", keyEvent("KeyW"));
    input.setEnabled(false);
    deepEqual(input.actionSnapshot().justPressedActions, []);
    const disabledKey = keyEvent("KeyD");
    win.dispatch("keydown", disabledKey);
    equal(disabledKey.prevented, false);
    win.dispatch("keyup", keyEvent("KeyW")); // Release while a modal owns input.
    input.setEnabled(true);
    win.dispatch("keydown", { ...keyEvent("KeyD"), repeat: true });
    equal(input.snapshot().d, false);
    win.dispatch("keyup", keyEvent("KeyD"));
    win.dispatch("keydown", keyEvent("KeyD"));
    equal(input.snapshot().d, true);
    win.dispatch("blur", {});
    equal(input.snapshot().d, false);
    win.dispatch("keyup", keyEvent("KeyD"));
    win.dispatch("focus", {});
    win.dispatch("keydown", keyEvent("KeyW"));
    doc.hidden = true;
    doc.dispatch("visibilitychange", {});
    equal(input.snapshot().w, false);
    doc.hidden = false;
    doc.dispatch("visibilitychange", {});
    win.dispatch("keydown", { ...keyEvent("KeyW"), repeat: true });
    equal(input.snapshot().w, false);
    win.dispatch("keyup", keyEvent("KeyW"));
    win.dispatch("keydown", keyEvent("KeyW"));
    equal(input.snapshot().w, true);
    input.destroy();
    equal(doc.listenerCount("visibilitychange"), 0);
    equal(win.listenerCount("focus"), 0);
    equal(win.listenerCount("blur"), 0);
  });
});

test("editable targets do not consume gameplay keys and require fresh input on return", () => {
  const win = new FakeEventTarget();
  withWindowAndNavigator(win, undefined, () => {
    const input = new InputManager(new FakeCanvas() as unknown as HTMLCanvasElement, { gamepad: false });
    const event: Record<string, unknown> = { ...keyEvent("KeyW"), target: { closest: () => ({}) } };
    win.dispatch("keydown", event);
    equal(event.prevented, false);
    equal(input.snapshot().w, false);
    win.dispatch("keydown", { ...keyEvent("KeyW"), repeat: true });
    equal(input.snapshot().w, false);
    win.dispatch("keyup", keyEvent("KeyW"));
    win.dispatch("keydown", keyEvent("KeyW"));
    equal(input.snapshot().w, true);
    input.destroy();
  });
});

test("gamepad requires a fully neutral poll after context reset and never polls after destroy", () => {
  const win = new FakeEventTarget();
  let polls = 0;
  let pad: Gamepad | null = gamepadSnapshot([1, 0], [gamepadButton(true)]);
  withWindowAndNavigator(win, { getGamepads: () => { polls++; return [pad]; } }, () => {
    const input = new InputManager(new FakeCanvas() as unknown as HTMLCanvasElement);
    equal(input.snapshot().d, true);
    input.setEnabled(false);
    input.setEnabled(true);
    equal(input.snapshot().d, false);
    equal(input.snapshot().space, false);
    pad = gamepadSnapshot([0, 0], [gamepadButton(true)]);
    equal(input.snapshot().space, false); // One held control keeps the whole pad gated.
    pad = gamepadSnapshot([0, 0], [gamepadButton(false)]);
    equal(input.snapshot().space, false);
    pad = gamepadSnapshot([1, 0], [gamepadButton(true)]);
    equal(input.actionSnapshot().actions.primary, true);
    pad = null;
    equal(input.snapshot().d, false);
    pad = gamepadSnapshot([1, 0], [gamepadButton(true)]);
    equal(input.snapshot().d, false); // Reconnect also waits for neutral.
    input.destroy();
    const before = polls;
    equal(input.actionSnapshot().input.d, false);
    equal(polls, before);
    throws(() => input.setEnabled(true), /destroyed/);
  });
});

test("pointer cancellation and virtual source removal leave independent sources held", () => {
  const win = new FakeEventTarget();
  const canvas = new FakeCanvas();
  withWindowAndNavigator(win, undefined, () => {
    const input = new InputManager(canvas as unknown as HTMLCanvasElement, { gamepad: false });
    win.dispatch("keydown", keyEvent("KeyW"));
    input.setVirtualInput("finger:1", { controls: { w: true }, buttons: { primary: true } });
    input.setVirtualInput("finger:2", { controls: { w: true } });
    canvas.dispatch("pointerdown", preventableEvent({ pointerId: 1, pointerType: "touch", button: 0, clientX: 10, clientY: 20 }));
    canvas.dispatch("pointermove", preventableEvent({ pointerId: 1, clientX: 10, clientY: 0 }));
    canvas.dispatch("lostpointercapture", { pointerId: 1 });
    equal(input.snapshot().mouseLeft, false);
    equal(input.snapshot().w, true);
    input.setVirtualInput("finger:1");
    equal(input.actionSnapshot().actions.primary, false);
    equal(input.snapshot().w, true);
    win.dispatch("keyup", keyEvent("KeyW"));
    equal(input.snapshot().w, true);
    input.setVirtualInput("finger:2");
    equal(input.snapshot().w, false);
    input.destroy();
  });
});

test("attached virtual controls capture short edges and remain externally owned", () => {
  const win = new FakeEventTarget();
  withWindowAndNavigator(win, undefined, () => {
    const virtual = new VirtualControls({} as HTMLElement, { enabled: false });
    const input = new InputManager(new FakeCanvas() as unknown as HTMLCanvasElement, { virtualControls: virtual, gamepad: false });
    virtual.setButtonPressed("primary", true);
    virtual.setButtonPressed("primary", false);
    deepEqual(input.actionSnapshot().justPressedActions, ["primary"]);
    virtual.setJoystickVector(1, 0);
    equal(input.snapshot().d, true);
    input.clear();
    equal(virtual.state().d, false);
    deepEqual(input.actionSnapshot().releasedActions, []);
    input.destroy();
    virtual.setButtonPressed("primary", true);
    equal(input.snapshot().space, false);
    virtual.destroy();
  });
});

test("invalid bindings fail before any listeners are installed", () => {
  const win = new FakeEventTarget();
  withWindowAndNavigator(win, undefined, () => {
    throws(() => new InputManager(new FakeCanvas() as unknown as HTMLCanvasElement, {
      keyBindings: { w: ["not a code"] },
    }), /KeyboardEvent.code/);
    equal(win.listenerCount("keydown"), 0);
  });
});


test("virtual cancellation observers may clear input without reentering clear", () => {
  const win = new FakeEventTarget();
  withWindowAndNavigator(win, undefined, () => {
    const virtual = new VirtualControls({} as HTMLElement, { enabled: false });
    const input = new InputManager(new FakeCanvas() as unknown as HTMLCanvasElement, { virtualControls: virtual, gamepad: false });
    let callbacks = 0;
    const unsubscribe = virtual.subscribe(() => { callbacks++; input.clear(); });
    virtual.setButtonPressed("primary", true);
    equal(callbacks, 2); // press and cancellation, then already-neutral releaseAll is silent.
    equal(input.snapshot().space, false);
    deepEqual(input.actionSnapshot().justPressedActions, []);
    unsubscribe();
    input.destroy(); virtual.destroy();
  });
});


test("a fresh keydown works after keyup was lost outside the window", () => {
  const win = new FakeEventTarget();
  withWindowAndNavigator(win, undefined, () => {
    const input = new InputManager(new FakeCanvas() as unknown as HTMLCanvasElement, { gamepad: false });
    win.dispatch("keydown", keyEvent("KeyW"));
    win.dispatch("blur", {});
    win.dispatch("focus", {});
    win.dispatch("keydown", { ...keyEvent("KeyW"), repeat: true });
    equal(input.snapshot().w, false);
    // The OS delivered keyup to another window. The next non-repeat press is new input.
    win.dispatch("keydown", { ...keyEvent("KeyW"), repeat: false });
    equal(input.snapshot().w, true);
    input.destroy();
  });
});


test("multiple virtual buttons bound to one action combine without erasing held input", () => {
  const win = new FakeEventTarget();
  withWindowAndNavigator(win, undefined, () => {
    const virtual = new VirtualControls({} as HTMLElement, {
      enabled: false, buttons: [
        { id: "left", label: "A", virtualButton: "primary" },
        { id: "right", label: "B", virtualButton: "primary" },
      ],
    });
    const input = new InputManager(new FakeCanvas() as unknown as HTMLCanvasElement, { virtualControls: virtual, gamepad: false });
    virtual.setButtonPressed("left", true);
    equal(input.actionSnapshot().actions.primary, true);
    virtual.setButtonPressed("right", true);
    virtual.setButtonPressed("left", false);
    equal(input.actionSnapshot().actions.primary, true);
    virtual.setButtonPressed("right", false);
    equal(input.actionSnapshot().actions.primary, false);
    input.destroy(); virtual.destroy();
  });
});

test("destroy releases every listener even when a virtual cancellation observer throws", () => {
  const win = new FakeEventTarget();
  const doc = Object.assign(new FakeEventTarget(), { defaultView: win, hidden: false });
  const canvas = Object.assign(new FakeCanvas(), { ownerDocument: doc });
  withWindowAndNavigator(win, undefined, () => {
    const virtual = new VirtualControls({} as HTMLElement, { enabled: false });
    const input = new InputManager(canvas as unknown as HTMLCanvasElement, { virtualControls: virtual, gamepad: false });
    virtual.setButtonPressed("primary", true);
    const unsubscribe = virtual.subscribe(() => { throw new Error("cancellation observer failed"); });
    throws(() => input.destroy(), /cancellation observer failed/);
    for (const type of ["keydown", "keyup", "blur", "focus", "mouseup", "pointerup", "pointercancel", "touchend", "touchcancel"]) {
      equal(win.listenerCount(type), 0, `${type} must be removed after failed observer`);
    }
    equal(doc.listenerCount("visibilitychange"), 0);
    equal(canvas.listenerCount("pointerdown"), 0);
    equal(input.enabled, false);
    equal(input.snapshot().space, false);
    input.destroy();
    unsubscribe();
    virtual.destroy();
  });
});

test("destroy prevents a cancellation observer from resurrecting virtual input", () => {
  const win = new FakeEventTarget();
  withWindowAndNavigator(win, undefined, () => {
    const virtual = new VirtualControls({} as HTMLElement, { enabled: false });
    const input = new InputManager(new FakeCanvas() as unknown as HTMLCanvasElement, { virtualControls: virtual, gamepad: false });
    virtual.setButtonPressed("primary", true);
    virtual.subscribe(() => {
      throws(() => input.setVirtualInput("late", { controls: { w: true } }), /destroyed/);
      equal(input.snapshot().w, false);
    });
    input.destroy();
    virtual.destroy();
  });
});

test("mouse button chords release the primary source while another button is held", () => {
  const win = new FakeEventTarget();
  const canvas = new FakeCanvas();
  withWindowAndNavigator(win, undefined, () => {
    const input = new InputManager(canvas as unknown as HTMLCanvasElement, { gamepad: false });
    input.setVirtualInput("touch", { controls: { w: true } });
    canvas.dispatch("pointerdown", preventableEvent({ pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: 12, clientY: 22 }));
    equal(input.snapshot().mouseLeft, true);
    // A chord change uses pointermove until the final mouse button is released.
    canvas.dispatch("pointermove", preventableEvent({ pointerId: 1, pointerType: "mouse", button: 0, buttons: 2, clientX: 12, clientY: 22 }));
    equal(input.snapshot().mouseLeft, false);
    equal(input.snapshot().w, true);
    input.destroy();
  });
});

test("editable input inside an open shadow root keeps its keyboard events", () => {
  const win = new FakeEventTarget();
  withWindowAndNavigator(win, undefined, () => {
    const input = new InputManager(new FakeCanvas() as unknown as HTMLCanvasElement, { gamepad: false });
    const host = { closest: () => null };
    const field = { closest: () => ({}) };
    const event = preventableEvent({ code: "KeyW", target: host, composedPath: () => [field, host] });
    win.dispatch("keydown", event);
    equal(event.prevented, false);
    equal(input.snapshot().w, false);
    input.destroy();
  });
});

test("touch position tracks dragging even when movement gestures are disabled", () => {
  const win = new FakeEventTarget();
  const canvas = new FakeCanvas();
  withWindowAndNavigator(win, undefined, () => {
    const input = new InputManager(canvas as unknown as HTMLCanvasElement, { pointerGestures: false, gamepad: false });
    canvas.dispatch("touchstart", preventableEvent({ changedTouches: touchList({ identifier: 1, clientX: 20, clientY: 30 }) }));
    canvas.dispatch("touchmove", preventableEvent({ changedTouches: touchList({ identifier: 1, clientX: 90, clientY: 100 }) }));
    const state = input.snapshot();
    equal(state.mouseX, 80); equal(state.mouseY, 80);
    equal(state.w || state.a || state.s || state.d, false);
    equal(state.mouseLeft, true);
    input.destroy();
  });
});

test("JSON null action profiles and sparse key arrays fail before attaching listeners", () => {
  const win = new FakeEventTarget();
  withWindowAndNavigator(win, undefined, () => {
    throws(() => new InputManager(new FakeCanvas() as unknown as HTMLCanvasElement, JSON.parse('{"actionProfile":null}')), /input.profile.actions/);
    throws(() => new InputManager(new FakeCanvas() as unknown as HTMLCanvasElement, { keyBindings: { w: new Array<string>(1) } }), /input.keyBindings.w.0/);
    equal(win.listenerCount("keydown"), 0);
  });
});

test("canvas input polls its owning window gamepad and starts neutral while unfocused", () => {
  const win = new FakeEventTarget();
  let polls = 0;
  let axis = 1;
  const ownerWindow = Object.assign(new FakeEventTarget(), {
    navigator: { getGamepads: () => { polls++; return [gamepadSnapshot([axis, 0], [])]; } },
  });
  const doc = Object.assign(new FakeEventTarget(), { defaultView: ownerWindow, hidden: false, hasFocus: () => false });
  const canvas = Object.assign(new FakeCanvas(), { ownerDocument: doc });
  withWindowAndNavigator(win, { getGamepads: () => { throw new Error("wrong window"); } }, () => {
    const input = new InputManager(canvas as unknown as HTMLCanvasElement);
    equal(input.snapshot().d, false);
    equal(polls, 0);
    ownerWindow.dispatch("focus", {});
    equal(input.snapshot().d, false); // Held pad remains gated until neutral.
    axis = 0; input.snapshot();
    axis = 1;
    equal(input.snapshot().d, true);
    equal(win.listenerCount("keydown"), 0);
    input.destroy();
    equal(ownerWindow.listenerCount("keydown"), 0);
  });
});


test("mouse chord handling preserves pen eraser drag gestures", () => {
  const win = new FakeEventTarget();
  const canvas = new FakeCanvas();
  withWindowAndNavigator(win, undefined, () => {
    const input = new InputManager(canvas as unknown as HTMLCanvasElement, { gamepad: false });
    canvas.dispatch("pointerdown", preventableEvent({ pointerId: 9, pointerType: "pen", button: 5, buttons: 32, clientX: 30, clientY: 40 }));
    canvas.dispatch("pointermove", preventableEvent({ pointerId: 9, pointerType: "pen", button: -1, buttons: 32, clientX: 70, clientY: 40 }));
    equal(input.snapshot().d, true);
    equal(input.snapshot().mouseLeft, true);
    win.dispatch("pointerup", { pointerId: 9 });
    equal(input.snapshot().mouseLeft, false);
    input.destroy();
  });
});
