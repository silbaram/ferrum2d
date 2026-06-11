import {
  diagnosticReport,
  gameplayAuthoringDiagnosticError,
  type DiagnosticReport,
} from "./diagnostics.js";
import {
  behaviorRecipeCommandsForEntity,
  resolveBehaviorRecipeDocument,
  type BehaviorRecipeApplyResult,
  type BehaviorRecipeCommand,
  type BehaviorRecipeCommandOptions,
  type BehaviorRecipeDocumentSpec,
  type BehaviorRecipeRuntimeTarget,
  type ResolvedBehaviorRecipeDocument,
} from "./behaviorRecipes.js";
import {
  instantiateSceneFragment,
  resolveSceneCompositionSpec,
  type InstantiateSceneFragmentOptions,
  type ResolvedSceneCompositionInstance,
  type ResolvedSceneCompositionSpec,
  type SceneCompositionSpec,
} from "./sceneComposition.js";
import {
  GAMEPLAY_FACTION_CODES,
  GAMEPLAY_FACTION_ID_RANGE_LABEL,
  gameplayFactionCode,
  gameplayFactionMask,
  MAX_GAMEPLAY_FACTION_ID,
  type GameplayFactionReference,
} from "./gameplayFactionRelations.js";

export {
  applyFactionRelationTable,
  type ApplyFactionRelationTableOptions,
  type ApplyFactionRelationTableResult,
  type FactionRelation,
  type FactionRelationEntrySpec,
  type FactionRelationRuntimeEngine,
  type FactionRelationTableSpec,
  type GameplayFactionReference,
} from "./gameplayFactionRelations.js";

export const GAMEPLAY_BEHAVIOR_BINDING_PROP = "behaviorRecipes" as const;

export type GameplayBehaviorBindingSpec = string | readonly string[];
export type MissingSceneBehaviorBinding = "ignore" | "error";
const GAMEPLAY_PICKUP_ITEM_SCORE = 1;
const MAX_PARTICLE_PRESETS = 256;
const MAX_GAMEPLAY_TAG_ID = 31;
const GAMEPLAY_TAG_ID_RANGE_LABEL = `0..${MAX_GAMEPLAY_TAG_ID}`;
const GAMEPLAY_MOVEMENT_QUERY_LAYER_TARGET_PREFIX = "nearestLayer:" as const;
const GAMEPLAY_MOVEMENT_QUERY_FACTION_TARGET_PREFIX = "nearestFaction:" as const;
const GAMEPLAY_MOVEMENT_QUERY_TAG_TARGET_PREFIX = "nearestTag:" as const;
const GAMEPLAY_MOVEMENT_QUERY_LAYER_CODES = Object.freeze({
  player: 0,
  enemy: 1,
  bullet: 2,
  wall: 3,
  pickup: 4,
} as const);
type GameplayMovementQueryLayer = keyof typeof GAMEPLAY_MOVEMENT_QUERY_LAYER_CODES;
type GameplayMovementQueryFaction = GameplayFactionReference;

export type GameplayEntityHandleMap =
  | Readonly<Record<string, GameplayEntityHandle>>
  | ReadonlyMap<string, GameplayEntityHandle>;

export interface GameplayBehaviorRuntimeIds {
  items?: Readonly<Record<string, number>>;
  actions?: Readonly<Record<string, number>>;
  prefabs?: Readonly<Record<string, number>>;
  timers?: Readonly<Record<string, number>>;
  tags?: Readonly<Record<string, number>>;
  effects?: Readonly<Record<string, number>>;
}

export interface ResolveGameplayBehaviorRuntimeIdsOptions {
  path?: string;
  requiredItems?: readonly string[];
  requiredActions?: readonly string[];
  requiredPrefabs?: readonly string[];
  requiredTimers?: readonly string[];
  requiredTags?: readonly string[];
  requiredEffects?: readonly string[];
}

export type GameplayPrefabRegistrationKind = "enemy" | "bullet";

export interface GameplayPrefabRegistration {
  prefab?: string;
  prefabId?: number;
  kind: GameplayPrefabRegistrationKind;
}

export interface RegisterGameplayPrefabsOptions {
  path?: string;
  ids?: GameplayBehaviorRuntimeIds;
}

export interface RegisterGameplayPrefabsResult {
  registrations: readonly GameplayPrefabRegistration[];
  results: readonly boolean[];
}

export interface GameplayEntityHandle {
  entityId: number;
  entityGeneration: number;
}

export interface GameplayBehaviorRuntimeEngine {
  register_gameplay_enemy_prefab?(prefabId: number): boolean;
  register_gameplay_bullet_prefab?(prefabId: number): boolean;
  gameplay_entity_exists?(entityId: number, entityGeneration: number): boolean;
  capture_gameplay_authoring_snapshot?(entityId: number, entityGeneration: number): boolean;
  restore_gameplay_authoring_snapshot?(entityId: number, entityGeneration: number): boolean;
  clear_gameplay_authoring_snapshot?(): void;
  set_gameplay_health(entityId: number, entityGeneration: number, current: number): boolean;
  clear_gameplay_health(entityId: number, entityGeneration: number): boolean;
  set_gameplay_damage(entityId: number, entityGeneration: number, amount: number): boolean;
  clear_gameplay_damage(entityId: number, entityGeneration: number): boolean;
  set_gameplay_damage_reaction?(entityId: number, entityGeneration: number, amount: number, target: number): boolean;
  set_gameplay_area_damage_reaction?(
    entityId: number,
    entityGeneration: number,
    amount: number,
    radius: number,
    targetLayerCode: number,
  ): boolean;
  set_gameplay_faction?(entityId: number, entityGeneration: number, factionId: number, damageMask: number): boolean;
  clear_gameplay_faction?(entityId: number, entityGeneration: number): boolean;
  set_gameplay_tags?(entityId: number, entityGeneration: number, tagMask: number): boolean;
  clear_gameplay_tags?(entityId: number, entityGeneration: number): boolean;
  set_gameplay_lifetime(entityId: number, entityGeneration: number, seconds: number): boolean;
  clear_gameplay_lifetime(entityId: number, entityGeneration: number): boolean;
  set_gameplay_score_reward(entityId: number, entityGeneration: number, reward: number): boolean;
  clear_gameplay_score_reward(entityId: number, entityGeneration: number): boolean;
  set_gameplay_pickup(
    entityId: number,
    entityGeneration: number,
    itemId: number,
    count: number,
    despawnOnCollect: boolean,
  ): boolean;
  clear_gameplay_pickup(entityId: number, entityGeneration: number): boolean;
  set_gameplay_interaction(
    entityId: number,
    entityGeneration: number,
    actionId: number,
    radius: number,
    once: boolean,
  ): boolean;
  clear_gameplay_interaction(entityId: number, entityGeneration: number): boolean;
  set_gameplay_timer_trigger?(entityId: number, entityGeneration: number, timerId: number, durationSeconds: number): boolean;
  set_gameplay_timer_action_trigger?(
    entityId: number,
    entityGeneration: number,
    timerId: number,
    durationSeconds: number,
    actionId: number,
  ): boolean;
  clear_gameplay_timer_trigger?(entityId: number, entityGeneration: number): boolean;
  set_gameplay_action_projectile?(
    entityId: number,
    entityGeneration: number,
    actionId: number,
    cooldownSeconds: number,
    speed: number,
    damage: number,
    lifetimeSeconds: number,
  ): boolean;
  set_gameplay_action_projectile_with_target?(
    entityId: number,
    entityGeneration: number,
    actionId: number,
    cooldownSeconds: number,
    speed: number,
    damage: number,
    lifetimeSeconds: number,
    aimCode: number,
    collisionTargetCode: number,
    tileImpactCode: number,
  ): boolean;
  set_gameplay_action_dash?(
    entityId: number,
    entityGeneration: number,
    actionId: number,
    cooldownSeconds: number,
    distance: number,
  ): boolean;
  set_gameplay_action_dash_with_aim?(
    entityId: number,
    entityGeneration: number,
    actionId: number,
    cooldownSeconds: number,
    distance: number,
    aimCode: number,
  ): boolean;
  set_gameplay_action_melee?(
    entityId: number,
    entityGeneration: number,
    actionId: number,
    cooldownSeconds: number,
    range: number,
    damage: number,
  ): boolean;
  set_gameplay_action_melee_with_target?(
    entityId: number,
    entityGeneration: number,
    actionId: number,
    cooldownSeconds: number,
    range: number,
    damage: number,
    targetCode: number,
  ): boolean;
  set_gameplay_action_spawn_prefab?(
    entityId: number,
    entityGeneration: number,
    actionId: number,
    cooldownSeconds: number,
    prefabId: number,
    anchorCode: number,
    phaseCode: number,
    offsetX: number,
    offsetY: number,
  ): boolean;
  set_gameplay_action_spawn_projectile_prefab?(
    entityId: number,
    entityGeneration: number,
    actionId: number,
    cooldownSeconds: number,
    prefabId: number,
    anchorCode: number,
    phaseCode: number,
    offsetX: number,
    offsetY: number,
    speed: number,
    damage: number,
    lifetimeSeconds: number,
    aimCode: number,
    collisionTargetCode: number,
    tileImpactCode: number,
  ): boolean;
  clear_gameplay_actions?(entityId: number, entityGeneration: number): boolean;
  set_gameplay_movement_chase_player(entityId: number, entityGeneration: number, speed: number): boolean;
  set_gameplay_movement_chase_nearest_player?(
    entityId: number,
    entityGeneration: number,
    speed: number,
  ): boolean;
  set_gameplay_movement_chase_nearest_enemy?(
    entityId: number,
    entityGeneration: number,
    speed: number,
  ): boolean;
  set_gameplay_movement_chase_nearest_layer?(
    entityId: number,
    entityGeneration: number,
    layerCode: number,
    speed: number,
  ): boolean;
  set_gameplay_movement_chase_nearest_faction?(
    entityId: number,
    entityGeneration: number,
    factionId: number,
    speed: number,
  ): boolean;
  set_gameplay_movement_chase_nearest_tag?(
    entityId: number,
    entityGeneration: number,
    tagId: number,
    speed: number,
  ): boolean;
  set_gameplay_movement_chase_entity(
    entityId: number,
    entityGeneration: number,
    targetId: number,
    targetGeneration: number,
    speed: number,
  ): boolean;
  set_gameplay_movement_seek_target_player?(
    entityId: number,
    entityGeneration: number,
    speed: number,
    turnRate: number,
  ): boolean;
  set_gameplay_movement_seek_target_nearest_player?(
    entityId: number,
    entityGeneration: number,
    speed: number,
    turnRate: number,
  ): boolean;
  set_gameplay_movement_seek_target_nearest_enemy?(
    entityId: number,
    entityGeneration: number,
    speed: number,
    turnRate: number,
  ): boolean;
  set_gameplay_movement_seek_target_nearest_layer?(
    entityId: number,
    entityGeneration: number,
    layerCode: number,
    speed: number,
    turnRate: number,
  ): boolean;
  set_gameplay_movement_seek_target_nearest_faction?(
    entityId: number,
    entityGeneration: number,
    factionId: number,
    speed: number,
    turnRate: number,
  ): boolean;
  set_gameplay_movement_seek_target_nearest_tag?(
    entityId: number,
    entityGeneration: number,
    tagId: number,
    speed: number,
    turnRate: number,
  ): boolean;
  set_gameplay_movement_seek_target_entity?(
    entityId: number,
    entityGeneration: number,
    targetId: number,
    targetGeneration: number,
    speed: number,
    turnRate: number,
  ): boolean;
  set_gameplay_movement_accelerate?(
    entityId: number,
    entityGeneration: number,
    accelerationX: number,
    accelerationY: number,
    maxSpeed: number,
  ): boolean;
  clear_gameplay_movement?(entityId: number, entityGeneration: number): boolean;
  clear_gameplay_collision_reactions?(entityId: number, entityGeneration: number): boolean;
  add_gameplay_collision_damage(entityId: number, entityGeneration: number, target: number): boolean;
  add_gameplay_collision_area_damage?(entityId: number, entityGeneration: number, radius: number, targetLayerCode: number): boolean;
  add_gameplay_collision_knockback?(
    entityId: number,
    entityGeneration: number,
    target: number,
    impulse: number,
  ): boolean;
  add_gameplay_collision_emit_effect?(
    entityId: number,
    entityGeneration: number,
    effectId: number,
    effectType: number,
    target: number,
    cooldownSeconds: number,
    trigger: number,
  ): boolean;
  add_gameplay_collision_emit_effect_with_payload?(
    entityId: number,
    entityGeneration: number,
    effectId: number,
    effectType: number,
    target: number,
    cooldownSeconds: number,
    trigger: number,
    intensity: number,
    radius: number,
  ): boolean;
  add_gameplay_collision_spawn_prefab?(
    entityId: number,
    entityGeneration: number,
    actionId: number,
    prefabId: number,
    target: number,
    cooldownSeconds: number,
    trigger: number,
    offsetX: number,
    offsetY: number,
  ): boolean;
  add_gameplay_collision_pickup?(entityId: number, entityGeneration: number, target: number): boolean;
  add_gameplay_collision_sound?(entityId: number, entityGeneration: number, soundId: number, volume: number, pitch: number): boolean;
  add_gameplay_collision_sound_with_cooldown?(
    entityId: number,
    entityGeneration: number,
    soundId: number,
    volume: number,
    pitch: number,
    cooldownSeconds: number,
  ): boolean;
  add_gameplay_collision_sound_with_policy?(
    entityId: number,
    entityGeneration: number,
    soundId: number,
    volume: number,
    pitch: number,
    cooldownSeconds: number,
    replaceDefault: boolean,
  ): boolean;
  add_gameplay_collision_sound_with_trigger?(
    entityId: number,
    entityGeneration: number,
    soundId: number,
    volume: number,
    pitch: number,
    cooldownSeconds: number,
    replaceDefault: boolean,
    trigger: number,
  ): boolean;
  add_gameplay_collision_camera_shake?(
    entityId: number,
    entityGeneration: number,
  ): boolean;
  add_gameplay_collision_camera_shake_with_cooldown?(
    entityId: number,
    entityGeneration: number,
    cooldownSeconds: number,
  ): boolean;
  add_gameplay_collision_camera_shake_with_trigger?(
    entityId: number,
    entityGeneration: number,
    cooldownSeconds: number,
    trigger: number,
  ): boolean;
  add_gameplay_collision_particle?(entityId: number, entityGeneration: number, presetId: number, target: number): boolean;
  add_gameplay_collision_particle_with_cooldown?(
    entityId: number,
    entityGeneration: number,
    presetId: number,
    target: number,
    cooldownSeconds: number,
  ): boolean;
  add_gameplay_collision_particle_with_policy?(
    entityId: number,
    entityGeneration: number,
    presetId: number,
    target: number,
    cooldownSeconds: number,
    replaceDefault: boolean,
  ): boolean;
  add_gameplay_collision_particle_with_trigger?(
    entityId: number,
    entityGeneration: number,
    presetId: number,
    target: number,
    cooldownSeconds: number,
    replaceDefault: boolean,
    trigger: number,
  ): boolean;
  add_gameplay_collision_despawn?(entityId: number, entityGeneration: number, target: number): boolean;
}

