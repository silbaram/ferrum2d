import type { Engine } from "../pkg/ferrum_core";
import { finiteNumber, uint32Number } from "./particlePreset";
import { nonNegativeNumber, positiveNumber } from "./physicsAuthoringNumbers.js";
import {
  setPhysicsBodyMaterialValues,
  setPhysicsColliderMaterialValues,
  setPhysicsCompoundColliderMaterialValues,
} from "./physicsBodyMaterials.js";
import { physicsEntityHandle, physicsEntityHandleBuffer } from "./physicsHandles.js";
import {
  addPhysicsBodyColliderToRigidBody,
  spawnPhysicsRigidBody,
} from "./physicsBodySpawning.js";
import {
  decodePhysicsBodyStateBuffer,
  PHYSICS_BODY_STATE_BUFFER_FORMAT,
  PHYSICS_BODY_STATE_BUFFER_VERSION,
  validatePhysicsBodyStateBufferSnapshot,
} from "./physicsBodyStateBuffer.js";
import type { PhysicsBodyStateBufferSnapshot } from "./physicsBodyStateBuffer.js";
import {
  readPhysicsBodyColliderSnapshot,
  readPhysicsEntitySnapshot,
} from "./physicsBodySnapshots.js";
import type { WasmBridge } from "./wasmBridge";
import type {
  FerrumPhysicsBodyApi,
  PhysicsBodyColliderOptions,
  PhysicsBodyColliderSnapshot,
  PhysicsEntityHandle,
  PhysicsEntitySnapshot,
  PhysicsRigidBodyMassProperties,
  PhysicsRigidBodyMaterial,
  PhysicsRigidBodySpawnOptions,
  PhysicsRigidBodyTuning,
} from "./engineTypes.js";

export interface PhysicsBodyApiContext {
  rustEngine: Engine;
  bridge: WasmBridge;
  requireAlive(): void;
}

