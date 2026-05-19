import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { GameLoop } from "../src/gameLoop.js";

type RafCallback = (timestamp: number) => void;

function installAnimationFrameMock(): {
  fire(timestamp: number): void;
  pendingCount(): number;
  restore(): void;
} {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const callbacks = new Map<number, RafCallback>();
  let nextId = 1;

  (globalThis as unknown as {
    requestAnimationFrame: (callback: RafCallback) => number;
    cancelAnimationFrame: (id: number) => void;
  }).requestAnimationFrame = (callback) => {
    const id = nextId;
    nextId += 1;
    callbacks.set(id, callback);
    return id;
  };
  (globalThis as unknown as { cancelAnimationFrame: (id: number) => void }).cancelAnimationFrame = (id) => {
    callbacks.delete(id);
  };

  return {
    fire(timestamp) {
      const scheduled = [...callbacks.values()];
      callbacks.clear();
      for (const callback of scheduled) {
        callback(timestamp);
      }
    },
    pendingCount() {
      return callbacks.size;
    },
    restore() {
      (globalThis as unknown as { requestAnimationFrame: typeof previousRequest }).requestAnimationFrame = previousRequest;
      (globalThis as unknown as { cancelAnimationFrame: typeof previousCancel }).cancelAnimationFrame = previousCancel;
    },
  };
}

test("GameLoop start schedules frames and stop cancels the pending frame", () => {
  const raf = installAnimationFrameMock();
  const deltas: number[] = [];
  const loop = new GameLoop((deltaSeconds) => deltas.push(deltaSeconds), 0.05);

  try {
    loop.start();
    ok(loop.isRunning());
    equal(raf.pendingCount(), 1);

    raf.fire(100);
    equal(deltas.length, 0);
    equal(raf.pendingCount(), 1);

    raf.fire(116);
    equal(deltas.length, 1);
    equal(deltas[0], 0.016);

    loop.stop();
    equal(loop.isRunning(), false);
    equal(raf.pendingCount(), 0);
  } finally {
    raf.restore();
  }
});

test("GameLoop clamps large frame deltas", () => {
  const raf = installAnimationFrameMock();
  const deltas: number[] = [];
  const loop = new GameLoop((deltaSeconds) => deltas.push(deltaSeconds), 0.05);

  try {
    loop.start();
    raf.fire(0);
    raf.fire(1000);

    equal(deltas[0], 0.05);
  } finally {
    loop.stop();
    raf.restore();
  }
});
