import { finiteNumber } from "./particlePreset";

export function positiveNumber(value: number, label: string): number {
  const resolved = finiteNumber(value, label);
  if (resolved <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }
  return resolved;
}

export function nonNegativeNumber(value: number, label: string): number {
  const resolved = finiteNumber(value, label);
  if (resolved < 0) {
    throw new Error(`${label} must be greater than or equal to 0.`);
  }
  return resolved;
}

export function unitIntervalNumber(value: number, label: string): number {
  const resolved = finiteNumber(value, label);
  if (resolved < 0 || resolved > 1) {
    throw new Error(`${label} must be between 0 and 1.`);
  }
  return resolved;
}

export function breakLimitNumber(value: number, label: string): number {
  if (value === Number.POSITIVE_INFINITY) {
    return value;
  }
  return nonNegativeNumber(value, label);
}
