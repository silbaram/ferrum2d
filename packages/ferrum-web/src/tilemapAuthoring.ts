import { gameSpecDiagnosticError } from "./diagnostics.js";

export interface TileRuleGrid {
  columns: number;
  rows: number;
  data: readonly number[];
}

export type TileRuleCellMatch = number | readonly number[] | "any" | "empty" | "filled";
export type TileRuleNeighborMatch = TileRuleCellMatch | "same";
export type TileRuleNeighborDirection = "n" | "e" | "s" | "w" | "ne" | "se" | "sw" | "nw";

export interface TileRuleSpec {
  output: number;
  match?: TileRuleCellMatch;
  neighbors?: Partial<Record<TileRuleNeighborDirection, TileRuleNeighborMatch>>;
}

export interface ApplyTileRulesOptions {
  preserveUnmatched?: boolean;
  emptyOutOfBounds?: boolean;
  path?: string;
}

export interface AnimatedTileFrameSpec {
  tile: number;
  durationMs?: number;
}

export interface AnimatedTileSpec {
  frames: readonly (number | AnimatedTileFrameSpec)[];
  fps?: number;
  loop?: boolean;
}

export interface AnimatedTileLayerOptions {
  timeSeconds?: number;
  path?: string;
}

const TILE_RULE_DIRECTIONS: Record<TileRuleNeighborDirection, { dx: number; dy: number }> = {
  n: { dx: 0, dy: -1 },
  e: { dx: 1, dy: 0 },
  s: { dx: 0, dy: 1 },
  w: { dx: -1, dy: 0 },
  ne: { dx: 1, dy: -1 },
  se: { dx: 1, dy: 1 },
  sw: { dx: -1, dy: 1 },
  nw: { dx: -1, dy: -1 },
};

export function applyTileRules(
  grid: TileRuleGrid,
  rules: readonly TileRuleSpec[],
  options: ApplyTileRulesOptions = {},
): number[] {
  const path = options.path ?? "tileRules";
  const columns = positiveInteger(grid.columns, `${path}.grid.columns`);
  const rows = positiveInteger(grid.rows, `${path}.grid.rows`);
  const source = tileRuleGridData(grid.data, {
    path: `${path}.grid.data`,
    expectedLength: columns * rows,
  });
  const compiledRules = compileTileRules(rules, `${path}.rules`);
  const preserveUnmatched = options.preserveUnmatched !== false;
  const emptyOutOfBounds = options.emptyOutOfBounds !== false;

  return source.map((tile, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const matched = compiledRules.find((rule) => tileRuleMatches(rule, {
      tile,
      column,
      row,
      source,
      columns,
      rows,
      emptyOutOfBounds,
    }));
    if (matched) {
      return matched.output;
    }
    return preserveUnmatched ? tile : 0;
  });
}

export function resolveAnimatedTileFrame(
  animation: AnimatedTileSpec,
  options: AnimatedTileLayerOptions = {},
): number {
  const path = options.path ?? "animatedTiles";
  return resolveAnimatedTileFrameInternal(animation, {
    path,
    timeSeconds: animationTimeSeconds(options.timeSeconds, `${path}.timeSeconds`),
  });
}

export function bakeAnimatedTileLayer(
  grid: TileRuleGrid,
  animations: Readonly<Record<number, AnimatedTileSpec>>,
  options: AnimatedTileLayerOptions = {},
): number[] {
  const path = options.path ?? "animatedTiles";
  const columns = positiveInteger(grid.columns, `${path}.grid.columns`);
  const rows = positiveInteger(grid.rows, `${path}.grid.rows`);
  const source = tileRuleGridData(grid.data, {
    path: `${path}.grid.data`,
    expectedLength: columns * rows,
  });
  const compiledAnimations = compileAnimatedTiles(animations, `${path}.animations`);
  const timeSeconds = animationTimeSeconds(options.timeSeconds, `${path}.timeSeconds`);
  return source.map((tile) => {
    const animation = compiledAnimations.get(tile);
    return animation === undefined
      ? tile
      : resolveAnimatedTileFrameInternal(animation, { path: `${path}.animations.${tile}`, timeSeconds });
  });
}

