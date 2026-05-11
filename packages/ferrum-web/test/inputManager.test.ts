import { equal } from "node:assert/strict";
import { test } from "node:test";
import { InputManager } from "../src/inputManager.js";

type Listener = (event: Record<string, unknown>) => void;

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
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

test("InputManager snapshot reflects keyboard and mouse state", () => {
  const previousWindow = (globalThis as unknown as { window?: unknown }).window;
  const fakeWindow = new FakeEventTarget();
  const canvas = new FakeCanvas();
  (globalThis as unknown as { window: unknown }).window = fakeWindow;

  try {
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
  } finally {
    (globalThis as unknown as { window?: unknown }).window = previousWindow;
  }
});
