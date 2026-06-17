import { physicsSpecDiagnosticError } from "./diagnostics.js";
import type { PhysicsSpecVector2, ResolvedPhysicsVector2 } from "./physicsSpec.js";

export function vector2(
  value: PhysicsSpecVector2 | undefined,
  path: string,
  fallback: ResolvedPhysicsVector2,
): ResolvedPhysicsVector2 {
  if (value === undefined) {
    return fallback;
  }
  return requiredVector2(value, path);
}

export function positiveVector2(
  value: PhysicsSpecVector2 | undefined,
  path: string,
  fallback: ResolvedPhysicsVector2,
): ResolvedPhysicsVector2 {
  if (value === undefined) {
    return fallback;
  }
  return requiredPositiveVector2(value, path);
}

export function requiredVector2(value: unknown, path: string): ResolvedPhysicsVector2 {
  if (!Array.isArray(value) || value.length !== 2) {
    throw physicsSpecDiagnosticError(path, "must be a [x, y] array");
  }
  return {
    x: finiteNumber(value[0], `${path}.0`),
    y: finiteNumber(value[1], `${path}.1`),
  };
}

export function requiredPositiveVector2(value: unknown, path: string): ResolvedPhysicsVector2 {
  const resolved = requiredVector2(value, path);
  if (resolved.x <= 0 || resolved.y <= 0) {
    throw physicsSpecDiagnosticError(path, "must contain positive finite numbers");
  }
  return resolved;
}

export function requireDistinctPoints(a: ResolvedPhysicsVector2, b: ResolvedPhysicsVector2, path: string): void {
  if (a.x === b.x && a.y === b.y) {
    throw physicsSpecDiagnosticError(path, "must use distinct points");
  }
}

export function normalizedNonZeroVector2(value: ResolvedPhysicsVector2, path: string): ResolvedPhysicsVector2 {
  const length = vectorLength(value);
  if (length === 0) {
    throw physicsSpecDiagnosticError(path, "must not be a zero vector");
  }
  return {
    x: value.x / length,
    y: value.y / length,
  };
}

export function vectorLength(value: ResolvedPhysicsVector2): number {
  return Math.hypot(value.x, value.y);
}

export function requireName(name: string, path: string): void {
  if (name.trim().length === 0) {
    throw physicsSpecDiagnosticError(path, "id must be a non-empty string");
  }
}

export function finiteNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw physicsSpecDiagnosticError(path, "must be a finite number");
}

export function booleanValue(value: unknown, path: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  throw physicsSpecDiagnosticError(path, "must be a boolean");
}

export function positiveNumber(value: unknown, path: string): number {
  const resolved = finiteNumber(value, path);
  if (resolved <= 0) {
    throw physicsSpecDiagnosticError(path, "must be a positive finite number");
  }
  return resolved;
}

export function nonNegativeNumber(value: unknown, path: string): number {
  const resolved = finiteNumber(value, path);
  if (resolved < 0) {
    throw physicsSpecDiagnosticError(path, "must be a non-negative finite number");
  }
  return resolved;
}

export function optionalNonNegativeNumber(value: unknown, path: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return nonNegativeNumber(value, path);
}

export function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw physicsSpecDiagnosticError(path, "must be a non-negative integer");
}

export function unitIntervalNumber(value: unknown, path: string): number {
  const resolved = finiteNumber(value, path);
  if (resolved < 0 || resolved > 1) {
    throw physicsSpecDiagnosticError(path, "must be a finite number between 0 and 1");
  }
  return resolved;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
