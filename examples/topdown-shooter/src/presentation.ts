import type { WebGL2Renderer } from "@ferrum2d/ferrum-web/core";

/** Static arena lamps in world coordinates; projection only, no simulated entity state. */
const lamps = [
  { x: 240, y: 240, color: [0.2, 0.85, 0.9] as const },
  { x: 800, y: 400, color: [0.3, 0.8, 0.72] as const },
  { x: 1360, y: 720, color: [1, 0.55, 0.25] as const },
];

export function applyOutpostLighting(
  renderer: WebGL2Renderer,
  enabled: boolean,
  cameraX: number,
  cameraY: number,
  offset: { x: number; y: number },
): void {
  const viewport = renderer.viewportSize();
  renderer.setLighting(enabled ? {
    ambient: [0.015, 0.025, 0.045, 0.2],
    pointLights: lamps.map(lamp => ({
      x: lamp.x - cameraX + viewport.width / 2 + offset.x,
      y: lamp.y - cameraY + viewport.height / 2 + offset.y,
      radius: 300,
      color: lamp.color,
      intensity: 0.12,
    })),
  } : { enabled: false });
}
