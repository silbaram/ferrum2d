/** Shared authoring contracts; runtime orchestration remains in gameplayAuthoring. */
import type {
  BehaviorRecipeApplyResult,
  BehaviorRecipeCommand,
  BehaviorRecipeCommandOptions,
} from "./behaviorRecipes.js";
import type { DiagnosticReport } from "./diagnostics.js";
import type { InstantiateSceneFragmentOptions, ResolvedSceneCompositionInstance } from "./sceneComposition.js";
import type { SceneInstanceHandleRegistry } from "./sceneInstanceHandles.js";

export type GameplayBehaviorBindingSpec = string | readonly string[];

export type MissingSceneBehaviorBinding = "ignore" | "error";

export type SceneInstanceAuthoringKind = "worldObject" | "actor";

export type SceneInstanceEntityExists = (handle: GameplayEntityHandle) => boolean;

export interface ClassifySceneInstanceOptions {
  behaviorProp?: string;
  path?: string;
}

export interface SceneInstanceAuthoringClassification {
  kind: SceneInstanceAuthoringKind;
  hasDataSceneComponents: boolean;
  behaviorProfiles: readonly string[];
}

export interface SceneInstanceHandleRegistryOptions {
  entityExists?: SceneInstanceEntityExists;
}

export interface SceneInstanceHandleLookupOptions {
  validateLive?: boolean;
  path?: string;
}

export interface SceneInstanceHandleRegistrySyncOptions {
  removeMissing?: boolean;
  pruneStale?: boolean;
  path?: string;
}

export interface SceneInstanceHandleRegistryEntry {
  instanceId: string;
  handle: GameplayEntityHandle;
}

export interface SceneInstanceHandleRegistrySyncResult {
  entries: readonly SceneInstanceHandleRegistryEntry[];
  removedInstanceIds: readonly string[];
  staleInstanceIds: readonly string[];
}

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
  variables?: Readonly<Record<string, number>>;
}

export interface ResolveGameplayBehaviorRuntimeIdsOptions {
  path?: string;
  requiredItems?: readonly string[];
  requiredActions?: readonly string[];
  requiredPrefabs?: readonly string[];
  requiredTimers?: readonly string[];
  requiredTags?: readonly string[];
  requiredEffects?: readonly string[];
  requiredVariables?: readonly string[];
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
  supports_gameplay_pickup_item?(itemId: number): boolean;
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
  set_gameplay_interaction_with_guard?(
    entityId: number, entityGeneration: number, actionId: number, radius: number, once: boolean,
    leftSlot: number, operator: number, rightSlot: number, rightLiteral: number,
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
  set_gameplay_timer_trigger_with_guard?(
    entityId: number, entityGeneration: number, timerId: number, durationSeconds: number,
    leftSlot: number, operator: number, rightSlot: number, rightLiteral: number,
  ): boolean;
  set_gameplay_timer_action_trigger_with_guard?(
    entityId: number, entityGeneration: number, timerId: number, durationSeconds: number,
    actionId: number, leftSlot: number, operator: number, rightSlot: number, rightLiteral: number,
  ): boolean;
  clear_gameplay_timer_trigger?(entityId: number, entityGeneration: number): boolean;
  add_gameplay_variable_mutation_trigger?(
    entityId: number, entityGeneration: number, eventKind: number, tokenId: number,
    variableSlot: number, operation: number, value: number,
  ): boolean;
  clear_gameplay_variable_mutation_triggers?(entityId: number, entityGeneration: number): boolean;
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
  set_gameplay_movement_chase_primary_actor?(
    entityId: number,
    entityGeneration: number,
    speed: number,
  ): boolean;
  set_gameplay_movement_chase_nearest_player?(
    entityId: number,
    entityGeneration: number,
    speed: number,
  ): boolean;
  set_gameplay_movement_chase_nearest_primary_actor?(
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
  set_gameplay_movement_seek_target_primary_actor?(
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
  set_gameplay_movement_seek_target_nearest_primary_actor?(
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
  add_gameplay_collision_damage_with_guard?(
    entityId: number, entityGeneration: number, amount: number, target: number,
    leftSlot: number, operator: number, rightSlot: number, rightLiteral: number,
  ): boolean;
  add_gameplay_collision_area_damage?(entityId: number, entityGeneration: number, radius: number, targetLayerCode: number): boolean;
  add_gameplay_collision_area_damage_with_guard?(
    entityId: number, entityGeneration: number, amount: number, radius: number, targetLayerCode: number,
    leftSlot: number, operator: number, rightSlot: number, rightLiteral: number,
  ): boolean;
  add_gameplay_collision_knockback?(
    entityId: number,
    entityGeneration: number,
    target: number,
    impulse: number,
  ): boolean;
  add_gameplay_collision_knockback_with_guard?(
    entityId: number, entityGeneration: number, target: number, impulse: number,
    leftSlot: number, operator: number, rightSlot: number, rightLiteral: number,
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
  add_gameplay_collision_emit_effect_with_guard?(
    entityId: number, entityGeneration: number, effectId: number, effectType: number,
    target: number, cooldownSeconds: number, trigger: number, intensity: number, radius: number,
    leftSlot: number, operator: number, rightSlot: number, rightLiteral: number,
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
  add_gameplay_collision_spawn_prefab_with_guard?(
    entityId: number, entityGeneration: number, actionId: number, prefabId: number,
    target: number, cooldownSeconds: number, trigger: number, offsetX: number, offsetY: number,
    leftSlot: number, operator: number, rightSlot: number, rightLiteral: number,
  ): boolean;
  add_gameplay_collision_pickup?(entityId: number, entityGeneration: number, target: number): boolean;
  add_gameplay_collision_pickup_with_guard?(
    entityId: number, entityGeneration: number, target: number,
    leftSlot: number, operator: number, rightSlot: number, rightLiteral: number,
  ): boolean;
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
  add_gameplay_collision_sound_with_guard?(
    entityId: number, entityGeneration: number, soundId: number, volume: number, pitch: number,
    cooldownSeconds: number, replaceDefault: boolean, trigger: number,
    leftSlot: number, operator: number, rightSlot: number, rightLiteral: number,
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
  add_gameplay_collision_camera_shake_with_guard?(
    entityId: number, entityGeneration: number, cooldownSeconds: number, trigger: number,
    leftSlot: number, operator: number, rightSlot: number, rightLiteral: number,
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
  add_gameplay_collision_particle_with_guard?(
    entityId: number, entityGeneration: number, presetId: number, target: number,
    cooldownSeconds: number, replaceDefault: boolean, trigger: number,
    leftSlot: number, operator: number, rightSlot: number, rightLiteral: number,
  ): boolean;
  add_gameplay_collision_despawn?(entityId: number, entityGeneration: number, target: number): boolean;
  add_gameplay_collision_despawn_with_guard?(
    entityId: number, entityGeneration: number, target: number,
    leftSlot: number, operator: number, rightSlot: number, rightLiteral: number,
  ): boolean;
}

export interface SceneBehaviorBindingOptions extends InstantiateSceneFragmentOptions, BehaviorRecipeCommandOptions {
  behaviorProp?: string;
  missingBehavior?: MissingSceneBehaviorBinding;
  requireExplicitInstanceIds?: boolean;
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
  instanceHandleRegistry?: SceneInstanceHandleRegistry;
}

export interface SceneBehaviorApplyResult {
  plan: SceneBehaviorBindingPlan;
  entityHandles: Readonly<Record<string, GameplayEntityHandle>>;
  spawnResults: readonly GameplayEntityHandle[];
  instanceHandleSync?: SceneInstanceHandleRegistrySyncResult;
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
