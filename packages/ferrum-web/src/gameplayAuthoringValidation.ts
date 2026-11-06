import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function requiredBehaviorProp(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-empty string");
  }
  return value;
}

export function recordValue(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  }
  return value;
}

export function positiveU32(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 0xffffffff) {
    throw gameplayAuthoringDiagnosticError(path, "must be a positive safe u32 integer");
  }
  return value;
}
