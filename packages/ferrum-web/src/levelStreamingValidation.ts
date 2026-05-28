import { levelStreamingDiagnosticError } from "./diagnostics.js";

export function invalid(path: string, detail: string): Error {
  return levelStreamingDiagnosticError(path, detail);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(path, "must be a non-empty string");
  }
  return value;
}

export function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(path, "must be a finite number");
  }
  return value;
}

export function positiveNumber(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number <= 0) {
    throw invalid(path, "must be greater than 0");
  }
  return number;
}

export function integer(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (!Number.isInteger(number)) {
    throw invalid(path, "must be an integer");
  }
  return number;
}

export function positiveInteger(value: unknown, path: string): number {
  const number = integer(value, path);
  if (number <= 0) {
    throw invalid(path, "must be greater than 0");
  }
  return number;
}

export function nonNegativeInteger(value: unknown, path: string): number {
  const number = integer(value, path);
  if (number < 0) {
    throw invalid(path, "must be greater than or equal to 0");
  }
  return number;
}
