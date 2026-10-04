import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";

/** A scene-owned XY grid, independent of rendering and physics colliders. */
export interface DataSceneNavigationSpec {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  originX?: number;
  originY?: number;
  /** Row-major costs: 0 blocks a cell; 1..65535 are walkable. Maximum 4096 cells. */
  costs: readonly number[];
}

export function resolveDataSceneNavigationSpec(value: unknown, path = "dataScene.navigation"): DataSceneNavigationSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw gameplayAuthoringDiagnosticError(path, "must be an object");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!["columns", "rows", "cellWidth", "cellHeight", "originX", "originY", "costs"].includes(key)) throw gameplayAuthoringDiagnosticError(`${path}.${key}`, "is not supported");
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
  return { columns, rows, cellWidth, cellHeight, originX, originY, costs };
}
