import {
  compileDataSceneSpawnPrefabs,
  resolveDataSceneSpawnPrefabs,
  type DataSceneSpawnPrefabSpec,
  type DataSceneSpawnPrefabBinding,
} from "./dataSceneSpawnPrefabs.js";
import {
  supportsDataSceneCombatCrowd,
  compileCombatChaseBindings,
  type CombatCrowdRuntime,
  type DataSceneCombatChaseBinding,
} from "./dataSceneCombatCrowd.js";
import {
  supportsDataSceneCombatMovement,
  type CombatMovementRuntime,
  combatNavigationValues,
  resolveCombatNavigation,
  supportsDataSceneCombatNavigation,
  type CombatNavigationRuntime,
  type DataSceneCombatNavigationSpec,
} from "./dataSceneCombatNavigation.js";
import type { ColorManagementMode } from "./colorManagement.js";
import {
  compileDataSceneProjectilePrefabs,
  resolveDataSceneProjectilePrefabs,
  resolveDataSceneProjectileTextures,
  type DataSceneProjectilePrefabSpec,
  type DataSceneProjectilePrefabBinding,
} from "./dataSceneProjectilePrefabs.js";
import type { Engine } from "../pkg/ferrum_core";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";
import { uint32Number } from "./particlePreset.js";
import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";

export interface DataSceneGameplayOptions {
  spawnPrefabs?: readonly DataSceneSpawnPrefabBinding[];
  combatNavigation?: DataSceneCombatNavigationSpec;
  chaseBindings?: readonly DataSceneCombatChaseBinding[];
  projectilePrefabs?: Readonly<Record<string, DataSceneProjectilePrefabSpec>>;
  projectileBindings?: readonly DataSceneProjectilePrefabBinding[];
  /** Working space for sRGB projectile colors; match the renderer. */
  colorManagement?: ColorManagementMode;
  /** Opt in to native combat execution. Defaults to false; requires primaryActor. */
  combat?: boolean;
  primaryActor?: GameplayEntityHandle;
  /** Omit for automatic proximity; bind this engine input action for nearest-target interaction. */
  interactionInputActionId?: number;
}

export interface DataSceneGameplaySpec {
  /** Standalone authored seeds; requires combat and stable ids.prefabs entries. */
  spawnPrefabs?: Readonly<Record<string, DataSceneSpawnPrefabSpec>>;
  combatNavigation?: DataSceneCombatNavigationSpec;
  /** Optional shared static projectile presentation catalog; requires combat. */
  projectilePrefabs?: Readonly<Record<string, DataSceneProjectilePrefabSpec>>;
  /** Defaults to false. Combat checkpoints require Data Scene state v9 and native progress v1. */
  combat?: boolean;
  /** Instance id in the active fragment, resolved to a fresh generation handle on every apply. */
  primaryActor?: string;
  interactionInputActionId?: number;
}

export function resolveDataSceneGameplaySpec(
  value: unknown,
  path = "dataScene.gameplay",
): DataSceneGameplaySpec {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (
      key !== "primaryActor" &&
      key !== "interactionInputActionId" &&
      key !== "combat" &&
      key !== "projectilePrefabs" &&
      key !== "combatNavigation" &&
      key !== "spawnPrefabs"
    )
      throw gameplayAuthoringDiagnosticError(`${path}.${key}`, "is not supported");
  }
  const primaryActor = input.primaryActor;
  if (
    primaryActor !== undefined &&
    (typeof primaryActor !== "string" || primaryActor.trim().length === 0)
  )
    throw gameplayAuthoringDiagnosticError(
      `${path}.primaryActor`,
      "must be a non-empty instance id",
    );
  const action = input.interactionInputActionId;
  if (
    action !== undefined &&
    (typeof action !== "number" || !Number.isInteger(action) || action <= 0 || action > 0xffffffff)
  )
    throw gameplayAuthoringDiagnosticError(
      `${path}.interactionInputActionId`,
      "must be a positive uint32 input action id",
    );
  if (action !== undefined && primaryActor === undefined)
    throw gameplayAuthoringDiagnosticError(path, "input interaction requires primaryActor");
  if (input.combat !== undefined && typeof input.combat !== "boolean")
    throw gameplayAuthoringDiagnosticError(`${path}.combat`, "must be a boolean");
  if (input.combat === true && primaryActor === undefined)
    throw gameplayAuthoringDiagnosticError(`${path}.primaryActor`, "is required for combat");
  const spawnPrefabs =
    input.spawnPrefabs === undefined
      ? undefined
      : resolveDataSceneSpawnPrefabs(input.spawnPrefabs, `${path}.spawnPrefabs`);
  if (spawnPrefabs !== undefined && input.combat !== true)
    throw gameplayAuthoringDiagnosticError(`${path}.spawnPrefabs`, "requires combat:true");
  const projectilePrefabs =
    input.projectilePrefabs === undefined
      ? undefined
      : resolveDataSceneProjectilePrefabs(input.projectilePrefabs, `${path}.projectilePrefabs`);
  if (projectilePrefabs !== undefined && input.combat !== true)
    throw gameplayAuthoringDiagnosticError(`${path}.projectilePrefabs`, "requires combat:true");
  const combatNavigation =
    input.combatNavigation === undefined
      ? undefined
      : resolveCombatNavigation(input.combatNavigation, `${path}.combatNavigation`);
  if (combatNavigation !== undefined && input.combat !== true)
    throw gameplayAuthoringDiagnosticError(`${path}.combatNavigation`, "requires combat:true");
  return {
    ...(spawnPrefabs === undefined ? {} : { spawnPrefabs }),
    ...(combatNavigation === undefined ? {} : { combatNavigation }),
    ...(projectilePrefabs === undefined ? {} : { projectilePrefabs }),
    ...(input.combat === undefined ? {} : { combat: input.combat as boolean }),
    ...(primaryActor === undefined ? {} : { primaryActor: primaryActor as string }),
    ...(action === undefined ? {} : { interactionInputActionId: action as number }),
  };
}

