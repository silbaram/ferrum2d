import type { LightingColor3, LightingColor4 } from "./lightingTypes.js";

export function normalizeColor4(color: LightingColor3 | LightingColor4, path: string): LightingColor4 {
  const length = color.length;
  if (length !== 3 && length !== 4) {
    throw new Error(`${path} must contain 3 or 4 normalized color channels.`);
  }
  return [
    normalizedChannel(color[0], `${path}[0]`),
    normalizedChannel(color[1], `${path}[1]`),
    normalizedChannel(color[2], `${path}[2]`),
    normalizedChannel(length === 4 ? color[3] : 1, `${path}[3]`),
  ];
}

export function positiveInteger(value: number, path: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} must be a positive integer.`);
  }
  return value;
}

export function positiveNumber(value: number, path: string): number {
  const number = finiteNumber(value, path);
  if (number <= 0) {
    throw new Error(`${path} must be greater than 0.`);
  }
  return number;
}

export function nonNegativeNumber(value: number, path: string): number {
  const number = finiteNumber(value, path);
  if (number < 0) {
    throw new Error(`${path} must be greater than or equal to 0.`);
  }
  return number;
}

export function finiteNumber(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function normalizedChannel(value: number, path: string): number {
  const channel = finiteNumber(value, path);
  if (channel < 0 || channel > 1) {
    throw new Error(`${path} must be between 0 and 1.`);
  }
  return channel;
}
