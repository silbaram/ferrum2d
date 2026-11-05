import {
  bodyReference,
  booleanValue,
  finiteNumber,
  jointType,
  nonNegativeNumber,
  optionalObject,
  physicsSpecError,
  positiveNumber,
  rejectUnknownKeys,
  requireName,
  requiredObject,
  unitIntervalNumber,
  vector2,
} from "../physicsSpecValidation.js";
import type {
  ResolvedPhysicsBodySpec,
  ResolvedPhysicsJointSpec,
} from "../physicsSpecTypes.js";
import { JOINT_KEYS, LIMIT_KEYS, MOTOR_KEYS } from "./keys.js";
import { setRecordEntry } from "./records.js";

export function physicsJoints(
  value: unknown,
  path: string,
  bodies: Record<string, ResolvedPhysicsBodySpec>,
): Record<string, ResolvedPhysicsJointSpec> {
  const joints = optionalObject(value, path);
  const resolved: Record<string, ResolvedPhysicsJointSpec> = {};
  for (const [id, joint] of Object.entries(joints)) {
    const jointPath = `${path}.${id}`;
    requireName(id, jointPath);
    const object = requiredObject(joint, jointPath);
    rejectUnknownKeys(object, jointPath, JOINT_KEYS);
    const type = jointType(object.type, `${jointPath}.type`);
    const bodyA = bodyReference(object.bodyA, `${jointPath}.bodyA`, bodies);
    const bodyB = bodyReference(object.bodyB, `${jointPath}.bodyB`, bodies);
    if (bodyA === bodyB) {
      throw physicsSpecError(`${jointPath}.bodyB`, "must not reference the same body as bodyA");
    }
    const anchor = vector2(object.anchor, `${jointPath}.anchor`, { x: 0, y: 0 });
    const localAnchorA = vector2(object.localAnchorA, `${jointPath}.localAnchorA`, { x: 0, y: 0 });
    const localAnchorB = vector2(object.localAnchorB, `${jointPath}.localAnchorB`, { x: 0, y: 0 });
    const groundAnchorA = vector2(object.groundAnchorA, `${jointPath}.groundAnchorA`, anchor);
    const groundAnchorB = vector2(object.groundAnchorB, `${jointPath}.groundAnchorB`, anchor);
    const localAxisA = vector2(object.localAxisA, `${jointPath}.localAxisA`, { x: 1, y: 0 });
    const limit = optionalObject(object.limit, `${jointPath}.limit`);
    rejectUnknownKeys(limit, `${jointPath}.limit`, LIMIT_KEYS);
    const motor = optionalObject(object.motor, `${jointPath}.motor`);
    rejectUnknownKeys(motor, `${jointPath}.motor`, MOTOR_KEYS);
    if ((object.frequencyHz !== undefined || object.dampingRatio !== undefined) && type !== "spring") {
      throw physicsSpecError(jointPath, "frequencyHz/dampingRatio are supported only for spring joints");
    }
    if (object.dampingRatio !== undefined && object.frequencyHz === undefined) {
      throw physicsSpecError(`${jointPath}.dampingRatio`, "requires frequencyHz");
    }
    const frequencyHz = object.frequencyHz === undefined ? undefined : nonNegativeNumber(object.frequencyHz, `${jointPath}.frequencyHz`, 0);
    const dampingRatio = frequencyHz === undefined ? undefined : nonNegativeNumber(object.dampingRatio, `${jointPath}.dampingRatio`, 1);
    if (frequencyHz !== undefined && frequencyHz > 1000) throw physicsSpecError(`${jointPath}.frequencyHz`, "must be at most 1000");
    if (dampingRatio !== undefined && dampingRatio > 10) throw physicsSpecError(`${jointPath}.dampingRatio`, "must be at most 10");
    setRecordEntry(resolved, id, {
      ...(frequencyHz === undefined ? {} : { frequencyHz, dampingRatio }),
      id,
      type,
      bodyA,
      bodyB,
      anchorX: anchor.x,
      anchorY: anchor.y,
      localAnchorAX: localAnchorA.x,
      localAnchorAY: localAnchorA.y,
      localAnchorBX: localAnchorB.x,
      localAnchorBY: localAnchorB.y,
      localAxisAX: localAxisA.x,
      localAxisAY: localAxisA.y,
      groundAnchorAX: groundAnchorA.x,
      groundAnchorAY: groundAnchorA.y,
      groundAnchorBX: groundAnchorB.x,
      groundAnchorBY: groundAnchorB.y,
      restLength: nonNegativeNumber(object.restLength, `${jointPath}.restLength`, 0),
      maxLength: nonNegativeNumber(object.maxLength, `${jointPath}.maxLength`, 0),
      stiffness: unitIntervalNumber(object.stiffness, `${jointPath}.stiffness`, 1),
      damping: unitIntervalNumber(object.damping, `${jointPath}.damping`, 0),
      enabled: booleanValue(object.enabled, `${jointPath}.enabled`, true),
      limitEnabled: booleanValue(limit.enabled, `${jointPath}.limit.enabled`, false),
      continuousLimit: type === "revolute"
        ? booleanValue(limit.continuous, `${jointPath}.limit.continuous`, false)
        : false,
      lowerLimit: finiteNumber(limit.lower, `${jointPath}.limit.lower`, 0),
      upperLimit: finiteNumber(limit.upper, `${jointPath}.limit.upper`, 0),
      motorEnabled: booleanValue(motor.enabled, `${jointPath}.motor.enabled`, false),
      motorSpeed: finiteNumber(motor.speed, `${jointPath}.motor.speed`, 0),
      maxMotorForce: nonNegativeNumber(motor.maxForce, `${jointPath}.motor.maxForce`, 0),
      maxMotorTorque: nonNegativeNumber(motor.maxTorque, `${jointPath}.motor.maxTorque`, 0),
      ratio: type === "pulley"
        ? positiveNumber(object.ratio, `${jointPath}.ratio`, 1)
        : finiteNumber(object.ratio, `${jointPath}.ratio`, 1),
      slack: booleanValue(object.slack, `${jointPath}.slack`, false),
      referenceAngle: finiteNumber(object.referenceAngle, `${jointPath}.referenceAngle`, 0),
      ...(object.breakForce === undefined ? {} : { breakForce: nonNegativeNumber(object.breakForce, `${jointPath}.breakForce`, 0) }),
      ...(object.breakTorque === undefined ? {} : { breakTorque: nonNegativeNumber(object.breakTorque, `${jointPath}.breakTorque`, 0) }),
      breakDistance: nonNegativeNumber(object.breakDistance, `${jointPath}.breakDistance`, 0),
      breakAngle: nonNegativeNumber(object.breakAngle, `${jointPath}.breakAngle`, 0),
    });
  }
  return resolved;
}
