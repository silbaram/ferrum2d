// Native HD-2D elevator and translating bridge; WASD boards/leaves a support.
// The spatial demo's existing checkpoint controls save platform phase and rider poses.
import { startSpatialScene } from "./spatial.mjs";
export function startMovingPlatformScene(canvas) {
  return startSpatialScene(canvas, { movingPlatforms: true });
}
