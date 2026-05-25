import { physicsSpecDiagnosticError } from "./diagnostics.js";

export type PhysicsMode = "none" | "arcade" | "rigid";
export type PhysicsSpecBodyType = "static" | "kinematic" | "dynamic";
export type PhysicsSpecColliderShape =
  | "aabb"
  | "box"
  | "circle"
  | "capsule"
  | "orientedBox"
  | "convexPolygon"
  | "edge"
  | "chain";
export type PhysicsSpecJointType =
  | "distance"
  | "rope"
  | "spring"
  | "revolute"
  | "prismatic"
  | "weld"
  | "gear";

export type PhysicsSpecVector2 = readonly [number, number];

export interface PhysicsSpec {
  mode?: PhysicsMode;
  gravity?: PhysicsSpecVector2;
  continuous?: boolean;
  solver?: PhysicsSolverSpec;
  materials?: Record<string, PhysicsMaterialSpec>;
  layers?: Record<string, PhysicsLayerSpec>;
  bodies?: Record<string, PhysicsBodySpec>;
  joints?: Record<string, PhysicsJointSpec>;
  debug?: boolean | PhysicsDebugSpec;
}

export interface PhysicsSolverSpec {
  fixedTimestep?: boolean;
  stepSeconds?: number;
  velocityIterations?: number;
  positionIterations?: number;
  sleep?: boolean;
}

export interface PhysicsMaterialSpec {
  friction?: number;
  restitution?: number;
  density?: number;
}

export interface PhysicsLayerSpec {
  mask?: string[];
}

export interface PhysicsBodySpec {
  type?: PhysicsSpecBodyType;
  position?: PhysicsSpecVector2;
  rotationRadians?: number;
  velocity?: PhysicsSpecVector2;
  angularVelocityRadiansPerSecond?: number;
  mass?: number;
  inertia?: number;
  material?: string;
  layer?: string;
  collider?: PhysicsColliderSpec;
  colliders?: PhysicsColliderSpec[];
  gravityScale?: number;
  linearDamping?: number;
  angularDamping?: number;
  enabled?: boolean;
  canSleep?: boolean;
}

export type PhysicsColliderSpec =
  | PhysicsBoxColliderSpec
  | PhysicsCircleColliderSpec
  | PhysicsCapsuleColliderSpec
  | PhysicsOrientedBoxColliderSpec
  | PhysicsConvexPolygonColliderSpec
  | PhysicsEdgeColliderSpec
  | PhysicsChainColliderSpec;

export interface PhysicsColliderSpecBase {
  shape: PhysicsSpecColliderShape;
  offset?: PhysicsSpecVector2;
  material?: string;
  layer?: string;
  trigger?: boolean;
  enabled?: boolean;
}

export interface PhysicsBoxColliderSpec extends PhysicsColliderSpecBase {
  shape: "aabb" | "box";
  size?: PhysicsSpecVector2;
  halfSize?: PhysicsSpecVector2;
}

export interface PhysicsCircleColliderSpec extends PhysicsColliderSpecBase {
  shape: "circle";
  radius: number;
}

export interface PhysicsCapsuleColliderSpec extends PhysicsColliderSpecBase {
  shape: "capsule";
  start: PhysicsSpecVector2;
  end: PhysicsSpecVector2;
  radius: number;
}

export interface PhysicsOrientedBoxColliderSpec extends PhysicsColliderSpecBase {
  shape: "orientedBox";
  size?: PhysicsSpecVector2;
  halfSize?: PhysicsSpecVector2;
  rotationRadians?: number;
}

export interface PhysicsConvexPolygonColliderSpec extends PhysicsColliderSpecBase {
  shape: "convexPolygon";
  vertices: PhysicsSpecVector2[];
  rotationRadians?: number;
}

export interface PhysicsEdgeColliderSpec extends PhysicsColliderSpecBase {
  shape: "edge";
  start: PhysicsSpecVector2;
  end: PhysicsSpecVector2;
}

export interface PhysicsChainColliderSpec extends PhysicsColliderSpecBase {
  shape: "chain";
  vertices: PhysicsSpecVector2[];
  loop?: boolean;
}

