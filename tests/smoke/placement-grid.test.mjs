import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(
    new URL("../../apps/placement-viewer/package.json", import.meta.url),
  ),
  ts = require("typescript");
const code = ts.transpileModule(
  await readFile(
    new URL(
      "../../apps/placement-viewer/src/placementGridGeometry.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { flatGrid, spatialGrid, gridElevation, GRID_LINE_BUDGET } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const minor = [0.1, 0.2, 0.3, 0.5],
  major = [0.5, 0.6, 0.7, 0.7],
  v = {
    cssWidth: 1058,
    cssHeight: 724,
    cameraX: 37.25,
    cameraY: -18.5,
    zoom: 1,
  };
const matrix = () => {
  const m = new Float32Array(28);
  m[0] = 0.01;
  m[5] = 0.01;
  m[9] = -0.01;
  m[15] = 1;
  return m;
};
test("2D grid stays on world multiples after camera pan and zoom", () => {
  for (const zoom of [0.125, 0.8, 1, 2, 8]) {
    const g = flatGrid({ ...v, zoom }, 16, minor, major);
    assert(g.lineCount > 0 && g.lineCount <= GRID_LINE_BUDGET);
    assert.equal(g.buffer.length, g.lineCount * 8);
    assert.equal(g.step % 16, 0);
    for (let i = 0; i < g.buffer.length; i += 8) {
      const [x0, y0, x1, y1] = g.buffer.slice(i, i + 4);
      assert(x0 === x1 || y0 === y1);
      assert.equal(Math.abs((x0 === x1 ? x0 : y0) % g.step), 0);
    }
  }
});
test("small zoom uses coarser display spacing without changing snap size", () => {
  const input = { ...v, cssWidth: 100000, cssHeight: 100000, zoom: 0.0001 };
  const copy = structuredClone(input);
  const g = flatGrid(input, 16, minor, major);
  assert(g.step > 16);
  assert(g.lineCount <= 512);
  assert.deepEqual(input, copy);
});
test("2D zero dimensions produce no geometry and origin axes are emphasized", () => {
  assert.equal(flatGrid({ ...v, cssWidth: 0 }, 16, minor, major).lineCount, 0);
  const g = flatGrid({ ...v, cameraX: 0, cameraY: 0 }, 16, minor, major);
  const axes = [];
  for (let i = 0; i < g.buffer.length; i += 8)
    if (
      (g.buffer[i] === 0 && g.buffer[i + 2] === 0) ||
      (g.buffer[i + 1] === 0 && g.buffer[i + 3] === 0)
    )
      axes.push(g.buffer[i + 7]);
  assert.deepEqual(axes, [1, 1]);
});
for (const rampAxis of ["x", "y"])
  test(
    "spatial " + rampAxis + " ramp lines match authored surface heights",
    () => {
      const s = {
        x: -40,
        y: -20,
        width: 80,
        depth: 80,
        elevation: 10,
        endElevation: 50,
        rampAxis,
      };
      const before = JSON.stringify(s);
      const g = spatialGrid([s], matrix(), 800, 600, 16, minor, major);
      assert(g.lineCount > 0);
      assert.equal(g.vertices.length, g.lineCount * 22);
      for (let i = 0; i < g.vertices.length; i += 11) {
        const x = g.vertices[i],
          y = -g.vertices[i + 2],
          z = g.vertices[i + 1];
        assert(Math.abs(z - gridElevation(s, x, y) - 0.025) < 0.00001);
        assert(
          x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.depth,
        );
      }
      assert.equal(JSON.stringify(s), before);
    },
  );
test("spatial grid clips to surfaces and keeps global origin across uneven patch bounds", () => {
  const s = { x: 5, y: 7, width: 70, depth: 60, elevation: 0 };
  const g = spatialGrid([s], matrix(), 800, 600, 16, minor, major);
  for (let i = 0; i < g.vertices.length; i += 22) {
    const [x, , ny] = g.vertices.slice(i, i + 3),
      x1 = g.vertices[i + 11],
      y1 = -g.vertices[i + 13];
    assert.equal((x === x1 ? x : -ny) % g.step, 0);
    assert(x >= 5 && x1 <= 75 && -ny >= 7 && y1 <= 67);
  }
});
test("offscreen and behind-camera surfaces produce no lines", () => {
  const s = { x: 10000, y: 10000, width: 100, depth: 100, elevation: 0 };
  assert.equal(
    spatialGrid([s], matrix(), 800, 600, 16, minor, major).lineCount,
    0,
  );
  const m = matrix();
  m[15] = -1;
  assert.equal(
    spatialGrid([{ ...s, x: 0, y: 0 }], m, 800, 600, 16, minor, major)
      .lineCount,
    0,
  );
});
test("large surface sets stay bounded and do not mutate frame projection", () => {
  const surfaces = Array.from({ length: 256 }, () => ({
      x: -100000,
      y: -100000,
      width: 200000,
      depth: 200000,
      elevation: 0,
    })),
    m = matrix(),
    before = m.slice();
  const g = spatialGrid(surfaces, m, 800, 600, 1, minor, major);
  assert(g.lineCount <= 512);
  assert.equal(
    g.vertices.some((v) => !Number.isFinite(v)),
    false,
  );
  assert.deepEqual(m, before);
});
