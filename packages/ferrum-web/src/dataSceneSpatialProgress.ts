import {
  resolveSpatialCameraSpec,
  spatialCameraValues,
  type DataSceneSpatialSpec,
  type SpatialCameraSpec,
} from "./dataSceneSpatial.js";
import type { PhysicsBodyHeightSpan } from "./engineTypes/physicsBodies.js";
import {
  resolveSpatialEnvironmentSpec,
  type SpatialEnvironmentSpec,
} from "./spatialEnvironment.js";

/** Serializable native world pose, bound to an authored instance ID by DataSceneProgressSnapshot. */
export interface DataSceneSpatialPoseSnapshot {
  readonly x: number;
  readonly y: number;
  readonly heightSpan: PhysicsBodyHeightSpan | null;
  /** Optional stable terrain identity when the entity origin is supported by that surface. */
  readonly surfaceId?: string;
}

export interface DataSceneSpatialProgressSnapshot {
  /** v7 only. Null disables authored effects; absent preserves authored defaults. */
  readonly environment?: SpatialEnvironmentSpec | null;
  /** null explicitly restores spatial mode as disabled. No matrix, viewport or DPR is saved. */
  readonly camera: SpatialCameraSpec | null;
}

export const SPATIAL_PROGRESS_CAMERA_VALUES = 13;
export const SPATIAL_PROGRESS_POSE_VALUES = 8;

export function decodeSpatialProgressCamera(
  values: Float64Array,
): SpatialCameraSpec | null {
  if (values[0] === 0) return null;
  return resolveSpatialCameraSpec(
    {
      projection: values[1] === 0 ? "orthographic" : "perspective",
      position: { x: values[2], elevation: values[3], y: -values[4]! },
      target: { x: values[5], elevation: values[6], y: -values[7]! },
      ...(values[1] === 0
        ? { height: values[8] }
        : { fovDegrees: (values[8]! * 180) / Math.PI }),
      near: values[9],
      far: values[10],
    },
    "dataScene.progress.spatial.camera",
  );
}

export function decodeSpatialPose(
  values: Float64Array,
  spec: DataSceneSpatialSpec,
): DataSceneSpatialPoseSnapshot | undefined {
  if (values[0] === 0) return undefined;
  const id = values[7] === 0 ? undefined : spec.terrain[values[7]! - 1]?.id;
  if (values[7] !== 0 && id === undefined)
    throw new Error(
      "Data Scene spatial progress has an unknown native surface identity.",
    );
  return {
    x: values[1]!,
    y: values[2]!,
    heightSpan:
      values[3] === 0
        ? null
        : { floorId: values[4]!, elevation: values[5]!, height: values[6]! },
    ...(id === undefined ? {} : { surfaceId: id }),
  };
}

export function resolveSpatialPose(
  value: unknown,
): DataSceneSpatialPoseSnapshot {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) => !["x", "y", "heightSpan", "surfaceId"].includes(key),
    )
  ) {
    throw new Error(
      "Data Scene spatial pose must contain x, y and heightSpan.",
    );
  }
  finite(value.x);
  finite(value.y);
  if (value.heightSpan !== null) {
    const span = value.heightSpan;
    if (
      !record(span) ||
      Object.keys(span).some(
        (key) => !["floorId", "elevation", "height"].includes(key),
      ) ||
      typeof span.floorId !== "number" ||
      !Number.isInteger(span.floorId) ||
      span.floorId < 0 ||
      span.floorId > 0xffffffff
    ) {
      throw new Error(
        "Data Scene spatial pose heightSpan requires a uint32 floorId.",
      );
    }
    finite(span.elevation);
    finite(span.height);
    if (
      (span.height as number) < 0 ||
      !Number.isFinite(
        Math.fround((span.elevation as number) + (span.height as number)),
      )
    ) {
      throw new Error(
        "Data Scene spatial pose height must be nonnegative and its top must be finite f32.",
      );
    }
  }
  if (
    value.surfaceId !== undefined &&
    (typeof value.surfaceId !== "string" ||
      value.surfaceId.length === 0 ||
      value.heightSpan === null)
  ) {
    throw new Error(
      "Data Scene spatial pose surfaceId requires a heightSpan and nonempty authored ID.",
    );
  }
  // All fields are validated above; this module converts serialization data, never simulates movement.
  return value as unknown as DataSceneSpatialPoseSnapshot;
}

export function resolveSpatialProgress(
  value: unknown,
): DataSceneSpatialProgressSnapshot {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) => key !== "camera" && key !== "environment",
    ) ||
    value.camera === undefined
  ) {
    throw new Error(
      "Data Scene spatial progress requires a camera or explicit null.",
    );
  }
  if (
    value.camera === null &&
    value.environment !== undefined &&
    value.environment !== null
  )
    throw new Error("Disabled spatial progress cannot contain an environment");
  return {
    ...(value.environment === undefined
      ? {}
      : {
          environment:
            value.environment === null
              ? null
              : resolveSpatialEnvironmentSpec(
                  value.environment,
                  "dataScene.progress.spatial.environment",
                ),
        }),
    camera:
      value.camera === null
        ? null
        : resolveSpatialCameraSpec(
            value.camera,
            "dataScene.progress.spatial.camera",
          ),
  };
}

export function spatialProgressValues(
  state: DataSceneSpatialProgressSnapshot,
  instances: readonly {
    readonly id: string;
    readonly spatialPose?: DataSceneSpatialPoseSnapshot;
  }[],
  spec: DataSceneSpatialSpec,
  viewport: { width: number; height: number },
): Float64Array {
  const values = new Float64Array(
    SPATIAL_PROGRESS_CAMERA_VALUES +
      instances.length * SPATIAL_PROGRESS_POSE_VALUES,
  );
  if (state.camera !== null) {
    values[0] = 1;
    values.set(
      spatialCameraValues(state.camera, viewport.width, viewport.height),
      1,
    );
  }
  instances.forEach((instance, index) => {
    const pose = instance.spatialPose;
    if (pose === undefined) return;
    const span = pose.heightSpan;
    const surface =
      pose.surfaceId === undefined
        ? 0
        : spec.terrain.findIndex((s) => s.id === pose.surfaceId) + 1;
    if (pose.surfaceId !== undefined && surface === 0)
      throw new Error("Data Scene spatial pose references unknown terrain.");
    values.set(
      [
        1,
        pose.x,
        pose.y,
        span === null ? 0 : 1,
        span?.floorId ?? 0,
        span?.elevation ?? 0,
        span?.height ?? 0,
        surface,
      ],
      SPATIAL_PROGRESS_CAMERA_VALUES + index * SPATIAL_PROGRESS_POSE_VALUES,
    );
  });
  return values;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function finite(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(Math.fround(value)))
    throw new Error("Data Scene spatial pose values must be finite f32.");
}