interface CombatRuntime extends CombatNavigationRuntime, CombatCrowdRuntime, CombatMovementRuntime {
  data_scene_projectile_visuals_version?(): number;
  configure_data_scene_gameplay_v8?(
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
    actorPrefabs: Uint32Array,
    visuals: Uint32Array,
    fps: Float32Array,
    frames: Float32Array,
  ): boolean;
  data_scene_spawn_prefabs_version?(): number;
  configure_data_scene_gameplay_v7?(
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
    actorPrefabs: Uint32Array,
  ): boolean;
  data_scene_combat_actions_version?(): number;
  data_scene_projectile_prefabs_version?(): number;
  configure_data_scene_gameplay_v3?(
    hasActor: boolean,
    id: number,
    generation: number,
    interactionActionId: number,
    combat: boolean,
    metadata: Uint32Array,
    values: Float32Array,
    bindings: Uint32Array,
  ): boolean;
  configure_data_scene_gameplay_v2?(
    hasActor: boolean,
    id: number,
    generation: number,
    interactionActionId: number,
    combat: boolean,
  ): boolean;
  data_scene_combat_enabled?(): boolean;
  data_scene_combat_stats?(): Uint32Array;
  data_scene_input_projectiles_version?(): number;
  data_scene_combat_progress_version?(): number;
}

/** Native melee/dash input, timer execution and checkpoint state. SpawnPrefab is separate. */
export function supportsDataSceneCombatActions(engine: Engine & CombatRuntime): boolean {
  return engine.data_scene_combat_actions_version?.() === 1;
}

/** Explicit feature gate: earlier combat builds only execute timer-driven enemy fire. */
export function supportsDataSceneInputProjectiles(engine: Engine & CombatRuntime): boolean {
  return engine.data_scene_input_projectiles_version?.() === 1;
}

/** Combat checkpoints require their own versioned native codec and atomic restore. */
export function supportsDataSceneCombatProgress(engine: Engine & CombatRuntime): boolean {
  const version = engine.data_scene_combat_progress_version?.();
  return version === 1 || version === 2 || version === 3 || version === 4;
}

export function dataSceneCombatEnabled(engine: Engine): boolean {
  return (engine as Engine & CombatRuntime).data_scene_combat_enabled?.() ?? false;
}

export function supportsDataSceneProjectilePrefabs(engine: Engine & CombatRuntime): boolean {
  const version = engine.data_scene_combat_progress_version?.();
  return (
    engine.data_scene_projectile_prefabs_version?.() === 1 &&
    (version === 2 || version === 3 || version === 4)
  );
}

export function supportsDataSceneSpawnPrefabs(engine: Engine & CombatRuntime): boolean {
  const version = engine.data_scene_combat_progress_version?.();
  return (
    engine.data_scene_spawn_prefabs_version?.() === 1 &&
    (version === 3 || version === 4) &&
    typeof engine.configure_data_scene_gameplay_v7 === "function"
  );
}

