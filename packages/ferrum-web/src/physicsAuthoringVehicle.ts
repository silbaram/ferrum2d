import type {
  FerrumEngine,
  PhysicsEntityHandle,
  PhysicsJointHandle,
} from "./engineTypes.js";
import { physicsSpecDiagnosticError } from "./diagnostics.js";
import {
  frozenEntityHandle,
  frozenJointHandle,
} from "./physicsAuthoringHandles.js";
import { spawnJoint } from "./physicsAuthoringJoints.js";
import type {
  PhysicsAuthoringContext,
  PhysicsRigidBodyAuthoringOptions,
  PhysicsVehicleRigAuthoringOptions,
  PhysicsVehicleRigResult,
} from "./physicsAuthoringTypes.js";
import {
  finiteNumber,
  nonNegativeNumber,
  normalizedNonZeroVector2,
  optionalNonNegativeNumber,
  positiveNumber,
  positiveVector2,
  requiredVector2,
  unitIntervalNumber,
  vector2,
  vectorLength,
} from "./physicsAuthoringValidation.js";

type PhysicsVehicleRigidBodyFactory = (
  engine: FerrumEngine,
  options: PhysicsRigidBodyAuthoringOptions,
  context?: PhysicsAuthoringContext,
) => PhysicsEntityHandle;

