import { deepEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { resolveDataSceneNavigationSpec } from "../src/dataSceneNavigation.js";

const grid = { columns: 2, rows: 1, cellWidth: 20, cellHeight: 20, costs: [1, 9] };
test("navigation collider coverage is explicit, exclusive and bounded", () => {
  deepEqual(resolveDataSceneNavigationSpec({ ...grid, obstacles: [{ instanceId: "gate", collider: true }] }).obstacles, [{ instanceId: "gate", collider: true }]);
  for (const entry of [{ instanceId: "gate" }, { instanceId: "gate", collider: false }, { instanceId: "gate", collider: true, cells: [{ column: 1, row: 0 }] }]) {
    throws(() => resolveDataSceneNavigationSpec({ ...grid, obstacles: [entry] }));
  }
  throws(() => resolveDataSceneNavigationSpec({ ...grid, obstacles: Array.from({ length: 65 }, (_, index) => ({ instanceId: `gate-${index}`, collider: true })) }), /64/);
});
test("navigation obstacle declarations validate IDs, cells and bounded overlap", () => {
  const obstacles = [{ instanceId: "gate", cells: [{ column: 1, row: 0 }] }, { instanceId: "second", cells: [{ column: 1, row: 0 }] }];
  deepEqual(resolveDataSceneNavigationSpec({ ...grid, obstacles }).obstacles, obstacles);
  for (const invalid of [null, {}, [{ instanceId: "", cells: [] }], [obstacles[0], obstacles[0]],
    [{ instanceId: "gate", cells: [] }], [{ instanceId: "gate", cells: [{ column: 2, row: 0 }] }],
    [{ instanceId: "gate", cells: [{ column: .5, row: 0 }] }],
    [{ instanceId: "gate", cells: [{ column: 1, row: 0 }, { column: 1, row: 0 }] }],
    [{ instanceId: "gate", cells: [{ column: 1, row: 0, typo: true }] }],
    [{ instanceId: "gate", cells: [{ column: 1, row: 0 }], typo: true }]]) {
    throws(() => resolveDataSceneNavigationSpec({ ...grid, obstacles: invalid }));
  }
});

test("navigation rejects sparse obstacle and cell arrays including mixed valid entries", () => {
  const cell = { column: 1, row: 0 };
  const obstacle = { instanceId: "gate", cells: [cell] };
  for (const obstacles of [new Array<unknown>(1), [, obstacle], [obstacle, ,]]) {
    throws(() => resolveDataSceneNavigationSpec({ ...grid, obstacles }), /obstacles\.\d.*must be an object/);
  }
  for (const cells of [new Array<unknown>(1), [, cell], [cell, ,]]) {
    throws(() => resolveDataSceneNavigationSpec({ ...grid, obstacles: [{ instanceId: "gate", cells }] }), /cells\.\d.*must be an object/);
  }
});