export function supportsDataSceneProjectileVisuals(engine: Engine & CombatRuntime): boolean {
  return (
    engine.data_scene_projectile_visuals_version?.() === 1 &&
    engine.data_scene_combat_progress_version?.() === 4 &&
    typeof engine.configure_data_scene_gameplay_v8 === "function"
  );
}

export function configureDataSceneGameplay(
  engine: Engine & CombatRuntime,
  options: DataSceneGameplayOptions,
  textureId: (name: string) => number = (name) => {
    throw gameplayAuthoringDiagnosticError(
      "dataScene.gameplay.projectilePrefabs",
      `texture resolver required for '${name}'`,
    );
  },
): boolean {
  const actor = options.primaryActor;
  const action =
    options.interactionInputActionId === undefined
      ? 0
      : uint32Number(options.interactionInputActionId, "gameplay.interactionInputActionId");
  if (options.interactionInputActionId !== undefined && (action === 0 || actor === undefined))
    throw gameplayAuthoringDiagnosticError(
      "dataScene.gameplay",
      "input interaction requires a primary actor and a positive action id",
    );
  if (options.combat !== undefined && typeof options.combat !== "boolean")
    throw gameplayAuthoringDiagnosticError("dataScene.gameplay.combat", "must be a boolean");
  if (options.combat === true && actor === undefined)
    throw gameplayAuthoringDiagnosticError(
      "dataScene.gameplay.primaryActor",
      "is required for combat",
    );
  const args = [
    actor !== undefined,
    actor === undefined ? 0 : uint32Number(actor.entityId, "gameplay.primaryActor.entityId"),
    actor === undefined
      ? 0
      : uint32Number(actor.entityGeneration, "gameplay.primaryActor.entityGeneration"),
    action,
  ] as const;
  const allMovement = options.combatNavigation?.movementPatterns === "all";
  if (allMovement && !supportsDataSceneCombatMovement(engine))
    throw gameplayAuthoringDiagnosticError(
      "dataScene.gameplay.combatNavigation.movementPatterns",
      "requires a compatible spatial combat-movement Wasm build",
    );
  const crowd =
    options.chaseBindings !== undefined || options.combatNavigation?.crowdAvoidance !== undefined;
  if (crowd && (options.combatNavigation === undefined || !supportsDataSceneCombatCrowd(engine)))
    throw gameplayAuthoringDiagnosticError(
      "dataScene.gameplay.combatNavigation",
      "chase distances and crowd avoidance require navigation and a compatible combat-crowd Wasm build",
    );
  const chaseBatch =
    crowd || allMovement || options.spawnPrefabs !== undefined
      ? compileCombatChaseBindings(options.chaseBindings ?? [])
      : undefined;
  const navigation =
    options.combatNavigation === undefined
      ? undefined
      : combatNavigationValues(options.combatNavigation);
  if (
    navigation !== undefined &&
    (options.combat !== true || !supportsDataSceneCombatNavigation(engine))
  )
    throw gameplayAuthoringDiagnosticError(
      "dataScene.gameplay.combatNavigation",
      "requires combat:true and a compatible combat-navigation Wasm build",
    );
  if (
    options.spawnPrefabs !== undefined ||
    navigation !== undefined ||
    options.projectilePrefabs !== undefined ||
    options.projectileBindings !== undefined
  ) {
    if (
      options.combat !== true ||
      !supportsDataSceneProjectilePrefabs(engine) ||
      !engine.configure_data_scene_gameplay_v3
    )
      throw gameplayAuthoringDiagnosticError(
        "dataScene.gameplay.projectilePrefabs",
        "requires combat:true and a compatible projectile-prefab Wasm build",
      );
    const catalog = resolveDataSceneProjectileTextures(
      resolveDataSceneProjectilePrefabs(
        options.projectilePrefabs ?? {},
        "dataScene.gameplay.projectilePrefabs",
      ),
      textureId,
    );
    const batch = compileDataSceneProjectilePrefabs(
      catalog,
      options.projectileBindings ?? [],
      options.colorManagement,
    );
    if (batch.visuals !== undefined) {
      if (!supportsDataSceneProjectileVisuals(engine))
        throw gameplayAuthoringDiagnosticError(
          "dataScene.gameplay.projectilePrefabs",
          "animation/rotation requires a compatible projectile-visual Wasm build",
        );
      let nav = navigation ?? new Float32Array();
      if (navigation !== undefined && (crowd || allMovement)) {
        nav = new Float32Array(7);
        nav.set(navigation);
        nav[6] =
          resolveCombatNavigation(options.combatNavigation!, "dataScene.gameplay.combatNavigation")
            .crowdAvoidance?.padding ?? -1;
      }
      const chase = chaseBatch ?? compileCombatChaseBindings([]);
      return engine.configure_data_scene_gameplay_v8!(
        ...args,
        true,
        batch.metadata,
        batch.values,
        batch.bindings,
        nav,
        chase.agents,
        chase.distances,
        +allMovement,
        compileDataSceneSpawnPrefabs(options.spawnPrefabs ?? []),
        batch.visuals.metadata,
        batch.visuals.fps,
        batch.visuals.frames,
      );
    }
    if (options.spawnPrefabs !== undefined) {
      if (!supportsDataSceneSpawnPrefabs(engine))
        throw gameplayAuthoringDiagnosticError(
          "dataScene.gameplay.spawnPrefabs",
          "requires a compatible spawn-prefab Wasm build",
        );
      let nav = navigation ?? new Float32Array();
      if (navigation !== undefined && (crowd || allMovement)) {
        nav = new Float32Array(7);
        nav.set(navigation);
        nav[6] =
          resolveCombatNavigation(options.combatNavigation!, "dataScene.gameplay.combatNavigation")
            .crowdAvoidance?.padding ?? -1;
      }
      return engine.configure_data_scene_gameplay_v7!(
        ...args,
        true,
        batch.metadata,
        batch.values,
        batch.bindings,
        nav,
        chaseBatch!.agents,
        chaseBatch!.distances,
        +allMovement,
        compileDataSceneSpawnPrefabs(options.spawnPrefabs),
      );
    }
    if (allMovement && navigation !== undefined) {
      const extended = new Float32Array(7);
      extended.set(navigation);
      extended[6] =
        resolveCombatNavigation(options.combatNavigation!, "dataScene.gameplay.combatNavigation")
          .crowdAvoidance?.padding ?? -1;
      return engine.configure_data_scene_gameplay_v6!(
        ...args,
        true,
        batch.metadata,
        batch.values,
        batch.bindings,
        extended,
        chaseBatch!.agents,
        chaseBatch!.distances,
        1,
      );
    }
    if (crowd && navigation !== undefined) {
      const extended = new Float32Array(7);
      extended.set(navigation);
      extended[6] =
        resolveCombatNavigation(options.combatNavigation!, "dataScene.gameplay.combatNavigation")
          .crowdAvoidance?.padding ?? -1;
      return engine.configure_data_scene_gameplay_v5!(
        ...args,
        true,
        batch.metadata,
        batch.values,
        batch.bindings,
        extended,
        chaseBatch!.agents,
        chaseBatch!.distances,
      );
    }
    if (navigation !== undefined)
      return engine.configure_data_scene_gameplay_v4!(
        ...args,
        true,
        batch.metadata,
        batch.values,
        batch.bindings,
        navigation,
      );
    return engine.configure_data_scene_gameplay_v3(
      ...args,
      true,
      batch.metadata,
      batch.values,
      batch.bindings,
    );
  }
  if (typeof engine.configure_data_scene_gameplay_v2 === "function")
    return engine.configure_data_scene_gameplay_v2(...args, options.combat ?? false);
  if (options.combat)
    throw gameplayAuthoringDiagnosticError(
      "dataScene.gameplay.combat",
      "requires a compatible combat Wasm build",
    );
  return engine.configure_data_scene_gameplay(...args);
}

/** Low-frequency diagnostics. Counts saturate at uint32 max; no per-entity Wasm reads. */
export interface DataSceneCombatStats {
  /** Movement actors processed in the latest native step, excluding the primary actor. */
  readonly actors: number;
  readonly projectiles: number;
  readonly aiSteps: number;
  readonly spawned: number;
  readonly hits: number;
  readonly kills: number;
  readonly expired: number;
  readonly capped: number;
  readonly particlesSpawned: number;
}

export function dataSceneCombatStats(
  engine: Engine & CombatRuntime,
): DataSceneCombatStats | undefined {
  if (typeof engine.data_scene_combat_stats !== "function") return undefined;
  const values = engine.data_scene_combat_stats();
  if (values.length !== 10 || values[0] !== 1)
    throw new Error("Unsupported Data Scene combat diagnostics ABI");
  return {
    actors: values[1]!,
    projectiles: values[2]!,
    aiSteps: values[3]!,
    spawned: values[4]!,
    hits: values[5]!,
    kills: values[6]!,
    expired: values[7]!,
    capped: values[8]!,
    particlesSpawned: values[9]!,
  };
}
