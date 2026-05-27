import { debugGizmoDiagnosticError } from "./diagnostics.js";
import {
  FLOATS_PER_PHYSICS_DEBUG_LINE,
  type PhysicsDebugLineBufferView,
  type PhysicsDebugLineView,
} from "./physicsDebugLineDecoder.js";

export type DebugGizmoCategory = "path" | "spawn" | "prefab" | "collider";
export type DebugGizmoColor = readonly [number, number, number] | readonly [number, number, number, number];
export type ResolvedDebugGizmoColor = [number, number, number, number];

export interface DebugGizmoPoint {
  x: number;
  y: number;
}

export interface DebugGizmoPathSpec {
  id: string;
  points: readonly DebugGizmoPoint[];
  closed?: boolean;
  color?: DebugGizmoColor;
}

export interface DebugGizmoSpawnSpec extends DebugGizmoPoint {
  id: string;
  radius?: number;
  color?: DebugGizmoColor;
}

export interface DebugGizmoBoundsSpec {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: DebugGizmoColor;
}

export interface DebugGizmoSceneSpec {
  paths?: readonly DebugGizmoPathSpec[];
  spawns?: readonly DebugGizmoSpawnSpec[];
  prefabs?: readonly DebugGizmoBoundsSpec[];
  colliders?: readonly DebugGizmoBoundsSpec[];
}

export interface DebugGizmoOptions {
  categories?: Partial<Record<DebugGizmoCategory, boolean>>;
  colors?: Partial<Record<DebugGizmoCategory, DebugGizmoColor>>;
  spawnRadius?: number;
  path?: string;
}

export interface DebugGizmoLine extends PhysicsDebugLineView {
  category: DebugGizmoCategory;
  sourceId: string;
}

export interface DebugGizmoLineBufferResult {
  lines: readonly DebugGizmoLine[];
  bufferView: PhysicsDebugLineBufferView;
}

interface ResolvedDebugGizmoPath {
  id: string;
  points: readonly DebugGizmoPoint[];
  closed: boolean;
  color?: ResolvedDebugGizmoColor;
}

interface ResolvedDebugGizmoSpawn extends DebugGizmoPoint {
  id: string;
  radius: number;
  color?: ResolvedDebugGizmoColor;
}

interface ResolvedDebugGizmoBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: ResolvedDebugGizmoColor;
}

const DEFAULT_COLORS: Record<DebugGizmoCategory, ResolvedDebugGizmoColor> = {
  path: [0.1, 0.75, 1, 1],
  spawn: [0.35, 1, 0.2, 1],
  prefab: [1, 0.8, 0.2, 1],
  collider: [1, 0.2, 0.2, 1],
};
const DEFAULT_SPAWN_RADIUS = 8;

export function buildDebugGizmoLines(
  scene: DebugGizmoSceneSpec,
  options: DebugGizmoOptions = {},
): readonly DebugGizmoLine[] {
  const path = options.path ?? "debugGizmos";
  if (!isRecord(scene)) {
    throw invalid(path, "must be an object");
  }
  const input = scene as DebugGizmoSceneSpec;
  const categories = options.categories ?? {};
  const colors = resolveColors(options.colors ?? {}, `${path}.colors`);
  const spawnRadius = positiveNumber(options.spawnRadius ?? DEFAULT_SPAWN_RADIUS, `${path}.spawnRadius`);
  const lines: DebugGizmoLine[] = [];

  if (categories.path !== false) {
    const paths = arrayOrEmpty(input.paths, `${path}.paths`);
    for (let index = 0; index < paths.length; index += 1) {
      const gizmo = paths[index];
      if (gizmo !== undefined) {
        appendPathLines(lines, resolvePath(gizmo, `${path}.paths.${index}`), colors.path);
      }
    }
  }
  if (categories.spawn !== false) {
    const spawns = arrayOrEmpty(input.spawns, `${path}.spawns`);
    for (let index = 0; index < spawns.length; index += 1) {
      const spawn = spawns[index];
      if (spawn !== undefined) {
        appendSpawnLines(lines, resolveSpawn(spawn, `${path}.spawns.${index}`, spawnRadius), colors.spawn);
      }
    }
  }
  if (categories.prefab !== false) {
    const prefabs = arrayOrEmpty(input.prefabs, `${path}.prefabs`);
    for (let index = 0; index < prefabs.length; index += 1) {
      const prefab = prefabs[index];
      if (prefab !== undefined) {
        appendBoundsLines(lines, resolveBounds(prefab, `${path}.prefabs.${index}`), "prefab", colors.prefab);
      }
    }
  }
  if (categories.collider !== false) {
    const colliders = arrayOrEmpty(input.colliders, `${path}.colliders`);
    for (let index = 0; index < colliders.length; index += 1) {
      const collider = colliders[index];
      if (collider !== undefined) {
        appendBoundsLines(lines, resolveBounds(collider, `${path}.colliders.${index}`), "collider", colors.collider);
      }
    }
  }

  return lines;
}