interface CompiledTileRule {
  output: number;
  match: TileRuleCellMatch;
  neighbors: Array<{ direction: TileRuleNeighborDirection; match: TileRuleNeighborMatch }>;
}

interface CompiledAnimatedTileFrame {
  tile: number;
  durationMs: number;
}

interface CompiledAnimatedTileSpec {
  frames: readonly CompiledAnimatedTileFrame[];
  loop: boolean;
  totalDurationMs: number;
}

interface TileRuleMatchContext {
  tile: number;
  column: number;
  row: number;
  source: readonly number[];
  columns: number;
  rows: number;
  emptyOutOfBounds: boolean;
}

function compileTileRules(rules: readonly TileRuleSpec[], path: string): CompiledTileRule[] {
  if (!Array.isArray(rules)) {
    throw gameSpecDiagnosticError(path, "must be an array");
  }
  return rules.map((rule, index) => {
    const rulePath = `${path}.${index}`;
    const neighbors = rule.neighbors ?? {};
    return {
      output: nonNegativeInteger(rule.output, `${rulePath}.output`),
      match: tileRuleCellMatch(rule.match ?? "filled", `${rulePath}.match`),
      neighbors: Object.entries(neighbors).map(([direction, match]) => {
        const parsedDirection = tileRuleNeighborDirection(direction, `${rulePath}.neighbors.${direction}`);
        return {
          direction: parsedDirection,
          match: tileRuleNeighborMatch(match, `${rulePath}.neighbors.${direction}`),
        };
      }),
    };
  });
}

function tileRuleMatches(rule: CompiledTileRule, context: TileRuleMatchContext): boolean {
  if (!tileRuleCellMatches(rule.match, context.tile, context.tile)) {
    return false;
  }

  return rule.neighbors.every((neighbor) => {
    const offset = TILE_RULE_DIRECTIONS[neighbor.direction];
    const column = context.column + offset.dx;
    const row = context.row + offset.dy;
    const tile = tileAt({
      column,
      row,
      source: context.source,
      columns: context.columns,
      rows: context.rows,
      emptyOutOfBounds: context.emptyOutOfBounds,
    });
    if (tile === undefined) {
      return false;
    }
    return tileRuleCellMatches(neighbor.match, tile, context.tile);
  });
}

function tileAt(options: {
  column: number;
  row: number;
  source: readonly number[];
  columns: number;
  rows: number;
  emptyOutOfBounds: boolean;
}): number | undefined {
  if (options.column < 0 || options.column >= options.columns || options.row < 0 || options.row >= options.rows) {
    return options.emptyOutOfBounds ? 0 : undefined;
  }
  return options.source[options.row * options.columns + options.column] ?? 0;
}

function tileRuleCellMatches(match: TileRuleNeighborMatch, tile: number, currentTile: number): boolean {
  if (match === "any") {
    return true;
  }
  if (match === "empty") {
    return tile === 0;
  }
  if (match === "filled") {
    return tile !== 0;
  }
  if (match === "same") {
    return tile === currentTile;
  }
  if (Array.isArray(match)) {
    return match.includes(tile);
  }
  return tile === match;
}

function tileRuleGridData(
  value: readonly number[],
  options: { path: string; expectedLength: number },
): number[] {
  if (!Array.isArray(value)) {
    throw gameSpecDiagnosticError(options.path, "must be an array");
  }
  if (value.length !== options.expectedLength) {
    throw gameSpecDiagnosticError(options.path, `must contain exactly ${options.expectedLength} tile ids`);
  }
  return value.map((tile, index) => nonNegativeInteger(tile, `${options.path}.${index}`));
}

function tileRuleCellMatch(value: unknown, path: string): TileRuleCellMatch {
  if (value === "any" || value === "empty" || value === "filled") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => nonNegativeInteger(entry, `${path}.${index}`));
  }
  return nonNegativeInteger(value, path);
}

function tileRuleNeighborMatch(value: unknown, path: string): TileRuleNeighborMatch {
  if (value === "same") {
    return value;
  }
  return tileRuleCellMatch(value, path);
}

