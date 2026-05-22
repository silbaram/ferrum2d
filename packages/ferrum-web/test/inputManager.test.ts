import { equal } from "node:assert/strict";
import { test } from "node:test";
import { InputManager } from "../src/inputManager.js";

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

    fakeWindow.dispatch("keyup", keyEvent("KeyW"));
    fakeWindow.dispatch("keyup", keyEvent("Enter"));
    fakeWindow.dispatch("mouseup", { button: 0 });
    snapshot = input.snapshot();

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
