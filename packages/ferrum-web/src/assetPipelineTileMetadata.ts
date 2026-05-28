import { assetPipelineDiagnosticError } from "./diagnostics.js";
import type { ShooterTileSlopeSpec } from "./gameSpec.js";
import { normalizedNumber } from "./assetPipelineValidation.js";
import type { JsonRecord } from "./assetPipelineValidation.js";

export function tileSlopeFromEndpointProperties(
  x0: { value: unknown; path: string } | undefined,
  y0: { value: unknown; path: string } | undefined,
  x1: { value: unknown; path: string } | undefined,
  y1: { value: unknown; path: string } | undefined,
  path: string,
): ShooterTileSlopeSpec | undefined {
  if (!x0 && !y0 && !x1 && !y1) {
    return undefined;
  }
  const slope = {
    x0: normalizedNumber(x0?.value, x0?.path ?? `${path}.slopeX0`),
    y0: normalizedNumber(y0?.value, y0?.path ?? `${path}.slopeY0`),
    x1: normalizedNumber(x1?.value, x1?.path ?? `${path}.slopeX1`),
    y1: normalizedNumber(y1?.value, y1?.path ?? `${path}.slopeY1`),
  };
  validateTileSlope(slope, `${path}.slopeX1`, "slopeX0");
  return slope;
}

export function tileSlopeFromRecord(value: JsonRecord, path: string): ShooterTileSlopeSpec {
  const slope = {
    x0: normalizedNumber(value.x0, `${path}.x0`),
    y0: normalizedNumber(value.y0, `${path}.y0`),
    x1: normalizedNumber(value.x1, `${path}.x1`),
    y1: normalizedNumber(value.y1, `${path}.y1`),
  };
  validateTileSlope(slope, `${path}.x1`, "slope.x0");
  return slope;
}

function validateTileSlope(slope: ShooterTileSlopeSpec, path: string, x0Name: string): void {
  if (Math.abs((slope.x1 ?? 0) - (slope.x0 ?? 0)) <= 0.0001) {
    throw assetPipelineDiagnosticError(path, `must differ from ${x0Name}`);
  }
}
