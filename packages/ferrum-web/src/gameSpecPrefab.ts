import {
  DEFAULT_PHYSICS_MATERIAL_DENSITY,
  DEFAULT_PHYSICS_MATERIAL_FRICTION,
  DEFAULT_PHYSICS_MATERIAL_RESTITUTION,
  DEFAULT_PHYSICS_MATERIAL_SCALE,
} from "./gameSpecDefaults.js";
import {
  booleanValue,
  finiteNumber,
  gameSpecError,
  nonNegativeNumber,
  optionalObject,
  positiveNumber,
  requiredFiniteNumber,
  requiredPositiveNumber,
} from "./gameSpecValidation.js";
import type {
  ResolvedShooterPhysicsMaterial,
  ResolvedShooterPrefabCollider,
  ResolvedShooterPrefabColliderVertex,
  ShooterPrefabColliderType,
} from "./gameSpecTypes.js";

export function prefabCollider(
  value: unknown,
  path: string,
  prefabWidth: number,
  prefabHeight: number,
): ResolvedShooterPrefabCollider {
  const collider = optionalObject(value, path);
  const type = prefabColliderType(collider.type, `${path}.type`);
  const offset = optionalObject(collider.offset, `${path}.offset`);
  const material = physicsMaterial(collider.material, `${path}.material`);
  const base = {
    type,
    offsetX: finiteNumber(offset.x, `${path}.offset.x`, 0),
    offsetY: finiteNumber(offset.y, `${path}.offset.y`, 0),
    enabled: booleanValue(collider.enabled, `${path}.enabled`, true),
    trigger: booleanValue(collider.trigger, `${path}.trigger`, true),
    ...(material ? { material } : {}),
  };
  switch (type) {
    case "aabb":
      return {
        ...base,
        type,
        halfWidth: positiveNumber(collider.halfWidth, `${path}.halfWidth`, prefabWidth * 0.5),
        halfHeight: positiveNumber(collider.halfHeight, `${path}.halfHeight`, prefabHeight * 0.5),
      };
    case "circle":
      return {
        ...base,
        type,
        radius: positiveNumber(collider.radius, `${path}.radius`, Math.min(prefabWidth, prefabHeight) * 0.5),
      };
    case "capsule": {
      const start = optionalObject(collider.start, `${path}.start`);
      const end = optionalObject(collider.end, `${path}.end`);
      return {
        ...base,
        type,
        startX: requiredFiniteNumber(start.x, `${path}.start.x`),
        startY: requiredFiniteNumber(start.y, `${path}.start.y`),
        endX: requiredFiniteNumber(end.x, `${path}.end.x`),
        endY: requiredFiniteNumber(end.y, `${path}.end.y`),
        radius: requiredPositiveNumber(collider.radius, `${path}.radius`),
      };
    }
    case "orientedBox":
      return {
        ...base,
        type,
        halfWidth: positiveNumber(collider.halfWidth, `${path}.halfWidth`, prefabWidth * 0.5),
        halfHeight: positiveNumber(collider.halfHeight, `${path}.halfHeight`, prefabHeight * 0.5),
        rotationRadians: finiteNumber(collider.rotationRadians, `${path}.rotationRadians`, 0),
      };
    case "convexPolygon":
      return {
        ...base,
        type,
        vertices: prefabColliderVertices(collider.vertices, `${path}.vertices`),
        rotationRadians: finiteNumber(collider.rotationRadians, `${path}.rotationRadians`, 0),
      };
  }
}

function prefabColliderType(value: unknown, path: string): ShooterPrefabColliderType {
  if (value === undefined) {
    return "aabb";
  }
  if (
    value === "aabb"
    || value === "circle"
    || value === "capsule"
    || value === "orientedBox"
    || value === "convexPolygon"
  ) {
    return value;
  }
  throw gameSpecError(path, "must be a supported collider type");
}

function prefabColliderVertices(value: unknown, path: string): ResolvedShooterPrefabColliderVertex[] {
  if (!Array.isArray(value)) {
    throw gameSpecError(path, "must be an array of 3 to 16 vertices");
  }
  if (value.length < 3 || value.length > 16) {
    throw gameSpecError(path, "must contain 3 to 16 vertices");
  }
  return value.map((entry, index) => {
    const vertex = optionalObject(entry, `${path}.${index}`);
    return {
      x: requiredFiniteNumber(vertex.x, `${path}.${index}.x`),
      y: requiredFiniteNumber(vertex.y, `${path}.${index}.y`),
    };
  });
}

function physicsMaterial(
  value: unknown,
  path: string,
): ResolvedShooterPhysicsMaterial | undefined {
  if (value === undefined) {
    return undefined;
  }
  const material = optionalObject(value, path);
  const surfaceVelocity = optionalObject(material.surfaceVelocity, `${path}.surfaceVelocity`);
  return {
    restitution: nonNegativeNumber(
      material.restitution,
      `${path}.restitution`,
      DEFAULT_PHYSICS_MATERIAL_RESTITUTION,
    ),
    friction: nonNegativeNumber(
      material.friction,
      `${path}.friction`,
      DEFAULT_PHYSICS_MATERIAL_FRICTION,
    ),
    surfaceVelocityX: finiteNumber(surfaceVelocity.x, `${path}.surfaceVelocity.x`, 0),
    surfaceVelocityY: finiteNumber(surfaceVelocity.y, `${path}.surfaceVelocity.y`, 0),
    density: positiveNumber(
      material.density,
      `${path}.density`,
      DEFAULT_PHYSICS_MATERIAL_DENSITY,
    ),
    contactBaumgarteBiasScale: nonNegativeNumber(
      material.contactBaumgarteBiasScale,
      `${path}.contactBaumgarteBiasScale`,
      DEFAULT_PHYSICS_MATERIAL_SCALE,
    ),
    maxContactBaumgarteBiasVelocityScale: nonNegativeNumber(
      material.maxContactBaumgarteBiasVelocityScale,
      `${path}.maxContactBaumgarteBiasVelocityScale`,
      DEFAULT_PHYSICS_MATERIAL_SCALE,
    ),
    contactPositionCorrectionScale: nonNegativeNumber(
      material.contactPositionCorrectionScale,
      `${path}.contactPositionCorrectionScale`,
      DEFAULT_PHYSICS_MATERIAL_SCALE,
    ),
    contactPositionCorrectionSlopScale: nonNegativeNumber(
      material.contactPositionCorrectionSlopScale,
      `${path}.contactPositionCorrectionSlopScale`,
      DEFAULT_PHYSICS_MATERIAL_SCALE,
    ),
  };
}
