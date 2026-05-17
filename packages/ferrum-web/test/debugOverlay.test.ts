import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  DEBUG_OVERLAY_ROW_CONTRACT,
  DebugOverlay,
  formatDebugOverlayMetrics,
} from "../src/debugOverlay.js";
import type { DebugOverlayMetrics } from "../src/debugOverlay.js";

class FakeElement {
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  textContent = "";
  private parent?: FakeElement;

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parent) {
      return;
    }

    const index = this.parent.children.indexOf(this);
    if (index >= 0) {
      this.parent.children.splice(index, 1);
    }
    this.parent = undefined;
  }
}

function metrics(overrides: Partial<DebugOverlayMetrics> = {}): DebugOverlayMetrics {
  return {
    fps: 60,
    frameTimeMs: 16.67,
    entityCount: 3,
    spriteCount: 3,
    drawCalls: 1,
    batchCount: 1,
    rustUpdateTimeMs: 0.5,
    renderTimeMs: 0.4,
    mouseX: 10,
    mouseY: 20,
    cameraX: 0,
    cameraY: 0,
    gameState: "Playing",
    score: 10,
    ...overrides,
  };
}

test("DebugOverlay metric contract fixes row order, labels, and units", () => {
  deepEqual(DEBUG_OVERLAY_ROW_CONTRACT.map(({ id, label, unit, optional }) => ({
    id,
    label,
    unit,
    optional: optional ?? false,
  })), [
    { id: "fps", label: "fps", unit: "fps", optional: false },
    { id: "frameTimeMs", label: "frame time", unit: "ms", optional: false },
    { id: "rustUpdateTimeMs", label: "rust update", unit: "ms", optional: false },
    { id: "renderTimeMs", label: "render", unit: "ms", optional: false },
    { id: "entityCount", label: "entities", unit: "count", optional: false },
    { id: "spriteCount", label: "sprites", unit: "count", optional: false },
    { id: "drawCalls", label: "draw calls", unit: "count", optional: false },
    { id: "batchCount", label: "batches", unit: "count", optional: false },
    { id: "renderCommandCount", label: "render commands", unit: "count", optional: true },
    { id: "textureBindCount", label: "texture binds", unit: "count", optional: true },
    { id: "textureSwitchCount", label: "texture switches", unit: "count", optional: true },
    { id: "audioEventsPerSecond", label: "audio events", unit: "events/s", optional: true },
    { id: "mousePosition", label: "mouse", unit: "px", optional: false },
    { id: "cameraPosition", label: "camera", unit: "world", optional: false },
    { id: "gameState", label: "state", unit: "state", optional: false },
    { id: "score", label: "score", unit: "score", optional: false },
  ]);
});

test("formatDebugOverlayMetrics applies fixed labels, units, and precision", () => {
  deepEqual(formatDebugOverlayMetrics(metrics({
    renderCommandCount: 3,
    textureBindCount: 2,
    textureSwitchCount: 1,
    audioEventsPerSecond: 4.25,
  })), [
    "fps: 60.0 fps",
    "frame time: 16.67 ms",
    "rust update: 0.50 ms",
    "render: 0.40 ms",
    "entities: 3",
    "sprites: 3",
    "draw calls: 1",
    "batches: 1",
    "render commands: 3",
    "texture binds: 2",
    "texture switches: 1",
    "audio events: 4.3 events/s",
    "mouse: 10.0, 20.0 px",
    "camera: 0.0, 0.0 world",
    "state: Playing",
    "score: 10",
  ]);
});

test("DebugOverlay destroy is idempotent and prevents later DOM updates", () => {
  const previousDocument = (globalThis as unknown as { document?: unknown }).document;
  const body = new FakeElement();
  const fakeDocument = {
    body,
    createElement: () => new FakeElement(),
  };
  (globalThis as unknown as { document: unknown }).document = fakeDocument;

  try {
    const overlay = new DebugOverlay();
    equal(body.children.length, 1);

    overlay.update(metrics());
    equal(body.children[0].textContent, formatDebugOverlayMetrics(metrics()).join("\n"));
    overlay.destroy();
    overlay.destroy();
    overlay.update(metrics());

    equal(body.children.length, 0);
  } finally {
    (globalThis as unknown as { document?: unknown }).document = previousDocument;
  }
});
