import {
  buildDebugGizmoLineBuffer,
  buildDebugGizmoLines,
} from "../../packages/ferrum-web/dist/debugGizmos.js";

const scene = {
  paths: [
    { id: "patrol", points: [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 32 }] },
  ],
  spawns: [
    { id: "player", x: 8, y: 8, radius: 4 },
  ],
  prefabs: [
    { id: "crate", x: 48, y: 16, width: 16, height: 16 },
  ],
  colliders: [
    { id: "trigger", x: 80, y: 16, width: 32, height: 16 },
  ],
};

const lines = buildDebugGizmoLines(scene);
const filtered = buildDebugGizmoLineBuffer(scene, { categories: { collider: false } });

if (lines.length !== 12) {
  throw new Error(`unexpected debug gizmo line count: ${lines.length}`);
}
if (filtered.lines.some((line) => line.category === "collider")) {
  throw new Error("debug gizmo category filter must exclude collider lines.");
}
if (filtered.bufferView.lineCount !== filtered.lines.length || filtered.bufferView.floatsPerLine !== 8) {
  throw new Error("debug gizmo buffer view must match physics debug line ABI.");
}

console.log(JSON.stringify({
  debugGizmosSmoke: {
    lines: lines.length,
    filteredLines: filtered.lines.length,
    categories: [...new Set(lines.map((line) => line.category))],
  },
}, null, 2));
