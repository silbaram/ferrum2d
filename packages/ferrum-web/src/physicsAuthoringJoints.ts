import type {
  FerrumEngine,
  PhysicsEntityHandle,
  PhysicsJointHandle,
  PhysicsJointSpawnOptions,
} from "./engineTypes.js";
import { describeError, physicsSpecDiagnosticError } from "./diagnostics.js";
import {
  frozenEntityHandle,
  frozenJointHandle,
} from "./physicsAuthoringHandles.js";
import { spawnBody } from "./physicsAuthoringRuntime.js";
import type {
  PhysicsAuthoringContext,
  PhysicsAuthoringJointHandle,
  PhysicsJointAuthoringOptions,
  PhysicsJointEndpoint,
} from "./physicsAuthoringTypes.js";
import type { ResolvedPhysicsJointSpec, ResolvedPhysicsVector2 } from "./physicsSpec.js";
import {
  finiteNumber,
  nonNegativeNumber,
  positiveNumber,
  unitIntervalNumber,
  vector2,
} from "./physicsAuthoringValidation.js";

export function createJoint(
  engine: FerrumEngine,
  options: PhysicsJointAuthoringOptions,
  context: PhysicsAuthoringContext = {},
): PhysicsAuthoringJointHandle {
  const path = context.path ?? "physics.joint";
  if (options.bodyA === "world" && options.bodyB === "world") {
    throw physicsSpecDiagnosticError(path, "cannot connect world to world");
  }
  const anchor = vector2(options.anchor, `${path}.anchor`, { x: 0, y: 0 });
  const worldAnchors: PhysicsEntityHandle[] = [];
  try {
    const entityA = jointEndpoint(engine, options.bodyA, anchor, worldAnchors, `${path}.bodyA`);
    const entityB = jointEndpoint(engine, options.bodyB, anchor, worldAnchors, `${path}.bodyB`);
    const joint = spawnJoint(engine, jointOptionsFromAuthoring(options, entityA, entityB, path), path);
    return jointWithCleanup(engine, joint, worldAnchors);
  } catch (error) {
    despawnWorldAnchors(engine, worldAnchors);
    throw error;
  }
}

export function spawnResolvedJoint(
  engine: FerrumEngine,
  bodies: Record<string, PhysicsEntityHandle>,
  worldAnchors: PhysicsEntityHandle[],
  joint: ResolvedPhysicsJointSpec,
  path: string,
): PhysicsJointHandle {
  if (joint.bodyA === "world" && joint.bodyB === "world") {
    throw physicsSpecDiagnosticError(path, "cannot connect world to world");
  }
  const anchor = { x: joint.anchorX, y: joint.anchorY };
  const initialAnchorCount = worldAnchors.length;
  try {
    const entityA = resolvedJointEndpoint(engine, bodies, worldAnchors, joint.bodyA, anchor, `${path}.bodyA`);
    const entityB = resolvedJointEndpoint(engine, bodies, worldAnchors, joint.bodyB, anchor, `${path}.bodyB`);
    return spawnJoint(engine, jointOptionsFromResolved(joint, entityA, entityB), path);
  } catch (error) {
    despawnWorldAnchors(engine, worldAnchors.splice(initialAnchorCount));
    throw error;
  }
}

function resolvedJointEndpoint(
  engine: FerrumEngine,
  bodies: Record<string, PhysicsEntityHandle>,
  worldAnchors: PhysicsEntityHandle[],
  id: string,
  anchor: ResolvedPhysicsVector2,
  path: string,
): PhysicsEntityHandle {
  if (id === "world") {
    const handle = createWorldAnchor(engine, anchor, path);
    worldAnchors.push(handle);
    return handle;
  }
  const handle = bodies[id];
  if (!handle) {
    throw physicsSpecDiagnosticError(path, `references unknown body '${id}'`);
  }
  return handle;
}

function jointEndpoint(
  engine: FerrumEngine,
  endpoint: PhysicsJointEndpoint,
  anchor: ResolvedPhysicsVector2,
  worldAnchors: PhysicsEntityHandle[],
  path: string,
): PhysicsEntityHandle {
  if (endpoint !== "world") {
    return endpoint;
  }
  const handle = createWorldAnchor(engine, anchor, path);
  worldAnchors.push(handle);
  return handle;
}

