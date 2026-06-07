import { behaviorRecipeDiagnosticError } from "./diagnostics.js";

const MAX_PARTICLE_PRESETS = 256;
const MAX_GAMEPLAY_FACTION_ID = 31;
const MAX_GAMEPLAY_TAG_ID = 31;
const MOVEMENT_NEAREST_LAYER_TARGET_PREFIX = "nearestLayer:" as const;
const MOVEMENT_NEAREST_FACTION_TARGET_PREFIX = "nearestFaction:" as const;
const MOVEMENT_NEAREST_TAG_TARGET_PREFIX = "nearestTag:" as const;
const MOVEMENT_QUERY_LAYERS = Object.freeze({
  player: true,
  enemy: true,
  bullet: true,
  wall: true,
  pickup: true,
} as const);
const MOVEMENT_QUERY_FACTIONS = Object.freeze({
  neutral: true,
  player: true,
  enemy: true,
} as const);
const PRESENTATION_EFFECT_TYPE_CODES = Object.freeze({
  sound: 1,
  particle: 2,
  cameraShake: 3,
  custom: 4,
} as const);

export type BehaviorRecipeKind =
  | "health"
  | "damage"
  | "faction"
  | "lifetime"
  | "scoreReward"
  | "pickup"
  | "collisionPickup"
  | "collisionAreaDamage"
  | "collisionKnockback"
  | "collisionEmitEffect"
  | "collisionSpawnPrefab"
  | "collisionSound"
  | "collisionParticle"
  | "collisionShake"
  | "collisionDespawn"
  | "chase"
  | "seekTarget"
  | "accelerate"
  | "interaction"
  | "projectileAction"
  | "dashAction"
  | "meleeAction"
  | "spawnPrefabAction"
  | "timerTrigger";
export type BehaviorRecipeHealthZeroAction = "none" | "despawn" | "event";
export type BehaviorRecipeDamageTarget = "other" | "self";
export type BehaviorRecipeFaction = "neutral" | "player" | "enemy" | number;
export type BehaviorRecipeActionAim = "input" | "targetPlayer";
export type BehaviorRecipeProjectileCollisionTarget = "enemies" | "player";
export type BehaviorRecipeProjectileTileImpact = "despawn" | "passThrough" | "bounce";
export type BehaviorRecipeMeleeTarget = "enemies" | "player";
export type BehaviorRecipeCollisionTrigger = "contact" | "enter";
export type BehaviorRecipeCollisionLayer = keyof typeof MOVEMENT_QUERY_LAYERS;
export type BehaviorRecipePresentationEffectKind = keyof typeof PRESENTATION_EFFECT_TYPE_CODES;

export interface BehaviorRecipeBaseSpec {
  id?: string;
  kind: BehaviorRecipeKind;
  enabled?: boolean;
  tags?: readonly string[];
}

export interface HealthBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "health";
  max?: number;
  start?: number;
  onZero?: BehaviorRecipeHealthZeroAction;
  event?: string;
}

export interface DamageBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "damage";
  amount?: number;
  target?: BehaviorRecipeDamageTarget;
  cooldownSeconds?: number;
}

export interface FactionBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "faction";
  faction: BehaviorRecipeFaction;
  damages?: readonly BehaviorRecipeFaction[];
}

export interface LifetimeBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "lifetime";
  seconds?: number;
}

export interface ScoreRewardBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "scoreReward";
  reward?: number;
}

export interface PickupBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "pickup";
  item: string;
  itemId?: number;
  count?: number;
  despawn?: boolean;
}

export interface CollisionPickupBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "collisionPickup";
  target?: BehaviorRecipeDamageTarget;
}

export interface CollisionAreaDamageBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "collisionAreaDamage";
  amount?: number;
  radius?: number;
  targetLayer?: BehaviorRecipeCollisionLayer;
}

export interface CollisionKnockbackBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "collisionKnockback";
  target?: BehaviorRecipeDamageTarget;
  impulse?: number;
}

export interface CollisionEmitEffectBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "collisionEmitEffect";
  effect?: string;
  effectId?: number;
  effectKind?: BehaviorRecipePresentationEffectKind;
  target?: BehaviorRecipeDamageTarget;
  intensity?: number;
  radius?: number;
  cooldownSeconds?: number;
  trigger?: BehaviorRecipeCollisionTrigger;
}

export interface CollisionSpawnPrefabBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "collisionSpawnPrefab";
  action: string;
  actionId?: number;
  prefab: string;
  prefabId?: number;
  target?: BehaviorRecipeDamageTarget;
  cooldownSeconds?: number;
  trigger?: BehaviorRecipeCollisionTrigger;
  offsetX?: number;
  offsetY?: number;
}

export interface CollisionSoundBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "collisionSound";
  soundId: number;
  volume?: number;
  pitch?: number;
  cooldownSeconds?: number;
  replaceDefault?: boolean;
  trigger?: BehaviorRecipeCollisionTrigger;
}

export interface CollisionParticleBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "collisionParticle";
  presetId: number;
  target?: BehaviorRecipeDamageTarget;
  cooldownSeconds?: number;
  replaceDefault?: boolean;
  trigger?: BehaviorRecipeCollisionTrigger;
}

export interface CollisionShakeBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "collisionShake";
  cooldownSeconds?: number;
  trigger?: BehaviorRecipeCollisionTrigger;
}

export interface CollisionDespawnBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "collisionDespawn";
  target?: BehaviorRecipeDamageTarget;
}

export interface ChaseBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "chase";
  target?: string;
  speed?: number;
  stopDistance?: number;
  maxDistance?: number;
}

export interface SeekTargetBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "seekTarget";
  target?: string;
  speed?: number;
  turnRate?: number;
}

export interface AccelerateBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "accelerate";
  accelerationX?: number;
  accelerationY?: number;
  maxSpeed?: number;
}

export interface InteractionBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "interaction";
  action: string;
  actionId?: number;
  radius?: number;
  prompt?: string;
  once?: boolean;
}

export interface ProjectileActionBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "projectileAction";
  action: string;
  actionId?: number;
  cooldownSeconds?: number;
  speed?: number;
  damage?: number;
  lifetimeSeconds?: number;
  aim?: BehaviorRecipeActionAim;
  collisionTarget?: BehaviorRecipeProjectileCollisionTarget;
  tileImpact?: BehaviorRecipeProjectileTileImpact;
}

export interface SpawnPrefabProjectilePayloadSpec {
  speed?: number;
  damage?: number;
  lifetimeSeconds?: number;
  aim?: BehaviorRecipeActionAim;
  collisionTarget?: BehaviorRecipeProjectileCollisionTarget;
  tileImpact?: BehaviorRecipeProjectileTileImpact;
}

export interface DashActionBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "dashAction";
  action: string;
  actionId?: number;
  cooldownSeconds?: number;
  distance?: number;
  aim?: BehaviorRecipeActionAim;
}

export interface MeleeActionBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "meleeAction";
  action: string;
  actionId?: number;
  cooldownSeconds?: number;
  range?: number;
  damage?: number;
  target?: BehaviorRecipeMeleeTarget;
}

export interface SpawnPrefabActionBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "spawnPrefabAction";
  action: string;
  actionId?: number;
  prefab: string;
  prefabId?: number;
  cooldownSeconds?: number;
  anchor?: "self";
  phase?: "prePhysics";
  offsetX?: number;
  offsetY?: number;
  projectile?: SpawnPrefabProjectilePayloadSpec;
}

export interface TimerTriggerBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "timerTrigger";
  timer: string;
  timerId?: number;
  action?: string;
  actionId?: number;
  seconds?: number;
}