export function debugGizmoLinesToBuffer(lines: readonly PhysicsDebugLineView[]): PhysicsDebugLineBufferView {
  const buffer = new Float32Array(lines.length * FLOATS_PER_PHYSICS_DEBUG_LINE);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const offset = index * FLOATS_PER_PHYSICS_DEBUG_LINE;
    buffer[offset] = finiteNumber(line.x0, `debugGizmos.lines.${index}.x0`);
    buffer[offset + 1] = finiteNumber(line.y0, `debugGizmos.lines.${index}.y0`);
    buffer[offset + 2] = finiteNumber(line.x1, `debugGizmos.lines.${index}.x1`);
    buffer[offset + 3] = finiteNumber(line.y1, `debugGizmos.lines.${index}.y1`);
    const color = resolveColor(line.color, `debugGizmos.lines.${index}.color`);
    buffer[offset + 4] = color[0];
    buffer[offset + 5] = color[1];
    buffer[offset + 6] = color[2];
    buffer[offset + 7] = color[3];
  }
  return {
    buffer,
    lineCount: lines.length,
    floatsPerLine: FLOATS_PER_PHYSICS_DEBUG_LINE,
  };
}

export function buildDebugGizmoLineBuffer(
  scene: DebugGizmoSceneSpec,
  options: DebugGizmoOptions = {},
): DebugGizmoLineBufferResult {
  const lines = buildDebugGizmoLines(scene, options);
  return {
    lines,
    bufferView: debugGizmoLinesToBuffer(lines),
  };
}

function appendPathLines(
  lines: DebugGizmoLine[],
  path: ResolvedDebugGizmoPath,
  color: ResolvedDebugGizmoColor,
): void {
  for (let index = 0; index < path.points.length - 1; index += 1) {
    const from = path.points[index];
    const to = path.points[index + 1];
    if (from !== undefined && to !== undefined) {
      appendLine(lines, "path", path.id, from, to, path.color ?? color);
    }
  }
  if (path.closed && path.points.length > 2) {
    const from = path.points[path.points.length - 1];
    const to = path.points[0];
    if (from !== undefined && to !== undefined) {
      appendLine(lines, "path", path.id, from, to, path.color ?? color);
    }
  }
}

function appendSpawnLines(
  lines: DebugGizmoLine[],
  spawn: ResolvedDebugGizmoSpawn,
  color: ResolvedDebugGizmoColor,
): void {
  const resolvedColor = spawn.color ?? color;
  appendLine(lines, "spawn", spawn.id, { x: spawn.x - spawn.radius, y: spawn.y }, { x: spawn.x + spawn.radius, y: spawn.y }, resolvedColor);
  appendLine(lines, "spawn", spawn.id, { x: spawn.x, y: spawn.y - spawn.radius }, { x: spawn.x, y: spawn.y + spawn.radius }, resolvedColor);
}

function appendBoundsLines(
  lines: DebugGizmoLine[],
  bounds: ResolvedDebugGizmoBounds,
  category: "prefab" | "collider",
  color: ResolvedDebugGizmoColor,
): void {
  const x0 = bounds.x;
  const y0 = bounds.y;
  const x1 = bounds.x + bounds.width;
  const y1 = bounds.y + bounds.height;
  const resolvedColor = bounds.color ?? color;
  appendLine(lines, category, bounds.id, { x: x0, y: y0 }, { x: x1, y: y0 }, resolvedColor);
  appendLine(lines, category, bounds.id, { x: x1, y: y0 }, { x: x1, y: y1 }, resolvedColor);
  appendLine(lines, category, bounds.id, { x: x1, y: y1 }, { x: x0, y: y1 }, resolvedColor);
  appendLine(lines, category, bounds.id, { x: x0, y: y1 }, { x: x0, y: y0 }, resolvedColor);
}

