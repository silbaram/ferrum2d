import {
  booleanValue,
  nonNegativeInteger,
  optionalObject,
  physicsSpecError,
  positiveNumber,
  rejectUnknownKeys,
  vector2,
} from "../physicsSpecValidation.js";
import type {
  PhysicsMode,
  ResolvePhysicsSpecOptions,
  ResolvedPhysicsSolverSpec,
  ResolvedPhysicsSpec,
} from "../physicsSpecTypes.js";
import { DEFAULT_PHYSICS_MODE, MODE_DEFAULTS } from "./defaults.js";
import { physicsDebugSpec } from "./debug.js";
import { physicsBodies } from "./bodies.js";
import { physicsHd2dSpec } from "./hd2d.js";
import { physicsJoints } from "./joints.js";
import { physicsLayers, physicsMaterials } from "./materialsLayers.js";
import { PHYSICS_KEYS, SOLVER_KEYS } from "./keys.js";

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
  const hd2d = physicsHd2dSpec(spec.hd2d, `${path}.hd2d`);
  const materials = physicsMaterials(spec.materials, `${path}.materials`);
  const layers = physicsLayers(spec.layers, `${path}.layers`);
  const bodies = physicsBodies(spec.bodies, `${path}.bodies`, materials, layers, hd2d);
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
    hd2d,
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
    velocityIterations: nonNegativeInteger(
      solver.velocityIterations,
      `${path}.velocityIterations`,
      defaults.velocityIterations,
    ),
    positionIterations: nonNegativeInteger(
      solver.positionIterations,
      `${path}.positionIterations`,
      defaults.positionIterations,
    ),
    sleep: booleanValue(solver.sleep, `${path}.sleep`, defaults.sleep),
  };
}
