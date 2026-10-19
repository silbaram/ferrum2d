import type { Engine } from "../pkg/ferrum_core.js";
import type { GameplayEntityHandle, SceneBehaviorBindingPlan } from "./gameplayAuthoring.js";
import type { BehaviorRecipeCommand } from "./behaviorRecipes.js";
import type { DataSceneCombatNavigationSpec } from "./dataSceneCombatNavigation.js";
import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import { uint32Number } from "./particlePreset.js";

/** Cold native Chase settings; generation handles are resolved on every document apply. */
export interface DataSceneCombatChaseBinding {
  source: GameplayEntityHandle;
  stopDistance: number;
}
export interface DataSceneCombatCrowdStats {
  readonly enabled: boolean;
  readonly stoppedAgents: number;
  readonly yieldedMoves: number;
  readonly neighborTests: number;
  readonly frameNeighborTests: number;
  readonly frameAvoidanceMoves: number;
}
export interface CombatCrowdRuntime {
  data_scene_combat_crowd_version?(): number;
  data_scene_combat_crowd_stats?(): Uint32Array;
  configure_data_scene_gameplay_v5?(
    hasActor: boolean,
    id: number,
    generation: number,
    interaction: number,
    combat: boolean,
    metadata: Uint32Array,
    values: Float32Array,
    bindings: Uint32Array,
    navigation: Float32Array,
    agents: Uint32Array,
    distances: Float32Array,
  ): boolean;
}
export function supportsDataSceneCombatCrowd(engine: Engine & CombatCrowdRuntime): boolean {
  return (
    engine.data_scene_combat_crowd_version?.() === 1 &&
    typeof engine.configure_data_scene_gameplay_v5 === "function"
  );
}
export function dataSceneCombatCrowdStats(
  engine: Engine & CombatCrowdRuntime,
): DataSceneCombatCrowdStats | undefined {
  if (!engine.data_scene_combat_crowd_stats) return undefined;
  const v = engine.data_scene_combat_crowd_stats();
  if (v.length !== 7 || v[0] !== 1)
    throw new Error("Unsupported Data Scene combat crowd diagnostics ABI");
  return {
    enabled: v[1] === 1,
    stoppedAgents: v[2]!,
    yieldedMoves: v[3]!,
    neighborTests: v[4]!,
    frameNeighborTests: v[5]!,
    frameAvoidanceMoves: v[6]!,
  };
}
export function combatCrowdRequired(
  config: DataSceneCombatNavigationSpec | undefined,
  commands: readonly BehaviorRecipeCommand[],
): boolean {
  return (
    config !== undefined &&
    (config.crowdAvoidance !== undefined ||
      commands.some((c) => c.type === "configureChase" && c.stopDistance > 0))
  );
}
export function combatChaseCommands(
  plan: SceneBehaviorBindingPlan,
): Extract<BehaviorRecipeCommand, { type: "configureChase" }>[] {
  const commands = new Map<string, Extract<BehaviorRecipeCommand, { type: "configureChase" }>>();
  for (const command of plan.commands) {
    if (command.type === "configureChase") commands.set(command.entity, command);
    else if (command.type === "configureSeekTarget" || command.type === "configureAccelerate")
      commands.delete(command.entity);
  }
  return [...commands.values()];
}
export function validateChaseStopDistance(value: number, path: string): number {
  if (
    !Number.isFinite(Math.fround(value)) ||
    value < 0 ||
    value > 4096 ||
    (value > 0 && Math.fround(value) === 0)
  )
    throw gameplayAuthoringDiagnosticError(
      path,
      "must be a finite f32 within 0..4096 (positive values must not underflow)",
    );
  return value;
}
export function compileCombatChaseBindings(bindings: readonly DataSceneCombatChaseBinding[]): {
  agents: Uint32Array;
  distances: Float32Array;
} {
  if (!Array.isArray(bindings) || bindings.length > 64)
    throw gameplayAuthoringDiagnosticError(
      "dataScene.gameplay.chaseBindings",
      "must be an array with at most 64 sources",
    );
  const agents = new Uint32Array(bindings.length * 2),
    distances = new Float32Array(bindings.length),
    seen = new Set<string>();
  for (let index = 0; index < bindings.length; index++) {
    const binding = bindings[index],
      path = `dataScene.gameplay.chaseBindings.${index}`;
    if (!binding || !binding.source || typeof binding.stopDistance !== "number")
      throw gameplayAuthoringDiagnosticError(path, "requires source and stopDistance");
    const id = uint32Number(binding.source.entityId, `${path}.source.entityId`),
      generation = uint32Number(binding.source.entityGeneration, `${path}.source.entityGeneration`);
    const key = `${id}:${generation}`;
    if (seen.has(key)) throw gameplayAuthoringDiagnosticError(path, "source may occur only once");
    seen.add(key);
    agents.set([id, generation], index * 2);
    distances[index] = validateChaseStopDistance(binding.stopDistance, `${path}.stopDistance`);
  }
  return { agents, distances };
}
