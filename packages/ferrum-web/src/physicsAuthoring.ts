import type {
  FerrumEngine,
  PhysicsCollisionLayer,
  PhysicsEntityHandle,
  PhysicsJointHandle,
  PhysicsJointSpawnOptions,
  PhysicsRigidBodyCollider,
  PhysicsRigidBodyMaterial,
  PhysicsRigidBodySpawnOptions,
  PhysicsRigidBodyStepOptions,
  PhysicsRigidBodyType,
} from "./createEngine.js";
import { describeError, physicsSpecDiagnosticError } from "./diagnostics.js";
import { resolvePhysicsSpec } from "./physicsSpec.js";
import type {
  PhysicsSpec,
  PhysicsSpecVector2,
  ResolvedPhysicsBodySpec,
  ResolvedPhysicsChainColliderSpec,
  ResolvedPhysicsColliderSpec,
  ResolvedPhysicsDebugSpec,
  ResolvedPhysicsJointSpec,
  ResolvedPhysicsLayerSpec,
  ResolvedPhysicsMaterialSpec,
  ResolvedPhysicsSpec,
  ResolvedPhysicsVector2,
} from "./physicsSpec.js";

export const PHYSICS_MATERIAL_PRESETS = {
  default: { friction: 0.4, restitution: 0, density: 1 },
  ice: { friction: 0.02, restitution: 0.05, density: 1 },
  rubber: { friction: 0.8, restitution: 0.9, density: 1 },
  wood: { friction: 0.6, restitution: 0.2, density: 0.8 },
  metal: { friction: 0.35, restitution: 0.05, density: 3 },
  platform: { friction: 0.7, restitution: 0, density: 1 },
} as const satisfies Record<string, Readonly<Required<Pick<PhysicsRigidBodyMaterial, "friction" | "restitution" | "density">>>>;

export const PHYSICS_BUILTIN_COLLISION_LAYERS = ["player", "enemy", "bullet", "wall"] as const;

export const PHYSICS_COMMON_LAYER_PATTERN = {
  player: ["world", "enemy", "pickup", "trigger"],
  world: ["player", "enemy", "projectile"],
  enemy: ["player", "world", "projectile"],
  projectile: ["world", "enemy"],
  pickup: ["player"],
  trigger: ["player", "enemy"],
  sensor: ["player", "enemy"],
} as const satisfies PhysicsLayerPattern;

export type PhysicsMaterialPresetName = keyof typeof PHYSICS_MATERIAL_PRESETS;
export type PhysicsMaterialAuthoringInput = PhysicsMaterialPresetName | PhysicsRigidBodyMaterial;
export type PhysicsJointEndpoint = PhysicsEntityHandle | "world";

export interface PhysicsLayerPatternEntry {
  mask?: readonly string[];
}

export type PhysicsLayerPattern = Record<string, readonly string[] | PhysicsLayerPatternEntry>;

export interface PhysicsAuthoringLayer {
  name: string;
  categoryBits: number;
  mask: readonly string[];
  maskBits: number;
}

export interface PhysicsLayerMapOptions {
  path?: string;
}

export interface PhysicsWorldApplyOptions {
  path?: string;
  replace?: PhysicsWorldApplyResult;
  unsafeUnitScaleThreshold?: number;
  onWarning?: (warning: PhysicsWorldApplyWarning) => void;
}

export interface PhysicsWorldApplyWarning {
  path: string;
  detail: string;
  message: string;
}

export interface PhysicsWorldApplyResult {
  spec: ResolvedPhysicsSpec;
  bodies: Record<string, PhysicsEntityHandle>;
  joints: Record<string, PhysicsJointHandle>;
  worldAnchors: readonly PhysicsEntityHandle[];
  bodyCount: number;
  jointCount: number;
  warningCount: number;
  warnings: readonly PhysicsWorldApplyWarning[];
  stepSeconds: number;
  stepOptions: PhysicsRigidBodyStepOptions;
  clear(): void;
}