export interface SceneBehaviorBindingOptions extends InstantiateSceneFragmentOptions, BehaviorRecipeCommandOptions {
  behaviorProp?: string;
  missingBehavior?: MissingSceneBehaviorBinding;
}

export interface BoundBehaviorRecipeCommand {
  instance: ResolvedSceneCompositionInstance;
  behaviorEntity: string;
  sourceCommand: BehaviorRecipeCommand;
  command: BehaviorRecipeCommand;
}

export interface SceneBehaviorBindingPlan {
  fragment: string;
  instances: readonly ResolvedSceneCompositionInstance[];
  bindings: readonly BoundBehaviorRecipeCommand[];
  commands: readonly BehaviorRecipeCommand[];
}

export interface SceneBehaviorRuntimeTarget {
  spawnSceneInstance(instance: ResolvedSceneCompositionInstance): GameplayEntityHandle;
}

export interface ApplyGameplayBehaviorCommandsOptions {
  path?: string;
  ids?: GameplayBehaviorRuntimeIds;
}

export interface ApplySceneBehaviorRecipesOptions extends SceneBehaviorBindingOptions {
  ids?: GameplayBehaviorRuntimeIds;
}

export interface SceneBehaviorApplyResult {
  plan: SceneBehaviorBindingPlan;
  entityHandles: Readonly<Record<string, GameplayEntityHandle>>;
  spawnResults: readonly GameplayEntityHandle[];
  behaviorApplyResult: BehaviorRecipeApplyResult;
}

export type SceneBehaviorBindingDryRunResult =
  | {
      ok: true;
      diagnostics: readonly DiagnosticReport[];
      plan: SceneBehaviorBindingPlan;
    }
  | {
      ok: false;
      diagnostics: readonly DiagnosticReport[];
      plan?: undefined;
    };

export function bindSceneBehaviorRecipes(
  composition: SceneCompositionSpec | ResolvedSceneCompositionSpec,
  recipes: BehaviorRecipeDocumentSpec | ResolvedBehaviorRecipeDocument,
  options: SceneBehaviorBindingOptions = {},
): SceneBehaviorBindingPlan {
  const path = options.path ?? "gameplayAuthoring";
  const behaviorProp = requiredBehaviorProp(options.behaviorProp ?? GAMEPLAY_BEHAVIOR_BINDING_PROP, `${path}.behaviorProp`);
  const missingBehavior = missingBehaviorMode(options.missingBehavior ?? "ignore", `${path}.missingBehavior`);
  const resolvedComposition = isResolvedSceneCompositionSpec(composition)
    ? composition
    : resolveSceneCompositionSpec(composition, { path: `${path}.composition` });
  const resolvedRecipes = isResolvedBehaviorRecipeDocument(recipes)
    ? recipes
    : resolveBehaviorRecipeDocument(recipes, { path: `${path}.behaviorRecipes` });
  const fragment = options.fragment ?? resolvedComposition.initialFragment;
  const instances = instantiateSceneFragment(resolvedComposition, { ...options, fragment, path: `${path}.composition` });
  const bindings: BoundBehaviorRecipeCommand[] = [];

  instances.forEach((instance, instanceIndex) => {
    const bindingPath = `${path}.instances.${instanceIndex}.props.${behaviorProp}`;
    const binding = behaviorBindingsForInstance(instance, behaviorProp, bindingPath, missingBehavior);
    for (const behaviorEntity of binding) {
      if (resolvedRecipes.entities[behaviorEntity] === undefined) {
        throw gameplayAuthoringDiagnosticError(bindingPath, `references unknown behavior profile '${behaviorEntity}'`);
      }
      for (const sourceCommand of behaviorRecipeCommandsForEntity(resolvedRecipes, behaviorEntity, {
        kinds: options.kinds,
        includeEntityTags: true,
      })) {
        const command: BehaviorRecipeCommand = {
          ...sourceCommand,
          entity: instance.id,
        };
        bindings.push({
          instance,
          behaviorEntity,
          sourceCommand,
          command,
        });
      }
    }
  });

  return {
    fragment,
    instances,
    bindings,
    commands: bindings.map((binding) => binding.command),
  };
}

export function dryRunSceneBehaviorRecipes(
  composition: SceneCompositionSpec | ResolvedSceneCompositionSpec,
  recipes: BehaviorRecipeDocumentSpec | ResolvedBehaviorRecipeDocument,
  options: SceneBehaviorBindingOptions = {},
): SceneBehaviorBindingDryRunResult {
  try {
    return {
      ok: true,
      diagnostics: [],
      plan: bindSceneBehaviorRecipes(composition, recipes, options),
    };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [diagnosticReport(error)],
    };
  }
}

export function applySceneBehaviorRecipes(
  engine: GameplayBehaviorRuntimeEngine,
  target: SceneBehaviorRuntimeTarget,
  composition: SceneCompositionSpec | ResolvedSceneCompositionSpec,
  recipes: BehaviorRecipeDocumentSpec | ResolvedBehaviorRecipeDocument,
  options: ApplySceneBehaviorRecipesOptions = {},
): SceneBehaviorApplyResult {
  const path = options.path ?? "gameplayAuthoring";
  if (target === null || typeof target !== "object" || typeof target.spawnSceneInstance !== "function") {
    throw gameplayAuthoringDiagnosticError(
      `${path}.target`,
      "must expose spawnSceneInstance(instance) returning an entity handle",
    );
  }

  const plan = bindSceneBehaviorRecipes(composition, recipes, options);
  const entityHandles: Record<string, GameplayEntityHandle> = {};
  const spawnResults = plan.instances.map((instance, index) => {
    const handle = gameplayEntityHandle(
      target.spawnSceneInstance(instance),
      `${path}.instances.${index}.handle`,
    );
    entityHandles[instance.id] = handle;
    return handle;
  });
  const behaviorApplyResult = applyGameplayBehaviorCommands(engine, plan.commands, entityHandles, {
    path,
    ids: options.ids,
  });

  return {
    plan,
    entityHandles,
    spawnResults,
    behaviorApplyResult,
  };
}

export function createGameplayBehaviorRuntimeTarget(
  engine: GameplayBehaviorRuntimeEngine,
  entityHandles: GameplayEntityHandleMap,
  options: ApplyGameplayBehaviorCommandsOptions = {},
): BehaviorRecipeRuntimeTarget {
  return {
    applyBehaviorRecipeCommand: (command) =>
      applyGameplayBehaviorCommand(
        engine,
        command,
        entityHandles,
        `${options.path ?? "gameplayAuthoring"}.command`,
        options.ids,
      ),
  };
}

export function applyGameplayBehaviorCommands(
  engine: GameplayBehaviorRuntimeEngine,
  commands: readonly BehaviorRecipeCommand[],
  entityHandles: GameplayEntityHandleMap,
  options: ApplyGameplayBehaviorCommandsOptions = {},
): BehaviorRecipeApplyResult {
  const path = options.path ?? "gameplayAuthoring";
  const results = commands.map((command, index) =>
    applyGameplayBehaviorCommand(engine, command, entityHandles, `${path}.commands.${index}`, options.ids),
  );
  return {
    commands,
    results,
  };
}

export function registerGameplayPrefabs(
  engine: GameplayBehaviorRuntimeEngine,
  registrations: readonly GameplayPrefabRegistration[],
  options: RegisterGameplayPrefabsOptions = {},
): RegisterGameplayPrefabsResult {
  const path = options.path ?? "gameplayPrefabRegistry";
  const results = registrations.map((registration, index) =>
    registerGameplayPrefab(engine, registration, `${path}.registrations.${index}`, options.ids),
  );
  return {
    registrations,
    results,
  };
}

