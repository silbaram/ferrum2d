import type { Engine } from "../pkg/ferrum_core";
import type {
  CreateEngineOptions,
  FixedTimestepOptions,
  PhysicsDebugOptions,
  PhysicsRigidBodyStepOptions,
  PhysicsRigidBodyStepStats,
} from "./engineTypes.js";
import { finiteNumber, uint32Number } from "./particlePreset";
import type { PhysicsDebugSpec, ResolvedPhysicsSpec } from "./physicsSpec.js";

const DEFAULT_RIGID_BODY_GRAVITY_X = 0;
const DEFAULT_RIGID_BODY_GRAVITY_Y = 980;
const DEFAULT_RIGID_BODY_VELOCITY_ITERATIONS = 6;
const DEFAULT_RIGID_BODY_POSITION_ITERATIONS = 3;
const DEFAULT_RIGID_BODY_POSITION_CORRECTION_PERCENT = 0.8;
const DEFAULT_RIGID_BODY_POSITION_CORRECTION_SLOP = 0.01;
const DEFAULT_RIGID_BODY_RESTITUTION_VELOCITY_THRESHOLD = 1;
const DEFAULT_RIGID_BODY_CONTACT_BAUMGARTE_BIAS_FACTOR = 0.2;
const DEFAULT_RIGID_BODY_MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY = 120;
const DEFAULT_RIGID_BODY_CONTINUOUS = true;

const PHYSICS_DEBUG_BROADPHASE = 1 << 0;
const PHYSICS_DEBUG_CONTACTS = 1 << 1;
const PHYSICS_DEBUG_COLLIDERS = 1 << 2;
const PHYSICS_DEBUG_JOINTS = 1 << 3;
const PHYSICS_DEBUG_SLEEPING = 1 << 4;
const PHYSICS_DEBUG_CCD = 1 << 5;
const PHYSICS_DEBUG_DEFAULT = PHYSICS_DEBUG_BROADPHASE | PHYSICS_DEBUG_CONTACTS;

export function configureAutoRigidBodyStepOptions(
  rustEngine: Engine,
  autoStep: boolean | PhysicsRigidBodyStepOptions,
): void {
  const options = typeof autoStep === "object" ? autoStep : undefined;
  rustEngine.configure_auto_rigid_body_step(
    autoStep !== false,
    finiteNumber(options?.gravityX ?? DEFAULT_RIGID_BODY_GRAVITY_X, "auto rigid body gravityX"),
    finiteNumber(options?.gravityY ?? DEFAULT_RIGID_BODY_GRAVITY_Y, "auto rigid body gravityY"),
    uint32Number(
      options?.velocityIterations ?? DEFAULT_RIGID_BODY_VELOCITY_ITERATIONS,
      "auto rigid body velocityIterations",
    ),
    uint32Number(
      options?.positionIterations ?? DEFAULT_RIGID_BODY_POSITION_ITERATIONS,
      "auto rigid body positionIterations",
    ),
    finiteNumber(
      options?.positionCorrectionPercent ?? DEFAULT_RIGID_BODY_POSITION_CORRECTION_PERCENT,
      "auto rigid body positionCorrectionPercent",
    ),
    finiteNumber(
      options?.positionCorrectionSlop ?? DEFAULT_RIGID_BODY_POSITION_CORRECTION_SLOP,
      "auto rigid body positionCorrectionSlop",
    ),
    finiteNumber(
      options?.restitutionVelocityThreshold ?? DEFAULT_RIGID_BODY_RESTITUTION_VELOCITY_THRESHOLD,
      "auto rigid body restitutionVelocityThreshold",
    ),
    finiteNumber(
      options?.contactBaumgarteBiasFactor ?? DEFAULT_RIGID_BODY_CONTACT_BAUMGARTE_BIAS_FACTOR,
      "auto rigid body contactBaumgarteBiasFactor",
    ),
    finiteNumber(
      options?.maxContactBaumgarteBiasVelocity ?? DEFAULT_RIGID_BODY_MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
      "auto rigid body maxContactBaumgarteBiasVelocity",
    ),
    options?.contactSplitImpulse === true,
    options?.continuous ?? DEFAULT_RIGID_BODY_CONTINUOUS,
  );
}

