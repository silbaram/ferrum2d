import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  buildDebugGizmoLineBuffer,
  buildDebugGizmoLines,
  debugGizmoLinesToBuffer,
} from "../src/debugGizmos.js";
import { diagnosticReport } from "../src/diagnostics.js";

test("buildDebugGizmoLines creates path, spawn, prefab, and collider line primitives", () => {
  const lines = buildDebugGizmoLines({
    paths: [{ id: "patrol", points: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }] }],
    spawns: [{ id: "player", x: 8, y: 8, radius: 4 }],
    prefabs: [{ id: "crate", x: 32, y: 16, width: 8, height: 8 }],
    colliders: [{ id: "trigger", x: 48, y: 24, width: 16, height: 8 }],
  });

  equal(lines.length, 12);
  deepEqual(lines.map((line) => line.category), [
    "path",
    "path",
    "spawn",
    "spawn",
    "prefab",
    "prefab",
    "prefab",
    "prefab",
    "collider",
    "collider",
    "collider",
    "collider",
  ]);
  equal(lines[2]?.x0, 4);
  equal(lines[4]?.sourceId, "crate");
});

test("buildDebugGizmoLineBuffer supports category filtering and packed debug line buffers", () => {
  const result = buildDebugGizmoLineBuffer({
    paths: [{ id: "closed", closed: true, points: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }] }],
    colliders: [{ id: "solid", x: 0, y: 0, width: 8, height: 8 }],
  }, {
    categories: { collider: false },
    colors: { path: [1, 1, 0, 0.5] },
  });

  equal(result.lines.length, 3);
  equal(result.bufferView.lineCount, 3);
  equal(result.bufferView.floatsPerLine, 8);
  equal(result.bufferView.buffer[4], 1);
  equal(result.bufferView.buffer[7], 0.5);
});

test("debugGizmoLinesToBuffer accepts decoded physics debug line views", () => {
  const buffer = debugGizmoLinesToBuffer([
    { x0: 1, y0: 2, x1: 3, y1: 4, color: [0.1, 0.2, 0.3, 0.4] },
  ]);

  equal(buffer.lineCount, 1);
  equal(buffer.buffer[0], 1);
  ok(Math.abs(buffer.buffer[7] - 0.4) < 1e-6);
});

test("buildDebugGizmoLines reports diagnostic path context", () => {
  try {
    buildDebugGizmoLines({
      paths: [{ id: "broken", points: [{ x: 0, y: 0 }] }],
    });
  } catch (error) {
    const report = diagnosticReport(error);
    equal(report.code, "FERRUM_DEBUG_GIZMO_INVALID");
    equal(report.context?.path, "debugGizmos.paths.0.points");
    return;
  }
  throw new Error("Expected invalid debug gizmo path to throw.");
});
