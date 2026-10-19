import { combatChaseCommands, validateChaseStopDistance } from "./dataSceneCombatCrowd.js";
import type { Engine } from "../pkg/ferrum_core";
import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import { resolveDataSceneInstanceComponents } from "./dataSceneComponents.js";
import type { BehaviorRecipeCommand } from "./behaviorRecipes.js";
import type { SceneBehaviorBindingPlan } from "./gameplayAuthoring.js";
import type { DataSceneSpatialSpec } from "./dataSceneSpatial.js";

/** Opt-in native Chase routing over spatial walkable surfaces and authored connections. */
export interface DataSceneCombatNavigationSpec {
  /** Omit/chase keeps legacy ownership. all also routes SeekTarget and moves Accelerate on terrain. */
  movementPatterns?: "chase" | "all";
  /** Omit to retain legacy overlap behavior. Padding is an extra world-unit gap. */
  crowdAvoidance?: { padding?: number };
  cellSize?: number;
  maxStepHeight?: number;
  maxDropHeight?: number;
  repathIntervalSeconds?: number;
  arrivalRadius?: number;
  maxAgents?: number;
}
type ResolvedCombatNavigation = Required<
  Omit<DataSceneCombatNavigationSpec, "crowdAvoidance" | "movementPatterns">
> &
  Pick<DataSceneCombatNavigationSpec, "crowdAvoidance" | "movementPatterns">;
