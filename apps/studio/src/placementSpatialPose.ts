import type { SpatialPoint } from "@ferrum2d/ferrum-web/core";
import type { ScenePlacementViewerState, ScenePlacementViewerInstance, SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";

/** Authored visual anchor height; the physical center may differ by renderOffset. */
export function placementBodyElevation(instance: Pick<ScenePlacementViewerInstance, "body"> | undefined): number | undefined {
  const body = instance?.body;
  return body && body.type === undefined ? body.elevation ?? 0 : body?.heightSpan?.elevation;
}

/** Authored body pose shared by object and light overlays; never runtime simulation. */
export function placementSpatialPose(
  state: ScenePlacementViewerState,
  id: string,
  seen = new Set<string>(),
): SpatialPoint & { yaw: number } {
  if (seen.has(id)) throw new Error("Attachment cycle");
  seen.add(id);
  const instance = state.instances.find(item => item.instanceId === id);
  if (!instance) throw new Error("Unknown spatial instance");
  const attachment = state.spatial?.attachments?.[id];
  if (!attachment) return {
    x: instance.transform.x,
    y: instance.transform.y,
    elevation: placementBodyElevation(instance) ?? 0,
    // Sprite/model local rotation does not rotate the native root body.
    yaw: 0,
  };
  const parent = placementSpatialPose(state, attachment.parent, seen);
  const cos = Math.cos(parent.yaw), sin = Math.sin(parent.yaw);
  return {
    x: parent.x + (attachment.x ?? 0) * cos - (attachment.y ?? 0) * sin,
    y: parent.y + (attachment.x ?? 0) * sin + (attachment.y ?? 0) * cos,
    elevation: parent.elevation + (attachment.elevation ?? 0),
    yaw: parent.yaw + (attachment.yawDegrees ?? 0) * Math.PI / 180,
  };
}

type PhysicsSpace = Pick<NonNullable<SceneAuthoringDocumentSpec["physics"]>, "space">;

/** Initial JSON model pose only; this never observes or predicts the runtime pose. */
export function placementSpatialModelPose(state: ScenePlacementViewerState, id: string, physics?: PhysicsSpace): {
  source: "authoring";
  matrix: readonly number[];
} {
  const instance = state.instances.find(item => item.instanceId === id), model = state.spatial?.models?.[id];
  if (!instance || !model) throw new Error("Unknown spatial model");
  const base = placementSpatialPose(state, id), body = instance.body;
  const localYaw = (model.yawDegrees ?? 0) * Math.PI / 180;
  let x = 0, y = Math.sin((base.yaw + localYaw) / 2), z = 0, w = Math.cos((base.yaw + localYaw) / 2);
  if (physics?.space === "spatial" && body && body.type === undefined && !state.spatial?.attachments?.[id]) {
    const q = body.rotation ?? [0, 0, 0, 1];
    const half = instance.transform.rotationRadians / 2, sn = Math.sin(half), cs = Math.cos(half);
    // The authored body's placement-Y rotation precedes its local quaternion.
    const bx = cs * q[0] + sn * q[2], by = cs * q[1] + sn * q[3],
      bz = cs * q[2] - sn * q[0], bw = cs * q[3] - sn * q[1];
    const ls = Math.sin(localYaw / 2), lc = Math.cos(localYaw / 2);
    // Model-local yaw follows the body orientation; placement must not apply twice.
    x = bx * lc - bz * ls; y = by * lc + bw * ls;
    z = bz * lc + bx * ls; w = bw * lc - by * ls;
  }
  const factor = 2 / (x * x + y * y + z * z + w * w), scale = model.scale ?? 1;
  // Both offsets are world-space. The authored body center subtracts renderOffset
  // and native presentation adds it back, so this initial anchor never adds it again.
  return { source: "authoring", matrix: [
    (1 - factor * (y * y + z * z)) * scale, factor * (x * y + z * w) * scale, factor * (x * z - y * w) * scale, 0,
    factor * (x * y - z * w) * scale, (1 - factor * (x * x + z * z)) * scale, factor * (y * z + x * w) * scale, 0,
    factor * (x * z + y * w) * scale, factor * (y * z - x * w) * scale, (1 - factor * (x * x + y * y)) * scale, 0,
    base.x, base.elevation + (model.elevation ?? 0), -base.y, 1,
  ] };
}

/** The eight authored local AABB corners in SpatialPoint coordinates (Y-up → elevation). */
export function placementSpatialModelBounds(state: ScenePlacementViewerState, id: string, bounds: readonly number[], physics?: PhysicsSpace): SpatialPoint[] {
  const { matrix: m } = placementSpatialModelPose(state, id, physics), points: SpatialPoint[] = [];
  for (const x of [bounds[0], bounds[3]])
    for (const y of [bounds[1], bounds[4]])
      for (const z of [bounds[2], bounds[5]])
        points.push({
          x: m[0] * x + m[4] * y + m[8] * z + m[12],
          elevation: m[1] * x + m[5] * y + m[9] * z + m[13],
          y: -(m[2] * x + m[6] * y + m[10] * z + m[14]),
        });
  return points;
}

/** Light offsets use world axes, with the target's body and visual elevation. */
export function placementLightAnchor(state: ScenePlacementViewerState, id?: string): SpatialPoint {
  if (!id) return { x: 0, y: 0, elevation: 0 };
  const pose = placementSpatialPose(state, id);
  return {
    x: pose.x,
    y: pose.y,
    elevation: pose.elevation + (state.spatial?.models?.[id]?.elevation ?? state.spatial?.billboards[id]?.elevation ?? 0),
  };
}
