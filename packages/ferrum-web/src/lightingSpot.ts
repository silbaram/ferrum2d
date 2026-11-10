import type { PointLightSpot2D, ResolvedPointLightSpot2D } from "./lightingTypes.js";

/** Cold presentation validation. This never selects a light or owns simulation state. */
export function resolvePointLightSpot(value: PointLightSpot2D, path: string, target?: ResolvedPointLightSpot2D): ResolvedPointLightSpot2D {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["directionX", "directionY", "angleDegrees", "penumbra"].includes(key)))
    throw Error(`${path} must be a cone with directionX/directionY/angleDegrees and optional penumbra`);
  const { directionX: x, directionY: y, angleDegrees } = value, penumbra = value.penumbra === undefined ? 0 : value.penumbra;
  if (![x, y].every(n => typeof n === "number" && Number.isFinite(Math.fround(n))) || Math.hypot(x, y) < 1e-6)
    throw Error(`${path}.direction must be a finite nonzero XY vector`);
  if (typeof angleDegrees !== "number" || !Number.isFinite(angleDegrees) || angleDegrees < .1 || angleDegrees > 360)
    throw Error(`${path}.angleDegrees must be in 0.1..360`);
  if (typeof penumbra !== "number" || !Number.isFinite(penumbra) || penumbra < 0 || penumbra > 1)
    throw Error(`${path}.penumbra must be in 0..1`);
  const length = Math.hypot(x, y), output = target ?? { directionX: 0, directionY: 0, angleDegrees: 0, penumbra: 0 };
  output.directionX = x / length; output.directionY = y / length;
  output.angleDegrees = angleDegrees; output.penumbra = penumbra;
  return output;
}

/** Same four private shader parameters in both backends; omitted cones use an explicit sentinel. */
export function writePointLightSpot(target: Float32Array, offset: number, spot?: ResolvedPointLightSpot2D, scaleY = 1): void {
  if (!spot || spot.angleDegrees === 360 && spot.penumbra === 0) {
    target[offset] = 0; target[offset + 1] = 0; target[offset + 2] = -2; target[offset + 3] = -2; return;
  }
  const x = spot.directionX, y = spot.directionY / scaleY, length = Math.hypot(x, y);
  target[offset] = x / length; target[offset + 1] = y / length;
  target[offset + 2] = Math.cos(spot.angleDegrees * Math.PI / 360);
  target[offset + 3] = Math.cos(spot.angleDegrees * (1 - spot.penumbra) * Math.PI / 360);
}
