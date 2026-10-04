import type { Engine } from "../pkg/ferrum_core";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";
import { uint32Number } from "./particlePreset.js";
import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";

export interface DataSceneGameplayOptions {
  primaryActor?: GameplayEntityHandle;
  /** Omit for automatic proximity; bind this engine input action for nearest-target interaction. */
  interactionInputActionId?: number;
}

export interface DataSceneGameplaySpec {
  /** Instance id in the active fragment, resolved to a fresh generation handle on every apply. */
  primaryActor?: string;
  interactionInputActionId?: number;
}

export function resolveDataSceneGameplaySpec(value: unknown, path = "dataScene.gameplay"): DataSceneGameplaySpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw gameplayAuthoringDiagnosticError(path, "must be an object");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (key !== "primaryActor" && key !== "interactionInputActionId") throw gameplayAuthoringDiagnosticError(`${path}.${key}`, "is not supported");
  }
  const primaryActor = input.primaryActor;
  if (primaryActor !== undefined && (typeof primaryActor !== "string" || primaryActor.trim().length === 0)) throw gameplayAuthoringDiagnosticError(`${path}.primaryActor`, "must be a non-empty instance id");
  const action = input.interactionInputActionId;
  if (action !== undefined && (typeof action !== "number" || !Number.isInteger(action) || action <= 0 || action > 0xffffffff)) throw gameplayAuthoringDiagnosticError(`${path}.interactionInputActionId`, "must be a positive uint32 input action id");
  if (action !== undefined && primaryActor === undefined) throw gameplayAuthoringDiagnosticError(path, "input interaction requires primaryActor");
  return { ...(primaryActor === undefined ? {} : { primaryActor: primaryActor as string }), ...(action === undefined ? {} : { interactionInputActionId: action as number }) };
}

export function configureDataSceneGameplay(engine: Engine, options: DataSceneGameplayOptions): boolean {
  const actor = options.primaryActor;
  const action = options.interactionInputActionId === undefined ? 0 : uint32Number(options.interactionInputActionId, "gameplay.interactionInputActionId");
  if (options.interactionInputActionId !== undefined && (action === 0 || actor === undefined)) throw gameplayAuthoringDiagnosticError("dataScene.gameplay", "input interaction requires a primary actor and a positive action id");
  return engine.configure_data_scene_gameplay(actor !== undefined,
    actor === undefined ? 0 : uint32Number(actor.entityId, "gameplay.primaryActor.entityId"),
    actor === undefined ? 0 : uint32Number(actor.entityGeneration, "gameplay.primaryActor.entityGeneration"), action);
}
