import type { ResolvedDataSceneObjectVisual } from "./dataSceneComponents.js";
import type { ScenePlacementTransform } from "./scenePlacementViewer.js";

/** World-space visual rectangle, rotated around its center (x, y). */
export interface ScenePlacementVisualGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationRadians: number;
}

/** Matches the Data Scene render quad, including sprite pivot, scale, and rotation. */
export function scenePlacementVisualGeometry(
  visual: ResolvedDataSceneObjectVisual,
  transform: ScenePlacementTransform,
): ScenePlacementVisualGeometry {
  const width = visual.bounds.width * transform.scale;
  const height = visual.bounds.height * transform.scale;
  const offsetX = visual.kind === "sprite" ? (0.5 - visual.originX) * width : 0;
  const offsetY = visual.kind === "sprite" ? (0.5 - visual.originY) * height : 0;
  const cos = Math.cos(transform.rotationRadians);
  const sin = Math.sin(transform.rotationRadians);
  return {
    x: transform.x + offsetX * cos - offsetY * sin,
    y: transform.y + offsetX * sin + offsetY * cos,
    width,
    height,
    rotationRadians: transform.rotationRadians,
  };
}
