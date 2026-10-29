import type { SpatialCameraSpec, SpatialPoint } from "@ferrum2d/ferrum-web/core";

/** Platform-only authoring projection basis, in engine X/Y/elevation coordinates. */
export function spatialCameraBasis(camera: SpatialCameraSpec) {
  const x = camera.target.x - camera.position.x, y = camera.target.y - camera.position.y,
    z = camera.target.elevation - camera.position.elevation, distance = Math.hypot(x, y, z), horizontal = Math.hypot(x, y);
  if (!Number.isFinite(distance) || distance <= 0) throw new Error("Enter a valid camera value");
  const forward = [x / distance, y / distance, z / distance],
    right = horizontal > 1e-8 ? [y / horizontal, -x / horizontal, 0] : [1, 0, 0],
    up = [right[1] * forward[2], -right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  return { forward, right, up, distance };
}

export function spatialCameraRay(camera: SpatialCameraSpec, x: number, y: number, width: number, height: number) {
  const { forward, right, up } = spatialCameraBasis(camera), u = x / width * 2 - 1, v = 1 - y / height * 2,
    extent = camera.projection === "orthographic" ? (camera.height ?? 240) / 2 : Math.tan((camera.fovDegrees ?? 60) * Math.PI / 360),
    offset = right.map((r,i) => r*u*extent*width/height+up[i]*v*extent),
    origin = [camera.position.x,camera.position.y,camera.position.elevation];
  return camera.projection === "orthographic" ? { origin: origin.map((n,i)=>n+offset[i]), direction: forward }
    : { origin, direction: forward.map((n,i)=>n+offset[i]) };
}

/** Unproject the displayed native matrix, rather than a camera awaiting the next frame. World glTF XYZ. */
export function spatialFrameRay(m: Float32Array, x: number, y: number, width: number, height: number) {
  // Native camera views contain the 16 matrix entries followed by 12 lens parameters.
  if (m.length < 16 || !m.subarray(0,16).every(Number.isFinite) || ![x,y,width,height].every(Number.isFinite) || width<=0 || height<=0) return;
  const u=x/width*2-1,v=1-y/height*2;
  if (Math.abs(u)>1 || Math.abs(v)>1) return;
  const unproject=(z: number): [number,number,number] | undefined=>{
    const rows=[u,v,z].map((n,i)=>[m[i]-n*m[3],m[i+4]-n*m[7],m[i+8]-n*m[11],n*m[15]-m[i+12]]);
    for(let column=0;column<3;column++) {
      let pivot=column;
      for(let row=column+1;row<3;row++) if(Math.abs(rows[row][column])>Math.abs(rows[pivot][column])) pivot=row;
      [rows[column],rows[pivot]]=[rows[pivot],rows[column]];
      const divisor=rows[column][column];
      if (!Number.isFinite(divisor) || divisor===0) return;
      for(let k=column;k<4;k++) rows[column][k]/=divisor;
      for(let row=0;row<3;row++) if(row!==column) {
        const factor=rows[row][column];
        for(let k=column;k<4;k++) rows[row][k]-=factor*rows[column][k];
      }
    }
    const point: [number,number,number]=[rows[0][3],rows[1][3],rows[2][3]];
    return point.every(Number.isFinite) ? point : undefined;
  };
  const origin=unproject(-1),end=unproject(1);
  if(!origin || !end) return;
  const delta=end.map((n,i)=>n-origin[i]),far=Math.hypot(...delta);
  if (!Number.isFinite(far) || far<=0) return;
  const direction: [number,number,number]=[delta[0]/far,delta[1]/far,delta[2]/far];
  return {origin,direction,far};
}

/** Fit actual projected corners rather than a fixed authored lens or an oversized sphere. */
export function fitSpatialCamera(camera: SpatialCameraSpec, points: readonly SpatialPoint[], aspect: number): SpatialCameraSpec {
  if (!points.length || !Number.isFinite(aspect) || aspect <= 0) return camera;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (const [i, value] of [p.x, p.y, p.elevation].entries()) {
    if (!Number.isFinite(value)) throw new Error("Invalid camera bounds");
    min[i] = Math.min(min[i], value); max[i] = Math.max(max[i], value);
  }
  const center = min.map((v, i) => (v + max[i]) / 2), { right, up, forward, distance: originalDistance } = spatialCameraBasis(camera),
    dot = (p: SpatialPoint, axis: number[]) => (p.x - center[0]) * axis[0] + (p.y - center[1]) * axis[1] + (p.elevation - center[2]) * axis[2],
    tangent = Math.tan((camera.fovDegrees ?? 60) * Math.PI / 360), padding = 1.16;
  // Perspective fitting must also move closer after a wider resize or manual zoom out.
  // Orthographic scale is controlled by height, so its eye distance can stay intact.
  let extent = 1, distance = camera.projection === "perspective" ? 0 : originalDistance, maxDepth = -Infinity;
  for (const p of points) {
    const depth = dot(p, forward), size = Math.max(Math.abs(dot(p, up)), Math.abs(dot(p, right)) / aspect) * padding;
    extent = Math.max(extent, size); maxDepth = Math.max(maxDepth, depth);
    distance = Math.max(distance, (camera.near ?? 0.1) + 1 - depth);
    if (camera.projection === "perspective") distance = Math.max(distance, size / tangent - depth, (camera.near ?? 0.1) + 1 - depth);
  }
  return { ...camera, target: { x: center[0], y: center[1], elevation: center[2] },
    position: { x: center[0] - forward[0] * distance, y: center[1] - forward[1] * distance, elevation: center[2] - forward[2] * distance },
    ...(camera.projection === "orthographic" ? { height: extent * 2 } : {}),
    far: Math.max(camera.far ?? 10000, distance + maxDepth + 1) };
}

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