export type PhysicsColliderAuthoringOptions =
  | {
      type: "aabb" | "box";
      size?: PhysicsSpecVector2;
      halfSize?: PhysicsSpecVector2;
      offset?: PhysicsSpecVector2;
    }
  | {
      type: "circle";
      radius: number;
      offset?: PhysicsSpecVector2;
    }
  | {
      type: "capsule";
      start: PhysicsSpecVector2;
      end: PhysicsSpecVector2;
      radius: number;
      offset?: PhysicsSpecVector2;
    }
  | {
      type: "orientedBox";
      size?: PhysicsSpecVector2;
      halfSize?: PhysicsSpecVector2;
      rotationRadians?: number;
      offset?: PhysicsSpecVector2;
    }
  | {
      type: "convexPolygon";
      vertices: readonly PhysicsSpecVector2[];
      rotationRadians?: number;
      offset?: PhysicsSpecVector2;
    }
  | {
      type: "edge";
      start: PhysicsSpecVector2;
      end: PhysicsSpecVector2;
      offset?: PhysicsSpecVector2;
    };

export interface PhysicsRigidBodyAuthoringOptions {
  type?: PhysicsRigidBodyType;
  position?: PhysicsSpecVector2;
  rotationRadians?: number;
  velocity?: PhysicsSpecVector2;
  angularVelocityRadiansPerSecond?: number;
  collider: PhysicsColliderAuthoringOptions;
  material?: PhysicsMaterialAuthoringInput;
  colliderMaterial?: PhysicsMaterialAuthoringInput;
  layer?: string;
  categoryBits?: number;
  maskBits?: number;
  mass?: number;
  inertia?: number;
  density?: number;
  gravityScale?: number;
  linearDamping?: number;
  angularDamping?: number;
  enabled?: boolean;
  colliderEnabled?: boolean;
  trigger?: boolean;
  canSleep?: boolean;
}

interface RuntimeResolvedCollider {
  collider: PhysicsRigidBodyCollider;
  path: string;
}

interface PhysicsJointAuthoringBase {
  bodyA: PhysicsJointEndpoint;
  bodyB: PhysicsJointEndpoint;
  anchor?: PhysicsSpecVector2;
  localAnchorA?: PhysicsSpecVector2;
  localAnchorB?: PhysicsSpecVector2;
  stiffness?: number;
  damping?: number;
  enabled?: boolean;
}

export type PhysicsJointAuthoringOptions =
  | (PhysicsJointAuthoringBase & {
      type: "distance";
      restLength: number;
      breakDistance?: number;
    })
  | (PhysicsJointAuthoringBase & {
      type: "rope";
      maxLength: number;
      breakDistance?: number;
    })
  | (PhysicsJointAuthoringBase & {
      type: "spring";
      restLength: number;
      breakDistance?: number;
    })
  | (PhysicsJointAuthoringBase & {
      type: "revolute";
      breakDistance?: number;
      limit?: { enabled?: boolean; lower?: number; upper?: number };
      motor?: { enabled?: boolean; speed?: number; maxTorque?: number };
    })
  | (PhysicsJointAuthoringBase & {
      type: "prismatic";
      localAxisA?: PhysicsSpecVector2;
      referenceAngle?: number;
      angularStiffness?: number;
      angularDamping?: number;
      breakDistance?: number;
      limit?: { enabled?: boolean; lower?: number; upper?: number };
      motor?: { enabled?: boolean; speed?: number; maxForce?: number };
    })
  | (PhysicsJointAuthoringBase & {
      type: "weld";
      referenceAngle?: number;
      angularStiffness?: number;
      angularDamping?: number;
      breakDistance?: number;
      breakAngle?: number;
    })
  | (PhysicsJointAuthoringBase & {
      type: "gear";
      ratio?: number;
      referenceAngle?: number;
      breakAngle?: number;
    });

export interface PhysicsAuthoringContext {
  path?: string;
}

const DEFAULT_APPLY_PATH = "physics";
const DEFAULT_UNSAFE_UNIT_SCALE_THRESHOLD = 5000;
const BUILTIN_COLLISION_LAYER_SET = new Set<string>(PHYSICS_BUILTIN_COLLISION_LAYERS);

