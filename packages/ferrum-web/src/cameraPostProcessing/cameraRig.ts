import type {
  CameraBounds,
  CameraDeadZone,
  CameraPoint,
  CameraRigSnapshot,
  CameraRigSpec,
  CameraRigStepOptions,
  CameraViewport,
  ResolvedCameraBounds,
  ResolvedCameraDeadZone,
  ResolvedCameraRigSpec,
  ResolveCameraRigOptions,
} from "./types.js";
import {
  clamp,
  finiteNumber,
  invalid,
  isRecord,
  lerp,
  nonNegativeFinite,
  nonNegativeNumber,
} from "./validation.js";

const DEFAULT_CAMERA_RIG: ResolvedCameraRigSpec = {
  x: 0,
  y: 0,
  deadZone: { width: 0, height: 0 },
  smoothTimeSeconds: 0,
};

export function resolveCameraRigSpec(
  spec: CameraRigSpec = {},
  options: ResolveCameraRigOptions = {},
): ResolvedCameraRigSpec {
  const path = options.path ?? "cameraRig";
  if (!isRecord(spec)) {
    throw invalid(path, "must be an object");
  }
  const input = spec as CameraRigSpec;

  const deadZone = input.deadZone === undefined
    ? { ...DEFAULT_CAMERA_RIG.deadZone }
    : resolveDeadZone(input.deadZone, `${path}.deadZone`);
  const resolved: ResolvedCameraRigSpec = {
    x: finiteNumber(input.x, `${path}.x`, DEFAULT_CAMERA_RIG.x),
    y: finiteNumber(input.y, `${path}.y`, DEFAULT_CAMERA_RIG.y),
    deadZone,
    smoothTimeSeconds: nonNegativeNumber(
      input.smoothTimeSeconds,
      `${path}.smoothTimeSeconds`,
      DEFAULT_CAMERA_RIG.smoothTimeSeconds,
    ),
  };

  if (input.bounds !== undefined) {
    resolved.bounds = resolveBounds(input.bounds, `${path}.bounds`);
  }

  return resolved;
}

export function clampCameraToBounds(
  point: CameraPoint,
  bounds: ResolvedCameraBounds | undefined,
  viewport?: CameraViewport,
): CameraPoint {
  return clampCameraAxes(point.x, point.y, bounds, viewport);
}

export class CameraRigController {
  private readonly spec: ResolvedCameraRigSpec;
  private current: CameraRigSnapshot;

  constructor(spec: CameraRigSpec = {}) {
    this.spec = resolveCameraRigSpec(spec);
    this.current = {
      x: this.spec.x,
      y: this.spec.y,
      targetX: this.spec.x,
      targetY: this.spec.y,
      desiredX: this.spec.x,
      desiredY: this.spec.y,
    };
  }

  static create(spec: CameraRigSpec = {}): CameraRigController {
    return new CameraRigController(spec);
  }

  step(target: CameraPoint, deltaSeconds: number, options: CameraRigStepOptions = {}): CameraRigSnapshot {
    const targetX = finiteNumber(target.x, "camera target.x", this.current.targetX);
    const targetY = finiteNumber(target.y, "camera target.y", this.current.targetY);
    const delta = nonNegativeFinite(deltaSeconds, "camera deltaSeconds");
    const desiredX = desiredAxisForDeadZone(this.current.x, targetX, this.spec.deadZone.width);
    const desiredY = desiredAxisForDeadZone(this.current.y, targetY, this.spec.deadZone.height);
    const desired = clampCameraAxes(desiredX, desiredY, this.spec.bounds, options.viewport);
    const blend = this.spec.smoothTimeSeconds <= 0
      ? 1
      : 1 - Math.exp(-delta / this.spec.smoothTimeSeconds);
    const next = clampCameraAxes(
      lerp(this.current.x, desired.x, blend),
      lerp(this.current.y, desired.y, blend),
      this.spec.bounds,
      options.viewport,
    );

    this.current = {
      x: next.x,
      y: next.y,
      targetX,
      targetY,
      desiredX: desired.x,
      desiredY: desired.y,
    };
    return this.snapshot();
  }

  setPosition(point: CameraPoint): CameraRigSnapshot {
    const next = clampCameraAxes(
      finiteNumber(point.x, "camera position.x", this.current.x),
      finiteNumber(point.y, "camera position.y", this.current.y),
      this.spec.bounds,
    );
    this.current = {
      x: next.x,
      y: next.y,
      targetX: this.current.targetX,
      targetY: this.current.targetY,
      desiredX: next.x,
      desiredY: next.y,
    };
    return this.snapshot();
  }

  snapshot(): CameraRigSnapshot {
    return {
      x: this.current.x,
      y: this.current.y,
      targetX: this.current.targetX,
      targetY: this.current.targetY,
      desiredX: this.current.desiredX,
      desiredY: this.current.desiredY,
    };
  }
}

function resolveBounds(bounds: CameraBounds, path: string): ResolvedCameraBounds {
  if (!isRecord(bounds)) {
    throw invalid(path, "must be an object");
  }
  const input = bounds as CameraBounds;
  const resolved = {
    minX: finiteNumber(input.minX, `${path}.minX`),
    minY: finiteNumber(input.minY, `${path}.minY`),
    maxX: finiteNumber(input.maxX, `${path}.maxX`),
    maxY: finiteNumber(input.maxY, `${path}.maxY`),
  };
  if (resolved.minX > resolved.maxX) {
    throw invalid(path, "minX must be less than or equal to maxX");
  }
  if (resolved.minY > resolved.maxY) {
    throw invalid(path, "minY must be less than or equal to maxY");
  }
  return resolved;
}

function resolveDeadZone(deadZone: CameraDeadZone, path: string): ResolvedCameraDeadZone {
  if (!isRecord(deadZone)) {
    throw invalid(path, "must be an object");
  }
  const input = deadZone as CameraDeadZone;
  return {
    width: nonNegativeNumber(input.width, `${path}.width`, 0),
    height: nonNegativeNumber(input.height, `${path}.height`, 0),
  };
}

function desiredAxisForDeadZone(current: number, target: number, size: number): number {
  if (size <= 0) {
    return target;
  }
  const half = size * 0.5;
  if (target < current - half) {
    return target + half;
  }
  if (target > current + half) {
    return target - half;
  }
  return current;
}

function clampCameraAxes(
  x: number,
  y: number,
  bounds: ResolvedCameraBounds | undefined,
  viewport?: CameraViewport,
): CameraPoint {
  if (bounds === undefined) {
    return { x, y };
  }
  if (viewport === undefined) {
    return {
      x: clamp(x, bounds.minX, bounds.maxX),
      y: clamp(y, bounds.minY, bounds.maxY),
    };
  }

  const width = nonNegativeFinite(viewport.width, "camera viewport.width");
  const height = nonNegativeFinite(viewport.height, "camera viewport.height");
  return {
    x: clampViewportAxis(x, bounds.minX, bounds.maxX, width),
    y: clampViewportAxis(y, bounds.minY, bounds.maxY, height),
  };
}

function clampViewportAxis(point: number, min: number, max: number, viewportSize: number): number {
  const halfViewport = viewportSize * 0.5;
  const minCenter = min + halfViewport;
  const maxCenter = max - halfViewport;
  if (minCenter > maxCenter) {
    return (min + max) * 0.5;
  }
  return clamp(point, minCenter, maxCenter);
}
