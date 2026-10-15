import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";

/** A scene-owned XY terrain grid with optional explicit collider obstacles. */
export interface DataSceneNavigationSpec {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  originX?: number;
  originY?: number;
  /** Row-major costs: 0 blocks a cell; 1..65535 are walkable. Maximum 4096 cells. */
  costs: readonly number[];
  /** Fixed cells or live conservative collider bounds; choose exactly one source. */
  obstacles?: readonly {
    instanceId: string;
    cells?: readonly { column: number; row: number }[];
    /** Derive cells from live collider bounds, including position/size changes. Maximum 64 automatic obstacles. */
    collider?: true;
  }[];
}

export function resolveDataSceneNavigationSpec(value: unknown, path = "dataScene.navigation"): DataSceneNavigationSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw gameplayAuthoringDiagnosticError(path, "must be an object");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!["columns", "rows", "cellWidth", "cellHeight", "originX", "originY", "costs", "obstacles"].includes(key)) throw gameplayAuthoringDiagnosticError(`${path}.${key}`, "is not supported");
  }
  const dimension = (key: string): number => {
    const v = input[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0 || v > 4096) throw gameplayAuthoringDiagnosticError(`${path}.${key}`, "must be an integer in 1..4096");
    return v;
  };
  const number = (key: string, fallback?: number): number => {
    const v = input[key] === undefined ? fallback : input[key];
    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isFinite(Math.fround(v))) throw gameplayAuthoringDiagnosticError(`${path}.${key}`, "must be a finite float32 number");
    return v;
  };
  const columns = dimension("columns"), rows = dimension("rows");
  const cellWidth = number("cellWidth"), cellHeight = number("cellHeight");
  const originX = number("originX", 0), originY = number("originY", 0);
  if (Math.fround(cellWidth) <= 0 || Math.fround(cellHeight) <= 0) throw gameplayAuthoringDiagnosticError(path, "cell dimensions must be positive float32 values");
  if (columns * rows > 4096) throw gameplayAuthoringDiagnosticError(path, "must contain at most 4096 cells");
  if (!Number.isFinite(Math.fround(Math.fround(originX) + Math.fround(columns * Math.fround(cellWidth)))) || !Number.isFinite(Math.fround(Math.fround(originY) + Math.fround(rows * Math.fround(cellHeight))))) throw gameplayAuthoringDiagnosticError(path, "grid bounds must fit float32");
  if (!Array.isArray(input.costs) || input.costs.length !== columns * rows) throw gameplayAuthoringDiagnosticError(`${path}.costs`, "must contain exactly columns * rows entries");
  const costs = Array.from(input.costs, (cost: unknown, index: number) => {
    if (typeof cost !== "number" || !Number.isInteger(cost) || cost < 0 || cost > 65535) throw gameplayAuthoringDiagnosticError(`${path}.costs.${index}`, "must be an integer in 0..65535");
    return cost;
  });
  let obstacles: DataSceneNavigationSpec["obstacles"];
  if (input.obstacles !== undefined) {
    if (!Array.isArray(input.obstacles)) throw gameplayAuthoringDiagnosticError(`${path}.obstacles`, "must be an array");
    const ids = new Set<string>();
    let total = 0;
    let automatic = 0;
    obstacles = Array.from(input.obstacles, (entry: unknown, index: number) => {
      const at = `${path}.obstacles.${index}`;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw gameplayAuthoringDiagnosticError(at, "must be an object");
      const obstacle = entry as Record<string, unknown>;
      if (Object.keys(obstacle).some(key => !["instanceId", "cells", "collider"].includes(key))
        || typeof obstacle.instanceId !== "string" || obstacle.instanceId.length === 0 || ids.has(obstacle.instanceId)) {
        throw gameplayAuthoringDiagnosticError(at, "must have a unique nonempty instanceId and a cell source");
      }
      ids.add(obstacle.instanceId);
      if (obstacle.collider !== undefined) {
        if (obstacle.collider !== true || obstacle.cells !== undefined) throw gameplayAuthoringDiagnosticError(at, "collider must be true and is mutually exclusive with cells");
        if (++automatic > 64) throw gameplayAuthoringDiagnosticError(`${path}.obstacles`, "must contain at most 64 automatic collider obstacles");
        total++;
        if (total > 4096) throw gameplayAuthoringDiagnosticError(`${path}.obstacles`, "must contain at most 4096 references");
        return { instanceId: obstacle.instanceId, collider: true as const };
      }
      if (!Array.isArray(obstacle.cells) || obstacle.cells.length === 0) throw gameplayAuthoringDiagnosticError(`${at}.cells`, "must be a nonempty array");
      total += obstacle.cells.length;
      if (total > 4096) throw gameplayAuthoringDiagnosticError(`${path}.obstacles`, "must contain at most 4096 cell references");
      const unique = new Set<number>();
      const cells = Array.from(obstacle.cells, (entry: unknown, index: number) => {
        const cellPath = `${at}.cells.${index}`;
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw gameplayAuthoringDiagnosticError(cellPath, "must be an object");
        const cell = entry as Record<string, unknown>;
        if (Object.keys(cell).some(key => !["column", "row"].includes(key))
          || typeof cell.column !== "number" || !Number.isInteger(cell.column) || cell.column < 0 || cell.column >= columns
          || typeof cell.row !== "number" || !Number.isInteger(cell.row) || cell.row < 0 || cell.row >= rows) {
          throw gameplayAuthoringDiagnosticError(cellPath, "must contain column/row within the grid");
        }
        const flat = cell.row * columns + cell.column;
        if (unique.has(flat)) throw gameplayAuthoringDiagnosticError(cellPath, "must not repeat a cell for the same obstacle");
        unique.add(flat);
        return { column: cell.column, row: cell.row };
      });
      return { instanceId: obstacle.instanceId, cells };
    });
  }
  return { columns, rows, cellWidth, cellHeight, originX, originY, costs, ...(obstacles === undefined ? {} : { obstacles }) };
}