const defaults = {
  cellSize: 8,
  maxStepHeight: 8,
  maxDropHeight: 40,
  repathIntervalSeconds: 0.5,
  arrivalRadius: 4,
  maxAgents: 32,
} as const;
export function resolveCombatNavigation(value: unknown, path: string): ResolvedCombatNavigation {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input))
    if (
      key !== "movementPatterns" &&
      key !== "crowdAvoidance" &&
      !Object.prototype.hasOwnProperty.call(defaults, key)
    )
      throw gameplayAuthoringDiagnosticError(`${path}.${key}`, "is not supported");
  const result: ResolvedCombatNavigation = { ...defaults };
  if (input.movementPatterns !== undefined) {
    if (input.movementPatterns !== "chase" && input.movementPatterns !== "all")
      throw gameplayAuthoringDiagnosticError(`${path}.movementPatterns`, "must be chase or all");
    result.movementPatterns = input.movementPatterns;
  }
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    const v = input[key] === undefined ? defaults[key] : input[key];
    if (typeof v !== "number" || !Number.isFinite(Math.fround(v)))
      throw gameplayAuthoringDiagnosticError(`${path}.${key}`, "must be a finite f32 number");
    result[key] = v;
  }
  const ranges = {
    cellSize: [0, 4096],
    maxStepHeight: [0, 65536],
    maxDropHeight: [0, 65536],
    repathIntervalSeconds: [0.05, 60],
    arrivalRadius: [0, 4096],
    maxAgents: [1, 64],
  };
  for (const key of Object.keys(ranges) as (keyof typeof defaults)[]) {
    const [min, max] = ranges[key];
    if (
      result[key] < min! ||
      result[key] > max! ||
      (key === "cellSize" && Math.fround(result[key]) <= 0) ||
      (key === "maxAgents" && !Number.isInteger(result[key]))
    )
      throw gameplayAuthoringDiagnosticError(
        `${path}.${key}`,
        `must be ${key === "cellSize" ? "> 0 and " : ""}within ${min}..${max}${key === "maxAgents" ? " (integer)" : ""}`,
      );
  }
  if (input.crowdAvoidance !== undefined) {
    const crowd = input.crowdAvoidance;
    if (!crowd || typeof crowd !== "object" || Array.isArray(crowd))
      throw gameplayAuthoringDiagnosticError(`${path}.crowdAvoidance`, "must be an object");
    for (const key of Object.keys(crowd))
      if (key !== "padding")
        throw gameplayAuthoringDiagnosticError(`${path}.crowdAvoidance.${key}`, "is not supported");
    const padding = (crowd as { padding?: unknown }).padding;
    if (
      padding !== undefined &&
      (typeof padding !== "number" ||
        !Number.isFinite(Math.fround(padding)) ||
        padding < 0 ||
        padding > 4096 ||
        (padding > 0 && Math.fround(padding) === 0))
    )
      throw gameplayAuthoringDiagnosticError(
        `${path}.crowdAvoidance.padding`,
        "must be a finite f32 within 0..4096 without positive underflow",
      );
    result.crowdAvoidance = { padding: padding === undefined ? 0 : (padding as number) };
  }
  return result;
}
export function validateCombatNavigationBindings(
  config: DataSceneCombatNavigationSpec,
  primaryActor: string | undefined,
  spatial: DataSceneSpatialSpec | undefined,
  plan: SceneBehaviorBindingPlan,
  path: string,
): void {
  const resolved = resolveCombatNavigation(config, path);
  if (!spatial || spatial.terrain.length === 0)
    throw gameplayAuthoringDiagnosticError(path, "requires spatial terrain and camera");
  for (const command of plan.commands)
    if (command.type === "configureChase") {
      validateChaseStopDistance(command.stopDistance, `${path}.${command.entity}.stopDistance`);
      if (command.entity === primaryActor && command.stopDistance > 0)
        throw gameplayAuthoringDiagnosticError(
          `${path}.${command.entity}.stopDistance`,
          "requires a non-primary Chase source",
        );
    }
  type MotionCommand = Extract<
    BehaviorRecipeCommand,
    { type: "configureChase" | "configureSeekTarget" | "configureAccelerate" }
  >;
  const effective = new Map<string, MotionCommand>();
  if (resolved.movementPatterns === "all")
    for (const c of plan.commands) {
      if (
        c.type === "configureChase" ||
        c.type === "configureSeekTarget" ||
        c.type === "configureAccelerate"
      )
        effective.set(c.entity, c);
    }
  const commands: Map<string, MotionCommand> =
    resolved.movementPatterns === "all"
      ? effective
      : new Map(combatChaseCommands(plan).map((c) => [c.entity, c]));
  const sources = [...commands.keys()].filter((id) => id !== primaryActor);
  if (sources.length > resolved.maxAgents)
    throw gameplayAuthoringDiagnosticError(
      `${path}.maxAgents`,
      "must cover all authored movement sources in the selected mode (maximum 64)",
    );
  const components = (id: string) => {
    const instance = plan.instances.find((i) => i.id === id);
    if (!instance) throw gameplayAuthoringDiagnosticError(path, `missing instance '${id}'`);
    return resolveDataSceneInstanceComponents(instance, {
      allowTemplate: false,
      path: `${path}.${id}`,
    });
  };
  for (const id of sources) {
    const c = components(id);
    if (
      c.mode !== "inline" ||
      c.body?.type !== "kinematic" ||
      !c.body.heightSpan ||
      c.collider.type !== "aabb" ||
      !c.collider.enabled ||
      spatial.attachments?.[id]
    )
      throw gameplayAuthoringDiagnosticError(
        `${path}.${id}`,
        "requires an unattached enabled kinematic heightSpan body and single AABB collider (trigger allowed)",
      );
  }
  const targets = new Set(
    [
      primaryActor,
      ...[...commands.values()].map((c) =>
        (c.type === "configureChase" || c.type === "configureSeekTarget") &&
        plan.instances.some((i) => i.id === c.target)
          ? c.target
          : undefined,
      ),
    ].filter((id): id is string => id !== undefined),
  );
  for (const id of targets) {
    const c = components(id);
    if (c.mode !== "inline" || !c.body?.heightSpan)
      throw gameplayAuthoringDiagnosticError(
        `${path}.${id}`,
        "target requires an inline heightSpan body",
      );
  }
}
export function combatNavigationValues(config: DataSceneCombatNavigationSpec): Float32Array {
  const v = resolveCombatNavigation(config, "dataScene.gameplay.combatNavigation");
  return new Float32Array([
    v.cellSize,
    v.maxStepHeight,
    v.maxDropHeight,
    v.repathIntervalSeconds,
    v.arrivalRadius,
    v.maxAgents,
  ]);
}
export interface DataSceneCombatNavigationStats {
  readonly enabled: boolean;
  readonly agents: number;
  readonly moving: number;
  readonly waitingOrBlocked: number;
  readonly searches: number;
  readonly failed: number;
  readonly deferred: number;
  readonly frameSearches: number;
  readonly frameWorkUnits: number;
  /** Same request status codes as Data Scene spatial move diagnostics (0..8). */
  readonly lastRequestStatus: number;
  readonly lastSearchNodes: number;
  readonly lastSearchProbes: number;
}
export interface CombatNavigationRuntime {
  data_scene_combat_navigation_version?(): number;
  data_scene_combat_navigation_stats?(): Uint32Array;
  configure_data_scene_gameplay_v4?(
    hasActor: boolean,
    id: number,
    generation: number,
    interaction: number,
    combat: boolean,
    metadata: Uint32Array,
    values: Float32Array,
    bindings: Uint32Array,
    navigation: Float32Array,
  ): boolean;
}
export function supportsDataSceneCombatNavigation(
  engine: Engine & CombatNavigationRuntime,
): boolean {
  return (
    engine.data_scene_combat_navigation_version?.() === 1 &&
    typeof engine.configure_data_scene_gameplay_v4 === "function"
  );
}
export function dataSceneCombatNavigationStats(
  engine: Engine & CombatNavigationRuntime,
): DataSceneCombatNavigationStats | undefined {
  if (!engine.data_scene_combat_navigation_stats) return undefined;
  const v = engine.data_scene_combat_navigation_stats();
  if (v.length !== 13 || v[0] !== 1)
    throw new Error("Unsupported Data Scene combat navigation diagnostics ABI");
  return {
    enabled: v[1] === 1,
    agents: v[2]!,
    moving: v[3]!,
    waitingOrBlocked: v[4]!,
    searches: v[5]!,
    failed: v[6]!,
    deferred: v[7]!,
    frameSearches: v[8]!,
    frameWorkUnits: v[9]!,
    lastRequestStatus: v[10]!,
    lastSearchNodes: v[11]!,
    lastSearchProbes: v[12]!,
  };
}