export function createPhysicsWorldFromSpec(
  engine: FerrumEngine,
  input: PhysicsSpec | ResolvedPhysicsSpec,
  options: PhysicsWorldApplyOptions = {},
): PhysicsWorldApplyResult {
  const path = options.path ?? DEFAULT_APPLY_PATH;
  const spec = isResolvedPhysicsSpec(input) ? input : resolvePhysicsSpec(input, { path });
  const bodies = Object.values(spec.bodies);
  const joints = Object.values(spec.joints);
  if (spec.mode === "none" && (bodies.length > 0 || joints.length > 0)) {
    throw physicsSpecDiagnosticError(`${path}.mode`, "cannot apply bodies or joints when physics mode is none");
  }

  options.replace?.clear();
  applyPhysicsRuntimeOptions(engine, spec);

  const warnings = physicsApplyWarnings(spec, path, options.unsafeUnitScaleThreshold);
  for (const warning of warnings) {
    options.onWarning?.(warning);
  }

  const bodyHandles: Record<string, PhysicsEntityHandle> = {};
  const jointHandles: Record<string, PhysicsJointHandle> = {};
  const worldAnchors: PhysicsEntityHandle[] = [];

  for (const body of bodies) {
    bodyHandles[body.id] = spawnResolvedBody(engine, spec, body, `${path}.bodies.${body.id}`);
  }

  for (const joint of joints) {
    jointHandles[joint.id] = spawnResolvedJoint(
      engine,
      spec,
      bodyHandles,
      worldAnchors,
      joint,
      `${path}.joints.${joint.id}`,
    );
  }

  let cleared = false;
  const result: PhysicsWorldApplyResult = {
    spec,
    bodies: bodyHandles,
    joints: jointHandles,
    worldAnchors,
    bodyCount: Object.keys(bodyHandles).length,
    jointCount: Object.keys(jointHandles).length,
    warningCount: warnings.length,
    warnings,
    stepSeconds: spec.solver.stepSeconds,
    stepOptions: {
      gravityX: spec.gravityX,
      gravityY: spec.gravityY,
      velocityIterations: spec.solver.velocityIterations,
      positionIterations: spec.solver.positionIterations,
    },
    clear: () => {
      if (cleared) {
        return;
      }
      cleared = true;
      for (const joint of Object.values(jointHandles)) {
        engine.clearPhysicsJoint(joint);
      }
      for (const anchor of worldAnchors) {
        engine.despawnPhysicsEntity(anchor);
      }
      for (const body of Object.values(bodyHandles)) {
        engine.despawnPhysicsEntity(body);
      }
    },
  };
  return result;
}

export function resolvedPhysicsColliderRuntimeCount(collider: ResolvedPhysicsColliderSpec): number {
  if (collider.shape !== "chain") {
    return 1;
  }
  return chainEdgeSegments(collider, "physics.collider").length;
}

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
  if (options.inertia !== undefined) {
    engine.setPhysicsBodyMassProperties(handle, {
      mass: positiveNumber(options.mass ?? options.density ?? 1, `${path}.mass`),
      inertia: positiveNumber(options.inertia, `${path}.inertia`),
    });
  }
  return handle;
}

export function createCollider(
  options: PhysicsColliderAuthoringOptions,
  context: PhysicsAuthoringContext = {},
): PhysicsRigidBodyCollider {
  const path = context.path ?? "physics.collider";
  switch (options.type) {
    case "aabb":
    case "box": {
      const halfSize = boxHalfSize(options, path);
      return withColliderOffset({
        type: "aabb",
        halfWidth: halfSize.x,
        halfHeight: halfSize.y,
      }, options.offset, path);
    }
    case "circle":
      return withColliderOffset({
        type: "circle",
        radius: positiveNumber(options.radius, `${path}.radius`),
      }, options.offset, path);
    case "capsule": {
      const start = requiredVector2(options.start, `${path}.start`);
      const end = requiredVector2(options.end, `${path}.end`);
      requireDistinctPoints(start, end, path);
      return withColliderOffset({
        type: "capsule",
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
        radius: positiveNumber(options.radius, `${path}.radius`),
      }, options.offset, path);
    }
    case "orientedBox": {
      const halfSize = boxHalfSize(options, path);
      return withColliderOffset({
        type: "orientedBox",
        halfWidth: halfSize.x,
        halfHeight: halfSize.y,
        rotationRadians: finiteNumber(options.rotationRadians ?? 0, `${path}.rotationRadians`),
      }, options.offset, path);
    }
    case "convexPolygon":
      return withColliderOffset({
        type: "convexPolygon",
        vertices: flattenConvexVertices(options.vertices, `${path}.vertices`),
        rotationRadians: finiteNumber(options.rotationRadians ?? 0, `${path}.rotationRadians`),
      }, options.offset, path);
    case "edge": {
      const start = requiredVector2(options.start, `${path}.start`);
      const end = requiredVector2(options.end, `${path}.end`);
      requireDistinctPoints(start, end, path);
      return withColliderOffset({
        type: "edge",
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
      }, options.offset, path);
    }
  }
}