export interface PhysicsJointSpec {
  type: PhysicsSpecJointType;
  bodyA: string;
  bodyB: string;
  anchor?: PhysicsSpecVector2;
  localAnchorA?: PhysicsSpecVector2;
  localAnchorB?: PhysicsSpecVector2;
  localAxisA?: PhysicsSpecVector2;
  restLength?: number;
  maxLength?: number;
  stiffness?: number;
  damping?: number;
  enabled?: boolean;
  limit?: PhysicsJointLimitSpec;
  motor?: PhysicsJointMotorSpec;
  ratio?: number;
  referenceAngle?: number;
  breakDistance?: number;
  breakAngle?: number;
}

export interface PhysicsJointLimitSpec {
  enabled?: boolean;
  lower?: number;
  upper?: number;
}

export interface PhysicsJointMotorSpec {
  enabled?: boolean;
  speed?: number;
  maxForce?: number;
  maxTorque?: number;
}

export interface PhysicsDebugSpec {
  colliders?: boolean;
  contacts?: boolean;
  manifolds?: boolean;
  broadphase?: boolean;
  joints?: boolean;
  sleeping?: boolean;
  layers?: boolean;
  ccd?: boolean;
}

export interface ResolvedPhysicsSpec {
  mode: PhysicsMode;
  gravityX: number;
  gravityY: number;
  continuous: boolean;
  solver: ResolvedPhysicsSolverSpec;
  materials: Record<string, ResolvedPhysicsMaterialSpec>;
  layers: Record<string, ResolvedPhysicsLayerSpec>;
  bodies: Record<string, ResolvedPhysicsBodySpec>;
  joints: Record<string, ResolvedPhysicsJointSpec>;
  debug: ResolvedPhysicsDebugSpec;
}

export interface ResolvedPhysicsSolverSpec {
  fixedTimestep: boolean;
  stepSeconds: number;
  velocityIterations: number;
  positionIterations: number;
  sleep: boolean;
}

export interface ResolvedPhysicsMaterialSpec {
  friction: number;
  restitution: number;
  density: number;
}

export interface ResolvedPhysicsLayerSpec {
  name: string;
  categoryBits: number;
  mask: string[];
  maskBits: number;
}

export interface ResolvedPhysicsBodySpec {
  id: string;
  type: PhysicsSpecBodyType;
  positionX: number;
  positionY: number;
  rotationRadians: number;
  velocityX: number;
  velocityY: number;
  angularVelocityRadiansPerSecond: number;
  mass?: number;
  inertia?: number;
  material?: string;
  layer?: string;
  colliders: ResolvedPhysicsColliderSpec[];
  gravityScale: number;
  linearDamping: number;
  angularDamping: number;
  enabled: boolean;
  canSleep: boolean;
}

export type ResolvedPhysicsColliderSpec =
  | ResolvedPhysicsBoxColliderSpec
  | ResolvedPhysicsCircleColliderSpec
  | ResolvedPhysicsCapsuleColliderSpec
  | ResolvedPhysicsOrientedBoxColliderSpec
  | ResolvedPhysicsConvexPolygonColliderSpec
  | ResolvedPhysicsEdgeColliderSpec
  | ResolvedPhysicsChainColliderSpec;

export interface ResolvedPhysicsColliderBaseSpec {
  shape: PhysicsSpecColliderShape;
  offsetX: number;
  offsetY: number;
  material?: string;
  layer?: string;
  trigger: boolean;
  enabled: boolean;
}

export interface ResolvedPhysicsBoxColliderSpec extends ResolvedPhysicsColliderBaseSpec {
  shape: "aabb" | "box";
  halfWidth: number;
  halfHeight: number;
}

export interface ResolvedPhysicsCircleColliderSpec extends ResolvedPhysicsColliderBaseSpec {
  shape: "circle";
  radius: number;
}

export interface ResolvedPhysicsCapsuleColliderSpec extends ResolvedPhysicsColliderBaseSpec {
  shape: "capsule";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  radius: number;
}

export interface ResolvedPhysicsOrientedBoxColliderSpec extends ResolvedPhysicsColliderBaseSpec {
  shape: "orientedBox";
  halfWidth: number;
  halfHeight: number;
  rotationRadians: number;
}

export interface ResolvedPhysicsConvexPolygonColliderSpec extends ResolvedPhysicsColliderBaseSpec {
  shape: "convexPolygon";
  vertices: ResolvedPhysicsVector2[];
  rotationRadians: number;
}

