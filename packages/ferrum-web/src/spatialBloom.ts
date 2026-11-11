import type { SpatialEnvironmentSpec } from "./spatialEnvironment.js";

/** Private cold capability; numeric v9 preserves source presence separately from enablement. */
export function supportsSpatialWideBloom(engine: unknown): boolean {
  const native = engine as { spatial_wide_bloom_abi_version?: () => number } | undefined;
  return typeof native?.spatial_wide_bloom_abi_version === "function" && native.spatial_wide_bloom_abi_version() === 1;
}
export function requestsSpatialWideBloom(spec?: SpatialEnvironmentSpec | null): boolean {
  return spec?.bloom?.mode === "wide";
}
export function hasSpatialSelectionSource(v: Float32Array): boolean {
  return v.length === 580 || v.length === 584 && v[583] === 1;
}
export function validSpatialWideBloom(v: Float32Array): boolean {
  return v[580] === 1 && v[528] === 1 && v[128] === 1
    && (v[581] === 4 && v[582] === 4 || v[581] === 2 && [4, 8].includes(v[582]))
    && [0, 1].includes(v[583]) && (v[583] === 1 || v.subarray(576, 580).every(x => x === 0));
}
/** GPU work configuration only; simulation and selection remain native-owned. */
export function spatialWideBloom(v: Float32Array | undefined): boolean {
  return v?.length === 584 && v[580] === 1 && v[128] === 1 && v[129] > 0;
}