export function createJoint(
  engine: FerrumEngine,
  options: PhysicsJointAuthoringOptions,
  context: PhysicsAuthoringContext = {},
): PhysicsJointHandle {
  const path = context.path ?? "physics.joint";
  if (options.bodyA === "world" && options.bodyB === "world") {
    throw physicsSpecDiagnosticError(path, "cannot connect world to world");
  }
  const anchor = vector2(options.anchor, `${path}.anchor`, { x: 0, y: 0 });
  const entityA = jointEndpoint(engine, options.bodyA, anchor, `${path}.bodyA`);
  const entityB = jointEndpoint(engine, options.bodyB, anchor, `${path}.bodyB`);
  return spawnJoint(engine, jointOptionsFromAuthoring(options, entityA, entityB, path), path);
}

export function physicsMaterial(
  material: PhysicsMaterialAuthoringInput = "default",
  overrides?: PhysicsRigidBodyMaterial,
  path = "physics.material",
): PhysicsRigidBodyMaterial {
  const base = typeof material === "string" ? materialPreset(material, path) : material;
  return {
    ...base,
    ...overrides,
  };
}

export function createPhysicsLayerSpec(pattern: PhysicsLayerPattern): Record<string, { mask: string[] }> {
  return Object.fromEntries(Object.entries(pattern).map(([name, entry]) => {
    const mask = layerPatternMask(entry);
    return [name, { mask: [...mask] }];
  }));
}

export function createPhysicsLayerMap(
  pattern: PhysicsLayerPattern,
  options: PhysicsLayerMapOptions = {},
): Record<string, PhysicsAuthoringLayer> {
  const path = options.path ?? "physics.layers";
  const names = Object.keys(pattern);
  if (names.length > 31) {
    throw physicsSpecDiagnosticError(path, "must contain at most 31 layers");
  }
  const nameSet = new Set(names);
  return Object.fromEntries(names.map((name, index) => {
    requireName(name, `${path}.${name}`);
    const entry = pattern[name];
    const mask = layerPatternMask(entry);
    for (const target of mask) {
      if (!nameSet.has(target)) {
        throw physicsSpecDiagnosticError(`${path}.${name}.mask`, `references unknown layer '${target}'`);
      }
    }
    return [name, {
      name,
      categoryBits: 1 << index,
      mask: [...mask],
      maskBits: mask.reduce<number>((bits, target) => bits | (1 << names.indexOf(target)), 0),
    }];
  }));
}

export function physicsLayerMaskBits(
  layers: Record<string, PhysicsAuthoringLayer>,
  names: readonly string[],
  path = "physics.layerMask",
): number {
  return names.reduce((bits, name, index) => {
    const layer = layers[name];
    if (!layer) {
      throw physicsSpecDiagnosticError(`${path}.${index}`, `references unknown layer '${name}'`);
    }
    return bits | layer.categoryBits;
  }, 0);
}