function tileRuleNeighborDirection(value: string, path: string): TileRuleNeighborDirection {
  if (Object.prototype.hasOwnProperty.call(TILE_RULE_DIRECTIONS, value)) {
    return value as TileRuleNeighborDirection;
  }
  throw gameSpecDiagnosticError(path, "must be one of n, e, s, w, ne, se, sw, or nw");
}

function compileAnimatedTiles(
  animations: Readonly<Record<number, AnimatedTileSpec>>,
  path: string,
): Map<number, CompiledAnimatedTileSpec> {
  if (typeof animations !== "object" || animations === null || Array.isArray(animations)) {
    throw gameSpecDiagnosticError(path, "must be an object");
  }
  const compiled = new Map<number, CompiledAnimatedTileSpec>();
  for (const [tileId, animation] of Object.entries(animations)) {
    const id = nonNegativeInteger(Number(tileId), `${path}.${tileId}`);
    compiled.set(id, compileAnimatedTile(animation, `${path}.${tileId}`));
  }
  return compiled;
}

function resolveAnimatedTileFrameInternal(
  animation: AnimatedTileSpec | CompiledAnimatedTileSpec,
  options: { path: string; timeSeconds: number },
): number {
  const compiled = "totalDurationMs" in animation
    ? animation
    : compileAnimatedTile(animation, options.path);
  const timeMs = options.timeSeconds * 1000;
  const elapsedMs = compiled.loop
    ? timeMs % compiled.totalDurationMs
    : Math.min(timeMs, compiled.totalDurationMs);
  let cursorMs = 0;
  for (const frame of compiled.frames) {
    cursorMs += frame.durationMs;
    if (elapsedMs < cursorMs) {
      return frame.tile;
    }
  }
  return compiled.frames[compiled.frames.length - 1]?.tile ?? 0;
}

function compileAnimatedTile(animation: AnimatedTileSpec, path: string): CompiledAnimatedTileSpec {
  if (typeof animation !== "object" || animation === null || Array.isArray(animation)) {
    throw gameSpecDiagnosticError(path, "must be an object");
  }
  if (!Array.isArray(animation.frames) || animation.frames.length === 0) {
    throw gameSpecDiagnosticError(`${path}.frames`, "must contain at least one frame");
  }
  const fallbackDurationMs = animation.fps === undefined
    ? 1000
    : 1000 / positiveNumber(animation.fps, `${path}.fps`);
  const frames = animation.frames.map((frame, index) => animatedTileFrame(frame, {
    path: `${path}.frames.${index}`,
    fallbackDurationMs,
  }));
  const totalDurationMs = frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  return {
    frames,
    loop: animation.loop !== false,
    totalDurationMs,
  };
}

function animatedTileFrame(
  value: number | AnimatedTileFrameSpec,
  options: { path: string; fallbackDurationMs: number },
): CompiledAnimatedTileFrame {
  if (typeof value === "number") {
    return {
      tile: nonNegativeInteger(value, options.path),
      durationMs: options.fallbackDurationMs,
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw gameSpecDiagnosticError(options.path, "must be a tile id or frame object");
  }
  return {
    tile: nonNegativeInteger(value.tile, `${options.path}.tile`),
    durationMs: value.durationMs === undefined
      ? options.fallbackDurationMs
      : positiveNumber(value.durationMs, `${options.path}.durationMs`),
  };
}

function animationTimeSeconds(value: number | undefined, path: string): number {
  if (value === undefined) {
    return 0;
  }
  if (Number.isFinite(value) && value >= 0) {
    return value;
  }
  throw gameSpecDiagnosticError(path, "must be a non-negative finite number");
}

function positiveInteger(value: unknown, path: string): number {
  if (Number.isInteger(value) && typeof value === "number" && value > 0) {
    return value;
  }
  throw gameSpecDiagnosticError(path, "must be a positive integer");
}

function positiveNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  throw gameSpecDiagnosticError(path, "must be a positive number");
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (Number.isInteger(value) && typeof value === "number" && value >= 0) {
    return value;
  }
  throw gameSpecDiagnosticError(path, "must be a non-negative integer");
}
