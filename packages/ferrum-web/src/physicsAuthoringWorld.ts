import type {
  FerrumEngine,
  PhysicsBodyHeightSpan,
  PhysicsCollisionLayer,
  PhysicsEntityHandle,
  PhysicsJointHandle,
  PhysicsRigidBodyMaterial,
  PhysicsRigidBodySpawnOptions,
} from "./engineTypes.js";
import { physicsSpecDiagnosticError } from "./diagnostics.js";
import { runtimeCollidersFromResolved } from "./physicsAuthoringColliders.js";
import {
  frozenEntityHandle,
  frozenEntityHandleRecord,
  frozenJointHandleRecord,
} from "./physicsAuthoringHandles.js";
import { builtinCollisionLayer } from "./physicsAuthoringLayers.js";
import { materialFromSpec } from "./physicsAuthoringMaterial.js";
import { spawnResolvedJoint } from "./physicsAuthoringJoints.js";
import {
  setBodyColliderMaterial,
  setBodyMassProperties,
  spawnBody,
} from "./physicsAuthoringRuntime.js";
import type {
  PhysicsWorldApplyOptions,
  PhysicsWorldApplyResult,
  PhysicsWorldApplyWarning,
  RuntimeResolvedCollider,
} from "./physicsAuthoringTypes.js";
import { isObject } from "./physicsAuthoringValidation.js";
import { resolvePhysicsSpec } from "./physicsSpec.js";
import { usesNativePhysicsSpec, validateNativePhysicsSpec } from "./physicsSpecNativeRuntime.js";
import { supportsNativePhysicsAuthoring, withNativePhysicsAuthoring } from "./nativePhysicsAuthoring.js";
import { createHd2dFloorIds } from "./physicsHd2dFloorIds.js";
import type {
  PhysicsSpec,
  ResolvedPhysicsBodySpec,
  ResolvedPhysicsColliderSpec,
  ResolvedPhysicsDebugSpec,
  ResolvedPhysicsLayerSpec,
  ResolvedPhysicsSpec,
} from "./physicsSpec.js";

const DEFAULT_APPLY_PATH = "physics";
const DEFAULT_UNSAFE_UNIT_SCALE_THRESHOLD = 5000;
const clearStates = new WeakMap<object, { owner: FerrumEngine; cleared: boolean }>();

function applyPhysicsWorldFromSpec(
  engine: FerrumEngine,
  input: PhysicsSpec | ResolvedPhysicsSpec,
  options: PhysicsWorldApplyOptions = {},
  configureRuntime = true,
): PhysicsWorldApplyResult {
  const spec = isResolvedPhysicsSpec(input) ? input : resolvePhysicsSpec(input, { path: options.path ?? DEFAULT_APPLY_PATH });
  const apply = () => applyPhysicsWorldFromSpecUnchecked(engine, spec, options, configureRuntime);
  const state = options.replace && clearStates.get(options.replace);
  if (state && state.owner !== engine)
    throw physicsSpecDiagnosticError(`${options.path ?? DEFAULT_APPLY_PATH}.replace`, "must belong to the same Engine");
  if (!configureRuntime || !usesNativePhysicsSpec(spec)) return apply();
  const wasCleared = state?.cleared;
  const transactional = supportsNativePhysicsAuthoring(engine);
  try {
    return withNativePhysicsAuthoring(engine, apply);
  } catch (error) {
    if (state && transactional) state.cleared = wasCleared!;
    throw error;
  }
}