export type BehaviorRecipeSpec =
  | HealthBehaviorRecipeSpec
  | DamageBehaviorRecipeSpec
  | FactionBehaviorRecipeSpec
  | LifetimeBehaviorRecipeSpec
  | ScoreRewardBehaviorRecipeSpec
  | PickupBehaviorRecipeSpec
  | CollisionPickupBehaviorRecipeSpec
  | CollisionAreaDamageBehaviorRecipeSpec
  | CollisionKnockbackBehaviorRecipeSpec
  | CollisionEmitEffectBehaviorRecipeSpec
  | CollisionSpawnPrefabBehaviorRecipeSpec
  | CollisionSoundBehaviorRecipeSpec
  | CollisionParticleBehaviorRecipeSpec
  | CollisionShakeBehaviorRecipeSpec
  | CollisionDespawnBehaviorRecipeSpec
  | ChaseBehaviorRecipeSpec
  | SeekTargetBehaviorRecipeSpec
  | AccelerateBehaviorRecipeSpec
  | InteractionBehaviorRecipeSpec
  | ProjectileActionBehaviorRecipeSpec
  | DashActionBehaviorRecipeSpec
  | MeleeActionBehaviorRecipeSpec
  | SpawnPrefabActionBehaviorRecipeSpec
  | TimerTriggerBehaviorRecipeSpec;

export type BehaviorRecipeEntrySpec = string | BehaviorRecipeSpec | BehaviorRecipeReferenceSpec;

export interface BehaviorRecipeReferenceSpec {
  use: string;
  id?: string;
  overrides?: Partial<BehaviorRecipeSpec>;
}

export interface BehaviorRecipeEntitySpec {
  tags?: readonly string[];
  recipes: readonly BehaviorRecipeEntrySpec[];
}

export interface BehaviorRecipeDocumentSpec {
  recipes?: Readonly<Record<string, BehaviorRecipeSpec>>;
  entities: Readonly<Record<string, BehaviorRecipeEntitySpec>>;
}

export interface ResolveBehaviorRecipeDocumentOptions {
  path?: string;
}

export interface BehaviorRecipeCommandOptions {
  kinds?: readonly BehaviorRecipeKind[];
  includeEntityTags?: boolean;
}

export interface ApplyBehaviorRecipesOptions extends BehaviorRecipeCommandOptions {
  entity?: string;
  path?: string;
}

export interface ResolvedBehaviorRecipeBase {
  id: string;
  kind: BehaviorRecipeKind;
  enabled: boolean;
  tags: readonly string[];
}

export interface ResolvedHealthBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "health";
  max: number;
  start: number;
  onZero: BehaviorRecipeHealthZeroAction;
  event?: string;
}

export interface ResolvedDamageBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "damage";
  amount: number;
  target: BehaviorRecipeDamageTarget;
  cooldownSeconds: number;
}

export interface ResolvedFactionBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "faction";
  faction: BehaviorRecipeFaction;
  damages: readonly BehaviorRecipeFaction[];
}

export interface ResolvedLifetimeBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "lifetime";
  seconds: number;
}

export interface ResolvedScoreRewardBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "scoreReward";
  reward: number;
}

export interface ResolvedPickupBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "pickup";
  item: string;
  itemId?: number;
  count: number;
  despawn: boolean;
}

export interface ResolvedCollisionPickupBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "collisionPickup";
  target: BehaviorRecipeDamageTarget;
}

export interface ResolvedCollisionAreaDamageBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "collisionAreaDamage";
  amount: number;
  radius: number;
  targetLayer: BehaviorRecipeCollisionLayer;
}

export interface ResolvedCollisionKnockbackBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "collisionKnockback";
  target: BehaviorRecipeDamageTarget;
  impulse: number;
}

export interface ResolvedCollisionEmitEffectBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "collisionEmitEffect";
  effect?: string;
  effectId?: number;
  effectKind: BehaviorRecipePresentationEffectKind;
  effectType: number;
  target: BehaviorRecipeDamageTarget;
  intensity?: number;
  radius?: number;
  cooldownSeconds: number;
  trigger: BehaviorRecipeCollisionTrigger;
}

export interface ResolvedCollisionSpawnPrefabBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "collisionSpawnPrefab";
  action: string;
  actionId?: number;
  prefab: string;
  prefabId?: number;
  target: BehaviorRecipeDamageTarget;
  cooldownSeconds: number;
  trigger: BehaviorRecipeCollisionTrigger;
  offsetX: number;
  offsetY: number;
}

export interface ResolvedCollisionSoundBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "collisionSound";
  soundId: number;
  volume: number;
  pitch: number;
  cooldownSeconds: number;
  replaceDefault: boolean;
  trigger: BehaviorRecipeCollisionTrigger;
}

export interface ResolvedCollisionParticleBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "collisionParticle";
  presetId: number;
  target: BehaviorRecipeDamageTarget;
  cooldownSeconds: number;
  replaceDefault: boolean;
  trigger: BehaviorRecipeCollisionTrigger;
}

export interface ResolvedCollisionShakeBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "collisionShake";
  cooldownSeconds: number;
  trigger: BehaviorRecipeCollisionTrigger;
}

export interface ResolvedCollisionDespawnBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "collisionDespawn";
  target: BehaviorRecipeDamageTarget;
}

export interface ResolvedChaseBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "chase";
  target: string;
  speed: number;
  stopDistance: number;
  maxDistance?: number;
}

export interface ResolvedSeekTargetBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "seekTarget";
  target: string;
  speed: number;
  turnRate: number;
}

export interface ResolvedAccelerateBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "accelerate";
  accelerationX: number;
  accelerationY: number;
  maxSpeed: number;
}

export interface ResolvedInteractionBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "interaction";
  action: string;
  actionId?: number;
  radius: number;
  prompt?: string;
  once: boolean;
}

export interface ResolvedProjectileActionBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "projectileAction";
  action: string;
  actionId?: number;
  cooldownSeconds: number;
  speed: number;
  damage: number;
  lifetimeSeconds: number;
  aim: BehaviorRecipeActionAim;
  collisionTarget: BehaviorRecipeProjectileCollisionTarget;
  tileImpact: BehaviorRecipeProjectileTileImpact;
}

export interface ResolvedSpawnPrefabProjectilePayload {
  speed: number;
  damage: number;
  lifetimeSeconds: number;
  aim: BehaviorRecipeActionAim;
  collisionTarget: BehaviorRecipeProjectileCollisionTarget;
  tileImpact: BehaviorRecipeProjectileTileImpact;
}

export interface ResolvedDashActionBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "dashAction";
  action: string;
  actionId?: number;
  cooldownSeconds: number;
  distance: number;
  aim: BehaviorRecipeActionAim;
}

export interface ResolvedMeleeActionBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "meleeAction";
  action: string;
  actionId?: number;
  cooldownSeconds: number;
  range: number;
  damage: number;
  target: BehaviorRecipeMeleeTarget;
}

export interface ResolvedSpawnPrefabActionBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "spawnPrefabAction";
  action: string;
  actionId?: number;
  prefab: string;
  prefabId?: number;
  cooldownSeconds: number;
  anchor: "self";
  phase: "prePhysics";
  offsetX: number;
  offsetY: number;
  projectile?: ResolvedSpawnPrefabProjectilePayload;
}

export interface ResolvedTimerTriggerBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "timerTrigger";
  timer: string;
  timerId?: number;
  action?: string;
  actionId?: number;
  seconds: number;
}

