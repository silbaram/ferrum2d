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
  applyPhysicsBodyHeightSpan,
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
  PhysicsBodyHeightSpan,
  PhysicsEntityHandle,
  PhysicsEntitySnapshot,
  PhysicsHd2dKinematicMoveOptions,
  PhysicsHd2dKinematicMoveResult,
  PhysicsRigidBodyMassProperties,
  PhysicsRigidBodyMaterial,
  PhysicsRigidBodySpawnOptions,
  PhysicsRigidBodyTuning,
} from "./engineTypes.js";

const DEFAULT_HD2D_KINEMATIC_SOLID_MASK_BITS = 1 << 3;
const DEFAULT_HD2D_KINEMATIC_MAX_ITERATIONS = 4;
const HD2D_KINEMATIC_STEPPED_UP = 1 << 0;
const HD2D_KINEMATIC_STEPPED_DOWN = 1 << 1;
const HD2D_KINEMATIC_CHANGED_FLOOR = 1 << 2;
const HD2D_KINEMATIC_PASSED_UNDER_BRIDGE = 1 << 3;
const HD2D_KINEMATIC_BLOCKED_BY_STEP = 1 << 4;
const HD2D_KINEMATIC_BLOCKED_BY_DROP = 1 << 5;
const HD2D_KINEMATIC_BLOCKED_X = 1 << 6;
const HD2D_KINEMATIC_BLOCKED_Y = 1 << 7;

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

  const setPhysicsBodyHeightSpan = (
    handle: PhysicsEntityHandle,
    span: PhysicsBodyHeightSpan,
  ): boolean => {
    requireAlive();
    return applyPhysicsBodyHeightSpan(rustEngine, handle, span);
  };

  const clearPhysicsBodyHeightSpan = (handle: PhysicsEntityHandle): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.clear_physics_body_height_span(
      resolved.entityId,
      resolved.entityGeneration,
    );
  };

  const getPhysicsBodyHeightSpan = (
    handle: PhysicsEntityHandle,
  ): PhysicsBodyHeightSpan | undefined => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    if (
      !rustEngine.physics_body_has_height_span(
        resolved.entityId,
        resolved.entityGeneration,
      )
    ) {
      return undefined;
    }
    return {
      floorId: rustEngine.physics_body_floor_id(resolved.entityId, resolved.entityGeneration),
      elevation: rustEngine.physics_body_elevation(resolved.entityId, resolved.entityGeneration),
      height: rustEngine.physics_body_height(resolved.entityId, resolved.entityGeneration),
    };
  };

  const moveHd2dKinematicBodyWithTilemap = (
    handle: PhysicsEntityHandle,
    options: PhysicsHd2dKinematicMoveOptions,
  ): PhysicsHd2dKinematicMoveResult | undefined => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    const accepted = rustEngine.move_hd2d_kinematic_body_with_tilemap(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(options.displacementX, "HD-2D kinematic displacementX"),
      finiteNumber(options.displacementY, "HD-2D kinematic displacementY"),
      uint32Number(
        options.solidMaskBits ?? DEFAULT_HD2D_KINEMATIC_SOLID_MASK_BITS,
        "HD-2D kinematic solidMaskBits",
      ),
      uint32Number(
        options.maxIterations ?? DEFAULT_HD2D_KINEMATIC_MAX_ITERATIONS,
        "HD-2D kinematic maxIterations",
      ),
      nonNegativeNumber(options.maxStepHeight ?? 0, "HD-2D kinematic maxStepHeight"),
      nonNegativeNumber(options.maxDropHeight ?? 0, "HD-2D kinematic maxDropHeight"),
      booleanOption(options.allowLedgeDrop, "HD-2D kinematic allowLedgeDrop", false),
    );
    if (!accepted) {
      return undefined;
    }
    return {
      body: readPhysicsEntitySnapshot(rustEngine),
      elevationDelta: rustEngine.hd2d_kinematic_elevation_delta(),
      hitCount: rustEngine.hd2d_kinematic_hit_count(),
      ...decodeHd2dKinematicFlags(rustEngine.hd2d_kinematic_flags()),
    };
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
    setPhysicsBodyHeightSpan,
    clearPhysicsBodyHeightSpan,
    getPhysicsBodyHeightSpan,
    moveHd2dKinematicBodyWithTilemap,
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

function decodeHd2dKinematicFlags(flags: number): Omit<PhysicsHd2dKinematicMoveResult, "body" | "elevationDelta" | "hitCount"> {
  return {
    steppedUp: (flags & HD2D_KINEMATIC_STEPPED_UP) !== 0,
    steppedDown: (flags & HD2D_KINEMATIC_STEPPED_DOWN) !== 0,
    changedFloor: (flags & HD2D_KINEMATIC_CHANGED_FLOOR) !== 0,
    passedUnderBridge: (flags & HD2D_KINEMATIC_PASSED_UNDER_BRIDGE) !== 0,
    blockedByStep: (flags & HD2D_KINEMATIC_BLOCKED_BY_STEP) !== 0,
    blockedByDrop: (flags & HD2D_KINEMATIC_BLOCKED_BY_DROP) !== 0,
    blockedX: (flags & HD2D_KINEMATIC_BLOCKED_X) !== 0,
    blockedY: (flags & HD2D_KINEMATIC_BLOCKED_Y) !== 0,
  };
}

function booleanOption(value: boolean | undefined, label: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}
