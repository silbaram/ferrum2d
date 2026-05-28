import { assetPipelineDiagnosticError } from "./diagnostics.js";

export type JsonRecord = Record<string, unknown>;

export function objectValue(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) {
    throw assetPipelineDiagnosticError(path, "must be an object");
  }
  return value;
}

export function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw assetPipelineDiagnosticError(path, "must be an array");
  }
  return value;
}

export function optionalArray(value: unknown, path: string): unknown[] {
  if (value === undefined) {
    return [];
  }
  return arrayValue(value, path);
}

export function optionalObject(value: unknown, path: string): JsonRecord {
  if (value === undefined) {
    return {};
  }
  return objectValue(value, path);
}

export function textureValue(value: unknown, path: string): string | number {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (Number.isInteger(value) && typeof value === "number" && value >= 0) {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a non-empty string or non-negative integer");
}

export function requiredString(value: unknown, path: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a non-empty string");
}

export function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, path);
}

export function optionalNullableString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requiredString(value, path);
}

export function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a boolean");
}

export function positiveNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a positive finite number");
}

export function positiveInteger(value: unknown, path: string): number {
  if (Number.isInteger(value) && typeof value === "number" && value > 0) {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a positive integer");
}

export function nonNegativeNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a non-negative finite number");
}

export function normalizedNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a normalized number from 0 to 1");
}

export function nonNegativeInteger(value: unknown, path: string): number {
  if (Number.isInteger(value) && typeof value === "number" && value >= 0) {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a non-negative integer");
}

export function finiteNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw assetPipelineDiagnosticError(path, "must be a finite number");
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