export type ResolvedBehaviorRecipe =
  | ResolvedHealthBehaviorRecipe
  | ResolvedDamageBehaviorRecipe
  | ResolvedFactionBehaviorRecipe
  | ResolvedLifetimeBehaviorRecipe
  | ResolvedScoreRewardBehaviorRecipe
  | ResolvedPickupBehaviorRecipe
  | ResolvedCollisionPickupBehaviorRecipe
  | ResolvedCollisionAreaDamageBehaviorRecipe
  | ResolvedCollisionKnockbackBehaviorRecipe
  | ResolvedCollisionEmitEffectBehaviorRecipe
  | ResolvedCollisionSpawnPrefabBehaviorRecipe
  | ResolvedCollisionSoundBehaviorRecipe
  | ResolvedCollisionParticleBehaviorRecipe
  | ResolvedCollisionShakeBehaviorRecipe
  | ResolvedCollisionDespawnBehaviorRecipe
  | ResolvedChaseBehaviorRecipe
  | ResolvedSeekTargetBehaviorRecipe
  | ResolvedAccelerateBehaviorRecipe
  | ResolvedInteractionBehaviorRecipe
  | ResolvedProjectileActionBehaviorRecipe
  | ResolvedDashActionBehaviorRecipe
  | ResolvedMeleeActionBehaviorRecipe
  | ResolvedSpawnPrefabActionBehaviorRecipe
  | ResolvedTimerTriggerBehaviorRecipe;

export interface ResolvedBehaviorRecipeEntity {
  id: string;
  tags: readonly string[];
  recipes: readonly ResolvedBehaviorRecipe[];
}

export interface ResolvedBehaviorRecipeDocument {
  recipes: Readonly<Record<string, ResolvedBehaviorRecipe>>;
  entities: Readonly<Record<string, ResolvedBehaviorRecipeEntity>>;
}

export type BehaviorRecipeCommand =
  | ConfigureTagsBehaviorCommand
  | ConfigureHealthBehaviorCommand
  | ConfigureDamageBehaviorCommand
  | ConfigureFactionBehaviorCommand
  | ConfigureLifetimeBehaviorCommand
  | ConfigureScoreRewardBehaviorCommand
  | ConfigurePickupBehaviorCommand
  | ConfigureCollisionPickupBehaviorCommand
  | ConfigureCollisionAreaDamageBehaviorCommand
  | ConfigureCollisionKnockbackBehaviorCommand
  | ConfigureCollisionEmitEffectBehaviorCommand
  | ConfigureCollisionSpawnPrefabBehaviorCommand
  | ConfigureCollisionSoundBehaviorCommand
  | ConfigureCollisionParticleBehaviorCommand
  | ConfigureCollisionDespawnBehaviorCommand
  | ConfigureCollisionShakeBehaviorCommand
  | ConfigureChaseBehaviorCommand
  | ConfigureSeekTargetBehaviorCommand
  | ConfigureAccelerateBehaviorCommand
  | ConfigureInteractionBehaviorCommand
  | ConfigureProjectileActionBehaviorCommand
  | ConfigureDashActionBehaviorCommand
  | ConfigureMeleeActionBehaviorCommand
  | ConfigureSpawnPrefabActionBehaviorCommand
  | ConfigureTimerTriggerBehaviorCommand;

export interface BehaviorRecipeCommandBase {
  entity: string;
  recipe: string;
  tags: readonly string[];
}

export interface ConfigureTagsBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureTags";
}

export interface ConfigureHealthBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureHealth";
  max: number;
  current: number;
  onZero: BehaviorRecipeHealthZeroAction;
  event?: string;
}

export interface ConfigureDamageBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureDamage";
  amount: number;
  target: BehaviorRecipeDamageTarget;
  cooldownSeconds: number;
}

export interface ConfigureFactionBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureFaction";
  faction: BehaviorRecipeFaction;
  damages: readonly BehaviorRecipeFaction[];
}

export interface ConfigureLifetimeBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureLifetime";
  seconds: number;
}

export interface ConfigureScoreRewardBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureScoreReward";
  reward: number;
}

export interface ConfigurePickupBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configurePickup";
  item: string;
  itemId?: number;
  count: number;
  despawn: boolean;
}

export interface ConfigureCollisionPickupBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureCollisionPickup";
  target: BehaviorRecipeDamageTarget;
}

export interface ConfigureCollisionAreaDamageBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureCollisionAreaDamage";
  amount: number;
  radius: number;
  targetLayer: BehaviorRecipeCollisionLayer;
}

export interface ConfigureCollisionKnockbackBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureCollisionKnockback";
  target: BehaviorRecipeDamageTarget;
  impulse: number;
}

export interface ConfigureCollisionEmitEffectBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureCollisionEmitEffect";
  effect?: string;
  effectId?: number;
  effectKind: BehaviorRecipePresentationEffectKind;
  effectType: number;
  target: BehaviorRecipeDamageTarget;
  intensity?: number;
  radius?: number;
  cooldownSeconds?: number;
  trigger?: BehaviorRecipeCollisionTrigger;
}

export interface ConfigureCollisionSpawnPrefabBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureCollisionSpawnPrefab";
  action: string;
  actionId?: number;
  prefab: string;
  prefabId?: number;
  target: BehaviorRecipeDamageTarget;
  cooldownSeconds?: number;
  trigger?: BehaviorRecipeCollisionTrigger;
  offsetX: number;
  offsetY: number;
}

export interface ConfigureCollisionSoundBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureCollisionSound";
  soundId: number;
  volume: number;
  pitch: number;
  cooldownSeconds?: number;
  replaceDefault?: boolean;
  trigger?: BehaviorRecipeCollisionTrigger;
}

export interface ConfigureCollisionParticleBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureCollisionParticle";
  presetId: number;
  target: BehaviorRecipeDamageTarget;
  cooldownSeconds?: number;
  replaceDefault?: boolean;
  trigger?: BehaviorRecipeCollisionTrigger;
}

export interface ConfigureCollisionDespawnBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureCollisionDespawn";
  target: BehaviorRecipeDamageTarget;
}

export interface ConfigureCollisionShakeBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureCollisionShake";
  cooldownSeconds?: number;
  trigger?: BehaviorRecipeCollisionTrigger;
}

export interface ConfigureChaseBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureChase";
  target: string;
  speed: number;
  stopDistance: number;
  maxDistance?: number;
}

export interface ConfigureSeekTargetBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureSeekTarget";
  target: string;
  speed: number;
  turnRate: number;
}

export interface ConfigureAccelerateBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureAccelerate";
  accelerationX: number;
  accelerationY: number;
  maxSpeed: number;
}

export interface ConfigureInteractionBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureInteraction";
  action: string;
  actionId?: number;
  radius: number;
  prompt?: string;
  once: boolean;
}

export interface ConfigureProjectileActionBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureProjectileAction";
  action: string;
  actionId?: number;
  cooldownSeconds: number;
  speed: number;
  damage: number;
  lifetimeSeconds: number;
  aim?: BehaviorRecipeActionAim;
  collisionTarget?: BehaviorRecipeProjectileCollisionTarget;
  tileImpact?: BehaviorRecipeProjectileTileImpact;
}

export interface ConfigureDashActionBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureDashAction";
  action: string;
  actionId?: number;
  cooldownSeconds: number;
  distance: number;
  aim?: BehaviorRecipeActionAim;
}

export interface ConfigureMeleeActionBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureMeleeAction";
  action: string;
  actionId?: number;
  cooldownSeconds: number;
  range: number;
  damage: number;
  target?: BehaviorRecipeMeleeTarget;
}

export interface ConfigureSpawnPrefabActionBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureSpawnPrefabAction";
  action: string;
  actionId?: number;
  prefab: string;
  prefabId?: number;
  cooldownSeconds: number;
  anchor: "self";
  phase: "prePhysics";
  offsetX: number;
  offsetY: number;
  projectile?: ResolvedSpawnPrefabProjectilePayload;
}

export interface ConfigureTimerTriggerBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureTimerTrigger";
  timer: string;
  timerId?: number;
  action?: string;
  actionId?: number;
  seconds: number;
}

export interface BehaviorRecipeRuntimeTarget {
  applyBehaviorRecipeCommand(command: BehaviorRecipeCommand): unknown;
}

export interface BehaviorRecipeApplyResult {
  commands: readonly BehaviorRecipeCommand[];
  results: readonly unknown[];
}

export function resolveBehaviorRecipeDocument(
  document: BehaviorRecipeDocumentSpec,
  options: ResolveBehaviorRecipeDocumentOptions = {},
): ResolvedBehaviorRecipeDocument {
  const path = options.path ?? "behaviorRecipes";
  if (!isRecord(document)) {
    throw behaviorRecipeDiagnosticError(path, "must be an object");
  }
  const reusableRecipes = resolveReusableRecipes(requiredRecord(document.recipes ?? {}, `${path}.recipes`), `${path}.recipes`);
  const entities = resolveBehaviorRecipeEntities(requiredRecord(document.entities, `${path}.entities`), reusableRecipes, `${path}.entities`);
  return {
    recipes: reusableRecipes,
    entities,
  };
}

export function behaviorRecipeCommandsForEntity(
  document: BehaviorRecipeDocumentSpec | ResolvedBehaviorRecipeDocument,
  entityId: string,
  options: BehaviorRecipeCommandOptions = {},
): BehaviorRecipeCommand[] {
  const resolved = isResolvedBehaviorRecipeDocument(document)
    ? document
    : resolveBehaviorRecipeDocument(document as BehaviorRecipeDocumentSpec);
  const entity = resolved.entities[requiredString(entityId, "behaviorRecipes.entity")];
  if (entity === undefined) {
    throw behaviorRecipeDiagnosticError("behaviorRecipes.entity", `references unknown entity '${entityId}'`);
  }
  const kinds = recipeKindSet(options.kinds, "behaviorRecipes.kinds");
  const commands = entity.recipes
    .filter((recipe) => recipe.enabled && (kinds === undefined || kinds.has(recipe.kind)))
    .map((recipe) => commandForRecipe(entity.id, recipe));
  if (options.includeEntityTags === true && entity.tags.length > 0) {
    return [commandForEntityTags(entity), ...commands];
  }
  return commands;
}

export function applyBehaviorRecipes(
  target: BehaviorRecipeRuntimeTarget,
  document: BehaviorRecipeDocumentSpec | ResolvedBehaviorRecipeDocument,
  options: ApplyBehaviorRecipesOptions = {},
): BehaviorRecipeApplyResult {
  const path = options.path ?? "behaviorRecipes";
  if (!isRecord(target) || typeof target.applyBehaviorRecipeCommand !== "function") {
    throw behaviorRecipeDiagnosticError(`${path}.target`, "must expose applyBehaviorRecipeCommand(command)");
  }
  const resolved = isResolvedBehaviorRecipeDocument(document)
    ? document
    : resolveBehaviorRecipeDocument(document as BehaviorRecipeDocumentSpec, { path });
  const entityIds = options.entity === undefined
    ? Object.keys(resolved.entities)
    : [requiredString(options.entity, `${path}.entity`)];
  const commands = entityIds.flatMap((entityId) =>
    behaviorRecipeCommandsForEntity(resolved, entityId, { kinds: options.kinds }),
  );
  return {
    commands,
    results: commands.map((command) => target.applyBehaviorRecipeCommand(command)),
  };
}

function resolveReusableRecipes(
  recipes: Readonly<Record<string, unknown>>,
  path: string,
): Record<string, ResolvedBehaviorRecipe> {
  const resolved: Record<string, ResolvedBehaviorRecipe> = {};
  for (const [recipeId, recipe] of Object.entries(recipes)) {
    resolved[recipeId] = resolveBehaviorRecipe(recipe, `${path}.${recipeId}`, recipeId);
  }
  return resolved;
}

function resolveBehaviorRecipeEntities(
  entities: Readonly<Record<string, unknown>>,
  reusableRecipes: Readonly<Record<string, ResolvedBehaviorRecipe>>,
  path: string,
): Record<string, ResolvedBehaviorRecipeEntity> {
  const resolved: Record<string, ResolvedBehaviorRecipeEntity> = {};
  for (const [entityId, entity] of Object.entries(entities)) {
    const entityPath = `${path}.${entityId}`;
    if (!isRecord(entity)) {
      throw behaviorRecipeDiagnosticError(entityPath, "must be an object");
    }
    const recipes = arrayOf(entity.recipes, `${entityPath}.recipes`).map((recipe, index) =>
      resolveBehaviorRecipeEntry(recipe, reusableRecipes, `${entityPath}.recipes.${index}`, `${entityId}.${index}`),
    );
    assertUniqueRecipeIds(recipes, `${entityPath}.recipes`);
    resolved[entityId] = {
      id: entityId,
      tags: stringArray(entity.tags ?? [], `${entityPath}.tags`),
      recipes,
    };
  }
  return resolved;
}

function resolveBehaviorRecipeEntry(
  entry: unknown,
  reusableRecipes: Readonly<Record<string, ResolvedBehaviorRecipe>>,
  path: string,
  fallbackId: string,
): ResolvedBehaviorRecipe {
  if (typeof entry === "string") {
    return reusableRecipe(entry, reusableRecipes, path);
  }
  if (!isRecord(entry)) {
    throw behaviorRecipeDiagnosticError(path, "must be a recipe object, recipe reference object, or recipe id string");
  }
  if (typeof entry.use === "string") {
    const base = reusableRecipe(entry.use, reusableRecipes, `${path}.use`);
    const overrides = entry.overrides ?? {};
    if (!isRecord(overrides)) {
      throw behaviorRecipeDiagnosticError(`${path}.overrides`, "must be an object");
    }
    if (overrides.kind !== undefined && overrides.kind !== base.kind) {
      throw behaviorRecipeDiagnosticError(`${path}.overrides.kind`, "must match the referenced recipe kind");
    }
    return resolveBehaviorRecipe({
      ...base,
      ...overrides,
      id: optionalString(entry.id, `${path}.id`, base.id),
      kind: base.kind,
    }, path, base.id);
  }
  return resolveBehaviorRecipe(entry, path, fallbackId);
}

function reusableRecipe(
  recipeId: string,
  reusableRecipes: Readonly<Record<string, ResolvedBehaviorRecipe>>,
  path: string,
): ResolvedBehaviorRecipe {
  const recipe = reusableRecipes[recipeId];
  if (recipe === undefined) {
    throw behaviorRecipeDiagnosticError(path, `references unknown recipe '${recipeId}'`);
  }
  return recipe;
}

