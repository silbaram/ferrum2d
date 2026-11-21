import type { Engine } from "../pkg/ferrum_core.js";
import type { PhysicsEntityHandle, PhysicsKinematicControllerOptions } from "./engineTypes/physicsBodies.js";
import { physicsEntityHandle } from "./physicsHandles.js";

const OPTION_KEYS = ["solidMaskBits", "maxIterations", "maxStepHeight", "maxDropHeight", "allowLedgeDrop"] as const;

type ControllerOptionsError = (path: string, detail: string) => Error;

function optionsRecord(value: unknown, path: string, error: ControllerOptionsError): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw error(path, "must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!OPTION_KEYS.some(option => option === key)) {
      throw error(`${path}.${key}`, "is not supported");
    }
  }
  // Only the validated object's own fields configure the controller.
  const source = value as Record<string, unknown>;
  return Object.fromEntries(OPTION_KEYS.map(key => [key,
    Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined,
  ]));
}

function height(value: unknown, path: string, error: ControllerOptionsError): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 65536) {
    throw error(path, "must be a finite float32 number in 0..65536");
  }
  return Math.fround(value);
}

/** Owns and resolves setup options without changing native or caller state. */
export function resolveDataSceneKinematicControllerOptions(
  value: unknown,
  path = "kinematicController",
  error: ControllerOptionsError = (path, detail) => new Error(`${path} ${detail}`),
): Required<PhysicsKinematicControllerOptions> {
  const values = optionsRecord(value, path, error);
  const mask = values.solidMaskBits === undefined ? 0xffffffff : values.solidMaskBits;
  if (typeof mask !== "number" || !Number.isInteger(mask) || mask < 0 || mask > 0xffffffff) {
    throw error(`${path}.solidMaskBits`, "must be a uint32 number");
  }
  const iterations = values.maxIterations === undefined ? 4 : values.maxIterations;
  if (typeof iterations !== "number" || !Number.isInteger(iterations) || iterations < 1 || iterations > 8) {
    throw error(`${path}.maxIterations`, "must be an integer in 1..8");
  }
  const step = height(values.maxStepHeight, `${path}.maxStepHeight`, error);
  const drop = height(values.maxDropHeight, `${path}.maxDropHeight`, error);
  const ledge = values.allowLedgeDrop === undefined ? false : values.allowLedgeDrop;
  if (typeof ledge !== "boolean") throw error(`${path}.allowLedgeDrop`, "must be boolean");
  return { solidMaskBits: mask, maxIterations: iterations, maxStepHeight: step, maxDropHeight: drop, allowLedgeDrop: ledge };
}

/** Cold setup only. Rust owns controller settings, movement and checkpoint state. */
export function configureDataSceneKinematicController(
  native: Engine,
  handle: PhysicsEntityHandle,
  options: PhysicsKinematicControllerOptions | false,
): boolean {
  const entity = physicsEntityHandle(handle);
  const reset = options === false;
  const values = resolveDataSceneKinematicControllerOptions(reset ? {} : options);
  if (typeof native.configure_data_scene_kinematic_controller !== "function") {
    throw new Error("This Wasm core does not support Data Scene kinematic controllers");
  }
  return native.configure_data_scene_kinematic_controller(
    entity.entityId, entity.entityGeneration, reset, values.solidMaskBits, values.maxIterations,
    values.maxStepHeight, values.maxDropHeight, values.allowLedgeDrop,
  );
}