export interface ResolvedPhysicsEdgeColliderSpec extends ResolvedPhysicsColliderBaseSpec {
  shape: "edge";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface ResolvedPhysicsChainColliderSpec extends ResolvedPhysicsColliderBaseSpec {
  shape: "chain";
  vertices: ResolvedPhysicsVector2[];
  loop: boolean;
}

export interface ResolvedPhysicsVector2 {
  x: number;
  y: number;
}

export interface ResolvedPhysicsJointSpec {
  id: string;
  type: PhysicsSpecJointType;
  bodyA: string;
  bodyB: string;
  anchorX: number;
  anchorY: number;
  localAnchorAX: number;
  localAnchorAY: number;
  localAnchorBX: number;
  localAnchorBY: number;
  localAxisAX: number;
  localAxisAY: number;
  restLength: number;
  maxLength: number;
  stiffness: number;
  damping: number;
  enabled: boolean;
  limitEnabled: boolean;
  lowerLimit: number;
  upperLimit: number;
  motorEnabled: boolean;
  motorSpeed: number;
  maxMotorForce: number;
  maxMotorTorque: number;
  ratio: number;
  referenceAngle: number;
  breakDistance: number;
  breakAngle: number;
}

export interface ResolvedPhysicsDebugSpec {
  enabled: boolean;
  colliders: boolean;
  contacts: boolean;
  manifolds: boolean;
  broadphase: boolean;
  joints: boolean;
  sleeping: boolean;
  layers: boolean;
  ccd: boolean;
}

export interface ResolvePhysicsSpecOptions {
  path?: string;
  defaultMode?: PhysicsMode;
  modeOverride?: PhysicsMode;
}

export const DEFAULT_PHYSICS_MODE: PhysicsMode = "arcade";

const DEFAULT_MATERIAL: ResolvedPhysicsMaterialSpec = Object.freeze({
  friction: 0.4,
  restitution: 0,
  density: 1,
});

const MODE_DEFAULTS: Record<PhysicsMode, {
  gravityX: number;
  gravityY: number;
  continuous: boolean;
  solver: ResolvedPhysicsSolverSpec;
}> = Object.freeze({
  none: {
    gravityX: 0,
    gravityY: 0,
    continuous: false,
    solver: {
      fixedTimestep: false,
      stepSeconds: 1 / 60,
      velocityIterations: 0,
      positionIterations: 0,
      sleep: false,
    },
  },
  arcade: {
    gravityX: 0,
    gravityY: 0,
    continuous: false,
    solver: {
      fixedTimestep: true,
      stepSeconds: 1 / 60,
      velocityIterations: 1,
      positionIterations: 1,
      sleep: false,
    },
  },
  rigid: {
    gravityX: 0,
    gravityY: 700,
    continuous: true,
    solver: {
      fixedTimestep: true,
      stepSeconds: 1 / 60,
      velocityIterations: 8,
      positionIterations: 8,
      sleep: true,
    },
  },
});

const PHYSICS_KEYS = new Set([
  "mode",
  "gravity",
  "continuous",
  "solver",
  "materials",
  "layers",
  "bodies",
  "joints",
  "debug",
]);
const SOLVER_KEYS = new Set(["fixedTimestep", "stepSeconds", "velocityIterations", "positionIterations", "sleep"]);
const MATERIAL_KEYS = new Set(["friction", "restitution", "density"]);
const LAYER_KEYS = new Set(["mask"]);
const BODY_KEYS = new Set([
  "type",
  "position",
  "rotationRadians",
  "velocity",
  "angularVelocityRadiansPerSecond",
  "mass",
  "inertia",
  "material",
  "layer",
  "collider",
  "colliders",
  "gravityScale",
  "linearDamping",
  "angularDamping",
  "enabled",
  "canSleep",
]);
const COLLIDER_BASE_KEYS = new Set(["shape", "offset", "material", "layer", "trigger", "enabled"]);
const JOINT_KEYS = new Set([
  "type",
  "bodyA",
  "bodyB",
  "anchor",
  "localAnchorA",
  "localAnchorB",
  "localAxisA",
  "restLength",
  "maxLength",
  "stiffness",
  "damping",
  "enabled",
  "limit",
  "motor",
  "ratio",
  "referenceAngle",
  "breakDistance",
  "breakAngle",
]);
const LIMIT_KEYS = new Set(["enabled", "lower", "upper"]);
const MOTOR_KEYS = new Set(["enabled", "speed", "maxForce", "maxTorque"]);
const DEBUG_KEYS = new Set(["colliders", "contacts", "manifolds", "broadphase", "joints", "sleeping", "layers", "ccd"]);

export function resolvePhysicsSpec(input: unknown, options: ResolvePhysicsSpecOptions = {}): ResolvedPhysicsSpec {
  const path = options.path ?? "physics";
  const spec = optionalObject(input, path);
  rejectUnknownKeys(spec, path, PHYSICS_KEYS);
  const mode = options.modeOverride ?? resolvePhysicsMode(
    spec.mode,
    `${path}.mode`,
    options.defaultMode ?? DEFAULT_PHYSICS_MODE,
  );
  const modeDefaults = MODE_DEFAULTS[mode];
  const solver = physicsSolverSpec(spec.solver, `${path}.solver`, modeDefaults.solver);
  const materials = physicsMaterials(spec.materials, `${path}.materials`);
  const layers = physicsLayers(spec.layers, `${path}.layers`);
  const bodies = physicsBodies(spec.bodies, `${path}.bodies`, materials, layers);
  const joints = physicsJoints(spec.joints, `${path}.joints`, bodies);
  const gravity = vector2(spec.gravity, `${path}.gravity`, {
    x: modeDefaults.gravityX,
    y: modeDefaults.gravityY,
  });

  return {
    mode,
    gravityX: gravity.x,
    gravityY: gravity.y,
    continuous: booleanValue(spec.continuous, `${path}.continuous`, modeDefaults.continuous),
    solver,
    materials,
    layers,
    bodies,
    joints,
    debug: physicsDebugSpec(spec.debug, `${path}.debug`),
  };
}

export function resolvePhysicsMode(value: unknown, path: string, fallback = DEFAULT_PHYSICS_MODE): PhysicsMode {
  if (value === undefined) {
    return fallback;
  }
  if (value === "none" || value === "arcade" || value === "rigid") {
    return value;
  }
  throw physicsSpecError(path, "must be one of none, arcade, or rigid");
}

function physicsSolverSpec(
  value: unknown,
  path: string,
  defaults: ResolvedPhysicsSolverSpec,
): ResolvedPhysicsSolverSpec {
  const solver = optionalObject(value, path);
  rejectUnknownKeys(solver, path, SOLVER_KEYS);
  return {
    fixedTimestep: booleanValue(solver.fixedTimestep, `${path}.fixedTimestep`, defaults.fixedTimestep),
    stepSeconds: positiveNumber(solver.stepSeconds, `${path}.stepSeconds`, defaults.stepSeconds),
    velocityIterations: nonNegativeInteger(solver.velocityIterations, `${path}.velocityIterations`, defaults.velocityIterations),
    positionIterations: nonNegativeInteger(solver.positionIterations, `${path}.positionIterations`, defaults.positionIterations),
    sleep: booleanValue(solver.sleep, `${path}.sleep`, defaults.sleep),
  };
}

function physicsMaterials(value: unknown, path: string): Record<string, ResolvedPhysicsMaterialSpec> {
  const materials = optionalObject(value, path);
  return Object.fromEntries(Object.entries(materials).map(([name, material]) => {
    const materialPath = `${path}.${name}`;
    requireName(name, materialPath);
    const object = requiredObject(material, materialPath);
    rejectUnknownKeys(object, materialPath, MATERIAL_KEYS);
    return [name, {
      friction: nonNegativeNumber(object.friction, `${materialPath}.friction`, DEFAULT_MATERIAL.friction),
      restitution: nonNegativeNumber(object.restitution, `${materialPath}.restitution`, DEFAULT_MATERIAL.restitution),
      density: positiveNumber(object.density, `${materialPath}.density`, DEFAULT_MATERIAL.density),
    }];
  }));
}

function physicsLayers(value: unknown, path: string): Record<string, ResolvedPhysicsLayerSpec> {
  const layers = optionalObject(value, path);
  const names = Object.keys(layers);
  if (names.length > 31) {
    throw physicsSpecError(path, "must contain at most 31 layers");
  }
  const nameSet = new Set(names);
  return Object.fromEntries(Object.entries(layers).map(([name, layer], index) => {
    const layerPath = `${path}.${name}`;
    requireName(name, layerPath);
    const object = requiredObject(layer, layerPath);
    rejectUnknownKeys(object, layerPath, LAYER_KEYS);
    const mask = stringArray(object.mask, `${layerPath}.mask`, []);
    for (const target of mask) {
      if (!nameSet.has(target)) {
        throw physicsSpecError(`${layerPath}.mask`, `must reference an existing layer: ${target}`);
      }
    }
    return [name, {
      name,
      categoryBits: 1 << index,
      mask,
      maskBits: mask.reduce((bits, target) => bits | (1 << names.indexOf(target)), 0),
    }];
  }));
}

function physicsBodies(
  value: unknown,
  path: string,
  materials: Record<string, ResolvedPhysicsMaterialSpec>,
  layers: Record<string, ResolvedPhysicsLayerSpec>,
): Record<string, ResolvedPhysicsBodySpec> {
  const bodies = optionalObject(value, path);
  return Object.fromEntries(Object.entries(bodies).map(([id, body]) => {
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
    return [id, {
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
      ...(object.mass === undefined ? {} : { mass: positiveNumber(object.mass, `${bodyPath}.mass`, 1) }),
      ...(object.inertia === undefined ? {} : { inertia: positiveNumber(object.inertia, `${bodyPath}.inertia`, 1) }),
      ...(material ? { material } : {}),
      ...(layer ? { layer } : {}),
      colliders,
      gravityScale: finiteNumber(object.gravityScale, `${bodyPath}.gravityScale`, 1),
      linearDamping: nonNegativeNumber(object.linearDamping, `${bodyPath}.linearDamping`, 0),
      angularDamping: nonNegativeNumber(object.angularDamping, `${bodyPath}.angularDamping`, 0),
      enabled: booleanValue(object.enabled, `${bodyPath}.enabled`, true),
      canSleep: booleanValue(object.canSleep, `${bodyPath}.canSleep`, true),
    }];
  }));
}

function physicsColliderArray(
  value: unknown,
  path: string,
  materials: Record<string, ResolvedPhysicsMaterialSpec>,
  layers: Record<string, ResolvedPhysicsLayerSpec>,
): ResolvedPhysicsColliderSpec[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw physicsSpecError(path, "must be an array");
  }
  return value.map((collider, index) => physicsCollider(collider, `${path}.${index}`, materials, layers));
}

