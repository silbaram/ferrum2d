import type {
  FerrumEngine,
  PhysicsEntityHandle,
  PhysicsRigidBodySpawnOptions,
} from "./engineTypes.js";
export { createJoint } from "./physicsAuthoringJoints.js";
import { createVehicleRigWithBodyFactory } from "./physicsAuthoringVehicle.js";
import { createCollider } from "./physicsAuthoringColliders.js";
export { createCollider, resolvedPhysicsColliderRuntimeCount } from "./physicsAuthoringColliders.js";
import { authoringCollisionLayer } from "./physicsAuthoringLayers.js";
export {
  createPhysicsLayerMap,
  createPhysicsLayerSpec,
  physicsLayerMaskBits,
} from "./physicsAuthoringLayers.js";
import { physicsMaterial } from "./physicsAuthoringMaterial.js";
export { physicsMaterial } from "./physicsAuthoringMaterial.js";
export {
  PHYSICS_BUILTIN_COLLISION_LAYERS,
  PHYSICS_COMMON_LAYER_PATTERN,
  PHYSICS_MATERIAL_PRESETS,
} from "./physicsAuthoringPresets.js";
import {
  setBodyMassProperties,
  spawnBody,
} from "./physicsAuthoringRuntime.js";
export {
  clearPhysicsWorld,
  createPhysicsWorldFromSpec,
} from "./physicsAuthoringWorld.js";
import type {
  PhysicsAuthoringContext,
  PhysicsRigidBodyAuthoringOptions,
  PhysicsVehicleRigAuthoringOptions,
  PhysicsVehicleRigResult,
} from "./physicsAuthoringTypes.js";
export type {
  PhysicsAuthoringContext,
  PhysicsAuthoringJointHandle,
  PhysicsAuthoringLayer,
  PhysicsColliderAuthoringOptions,
  PhysicsJointAuthoringOptions,
  PhysicsJointEndpoint,
  PhysicsLayerMapOptions,
  PhysicsLayerPattern,
  PhysicsLayerPatternEntry,
  PhysicsMaterialAuthoringInput,
  PhysicsMaterialPresetName,
  PhysicsRigidBodyAuthoringOptions,
  PhysicsVehicleRigAuthoringOptions,
  PhysicsVehicleRigResult,
  PhysicsVehicleWheelAuthoringOptions,
  PhysicsWorldApplyOptions,
  PhysicsWorldApplyResult,
  PhysicsWorldApplyWarning,
} from "./physicsAuthoringTypes.js";
import {
  finiteNumber,
  nonNegativeNumber,
  nonNegativeInteger,
  positiveNumber,
  vector2,
} from "./physicsAuthoringValidation.js";

export function createRigidBody(
  engine: FerrumEngine,
  options: PhysicsRigidBodyAuthoringOptions,
  context: PhysicsAuthoringContext = {},
): PhysicsEntityHandle {
  const path = context.path ?? "physics.body";
  const position = vector2(options.position, `${path}.position`, { x: 0, y: 0 });
  const velocity = vector2(options.velocity, `${path}.velocity`, { x: 0, y: 0 });
  const collider = createCollider(options.collider, { path: `${path}.collider` });
  const layer = authoringCollisionLayer(options.layer, options.categoryBits, options.maskBits, `${path}.layer`);
  const spawnOptions: PhysicsRigidBodySpawnOptions = {
    x: position.x,
    y: position.y,
    bodyType: options.type ?? "dynamic",
    collider,
    ...(layer ? { layer } : {}),
    ...(options.categoryBits === undefined ? {} : { categoryBits: nonNegativeInteger(options.categoryBits, `${path}.categoryBits`) }),
    ...(options.maskBits === undefined ? {} : { maskBits: nonNegativeInteger(options.maskBits, `${path}.maskBits`) }),
    ...(options.mass === undefined ? {} : { mass: positiveNumber(options.mass, `${path}.mass`) }),
    ...(options.density === undefined ? {} : { density: positiveNumber(options.density, `${path}.density`) }),
    ...(options.enabled === undefined ? {} : { bodyEnabled: options.enabled }),
    ...(options.colliderEnabled === undefined ? {} : { colliderEnabled: options.colliderEnabled }),
    ...(options.trigger === undefined ? {} : { isTrigger: options.trigger }),
    ...(options.canSleep === undefined ? {} : { canSleep: options.canSleep }),
    ...(options.rotationRadians === undefined ? {} : { rotationRadians: finiteNumber(options.rotationRadians, `${path}.rotationRadians`) }),
    ...(options.angularVelocityRadiansPerSecond === undefined
      ? {}
      : {
          angularVelocityRadiansPerSecond: finiteNumber(
            options.angularVelocityRadiansPerSecond,
            `${path}.angularVelocityRadiansPerSecond`,
          ),
        }),
    ...(options.gravityScale === undefined ? {} : { gravityScale: finiteNumber(options.gravityScale, `${path}.gravityScale`) }),
    ...(options.linearDamping === undefined ? {} : { linearDamping: nonNegativeNumber(options.linearDamping, `${path}.linearDamping`) }),
    ...(options.angularDamping === undefined ? {} : { angularDamping: nonNegativeNumber(options.angularDamping, `${path}.angularDamping`) }),
    ...(velocity.x === 0 ? {} : { velocityX: velocity.x }),
    ...(velocity.y === 0 ? {} : { velocityY: velocity.y }),
    ...(options.material === undefined ? {} : { material: physicsMaterial(options.material, undefined, `${path}.material`) }),
    ...(options.colliderMaterial === undefined
      ? {}
      : { colliderMaterial: physicsMaterial(options.colliderMaterial, undefined, `${path}.colliderMaterial`) }),
  };
  const handle = spawnBody(engine, spawnOptions, path);
  try {
    if (options.inertia !== undefined) {
      setBodyMassProperties(engine, handle, {
        mass: positiveNumber(options.mass ?? options.density ?? 1, `${path}.mass`),
        inertia: positiveNumber(options.inertia, `${path}.inertia`),
      }, `${path}.inertia`);
    }
  } catch (error) {
    engine.despawnPhysicsEntity(handle);
    throw error;
  }
  return handle;
}

export function createVehicleRig(
  engine: FerrumEngine,
  options: PhysicsVehicleRigAuthoringOptions,
  context: PhysicsAuthoringContext = {},
): PhysicsVehicleRigResult {
  return createVehicleRigWithBodyFactory(engine, options, context, createRigidBody);
}