export function resolveGameplayBehaviorRuntimeIds(
  value: unknown,
  options: ResolveGameplayBehaviorRuntimeIdsOptions = {},
): GameplayBehaviorRuntimeIds {
  const path = options.path ?? "gameplayRuntimeIds";
  if (!isRecord(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  }
  const items = runtimeIdNamespace(value.items, `${path}.items`);
  const actions = runtimeIdNamespace(value.actions, `${path}.actions`);
  const prefabs = runtimeIdNamespace(value.prefabs, `${path}.prefabs`);
  const timers = runtimeIdNamespace(value.timers, `${path}.timers`);
  const tags = runtimeTagIdNamespace(value.tags, `${path}.tags`);
  const effects = runtimeIdNamespace(value.effects, `${path}.effects`);
  requireRuntimeIdNames(items, options.requiredItems ?? [], `${path}.items`);
  requireRuntimeIdNames(actions, options.requiredActions ?? [], `${path}.actions`);
  requireRuntimeIdNames(prefabs, options.requiredPrefabs ?? [], `${path}.prefabs`);
  requireRuntimeIdNames(timers, options.requiredTimers ?? [], `${path}.timers`);
  requireRuntimeIdNames(tags, options.requiredTags ?? [], `${path}.tags`);
  requireRuntimeIdNames(effects, options.requiredEffects ?? [], `${path}.effects`);
  return {
    ...(Object.keys(items).length === 0 ? {} : { items }),
    ...(Object.keys(actions).length === 0 ? {} : { actions }),
    ...(Object.keys(prefabs).length === 0 ? {} : { prefabs }),
    ...(Object.keys(timers).length === 0 ? {} : { timers }),
    ...(Object.keys(tags).length === 0 ? {} : { tags }),
    ...(Object.keys(effects).length === 0 ? {} : { effects }),
  };
}

function registerGameplayPrefab(
  engine: GameplayBehaviorRuntimeEngine,
  registration: GameplayPrefabRegistration,
  path: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
): boolean {
  const kind = gameplayPrefabRegistrationKind(registration.kind, `${path}.kind`);
  const prefabId = gameplayPrefabRegistrationId(registration, ids, path);
  if (kind === "enemy") {
    const registerEnemyPrefab = requireRuntimeMethod(
      engine.register_gameplay_enemy_prefab,
      `${path}.kind`,
      "runtime engine must provide register_gameplay_enemy_prefab for enemy prefab registrations",
    );
    const applied = registerEnemyPrefab.call(engine, prefabId);
    if (!applied) {
      const label = registration.prefab === undefined ? prefabId.toString() : registration.prefab;
      throw gameplayAuthoringDiagnosticError(path, `failed to register enemy prefab '${label}'`);
    }
    return true;
  }
  if (kind === "bullet") {
    const registerBulletPrefab = requireRuntimeMethod(
      engine.register_gameplay_bullet_prefab,
      `${path}.kind`,
      "runtime engine must provide register_gameplay_bullet_prefab for bullet prefab registrations",
    );
    const applied = registerBulletPrefab.call(engine, prefabId);
    if (!applied) {
      const label = registration.prefab === undefined ? prefabId.toString() : registration.prefab;
      throw gameplayAuthoringDiagnosticError(path, `failed to register bullet prefab '${label}'`);
    }
    return true;
  }
  throw gameplayAuthoringDiagnosticError(`${path}.kind`, "must be enemy or bullet for the default gameplay prefab registry");
}

function applyGameplayBehaviorCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: BehaviorRecipeCommand,
  entityHandles: GameplayEntityHandleMap,
  path: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
): boolean {
  const handle = gameplayEntityHandleForCommand(command.entity, entityHandles, `${path}.entity`);
  switch (command.type) {
    case "configureTags":
      return applyConfigureTagsCommand(engine, command, handle, path, ids);
    case "configureHealth":
      return applyConfigureHealthCommand(engine, command, handle, path);
    case "configureDamage":
      return applyConfigureDamageCommand(engine, command, handle, path);
    case "configureFaction":
      return applyConfigureFactionCommand(engine, command, handle, path);
    case "configureLifetime":
      return applyConfigureLifetimeCommand(engine, command, handle, path);
    case "configureScoreReward":
      return applyConfigureScoreRewardCommand(engine, command, handle, path);
    case "configureChase":
      return applyConfigureChaseCommand(engine, command, handle, entityHandles, path, ids);
    case "configureSeekTarget":
      return applyConfigureSeekTargetCommand(engine, command, handle, entityHandles, path, ids);
    case "configureAccelerate":
      return applyConfigureAccelerateCommand(engine, command, handle, path);
    case "configurePickup":
      return applyConfigurePickupCommand(engine, command, handle, path, ids);
    case "configureCollisionPickup":
      return applyConfigureCollisionPickupCommand(engine, command, handle, path);
    case "configureCollisionAreaDamage":
      return applyConfigureCollisionAreaDamageCommand(engine, command, handle, path);
    case "configureCollisionKnockback":
      return applyConfigureCollisionKnockbackCommand(engine, command, handle, path);
    case "configureCollisionEmitEffect":
      return applyConfigureCollisionEmitEffectCommand(engine, command, handle, path, ids);
    case "configureCollisionSpawnPrefab":
      return applyConfigureCollisionSpawnPrefabCommand(engine, command, handle, path, ids);
    case "configureCollisionSound":
      return applyConfigureCollisionSoundCommand(engine, command, handle, path);
    case "configureCollisionShake":
      return applyConfigureCollisionShakeCommand(engine, command, handle, path);
    case "configureCollisionParticle":
      return applyConfigureCollisionParticleCommand(engine, command, handle, path);
    case "configureCollisionDespawn":
      return applyConfigureCollisionDespawnCommand(engine, command, handle, path);
    case "configureInteraction":
      return applyConfigureInteractionCommand(engine, command, handle, path, ids);
    case "configureProjectileAction":
      return applyConfigureProjectileActionCommand(engine, command, handle, path, ids);
    case "configureDashAction":
      return applyConfigureDashActionCommand(engine, command, handle, path, ids);
    case "configureMeleeAction":
      return applyConfigureMeleeActionCommand(engine, command, handle, path, ids);
    case "configureSpawnPrefabAction":
      return applyConfigureSpawnPrefabActionCommand(engine, command, handle, path, ids);
    case "configureTimerTrigger":
      return applyConfigureTimerTriggerCommand(engine, command, handle, path, ids);
  }
}

function applyConfigureTagsCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureTags" }>,
  handle: GameplayEntityHandle,
  path: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
): boolean {
  const setGameplayTags = requireRuntimeMethod(
    engine.set_gameplay_tags,
    `${path}.type`,
    "runtime engine must provide set_gameplay_tags for configureTags commands",
  );
  return requireApplied(
    setGameplayTags.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      gameplayTagMask(command.tags, ids, `${path}.tags`),
    ),
    path,
    command,
  );
}

function applyConfigureHealthCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureHealth" }>,
  handle: GameplayEntityHandle,
  path: string,
): boolean {
  assertSupportedHealthCommand(command, path);
  return requireApplied(
    engine.set_gameplay_health(handle.entityId, handle.entityGeneration, command.current),
    path,
    command,
  );
}

function applyConfigureDamageCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureDamage" }>,
  handle: GameplayEntityHandle,
  path: string,
): boolean {
  assertSupportedDamageCommand(command, path);
  const setGameplayDamageReaction = requireRuntimeMethod(
    engine.set_gameplay_damage_reaction,
    `${path}.type`,
    "runtime engine must provide set_gameplay_damage_reaction for configureDamage commands",
  );
  return requireApplied(
    setGameplayDamageReaction.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      command.amount,
      collisionTargetCode(command.target),
    ),
    path,
    command,
  );
}

function applyConfigureFactionCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureFaction" }>,
  handle: GameplayEntityHandle,
  path: string,
): boolean {
  assertSupportedFactionCommand(command, path);
  const setGameplayFaction = requireRuntimeMethod(
    engine.set_gameplay_faction,
    `${path}.type`,
    "runtime engine must provide set_gameplay_faction for configureFaction commands",
  );
  return requireApplied(
    setGameplayFaction.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      gameplayFactionCode(command.faction, `${path}.faction`),
      gameplayFactionMask(command.damages, `${path}.damages`),
    ),
    path,
    command,
  );
}

function applyConfigureLifetimeCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureLifetime" }>,
  handle: GameplayEntityHandle,
  path: string,
): boolean {
  assertSupportedLifetimeCommand(command, path);
  return requireApplied(
    engine.set_gameplay_lifetime(handle.entityId, handle.entityGeneration, command.seconds),
    path,
    command,
  );
}

function applyConfigureScoreRewardCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureScoreReward" }>,
  handle: GameplayEntityHandle,
  path: string,
): boolean {
  assertSupportedScoreRewardCommand(command, path);
  return requireApplied(
    engine.set_gameplay_score_reward(handle.entityId, handle.entityGeneration, command.reward),
    path,
    command,
  );
}

function applyConfigureAccelerateCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureAccelerate" }>,
  handle: GameplayEntityHandle,
  path: string,
): boolean {
  assertSupportedAccelerateCommand(command, path);
  const setGamePlayMovementAccelerate = requireRuntimeMethod(
    engine.set_gameplay_movement_accelerate,
    `${path}.type`,
    "runtime engine must provide set_gameplay_movement_accelerate for configureAccelerate commands",
  );
  return requireApplied(
    setGamePlayMovementAccelerate.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      command.accelerationX,
      command.accelerationY,
      command.maxSpeed,
    ),
    path,
    command,
  );
}

function applyConfigurePickupCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configurePickup" }>,
  handle: GameplayEntityHandle,
  path: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
): boolean {
  assertSupportedPickupCommand(command, path);
  const itemId = pickupItemId(command, ids, path);
  return requireApplied(
    engine.set_gameplay_pickup(
      handle.entityId,
      handle.entityGeneration,
      itemId,
      command.count,
      command.despawn,
    ),
    path,
    command,
  );
}

function applyConfigureInteractionCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureInteraction" }>,
  handle: GameplayEntityHandle,
  path: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
): boolean {
  assertSupportedInteractionCommand(command, path);
  const actionId = interactionActionId(command, ids, path);
  return requireApplied(
    engine.set_gameplay_interaction(
      handle.entityId,
      handle.entityGeneration,
      actionId,
      command.radius,
      command.once,
    ),
    path,
    command,
  );
}

function applyConfigureChaseCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureChase" }>,
  handle: GameplayEntityHandle,
  entityHandles: GameplayEntityHandleMap,
  path: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
): boolean {
  assertSupportedChaseCommand(command, path);
  if (command.target === "player") {
    return requireApplied(
      engine.set_gameplay_movement_chase_player(handle.entityId, handle.entityGeneration, command.speed),
      path,
      command,
    );
  }
  if (command.target === "nearestPlayer") {
    const setGameplayChaseNearestPlayer = requireRuntimeMethod(
      engine.set_gameplay_movement_chase_nearest_player,
      `${path}.type`,
      "runtime engine must provide set_gameplay_movement_chase_nearest_player for nearestPlayer configureChase commands",
    );
    return requireApplied(
      setGameplayChaseNearestPlayer.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        command.speed,
      ),
      path,
      command,
    );
  }
  if (command.target === "nearestEnemy") {
    const setGameplayChaseNearestEnemy = requireRuntimeMethod(
      engine.set_gameplay_movement_chase_nearest_enemy,
      `${path}.type`,
      "runtime engine must provide set_gameplay_movement_chase_nearest_enemy for nearestEnemy configureChase commands",
    );
    return requireApplied(
      setGameplayChaseNearestEnemy.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        command.speed,
      ),
      path,
      command,
    );
  }
  const nearestLayer = movementNearestLayerTarget(command.target, `${path}.target`);
  if (nearestLayer !== undefined) {
    const setGameplayChaseNearestLayer = requireRuntimeMethod(
      engine.set_gameplay_movement_chase_nearest_layer,
      `${path}.type`,
      "runtime engine must provide set_gameplay_movement_chase_nearest_layer for nearestLayer configureChase commands",
    );
    return requireApplied(
      setGameplayChaseNearestLayer.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        gameplayMovementQueryLayerCode(nearestLayer),
        command.speed,
      ),
      path,
      command,
    );
  }
  const nearestFaction = movementNearestFactionTarget(command.target, `${path}.target`);
  if (nearestFaction !== undefined) {
    const setGameplayChaseNearestFaction = requireRuntimeMethod(
      engine.set_gameplay_movement_chase_nearest_faction,
      `${path}.type`,
      "runtime engine must provide set_gameplay_movement_chase_nearest_faction for nearestFaction configureChase commands",
    );
    return requireApplied(
      setGameplayChaseNearestFaction.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        gameplayMovementQueryFactionCode(nearestFaction),
        command.speed,
      ),
      path,
      command,
    );
  }
  const nearestTag = movementNearestTagTarget(command.target, ids, `${path}.target`);
  if (nearestTag !== undefined) {
    const setGameplayChaseNearestTag = requireRuntimeMethod(
      engine.set_gameplay_movement_chase_nearest_tag,
      `${path}.type`,
      "runtime engine must provide set_gameplay_movement_chase_nearest_tag for nearestTag configureChase commands",
    );
    return requireApplied(
      setGameplayChaseNearestTag.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        nearestTag,
        command.speed,
      ),
      path,
      command,
    );
  }
  const target = gameplayEntityHandleForCommand(command.target, entityHandles, `${path}.target`);
  return requireApplied(
    engine.set_gameplay_movement_chase_entity(
      handle.entityId,
      handle.entityGeneration,
      target.entityId,
      target.entityGeneration,
      command.speed,
    ),
    path,
    command,
  );
}

function applyConfigureSeekTargetCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureSeekTarget" }>,
  handle: GameplayEntityHandle,
  entityHandles: GameplayEntityHandleMap,
  path: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
): boolean {
  assertSupportedSeekTargetCommand(command, path);
  if (command.target === "player") {
    const setGamePlaySeekTargetPlayer = requireRuntimeMethod(
      engine.set_gameplay_movement_seek_target_player,
      `${path}.type`,
      "runtime engine must provide set_gameplay_movement_seek_target_player for configureSeekTarget commands",
    );
    return requireApplied(
      setGamePlaySeekTargetPlayer.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        command.speed,
        command.turnRate,
      ),
      path,
      command,
    );
  }
  if (command.target === "nearestPlayer") {
    const setGameplaySeekTargetNearestPlayer = requireRuntimeMethod(
      engine.set_gameplay_movement_seek_target_nearest_player,
      `${path}.type`,
      "runtime engine must provide set_gameplay_movement_seek_target_nearest_player for nearestPlayer configureSeekTarget commands",
    );
    return requireApplied(
      setGameplaySeekTargetNearestPlayer.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        command.speed,
        command.turnRate,
      ),
      path,
      command,
    );
  }
  if (command.target === "nearestEnemy") {
    const setGameplaySeekTargetNearestEnemy = requireRuntimeMethod(
      engine.set_gameplay_movement_seek_target_nearest_enemy,
      `${path}.type`,
      "runtime engine must provide set_gameplay_movement_seek_target_nearest_enemy for nearestEnemy configureSeekTarget commands",
    );
    return requireApplied(
      setGameplaySeekTargetNearestEnemy.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        command.speed,
        command.turnRate,
      ),
      path,
      command,
    );
  }
  const nearestLayer = movementNearestLayerTarget(command.target, `${path}.target`);
  if (nearestLayer !== undefined) {
    const setGameplaySeekTargetNearestLayer = requireRuntimeMethod(
      engine.set_gameplay_movement_seek_target_nearest_layer,
      `${path}.type`,
      "runtime engine must provide set_gameplay_movement_seek_target_nearest_layer for nearestLayer configureSeekTarget commands",
    );
    return requireApplied(
      setGameplaySeekTargetNearestLayer.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        gameplayMovementQueryLayerCode(nearestLayer),
        command.speed,
        command.turnRate,
      ),
      path,
      command,
    );
  }
  const nearestFaction = movementNearestFactionTarget(command.target, `${path}.target`);
  if (nearestFaction !== undefined) {
    const setGameplaySeekTargetNearestFaction = requireRuntimeMethod(
      engine.set_gameplay_movement_seek_target_nearest_faction,
      `${path}.type`,
      "runtime engine must provide set_gameplay_movement_seek_target_nearest_faction for nearestFaction configureSeekTarget commands",
    );
    return requireApplied(
      setGameplaySeekTargetNearestFaction.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        gameplayMovementQueryFactionCode(nearestFaction),
        command.speed,
        command.turnRate,
      ),
      path,
      command,
    );
  }
  const nearestTag = movementNearestTagTarget(command.target, ids, `${path}.target`);
  if (nearestTag !== undefined) {
    const setGameplaySeekTargetNearestTag = requireRuntimeMethod(
      engine.set_gameplay_movement_seek_target_nearest_tag,
      `${path}.type`,
      "runtime engine must provide set_gameplay_movement_seek_target_nearest_tag for nearestTag configureSeekTarget commands",
    );
    return requireApplied(
      setGameplaySeekTargetNearestTag.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        nearestTag,
        command.speed,
        command.turnRate,
      ),
      path,
      command,
    );
  }
  const target = gameplayEntityHandleForCommand(command.target, entityHandles, `${path}.target`);
  const setGamePlaySeekTargetEntity = requireRuntimeMethod(
    engine.set_gameplay_movement_seek_target_entity,
    `${path}.type`,
    "runtime engine must provide set_gameplay_movement_seek_target_entity for configureSeekTarget commands",
  );
  return requireApplied(
    setGamePlaySeekTargetEntity.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      target.entityId,
      target.entityGeneration,
      command.speed,
      command.turnRate,
    ),
    path,
    command,
  );
}

function applyConfigureCollisionPickupCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionPickup" }>,
  handle: GameplayEntityHandle,
  path: string,
): boolean {
  assertSupportedCollisionPickupCommand(command, path);
  const addCollisionPickup = requireRuntimeMethod(
    engine.add_gameplay_collision_pickup,
    `${path}.type`,
    "runtime engine must provide add_gameplay_collision_pickup for configureCollisionPickup commands",
  );
  return requireApplied(
    addCollisionPickup.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      collisionTargetCode(command.target),
    ),
    path,
    command,
  );
}

function applyConfigureCollisionAreaDamageCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionAreaDamage" }>,
  handle: GameplayEntityHandle,
  path: string,
): boolean {
  assertSupportedCollisionAreaDamageCommand(command, path);
  const setGameplayAreaDamageReaction = requireRuntimeMethod(
    engine.set_gameplay_area_damage_reaction,
    `${path}.type`,
    "runtime engine must provide set_gameplay_area_damage_reaction for configureCollisionAreaDamage commands",
  );
  return requireApplied(
    setGameplayAreaDamageReaction.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      command.amount,
      command.radius,
      gameplayCollisionLayerCode(command.targetLayer, `${path}.targetLayer`),
    ),
    path,
    command,
  );
}

function applyConfigureCollisionKnockbackCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionKnockback" }>,
  handle: GameplayEntityHandle,
  path: string,
): boolean {
  assertSupportedCollisionKnockbackCommand(command, path);
  const addCollisionKnockback = requireRuntimeMethod(
    engine.add_gameplay_collision_knockback,
    `${path}.type`,
    "runtime engine must provide add_gameplay_collision_knockback for configureCollisionKnockback commands",
  );
  return requireApplied(
    addCollisionKnockback.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      collisionTargetCode(command.target),
      command.impulse,
    ),
    path,
    command,
  );
}

function applyConfigureCollisionEmitEffectCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionEmitEffect" }>,
  handle: GameplayEntityHandle,
  path: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
): boolean {
  assertSupportedCollisionEmitEffectCommand(command, path);
  const effectId = collisionEmitEffectId(command, ids, path);
  const hasPayload = command.intensity !== undefined || command.radius !== undefined;
  const intensity = command.intensity ?? 1;
  const radius = command.radius ?? 0;
  const addCollisionEmitEffectWithPayload = engine.add_gameplay_collision_emit_effect_with_payload;
  if (addCollisionEmitEffectWithPayload !== undefined) {
    return requireApplied(
      addCollisionEmitEffectWithPayload.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        effectId,
        command.effectType,
        collisionTargetCode(command.target),
        command.cooldownSeconds ?? 0,
        collisionTriggerCode(command.trigger ?? "contact"),
        intensity,
        radius,
      ),
      path,
      command,
    );
  }
  if (hasPayload) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.type`,
      "runtime engine must provide add_gameplay_collision_emit_effect_with_payload for configureCollisionEmitEffect intensity/radius commands",
    );
  }
  const addCollisionEmitEffect = requireRuntimeMethod(
    engine.add_gameplay_collision_emit_effect,
    `${path}.type`,
    "runtime engine must provide add_gameplay_collision_emit_effect for configureCollisionEmitEffect commands",
  );
  return requireApplied(
    addCollisionEmitEffect.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      effectId,
      command.effectType,
      collisionTargetCode(command.target),
      command.cooldownSeconds ?? 0,
      collisionTriggerCode(command.trigger ?? "contact"),
    ),
    path,
    command,
  );
}

function applyConfigureCollisionSpawnPrefabCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionSpawnPrefab" }>,
  handle: GameplayEntityHandle,
  path: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
): boolean {
  assertSupportedCollisionSpawnPrefabCommand(command, path);
  const addCollisionSpawnPrefab = requireRuntimeMethod(
    engine.add_gameplay_collision_spawn_prefab,
    `${path}.type`,
    "runtime engine must provide add_gameplay_collision_spawn_prefab for configureCollisionSpawnPrefab commands",
  );
  const actionId = collisionSpawnPrefabActionId(command, ids, path);
  const prefabId = collisionSpawnPrefabId(command, ids, path);
  return requireApplied(
    addCollisionSpawnPrefab.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      actionId,
      prefabId,
      collisionTargetCode(command.target),
      command.cooldownSeconds ?? 0,
      collisionTriggerCode(command.trigger ?? "contact"),
      command.offsetX,
      command.offsetY,
    ),
    path,
    command,
  );
}

function applyConfigureCollisionSoundCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionSound" }>,
  handle: GameplayEntityHandle,
  path: string,
): boolean {
  assertSupportedCollisionSoundCommand(command, path);
  const cooldownSeconds = command.cooldownSeconds ?? 0;
  const replaceDefault = command.replaceDefault ?? false;
  const trigger = command.trigger ?? "contact";
  if (trigger === "enter") {
    const addCollisionSoundWithTrigger = requireRuntimeMethod(
      engine.add_gameplay_collision_sound_with_trigger,
      `${path}.type`,
      "runtime engine must provide add_gameplay_collision_sound_with_trigger for configureCollisionSound enter trigger commands",
    );
    return requireApplied(
      addCollisionSoundWithTrigger.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        command.soundId,
        command.volume,
        command.pitch,
        cooldownSeconds,
        replaceDefault,
        collisionTriggerCode(trigger),
      ),
      path,
      command,
    );
  }
  if (replaceDefault) {
    const addCollisionSoundWithPolicy = requireRuntimeMethod(
      engine.add_gameplay_collision_sound_with_policy,
      `${path}.type`,
      "runtime engine must provide add_gameplay_collision_sound_with_policy for configureCollisionSound replaceDefault commands",
    );
    return requireApplied(
      addCollisionSoundWithPolicy.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        command.soundId,
        command.volume,
        command.pitch,
        cooldownSeconds,
        replaceDefault,
      ),
      path,
      command,
    );
  }
  if (cooldownSeconds > 0) {
    const addCollisionSoundWithCooldown = requireRuntimeMethod(
      engine.add_gameplay_collision_sound_with_cooldown,
      `${path}.type`,
      "runtime engine must provide add_gameplay_collision_sound_with_cooldown for configureCollisionSound cooldown commands",
    );
    return requireApplied(
      addCollisionSoundWithCooldown.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        command.soundId,
        command.volume,
        command.pitch,
        cooldownSeconds,
      ),
      path,
      command,
    );
  }
  const addCollisionSound = requireRuntimeMethod(
    engine.add_gameplay_collision_sound,
    `${path}.type`,
    "runtime engine must provide add_gameplay_collision_sound for configureCollisionSound commands",
  );
  return requireApplied(
    addCollisionSound.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      command.soundId,
      command.volume,
      command.pitch,
    ),
    path,
    command,
  );
}

function applyConfigureCollisionShakeCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionShake" }>,
  handle: GameplayEntityHandle,
  path: string,
): boolean {
  assertSupportedCollisionShakeCommand(command, path);
  const cooldownSeconds = command.cooldownSeconds ?? 0;
  const trigger = command.trigger ?? "contact";
  if (trigger === "enter") {
    const addCollisionShakeWithTrigger = requireRuntimeMethod(
      engine.add_gameplay_collision_camera_shake_with_trigger,
      `${path}.type`,
      "runtime engine must provide add_gameplay_collision_camera_shake_with_trigger for configureCollisionShake enter trigger commands",
    );
    return requireApplied(
      addCollisionShakeWithTrigger.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        cooldownSeconds,
        collisionTriggerCode(trigger),
      ),
      path,
      command,
    );
  }
  if (cooldownSeconds > 0) {
    const addCollisionShakeWithCooldown = requireRuntimeMethod(
      engine.add_gameplay_collision_camera_shake_with_cooldown,
      `${path}.type`,
      "runtime engine must provide add_gameplay_collision_camera_shake_with_cooldown for configureCollisionShake cooldown commands",
    );
    return requireApplied(
      addCollisionShakeWithCooldown.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        cooldownSeconds,
      ),
      path,
      command,
    );
  }
  const addCollisionShake = requireRuntimeMethod(
    engine.add_gameplay_collision_camera_shake,
    `${path}.type`,
    "runtime engine must provide add_gameplay_collision_camera_shake for configureCollisionShake commands",
  );
  return requireApplied(
    addCollisionShake.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
    ),
    path,
    command,
  );
}

function applyConfigureCollisionParticleCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionParticle" }>,
  handle: GameplayEntityHandle,
  path: string,
): boolean {
  assertSupportedCollisionParticleCommand(command, path);
  const cooldownSeconds = command.cooldownSeconds ?? 0;
  const replaceDefault = command.replaceDefault ?? false;
  const trigger = command.trigger ?? "contact";
  if (trigger === "enter") {
    const addCollisionParticleWithTrigger = requireRuntimeMethod(
      engine.add_gameplay_collision_particle_with_trigger,
      `${path}.type`,
      "runtime engine must provide add_gameplay_collision_particle_with_trigger for configureCollisionParticle enter trigger commands",
    );
    return requireApplied(
      addCollisionParticleWithTrigger.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        command.presetId,
        collisionTargetCode(command.target),
        cooldownSeconds,
        replaceDefault,
        collisionTriggerCode(trigger),
      ),
      path,
      command,
    );
  }
  if (replaceDefault) {
    const addCollisionParticleWithPolicy = requireRuntimeMethod(
      engine.add_gameplay_collision_particle_with_policy,
      `${path}.type`,
      "runtime engine must provide add_gameplay_collision_particle_with_policy for configureCollisionParticle replaceDefault commands",
    );
    return requireApplied(
      addCollisionParticleWithPolicy.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        command.presetId,
        collisionTargetCode(command.target),
        cooldownSeconds,
        replaceDefault,
      ),
      path,
      command,
    );
  }
  if (cooldownSeconds > 0) {
    const addCollisionParticleWithCooldown = requireRuntimeMethod(
      engine.add_gameplay_collision_particle_with_cooldown,
      `${path}.type`,
      "runtime engine must provide add_gameplay_collision_particle_with_cooldown for configureCollisionParticle cooldown commands",
    );
    return requireApplied(
      addCollisionParticleWithCooldown.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        command.presetId,
        collisionTargetCode(command.target),
        cooldownSeconds,
      ),
      path,
      command,
    );
  }
  const addCollisionParticle = requireRuntimeMethod(
    engine.add_gameplay_collision_particle,
    `${path}.type`,
    "runtime engine must provide add_gameplay_collision_particle for configureCollisionParticle commands",
  );
  return requireApplied(
    addCollisionParticle.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      command.presetId,
      collisionTargetCode(command.target),
    ),
    path,
    command,
  );
}

function applyConfigureCollisionDespawnCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionDespawn" }>,
  handle: GameplayEntityHandle,
  path: string,
): boolean {
  assertSupportedCollisionDespawnCommand(command, path);
  const addCollisionDespawn = requireRuntimeMethod(
    engine.add_gameplay_collision_despawn,
    `${path}.type`,
    "runtime engine must provide add_gameplay_collision_despawn for configureCollisionDespawn commands",
  );
  return requireApplied(
    addCollisionDespawn.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      collisionTargetCode(command.target),
    ),
    path,
    command,
  );
}

function applyConfigureProjectileActionCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureProjectileAction" }>,
  handle: GameplayEntityHandle,
  path: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
): boolean {
  assertSupportedProjectileActionCommand(command, path);
  const actionId = projectileActionId(command, ids, path);
  const aimCode = dashActionAimCode(command.aim, `${path}.aim`);
  const collisionTarget = projectileCollisionTargetCode(command.collisionTarget, `${path}.collisionTarget`);
  const tileImpactCode = projectileTileImpactCode(command.tileImpact, `${path}.tileImpact`);
  if (aimCode !== 0 || collisionTarget !== 0 || tileImpactCode !== 0) {
    const setProjectileActionWithTarget = requireRuntimeMethod(
      engine.set_gameplay_action_projectile_with_target,
      `${path}.type`,
      "runtime engine must provide set_gameplay_action_projectile_with_target for targeted or non-default tileImpact configureProjectileAction commands",
    );
    return requireApplied(
      setProjectileActionWithTarget.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        actionId,
        command.cooldownSeconds,
        command.speed,
        command.damage,
        command.lifetimeSeconds,
        aimCode,
        collisionTarget,
        tileImpactCode,
      ),
      path,
      command,
    );
  }
  const setProjectileAction = requireRuntimeMethod(
    engine.set_gameplay_action_projectile,
    `${path}.type`,
    "runtime engine must provide set_gameplay_action_projectile for configureProjectileAction commands",
  );
  return requireApplied(
    setProjectileAction.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      actionId,
      command.cooldownSeconds,
      command.speed,
      command.damage,
      command.lifetimeSeconds,
    ),
    path,
    command,
  );
}

function applyConfigureDashActionCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureDashAction" }>,
  handle: GameplayEntityHandle,
  path: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
): boolean {
  assertSupportedDashActionCommand(command, path);
  const actionId = dashActionId(command, ids, path);
  const aimCode = dashActionAimCode(command.aim, `${path}.aim`);
  const setDashActionWithAim = engine.set_gameplay_action_dash_with_aim;
  const setDashAction = engine.set_gameplay_action_dash;
  if (aimCode !== 0) {
    const requiredSetDashActionWithAim = requireRuntimeMethod(
      setDashActionWithAim,
      `${path}.type`,
      "runtime engine must provide set_gameplay_action_dash_with_aim for non-input configureDashAction commands",
    );
    return requireApplied(
      requiredSetDashActionWithAim.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        actionId,
        command.cooldownSeconds,
        command.distance,
        aimCode,
      ),
      path,
      command,
    );
  }
  const requiredSetDashAction = requireRuntimeMethod(
    setDashAction,
    `${path}.type`,
    "runtime engine must provide set_gameplay_action_dash for configureDashAction commands",
  );
  return requireApplied(
    requiredSetDashAction.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      actionId,
      command.cooldownSeconds,
      command.distance,
    ),
    path,
    command,
  );
}

function applyConfigureMeleeActionCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureMeleeAction" }>,
  handle: GameplayEntityHandle,
  path: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
): boolean {
  assertSupportedMeleeActionCommand(command, path);
  const actionId = meleeActionId(command, ids, path);
  const targetCode = meleeTargetCode(command.target, `${path}.target`);
  if (targetCode === 0) {
    const setMeleeAction = requireRuntimeMethod(
      engine.set_gameplay_action_melee,
      `${path}.type`,
      "runtime engine must provide set_gameplay_action_melee for configureMeleeAction commands",
    );
    return requireApplied(
      setMeleeAction.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        actionId,
        command.cooldownSeconds,
        command.range,
        command.damage,
      ),
      path,
      command,
    );
  }
  const setMeleeAction = requireRuntimeMethod(
    engine.set_gameplay_action_melee_with_target,
    `${path}.type`,
    "runtime engine must provide set_gameplay_action_melee_with_target for targeted configureMeleeAction commands",
  );
  return requireApplied(
    setMeleeAction.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      actionId,
      command.cooldownSeconds,
      command.range,
      command.damage,
      targetCode,
    ),
    path,
    command,
  );
}

function applyConfigureSpawnPrefabActionCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureSpawnPrefabAction" }>,
  handle: GameplayEntityHandle,
  path: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
): boolean {
  assertSupportedSpawnPrefabActionCommand(command, path);
  const actionId = spawnPrefabActionId(command, ids, path);
  const prefabId = spawnPrefabId(command, ids, path);
  const projectile = command.projectile;
  if (projectile !== undefined) {
    const setSpawnProjectilePrefabAction = requireRuntimeMethod(
      engine.set_gameplay_action_spawn_projectile_prefab,
      `${path}.type`,
      "runtime engine must provide set_gameplay_action_spawn_projectile_prefab for projectile configureSpawnPrefabAction commands",
    );
    return requireApplied(
      setSpawnProjectilePrefabAction.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        actionId,
        command.cooldownSeconds,
        prefabId,
        spawnPrefabAnchorCode(command.anchor),
        spawnPrefabPhaseCode(command.phase),
        command.offsetX,
        command.offsetY,
        projectile.speed,
        projectile.damage,
        projectile.lifetimeSeconds,
        dashActionAimCode(projectile.aim, `${path}.projectile.aim`),
        projectileCollisionTargetCode(projectile.collisionTarget, `${path}.projectile.collisionTarget`),
        projectileTileImpactCode(projectile.tileImpact, `${path}.projectile.tileImpact`),
      ),
      path,
      command,
    );
  }
  const setSpawnPrefabAction = requireRuntimeMethod(
    engine.set_gameplay_action_spawn_prefab,
    `${path}.type`,
    "runtime engine must provide set_gameplay_action_spawn_prefab for configureSpawnPrefabAction commands",
  );
  return requireApplied(
    setSpawnPrefabAction.call(
      engine,
      handle.entityId,
      handle.entityGeneration,
      actionId,
      command.cooldownSeconds,
      prefabId,
      spawnPrefabAnchorCode(command.anchor),
      spawnPrefabPhaseCode(command.phase),
      command.offsetX,
      command.offsetY,
    ),
    path,
    command,
  );
}

function applyConfigureTimerTriggerCommand(
  engine: GameplayBehaviorRuntimeEngine,
  command: Extract<BehaviorRecipeCommand, { type: "configureTimerTrigger" }>,
  handle: GameplayEntityHandle,
  path: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
): boolean {
  assertSupportedTimerTriggerCommand(command, path);
  const timerId = timerTriggerId(command, ids, path);
  const actionId = timerTriggerActionId(command, ids, path);
  if (actionId !== undefined) {
    const setTimerActionTrigger = requireRuntimeMethod(
      engine.set_gameplay_timer_action_trigger,
      `${path}.type`,
      "runtime engine must provide set_gameplay_timer_action_trigger for timer-triggered action commands",
    );
    return requireApplied(
      setTimerActionTrigger.call(
        engine,
        handle.entityId,
        handle.entityGeneration,
        timerId,
        command.seconds,
        actionId,
      ),
      path,
      command,
    );
  }
  const setTimerTrigger = requireRuntimeMethod(
    engine.set_gameplay_timer_trigger,
    `${path}.type`,
    "runtime engine must provide set_gameplay_timer_trigger for configureTimerTrigger commands",
  );
  return requireApplied(
    setTimerTrigger.call(engine, handle.entityId, handle.entityGeneration, timerId, command.seconds),
    path,
    command,
  );
}

function behaviorBindingsForInstance(
  instance: ResolvedSceneCompositionInstance,
  behaviorProp: string,
  path: string,
  missingBehavior: MissingSceneBehaviorBinding,
): readonly string[] {
  const value = instance.props[behaviorProp];
  if (value === undefined) {
    if (missingBehavior === "ignore") {
      return [];
    }
    throw gameplayAuthoringDiagnosticError(path, `must declare '${behaviorProp}' behavior binding`);
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry !== "string" || entry.length === 0) {
        throw gameplayAuthoringDiagnosticError(`${path}.${index}`, "must be a non-empty behavior profile string");
      }
      return entry;
    });
  }
  throw gameplayAuthoringDiagnosticError(path, "must be a behavior profile string or string array");
}

function gameplayEntityHandleForCommand(
  entity: string,
  entityHandles: GameplayEntityHandleMap,
  path: string,
): GameplayEntityHandle {
  const raw = isHandleMap(entityHandles)
    ? entityHandles.get(entity)
    : entityHandles[entity];
  if (raw === undefined) {
    throw gameplayAuthoringDiagnosticError(path, `references unknown entity handle '${entity}'`);
  }
  return gameplayEntityHandle(raw, path);
}

function gameplayEntityHandle(value: unknown, path: string): GameplayEntityHandle {
  if (!isRecord(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an entity handle object");
  }
  const entityId = nonNegativeInteger(value.entityId, `${path}.entityId`);
  const entityGeneration = nonNegativeInteger(value.entityGeneration, `${path}.entityGeneration`);
  return { entityId, entityGeneration };
}

function assertSupportedHealthCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureHealth" }>,
  path: string,
): void {
  if (command.onZero !== "despawn") {
    throw gameplayAuthoringDiagnosticError(`${path}.onZero`, "must be despawn for gameplay component adapter");
  }
  if (command.event !== undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.event`, "events are not supported by gameplay health component storage");
  }
  if (command.current !== command.max) {
    throw gameplayAuthoringDiagnosticError(`${path}.current`, "must equal max because gameplay storage tracks current health only");
  }
}

function assertSupportedDamageCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureDamage" }>,
  path: string,
): void {
  if (command.cooldownSeconds !== 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.cooldownSeconds`, "must be 0 because damage cooldown storage is not available yet");
  }
}

function assertSupportedFactionCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureFaction" }>,
  path: string,
): void {
  gameplayFactionCode(command.faction, `${path}.faction`);
  gameplayFactionMask(command.damages, `${path}.damages`);
}

function assertSupportedChaseCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureChase" }>,
  path: string,
): void {
  if (command.stopDistance !== 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.stopDistance`, "must be 0 because movement pattern storage does not support stop distance yet");
  }
  if (command.maxDistance !== undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.maxDistance`, "maxDistance is not supported by movement pattern storage yet");
  }
}

function assertSupportedSeekTargetCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureSeekTarget" }>,
  path: string,
): void {
  if (!Number.isFinite(command.speed) || command.speed <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.speed`, "must be a positive finite number for gameplay seek target storage");
  }
  if (!Number.isFinite(command.turnRate) || command.turnRate < 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.turnRate`, "must be a non-negative finite number for gameplay seek target storage");
  }
}

function assertSupportedAccelerateCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureAccelerate" }>,
  path: string,
): void {
  if (!Number.isFinite(command.accelerationX) || !Number.isFinite(command.accelerationY)) {
    throw gameplayAuthoringDiagnosticError(`${path}.accelerationX`, "accelerationX and accelerationY must be finite numbers");
  }
  if (command.accelerationX === 0 && command.accelerationY === 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.accelerationX`, "at least one of accelerationX or accelerationY must be non-zero");
  }
  if (!Number.isFinite(command.maxSpeed) || command.maxSpeed <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.maxSpeed`, "maxSpeed must be a positive finite number for gameplay movement accelerate storage");
  }
}

function assertSupportedLifetimeCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureLifetime" }>,
  path: string,
): void {
  if (command.seconds <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.seconds`, "must be greater than 0 for gameplay lifetime component storage");
  }
}

function assertSupportedScoreRewardCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureScoreReward" }>,
  path: string,
): void {
  if (!Number.isInteger(command.reward) || command.reward < 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.reward`, "must be a non-negative integer for gameplay score reward storage");
  }
}

function assertSupportedPickupCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configurePickup" }>,
  path: string,
): void {
  if (!Number.isInteger(command.count) || command.count <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.count`, "must be a positive integer for gameplay pickup storage");
  }
  if (command.despawn !== true) {
    throw gameplayAuthoringDiagnosticError(`${path}.despawn`, "must be true because persistent pickup collection is not supported yet");
  }
}

function assertSupportedCollisionPickupCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionPickup" }>,
  path: string,
): void {
  if (command.target !== "self" && command.target !== "other") {
    throw gameplayAuthoringDiagnosticError(`${path}.target`, "must be one of self or other for gameplay collision pickup storage");
  }
}

function assertSupportedCollisionAreaDamageCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionAreaDamage" }>,
  path: string,
): void {
  if (!Number.isFinite(command.amount) || command.amount <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.amount`, "must be a positive finite number for gameplay collision area damage storage");
  }
  if (!Number.isFinite(command.radius) || command.radius <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.radius`, "must be a positive finite number for gameplay collision area damage storage");
  }
  gameplayCollisionLayerCode(command.targetLayer, `${path}.targetLayer`);
}

function assertSupportedCollisionKnockbackCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionKnockback" }>,
  path: string,
): void {
  if (command.target !== "self" && command.target !== "other") {
    throw gameplayAuthoringDiagnosticError(`${path}.target`, "must be one of self or other for gameplay collision knockback storage");
  }
  if (!Number.isFinite(command.impulse) || command.impulse <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.impulse`, "must be a positive finite number for gameplay collision knockback storage");
  }
}

function assertSupportedCollisionEmitEffectCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionEmitEffect" }>,
  path: string,
): void {
  if (command.effect !== undefined) {
    requiredBehaviorProp(command.effect, `${path}.effect`);
  }
  if (command.effectId !== undefined && (!Number.isSafeInteger(command.effectId) || command.effectId < 0 || command.effectId > 0xffffffff)) {
    throw gameplayAuthoringDiagnosticError(`${path}.effectId`, "must be a non-negative safe u32 integer for gameplay collision emit effect storage");
  }
  if (command.effect === undefined && command.effectId === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.effectId`, "must declare effectId or effect for gameplay collision emit effect storage");
  }
  if (!Number.isInteger(command.effectType) || command.effectType < 1 || command.effectType > 4) {
    throw gameplayAuthoringDiagnosticError(`${path}.effectType`, "must be one of the supported presentation effect type codes");
  }
  if (command.target !== "self" && command.target !== "other") {
    throw gameplayAuthoringDiagnosticError(`${path}.target`, "must be one of self or other for gameplay collision emit effect storage");
  }
  if (command.intensity !== undefined && (!Number.isFinite(command.intensity) || command.intensity < 0)) {
    throw gameplayAuthoringDiagnosticError(`${path}.intensity`, "must be a non-negative finite number for gameplay collision emit effect storage");
  }
  if (command.radius !== undefined && (!Number.isFinite(command.radius) || command.radius < 0)) {
    throw gameplayAuthoringDiagnosticError(`${path}.radius`, "must be a non-negative finite number for gameplay collision emit effect storage");
  }
  const cooldownSeconds = command.cooldownSeconds ?? 0;
  if (!Number.isFinite(cooldownSeconds) || cooldownSeconds < 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.cooldownSeconds`, "must be a non-negative finite number for gameplay collision emit effect storage");
  }
  if (command.trigger !== undefined && command.trigger !== "contact" && command.trigger !== "enter") {
    throw gameplayAuthoringDiagnosticError(`${path}.trigger`, "must be one of contact or enter for gameplay collision emit effect storage");
  }
}

function collisionEmitEffectId(
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionEmitEffect" }>,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number {
  const effectId = command.effectId ?? (command.effect === undefined ? undefined : ids?.effects?.[command.effect]);
  if (effectId === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.effect`, `must resolve presentation effect '${command.effect}' to a runtime effect id`);
  }
  if (!Number.isSafeInteger(effectId) || effectId < 0 || effectId > 0xffffffff) {
    throw gameplayAuthoringDiagnosticError(`${path}.effectId`, "must be a non-negative safe u32 integer runtime effect id");
  }
  if (command.effect !== undefined && command.effectId !== undefined) {
    const mappedEffectId = ids?.effects?.[command.effect];
    if (mappedEffectId !== undefined && mappedEffectId !== command.effectId) {
      throw gameplayAuthoringDiagnosticError(`${path}.effectId`, `conflicts with ids.effects mapping for presentation effect '${command.effect}'`);
    }
  }
  return effectId;
}

function assertSupportedCollisionSpawnPrefabCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionSpawnPrefab" }>,
  path: string,
): void {
  if (command.action !== undefined) {
    requiredBehaviorProp(command.action, `${path}.action`);
  }
  if (command.prefab !== undefined) {
    requiredBehaviorProp(command.prefab, `${path}.prefab`);
  }
  if (command.target !== "self" && command.target !== "other") {
    throw gameplayAuthoringDiagnosticError(`${path}.target`, "must be one of self or other for gameplay collision spawn prefab storage");
  }
  const cooldownSeconds = command.cooldownSeconds ?? 0;
  if (!Number.isFinite(cooldownSeconds) || cooldownSeconds < 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.cooldownSeconds`, "must be a non-negative finite number for gameplay collision spawn prefab storage");
  }
  if (command.trigger !== undefined && command.trigger !== "contact" && command.trigger !== "enter") {
    throw gameplayAuthoringDiagnosticError(`${path}.trigger`, "must be one of contact or enter for gameplay collision spawn prefab storage");
  }
  if (!Number.isFinite(command.offsetX)) {
    throw gameplayAuthoringDiagnosticError(`${path}.offsetX`, "must be a finite number for gameplay collision spawn prefab storage");
  }
  if (!Number.isFinite(command.offsetY)) {
    throw gameplayAuthoringDiagnosticError(`${path}.offsetY`, "must be a finite number for gameplay collision spawn prefab storage");
  }
}

function assertSupportedCollisionShakeCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionShake" }>,
  path: string,
): void {
  const cooldownSeconds = command.cooldownSeconds ?? 0;
  if (!Number.isFinite(cooldownSeconds) || cooldownSeconds < 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.cooldownSeconds`, "must be a non-negative finite number for gameplay collision shake storage");
  }
  if (command.trigger !== undefined && command.trigger !== "contact" && command.trigger !== "enter") {
    throw gameplayAuthoringDiagnosticError(`${path}.trigger`, "must be one of contact or enter for gameplay collision shake storage");
  }
}

function assertSupportedCollisionSoundCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionSound" }>,
  path: string,
): void {
  if (!Number.isInteger(command.soundId) || command.soundId <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.soundId`, "must be a positive integer for gameplay collision sound storage");
  }
  if (!Number.isFinite(command.volume) || command.volume < 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.volume`, "must be a non-negative finite number for gameplay collision sound storage");
  }
  if (!Number.isFinite(command.pitch) || command.pitch <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.pitch`, "must be a positive finite number for gameplay collision sound storage");
  }
  const cooldownSeconds = command.cooldownSeconds ?? 0;
  if (!Number.isFinite(cooldownSeconds) || cooldownSeconds < 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.cooldownSeconds`, "must be a non-negative finite number for gameplay collision sound storage");
  }
  if (command.replaceDefault !== undefined && typeof command.replaceDefault !== "boolean") {
    throw gameplayAuthoringDiagnosticError(`${path}.replaceDefault`, "must be a boolean for gameplay collision sound storage");
  }
  if (command.trigger !== undefined && command.trigger !== "contact" && command.trigger !== "enter") {
    throw gameplayAuthoringDiagnosticError(`${path}.trigger`, "must be one of contact or enter for gameplay collision sound storage");
  }
}

function assertSupportedCollisionParticleCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionParticle" }>,
  path: string,
): void {
  if (!Number.isInteger(command.presetId) || command.presetId < 0 || command.presetId >= MAX_PARTICLE_PRESETS) {
    throw gameplayAuthoringDiagnosticError(`${path}.presetId`, "must be an integer from 0 to 255 for gameplay collision particle storage");
  }
  if (command.target !== "self" && command.target !== "other") {
    throw gameplayAuthoringDiagnosticError(`${path}.target`, "must be one of self or other for gameplay collision particle storage");
  }
  const cooldownSeconds = command.cooldownSeconds ?? 0;
  if (!Number.isFinite(cooldownSeconds) || cooldownSeconds < 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.cooldownSeconds`, "must be a non-negative finite number for gameplay collision particle storage");
  }
  if (command.replaceDefault !== undefined && typeof command.replaceDefault !== "boolean") {
    throw gameplayAuthoringDiagnosticError(`${path}.replaceDefault`, "must be a boolean for gameplay collision particle storage");
  }
  if (command.trigger !== undefined && command.trigger !== "contact" && command.trigger !== "enter") {
    throw gameplayAuthoringDiagnosticError(`${path}.trigger`, "must be one of contact or enter for gameplay collision particle storage");
  }
}

function assertSupportedCollisionDespawnCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionDespawn" }>,
  path: string,
): void {
  if (command.target !== "self" && command.target !== "other") {
    throw gameplayAuthoringDiagnosticError(`${path}.target`, "must be one of self or other for gameplay collision despawn storage");
  }
}

function assertSupportedInteractionCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureInteraction" }>,
  path: string,
): void {
  if (!Number.isFinite(command.radius) || command.radius <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.radius`, "must be a positive finite number for gameplay interaction storage");
  }
  if (typeof command.once !== "boolean") {
    throw gameplayAuthoringDiagnosticError(`${path}.once`, "must be a boolean for gameplay interaction storage");
  }
}

function assertSupportedProjectileActionCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureProjectileAction" }>,
  path: string,
): void {
  const aim = command.aim ?? "input";
  const collisionTarget = command.collisionTarget ?? "enemies";
  const tileImpact = command.tileImpact ?? "despawn";
  const isLegacyPlayerProjectile = aim === "input" && collisionTarget === "enemies";
  const isTriggeredPlayerTargetProjectile = aim === "targetPlayer" && collisionTarget === "player";
  if (!isLegacyPlayerProjectile && !isTriggeredPlayerTargetProjectile) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.collisionTarget`,
      "must be enemies for input projectiles or player for targetPlayer projectiles",
    );
  }
  if (tileImpact !== "despawn" && tileImpact !== "passThrough" && tileImpact !== "bounce") {
    throw gameplayAuthoringDiagnosticError(`${path}.tileImpact`, "must be one of despawn, passThrough, or bounce");
  }
  if (!Number.isFinite(command.cooldownSeconds) || command.cooldownSeconds < 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.cooldownSeconds`, "must be a non-negative finite number for gameplay projectile action storage");
  }
  if (!Number.isFinite(command.speed) || command.speed <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.speed`, "must be a positive finite number for gameplay projectile action storage");
  }
  if (!Number.isFinite(command.damage) || command.damage <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.damage`, "must be a positive finite number for gameplay projectile action storage");
  }
  if (!Number.isFinite(command.lifetimeSeconds) || command.lifetimeSeconds <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.lifetimeSeconds`, "must be a positive finite number for gameplay projectile action storage");
  }
}

function assertSupportedDashActionCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureDashAction" }>,
  path: string,
): void {
  if (!Number.isFinite(command.cooldownSeconds) || command.cooldownSeconds < 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.cooldownSeconds`, "must be a non-negative finite number for gameplay dash action storage");
  }
  if (!Number.isFinite(command.distance) || command.distance <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.distance`, "must be a positive finite number for gameplay dash action storage");
  }
  dashActionAimCode(command.aim, `${path}.aim`);
}

function assertSupportedMeleeActionCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureMeleeAction" }>,
  path: string,
): void {
  if (!Number.isFinite(command.cooldownSeconds) || command.cooldownSeconds < 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.cooldownSeconds`, "must be a non-negative finite number for gameplay melee action storage");
  }
  if (!Number.isFinite(command.range) || command.range <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.range`, "must be a positive finite number for gameplay melee action storage");
  }
  if (!Number.isFinite(command.damage) || command.damage <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.damage`, "must be a positive finite number for gameplay melee action storage");
  }
  meleeTargetCode(command.target, `${path}.target`);
}

function assertSupportedSpawnPrefabActionCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureSpawnPrefabAction" }>,
  path: string,
): void {
  if (!Number.isFinite(command.cooldownSeconds) || command.cooldownSeconds < 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.cooldownSeconds`, "must be a non-negative finite number for gameplay spawn prefab action storage");
  }
  if (!Number.isFinite(command.offsetX)) {
    throw gameplayAuthoringDiagnosticError(`${path}.offsetX`, "must be a finite number for gameplay spawn prefab action storage");
  }
  if (!Number.isFinite(command.offsetY)) {
    throw gameplayAuthoringDiagnosticError(`${path}.offsetY`, "must be a finite number for gameplay spawn prefab action storage");
  }
  if (command.anchor !== "self") {
    throw gameplayAuthoringDiagnosticError(`${path}.anchor`, "must be self for gameplay spawn prefab action storage");
  }
  if (command.phase !== "prePhysics") {
    throw gameplayAuthoringDiagnosticError(`${path}.phase`, "must be prePhysics for gameplay spawn prefab action storage");
  }
  const projectile = command.projectile;
  if (projectile === undefined) {
    return;
  }
  dashActionAimCode(projectile.aim, `${path}.projectile.aim`);
  projectileCollisionTargetCode(projectile.collisionTarget, `${path}.projectile.collisionTarget`);
  projectileTileImpactCode(projectile.tileImpact, `${path}.projectile.tileImpact`);
  const aim = projectile.aim;
  const collisionTarget = projectile.collisionTarget;
  if (aim !== "targetPlayer" || collisionTarget !== "player") {
    throw gameplayAuthoringDiagnosticError(
      `${path}.projectile.collisionTarget`,
      "must be player when projectile aim is targetPlayer for projectile spawn prefab actions",
    );
  }
  if (projectile.tileImpact !== "despawn" && projectile.tileImpact !== "passThrough" && projectile.tileImpact !== "bounce") {
    throw gameplayAuthoringDiagnosticError(`${path}.projectile.tileImpact`, "must be one of despawn, passThrough, or bounce");
  }
  if (!Number.isFinite(projectile.speed) || projectile.speed <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.projectile.speed`, "must be a positive finite number for projectile spawn prefab action storage");
  }
  if (!Number.isFinite(projectile.damage) || projectile.damage <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.projectile.damage`, "must be a positive finite number for projectile spawn prefab action storage");
  }
  if (!Number.isFinite(projectile.lifetimeSeconds) || projectile.lifetimeSeconds <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.projectile.lifetimeSeconds`, "must be a positive finite number for projectile spawn prefab action storage");
  }
}

function assertSupportedTimerTriggerCommand(
  command: Extract<BehaviorRecipeCommand, { type: "configureTimerTrigger" }>,
  path: string,
): void {
  if (!Number.isFinite(command.seconds) || command.seconds <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.seconds`, "must be a positive finite number for gameplay timer trigger storage");
  }
}

function pickupItemId(
  command: Extract<BehaviorRecipeCommand, { type: "configurePickup" }>,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number {
  const itemId = command.itemId ?? ids?.items?.[command.item] ?? (command.item === "score" ? GAMEPLAY_PICKUP_ITEM_SCORE : undefined);
  if (itemId === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.item`, `must resolve pickup item '${command.item}' to a supported runtime item id`);
  }
  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.itemId`, "must be a positive integer runtime item id");
  }
  if (itemId !== GAMEPLAY_PICKUP_ITEM_SCORE) {
    throw gameplayAuthoringDiagnosticError(`${path}.itemId`, "only score pickup item id is supported by the default runtime adapter");
  }
  return itemId;
}

function interactionActionId(
  command: Extract<BehaviorRecipeCommand, { type: "configureInteraction" }>,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number {
  const actionId = command.actionId ?? ids?.actions?.[command.action];
  if (actionId === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.action`, `must resolve interaction action '${command.action}' to a runtime action id`);
  }
  if (!Number.isInteger(actionId) || actionId <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.actionId`, "must be a positive integer runtime action id");
  }
  return actionId;
}

function projectileActionId(
  command: Extract<BehaviorRecipeCommand, { type: "configureProjectileAction" }>,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number {
  const actionId = command.actionId ?? ids?.actions?.[command.action];
  if (actionId === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.action`, `must resolve projectile action '${command.action}' to a runtime action id`);
  }
  if (!Number.isInteger(actionId) || actionId <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.actionId`, "must be a positive integer runtime action id");
  }
  return actionId;
}

function dashActionId(
  command: Extract<BehaviorRecipeCommand, { type: "configureDashAction" }>,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number {
  const actionId = command.actionId ?? ids?.actions?.[command.action];
  if (actionId === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.action`, `must resolve dash action '${command.action}' to a runtime action id`);
  }
  if (!Number.isInteger(actionId) || actionId <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.actionId`, "must be a positive integer runtime action id");
  }
  return actionId;
}

function meleeActionId(
  command: Extract<BehaviorRecipeCommand, { type: "configureMeleeAction" }>,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number {
  const actionId = command.actionId ?? ids?.actions?.[command.action];
  if (actionId === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.action`, `must resolve melee action '${command.action}' to a runtime action id`);
  }
  if (!Number.isInteger(actionId) || actionId <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.actionId`, "must be a positive integer runtime action id");
  }
  return actionId;
}

function spawnPrefabActionId(
  command: Extract<BehaviorRecipeCommand, { type: "configureSpawnPrefabAction" }>,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number {
  const actionId = command.actionId ?? ids?.actions?.[command.action];
  if (actionId === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.action`, `must resolve spawn prefab action '${command.action}' to a runtime action id`);
  }
  if (!Number.isInteger(actionId) || actionId <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.actionId`, "must be a positive integer runtime action id");
  }
  return actionId;
}

function collisionSpawnPrefabActionId(
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionSpawnPrefab" }>,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number {
  const actionId = command.actionId ?? ids?.actions?.[command.action];
  if (actionId === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.action`, `must resolve collision spawn prefab action '${command.action}' to a runtime action id`);
  }
  if (!Number.isInteger(actionId) || actionId <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.actionId`, "must be a positive integer runtime action id");
  }
  return actionId;
}

function spawnPrefabId(
  command: Extract<BehaviorRecipeCommand, { type: "configureSpawnPrefabAction" }>,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number {
  const prefabId = command.prefabId ?? ids?.prefabs?.[command.prefab];
  if (prefabId === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.prefab`, `must resolve spawn prefab '${command.prefab}' to a runtime prefab id`);
  }
  if (!Number.isInteger(prefabId) || prefabId <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.prefabId`, "must be a positive integer runtime prefab id");
  }
  return prefabId;
}

function collisionSpawnPrefabId(
  command: Extract<BehaviorRecipeCommand, { type: "configureCollisionSpawnPrefab" }>,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number {
  const prefabId = command.prefabId ?? ids?.prefabs?.[command.prefab];
  if (prefabId === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.prefab`, `must resolve collision spawn prefab '${command.prefab}' to a runtime prefab id`);
  }
  if (!Number.isInteger(prefabId) || prefabId <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.prefabId`, "must be a positive integer runtime prefab id");
  }
  return prefabId;
}

function gameplayPrefabRegistrationKind(value: unknown, path: string): GameplayPrefabRegistrationKind {
  if (value === "enemy" || value === "bullet") {
    return value;
  }
  throw gameplayAuthoringDiagnosticError(path, "must be enemy or bullet for the default gameplay prefab registry");
}

function gameplayPrefabRegistrationId(
  registration: GameplayPrefabRegistration,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number {
  if (registration.prefab !== undefined) {
    requiredBehaviorProp(registration.prefab, `${path}.prefab`);
  }
  const prefabId = registration.prefabId
    ?? (registration.prefab === undefined ? undefined : ids?.prefabs?.[registration.prefab]);
  if (prefabId === undefined) {
    if (registration.prefab === undefined) {
      throw gameplayAuthoringDiagnosticError(`${path}.prefabId`, "must declare prefabId or prefab with ids.prefabs mapping");
    }
    throw gameplayAuthoringDiagnosticError(`${path}.prefab`, `must resolve prefab '${registration.prefab}' to a runtime prefab id`);
  }
  return positiveU32(prefabId, `${path}.prefabId`);
}

function timerTriggerId(
  command: Extract<BehaviorRecipeCommand, { type: "configureTimerTrigger" }>,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number {
  const timerId = command.timerId ?? ids?.timers?.[command.timer];
  if (timerId === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.timer`, `must resolve timer '${command.timer}' to a runtime timer id`);
  }
  if (!Number.isInteger(timerId) || timerId <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.timerId`, "must be a positive integer runtime timer id");
  }
  return timerId;
}

function timerTriggerActionId(
  command: Extract<BehaviorRecipeCommand, { type: "configureTimerTrigger" }>,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number | undefined {
  if (command.action === undefined && command.actionId === undefined) {
    return undefined;
  }
  const actionId = command.actionId ?? (command.action === undefined ? undefined : ids?.actions?.[command.action]);
  if (actionId === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.action`, `must resolve timer action '${command.action}' to a runtime action id`);
  }
  if (!Number.isInteger(actionId) || actionId <= 0) {
    throw gameplayAuthoringDiagnosticError(`${path}.actionId`, "must be a positive integer runtime action id");
  }
  return actionId;
}

