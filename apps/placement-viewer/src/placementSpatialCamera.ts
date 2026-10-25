import type { SpatialCameraSpec } from "@ferrum2d/ferrum-web/core";

export const MIN_VIEW_PITCH = 1;
export const MAX_VIEW_PITCH = 89;
export const VIEW_PITCH_STEP = 10;

/** Degrees above the target's horizontal plane, independent of camera projection. */
export function spatialCameraPitch(camera: SpatialCameraSpec): number {
  const { position: eye, target } = camera;
  return Math.atan2(
    eye.elevation - target.elevation,
    Math.hypot(eye.x - target.x, eye.y - target.y),
  ) * 180 / Math.PI;
}

/** Orbit an editor camera without changing its target, distance, yaw or lens. */
export function tiltSpatialCamera(camera: SpatialCameraSpec, degrees: number): SpatialCameraSpec {
  const { position: eye, target } = camera,
    dx = eye.x - target.x,
    dy = eye.y - target.y,
    distance = Math.hypot(dx, dy, eye.elevation - target.elevation);
  if (!Number.isFinite(degrees) || !Number.isFinite(distance) || distance <= 0)
    throw new Error("Viewing angle requires a finite camera and angle");
  const pitch = Math.max(MIN_VIEW_PITCH, Math.min(MAX_VIEW_PITCH, degrees)) * Math.PI / 180,
    yaw = Math.atan2(dy, dx),
    horizontal = distance * Math.cos(pitch);
  return {
    ...camera,
    target: { ...target },
    position: {
      x: target.x + horizontal * Math.cos(yaw),
      y: target.y + horizontal * Math.sin(yaw),
      elevation: target.elevation + distance * Math.sin(pitch),
    },
  };
}

/** Keep the orthographic working plane inside the editor's depth range.
 * Moving the eye along its viewing axis leaves screen X/Y, scale and yaw intact.
 * The navigation camera stays separate so repeated zoom/pan never accumulates this offset.
 */
export function spatialEditorRenderCamera(
  camera: SpatialCameraSpec,
  planeElevation: number,
): SpatialCameraSpec {
  if (camera.projection !== "orthographic") return camera;
  const { position: eye, target } = camera,
    dx = eye.x - target.x,
    dy = eye.y - target.y,
    dz = eye.elevation - target.elevation,
    distance = Math.hypot(dx, dy, dz),
    sine = dz / distance,
    height = camera.height ?? 240;
  // A horizontal view has no two-dimensional plane intersection to fit.
  if (!Number.isFinite(distance) || distance <= 0 || Math.abs(sine) < 1e-6)
    return camera;
  const near = camera.near ?? 0.1,
    far = camera.far ?? 10000,
    middle = distance + (target.elevation - planeElevation) / sine,
    halfDepth = height / 2 * Math.hypot(dx, dy) / Math.abs(dz),
    margin = Math.max(1, height * 0.05),
    offset = Math.max(0, near + margin - (middle - halfDepth)),
    renderFar = Math.max(far + offset, middle + halfDepth + offset + margin),
    ratio = 1 + offset / distance;
  return {
    ...camera,
    position: {
      x: target.x + dx * ratio,
      y: target.y + dy * ratio,
      elevation: target.elevation + dz * ratio,
    },
    target: { ...target },
    far: renderFar,
  };
}