function jointWithCleanup(
  engine: FerrumEngine,
  joint: PhysicsJointHandle,
  worldAnchors: readonly PhysicsEntityHandle[],
): PhysicsAuthoringJointHandle {
  let cleared = false;
  const publicJoint = frozenJointHandle(joint);
  const publicWorldAnchors = Object.freeze(worldAnchors.map(frozenEntityHandle));
  return Object.freeze({
    ...publicJoint,
    worldAnchors: publicWorldAnchors,
    clear: () => {
      if (cleared) {
        return;
      }
      cleared = true;
      engine.clearPhysicsJoint(joint);
      for (const anchor of worldAnchors) {
        engine.despawnPhysicsEntity(anchor);
      }
    },
  });
}

function createWorldAnchor(
  engine: FerrumEngine,
  anchor: ResolvedPhysicsVector2,
  path: string,
): PhysicsEntityHandle {
  return spawnBody(engine, {
    x: anchor.x,
    y: anchor.y,
    bodyType: "static",
    collider: { type: "aabb", halfWidth: 1, halfHeight: 1 },
    categoryBits: 0,
    maskBits: 0,
    colliderEnabled: false,
    bodyEnabled: true,
    canSleep: false,
  }, path);
}

function despawnWorldAnchors(engine: FerrumEngine, anchors: readonly PhysicsEntityHandle[]): void {
  for (const anchor of anchors) {
    engine.despawnPhysicsEntity(anchor);
  }
}

function jointOptionsFromResolved(
  joint: ResolvedPhysicsJointSpec,
  entityA: PhysicsEntityHandle,
  entityB: PhysicsEntityHandle,
): PhysicsJointSpawnOptions {
  const base = {
    entityA,
    entityB,
    stiffness: joint.stiffness,
    damping: joint.damping,
    enabled: joint.enabled,
  };
  switch (joint.type) {
    case "distance":
      return {
        ...base,
        type: "distance",
        restLength: joint.restLength,
        ...(joint.breakDistance > 0 ? { breakDistance: joint.breakDistance } : {}),
      };
    case "rope":
      return {
        ...base,
        type: "rope",
        maxLength: joint.maxLength,
        ...(joint.breakDistance > 0 ? { breakDistance: joint.breakDistance } : {}),
      };
    case "spring":
      return {
        ...base,
        type: "spring",
        restLength: joint.restLength,
        ...(joint.breakDistance > 0 ? { breakDistance: joint.breakDistance } : {}),
      };
    case "pulley":
      return {
        ...base,
        type: "pulley",
        groundAnchorAX: joint.groundAnchorAX,
        groundAnchorAY: joint.groundAnchorAY,
        groundAnchorBX: joint.groundAnchorBX,
        groundAnchorBY: joint.groundAnchorBY,
        localAnchorAX: joint.localAnchorAX,
        localAnchorAY: joint.localAnchorAY,
        localAnchorBX: joint.localAnchorBX,
        localAnchorBY: joint.localAnchorBY,
        restLength: joint.restLength,
        ratio: joint.ratio,
        ...(joint.breakDistance > 0 ? { breakDistance: joint.breakDistance } : {}),
      };
    case "revolute":
      return {
        ...base,
        type: "revolute",
        localAnchorAX: joint.localAnchorAX,
        localAnchorAY: joint.localAnchorAY,
        localAnchorBX: joint.localAnchorBX,
        localAnchorBY: joint.localAnchorBY,
        ...(joint.breakDistance > 0 ? { breakDistance: joint.breakDistance } : {}),
        limitEnabled: joint.limitEnabled,
        lowerAngle: joint.lowerLimit,
        upperAngle: joint.upperLimit,
        motorEnabled: joint.motorEnabled,
        motorSpeed: joint.motorSpeed,
        maxMotorTorque: joint.maxMotorTorque,
      };
    case "prismatic":
      return {
        ...base,
        type: "prismatic",
        localAnchorAX: joint.localAnchorAX,
        localAnchorAY: joint.localAnchorAY,
        localAnchorBX: joint.localAnchorBX,
        localAnchorBY: joint.localAnchorBY,
        localAxisAX: joint.localAxisAX,
        localAxisAY: joint.localAxisAY,
        referenceAngle: joint.referenceAngle,
        angularStiffness: joint.stiffness,
        angularDamping: joint.damping,
        ...(joint.breakDistance > 0 ? { breakDistance: joint.breakDistance } : {}),
        limitEnabled: joint.limitEnabled,
        lowerTranslation: joint.lowerLimit,
        upperTranslation: joint.upperLimit,
        motorEnabled: joint.motorEnabled,
        motorSpeed: joint.motorSpeed,
        maxMotorForce: joint.maxMotorForce,
      };
    case "weld":
      return {
        ...base,
        type: "weld",
        localAnchorAX: joint.localAnchorAX,
        localAnchorAY: joint.localAnchorAY,
        localAnchorBX: joint.localAnchorBX,
        localAnchorBY: joint.localAnchorBY,
        referenceAngle: joint.referenceAngle,
        angularStiffness: joint.stiffness,
        angularDamping: joint.damping,
        ...(joint.breakDistance > 0 ? { breakDistance: joint.breakDistance } : {}),
        ...(joint.breakAngle > 0 ? { breakAngle: joint.breakAngle } : {}),
      };
    case "gear":
      return {
        ...base,
        type: "gear",
        ratio: joint.ratio,
        referenceAngle: joint.referenceAngle,
        ...(joint.breakAngle > 0 ? { breakAngle: joint.breakAngle } : {}),
      };
  }
}

