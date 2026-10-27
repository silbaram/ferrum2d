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
  if (!Number.isFinite(degrees))
    throw new Error("Viewing angle requires a finite camera and angle");
  return orbitSpatialCameraPitch(camera, Math.max(MIN_VIEW_PITCH, Math.min(MAX_VIEW_PITCH, degrees)));
}

/** Authored cameras also support horizontal views and views from below the target. */
export function orbitSpatialCameraPitch(camera: SpatialCameraSpec, degrees: number): SpatialCameraSpec {
  const { position: eye, target } = camera,
    dx = eye.x - target.x,
    dy = eye.y - target.y,
    distance = Math.hypot(dx, dy, eye.elevation - target.elevation);
  if (!Number.isFinite(degrees) || !Number.isFinite(distance) || distance <= 0)
    throw new Error("Viewing angle requires a finite camera and angle");
  if (degrees <= -90 || degrees >= 90)
    throw new Error("Enter a valid camera value");
  const pitch = degrees * Math.PI / 180,
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

/** Direct manipulation in the camera's screen plane, in CSS pixels. */
export function panSpatialCamera(camera: SpatialCameraSpec, dx: number, dy: number, viewHeight: number): SpatialCameraSpec {
  const eye = camera.position, target = camera.target,
    x = target.x - eye.x, y = target.y - eye.y, z = target.elevation - eye.elevation,
    distance = Math.hypot(x, y, z), horizontal = Math.hypot(x, y);
  if (![dx, dy, viewHeight, distance, horizontal].every(Number.isFinite) || viewHeight <= 0 || distance <= 0 || horizontal <= 0)
    throw new Error("Enter a valid camera value");
  const rx = y / horizontal, ry = -x / horizontal,
    units = (camera.projection === "orthographic" ? camera.height! : 2 * distance * Math.tan(camera.fovDegrees! * Math.PI / 360)) / viewHeight,
    delta = { x: (-dx * rx + dy * ry * z / distance) * units,
      y: (-dx * ry - dy * rx * z / distance) * units,
      elevation: dy * (rx * y - ry * x) / distance * units };
  const translate = (point: SpatialCameraSpec["position"]) => ({ x: point.x + delta.x, y: point.y + delta.y, elevation: point.elevation + delta.elevation });
  return { ...camera, position: translate(eye), target: translate(target) };
}

export function orbitSpatialCamera(camera: SpatialCameraSpec, dx: number, dy: number): SpatialCameraSpec {
  if (![dx, dy].every(Number.isFinite)) throw new Error("Enter a valid camera value");
  const next = orbitSpatialCameraPitch(camera, Math.max(-89.9, Math.min(89.9, spatialCameraPitch(camera) - dy * 0.3))),
    x = next.position.x - next.target.x, y = next.position.y - next.target.y,
    angle = dx * 0.3 * Math.PI / 180;
  next.position.x = next.target.x + x * Math.cos(angle) - y * Math.sin(angle);
  next.position.y = next.target.y + x * Math.sin(angle) + y * Math.cos(angle);
  return next;
}

export function zoomSpatialCamera(camera: SpatialCameraSpec, factor: number): SpatialCameraSpec {
  if (!Number.isFinite(factor) || factor <= 0) throw new Error("Enter a valid camera value");
  if (camera.projection === "orthographic") return { ...camera, target: { ...camera.target }, position: { ...camera.position }, height: camera.height! * factor };
  return { ...camera, target: { ...camera.target }, position: {
    x: camera.target.x + (camera.position.x - camera.target.x) * factor,
    y: camera.target.y + (camera.position.y - camera.target.y) * factor,
    elevation: camera.target.elevation + (camera.position.elevation - camera.target.elevation) * factor,
  } };
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
