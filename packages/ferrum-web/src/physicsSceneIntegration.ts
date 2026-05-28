import type { FerrumEngine, PhysicsRigidBodyStepOptions } from "./engineTypes.js";
import { physicsSpecDiagnosticError } from "./diagnostics.js";
import {
  createPhysicsWorldFromSpec,
  type PhysicsWorldApplyOptions,
  type PhysicsWorldApplyResult,
} from "./physicsAuthoring.js";
import type { PhysicsSpec, ResolvedPhysicsSpec } from "./physicsSpec.js";

export type PhysicsSceneProfileId = "manual" | "runtime";

export interface PhysicsSceneProfileSpec {
  profile?: PhysicsSceneProfileId;
  physics: PhysicsSpec | ResolvedPhysicsSpec;
  autoStep?: boolean;
}

export interface ApplyPhysicsSceneProfileOptions
  extends Omit<PhysicsWorldApplyOptions, "replace"> {
  replace?: PhysicsSceneProfileApplyResult | PhysicsWorldApplyResult;
}

export interface PhysicsSceneProfileApplyResult {
  profile: PhysicsSceneProfileId;
  autoStep: boolean;
  world: PhysicsWorldApplyResult;
  bodyCount: number;
  jointCount: number;
  stepSeconds: number;
  stepOptions: PhysicsRigidBodyStepOptions;
  clear(): void;
}

export function applyPhysicsSceneProfile(
  engine: FerrumEngine,
  profileSpec: PhysicsSceneProfileSpec,
  options: ApplyPhysicsSceneProfileOptions = {},
): PhysicsSceneProfileApplyResult {
  const path = options.path ?? "physicsScene";
  if (!isRecord(profileSpec)) {
    throw physicsSpecDiagnosticError(path, "must be an object");
  }
  if (profileSpec.physics === undefined) {
    throw physicsSpecDiagnosticError(`${path}.physics`, "must be provided");
  }

  const profile = resolveProfile(profileSpec.profile, `${path}.profile`);
  const autoStep = profile === "runtime" && profileSpec.autoStep !== false;
  const { replace, ...worldOptions } = options;
  const previousScene = sceneApplyResult(replace);
  previousScene?.clear();
  const replaceWorld = previousScene === undefined ? replace as PhysicsWorldApplyResult | undefined : undefined;
  const world = createPhysicsWorldFromSpec(engine, profileSpec.physics, {
    ...worldOptions,
    path: `${path}.physics`,
    replace: replaceWorld,
  });

  engine.configureAutoRigidBodyStep(autoStep ? world.stepOptions : false);

  let cleared = false;
  return {
    profile,
    autoStep,
    world,
    bodyCount: world.bodyCount,
    jointCount: world.jointCount,
    stepSeconds: world.stepSeconds,
    stepOptions: world.stepOptions,
    clear: () => {
      if (cleared) {
        return;
      }
      cleared = true;
      engine.configureAutoRigidBodyStep(false);
      world.clear();
    },
  };
}

function resolveProfile(input: unknown, path: string): PhysicsSceneProfileId {
  if (input === undefined) {
    return "runtime";
  }
  if (input === "manual" || input === "runtime") {
    return input;
  }
  throw physicsSpecDiagnosticError(path, "must be manual or runtime");
}

function sceneApplyResult(input: unknown): PhysicsSceneProfileApplyResult | undefined {
  if (
    isRecord(input)
    && (input.profile === "manual" || input.profile === "runtime")
    && isRecord(input.world)
    && typeof input.clear === "function"
  ) {
    return input as unknown as PhysicsSceneProfileApplyResult;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
