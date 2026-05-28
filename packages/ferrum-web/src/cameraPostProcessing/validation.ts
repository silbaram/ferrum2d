import { cameraPostProcessingDiagnosticError } from "../diagnostics.js";
import type { PostProcessColor, ResolvedPostProcessColor } from "./types.js";

export function resolveColor(
  color: PostProcessColor,
  path: string,
  opacity?: number,
): ResolvedPostProcessColor {
  if (!Array.isArray(color) || (color.length !== 3 && color.length !== 4)) {
    throw invalid(path, "must be an RGB or RGBA array");
  }
  const alpha = unitNumber(color.length === 4 ? color[3] : 1, `${path}[3]`, 1)
    * unitNumber(opacity, `${path}.opacity`, 1);
  return [
    unitNumber(color[0], `${path}[0]`, 0),
    unitNumber(color[1], `${path}[1]`, 0),
    unitNumber(color[2], `${path}[2]`, 0),
    alpha,
  ];
}

export function finiteNumber(value: number | undefined, path: string, fallback?: number): number {
  if (value === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw invalid(path, "must be a finite number");
  }
  if (!Number.isFinite(value)) {
    throw invalid(path, "must be a finite number");
  }
  return value;
}

export function nonNegativeNumber(value: number | undefined, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  return nonNegativeFinite(value, path);
}

export function nonNegativeFinite(value: number, path: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw invalid(path, "must be a non-negative finite number");
  }
  return value;
}

export function unitNumber(value: number | undefined, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw invalid(path, "must be a finite number between 0 and 1");
  }
  return value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function invalid(path: string, detail: string): Error {
  return cameraPostProcessingDiagnosticError(path, detail);
}