export function clearPhysicsWorld(engine: FerrumEngine, world: PhysicsWorldApplyResult): void {
  for (const joint of Object.values(world.joints)) {
    engine.clearPhysicsJoint(joint);
  }
  for (const anchor of world.worldAnchors) {
    engine.despawnPhysicsEntity(anchor);
  }
  for (const body of Object.values(world.bodies)) {
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
    canSleep: body.canSleep,
    velocityX: body.velocityX,
    velocityY: body.velocityY,
    rotationRadians: body.rotationRadians,
    angularVelocityRadiansPerSecond: body.angularVelocityRadiansPerSecond,
    gravityScale: body.gravityScale,
    linearDamping: body.linearDamping,
    angularDamping: body.angularDamping,
  };
  const handle = spawnBody(engine, spawnOptions, path);
  if (body.inertia !== undefined) {
    engine.setPhysicsBodyMassProperties(handle, {
      mass: body.mass ?? material?.density ?? 1,
      inertia: body.inertia,
    });
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
  return handle;
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
    engine.setPhysicsBodyColliderMaterial(handle, colliderIndex, material);
  }
}

function spawnResolvedJoint(
  engine: FerrumEngine,
  spec: ResolvedPhysicsSpec,
  bodies: Record<string, PhysicsEntityHandle>,
  worldAnchors: PhysicsEntityHandle[],
  joint: ResolvedPhysicsJointSpec,
  path: string,
): PhysicsJointHandle {
  if (joint.bodyA === "world" && joint.bodyB === "world") {
    throw physicsSpecDiagnosticError(path, "cannot connect world to world");
  }
  const anchor = { x: joint.anchorX, y: joint.anchorY };
  const entityA = resolvedJointEndpoint(engine, bodies, worldAnchors, joint.bodyA, anchor, `${path}.bodyA`);
  const entityB = resolvedJointEndpoint(engine, bodies, worldAnchors, joint.bodyB, anchor, `${path}.bodyB`);
  return spawnJoint(engine, jointOptionsFromResolved(spec, joint, entityA, entityB), path);
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
    const handle = createWorldAnchor(engine, anchor);
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
  _path: string,
): PhysicsEntityHandle {
  return endpoint === "world" ? createWorldAnchor(engine, anchor) : endpoint;
}

function createWorldAnchor(engine: FerrumEngine, anchor: ResolvedPhysicsVector2): PhysicsEntityHandle {
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
  }, "physics.world");
}

function colliderFromResolved(
  collider: ResolvedPhysicsColliderSpec,
  path: string,
): PhysicsRigidBodyCollider {
  return runtimeCollidersFromResolved(collider, path)[0].collider;
}

function runtimeCollidersFromResolved(
  collider: ResolvedPhysicsColliderSpec,
  path: string,
): readonly RuntimeResolvedCollider[] {
  switch (collider.shape) {
    case "aabb":
    case "box":
      return [{
        path,
        collider: {
          type: "aabb",
          halfWidth: collider.halfWidth,
          halfHeight: collider.halfHeight,
          offsetX: collider.offsetX,
          offsetY: collider.offsetY,
        },
      }];
    case "circle":
      return [{
        path,
        collider: {
          type: "circle",
          radius: collider.radius,
          offsetX: collider.offsetX,
          offsetY: collider.offsetY,
        },
      }];
    case "capsule":
      return [{
        path,
        collider: {
          type: "capsule",
          startX: collider.startX,
          startY: collider.startY,
          endX: collider.endX,
          endY: collider.endY,
          radius: collider.radius,
          offsetX: collider.offsetX,
          offsetY: collider.offsetY,
        },
      }];
    case "orientedBox":
      return [{
        path,
        collider: {
          type: "orientedBox",
          halfWidth: collider.halfWidth,
          halfHeight: collider.halfHeight,
          rotationRadians: collider.rotationRadians,
          offsetX: collider.offsetX,
          offsetY: collider.offsetY,
        },
      }];
    case "convexPolygon":
      return [{
        path,
        collider: {
          type: "convexPolygon",
          vertices: flattenResolvedVertices(collider.vertices),
          rotationRadians: collider.rotationRadians,
          offsetX: collider.offsetX,
          offsetY: collider.offsetY,
        },
      }];
    case "edge":
      return [{
        path,
        collider: {
          type: "edge",
          startX: collider.startX,
          startY: collider.startY,
          endX: collider.endX,
          endY: collider.endY,
          offsetX: collider.offsetX,
          offsetY: collider.offsetY,
        },
      }];
    case "chain":
      return chainEdgeSegments(collider, path).map(({ start, end, path: segmentPath }) => ({
        path: segmentPath,
        collider: {
          type: "edge",
          startX: start.x,
          startY: start.y,
          endX: end.x,
          endY: end.y,
          offsetX: collider.offsetX,
          offsetY: collider.offsetY,
        },
      }));
  }
}