function resolveBehaviorRecipe(value: unknown, path: string, fallbackId: string): ResolvedBehaviorRecipe {
  if (!isRecord(value)) {
    throw behaviorRecipeDiagnosticError(path, "must be an object");
  }
  const kind = behaviorRecipeKind(value.kind, `${path}.kind`);
  const base = {
    id: optionalString(value.id, `${path}.id`, fallbackId),
    enabled: optionalBoolean(value.enabled, `${path}.enabled`, true),
    tags: stringArray(value.tags ?? [], `${path}.tags`),
  };
  switch (kind) {
    case "health": {
      const max = positiveNumber(value.max ?? 1, `${path}.max`);
      const onZero = healthZeroAction(value.onZero ?? "despawn", `${path}.onZero`);
      const event = value.event ?? (onZero === "event" ? "health.zero" : undefined);
      return {
        ...base,
        kind,
        max,
        start: clamp(nonNegativeNumber(value.start ?? max, `${path}.start`), 0, max),
        onZero,
        ...(event === undefined ? {} : { event: requiredString(event, `${path}.event`) }),
      };
    }
    case "damage":
      return {
        ...base,
        kind,
        amount: positiveNumber(value.amount ?? 1, `${path}.amount`),
        target: damageTarget(value.target ?? "other", `${path}.target`),
        cooldownSeconds: nonNegativeNumber(value.cooldownSeconds ?? 0, `${path}.cooldownSeconds`),
      };
    case "faction": {
      const faction = gameplayFaction(value.faction, `${path}.faction`);
      return {
        ...base,
        kind,
        faction,
        damages: gameplayFactionArray(value.damages ?? defaultFactionDamages(faction), `${path}.damages`),
      };
    }
    case "lifetime":
      return {
        ...base,
        kind,
        seconds: positiveNumber(value.seconds ?? 1, `${path}.seconds`),
      };
    case "scoreReward":
      return {
        ...base,
        kind,
        reward: nonNegativeInteger(value.reward ?? 1, `${path}.reward`),
      };
    case "pickup":
      return {
        ...base,
        kind,
        item: requiredString(value.item, `${path}.item`),
        ...(value.itemId === undefined ? {} : { itemId: positiveInteger(value.itemId, `${path}.itemId`) }),
        count: positiveInteger(value.count ?? 1, `${path}.count`),
        despawn: optionalBoolean(value.despawn, `${path}.despawn`, true),
      };
    case "collisionPickup":
      return {
        ...base,
        kind,
        target: damageTarget(value.target ?? "self", `${path}.target`),
      };
    case "collisionAreaDamage":
      return {
        ...base,
        kind,
        amount: positiveNumber(value.amount ?? 1, `${path}.amount`),
        radius: positiveNumber(value.radius ?? 32, `${path}.radius`),
        targetLayer: collisionLayer(value.targetLayer ?? "enemy", `${path}.targetLayer`),
      };
    case "collisionKnockback":
      return {
        ...base,
        kind,
        target: damageTarget(value.target ?? "other", `${path}.target`),
        impulse: positiveNumber(value.impulse ?? 120, `${path}.impulse`),
      };
    case "collisionEmitEffect": {
      const effectKind = presentationEffectKind(value.effectKind ?? "custom", `${path}.effectKind`);
      const effect = value.effect === undefined ? undefined : requiredString(value.effect, `${path}.effect`);
      const effectId = value.effectId === undefined
        ? effect === undefined ? 0 : undefined
        : nonNegativeU32(value.effectId, `${path}.effectId`);
      return {
        ...base,
        kind,
        ...(effect === undefined ? {} : { effect }),
        ...(effectId === undefined ? {} : { effectId }),
        effectKind,
        effectType: presentationEffectTypeCode(effectKind),
        target: damageTarget(value.target ?? "self", `${path}.target`),
        ...(value.intensity === undefined ? {} : { intensity: nonNegativeNumber(value.intensity, `${path}.intensity`) }),
        ...(value.radius === undefined ? {} : { radius: nonNegativeNumber(value.radius, `${path}.radius`) }),
        cooldownSeconds: nonNegativeNumber(value.cooldownSeconds ?? 0, `${path}.cooldownSeconds`),
        trigger: collisionTrigger(value.trigger ?? "contact", `${path}.trigger`),
      };
    }
    case "collisionSpawnPrefab":
      return {
        ...base,
        kind,
        action: requiredString(value.action, `${path}.action`),
        ...(value.actionId === undefined ? {} : { actionId: positiveInteger(value.actionId, `${path}.actionId`) }),
        prefab: requiredString(value.prefab, `${path}.prefab`),
        ...(value.prefabId === undefined ? {} : { prefabId: positiveInteger(value.prefabId, `${path}.prefabId`) }),
        target: damageTarget(value.target ?? "self", `${path}.target`),
        cooldownSeconds: nonNegativeNumber(value.cooldownSeconds ?? 0, `${path}.cooldownSeconds`),
        trigger: collisionTrigger(value.trigger ?? "contact", `${path}.trigger`),
        offsetX: finiteNumber(value.offsetX ?? 0, `${path}.offsetX`),
        offsetY: finiteNumber(value.offsetY ?? 0, `${path}.offsetY`),
      };
    case "collisionSound":
      return {
        ...base,
        kind,
        soundId: positiveInteger(value.soundId, `${path}.soundId`),
        volume: nonNegativeNumber(value.volume ?? 1, `${path}.volume`),
        pitch: positiveNumber(value.pitch ?? 1, `${path}.pitch`),
        cooldownSeconds: nonNegativeNumber(value.cooldownSeconds ?? 0, `${path}.cooldownSeconds`),
        replaceDefault: optionalBoolean(value.replaceDefault, `${path}.replaceDefault`, false),
        trigger: collisionTrigger(value.trigger ?? "contact", `${path}.trigger`),
      };
    case "collisionParticle":
      return {
        ...base,
        kind,
        presetId: particlePresetId(value.presetId, `${path}.presetId`),
        target: damageTarget(value.target ?? "other", `${path}.target`),
        cooldownSeconds: nonNegativeNumber(value.cooldownSeconds ?? 0, `${path}.cooldownSeconds`),
        replaceDefault: optionalBoolean(value.replaceDefault, `${path}.replaceDefault`, false),
        trigger: collisionTrigger(value.trigger ?? "contact", `${path}.trigger`),
      };
    case "collisionShake":
      return {
        ...base,
        kind,
        cooldownSeconds: nonNegativeNumber(value.cooldownSeconds ?? 0, `${path}.cooldownSeconds`),
        trigger: collisionTrigger(value.trigger ?? "contact", `${path}.trigger`),
      };
    case "collisionDespawn":
      return {
        ...base,
        kind,
        target: damageTarget(value.target ?? "self", `${path}.target`),
      };
    case "chase":
      return {
        ...base,
        kind,
        target: optionalMovementTarget(value.target, `${path}.target`, "player"),
        speed: positiveNumber(value.speed ?? 80, `${path}.speed`),
        stopDistance: nonNegativeNumber(value.stopDistance ?? 12, `${path}.stopDistance`),
        ...(value.maxDistance === undefined ? {} : { maxDistance: positiveNumber(value.maxDistance, `${path}.maxDistance`) }),
      };
    case "seekTarget":
      return {
        ...base,
        kind,
        target: optionalMovementTarget(value.target, `${path}.target`, "player"),
        speed: positiveNumber(value.speed ?? 260, `${path}.speed`),
        turnRate: nonNegativeNumber(value.turnRate ?? 0, `${path}.turnRate`),
      };
    case "accelerate": {
      const accelerationX = finiteNumber(value.accelerationX ?? 0, `${path}.accelerationX`);
      const accelerationY = finiteNumber(value.accelerationY ?? 0, `${path}.accelerationY`);
      const maxSpeed = positiveNumber(value.maxSpeed ?? 1, `${path}.maxSpeed`);
      if (accelerationX === 0 && accelerationY === 0) {
        throw behaviorRecipeDiagnosticError(
          `${path}`,
          "at least one of accelerationX or accelerationY must be non-zero",
        );
      }
      return {
        ...base,
        kind,
        accelerationX,
        accelerationY,
        maxSpeed,
      };
    }
    case "interaction":
      return {
        ...base,
        kind,
        action: requiredString(value.action, `${path}.action`),
        ...(value.actionId === undefined ? {} : { actionId: positiveInteger(value.actionId, `${path}.actionId`) }),
        radius: positiveNumber(value.radius ?? 24, `${path}.radius`),
        ...(value.prompt === undefined ? {} : { prompt: requiredString(value.prompt, `${path}.prompt`) }),
        once: optionalBoolean(value.once, `${path}.once`, false),
      };
    case "projectileAction":
      return {
        ...base,
        kind,
        action: requiredString(value.action, `${path}.action`),
        ...(value.actionId === undefined ? {} : { actionId: positiveInteger(value.actionId, `${path}.actionId`) }),
        cooldownSeconds: nonNegativeNumber(value.cooldownSeconds ?? 0, `${path}.cooldownSeconds`),
        speed: positiveNumber(value.speed ?? 360, `${path}.speed`),
        damage: positiveNumber(value.damage ?? 1, `${path}.damage`),
        lifetimeSeconds: positiveNumber(value.lifetimeSeconds ?? 1, `${path}.lifetimeSeconds`),
        aim: actionAim(value.aim ?? "input", `${path}.aim`),
        collisionTarget: projectileCollisionTarget(value.collisionTarget ?? "enemies", `${path}.collisionTarget`),
        tileImpact: projectileTileImpact(value.tileImpact ?? "despawn", `${path}.tileImpact`),
      };
    case "dashAction":
      return {
        ...base,
        kind,
        action: requiredString(value.action, `${path}.action`),
        ...(value.actionId === undefined ? {} : { actionId: positiveInteger(value.actionId, `${path}.actionId`) }),
        cooldownSeconds: nonNegativeNumber(value.cooldownSeconds ?? 0, `${path}.cooldownSeconds`),
        distance: positiveNumber(value.distance ?? 80, `${path}.distance`),
        aim: actionAim(value.aim ?? "input", `${path}.aim`),
      };
    case "meleeAction":
      return {
        ...base,
        kind,
        action: requiredString(value.action, `${path}.action`),
        ...(value.actionId === undefined ? {} : { actionId: positiveInteger(value.actionId, `${path}.actionId`) }),
        cooldownSeconds: nonNegativeNumber(value.cooldownSeconds ?? 0, `${path}.cooldownSeconds`),
        range: positiveNumber(value.range ?? 32, `${path}.range`),
        damage: positiveNumber(value.damage ?? 1, `${path}.damage`),
        target: meleeTarget(value.target ?? "enemies", `${path}.target`),
      };
    case "spawnPrefabAction": {
      const projectileValue = value.projectile;
      if (projectileValue !== undefined && !isRecord(projectileValue)) {
        throw behaviorRecipeDiagnosticError(`${path}.projectile`, "must be an object when provided");
      }
      const projectile = projectileValue === undefined
        ? undefined
        : {
            speed: positiveNumber(projectileValue.speed ?? 360, `${path}.projectile.speed`),
            damage: positiveNumber(projectileValue.damage ?? 1, `${path}.projectile.damage`),
            lifetimeSeconds: positiveNumber(projectileValue.lifetimeSeconds ?? 1, `${path}.projectile.lifetimeSeconds`),
            aim: actionAim(projectileValue.aim ?? "targetPlayer", `${path}.projectile.aim`),
            collisionTarget: projectileCollisionTarget(projectileValue.collisionTarget ?? "player", `${path}.projectile.collisionTarget`),
            tileImpact: projectileTileImpact(projectileValue.tileImpact ?? "despawn", `${path}.projectile.tileImpact`),
          };
      return {
        ...base,
        kind,
        action: requiredString(value.action, `${path}.action`),
        ...(value.actionId === undefined ? {} : { actionId: positiveInteger(value.actionId, `${path}.actionId`) }),
        prefab: requiredString(value.prefab, `${path}.prefab`),
        ...(value.prefabId === undefined ? {} : { prefabId: positiveInteger(value.prefabId, `${path}.prefabId`) }),
        cooldownSeconds: nonNegativeNumber(value.cooldownSeconds ?? 0, `${path}.cooldownSeconds`),
        anchor: spawnPrefabAnchor(value.anchor ?? "self", `${path}.anchor`),
        phase: spawnPrefabPhase(value.phase ?? "prePhysics", `${path}.phase`),
        offsetX: finiteNumber(value.offsetX ?? 0, `${path}.offsetX`),
        offsetY: finiteNumber(value.offsetY ?? 0, `${path}.offsetY`),
        ...(projectile === undefined ? {} : { projectile }),
      };
    }
    case "timerTrigger":
      return {
        ...base,
        kind,
        timer: requiredString(value.timer, `${path}.timer`),
        ...(value.timerId === undefined ? {} : { timerId: positiveInteger(value.timerId, `${path}.timerId`) }),
        ...(value.action === undefined ? {} : { action: requiredString(value.action, `${path}.action`) }),
        ...(value.actionId === undefined ? {} : { actionId: positiveInteger(value.actionId, `${path}.actionId`) }),
        seconds: positiveNumber(value.seconds ?? 1, `${path}.seconds`),
      };
  }
}