function physicsCollider(
  value: unknown,
  path: string,
  materials: Record<string, ResolvedPhysicsMaterialSpec>,
  layers: Record<string, ResolvedPhysicsLayerSpec>,
): ResolvedPhysicsColliderSpec {
  const object = requiredObject(value, path);
  const shape = colliderShape(object.shape, `${path}.shape`);
  rejectUnknownKeys(object, path, new Set([...COLLIDER_BASE_KEYS, ...colliderSpecificKeys(shape)]));
  const base = physicsColliderBase(object, path, shape, materials, layers);
  switch (shape) {
    case "aabb":
    case "box": {
      const halfSize = boxHalfSize(object, path);
      return { ...base, shape, halfWidth: halfSize.x, halfHeight: halfSize.y };
    }
    case "circle":
      return { ...base, shape, radius: positiveNumber(object.radius, `${path}.radius`, 1) };
    case "capsule": {
      const start = requiredVector2(object.start, `${path}.start`);
      const end = requiredVector2(object.end, `${path}.end`);
      requireDistinctPoints(start, end, path);
      return {
        ...base,
        shape,
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
        radius: positiveNumber(object.radius, `${path}.radius`, 1),
      };
    }
    case "orientedBox": {
      const halfSize = boxHalfSize(object, path);
      return {
        ...base,
        shape,
        halfWidth: halfSize.x,
        halfHeight: halfSize.y,
        rotationRadians: finiteNumber(object.rotationRadians, `${path}.rotationRadians`, 0),
      };
    }
    case "convexPolygon":
      return {
        ...base,
        shape,
        vertices: convexPolygonVertices(object.vertices, `${path}.vertices`),
        rotationRadians: finiteNumber(object.rotationRadians, `${path}.rotationRadians`, 0),
      };
    case "edge": {
      const start = requiredVector2(object.start, `${path}.start`);
      const end = requiredVector2(object.end, `${path}.end`);
      requireDistinctPoints(start, end, path);
      return { ...base, shape, startX: start.x, startY: start.y, endX: end.x, endY: end.y };
    }
    case "chain":
      return {
        ...base,
        shape,
        vertices: polygonVertices(object.vertices, `${path}.vertices`, 2),
        loop: booleanValue(object.loop, `${path}.loop`, false),
      };
  }
}

