import { physicsSpecDiagnosticError } from "./diagnostics.js";
import type {
  PhysicsSpecBodyType,
  PhysicsSpecColliderShape,
  PhysicsSpecJointType,
  ResolvedPhysicsBodySpec,
  ResolvedPhysicsVector2,
} from "./physicsSpecTypes.js";

export function optionalObject(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  return requiredObject(value, path);
}

export function requiredObject(value: unknown, path: string): Record<string, unknown> {
  if (isObject(value)) {
    return value;
  }
  throw physicsSpecError(path, "must be an object");
}

export function rejectUnknownKeys(
  object: Record<string, unknown>,
  path: string,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      throw physicsSpecError(`${path}.${key}`, "is not a supported physics spec field");
    }
  }
}

export function vector2(
  value: unknown,
  path: string,
  fallback: ResolvedPhysicsVector2,
): ResolvedPhysicsVector2 {
  if (value === undefined) {
    return fallback;
  }
  return requiredVector2(value, path);
}

export function requiredVector2(value: unknown, path: string): ResolvedPhysicsVector2 {
  if (!Array.isArray(value) || value.length !== 2) {
    throw physicsSpecError(path, "must be a [x, y] array");
  }
  return {
    x: requiredFiniteNumber(value[0], `${path}.0`),
    y: requiredFiniteNumber(value[1], `${path}.1`),
  };
}

export function requiredPositiveVector2(value: unknown, path: string): ResolvedPhysicsVector2 {
  if (!Array.isArray(value) || value.length !== 2) {
    throw physicsSpecError(path, "must be a [x, y] array");
  }
  return {
    x: requiredPositiveNumber(value[0], `${path}.0`),
    y: requiredPositiveNumber(value[1], `${path}.1`),
  };
}

export function stringArray(value: unknown, path: string, fallback: string[]): string[] {
  if (value === undefined) {
    return fallback;
  }
  if (!Array.isArray(value)) {
    throw physicsSpecError(path, "must be an array");
  }
  return value.map((item, index) => {
    if (typeof item === "string" && item.trim().length > 0) {
      return item;
    }
    throw physicsSpecError(`${path}.${index}`, "must be a non-empty string");
  });
}

export function stringValue(value: unknown, path: string, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }
  return requiredString(value, path);
}

export function optionalReference<T>(
  value: unknown,
  path: string,
  targets: Record<string, T>,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const name = requiredString(value, path);
  if (!hasOwnKey(targets, name)) {
    throw physicsSpecError(path, `must reference an existing id: ${name}`);
  }
  return name;
}

export function bodyReference(
  value: unknown,
  path: string,
  bodies: Record<string, ResolvedPhysicsBodySpec>,
): string {
  const name = requiredString(value, path);
  if (name === "world" || hasOwnKey(bodies, name)) {
    return name;
  }
  throw physicsSpecError(path, `must reference an existing body or world: ${name}`);
}

export function requireName(name: string, path: string): void {
  if (name.trim().length === 0) {
    throw physicsSpecError(path, "id must be a non-empty string");
  }
}

export function bodyType(value: unknown, path: string): PhysicsSpecBodyType {
  if (value === undefined) {
    return "dynamic";
  }
  if (value === "static" || value === "kinematic" || value === "dynamic") {
    return value;
  }
  throw physicsSpecError(path, "must be one of static, kinematic, or dynamic");
}

export function colliderShape(value: unknown, path: string): PhysicsSpecColliderShape {
  if (
    value === "aabb" ||
    value === "box" ||
    value === "circle" ||
    value === "capsule" ||
    value === "orientedBox" ||
    value === "convexPolygon" ||
    value === "edge" ||
    value === "chain"
  ) {
    return value;
  }
  throw physicsSpecError(path, "must be a supported collider shape");
}

export function jointType(value: unknown, path: string): PhysicsSpecJointType {
  if (
    value === "distance" ||
    value === "rope" ||
    value === "spring" ||
    value === "pulley" ||
    value === "revolute" ||
    value === "prismatic" ||
    value === "weld" ||
    value === "gear"
  ) {
    return value;
  }
  throw physicsSpecError(path, "must be a supported joint type");
}

export function booleanValue(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  throw physicsSpecError(path, "must be a boolean");
}

export function positiveNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  return requiredPositiveNumber(value, path);
}

export function nonNegativeNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  throw physicsSpecError(path, "must be a non-negative finite number");
}

export function finiteNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  return requiredFiniteNumber(value, path);
}

export function nonNegativeInteger(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw physicsSpecError(path, "must be a non-negative integer");
}

export function unitIntervalNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }
  throw physicsSpecError(path, "must be a finite number between 0 and 1");
}

export function requireDistinctPoints(
  a: ResolvedPhysicsVector2,
  b: ResolvedPhysicsVector2,
  path: string,
): void {
  if (a.x === b.x && a.y === b.y) {
    throw physicsSpecError(path, "must use distinct points");
  }
}

export function physicsSpecError(path: string, detail: string): Error {
  return physicsSpecDiagnosticError(path, detail);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  throw physicsSpecError(path, "must be a non-empty string");
}

function requiredPositiveNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  throw physicsSpecError(path, "must be a positive finite number");
}

function requiredFiniteNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw physicsSpecError(path, "must be a finite number");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnKey<T>(targets: Record<string, T>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(targets, key);
}