function commandForRecipe(entity: string, recipe: ResolvedBehaviorRecipe): BehaviorRecipeCommand {
  const base = {
    entity,
    recipe: recipe.id,
    tags: recipe.tags,
  };
  switch (recipe.kind) {
    case "health":
      return {
        ...base,
        type: "configureHealth",
        max: recipe.max,
        current: recipe.start,
        onZero: recipe.onZero,
        ...(recipe.event === undefined ? {} : { event: recipe.event }),
      };
    case "damage":
      return {
        ...base,
        type: "configureDamage",
        amount: recipe.amount,
        target: recipe.target,
        cooldownSeconds: recipe.cooldownSeconds,
      };
    case "faction":
      return {
        ...base,
        type: "configureFaction",
        faction: recipe.faction,
        damages: recipe.damages,
      };
    case "lifetime":
      return {
        ...base,
        type: "configureLifetime",
        seconds: recipe.seconds,
      };
    case "scoreReward":
      return {
        ...base,
        type: "configureScoreReward",
        reward: recipe.reward,
      };
    case "pickup":
      return {
        ...base,
        type: "configurePickup",
        item: recipe.item,
        ...(recipe.itemId === undefined ? {} : { itemId: recipe.itemId }),
        count: recipe.count,
        despawn: recipe.despawn,
      };
    case "collisionPickup":
      return {
        ...base,
        type: "configureCollisionPickup",
        target: recipe.target,
      };
    case "collisionAreaDamage":
      return {
        ...base,
        type: "configureCollisionAreaDamage",
        amount: recipe.amount,
        radius: recipe.radius,
        targetLayer: recipe.targetLayer,
      };
    case "collisionKnockback":
      return {
        ...base,
        type: "configureCollisionKnockback",
        target: recipe.target,
        impulse: recipe.impulse,
      };
    case "collisionEmitEffect":
      return {
        ...base,
        type: "configureCollisionEmitEffect",
        ...(recipe.effect === undefined ? {} : { effect: recipe.effect }),
        ...(recipe.effectId === undefined ? {} : { effectId: recipe.effectId }),
        effectKind: recipe.effectKind,
        effectType: recipe.effectType,
        target: recipe.target,
        ...(recipe.intensity === undefined ? {} : { intensity: recipe.intensity }),
        ...(recipe.radius === undefined ? {} : { radius: recipe.radius }),
        cooldownSeconds: recipe.cooldownSeconds,
        trigger: recipe.trigger,
      };
    case "collisionSpawnPrefab":
      return {
        ...base,
        type: "configureCollisionSpawnPrefab",
        action: recipe.action,
        ...(recipe.actionId === undefined ? {} : { actionId: recipe.actionId }),
        prefab: recipe.prefab,
        ...(recipe.prefabId === undefined ? {} : { prefabId: recipe.prefabId }),
        target: recipe.target,
        cooldownSeconds: recipe.cooldownSeconds,
        trigger: recipe.trigger,
        offsetX: recipe.offsetX,
        offsetY: recipe.offsetY,
      };
    case "collisionSound":
      return {
        ...base,
        type: "configureCollisionSound",
        soundId: recipe.soundId,
        volume: recipe.volume,
        pitch: recipe.pitch,
        cooldownSeconds: recipe.cooldownSeconds,
        replaceDefault: recipe.replaceDefault,
        trigger: recipe.trigger,
      };
    case "collisionParticle":
      return {
        ...base,
        type: "configureCollisionParticle",
        presetId: recipe.presetId,
        target: recipe.target,
        cooldownSeconds: recipe.cooldownSeconds,
        replaceDefault: recipe.replaceDefault,
        trigger: recipe.trigger,
      };
    case "collisionShake":
      return {
        ...base,
        type: "configureCollisionShake",
        cooldownSeconds: recipe.cooldownSeconds,
        trigger: recipe.trigger,
      };
    case "collisionDespawn":
      return {
        ...base,
        type: "configureCollisionDespawn",
        target: recipe.target,
      };
    case "chase":
      return {
        ...base,
        type: "configureChase",
        target: recipe.target,
        speed: recipe.speed,
        stopDistance: recipe.stopDistance,
        ...(recipe.maxDistance === undefined ? {} : { maxDistance: recipe.maxDistance }),
      };
    case "seekTarget":
      return {
        ...base,
        type: "configureSeekTarget",
        target: recipe.target,
        speed: recipe.speed,
        turnRate: recipe.turnRate,
      };
    case "accelerate":
      return {
        ...base,
        type: "configureAccelerate",
        accelerationX: recipe.accelerationX,
        accelerationY: recipe.accelerationY,
        maxSpeed: recipe.maxSpeed,
      };
    case "interaction":
      return {
        ...base,
        type: "configureInteraction",
        action: recipe.action,
        ...(recipe.actionId === undefined ? {} : { actionId: recipe.actionId }),
        radius: recipe.radius,
        ...(recipe.prompt === undefined ? {} : { prompt: recipe.prompt }),
        once: recipe.once,
      };
    case "projectileAction":
      return {
        ...base,
        type: "configureProjectileAction",
        action: recipe.action,
        ...(recipe.actionId === undefined ? {} : { actionId: recipe.actionId }),
        cooldownSeconds: recipe.cooldownSeconds,
        speed: recipe.speed,
        damage: recipe.damage,
        lifetimeSeconds: recipe.lifetimeSeconds,
        aim: recipe.aim,
        collisionTarget: recipe.collisionTarget,
        tileImpact: recipe.tileImpact,
      };
    case "dashAction":
      return {
        ...base,
        type: "configureDashAction",
        action: recipe.action,
        ...(recipe.actionId === undefined ? {} : { actionId: recipe.actionId }),
        cooldownSeconds: recipe.cooldownSeconds,
        distance: recipe.distance,
        aim: recipe.aim,
      };
    case "meleeAction":
      return {
        ...base,
        type: "configureMeleeAction",
        action: recipe.action,
        ...(recipe.actionId === undefined ? {} : { actionId: recipe.actionId }),
        cooldownSeconds: recipe.cooldownSeconds,
        range: recipe.range,
        damage: recipe.damage,
        target: recipe.target,
      };
    case "spawnPrefabAction":
      return {
        ...base,
        type: "configureSpawnPrefabAction",
        action: recipe.action,
        ...(recipe.actionId === undefined ? {} : { actionId: recipe.actionId }),
        prefab: recipe.prefab,
        ...(recipe.prefabId === undefined ? {} : { prefabId: recipe.prefabId }),
        cooldownSeconds: recipe.cooldownSeconds,
        anchor: recipe.anchor,
        phase: recipe.phase,
        offsetX: recipe.offsetX,
        offsetY: recipe.offsetY,
        ...(recipe.projectile === undefined ? {} : { projectile: recipe.projectile }),
      };
    case "timerTrigger":
      return {
        ...base,
        type: "configureTimerTrigger",
        timer: recipe.timer,
        ...(recipe.timerId === undefined ? {} : { timerId: recipe.timerId }),
        ...(recipe.action === undefined ? {} : { action: recipe.action }),
        ...(recipe.actionId === undefined ? {} : { actionId: recipe.actionId }),
        seconds: recipe.seconds,
      };
  }
}