function spawnPrefabAnchorCode(anchor: "self"): number {
  void anchor;
  return 0;
}

function spawnPrefabPhaseCode(phase: "prePhysics"): number {
  void phase;
  return 0;
}

function dashActionAimCode(aim: "input" | "targetPlayer" | undefined, path: string): number {
  if (aim === undefined || aim === "input") return 0;
  if (aim === "targetPlayer") return 1;
  throw gameplayAuthoringDiagnosticError(path, "must be one of input or targetPlayer");
}

function projectileCollisionTargetCode(
  collisionTarget: "enemies" | "player" | undefined,
  path: string,
): number {
  if (collisionTarget === undefined || collisionTarget === "enemies") return 0;
  if (collisionTarget === "player") return 1;
  throw gameplayAuthoringDiagnosticError(path, "must be one of enemies or player");
}

function projectileTileImpactCode(
  tileImpact: "despawn" | "passThrough" | "bounce" | undefined,
  path: string,
): number {
  if (tileImpact === undefined || tileImpact === "despawn") return 0;
  if (tileImpact === "passThrough") return 1;
  if (tileImpact === "bounce") return 2;
  throw gameplayAuthoringDiagnosticError(path, "must be one of despawn, passThrough, or bounce");
}

function meleeTargetCode(target: "enemies" | "player" | undefined, path: string): number {
  if (target === undefined || target === "enemies") return 0;
  if (target === "player") return 1;
  throw gameplayAuthoringDiagnosticError(path, "must be one of enemies or player");
}

function movementNearestLayerTarget(target: string, path: string): GameplayMovementQueryLayer | undefined {
  if (!target.startsWith(GAMEPLAY_MOVEMENT_QUERY_LAYER_TARGET_PREFIX)) {
    return undefined;
  }
  const layer = target.slice(GAMEPLAY_MOVEMENT_QUERY_LAYER_TARGET_PREFIX.length);
  if (isGameplayMovementQueryLayer(layer)) {
    return layer;
  }
  throw gameplayAuthoringDiagnosticError(
    path,
    "nearestLayer target must be one of nearestLayer:player, nearestLayer:enemy, nearestLayer:bullet, nearestLayer:wall, or nearestLayer:pickup",
  );
}

function gameplayMovementQueryLayerCode(layer: GameplayMovementQueryLayer): number {
  return GAMEPLAY_MOVEMENT_QUERY_LAYER_CODES[layer];
}

function isGameplayMovementQueryLayer(layer: string): layer is GameplayMovementQueryLayer {
  return Object.prototype.hasOwnProperty.call(GAMEPLAY_MOVEMENT_QUERY_LAYER_CODES, layer);
}

function movementNearestFactionTarget(target: string, path: string): GameplayMovementQueryFaction | undefined {
  if (!target.startsWith(GAMEPLAY_MOVEMENT_QUERY_FACTION_TARGET_PREFIX)) {
    return undefined;
  }
  const faction = target.slice(GAMEPLAY_MOVEMENT_QUERY_FACTION_TARGET_PREFIX.length);
  if (isGameplayMovementQueryFactionName(faction)) {
    return faction;
  }
  if (/^\d+$/.test(faction)) {
    const factionId = Number(faction);
    if (Number.isInteger(factionId) && factionId >= 0 && factionId <= MAX_GAMEPLAY_FACTION_ID) {
      return factionId;
    }
  }
  throw gameplayAuthoringDiagnosticError(
    path,
    `nearestFaction target must be nearestFaction:neutral, nearestFaction:player, nearestFaction:enemy, or nearestFaction:<${GAMEPLAY_FACTION_ID_RANGE_LABEL}>`,
  );
}

function gameplayMovementQueryFactionCode(faction: GameplayMovementQueryFaction): number {
  if (typeof faction === "number") {
    return faction;
  }
  return GAMEPLAY_FACTION_CODES[faction];
}

function isGameplayMovementQueryFactionName(faction: string): faction is keyof typeof GAMEPLAY_FACTION_CODES {
  return Object.prototype.hasOwnProperty.call(GAMEPLAY_FACTION_CODES, faction);
}

function movementNearestTagTarget(
  target: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number | undefined {
  if (!target.startsWith(GAMEPLAY_MOVEMENT_QUERY_TAG_TARGET_PREFIX)) {
    return undefined;
  }
  const tag = target.slice(GAMEPLAY_MOVEMENT_QUERY_TAG_TARGET_PREFIX.length);
  return gameplayTagId(tag, ids, path);
}

function gameplayTagMask(
  tags: readonly string[],
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number {
  if (tags.length === 0) {
    throw gameplayAuthoringDiagnosticError(path, "must include at least one gameplay tag");
  }
  const tagIds = new Set<number>();
  for (let index = 0; index < tags.length; index += 1) {
    tagIds.add(gameplayTagId(tags[index]!, ids, `${path}.${index}`));
  }
  let mask = 0;
  for (const tagId of tagIds) {
    mask += 2 ** tagId;
  }
  return mask;
}

function gameplayTagId(
  tag: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): number {
  if (tag.length === 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-empty gameplay tag");
  }
  if (/^\d+$/.test(tag)) {
    return gameplayTagIdValue(Number(tag), path);
  }
  const tagId = ids?.tags?.[tag];
  if (tagId === undefined) {
    throw gameplayAuthoringDiagnosticError(path, `must resolve gameplay tag '${tag}' to a runtime tag id`);
  }
  return gameplayTagIdValue(tagId, path);
}

function gameplayTagIdValue(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_GAMEPLAY_TAG_ID) {
    throw gameplayAuthoringDiagnosticError(path, `must be an integer gameplay tag id between ${GAMEPLAY_TAG_ID_RANGE_LABEL}`);
  }
  return value;
}

function requireApplied(applied: boolean, path: string, command: BehaviorRecipeCommand): boolean {
  if (!applied) {
    throw gameplayAuthoringDiagnosticError(
      path,
      `runtime rejected '${command.type}' for entity '${command.entity}'; check stale handles, invalid runtime ids or values, unsupported prefabs, and per-entity capacity limits`,
    );
  }
  return true;
}

function requireRuntimeMethod<T>(method: T | undefined, path: string, detail: string): T {
  if (method === undefined) {
    throw gameplayAuthoringDiagnosticError(path, detail);
  }
  return method;
}

function collisionTargetCode(target: "self" | "other"): number {
  return target === "self" ? 0 : 1;
}

function gameplayCollisionLayerCode(layer: string, path: string): number {
  const code = GAMEPLAY_MOVEMENT_QUERY_LAYER_CODES[layer as GameplayMovementQueryLayer];
  if (code !== undefined) {
    return code;
  }
  throw gameplayAuthoringDiagnosticError(path, "must be one of player, enemy, bullet, wall, or pickup");
}

function collisionTriggerCode(trigger: "contact" | "enter"): number {
  return trigger === "contact" ? 0 : 1;
}

function requiredBehaviorProp(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-empty string");
  }
  return value;
}

function missingBehaviorMode(value: unknown, path: string): MissingSceneBehaviorBinding {
  if (value === "ignore" || value === "error") {
    return value;
  }
  throw gameplayAuthoringDiagnosticError(path, "must be one of ignore or error");
}

function runtimeIdNamespace(value: unknown, path: string): Record<string, number> {
  if (value === undefined) {
    return {};
  }
  const raw = recordValue(value, path);
  const ids: Record<string, number> = {};
  for (const [key, runtimeId] of Object.entries(raw)) {
    const name = requiredBehaviorProp(key, `${path}.${key}`);
    ids[name] = positiveU32(runtimeId, `${path}.${key}`);
  }
  return ids;
}

function runtimeTagIdNamespace(value: unknown, path: string): Record<string, number> {
  if (value === undefined) {
    return {};
  }
  const raw = recordValue(value, path);
  const ids: Record<string, number> = {};
  for (const [key, runtimeId] of Object.entries(raw)) {
    const name = requiredBehaviorProp(key, `${path}.${key}`);
    ids[name] = gameplayTagIdValue(runtimeId, `${path}.${key}`);
  }
  return ids;
}

function requireRuntimeIdNames(
  ids: Readonly<Record<string, number>>,
  names: readonly string[],
  path: string,
): void {
  for (const name of names) {
    const key = requiredBehaviorProp(name, `${path}.required`);
    if (ids[key] === undefined) {
      throw gameplayAuthoringDiagnosticError(`${path}.${key}`, `must declare runtime id for '${key}'`);
    }
  }
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-negative integer");
  }
  return value;
}

function positiveU32(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 0xffffffff) {
    throw gameplayAuthoringDiagnosticError(path, "must be a positive safe u32 integer");
  }
  return value;
}

function recordValue(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  }
  return value;
}

function isResolvedSceneCompositionSpec(
  value: SceneCompositionSpec | ResolvedSceneCompositionSpec,
): value is ResolvedSceneCompositionSpec {
  const firstPrefab = Object.values(value.prefabs ?? {})[0];
  const firstFragment = Object.values(value.fragments ?? {})[0];
  return isRecord(firstPrefab)
    && typeof firstPrefab.id === "string"
    && isRecord(firstPrefab.variants)
    && isRecord(firstFragment)
    && typeof firstFragment.id === "string"
    && Array.isArray(firstFragment.instances)
    && Array.isArray(firstFragment.include);
}

function isResolvedBehaviorRecipeDocument(
  value: BehaviorRecipeDocumentSpec | ResolvedBehaviorRecipeDocument,
): value is ResolvedBehaviorRecipeDocument {
  const firstEntity = Object.values(value.entities ?? {})[0];
  const firstRecipe = Object.values(value.recipes ?? {})[0];
  return isRecord(firstEntity)
    && typeof firstEntity.id === "string"
    && Array.isArray(firstEntity.recipes)
    && (firstRecipe === undefined || (isRecord(firstRecipe) && typeof firstRecipe.id === "string" && typeof firstRecipe.enabled === "boolean"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isHandleMap(value: GameplayEntityHandleMap): value is ReadonlyMap<string, GameplayEntityHandle> {
  return typeof (value as ReadonlyMap<string, GameplayEntityHandle>).get === "function";
}
