import type { SpatialPoint } from "@ferrum2d/ferrum-web/core";
import type { ScenePlacementViewerState } from "@ferrum2d/ferrum-web/authoring";

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
    elevation: instance.body?.heightSpan?.elevation ?? 0,
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
