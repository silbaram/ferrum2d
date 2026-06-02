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

export const GAMEPLAY_BEHAVIOR_BINDING_PROP = "behaviorRecipes" as const;

export type GameplayBehaviorBindingSpec = string | readonly string[];
export type MissingSceneBehaviorBinding = "ignore" | "error";
const GAMEPLAY_PICKUP_ITEM_SCORE = 1;
const MAX_PARTICLE_PRESETS = 256;
const MAX_GAMEPLAY_FACTION_ID = 31;
const GAMEPLAY_FACTION_CODES = Object.freeze({
  neutral: 0,
  player: 1,
  enemy: 2,
} as const);
type GameplayFactionReference = keyof typeof GAMEPLAY_FACTION_CODES | number;

export type GameplayEntityHandleMap =
  | Readonly<Record<string, GameplayEntityHandle>>
  | ReadonlyMap<string, GameplayEntityHandle>;

export interface GameplayBehaviorRuntimeIds {
  items?: Readonly<Record<string, number>>;
  actions?: Readonly<Record<string, number>>;
  prefabs?: Readonly<Record<string, number>>;
  timers?: Readonly<Record<string, number>>;
}

export interface ResolveGameplayBehaviorRuntimeIdsOptions {
  path?: string;
  requiredItems?: readonly string[];
  requiredActions?: readonly string[];
  requiredPrefabs?: readonly string[];
  requiredTimers?: readonly string[];
}

export interface GameplayEntityHandle {
  entityId: number;
  entityGeneration: number;
}