export function stepRigidBodiesWithStats(
  rustEngine: Engine,
  deltaSeconds: number,
  options?: PhysicsRigidBodyStepOptions,
): PhysicsRigidBodyStepStats {
  const resolvedDeltaSeconds = finiteNumber(deltaSeconds, "rigid body step deltaSeconds");
  if (options === undefined) {
    rustEngine.step_rigid_bodies(resolvedDeltaSeconds);
    return readRigidBodyStepStats(rustEngine);
  }
  rustEngine.step_rigid_bodies_with_config(
    resolvedDeltaSeconds,
    finiteNumber(options.gravityX ?? DEFAULT_RIGID_BODY_GRAVITY_X, "rigid body gravityX"),
    finiteNumber(options.gravityY ?? DEFAULT_RIGID_BODY_GRAVITY_Y, "rigid body gravityY"),
    uint32Number(
      options.velocityIterations ?? DEFAULT_RIGID_BODY_VELOCITY_ITERATIONS,
      "rigid body velocityIterations",
    ),
    uint32Number(
      options.positionIterations ?? DEFAULT_RIGID_BODY_POSITION_ITERATIONS,
      "rigid body positionIterations",
    ),
    finiteNumber(
      options.positionCorrectionPercent ?? DEFAULT_RIGID_BODY_POSITION_CORRECTION_PERCENT,
      "rigid body positionCorrectionPercent",
    ),
    finiteNumber(
      options.positionCorrectionSlop ?? DEFAULT_RIGID_BODY_POSITION_CORRECTION_SLOP,
      "rigid body positionCorrectionSlop",
    ),
    finiteNumber(
      options.restitutionVelocityThreshold ?? DEFAULT_RIGID_BODY_RESTITUTION_VELOCITY_THRESHOLD,
      "rigid body restitutionVelocityThreshold",
    ),
    finiteNumber(
      options.contactBaumgarteBiasFactor ?? DEFAULT_RIGID_BODY_CONTACT_BAUMGARTE_BIAS_FACTOR,
      "rigid body contactBaumgarteBiasFactor",
    ),
    finiteNumber(
      options.maxContactBaumgarteBiasVelocity ?? DEFAULT_RIGID_BODY_MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
      "rigid body maxContactBaumgarteBiasVelocity",
    ),
    options.contactSplitImpulse === true,
    options.continuous ?? DEFAULT_RIGID_BODY_CONTINUOUS,
  );
  return readRigidBodyStepStats(rustEngine);
}

export function readRigidBodyStepStats(rustEngine: Engine): PhysicsRigidBodyStepStats {
  return {
    substeps: rustEngine.rigid_body_step_substeps(),
    dynamicBodies: rustEngine.rigid_body_step_dynamic_bodies(),
    angularBodies: rustEngine.rigid_body_step_angular_bodies(),
    islandCount: rustEngine.rigid_body_step_island_count(),
    islandBodies: rustEngine.rigid_body_step_island_bodies(),
    activeIslands: rustEngine.rigid_body_step_active_islands(),
    sleepingIslands: rustEngine.rigid_body_step_sleeping_islands(),
    largestIslandBodies: rustEngine.rigid_body_step_largest_island_bodies(),
    contactChecks: rustEngine.rigid_body_step_contact_checks(),
    velocityImpulses: rustEngine.rigid_body_step_velocity_impulses(),
    contactBlockSolves: rustEngine.rigid_body_step_contact_block_solves(),
    baumgarteVelocityBiases: rustEngine.rigid_body_step_baumgarte_velocity_biases(),
    splitVelocityImpulses: rustEngine.rigid_body_step_split_velocity_impulses(),
    restitutionVelocityThresholdSkips: rustEngine.rigid_body_step_restitution_velocity_threshold_skips(),
    warmStartImpulses: rustEngine.rigid_body_step_warm_start_impulses(),
    contactCacheEntries: rustEngine.rigid_body_step_contact_cache_entries(),
    sleepingBodies: rustEngine.rigid_body_step_sleeping_bodies(),
    bodiesPutToSleep: rustEngine.rigid_body_step_bodies_put_to_sleep(),
    bodiesWoken: rustEngine.rigid_body_step_bodies_woken(),
    islandsWoken: rustEngine.rigid_body_step_islands_woken(),
    islandsPutToSleep: rustEngine.rigid_body_step_islands_put_to_sleep(),
    ccdChecks: rustEngine.rigid_body_step_ccd_checks(),
    ccdHits: rustEngine.rigid_body_step_ccd_hits(),
    positionContactRebuilds: rustEngine.rigid_body_step_position_contact_rebuilds(),
    positionContactCountSum: rustEngine.rigid_body_step_position_contact_count_sum(),
    maxPositionContacts: rustEngine.rigid_body_step_max_position_contacts(),
    positionCorrections: rustEngine.rigid_body_step_position_corrections(),
    splitPositionCorrections: rustEngine.rigid_body_step_split_position_corrections(),
    constraintVelocityCorrections: rustEngine.rigid_body_step_constraint_velocity_corrections(),
    constraintPositionCorrections: rustEngine.rigid_body_step_constraint_position_corrections(),
    brokenJoints: rustEngine.rigid_body_step_broken_joints(),
  };
}