function physicsColliderBase(
  object: Record<string, unknown>,
  path: string,
  shape: PhysicsSpecColliderShape,
  materials: Record<string, ResolvedPhysicsMaterialSpec>,
  layers: Record<string, ResolvedPhysicsLayerSpec>,
): ResolvedPhysicsColliderBaseSpec {
  const offset = vector2(object.offset, `${path}.offset`, { x: 0, y: 0 });
  const material = optionalReference(object.material, `${path}.material`, materials);
  const layer = optionalReference(object.layer, `${path}.layer`, layers);
  return {
    shape,
    offsetX: offset.x,
    offsetY: offset.y,
    ...(material ? { material } : {}),
    ...(layer ? { layer } : {}),
    trigger: booleanValue(object.trigger, `${path}.trigger`, false),
    enabled: booleanValue(object.enabled, `${path}.enabled`, true),
  };
}

function physicsJoints(
  value: unknown,
  path: string,
  bodies: Record<string, ResolvedPhysicsBodySpec>,
): Record<string, ResolvedPhysicsJointSpec> {
  const joints = optionalObject(value, path);
  return Object.fromEntries(Object.entries(joints).map(([id, joint]) => {
    const jointPath = `${path}.${id}`;
    requireName(id, jointPath);
    const object = requiredObject(joint, jointPath);
    rejectUnknownKeys(object, jointPath, JOINT_KEYS);
    const type = jointType(object.type, `${jointPath}.type`);
    const bodyA = bodyReference(object.bodyA, `${jointPath}.bodyA`, bodies);
    const bodyB = bodyReference(object.bodyB, `${jointPath}.bodyB`, bodies);
    if (bodyA === bodyB && bodyA !== "world") {
      throw physicsSpecError(`${jointPath}.bodyB`, "must not reference the same body as bodyA");
    }
    const anchor = vector2(object.anchor, `${jointPath}.anchor`, { x: 0, y: 0 });
    const localAnchorA = vector2(object.localAnchorA, `${jointPath}.localAnchorA`, { x: 0, y: 0 });
    const localAnchorB = vector2(object.localAnchorB, `${jointPath}.localAnchorB`, { x: 0, y: 0 });
    const localAxisA = vector2(object.localAxisA, `${jointPath}.localAxisA`, { x: 1, y: 0 });
    const limit = optionalObject(object.limit, `${jointPath}.limit`);
    rejectUnknownKeys(limit, `${jointPath}.limit`, LIMIT_KEYS);
    const motor = optionalObject(object.motor, `${jointPath}.motor`);
    rejectUnknownKeys(motor, `${jointPath}.motor`, MOTOR_KEYS);
    return [id, {
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
      restLength: nonNegativeNumber(object.restLength, `${jointPath}.restLength`, 0),
      maxLength: nonNegativeNumber(object.maxLength, `${jointPath}.maxLength`, 0),
      stiffness: unitIntervalNumber(object.stiffness, `${jointPath}.stiffness`, 1),
      damping: unitIntervalNumber(object.damping, `${jointPath}.damping`, 0),
      enabled: booleanValue(object.enabled, `${jointPath}.enabled`, true),
      limitEnabled: booleanValue(limit.enabled, `${jointPath}.limit.enabled`, false),
      lowerLimit: finiteNumber(limit.lower, `${jointPath}.limit.lower`, 0),
      upperLimit: finiteNumber(limit.upper, `${jointPath}.limit.upper`, 0),
      motorEnabled: booleanValue(motor.enabled, `${jointPath}.motor.enabled`, false),
      motorSpeed: finiteNumber(motor.speed, `${jointPath}.motor.speed`, 0),
      maxMotorForce: nonNegativeNumber(motor.maxForce, `${jointPath}.motor.maxForce`, 0),
      maxMotorTorque: nonNegativeNumber(motor.maxTorque, `${jointPath}.motor.maxTorque`, 0),
      ratio: finiteNumber(object.ratio, `${jointPath}.ratio`, 1),
      referenceAngle: finiteNumber(object.referenceAngle, `${jointPath}.referenceAngle`, 0),
      breakDistance: nonNegativeNumber(object.breakDistance, `${jointPath}.breakDistance`, 0),
      breakAngle: nonNegativeNumber(object.breakAngle, `${jointPath}.breakAngle`, 0),
    }];
  }));
}