function applyPhysicsWorldFromSpecUnchecked(
  engine: FerrumEngine,
  input: PhysicsSpec | ResolvedPhysicsSpec,
  options: PhysicsWorldApplyOptions = {},
  configureRuntime = true,
): PhysicsWorldApplyResult {
  const path = options.path ?? DEFAULT_APPLY_PATH;
  const spec = isResolvedPhysicsSpec(input) ? input : resolvePhysicsSpec(input, { path });
  const bodies = Object.values(spec.bodies);
  const joints = Object.values(spec.joints);
  if (!configureRuntime && bodies.some(body => body.kinematicController !== undefined))
    throw physicsSpecDiagnosticError(`${path}.bodies`, "authored kinematicController requires runtime configuration");
  if (spec.mode === "none" && (bodies.length > 0 || joints.length > 0)) {
    throw physicsSpecDiagnosticError(`${path}.mode`, "cannot apply bodies or joints when physics mode is none");
  }

  if (configureRuntime) {
    validateNativePhysicsSpec(spec, path);
    if (usesNativePhysicsSpec(spec) && (typeof engine.configurePhysicsRuntime !== "function"
      || typeof engine.validatePhysicsRuntime !== "function")) {
      throw physicsSpecDiagnosticError(`${path}.mode`, `${spec.mode} Physics Spec requires a runtime with native backend configuration`);
    }
    engine.validatePhysicsRuntime?.(spec);
  }
  options.replace?.clear();

  const warnings = physicsApplyWarnings(spec, path, options.unsafeUnitScaleThreshold);
  for (const warning of warnings) {
    options.onWarning?.(warning);
  }

  const hd2dFloorIds = createHd2dFloorIds([
    Object.values(spec.bodies).map((body) => body.floor),
  ]);
  const bodyHandles: Record<string, PhysicsEntityHandle> = {};
  const jointHandles: Record<string, PhysicsJointHandle> = {};
  const worldAnchors: PhysicsEntityHandle[] = [];

  try {
    for (const body of bodies) {
      bodyHandles[body.id] = spawnResolvedBody(engine, spec, hd2dFloorIds, body, `${path}.bodies.${body.id}`);
    }

    for (const joint of joints) {
      jointHandles[joint.id] = spawnResolvedJoint(
        engine,
        bodyHandles,
        worldAnchors,
        joint,
        `${path}.joints.${joint.id}`,
      );
    }
    // Import the complete authored group, so native body and joint identities
    // are available before this function returns, without consuming a tick.
    if (configureRuntime) {
      configureAppliedPhysicsRuntime(engine, spec);
      for (const body of bodies) if (body.kinematicController !== undefined) {
        if (typeof engine.configureDataSceneKinematicController !== "function"
          || !engine.configureDataSceneKinematicController(bodyHandles[body.id], body.kinematicController)) {
          throw physicsSpecDiagnosticError(`${path}.bodies.${body.id}.kinematicController`, "native controller admission rejected");
        }
      }
    }
  } catch (error) {
    clearAppliedPhysicsWorld(engine, bodyHandles, jointHandles, worldAnchors);
    throw error;
  }

  const state = { owner: engine, cleared: false };
  const publicBodies = frozenEntityHandleRecord(bodyHandles);
  const publicJoints = frozenJointHandleRecord(jointHandles);
  const publicWorldAnchors = Object.freeze(worldAnchors.map(frozenEntityHandle));
  const result: PhysicsWorldApplyResult = {
    spec,
    bodies: publicBodies,
    joints: publicJoints,
    worldAnchors: publicWorldAnchors,
    bodyCount: Object.keys(bodyHandles).length,
    jointCount: Object.keys(jointHandles).length,
    warningCount: warnings.length,
    warnings,
    stepSeconds: spec.solver.stepSeconds,
    stepOptions: {
      gravityX: spec.gravityX,
      gravityY: spec.gravityY,
      continuous: spec.continuous,
      velocityIterations: spec.solver.velocityIterations,
      positionIterations: spec.solver.positionIterations,
    },
    clear: () => {
      if (state.cleared) {
        return;
      }
      state.cleared = true;
      clearAppliedPhysicsWorld(engine, bodyHandles, jointHandles, worldAnchors);
    },
  };
  clearStates.set(result, state);
  return result;
}

export function clearPhysicsWorld(_engine: FerrumEngine, world: PhysicsWorldApplyResult): void {
  world.clear();
}

function clearAppliedPhysicsWorld(
  engine: FerrumEngine,
  bodies: Record<string, PhysicsEntityHandle>,
  joints: Record<string, PhysicsJointHandle>,
  worldAnchors: readonly PhysicsEntityHandle[],
): void {
  for (const joint of Object.values(joints)) {
    engine.clearPhysicsJoint(joint);
  }
  for (const anchor of worldAnchors) {
    engine.despawnPhysicsEntity(anchor);
  }
  for (const body of Object.values(bodies)) {
    engine.despawnPhysicsEntity(body);
  }
}

function applyPhysicsRuntimeOptions(engine: FerrumEngine, spec: ResolvedPhysicsSpec): void {
  engine.configureFixedTimestep(spec.solver.fixedTimestep
    ? { enabled: true, stepSeconds: spec.solver.stepSeconds }
    : false);
  if (spec.debug.enabled) {
    engine.setPhysicsDebugLinesEnabled(debugOptions(spec.debug));
  }
}