export function applyPhysicsDebugLineOptions(
  rustEngine: Engine,
  options: CreateEngineOptions,
  physicsSpec?: ResolvedPhysicsSpec,
): void {
  const flags = physicsDebugFlags(
    options.physicsDebugOptions ?? options.enablePhysicsDebugLines,
    physicsSpec?.debug,
    options.includePhysicsDebugLines === true,
  );
  rustEngine.set_physics_debug_line_flags(flags);
  rustEngine.set_physics_debug_lines_enabled(flags !== 0);
}

export function physicsDebugFlags(
  options?: boolean | PhysicsDebugOptions,
  spec?: PhysicsDebugSpec,
  includePhysicsDebugLines = false,
): number {
  if (typeof options === "object") {
    return physicsDebugCategoryFlags(options);
  }
  if (options === true || includePhysicsDebugLines) {
    return PHYSICS_DEBUG_DEFAULT;
  }
  if (spec !== undefined) {
    return physicsDebugCategoryFlags(spec);
  }
  return 0;
}

export function applyPhysicsRuntimeOptions(
  rustEngine: Engine,
  physicsSpec: ResolvedPhysicsSpec,
  options: CreateEngineOptions,
  hasPhysicsConfig: boolean,
): void {
  if (options.fixedTimestep !== undefined) {
    applyFixedTimestepOptions(rustEngine, options.fixedTimestep);
  } else if (hasPhysicsConfig) {
    applyFixedTimestepOptions(rustEngine, {
      enabled: physicsSpec.solver.fixedTimestep,
      stepSeconds: physicsSpec.solver.stepSeconds,
    });
  }
  applyPhysicsDebugLineOptions(rustEngine, options, physicsSpec);
}

export function applyFixedTimestepOptions(
  rustEngine: Engine,
  fixedTimestep: boolean | FixedTimestepOptions | undefined,
): void {
  if (fixedTimestep === undefined) {
    return;
  }
  if (typeof fixedTimestep === "boolean") {
    rustEngine.configure_fixed_timestep(fixedTimestep, 1 / 60, 0.25, 8);
    return;
  }
  rustEngine.configure_fixed_timestep(
    fixedTimestep.enabled ?? true,
    fixedTimestep.stepSeconds ?? 1 / 60,
    fixedTimestep.maxFrameSeconds ?? 0.25,
    fixedTimestep.maxStepsPerUpdate ?? 8,
  );
}

function physicsDebugCategoryFlags(options: PhysicsDebugOptions): number {
  let flags = 0;
  if (options.broadphase === true) flags |= PHYSICS_DEBUG_BROADPHASE;
  if (options.contacts === true || options.manifolds === true) flags |= PHYSICS_DEBUG_CONTACTS;
  if (options.colliders === true || options.layers === true) {
    flags |= PHYSICS_DEBUG_COLLIDERS;
  }
  if (options.joints === true) flags |= PHYSICS_DEBUG_JOINTS;
  if (options.sleeping === true) flags |= PHYSICS_DEBUG_SLEEPING | PHYSICS_DEBUG_COLLIDERS;
  if (options.ccd === true) flags |= PHYSICS_DEBUG_CCD;
  return flags;
}