export interface GameplayBehaviorRuntimeEngine {
  gameplay_entity_exists?(entityId: number, entityGeneration: number): boolean;
  capture_gameplay_authoring_snapshot?(entityId: number, entityGeneration: number): boolean;
  restore_gameplay_authoring_snapshot?(entityId: number, entityGeneration: number): boolean;
  clear_gameplay_authoring_snapshot?(): void;
  set_gameplay_health(entityId: number, entityGeneration: number, current: number): boolean;
  clear_gameplay_health(entityId: number, entityGeneration: number): boolean;
  set_gameplay_damage(entityId: number, entityGeneration: number, amount: number): boolean;
  clear_gameplay_damage(entityId: number, entityGeneration: number): boolean;
  set_gameplay_damage_reaction?(entityId: number, entityGeneration: number, amount: number, target: number): boolean;
  set_gameplay_faction?(entityId: number, entityGeneration: number, factionId: number, damageMask: number): boolean;
  clear_gameplay_faction?(entityId: number, entityGeneration: number): boolean;
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
  clear_gameplay_actions?(entityId: number, entityGeneration: number): boolean;
  set_gameplay_movement_chase_player(entityId: number, entityGeneration: number, speed: number): boolean;
  set_gameplay_movement_chase_entity(
    entityId: number,
    entityGeneration: number,
    targetId: number,
    targetGeneration: number,
    speed: number,
  ): boolean;
  clear_gameplay_movement?(entityId: number, entityGeneration: number): boolean;
  clear_gameplay_collision_reactions?(entityId: number, entityGeneration: number): boolean;
  add_gameplay_collision_damage(entityId: number, entityGeneration: number, target: number): boolean;
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

export interface ApplyGameplayBehaviorCommandsOptions {
  path?: string;
  ids?: GameplayBehaviorRuntimeIds;
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
      for (const sourceCommand of behaviorRecipeCommandsForEntity(resolvedRecipes, behaviorEntity, { kinds: options.kinds })) {
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
  requireRuntimeIdNames(items, options.requiredItems ?? [], `${path}.items`);
  requireRuntimeIdNames(actions, options.requiredActions ?? [], `${path}.actions`);
  requireRuntimeIdNames(prefabs, options.requiredPrefabs ?? [], `${path}.prefabs`);
  requireRuntimeIdNames(timers, options.requiredTimers ?? [], `${path}.timers`);
  return {
    ...(Object.keys(items).length === 0 ? {} : { items }),
    ...(Object.keys(actions).length === 0 ? {} : { actions }),
    ...(Object.keys(prefabs).length === 0 ? {} : { prefabs }),
    ...(Object.keys(timers).length === 0 ? {} : { timers }),
  };
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
    case "configureHealth":
      assertSupportedHealthCommand(command, path);
      return requireApplied(
        engine.set_gameplay_health(handle.entityId, handle.entityGeneration, command.current),
        path,
        command,
      );
    case "configureDamage":
      assertSupportedDamageCommand(command, path);
      const setGameplayDamageReaction = engine.set_gameplay_damage_reaction;
      if (setGameplayDamageReaction === undefined) {
        throw gameplayAuthoringDiagnosticError(
          `${path}.type`,
          "runtime engine must provide set_gameplay_damage_reaction for configureDamage commands",
        );
      }
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
    case "configureFaction": {
      assertSupportedFactionCommand(command, path);
      const setGameplayFaction = engine.set_gameplay_faction;
      if (setGameplayFaction === undefined) {
        throw gameplayAuthoringDiagnosticError(
          `${path}.type`,
          "runtime engine must provide set_gameplay_faction for configureFaction commands",
        );
      }
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
    case "configureLifetime":
      assertSupportedLifetimeCommand(command, path);
      return requireApplied(
        engine.set_gameplay_lifetime(handle.entityId, handle.entityGeneration, command.seconds),
        path,
        command,
      );
    case "configureScoreReward":
      assertSupportedScoreRewardCommand(command, path);
      return requireApplied(
        engine.set_gameplay_score_reward(handle.entityId, handle.entityGeneration, command.reward),
        path,
        command,
      );
    case "configureChase":
      assertSupportedChaseCommand(command, path);
      if (command.target === "player") {
        return requireApplied(
          engine.set_gameplay_movement_chase_player(handle.entityId, handle.entityGeneration, command.speed),
          path,
          command,
        );
      }
      {
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
    case "configurePickup": {
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
    case "configureCollisionPickup": {
      assertSupportedCollisionPickupCommand(command, path);
      const addCollisionPickup = engine.add_gameplay_collision_pickup;
      if (addCollisionPickup === undefined) {
        throw gameplayAuthoringDiagnosticError(
          `${path}.type`,
          "runtime engine must provide add_gameplay_collision_pickup for configureCollisionPickup commands",
        );
      }
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
    case "configureCollisionSound": {
      assertSupportedCollisionSoundCommand(command, path);
      const cooldownSeconds = command.cooldownSeconds ?? 0;
      const replaceDefault = command.replaceDefault ?? false;
      const trigger = command.trigger ?? "contact";
      if (trigger === "enter") {
        const addCollisionSoundWithTrigger = engine.add_gameplay_collision_sound_with_trigger;
        if (addCollisionSoundWithTrigger === undefined) {
          throw gameplayAuthoringDiagnosticError(
            `${path}.type`,
            "runtime engine must provide add_gameplay_collision_sound_with_trigger for configureCollisionSound enter trigger commands",
          );
        }
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
        const addCollisionSoundWithPolicy = engine.add_gameplay_collision_sound_with_policy;
        if (addCollisionSoundWithPolicy === undefined) {
          throw gameplayAuthoringDiagnosticError(
            `${path}.type`,
            "runtime engine must provide add_gameplay_collision_sound_with_policy for configureCollisionSound replaceDefault commands",
          );
        }
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
        const addCollisionSoundWithCooldown = engine.add_gameplay_collision_sound_with_cooldown;
        if (addCollisionSoundWithCooldown === undefined) {
          throw gameplayAuthoringDiagnosticError(
            `${path}.type`,
            "runtime engine must provide add_gameplay_collision_sound_with_cooldown for configureCollisionSound cooldown commands",
          );
        }
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
      const addCollisionSound = engine.add_gameplay_collision_sound;
      if (addCollisionSound === undefined) {
        throw gameplayAuthoringDiagnosticError(
          `${path}.type`,
          "runtime engine must provide add_gameplay_collision_sound for configureCollisionSound commands",
        );
      }
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
    case "configureCollisionParticle": {
      assertSupportedCollisionParticleCommand(command, path);
      const cooldownSeconds = command.cooldownSeconds ?? 0;
      const replaceDefault = command.replaceDefault ?? false;
      const trigger = command.trigger ?? "contact";
      if (trigger === "enter") {
        const addCollisionParticleWithTrigger = engine.add_gameplay_collision_particle_with_trigger;
        if (addCollisionParticleWithTrigger === undefined) {
          throw gameplayAuthoringDiagnosticError(
            `${path}.type`,
            "runtime engine must provide add_gameplay_collision_particle_with_trigger for configureCollisionParticle enter trigger commands",
          );
        }
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
        const addCollisionParticleWithPolicy = engine.add_gameplay_collision_particle_with_policy;
        if (addCollisionParticleWithPolicy === undefined) {
          throw gameplayAuthoringDiagnosticError(
            `${path}.type`,
            "runtime engine must provide add_gameplay_collision_particle_with_policy for configureCollisionParticle replaceDefault commands",
          );
        }
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
        const addCollisionParticleWithCooldown = engine.add_gameplay_collision_particle_with_cooldown;
        if (addCollisionParticleWithCooldown === undefined) {
          throw gameplayAuthoringDiagnosticError(
            `${path}.type`,
            "runtime engine must provide add_gameplay_collision_particle_with_cooldown for configureCollisionParticle cooldown commands",
          );
        }
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
      const addCollisionParticle = engine.add_gameplay_collision_particle;
      if (addCollisionParticle === undefined) {
        throw gameplayAuthoringDiagnosticError(
          `${path}.type`,
          "runtime engine must provide add_gameplay_collision_particle for configureCollisionParticle commands",
        );
      }
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
    case "configureCollisionDespawn": {
      assertSupportedCollisionDespawnCommand(command, path);
      const addCollisionDespawn = engine.add_gameplay_collision_despawn;
      if (addCollisionDespawn === undefined) {
        throw gameplayAuthoringDiagnosticError(
          `${path}.type`,
          "runtime engine must provide add_gameplay_collision_despawn for configureCollisionDespawn commands",
        );
      }
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
    case "configureInteraction": {
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
    case "configureProjectileAction": {
      assertSupportedProjectileActionCommand(command, path);
      const actionId = projectileActionId(command, ids, path);
      const aimCode = dashActionAimCode(command.aim, `${path}.aim`);
      const collisionTargetCode = projectileCollisionTargetCode(command.collisionTarget, `${path}.collisionTarget`);
      const tileImpactCode = projectileTileImpactCode(command.tileImpact, `${path}.tileImpact`);
      if (aimCode !== 0 || collisionTargetCode !== 0 || tileImpactCode !== 0) {
        const setProjectileActionWithTarget = engine.set_gameplay_action_projectile_with_target;
        if (setProjectileActionWithTarget === undefined) {
          throw gameplayAuthoringDiagnosticError(
            `${path}.type`,
            "runtime engine must provide set_gameplay_action_projectile_with_target for targeted or non-default tileImpact configureProjectileAction commands",
          );
        }
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
            collisionTargetCode,
            tileImpactCode,
          ),
          path,
          command,
        );
      }
      const setProjectileAction = engine.set_gameplay_action_projectile;
      if (setProjectileAction === undefined) {
        throw gameplayAuthoringDiagnosticError(
          `${path}.type`,
          "runtime engine must provide set_gameplay_action_projectile for configureProjectileAction commands",
        );
      }
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
    case "configureDashAction": {
      assertSupportedDashActionCommand(command, path);
      const actionId = dashActionId(command, ids, path);
      const aimCode = dashActionAimCode(command.aim, `${path}.aim`);
      const setDashActionWithAim = engine.set_gameplay_action_dash_with_aim;
      const setDashAction = engine.set_gameplay_action_dash;
      if (aimCode !== 0) {
        if (setDashActionWithAim === undefined) {
          throw gameplayAuthoringDiagnosticError(
            `${path}.type`,
            "runtime engine must provide set_gameplay_action_dash_with_aim for non-input configureDashAction commands",
          );
        }
        return requireApplied(
          setDashActionWithAim.call(
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
      if (setDashAction === undefined) {
        throw gameplayAuthoringDiagnosticError(
          `${path}.type`,
          "runtime engine must provide set_gameplay_action_dash for configureDashAction commands",
        );
      }
      return requireApplied(
        setDashAction.call(
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
    case "configureMeleeAction": {
      assertSupportedMeleeActionCommand(command, path);
      const actionId = meleeActionId(command, ids, path);
      const targetCode = meleeTargetCode(command.target, `${path}.target`);
      if (targetCode === 0) {
        const setMeleeAction = engine.set_gameplay_action_melee;
        if (setMeleeAction === undefined) {
          throw gameplayAuthoringDiagnosticError(
            `${path}.type`,
            "runtime engine must provide set_gameplay_action_melee for configureMeleeAction commands",
          );
        }
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
      const setMeleeAction = engine.set_gameplay_action_melee_with_target;
      if (setMeleeAction === undefined) {
        throw gameplayAuthoringDiagnosticError(
          `${path}.type`,
          "runtime engine must provide set_gameplay_action_melee_with_target for targeted configureMeleeAction commands",
        );
      }
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
    case "configureSpawnPrefabAction": {
      assertSupportedSpawnPrefabActionCommand(command, path);
      const actionId = spawnPrefabActionId(command, ids, path);
      const prefabId = spawnPrefabId(command, ids, path);
      const setSpawnPrefabAction = engine.set_gameplay_action_spawn_prefab;
      if (setSpawnPrefabAction === undefined) {
        throw gameplayAuthoringDiagnosticError(
          `${path}.type`,
          "runtime engine must provide set_gameplay_action_spawn_prefab for configureSpawnPrefabAction commands",
        );
      }
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
    case "configureTimerTrigger": {
      assertSupportedTimerTriggerCommand(command, path);
      const timerId = timerTriggerId(command, ids, path);
      const actionId = timerTriggerActionId(command, ids, path);
      if (actionId !== undefined) {
        const setTimerActionTrigger = engine.set_gameplay_timer_action_trigger;
        if (setTimerActionTrigger === undefined) {
          throw gameplayAuthoringDiagnosticError(
            `${path}.type`,
            "runtime engine must provide set_gameplay_timer_action_trigger for timer-triggered action commands",
          );
        }
        return requireApplied(
          setTimerActionTrigger.call(engine, handle.entityId, handle.entityGeneration, timerId, command.seconds, actionId),
          path,
          command,
        );
      }
      const setTimerTrigger = engine.set_gameplay_timer_trigger;
      if (setTimerTrigger === undefined) {
        throw gameplayAuthoringDiagnosticError(
          `${path}.type`,
          "runtime engine must provide set_gameplay_timer_trigger for configureTimerTrigger commands",
        );
      }
      return requireApplied(
        setTimerTrigger.call(engine, handle.entityId, handle.entityGeneration, timerId, command.seconds),
        path,
        command,
      );
    }
  }
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

function requireApplied(applied: boolean, path: string, command: BehaviorRecipeCommand): boolean {
  if (!applied) {
    throw gameplayAuthoringDiagnosticError(path, `failed to apply '${command.type}' to entity '${command.entity}'`);
  }
  return true;
}

function collisionTargetCode(target: "self" | "other"): number {
  return target === "self" ? 0 : 1;
}

function gameplayFactionCode(faction: GameplayFactionReference, path: string): number {
  if (typeof faction === "number" && Number.isInteger(faction) && faction >= 0 && faction <= MAX_GAMEPLAY_FACTION_ID) {
    return faction;
  }
  if (typeof faction === "string") {
    const code = GAMEPLAY_FACTION_CODES[faction];
    if (code !== undefined) {
      return code;
    }
  }
  throw gameplayAuthoringDiagnosticError(path, "must be one of neutral, player, enemy, or an integer faction id between 0 and 31");
}

function gameplayFactionMask(factions: readonly GameplayFactionReference[], path: string): number {
  let mask = 0;
  for (let index = 0; index < factions.length; index += 1) {
    mask |= 1 << gameplayFactionCode(factions[index]!, `${path}.${index}`);
  }
  return mask >>> 0;
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