function physicsDebugSpec(value: unknown, path: string): ResolvedPhysicsDebugSpec {
  if (value === undefined || value === false) {
    return disabledDebugSpec();
  }
  if (value === true) {
    return enabledDebugSpec();
  }
  const object = requiredObject(value, path);
  rejectUnknownKeys(object, path, DEBUG_KEYS);
  const enabled = true;
  return {
    enabled,
    colliders: booleanValue(object.colliders, `${path}.colliders`, false),
    contacts: booleanValue(object.contacts, `${path}.contacts`, false),
    manifolds: booleanValue(object.manifolds, `${path}.manifolds`, false),
    broadphase: booleanValue(object.broadphase, `${path}.broadphase`, false),
    joints: booleanValue(object.joints, `${path}.joints`, false),
    sleeping: booleanValue(object.sleeping, `${path}.sleeping`, false),
    layers: booleanValue(object.layers, `${path}.layers`, false),
    ccd: booleanValue(object.ccd, `${path}.ccd`, false),
  };
}

function disabledDebugSpec(): ResolvedPhysicsDebugSpec {
  return {
    enabled: false,
    colliders: false,
    contacts: false,
    manifolds: false,
    broadphase: false,
    joints: false,
    sleeping: false,
    layers: false,
    ccd: false,
  };
}

