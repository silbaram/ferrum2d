import type {
  PhysicsMode,
  ResolvedPhysicsMaterialSpec,
  ResolvedPhysicsSolverSpec,
} from "../physicsSpecTypes.js";

export const DEFAULT_PHYSICS_MODE: PhysicsMode = "arcade";

export const DEFAULT_MATERIAL: ResolvedPhysicsMaterialSpec = Object.freeze({
  friction: 0.4,
  restitution: 0,
  density: 1,
});

export const MODE_DEFAULTS: Readonly<Record<PhysicsMode, {
  gravityX: number;
  gravityY: number;
  continuous: boolean;
  solver: ResolvedPhysicsSolverSpec;
}>> = Object.freeze({
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