function commandForEntityTags(entity: ResolvedBehaviorRecipeEntity): ConfigureTagsBehaviorCommand {
  return {
    entity: entity.id,
    recipe: "entity.tags",
    tags: entity.tags,
    type: "configureTags",
  };
}

function assertUniqueRecipeIds(recipes: readonly ResolvedBehaviorRecipe[], path: string): void {
  const seen = new Set<string>();
  for (const recipe of recipes) {
    if (seen.has(recipe.id)) {
      throw behaviorRecipeDiagnosticError(`${path}.${recipe.id}`, "recipe id must be unique per entity");
    }
    seen.add(recipe.id);
  }
}

function recipeKindSet(value: readonly BehaviorRecipeKind[] | undefined, path: string): Set<BehaviorRecipeKind> | undefined {
  if (value === undefined) {
    return undefined;
  }
  return new Set(value.map((kind, index) => behaviorRecipeKind(kind, `${path}.${index}`)));
}

function behaviorRecipeKind(value: unknown, path: string): BehaviorRecipeKind {
  if (
    value === "health"
    || value === "damage"
    || value === "faction"
    || value === "lifetime"
    || value === "scoreReward"
    || value === "pickup"
    || value === "collisionPickup"
    || value === "collisionAreaDamage"
    || value === "collisionKnockback"
    || value === "collisionEmitEffect"
    || value === "collisionSpawnPrefab"
    || value === "collisionSound"
    || value === "collisionParticle"
    || value === "collisionShake"
    || value === "collisionDespawn"
    || value === "chase"
    || value === "seekTarget"
    || value === "accelerate"
    || value === "interaction"
    || value === "projectileAction"
    || value === "dashAction"
    || value === "meleeAction"
    || value === "spawnPrefabAction"
    || value === "timerTrigger"
  ) {
    return value;
  }
  throw behaviorRecipeDiagnosticError(path, "must be one of health, damage, faction, lifetime, scoreReward, pickup, collisionPickup, collisionAreaDamage, collisionKnockback, collisionEmitEffect, collisionSpawnPrefab, collisionSound, collisionParticle, collisionShake, collisionDespawn, chase, seekTarget, accelerate, interaction, projectileAction, dashAction, meleeAction, spawnPrefabAction, or timerTrigger");
}

function spawnPrefabAnchor(value: unknown, path: string): "self" {
  if (value === "self") {
    return value;
  }
  throw behaviorRecipeDiagnosticError(path, "must be self");
}