function enabledDebugSpec(): ResolvedPhysicsDebugSpec {
  return {
    enabled: true,
    colliders: true,
    contacts: true,
    manifolds: true,
    broadphase: true,
    joints: true,
    sleeping: true,
    layers: true,
    ccd: true,
  };
}

function colliderSpecificKeys(shape: PhysicsSpecColliderShape): readonly string[] {
  switch (shape) {
    case "aabb":
    case "box":
    case "orientedBox":
      return ["size", "halfSize", "rotationRadians"];
    case "circle":
      return ["radius"];
    case "capsule":
      return ["start", "end", "radius"];
    case "convexPolygon":
      return ["vertices", "rotationRadians"];
    case "edge":
      return ["start", "end"];
    case "chain":
      return ["vertices", "loop"];
  }
}

function boxHalfSize(object: Record<string, unknown>, path: string): ResolvedPhysicsVector2 {
  if (object.size !== undefined && object.halfSize !== undefined) {
    throw physicsSpecError(`${path}.size`, "cannot be combined with halfSize");
  }
  if (object.halfSize !== undefined) {
    return requiredPositiveVector2(object.halfSize, `${path}.halfSize`);
  }
  const size = requiredPositiveVector2(object.size, `${path}.size`);
  return { x: size.x / 2, y: size.y / 2 };
}

function polygonVertices(value: unknown, path: string, minItems: number): ResolvedPhysicsVector2[] {
  if (!Array.isArray(value)) {
    throw physicsSpecError(path, "must be an array");
  }
  if (value.length < minItems) {
    throw physicsSpecError(path, `must contain at least ${minItems} vertices`);
  }
  if (value.length > 64) {
    throw physicsSpecError(path, "must contain at most 64 vertices");
  }
  const vertices = value.map((vertex, index) => requiredVector2(vertex, `${path}.${index}`));
  for (let index = 1; index < vertices.length; index += 1) {
    requireDistinctPoints(vertices[index - 1], vertices[index], `${path}.${index}`);
  }
  return vertices;
}

function convexPolygonVertices(value: unknown, path: string): ResolvedPhysicsVector2[] {
  const vertices = polygonVertices(value, path, 3);
  if (vertices.length > 16) {
    throw physicsSpecError(path, "must define a convex polygon with at most 16 vertices");
  }
  if (!isStrictlyConvexPolygon(vertices)) {
    throw physicsSpecError(path, "must define a convex polygon with non-collinear vertices");
  }
  return vertices;
}

function isStrictlyConvexPolygon(vertices: readonly ResolvedPhysicsVector2[]): boolean {
  let sign = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index];
    const b = vertices[(index + 1) % vertices.length];
    const c = vertices[(index + 2) % vertices.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) {
      return false;
    }
    const currentSign = Math.sign(cross);
    if (sign === 0) {
      sign = currentSign;
      continue;
    }
    if (currentSign !== sign) {
      return false;
    }
  }
  return true;
}

function optionalObject(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  return requiredObject(value, path);
}

function requiredObject(value: unknown, path: string): Record<string, unknown> {
  if (isObject(value)) {
    return value;
  }
  throw physicsSpecError(path, "must be an object");
}

function rejectUnknownKeys(object: Record<string, unknown>, path: string, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      throw physicsSpecError(`${path}.${key}`, "is not a supported physics spec field");
    }
  }
}