/** Disposable native search/cache diagnostics; no routes or live entity handles cross Wasm. */
export interface DataSceneCombatNavigationSchedulerStats {
  readonly enabled: boolean;
  readonly pendingSearches: number;
  readonly cachedRoutes: number;
  readonly cacheHits: number;
  readonly searchSlices: number;
  readonly yieldedSlices: number;
  readonly cancelledSearches: number;
  /** Static slice target 262144; large atomic queries and crowd refinement <= 600000. */
  readonly frameSearchWorkUnits: number;
  readonly peakSearchWorkUnits: number;
}
export interface CombatNavigationSchedulerRuntime {
  data_scene_combat_navigation_scheduler_version?(): number;
  data_scene_combat_navigation_scheduler_stats?(): Uint32Array;
}
export function supportsDataSceneCombatNavigationScheduler(
  engine: Engine & CombatNavigationSchedulerRuntime,
): boolean {
  return (
    engine.data_scene_combat_navigation_scheduler_version?.() === 1 &&
    typeof engine.data_scene_combat_navigation_scheduler_stats === "function"
  );
}
export function dataSceneCombatNavigationSchedulerStats(
  engine: Engine & CombatNavigationSchedulerRuntime,
): DataSceneCombatNavigationSchedulerStats | undefined {
  if (!engine.data_scene_combat_navigation_scheduler_stats) return undefined;
  const v = engine.data_scene_combat_navigation_scheduler_stats();
  if (v.length !== 10 || v[0] !== 1)
    throw new Error("Unsupported Data Scene combat navigation scheduler diagnostics ABI");
  return {
    enabled: v[1] === 1,
    pendingSearches: v[2]!,
    cachedRoutes: v[3]!,
    cacheHits: v[4]!,
    searchSlices: v[5]!,
    yieldedSlices: v[6]!,
    cancelledSearches: v[7]!,
    frameSearchWorkUnits: v[8]!,
    peakSearchWorkUnits: v[9]!,
  };
}

export interface CombatMovementRuntime {
  data_scene_combat_movement_version?(): number;
  configure_data_scene_gameplay_v6?(
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
    flags: number,
  ): boolean;
}
export function supportsDataSceneCombatMovement(engine: Engine & CombatMovementRuntime): boolean {
  return (
    engine.data_scene_combat_movement_version?.() === 1 &&
    typeof engine.configure_data_scene_gameplay_v6 === "function"
  );
}
