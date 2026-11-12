import { spatialLightShaftsActive } from "./spatialLightShafts.js";
import { spatialEnvironmentVersion } from "./spatialEnvironmentAbi.js";
/** Private pass selection from the validated native v6..v15 environment. */
export function spatialSeparated(values: Float32Array | undefined): boolean {
  return values !== undefined && (spatialEnvironmentVersion(values.length) ?? 0) >= 6 && values[528] === 1;
}

export function spatialIndirectPass(values: Float32Array | undefined): boolean {
  return spatialSeparated(values) && values![132] === 1 && values![133] > 0;
}

export function spatialDofPass(values: Float32Array | undefined): boolean {
  return spatialSeparated(values) && (values![0] & 4) !== 0 && values![62] > 0 && values![63] > 0
    && values![128] === 1 && values![129] > 0;
}

export function spatialResolvePass(values: Float32Array | undefined): boolean {
  return spatialIndirectPass(values) || spatialLightShaftsActive(values);
}