function vector2(value: unknown, path: string, fallback: ResolvedPhysicsVector2): ResolvedPhysicsVector2 {
  if (value === undefined) {
    return fallback;
  }
  return requiredVector2(value, path);
}

function requiredVector2(value: unknown, path: string): ResolvedPhysicsVector2 {
  if (!Array.isArray(value) || value.length !== 2) {
    throw physicsSpecError(path, "must be a [x, y] array");
  }
  return {
    x: requiredFiniteNumber(value[0], `${path}.0`),
    y: requiredFiniteNumber(value[1], `${path}.1`),
  };
}

function requiredPositiveVector2(value: unknown, path: string): ResolvedPhysicsVector2 {
  if (!Array.isArray(value) || value.length !== 2) {
    throw physicsSpecError(path, "must be a [x, y] array");
  }
  return {
    x: requiredPositiveNumber(value[0], `${path}.0`),
    y: requiredPositiveNumber(value[1], `${path}.1`),
  };
}

function stringArray(value: unknown, path: string, fallback: string[]): string[] {
  if (value === undefined) {
    return fallback;
  }
  if (!Array.isArray(value)) {
    throw physicsSpecError(path, "must be an array");
  }
  return value.map((item, index) => {
    if (typeof item === "string" && item.trim().length > 0) {
      return item;
    }
    throw physicsSpecError(`${path}.${index}`, "must be a non-empty string");
  });
}

function optionalReference<T>(value: unknown, path: string, targets: Record<string, T>): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const name = requiredString(value, path);
  if (!(name in targets)) {
    throw physicsSpecError(path, `must reference an existing id: ${name}`);
  }
  return name;
}

function bodyReference(
  value: unknown,
  path: string,
  bodies: Record<string, ResolvedPhysicsBodySpec>,
): string {
  const name = requiredString(value, path);
  if (name === "world" || name in bodies) {
    return name;
  }
  throw physicsSpecError(path, `must reference an existing body or world: ${name}`);
}

function requireName(name: string, path: string): void {
  if (name.trim().length === 0) {
    throw physicsSpecError(path, "id must be a non-empty string");
  }
}

function requiredString(value: unknown, path: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  throw physicsSpecError(path, "must be a non-empty string");
}

function bodyType(value: unknown, path: string): PhysicsSpecBodyType {
  if (value === undefined) {
    return "dynamic";
  }
  if (value === "static" || value === "kinematic" || value === "dynamic") {
    return value;
  }
  throw physicsSpecError(path, "must be one of static, kinematic, or dynamic");
}

function colliderShape(value: unknown, path: string): PhysicsSpecColliderShape {
  if (
    value === "aabb" ||
    value === "box" ||
    value === "circle" ||
    value === "capsule" ||
    value === "orientedBox" ||
    value === "convexPolygon" ||
    value === "edge" ||
    value === "chain"
  ) {
    return value;
  }
  throw physicsSpecError(path, "must be a supported collider shape");
}

function jointType(value: unknown, path: string): PhysicsSpecJointType {
  if (
    value === "distance" ||
    value === "rope" ||
    value === "spring" ||
    value === "revolute" ||
    value === "prismatic" ||
    value === "weld" ||
    value === "gear"
  ) {
    return value;
  }
  throw physicsSpecError(path, "must be a supported joint type");
}

function booleanValue(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  throw physicsSpecError(path, "must be a boolean");
}

function positiveNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  return requiredPositiveNumber(value, path);
}

function requiredPositiveNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  throw physicsSpecError(path, "must be a positive finite number");
}

function nonNegativeNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  throw physicsSpecError(path, "must be a non-negative finite number");
}

function finiteNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  return requiredFiniteNumber(value, path);
}

function requiredFiniteNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw physicsSpecError(path, "must be a finite number");
}

function nonNegativeInteger(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw physicsSpecError(path, "must be a non-negative integer");
}

function unitIntervalNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }
  throw physicsSpecError(path, "must be a finite number between 0 and 1");
}

function requireDistinctPoints(a: ResolvedPhysicsVector2, b: ResolvedPhysicsVector2, path: string): void {
  if (a.x === b.x && a.y === b.y) {
    throw physicsSpecError(path, "must use distinct points");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function physicsSpecError(path: string, detail: string): Error {
  return physicsSpecDiagnosticError(path, detail);
}
