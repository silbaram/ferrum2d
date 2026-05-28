import { assetPipelineDiagnosticError } from "./diagnostics.js";
import {
  arrayValue,
  nonNegativeInteger,
  nonNegativeNumber,
} from "./assetPipelineValidation.js";

export function ldtkNumberPair(value: unknown, path: string): [number, number] {
  const values = arrayValue(value, path);
  if (values.length !== 2) {
    throw assetPipelineDiagnosticError(path, "must contain exactly two numbers");
  }
  return [
    nonNegativeNumber(values[0], `${path}.0`),
    nonNegativeNumber(values[1], `${path}.1`),
  ];
}

export function ldtkOptionalIntegerPair(
  value: unknown,
  path: string,
  fallback: [number, number],
): [number, number] {
  if (value === undefined) {
    return fallback;
  }
  const values = arrayValue(value, path);
  if (values.length !== 2) {
    throw assetPipelineDiagnosticError(path, "must contain exactly two integers");
  }
  return [
    nonNegativeInteger(values[0], `${path}.0`),
    nonNegativeInteger(values[1], `${path}.1`),
  ];
}

export function ldtkGridCoordinate(value: number, gridSize: number, path: string): number {
  const coordinate = value / gridSize;
  if (!Number.isInteger(coordinate)) {
    throw assetPipelineDiagnosticError(path, "must align to the LDtk layer grid");
  }
  return coordinate;
}
