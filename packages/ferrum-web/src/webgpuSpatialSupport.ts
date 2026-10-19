import { resolveDataSceneSpatialSpec, type DataSceneSpatialSpec } from "./dataSceneSpatial.js";
/** Cold shape preflight. All current spatial features share the native public ABI. */
export function assertWebGpuSpatialSpecSupported(input: DataSceneSpatialSpec): void {
  resolveDataSceneSpatialSpec(input);
}