function appendLine(
  lines: DebugGizmoLine[],
  category: DebugGizmoCategory,
  sourceId: string,
  from: DebugGizmoPoint,
  to: DebugGizmoPoint,
  color: ResolvedDebugGizmoColor,
): void {
  lines.push({
    category,
    sourceId,
    x0: from.x,
    y0: from.y,
    x1: to.x,
    y1: to.y,
    color: [...color],
  });
}

function resolvePath(value: DebugGizmoPathSpec, path: string): ResolvedDebugGizmoPath {
  if (!isRecord(value)) {
    throw invalid(path, "must be an object");
  }
  if (!Array.isArray(value.points) || value.points.length < 2) {
    throw invalid(`${path}.points`, "must contain at least two points");
  }
  return {
    id: stringValue(value.id, `${path}.id`),
    points: value.points.map((point, index) => resolvePoint(point, `${path}.points.${index}`)),
    closed: value.closed ?? false,
    color: value.color === undefined ? undefined : resolveColor(value.color, `${path}.color`),
  };
}

function resolveSpawn(value: DebugGizmoSpawnSpec, path: string, defaultRadius: number): ResolvedDebugGizmoSpawn {
  if (!isRecord(value)) {
    throw invalid(path, "must be an object");
  }
  return {
    id: stringValue(value.id, `${path}.id`),
    x: finiteNumber(value.x, `${path}.x`),
    y: finiteNumber(value.y, `${path}.y`),
    radius: positiveNumber(value.radius ?? defaultRadius, `${path}.radius`),
    color: value.color === undefined ? undefined : resolveColor(value.color, `${path}.color`),
  };
}

function resolveBounds(value: DebugGizmoBoundsSpec, path: string): ResolvedDebugGizmoBounds {
  if (!isRecord(value)) {
    throw invalid(path, "must be an object");
  }
  return {
    id: stringValue(value.id, `${path}.id`),
    x: finiteNumber(value.x, `${path}.x`),
    y: finiteNumber(value.y, `${path}.y`),
    width: positiveNumber(value.width, `${path}.width`),
    height: positiveNumber(value.height, `${path}.height`),
    color: value.color === undefined ? undefined : resolveColor(value.color, `${path}.color`),
  };
}

function resolvePoint(value: unknown, path: string): DebugGizmoPoint {
  if (!isRecord(value)) {
    throw invalid(path, "must be an object");
  }
  return {
    x: finiteNumber(value.x, `${path}.x`),
    y: finiteNumber(value.y, `${path}.y`),
  };
}

function resolveColors(
  colors: Partial<Record<DebugGizmoCategory, DebugGizmoColor>>,
  path: string,
): Record<DebugGizmoCategory, ResolvedDebugGizmoColor> {
  if (!isRecord(colors)) {
    throw invalid(path, "must be an object");
  }
  return {
    path: colors.path === undefined ? DEFAULT_COLORS.path : resolveColor(colors.path, `${path}.path`),
    spawn: colors.spawn === undefined ? DEFAULT_COLORS.spawn : resolveColor(colors.spawn, `${path}.spawn`),
    prefab: colors.prefab === undefined ? DEFAULT_COLORS.prefab : resolveColor(colors.prefab, `${path}.prefab`),
    collider: colors.collider === undefined ? DEFAULT_COLORS.collider : resolveColor(colors.collider, `${path}.collider`),
  };
}

function resolveColor(color: DebugGizmoColor, path: string): ResolvedDebugGizmoColor {
  if (!Array.isArray(color) || (color.length !== 3 && color.length !== 4)) {
    throw invalid(path, "must be an RGB or RGBA array");
  }
  const r = normalizedNumber(color[0], `${path}.0`);
  const g = normalizedNumber(color[1], `${path}.1`);
  const b = normalizedNumber(color[2], `${path}.2`);
  const a = color.length === 4 ? normalizedNumber(color[3], `${path}.3`) : 1;
  return [r, g, b, a];
}

function arrayOrEmpty<T>(value: readonly T[] | undefined, path: string): readonly T[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalid(path, "must be an array");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(path, "must be a non-empty string");
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(path, "must be a finite number");
  }
  return value;
}

function positiveNumber(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number <= 0) {
    throw invalid(path, "must be greater than 0");
  }
  return number;
}

function normalizedNumber(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number < 0 || number > 1) {
    throw invalid(path, "must be between 0 and 1");
  }
  return number;
}

function invalid(path: string, detail: string): Error {
  return debugGizmoDiagnosticError(path, detail);
}