export function createVehicleRigWithBodyFactory(
  engine: FerrumEngine,
  options: PhysicsVehicleRigAuthoringOptions,
  context: PhysicsAuthoringContext,
  createRigidBody: PhysicsVehicleRigidBodyFactory,
): PhysicsVehicleRigResult {
  const path = context.path ?? "physics.vehicle";
  if (options.wheels.length < 1) {
    throw physicsSpecDiagnosticError(`${path}.wheels`, "must contain at least one wheel");
  }
  const position = vector2(options.position, `${path}.position`, { x: 0, y: 0 });
  const chassisSize = positiveVector2(options.chassisSize, `${path}.chassisSize`, { x: 80, y: 24 });
  const sharedLayer = vehicleLayerOptions(options);

  let chassis: PhysicsEntityHandle | undefined;
  const wheels: PhysicsEntityHandle[] = [];
  const guideJoints: PhysicsJointHandle[] = [];
  const suspensionJoints: PhysicsJointHandle[] = [];

  try {
    chassis = createRigidBody(engine, {
      type: "dynamic",
      position: [position.x, position.y],
      collider: { type: "box", size: [chassisSize.x, chassisSize.y] },
      ...(options.chassisMass === undefined ? {} : { mass: positiveNumber(options.chassisMass, `${path}.chassisMass`) }),
      ...(options.chassisDensity === undefined ? {} : { density: positiveNumber(options.chassisDensity, `${path}.chassisDensity`) }),
      ...(options.chassisMaterial === undefined ? {} : { material: options.chassisMaterial }),
      ...(options.chassisLinearDamping === undefined
        ? {}
        : { linearDamping: nonNegativeNumber(options.chassisLinearDamping, `${path}.chassisLinearDamping`) }),
      ...(options.chassisAngularDamping === undefined
        ? {}
        : { angularDamping: nonNegativeNumber(options.chassisAngularDamping, `${path}.chassisAngularDamping`) }),
      ...sharedLayer,
    }, { path: `${path}.chassis` });

    for (const [index, wheel] of options.wheels.entries()) {
      const wheelPath = `${path}.wheels.${index}`;
      const offset = requiredVector2(wheel.offset, `${wheelPath}.offset`);
      const radius = positiveNumber(wheel.radius ?? options.wheelRadius ?? 10, `${wheelPath}.radius`);
      const axis = normalizedNonZeroVector2(
        vector2(wheel.suspensionAxis ?? options.suspensionAxis, `${wheelPath}.suspensionAxis`, { x: 0, y: 1 }),
        `${wheelPath}.suspensionAxis`,
      );
      const suspensionTravel = optionalNonNegativeNumber(
        wheel.suspensionTravel ?? options.suspensionTravel,
        `${wheelPath}.suspensionTravel`,
      );
      const restLength = nonNegativeNumber(
        wheel.restLength ?? vectorLength(offset),
        `${wheelPath}.restLength`,
      );
      const wheelMass = wheel.mass ?? options.wheelMass;
      const wheelDensity = wheel.density ?? options.wheelDensity;
      const wheelMaterial = wheel.material ?? options.wheelMaterial;
      const wheelLayer = vehicleLayerOptions({
        ...options,
        layer: wheel.layer ?? options.layer,
        categoryBits: wheel.categoryBits ?? options.categoryBits,
        maskBits: wheel.maskBits ?? options.maskBits,
      });
      const wheelHandle = createRigidBody(engine, {
        type: "dynamic",
        position: [position.x + offset.x, position.y + offset.y],
        collider: { type: "circle", radius },
        ...(wheelMass === undefined ? {} : { mass: positiveNumber(wheelMass, `${wheelPath}.mass`) }),
        ...(wheelDensity === undefined ? {} : { density: positiveNumber(wheelDensity, `${wheelPath}.density`) }),
        ...(wheelMaterial === undefined ? {} : { material: wheelMaterial }),
        ...(wheel.angularVelocityRadiansPerSecond === undefined
          ? {}
          : {
              angularVelocityRadiansPerSecond: finiteNumber(
                wheel.angularVelocityRadiansPerSecond,
                `${wheelPath}.angularVelocityRadiansPerSecond`,
              ),
            }),
        ...wheelLayer,
      }, { path: `${wheelPath}.body` });

      wheels.push(wheelHandle);
      guideJoints.push(spawnJoint(engine, {
        type: "prismatic",
        entityA: chassis,
        entityB: wheelHandle,
        localAnchorAX: offset.x,
        localAnchorAY: offset.y,
        localAnchorBX: 0,
        localAnchorBY: 0,
        localAxisAX: axis.x,
        localAxisAY: axis.y,
        angularStiffness: 0,
        angularDamping: 0,
        stiffness: unitIntervalNumber(wheel.guideStiffness ?? options.guideStiffness ?? 1, `${wheelPath}.guideStiffness`),
        damping: unitIntervalNumber(wheel.guideDamping ?? options.guideDamping ?? 0, `${wheelPath}.guideDamping`),
        limitEnabled: suspensionTravel !== undefined,
        lowerTranslation: suspensionTravel === undefined ? 0 : -suspensionTravel,
        upperTranslation: suspensionTravel ?? 0,
        enabled: wheel.enabled ?? true,
      }, `${wheelPath}.guideJoint`));
      suspensionJoints.push(spawnJoint(engine, {
        type: "spring",
        entityA: chassis,
        entityB: wheelHandle,
        restLength,
        stiffness: unitIntervalNumber(wheel.stiffness ?? options.suspensionStiffness ?? 0.6, `${wheelPath}.stiffness`),
        damping: unitIntervalNumber(wheel.damping ?? options.suspensionDamping ?? 0.4, `${wheelPath}.damping`),
        enabled: wheel.enabled ?? true,
      }, `${wheelPath}.suspensionJoint`));
    }
  } catch (error) {
    clearVehicleRig(engine, chassis, wheels, guideJoints, suspensionJoints);
    throw error;
  }

  if (chassis === undefined) {
    throw physicsSpecDiagnosticError(`${path}.chassis`, "runtime did not create chassis");
  }

  const publicChassis = frozenEntityHandle(chassis);
  const publicWheels = Object.freeze(wheels.map(frozenEntityHandle));
  const publicGuideJoints = Object.freeze(guideJoints.map(frozenJointHandle));
  const publicSuspensionJoints = Object.freeze(suspensionJoints.map(frozenJointHandle));
  let cleared = false;
  return {
    chassis: publicChassis,
    wheels: publicWheels,
    guideJoints: publicGuideJoints,
    suspensionJoints: publicSuspensionJoints,
    bodyCount: wheels.length + 1,
    jointCount: guideJoints.length + suspensionJoints.length,
    clear: () => {
      if (cleared) {
        return;
      }
      cleared = true;
      clearVehicleRig(engine, chassis, wheels, guideJoints, suspensionJoints);
    },
  };
}

function vehicleLayerOptions(
  options: Pick<PhysicsVehicleRigAuthoringOptions, "layer" | "categoryBits" | "maskBits">,
): Pick<PhysicsRigidBodyAuthoringOptions, "layer" | "categoryBits" | "maskBits"> {
  return {
    ...(options.layer === undefined ? {} : { layer: options.layer }),
    ...(options.categoryBits === undefined ? {} : { categoryBits: options.categoryBits }),
    ...(options.maskBits === undefined ? {} : { maskBits: options.maskBits }),
  };
}

function clearVehicleRig(
  engine: FerrumEngine,
  chassis: PhysicsEntityHandle | undefined,
  wheels: readonly PhysicsEntityHandle[],
  guideJoints: readonly PhysicsJointHandle[],
  suspensionJoints: readonly PhysicsJointHandle[],
): void {
  for (const joint of guideJoints) {
    engine.clearPhysicsJoint(joint);
  }
  for (const joint of suspensionJoints) {
    engine.clearPhysicsJoint(joint);
  }
  for (const wheel of wheels) {
    engine.despawnPhysicsEntity(wheel);
  }
  if (chassis !== undefined) {
    engine.despawnPhysicsEntity(chassis);
  }
}