function jointOptionsFromAuthoring(
  options: PhysicsJointAuthoringOptions,
  entityA: PhysicsEntityHandle,
  entityB: PhysicsEntityHandle,
  path: string,
): PhysicsJointSpawnOptions {
  const localAnchorA = vector2(options.localAnchorA, `${path}.localAnchorA`, { x: 0, y: 0 });
  const localAnchorB = vector2(options.localAnchorB, `${path}.localAnchorB`, { x: 0, y: 0 });
  const base = {
    entityA,
    entityB,
    ...(options.stiffness === undefined ? {} : { stiffness: unitIntervalNumber(options.stiffness, `${path}.stiffness`) }),
    ...(options.damping === undefined ? {} : { damping: unitIntervalNumber(options.damping, `${path}.damping`) }),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  };
  switch (options.type) {
    case "distance":
      return {
        ...base,
        type: "distance",
        restLength: nonNegativeNumber(options.restLength, `${path}.restLength`),
        ...(options.breakDistance === undefined ? {} : { breakDistance: nonNegativeNumber(options.breakDistance, `${path}.breakDistance`) }),
      };
    case "rope":
      return {
        ...base,
        type: "rope",
        maxLength: nonNegativeNumber(options.maxLength, `${path}.maxLength`),
        ...(options.breakDistance === undefined ? {} : { breakDistance: nonNegativeNumber(options.breakDistance, `${path}.breakDistance`) }),
      };
    case "spring":
      return {
        ...base,
        type: "spring",
        restLength: nonNegativeNumber(options.restLength, `${path}.restLength`),
        ...(options.breakDistance === undefined ? {} : { breakDistance: nonNegativeNumber(options.breakDistance, `${path}.breakDistance`) }),
      };
    case "pulley": {
      const groundAnchorA = vector2(options.groundAnchorA, `${path}.groundAnchorA`, { x: 0, y: 0 });
      const groundAnchorB = vector2(options.groundAnchorB, `${path}.groundAnchorB`, { x: 0, y: 0 });
      return {
        ...base,
        type: "pulley",
        groundAnchorAX: groundAnchorA.x,
        groundAnchorAY: groundAnchorA.y,
        groundAnchorBX: groundAnchorB.x,
        groundAnchorBY: groundAnchorB.y,
        localAnchorAX: localAnchorA.x,
        localAnchorAY: localAnchorA.y,
        localAnchorBX: localAnchorB.x,
        localAnchorBY: localAnchorB.y,
        restLength: nonNegativeNumber(options.restLength, `${path}.restLength`),
        ratio: positiveNumber(options.ratio ?? 1, `${path}.ratio`),
        ...(options.breakDistance === undefined ? {} : { breakDistance: nonNegativeNumber(options.breakDistance, `${path}.breakDistance`) }),
      };
    }
    case "revolute":
      return {
        ...base,
        type: "revolute",
        localAnchorAX: localAnchorA.x,
        localAnchorAY: localAnchorA.y,
        localAnchorBX: localAnchorB.x,
        localAnchorBY: localAnchorB.y,
        ...(options.breakDistance === undefined ? {} : { breakDistance: nonNegativeNumber(options.breakDistance, `${path}.breakDistance`) }),
        limitEnabled: options.limit?.enabled === true,
        lowerAngle: finiteNumber(options.limit?.lower ?? 0, `${path}.limit.lower`),
        upperAngle: finiteNumber(options.limit?.upper ?? 0, `${path}.limit.upper`),
        motorEnabled: options.motor?.enabled === true,
        motorSpeed: finiteNumber(options.motor?.speed ?? 0, `${path}.motor.speed`),
        maxMotorTorque: nonNegativeNumber(options.motor?.maxTorque ?? 0, `${path}.motor.maxTorque`),
      };
    case "prismatic": {
      const axis = vector2(options.localAxisA, `${path}.localAxisA`, { x: 1, y: 0 });
      return {
        ...base,
        type: "prismatic",
        localAnchorAX: localAnchorA.x,
        localAnchorAY: localAnchorA.y,
        localAnchorBX: localAnchorB.x,
        localAnchorBY: localAnchorB.y,
        localAxisAX: axis.x,
        localAxisAY: axis.y,
        referenceAngle: finiteNumber(options.referenceAngle ?? 0, `${path}.referenceAngle`),
        angularStiffness: unitIntervalNumber(options.angularStiffness ?? 1, `${path}.angularStiffness`),
        angularDamping: unitIntervalNumber(options.angularDamping ?? 1, `${path}.angularDamping`),
        ...(options.breakDistance === undefined ? {} : { breakDistance: nonNegativeNumber(options.breakDistance, `${path}.breakDistance`) }),
        limitEnabled: options.limit?.enabled === true,
        lowerTranslation: finiteNumber(options.limit?.lower ?? 0, `${path}.limit.lower`),
        upperTranslation: finiteNumber(options.limit?.upper ?? 0, `${path}.limit.upper`),
        motorEnabled: options.motor?.enabled === true,
        motorSpeed: finiteNumber(options.motor?.speed ?? 0, `${path}.motor.speed`),
        maxMotorForce: nonNegativeNumber(options.motor?.maxForce ?? 0, `${path}.motor.maxForce`),
      };
    }
    case "weld":
      return {
        ...base,
        type: "weld",
        localAnchorAX: localAnchorA.x,
        localAnchorAY: localAnchorA.y,
        localAnchorBX: localAnchorB.x,
        localAnchorBY: localAnchorB.y,
        referenceAngle: finiteNumber(options.referenceAngle ?? 0, `${path}.referenceAngle`),
        angularStiffness: unitIntervalNumber(options.angularStiffness ?? 1, `${path}.angularStiffness`),
        angularDamping: unitIntervalNumber(options.angularDamping ?? 1, `${path}.angularDamping`),
        ...(options.breakDistance === undefined ? {} : { breakDistance: nonNegativeNumber(options.breakDistance, `${path}.breakDistance`) }),
        ...(options.breakAngle === undefined ? {} : { breakAngle: nonNegativeNumber(options.breakAngle, `${path}.breakAngle`) }),
      };
    case "gear":
      return {
        ...base,
        type: "gear",
        ratio: finiteNumber(options.ratio ?? 1, `${path}.ratio`),
        referenceAngle: finiteNumber(options.referenceAngle ?? 0, `${path}.referenceAngle`),
        ...(options.breakAngle === undefined ? {} : { breakAngle: nonNegativeNumber(options.breakAngle, `${path}.breakAngle`) }),
      };
  }
}

export function spawnJoint(
  engine: FerrumEngine,
  options: PhysicsJointSpawnOptions,
  path: string,
): PhysicsJointHandle {
  try {
    return engine.spawnPhysicsJoint(options);
  } catch (error) {
    throw physicsSpecDiagnosticError(path, `runtime rejected joint: ${describeError(error)}`);
  }
}
