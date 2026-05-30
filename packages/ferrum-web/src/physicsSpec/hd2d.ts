import {
  booleanValue,
  nonNegativeNumber,
  optionalObject,
  rejectUnknownKeys,
} from "../physicsSpecValidation.js";
import type { ResolvedPhysicsHd2dSpec } from "../physicsSpecTypes.js";
import { HD2D_KEYS } from "./keys.js";

export const DEFAULT_HD2D: ResolvedPhysicsHd2dSpec = Object.freeze({
  enabled: false,
  defaultHeight: 0,
  maxStepHeight: 0,
  maxDropHeight: 0,
});

export function physicsHd2dSpec(value: unknown, path: string): ResolvedPhysicsHd2dSpec {
  const hd2d = optionalObject(value, path);
  rejectUnknownKeys(hd2d, path, HD2D_KEYS);
  return {
    enabled: booleanValue(hd2d.enabled, `${path}.enabled`, DEFAULT_HD2D.enabled),
    defaultHeight: nonNegativeNumber(
      hd2d.defaultHeight,
      `${path}.defaultHeight`,
      DEFAULT_HD2D.defaultHeight,
    ),
    maxStepHeight: nonNegativeNumber(
      hd2d.maxStepHeight,
      `${path}.maxStepHeight`,
      DEFAULT_HD2D.maxStepHeight,
    ),
    maxDropHeight: nonNegativeNumber(
      hd2d.maxDropHeight,
      `${path}.maxDropHeight`,
      DEFAULT_HD2D.maxDropHeight,
    ),
  };
}