export function createPhysicsBodyApi({
  rustEngine,
  bridge,
  requireAlive,
}: PhysicsBodyApiContext): FerrumPhysicsBodyApi {
  const spawnRigidBody = (options: PhysicsRigidBodySpawnOptions): PhysicsEntityHandle => {
    requireAlive();
    return spawnPhysicsRigidBody(rustEngine, options);
  };

  const addPhysicsBodyCollider = (
    handle: PhysicsEntityHandle,
    options: PhysicsBodyColliderOptions,
  ): boolean => {
    requireAlive();
    return addPhysicsBodyColliderToRigidBody(rustEngine, handle, options);
  };

  const getPhysicsBodyColliderCount = (handle: PhysicsEntityHandle): number => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.physics_body_collider_count(resolved.entityId, resolved.entityGeneration);
  };

  const getPhysicsBodyCollider = (
    handle: PhysicsEntityHandle,
    colliderIndex: number,
  ): PhysicsBodyColliderSnapshot | undefined => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    if (!rustEngine.query_physics_body_collider(
      resolved.entityId,
      resolved.entityGeneration,
      uint32Number(colliderIndex, "physics collider index"),
    )) {
      return undefined;
    }
    return readPhysicsBodyColliderSnapshot(rustEngine);
  };

  const getPhysicsEntity = (handle: PhysicsEntityHandle): PhysicsEntitySnapshot | undefined => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    if (!rustEngine.query_physics_entity(resolved.entityId, resolved.entityGeneration)) {
      return undefined;
    }
    return readPhysicsEntitySnapshot(rustEngine);
  };

  const capturePhysicsBodyStateBuffer = (
    handles: readonly PhysicsEntityHandle[],
  ): PhysicsBodyStateBufferSnapshot => {
    requireAlive();
    const handleBuffer = physicsEntityHandleBuffer(handles);
    if (!rustEngine.capture_physics_body_snapshot_bulk(handleBuffer)) {
      throw new Error("capturePhysicsBodyStateBuffer() rejected one or more physics body handles.");
    }
    const view = bridge.readPhysicsBodyStateBuffer();
    const floats = new Float32Array(view.floats);
    const u32s = new Uint32Array(view.u32s);
    const states = decodePhysicsBodyStateBuffer({
      bodyCount: view.bodyCount,
      handles: new Uint32Array(handleBuffer),
      floats,
      u32s,
      floatsPerBody: view.floatsPerBody,
      u32sPerBody: view.u32sPerBody,
    });
    return {
      format: PHYSICS_BODY_STATE_BUFFER_FORMAT,
      version: PHYSICS_BODY_STATE_BUFFER_VERSION,
      bodyCount: view.bodyCount,
      handles: new Uint32Array(handleBuffer),
      floats,
      u32s,
      floatsPerBody: view.floatsPerBody,
      u32sPerBody: view.u32sPerBody,
      states,
    };
  };

  const restorePhysicsBodyStateBuffer = (snapshot: PhysicsBodyStateBufferSnapshot): boolean => {
    requireAlive();
    validatePhysicsBodyStateBufferSnapshot(snapshot);
    return rustEngine.restore_physics_body_snapshot_bulk(
      snapshot.handles,
      snapshot.floats,
      snapshot.u32s,
    );
  };

  const despawnPhysicsEntity = (handle: PhysicsEntityHandle): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.despawn_physics_entity(resolved.entityId, resolved.entityGeneration);
  };

  const setPhysicsBodyPosition = (
    handle: PhysicsEntityHandle,
    x: number,
    y: number,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.set_physics_body_position(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(x, "physics body x"),
      finiteNumber(y, "physics body y"),
    );
  };

  const setPhysicsBodyVelocity = (
    handle: PhysicsEntityHandle,
    velocityX: number,
    velocityY: number,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.set_physics_body_velocity(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(velocityX, "physics body velocityX"),
      finiteNumber(velocityY, "physics body velocityY"),
    );
  };

  const setPhysicsBodyRotation = (
    handle: PhysicsEntityHandle,
    rotationRadians: number,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.set_physics_body_rotation(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(rotationRadians, "physics body rotationRadians"),
    );
  };

  const setPhysicsBodyAngularVelocity = (
    handle: PhysicsEntityHandle,
    radiansPerSecond: number,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.set_physics_body_angular_velocity(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(radiansPerSecond, "physics body angularVelocityRadiansPerSecond"),
    );
  };

  const setPhysicsBodyEnabled = (handle: PhysicsEntityHandle, enabled: boolean): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.set_physics_body_enabled(resolved.entityId, resolved.entityGeneration, enabled);
  };

  const setPhysicsColliderOffset = (
    handle: PhysicsEntityHandle,
    offsetX: number,
    offsetY: number,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.set_physics_collider_offset(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(offsetX, "physics collider offsetX"),
      finiteNumber(offsetY, "physics collider offsetY"),
    );
  };

  const setPhysicsColliderEnabled = (
    handle: PhysicsEntityHandle,
    enabled: boolean,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.set_physics_collider_enabled(
      resolved.entityId,
      resolved.entityGeneration,
      enabled,
    );
  };

  const setPhysicsColliderMaterial = (
    handle: PhysicsEntityHandle,
    material: PhysicsRigidBodyMaterial,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    if (!rustEngine.query_physics_entity(resolved.entityId, resolved.entityGeneration)) {
      return false;
    }
    const current = readPhysicsEntitySnapshot(rustEngine);
    return setPhysicsColliderMaterialValues(rustEngine, resolved, {
      restitution: material.restitution ?? current.colliderMaterial.restitution,
      friction: material.friction ?? current.colliderMaterial.friction,
      surfaceVelocityX: material.surfaceVelocityX ?? current.colliderMaterial.surfaceVelocityX,
      surfaceVelocityY: material.surfaceVelocityY ?? current.colliderMaterial.surfaceVelocityY,
      density: material.density ?? current.colliderMaterial.density,
      contactBaumgarteBiasScale:
        material.contactBaumgarteBiasScale ?? current.colliderMaterial.contactBaumgarteBiasScale,
      maxContactBaumgarteBiasVelocityScale:
        material.maxContactBaumgarteBiasVelocityScale ??
        current.colliderMaterial.maxContactBaumgarteBiasVelocityScale,
      contactPositionCorrectionScale:
        material.contactPositionCorrectionScale ??
        current.colliderMaterial.contactPositionCorrectionScale,
      contactPositionCorrectionSlopScale:
        material.contactPositionCorrectionSlopScale ??
        current.colliderMaterial.contactPositionCorrectionSlopScale,
    });
  };

  const setPhysicsBodyColliderMaterial = (
    handle: PhysicsEntityHandle,
    colliderIndex: number,
    material: PhysicsRigidBodyMaterial,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    const resolvedColliderIndex = uint32Number(colliderIndex, "physics collider index");
    if (!rustEngine.query_physics_body_collider(
      resolved.entityId,
      resolved.entityGeneration,
      resolvedColliderIndex,
    )) {
      return false;
    }
    const current = readPhysicsBodyColliderSnapshot(rustEngine).colliderMaterial;
    return setPhysicsCompoundColliderMaterialValues(
      rustEngine,
      resolved,
      resolvedColliderIndex,
      {
        restitution: material.restitution ?? current.restitution,
        friction: material.friction ?? current.friction,
        surfaceVelocityX: material.surfaceVelocityX ?? current.surfaceVelocityX,
        surfaceVelocityY: material.surfaceVelocityY ?? current.surfaceVelocityY,
        density: material.density ?? current.density,
        contactBaumgarteBiasScale:
          material.contactBaumgarteBiasScale ?? current.contactBaumgarteBiasScale,
        maxContactBaumgarteBiasVelocityScale:
          material.maxContactBaumgarteBiasVelocityScale ??
          current.maxContactBaumgarteBiasVelocityScale,
        contactPositionCorrectionScale:
          material.contactPositionCorrectionScale ?? current.contactPositionCorrectionScale,
        contactPositionCorrectionSlopScale:
          material.contactPositionCorrectionSlopScale ?? current.contactPositionCorrectionSlopScale,
      },
    );
  };

  const clearPhysicsColliderMaterial = (handle: PhysicsEntityHandle): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.clear_physics_collider_material(
      resolved.entityId,
      resolved.entityGeneration,
    );
  };

  const setPhysicsBodyMassProperties = (
    handle: PhysicsEntityHandle,
    properties: PhysicsRigidBodyMassProperties,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.set_physics_body_mass_properties(
      resolved.entityId,
      resolved.entityGeneration,
      positiveNumber(properties.mass, "physics body mass"),
      positiveNumber(properties.inertia, "physics body inertia"),
    );
  };

  const setPhysicsBodyTuning = (
    handle: PhysicsEntityHandle,
    tuning: PhysicsRigidBodyTuning,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    if (!rustEngine.query_physics_entity(resolved.entityId, resolved.entityGeneration)) {
      return false;
    }
    const current = readPhysicsEntitySnapshot(rustEngine);
    return rustEngine.set_physics_body_tuning(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(tuning.gravityScale ?? current.gravityScale, "physics body gravityScale"),
      nonNegativeNumber(
        tuning.linearDamping ?? current.linearDamping,
        "physics body linearDamping",
      ),
      nonNegativeNumber(
        tuning.angularDamping ?? current.angularDamping,
        "physics body angularDamping",
      ),
    );
  };

  const setPhysicsBodyMaterial = (
    handle: PhysicsEntityHandle,
    material: PhysicsRigidBodyMaterial,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    if (!rustEngine.query_physics_entity(resolved.entityId, resolved.entityGeneration)) {
      return false;
    }
    const current = readPhysicsEntitySnapshot(rustEngine);
    return setPhysicsBodyMaterialValues(rustEngine, resolved, {
      restitution: material.restitution ?? current.restitution,
      friction: material.friction ?? current.friction,
      surfaceVelocityX: material.surfaceVelocityX ?? current.surfaceVelocityX,
      surfaceVelocityY: material.surfaceVelocityY ?? current.surfaceVelocityY,
      density: material.density ?? current.density,
      contactBaumgarteBiasScale:
        material.contactBaumgarteBiasScale ?? current.contactBaumgarteBiasScale,
      maxContactBaumgarteBiasVelocityScale:
        material.maxContactBaumgarteBiasVelocityScale ??
        current.maxContactBaumgarteBiasVelocityScale,
      contactPositionCorrectionScale:
        material.contactPositionCorrectionScale ?? current.contactPositionCorrectionScale,
      contactPositionCorrectionSlopScale:
        material.contactPositionCorrectionSlopScale ??
        current.contactPositionCorrectionSlopScale,
    });
  };

  const applyPhysicsBodyForce = (
    handle: PhysicsEntityHandle,
    forceX: number,
    forceY: number,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.apply_physics_body_force(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(forceX, "physics body forceX"),
      finiteNumber(forceY, "physics body forceY"),
    );
  };

  const applyPhysicsBodyImpulse = (
    handle: PhysicsEntityHandle,
    impulseX: number,
    impulseY: number,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.apply_physics_body_impulse(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(impulseX, "physics body impulseX"),
      finiteNumber(impulseY, "physics body impulseY"),
    );
  };

  const applyPhysicsBodyTorque = (handle: PhysicsEntityHandle, torque: number): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.apply_physics_body_torque(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(torque, "physics body torque"),
    );
  };

  const applyPhysicsBodyAngularImpulse = (
    handle: PhysicsEntityHandle,
    angularImpulse: number,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.apply_physics_body_angular_impulse(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(angularImpulse, "physics body angularImpulse"),
    );
  };

  return {
    spawnRigidBody,
    addPhysicsBodyCollider,
    getPhysicsBodyColliderCount,
    getPhysicsBodyCollider,
    getPhysicsEntity,
    capturePhysicsBodyStateBuffer,
    restorePhysicsBodyStateBuffer,
    despawnPhysicsEntity,
    setPhysicsBodyPosition,
    setPhysicsBodyVelocity,
    setPhysicsBodyRotation,
    setPhysicsBodyAngularVelocity,
    setPhysicsBodyEnabled,
    setPhysicsColliderOffset,
    setPhysicsColliderEnabled,
    setPhysicsColliderMaterial,
    setPhysicsBodyColliderMaterial,
    clearPhysicsColliderMaterial,
    setPhysicsBodyMassProperties,
    setPhysicsBodyTuning,
    setPhysicsBodyMaterial,
    applyPhysicsBodyForce,
    applyPhysicsBodyImpulse,
    applyPhysicsBodyTorque,
    applyPhysicsBodyAngularImpulse,
  };
}
