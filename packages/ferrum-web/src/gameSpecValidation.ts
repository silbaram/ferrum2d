import { gameSpecDiagnosticError } from "./diagnostics.js";

export function optionalObject(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (isObject(value)) {
    return value;
  }
  throw gameSpecError(path, "must be an object");
}

export function positiveNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  throw gameSpecError(path, "must be a positive finite number");
}

export function requiredPositiveNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  throw gameSpecError(path, "must be a positive finite number");
}

export function requiredFiniteNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw gameSpecError(path, "must be a finite number");
}

export function positiveInteger(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw gameSpecError(path, "must be a positive integer");
}

export function requiredPositiveInteger(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw gameSpecError(path, "must be a positive integer");
}

export function nonNegativeNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  throw gameSpecError(path, "must be a non-negative finite number");
}

export function nonNegativeInteger(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw gameSpecError(path, "must be a non-negative integer");
}

export function finiteNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw gameSpecError(path, "must be a finite number");
}

export function normalizedNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }
  throw gameSpecError(path, "must be a finite number between 0 and 1");
}

export function atlasTexture(value: unknown, path: string): string | number {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw gameSpecError(path, "must be a non-empty texture name or non-negative integer texture id");
}

export function booleanValue(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  throw gameSpecError(path, "must be a boolean");
}

export function layerName(value: unknown, path: string, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  throw gameSpecError(path, "must be a non-empty string");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function gameSpecError(path: string, detail: string): Error {
  return gameSpecDiagnosticError(path, detail);
}