function chainEdgeSegments(
  collider: ResolvedPhysicsChainColliderSpec,
  path: string,
): Array<{ start: ResolvedPhysicsVector2; end: ResolvedPhysicsVector2; path: string }> {
  const segments: Array<{ start: ResolvedPhysicsVector2; end: ResolvedPhysicsVector2; path: string }> = [];
  for (let index = 1; index < collider.vertices.length; index += 1) {
    segments.push({
      start: collider.vertices[index - 1],
      end: collider.vertices[index],
      path: `${path}.vertices.${index}`,
    });
  }
  if (collider.loop && collider.vertices.length > 2) {
    const start = collider.vertices[collider.vertices.length - 1];
    const end = collider.vertices[0];
    if (start.x !== end.x || start.y !== end.y) {
      segments.push({
        start,
        end,
        path: `${path}.loop`,
      });
    }
  }
  if (segments.length < 1) {
    throw physicsSpecDiagnosticError(`${path}.vertices`, "chain must contain at least one valid segment");
  }
  return segments;
}

function jointOptionsFromResolved(
  spec: ResolvedPhysicsSpec,
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

function materialFromSpec(
  materials: Record<string, ResolvedPhysicsMaterialSpec>,
  name: string,
  path: string,
): PhysicsRigidBodyMaterial {
  const material = materials[name];
  if (!material) {
    throw physicsSpecDiagnosticError(path, `references unknown material '${name}'`);
  }
  return {
    friction: material.friction,
    restitution: material.restitution,
    density: material.density,
  };
}

function layerPatternMask(entry: readonly string[] | PhysicsLayerPatternEntry): readonly string[] {
  if (isLayerMaskArray(entry)) {
    return entry;
  }
  return entry.mask ?? [];
}

function isLayerMaskArray(entry: readonly string[] | PhysicsLayerPatternEntry): entry is readonly string[] {
  return Array.isArray(entry);
}

function materialPreset(name: string, path: string): PhysicsRigidBodyMaterial {
  if (isPhysicsMaterialPresetName(name)) {
    return { ...PHYSICS_MATERIAL_PRESETS[name] };
  }
  throw physicsSpecDiagnosticError(path, `must be one of ${Object.keys(PHYSICS_MATERIAL_PRESETS).join(", ")}`);
}

function isPhysicsMaterialPresetName(name: string): name is PhysicsMaterialPresetName {
  return name in PHYSICS_MATERIAL_PRESETS;
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

function spawnBody(
  engine: FerrumEngine,
  options: PhysicsRigidBodySpawnOptions,
  path: string,
): PhysicsEntityHandle {
  try {
    return engine.spawnRigidBody(options);
  } catch (error) {
    throw physicsSpecDiagnosticError(path, `runtime rejected body: ${describeError(error)}`);
  }
}

function spawnJoint(
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

function authoringCollisionLayer(
  name: string | undefined,
  categoryBits: number | undefined,
  maskBits: number | undefined,
  path: string,
): PhysicsCollisionLayer | undefined {
  if (name === undefined) {
    return undefined;
  }
  const layer = builtinCollisionLayer(name);
  if (layer) {
    return layer;
  }
  if (categoryBits === undefined || maskBits === undefined) {
    throw physicsSpecDiagnosticError(path, `custom layer '${name}' requires categoryBits and maskBits`);
  }
  return undefined;
}

function builtinCollisionLayer(name: string | undefined): PhysicsCollisionLayer | undefined {
  if (name !== undefined && BUILTIN_COLLISION_LAYER_SET.has(name)) {
    return name as PhysicsCollisionLayer;
  }
  return undefined;
}

function withColliderOffset<T extends PhysicsRigidBodyCollider>(
  collider: T,
  offset: PhysicsSpecVector2 | undefined,
  path: string,
): T {
  if (offset === undefined) {
    return collider;
  }
  const resolved = requiredVector2(offset, `${path}.offset`);
  return {
    ...collider,
    offsetX: resolved.x,
    offsetY: resolved.y,
  };
}

function boxHalfSize(
  options: { size?: PhysicsSpecVector2; halfSize?: PhysicsSpecVector2 },
  path: string,
): ResolvedPhysicsVector2 {
  if (options.size !== undefined && options.halfSize !== undefined) {
    throw physicsSpecDiagnosticError(`${path}.size`, "cannot be combined with halfSize");
  }
  if (options.halfSize !== undefined) {
    return requiredPositiveVector2(options.halfSize, `${path}.halfSize`);
  }
  const size = requiredPositiveVector2(options.size, `${path}.size`);
  return { x: size.x / 2, y: size.y / 2 };
}

function flattenResolvedVertices(vertices: readonly ResolvedPhysicsVector2[]): readonly number[] {
  return vertices.flatMap((vertex) => [vertex.x, vertex.y]);
}

function flattenConvexVertices(vertices: readonly PhysicsSpecVector2[], path: string): readonly number[] {
  if (!Array.isArray(vertices)) {
    throw physicsSpecDiagnosticError(path, "must be an array");
  }
  if (vertices.length < 3 || vertices.length > 16) {
    throw physicsSpecDiagnosticError(path, "must define a convex polygon with 3-16 vertices");
  }
  const resolved = vertices.map((vertex, index) => requiredVector2(vertex, `${path}.${index}`));
  for (let index = 1; index < resolved.length; index += 1) {
    requireDistinctPoints(resolved[index - 1], resolved[index], `${path}.${index}`);
  }
  if (!isStrictlyConvexPolygon(resolved)) {
    throw physicsSpecDiagnosticError(path, "must define a convex polygon with non-collinear vertices");
  }
  return flattenResolvedVertices(resolved);
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

function vector2(
  value: PhysicsSpecVector2 | undefined,
  path: string,
  fallback: ResolvedPhysicsVector2,
): ResolvedPhysicsVector2 {
  if (value === undefined) {
    return fallback;
  }
  return requiredVector2(value, path);
}

function requiredVector2(value: unknown, path: string): ResolvedPhysicsVector2 {
  if (!Array.isArray(value) || value.length !== 2) {
    throw physicsSpecDiagnosticError(path, "must be a [x, y] array");
  }
  return {
    x: finiteNumber(value[0], `${path}.0`),
    y: finiteNumber(value[1], `${path}.1`),
  };
}

function requiredPositiveVector2(value: unknown, path: string): ResolvedPhysicsVector2 {
  const resolved = requiredVector2(value, path);
  if (resolved.x <= 0 || resolved.y <= 0) {
    throw physicsSpecDiagnosticError(path, "must contain positive finite numbers");
  }
  return resolved;
}

function requireDistinctPoints(a: ResolvedPhysicsVector2, b: ResolvedPhysicsVector2, path: string): void {
  if (a.x === b.x && a.y === b.y) {
    throw physicsSpecDiagnosticError(path, "must use distinct points");
  }
}

function requireName(name: string, path: string): void {
  if (name.trim().length === 0) {
    throw physicsSpecDiagnosticError(path, "id must be a non-empty string");
  }
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw physicsSpecDiagnosticError(path, "must be a finite number");
}

function positiveNumber(value: unknown, path: string): number {
  const resolved = finiteNumber(value, path);
  if (resolved <= 0) {
    throw physicsSpecDiagnosticError(path, "must be a positive finite number");
  }
  return resolved;
}

function nonNegativeNumber(value: unknown, path: string): number {
  const resolved = finiteNumber(value, path);
  if (resolved < 0) {
    throw physicsSpecDiagnosticError(path, "must be a non-negative finite number");
  }
  return resolved;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw physicsSpecDiagnosticError(path, "must be a non-negative integer");
}

function unitIntervalNumber(value: unknown, path: string): number {
  const resolved = finiteNumber(value, path);
  if (resolved < 0 || resolved > 1) {
    throw physicsSpecDiagnosticError(path, "must be a finite number between 0 and 1");
  }
  return resolved;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