function spawnResolvedBody(
  engine: FerrumEngine,
  spec: ResolvedPhysicsSpec,
  hd2dFloorIds: ReadonlyMap<string, number>,
  body: ResolvedPhysicsBodySpec,
  path: string,
): PhysicsEntityHandle {
  if (body.colliders.length < 1) {
    throw physicsSpecDiagnosticError(
      `${path}.colliders`,
      "must contain at least one collider for runtime apply",
    );
  }
  const collider = body.colliders[0];
  const primaryRuntimeColliders = runtimeCollidersFromResolved(collider, `${path}.colliders.0`);
  const effectiveLayerName = collider.layer ?? body.layer;
  const resolvedLayer = effectiveLayerName === undefined ? undefined : spec.layers[effectiveLayerName];
  const material = body.material === undefined
    ? undefined
    : materialFromSpec(spec.materials, body.material, `${path}.material`);
  const colliderMaterial = collider.material === undefined
    ? undefined
    : materialFromSpec(spec.materials, collider.material, `${path}.colliders.0.material`);
  const layer = builtinCollisionLayer(effectiveLayerName);
  const spawnOptions: PhysicsRigidBodySpawnOptions = {
    x: body.positionX,
    y: body.positionY,
    bodyType: body.type,
    collider: primaryRuntimeColliders[0].collider,
    ...(layer ? { layer } : {}),
    ...(resolvedLayer ? { categoryBits: resolvedLayer.categoryBits, maskBits: resolvedLayer.maskBits } : {}),
    ...(body.mass === undefined ? {} : { mass: body.mass }),
    ...(material?.density === undefined ? {} : { density: material.density }),
    ...(material ? { material } : {}),
    ...(colliderMaterial ? { colliderMaterial } : {}),
    isTrigger: collider.trigger,
    colliderEnabled: collider.enabled,
    bodyEnabled: body.enabled,
    canSleep: body.canSleep && spec.solver.sleep,
    fixedRotation: body.fixedRotation,
    velocityX: body.velocityX,
    velocityY: body.velocityY,
    rotationRadians: body.rotationRadians,
    angularVelocityRadiansPerSecond: body.angularVelocityRadiansPerSecond,
    gravityScale: body.gravityScale,
    linearDamping: body.linearDamping,
    angularDamping: body.angularDamping,
    ...(physicsBodyHeightSpan(spec, hd2dFloorIds, body) ?? {}),
  };
  const handle = spawnBody(engine, spawnOptions, path);
  try {
    if (body.inertia !== undefined) {
      setBodyMassProperties(engine, handle, {
        mass: body.mass ?? material?.density ?? 1,
        inertia: body.inertia,
      }, `${path}.inertia`);
    }
    let nextColliderIndex = 1;
    for (const runtimeCollider of primaryRuntimeColliders.slice(1)) {
      addRuntimeCollider(
        engine,
        handle,
        runtimeCollider,
        nextColliderIndex,
        layer,
        resolvedLayer,
        collider.trigger,
        collider.enabled,
        colliderMaterial,
      );
      nextColliderIndex += 1;
    }
    for (const [index, secondaryCollider] of body.colliders.slice(1).entries()) {
      nextColliderIndex = addResolvedCollider(
        engine,
        spec,
        body,
        handle,
        secondaryCollider,
        nextColliderIndex,
        `${path}.colliders.${index + 1}`,
      );
    }
  } catch (error) {
    engine.despawnPhysicsEntity(handle);
    throw error;
  }
  return handle;
}

function physicsBodyHeightSpan(
  spec: ResolvedPhysicsSpec,
  hd2dFloorIds: ReadonlyMap<string, number>,
  body: ResolvedPhysicsBodySpec,
): { heightSpan: PhysicsBodyHeightSpan } | undefined {
  if (
    !spec.hd2d.enabled &&
    body.floor === "default" &&
    body.elevation === 0 &&
    body.height === 0
  ) {
    return undefined;
  }
  return {
    heightSpan: {
      floorId: hd2dFloorIds.get(body.floor) ?? 0,
      elevation: body.elevation,
      height: body.height,
    },
  };
}