function spawnPrefabPhase(value: unknown, path: string): "prePhysics" {
  if (value === "prePhysics") {
    return value;
  }
  throw behaviorRecipeDiagnosticError(path, "must be prePhysics");
}

function actionAim(value: unknown, path: string): BehaviorRecipeActionAim {
  if (value === "input" || value === "targetPlayer") {
    return value;
  }
  throw behaviorRecipeDiagnosticError(path, "must be one of input or targetPlayer");
}

function projectileCollisionTarget(value: unknown, path: string): BehaviorRecipeProjectileCollisionTarget {
  if (value === "enemies" || value === "player") {
    return value;
  }
  throw behaviorRecipeDiagnosticError(path, "must be one of enemies or player");
}

function projectileTileImpact(value: unknown, path: string): BehaviorRecipeProjectileTileImpact {
  if (value === "despawn" || value === "passThrough" || value === "bounce") {
    return value;
  }
  throw behaviorRecipeDiagnosticError(path, "must be one of despawn, passThrough, or bounce");
}

function meleeTarget(value: unknown, path: string): BehaviorRecipeMeleeTarget {
  if (value === "enemies" || value === "player") {
    return value;
  }
  throw behaviorRecipeDiagnosticError(path, "must be one of enemies or player");
}

function healthZeroAction(value: unknown, path: string): BehaviorRecipeHealthZeroAction {
  if (value === "none" || value === "despawn" || value === "event") {
    return value;
  }
  throw behaviorRecipeDiagnosticError(path, "must be one of none, despawn, or event");
}

function damageTarget(value: unknown, path: string): BehaviorRecipeDamageTarget {
  if (value === "other" || value === "self") {
    return value;
  }
  throw behaviorRecipeDiagnosticError(path, "must be one of other or self");
}

function collisionLayer(value: unknown, path: string): BehaviorRecipeCollisionLayer {
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(MOVEMENT_QUERY_LAYERS, value)) {
    return value as BehaviorRecipeCollisionLayer;
  }
  throw behaviorRecipeDiagnosticError(path, "must be one of player, enemy, bullet, wall, or pickup");
}

function presentationEffectKind(value: unknown, path: string): BehaviorRecipePresentationEffectKind {
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(PRESENTATION_EFFECT_TYPE_CODES, value)) {
    return value as BehaviorRecipePresentationEffectKind;
  }
  throw behaviorRecipeDiagnosticError(path, "must be one of sound, particle, cameraShake, or custom");
}

function presentationEffectTypeCode(kind: BehaviorRecipePresentationEffectKind): number {
  return PRESENTATION_EFFECT_TYPE_CODES[kind];
}

function gameplayFaction(value: unknown, path: string): BehaviorRecipeFaction {
  if (value === "neutral" || value === "player" || value === "enemy") {
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_GAMEPLAY_FACTION_ID) {
    return value;
  }
  throw behaviorRecipeDiagnosticError(path, "must be one of neutral, player, enemy, or an integer faction id between 0 and 31");
}

function gameplayFactionArray(value: unknown, path: string): readonly BehaviorRecipeFaction[] {
  return arrayOf(value, path).map((entry, index) => gameplayFaction(entry, `${path}.${index}`));
}

function defaultFactionDamages(faction: unknown): readonly BehaviorRecipeFaction[] {
  if (faction === "player") return ["enemy"];
  if (faction === "enemy") return ["player"];
  return [];
}

function collisionTrigger(value: unknown, path: string): BehaviorRecipeCollisionTrigger {
  if (value === "contact" || value === "enter") {
    return value;
  }
  throw behaviorRecipeDiagnosticError(path, "must be one of contact or enter");
}

function arrayOf(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw behaviorRecipeDiagnosticError(path, "must be an array");
  }
  return value;
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw behaviorRecipeDiagnosticError(path, "must be an object");
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  return arrayOf(value, path).map((entry, index) => requiredString(entry, `${path}.${index}`));
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw behaviorRecipeDiagnosticError(path, "must be a non-empty string");
  }
  return value;
}

function optionalString<T extends string | undefined>(value: unknown, path: string, fallback: T): string | T {
  if (value === undefined) {
    return fallback;
  }
  return requiredString(value, path);
}

function optionalMovementTarget<T extends string>(value: unknown, path: string, fallback: T): string | T {
  const target = optionalString(value, path, fallback);
  if (!target.startsWith(MOVEMENT_NEAREST_LAYER_TARGET_PREFIX)) {
    if (!target.startsWith(MOVEMENT_NEAREST_FACTION_TARGET_PREFIX)) {
      if (!target.startsWith(MOVEMENT_NEAREST_TAG_TARGET_PREFIX)) {
        return target;
      }
      const tag = target.slice(MOVEMENT_NEAREST_TAG_TARGET_PREFIX.length);
      if (isMovementQueryTag(tag)) {
        return target;
      }
      throw behaviorRecipeDiagnosticError(
        path,
        "nearestTag target must be nearestTag:<tagName> or nearestTag:<0..31>",
      );
    }
    const faction = target.slice(MOVEMENT_NEAREST_FACTION_TARGET_PREFIX.length);
    if (isMovementQueryFaction(faction)) {
      return target;
    }
    throw behaviorRecipeDiagnosticError(
      path,
      "nearestFaction target must be nearestFaction:neutral, nearestFaction:player, nearestFaction:enemy, or nearestFaction:<0..31>",
    );
  }
  const layer = target.slice(MOVEMENT_NEAREST_LAYER_TARGET_PREFIX.length);
  if (Object.prototype.hasOwnProperty.call(MOVEMENT_QUERY_LAYERS, layer)) {
    return target;
  }
  throw behaviorRecipeDiagnosticError(
    path,
    "nearestLayer target must be one of nearestLayer:player, nearestLayer:enemy, nearestLayer:bullet, nearestLayer:wall, or nearestLayer:pickup",
  );
}

function isMovementQueryTag(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  if (!/^\d+$/.test(value)) {
    return true;
  }
  const tagId = Number(value);
  return Number.isInteger(tagId) && tagId >= 0 && tagId <= MAX_GAMEPLAY_TAG_ID;
}

function isMovementQueryFaction(value: string): boolean {
  if (Object.prototype.hasOwnProperty.call(MOVEMENT_QUERY_FACTIONS, value)) {
    return true;
  }
  if (!/^\d+$/.test(value)) {
    return false;
  }
  const factionId = Number(value);
  return Number.isInteger(factionId) && factionId >= 0 && factionId <= MAX_GAMEPLAY_FACTION_ID;
}

function optionalBoolean(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw behaviorRecipeDiagnosticError(path, "must be a boolean");
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw behaviorRecipeDiagnosticError(path, "must be a positive integer");
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw behaviorRecipeDiagnosticError(path, "must be a non-negative integer");
  }
  return value;
}

function nonNegativeU32(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw behaviorRecipeDiagnosticError(path, "must be a non-negative safe u32 integer");
  }
  return value;
}

function particlePresetId(value: unknown, path: string): number {
  const id = nonNegativeInteger(value, path);
  if (id >= MAX_PARTICLE_PRESETS) {
    throw behaviorRecipeDiagnosticError(path, `must be less than ${MAX_PARTICLE_PRESETS}`);
  }
  return id;
}

function positiveNumber(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number <= 0) {
    throw behaviorRecipeDiagnosticError(path, "must be greater than 0");
  }
  return number;
}

function nonNegativeNumber(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number < 0) {
    throw behaviorRecipeDiagnosticError(path, "must be greater than or equal to 0");
  }
  return number;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw behaviorRecipeDiagnosticError(path, "must be a finite number");
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
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
