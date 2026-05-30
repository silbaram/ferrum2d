import {
  bodyType,
  booleanValue,
  finiteNumber,
  nonNegativeNumber,
  optionalObject,
  optionalReference,
  physicsSpecError,
  positiveNumber,
  rejectUnknownKeys,
  requireName,
  requiredObject,
  stringValue,
  vector2,
} from "../physicsSpecValidation.js";
import type {
  ResolvedPhysicsBodySpec,
  ResolvedPhysicsHd2dSpec,
  ResolvedPhysicsLayerSpec,
  ResolvedPhysicsMaterialSpec,
} from "../physicsSpecTypes.js";
import { physicsCollider, physicsColliderArray } from "./colliders.js";
import { BODY_KEYS } from "./keys.js";
import { setRecordEntry } from "./records.js";

export function physicsBodies(
  value: unknown,
  path: string,
  materials: Record<string, ResolvedPhysicsMaterialSpec>,
  layers: Record<string, ResolvedPhysicsLayerSpec>,
  hd2d: ResolvedPhysicsHd2dSpec,
): Record<string, ResolvedPhysicsBodySpec> {
  const bodies = optionalObject(value, path);
  const resolved: Record<string, ResolvedPhysicsBodySpec> = {};
  for (const [id, body] of Object.entries(bodies)) {
    const bodyPath = `${path}.${id}`;
    requireName(id, bodyPath);
    const object = requiredObject(body, bodyPath);
    rejectUnknownKeys(object, bodyPath, BODY_KEYS);
    const material = optionalReference(object.material, `${bodyPath}.material`, materials);
    const layer = optionalReference(object.layer, `${bodyPath}.layer`, layers);
    if (object.collider !== undefined && object.colliders !== undefined) {
      throw physicsSpecError(`${bodyPath}.collider`, "cannot be combined with colliders");
    }
    const colliders = object.collider !== undefined
      ? [physicsCollider(object.collider, `${bodyPath}.collider`, materials, layers)]
      : physicsColliderArray(object.colliders, `${bodyPath}.colliders`, materials, layers);
    const position = vector2(object.position, `${bodyPath}.position`, { x: 0, y: 0 });
    const velocity = vector2(object.velocity, `${bodyPath}.velocity`, { x: 0, y: 0 });
    const resolvedBody: ResolvedPhysicsBodySpec = {
      id,
      type: bodyType(object.type, `${bodyPath}.type`),
      positionX: position.x,
      positionY: position.y,
      rotationRadians: finiteNumber(object.rotationRadians, `${bodyPath}.rotationRadians`, 0),
      velocityX: velocity.x,
      velocityY: velocity.y,
      angularVelocityRadiansPerSecond: finiteNumber(
        object.angularVelocityRadiansPerSecond,
        `${bodyPath}.angularVelocityRadiansPerSecond`,
        0,
      ),
      floor: physicsFloorId(object.floor, `${bodyPath}.floor`),
      elevation: finiteNumber(object.elevation, `${bodyPath}.elevation`, 0),
      height: nonNegativeNumber(
        object.height,
        `${bodyPath}.height`,
        hd2d.enabled ? hd2d.defaultHeight : 0,
      ),
      colliders,
      gravityScale: finiteNumber(object.gravityScale, `${bodyPath}.gravityScale`, 1),
      linearDamping: nonNegativeNumber(object.linearDamping, `${bodyPath}.linearDamping`, 0),
      angularDamping: nonNegativeNumber(object.angularDamping, `${bodyPath}.angularDamping`, 0),
      enabled: booleanValue(object.enabled, `${bodyPath}.enabled`, true),
      canSleep: booleanValue(object.canSleep, `${bodyPath}.canSleep`, true),
    };
    if (object.mass !== undefined) {
      resolvedBody.mass = positiveNumber(object.mass, `${bodyPath}.mass`, 1);
    }
    if (object.inertia !== undefined) {
      resolvedBody.inertia = positiveNumber(object.inertia, `${bodyPath}.inertia`, 1);
    }
    if (material !== undefined) {
      resolvedBody.material = material;
    }
    if (layer !== undefined) {
      resolvedBody.layer = layer;
    }
    setRecordEntry(resolved, id, resolvedBody);
  }
  return resolved;
}

function physicsFloorId(value: unknown, path: string): string {
  const floor = stringValue(value, path, "default");
  requireName(floor, path);
  return floor;
}