function addResolvedCollider(
  engine: FerrumEngine,
  spec: ResolvedPhysicsSpec,
  body: ResolvedPhysicsBodySpec,
  handle: PhysicsEntityHandle,
  collider: ResolvedPhysicsColliderSpec,
  colliderIndex: number,
  path: string,
): number {
  const effectiveLayerName = collider.layer ?? body.layer;
  const resolvedLayer = effectiveLayerName === undefined ? undefined : spec.layers[effectiveLayerName];
  const material = collider.material === undefined
    ? undefined
    : materialFromSpec(spec.materials, collider.material, `${path}.material`);
  const layer = builtinCollisionLayer(effectiveLayerName);
  let nextColliderIndex = colliderIndex;
  for (const runtimeCollider of runtimeCollidersFromResolved(collider, path)) {
    addRuntimeCollider(
      engine,
      handle,
      runtimeCollider,
      nextColliderIndex,
      layer,
      resolvedLayer,
      collider.trigger,
      collider.enabled,
      material,
    );
    nextColliderIndex += 1;
  }
  return nextColliderIndex;
}

function addRuntimeCollider(
  engine: FerrumEngine,
  handle: PhysicsEntityHandle,
  runtimeCollider: RuntimeResolvedCollider,
  colliderIndex: number,
  layer: PhysicsCollisionLayer | undefined,
  resolvedLayer: ResolvedPhysicsLayerSpec | undefined,
  isTrigger: boolean,
  colliderEnabled: boolean,
  material: PhysicsRigidBodyMaterial | undefined,
): void {
  const added = engine.addPhysicsBodyCollider(handle, {
    collider: runtimeCollider.collider,
    ...(layer ? { layer } : {}),
    ...(resolvedLayer ? { categoryBits: resolvedLayer.categoryBits, maskBits: resolvedLayer.maskBits } : {}),
    isTrigger,
    colliderEnabled,
  });
  if (!added) {
    throw physicsSpecDiagnosticError(runtimeCollider.path, "runtime rejected compound collider");
  }
  if (material !== undefined) {
    setBodyColliderMaterial(engine, handle, colliderIndex, material, `${runtimeCollider.path}.material`);
  }
}

function debugOptions(debug: ResolvedPhysicsDebugSpec): ResolvedPhysicsDebugSpec {
  return { ...debug };
}

function physicsApplyWarnings(
  spec: ResolvedPhysicsSpec,
  path: string,
  threshold = DEFAULT_UNSAFE_UNIT_SCALE_THRESHOLD,
): PhysicsWorldApplyWarning[] {
  const warnings: PhysicsWorldApplyWarning[] = [];
  if (spec.mode !== "none" && Math.hypot(spec.gravityX, spec.gravityY) > threshold) {
    const warningPath = `${path}.gravity`;
    const detail = "gravity magnitude is unusually large; verify pixels-per-meter scale";
    warnings.push({
      path: warningPath,
      detail,
      message: `Physics warning: path='${warningPath}' detail='${detail}'.`,
    });
  }
  return warnings;
}

function isResolvedPhysicsSpec(input: PhysicsSpec | ResolvedPhysicsSpec): input is ResolvedPhysicsSpec {
  return isObject(input)
    && typeof input.gravityX === "number"
    && typeof input.gravityY === "number"
    && isObject(input.bodies)
    && isObject(input.joints)
    && isObject(input.solver);
}

export function createPhysicsWorldFromSpec(engine: FerrumEngine, input: PhysicsSpec | ResolvedPhysicsSpec, options: PhysicsWorldApplyOptions = {}): PhysicsWorldApplyResult {
  return applyPhysicsWorldFromSpec(engine, input, options, options.configureRuntime !== false);
}

// Snapshot restore stages entities without changing the live runtime or clearing
// the previous world. Only a successfully restored candidate is committed.
export function stagePhysicsWorldFromSpec(engine: FerrumEngine, spec: ResolvedPhysicsSpec, options: PhysicsWorldApplyOptions): PhysicsWorldApplyResult {
  return applyPhysicsWorldFromSpec(engine, spec, { ...options, replace: undefined }, false);
}

export function configureAppliedPhysicsRuntime(engine: FerrumEngine, spec: ResolvedPhysicsSpec): void {
  const runtimeConfigurable = engine as FerrumEngine & {
    configurePhysicsRuntime?: (spec: ResolvedPhysicsSpec) => ResolvedPhysicsSpec;
  };
  if (typeof runtimeConfigurable.configurePhysicsRuntime === "function") {
    runtimeConfigurable.configurePhysicsRuntime(spec);
  } else {
    if (usesNativePhysicsSpec(spec)) {
      throw physicsSpecDiagnosticError("physics.mode", `${spec.mode} Physics Spec requires a runtime with native backend configuration`);
    }
    applyPhysicsRuntimeOptions(engine, spec);
  }

}
