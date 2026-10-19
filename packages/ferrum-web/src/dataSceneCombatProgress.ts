import {
  projectileProgressFrame,
  type DataSceneProjectileAnimationProgress,
  type DataSceneCombatVisualProgressSnapshot,
} from "./dataSceneProjectileVisualProgress.js";
import { projectileVisualsRequired } from "./dataSceneProjectilePrefabs.js";
import {
  validateSpawnProgress,
  spawnProgressValues,
  decodeSpawnProgress,
  type DataSceneCombatSpawnProgressSnapshot,
} from "./dataSceneSpawnProgress.js";
import { bindSceneBehaviorRecipes, type SceneBehaviorBindingPlan } from "./gameplayAuthoring.js";
import { finalCombatActions } from "./dataSceneCombatActions.js";
import {
  resolveSceneAuthoringDocument,
  type ResolvedSceneAuthoringDocument,
} from "./sceneAuthoringDocument.js";
import { resolveDataSceneInstanceComponents } from "./dataSceneComponents.js";
import type { DataSceneProgressSnapshot } from "./dataSceneProgress.js";
import type { PhysicsBodyHeightSpan } from "./engineTypes/physicsBodies.js";

/** A resumable checkpoint, not a deterministic simulation replay. Runtime handles never enter JSON. */
export interface DataSceneCombatActorSnapshot {
  readonly id: string;
  readonly pose: {
    readonly x: number;
    readonly y: number;
    readonly rotationRadians: number;
    readonly heightSpan: PhysicsBodyHeightSpan | null;
  } | null;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly angularVelocityRadiansPerSecond: number;
  readonly health: number | null;
  readonly lifetimeSeconds: number | null;
  readonly timer: {
    readonly timerId: number;
    readonly remainingSeconds: number;
    readonly fired: boolean;
  } | null;
  readonly actionCooldowns: readonly {
    readonly actionId: number;
    readonly remainingSeconds: number;
  }[];
  readonly reactionCooldowns: readonly number[];
}
export interface DataSceneCombatProjectileSnapshot {
  /** Combat progress v2 only: stable catalog name, never a GPU texture slot. */
  readonly prefab?: string;
  /** An authored instance ID, including a removed source. Texture identity is remapped on restore. */
  readonly sourceInstanceId: string;
  readonly x: number;
  readonly y: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly heightSpan: PhysicsBodyHeightSpan;
  readonly lifetimeSeconds: number;
  readonly damage: number;
  readonly collisionTarget: "enemies" | "player";
  readonly sprite: {
    readonly width: number;
    readonly height: number;
    readonly u0: number;
    readonly v0: number;
    readonly u1: number;
    readonly v1: number;
  };
  readonly collider: { readonly halfWidth: number; readonly halfHeight: number };
  readonly billboard: {
    readonly unitsPerPixel: number;
    readonly alphaCutoff: number;
    readonly elevation: number;
  };
  readonly faction: { readonly id: number; readonly damageMask: number } | null;
}
export type DataSceneCombatProgressSnapshot =
  | DataSceneCombatLegacyProgressSnapshot
  | DataSceneCombatSpawnProgressSnapshot
  | DataSceneCombatVisualProgressSnapshot;
export interface DataSceneCombatLegacyProgressSnapshot {
  readonly version: 1 | 2;
  /** Every live authored instance, including inert model markers. */
  readonly actors: readonly DataSceneCombatActorSnapshot[];
  readonly projectiles: readonly DataSceneCombatProjectileSnapshot[];
  /** Previous live authored contact pairs; preserves enter-only reaction semantics. */
  readonly contacts: readonly (readonly [string, string])[];
}

const ACTOR_STRIDE = 72,
  PROJECTILE_STRIDE = 25;
export function fail(message: string): never {
  throw new Error(`Data Scene combat progress ${message}`);
}
/** Optional raw hooks keep the facade usable with older generated Wasm declarations. */
export interface NativeCombatProgressRuntime {
  capture_data_scene_combat_progress?(epoch: number, handles: Uint32Array): Float64Array;
  preflight_data_scene_combat_progress?(states: Uint32Array, values: Float64Array): boolean;
  restore_data_scene_progress_with_combat?(
    epoch: number,
    handles: Uint32Array,
    states: Uint32Array,
    animations: Float64Array,
    spatial: Float64Array,
    environment: Float32Array,
    rotations: Float64Array,
    applyEnvironment: boolean,
    combat: Float64Array,
  ): boolean;
}
export function record(
  value: unknown,
  allowed: readonly string[],
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail(`${path} must be an object.`);
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => !allowed.includes(key)))
    fail(`${path} contains unsupported fields.`);
  return object;
}
export function f32(value: unknown, path: string, minimum = -Infinity, maximum = Infinity): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isFinite(Math.fround(value)) ||
    value < minimum ||
    value > maximum
  )
    return fail(`${path} must be a finite float32 within ${minimum}..${maximum}.`);
  return value;
}
export function integer(value: unknown, path: string, maximum = 0xffffffff, minimum = 0): number {
  const number = f32(value, path, minimum, maximum);
  if (!Number.isInteger(number)) fail(`${path} must be an integer.`);
  return number;
}
export function span(value: unknown, path: string): void {
  const object = record(value, ["floorId", "elevation", "height"], path);
  integer(object.floorId ?? 0, `${path}.floorId`);
  const elevation = f32(object.elevation, `${path}.elevation`),
    height = f32(object.height, `${path}.height`, 0);
  f32(Math.fround(elevation) + Math.fround(height), `${path}.top`);
}
export function array(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum)
    return fail(`${path} must be an array of at most ${maximum} records.`);
  return value;
}

// These are authoring upsert keys, not simulation: keep aligned with CollisionReactionSet.
export function actorContract(
  plan: SceneBehaviorBindingPlan,
  document: ResolvedSceneAuthoringDocument,
  id: string,
  initial = false,
) {
  let health: number | undefined, lifetime: number | undefined;
  let timer: { id: number; duration: number } | undefined;
  const actions = new Map<number, number>(),
    reactions = new Map<string, number>();
  for (const command of plan.commands) {
    if (command.entity !== id) continue;
    switch (command.type) {
      case "configureHealth":
        health = Math.fround(initial ? (command.current ?? command.max) : command.max);
        break;
      case "configureLifetime":
        lifetime = Math.fround(command.seconds);
        break;
      case "configureTimerTrigger":
        timer = {
          id: command.timerId ?? document.ids?.timers?.[command.timer] ?? 0,
          duration: Math.fround(command.seconds),
        };
        break;
      case "configureSpawnPrefabAction":
      case "configureDashAction":
      case "configureMeleeAction":
      case "configureProjectileAction":
        actions.set(
          command.actionId ?? document.ids?.actions?.[command.action] ?? 0,
          Math.fround(command.cooldownSeconds),
        );
        break;
      case "configureDamage":
        reactions.set(`damage:${command.target}`, 0);
        break;
      case "configureCollisionPickup":
        reactions.set(`pickup:${command.target}`, 0);
        break;
      case "configureCollisionDespawn":
        reactions.set(`despawn:${command.target}`, 0);
        break;
      case "configureCollisionAreaDamage":
        reactions.set(`area:${command.targetLayer}`, 0);
        break;
      case "configureCollisionKnockback":
        reactions.set(`knockback:${command.target}`, 0);
        break;
      case "configureCollisionSound":
        reactions.set(`sound:${command.soundId}`, Math.fround(command.cooldownSeconds ?? 0));
        break;
      case "configureCollisionParticle":
        reactions.set(
          `particle:${command.presetId}:${command.target}`,
          Math.fround(command.cooldownSeconds ?? 0),
        );
        break;
      case "configureCollisionEmitEffect":
        reactions.set(
          `effect:${command.effectId ?? document.ids?.effects?.[command.effect ?? ""] ?? 0}:${command.effectType}:${command.target}`,
          Math.fround(command.cooldownSeconds ?? 0),
        );
        break;
    }
  }
  return { health, lifetime, timer, actions, reactions: [...reactions.values()] };
}

/** Shared semantic actor validation; authoring data only, never a simulation step. */
export function validateCombatActorState(
  actor: Record<string, unknown>,
  path: string,
  component: Extract<ReturnType<typeof resolveDataSceneInstanceComponents>, { mode: "inline" }>,
  contract: ReturnType<typeof actorContract>,
  existingPose?: DataSceneProgressSnapshot["instances"][number]["spatialPose"],
): void {
  f32(actor.velocityX, `${path}.velocityX`);
  f32(actor.velocityY, `${path}.velocityY`);
  f32(actor.angularVelocityRadiansPerSecond, `${path}.angularVelocityRadiansPerSecond`);
  if (actor.pose !== null) {
    const pose = record(actor.pose, ["x", "y", "rotationRadians", "heightSpan"], `${path}.pose`);
    f32(pose.x, `${path}.pose.x`);
    f32(pose.y, `${path}.pose.y`);
    f32(pose.rotationRadians, `${path}.pose.rotationRadians`);
    if (pose.heightSpan !== null) {
      if (!component.body) fail(`${path}.pose.heightSpan requires an authored body.`);
      span(pose.heightSpan, `${path}.pose.heightSpan`);
    }
    const savedSpan = pose.heightSpan as PhysicsBodyHeightSpan | null; // span() above validated these exact fields.
    if (
      existingPose &&
      (pose.x !== existingPose.x ||
        pose.y !== existingPose.y ||
        (savedSpan === null) !== (existingPose.heightSpan === null) ||
        (savedSpan !== null &&
          existingPose.heightSpan !== null &&
          ((savedSpan.floorId ?? 0) !== (existingPose.heightSpan.floorId ?? 0) ||
            savedSpan.elevation !== existingPose.heightSpan.elevation ||
            savedSpan.height !== existingPose.heightSpan.height)))
    )
      fail(`${path}.pose conflicts with spatial progress.`);
  } else if (
    actor.velocityX !== 0 ||
    actor.velocityY !== 0 ||
    actor.angularVelocityRadiansPerSecond !== 0
  )
    fail(`${path} has velocity without a pose.`);
  if ((actor.health === null) !== (contract.health === undefined))
    fail(`${path}.health must match the authored component.`);
  if (actor.health !== null) {
    f32(actor.health, `${path}.health`, 0, contract.health);
    if (Math.fround(actor.health as number) <= 0) fail(`${path}.health must remain positive.`);
  }
  if ((actor.lifetimeSeconds === null) !== (contract.lifetime === undefined))
    fail(`${path}.lifetimeSeconds must match the authored component.`);
  if (actor.lifetimeSeconds !== null) {
    f32(actor.lifetimeSeconds, `${path}.lifetimeSeconds`, 0, contract.lifetime);
    if (Math.fround(actor.lifetimeSeconds as number) <= 0)
      fail(`${path}.lifetimeSeconds must remain positive.`);
  }
  if ((actor.timer === null) !== (contract.timer === undefined))
    fail(`${path}.timer must match the authored component.`);
  if (actor.timer !== null) {
    const timer = record(actor.timer, ["timerId", "remainingSeconds", "fired"], `${path}.timer`);
    if (timer.timerId !== contract.timer!.id || typeof timer.fired !== "boolean")
      fail(`${path}.timer has a mismatched timer ID or flag.`);
    f32(timer.remainingSeconds, `${path}.timer.remainingSeconds`, 0, contract.timer!.duration);
    if (timer.fired && timer.remainingSeconds !== 0)
      fail(`${path}.timer fired state must have zero remaining time.`);
  }
  const cooldowns = array(actor.actionCooldowns, `${path}.actionCooldowns`, 16),
    actionIds = new Set(contract.actions.keys());
  for (const value of cooldowns) {
    const action = record(value, ["actionId", "remainingSeconds"], `${path}.actionCooldowns`);
    const id = integer(action.actionId, `${path}.actionId`, 0xffffffff, 1);
    if (!actionIds.delete(id)) fail(`${path} references a duplicate or unknown action ID.`);
    f32(action.remainingSeconds, `${path}.actionCooldown`, 0, contract.actions.get(id));
  }
  if (actionIds.size) fail(`${path} is missing authored action cooldowns.`);
  const reactions = array(actor.reactionCooldowns, `${path}.reactionCooldowns`, 16);
  if (reactions.length !== contract.reactions.length)
    fail(`${path} reaction slots must match authored reactions.`);
  for (const [slot, value] of reactions.entries())
    f32(value, `${path}.reactionCooldowns.${slot}`, 0, contract.reactions[slot]);
}

/** Validate against the saved authoring contract before activation can replace a running scene. */
export function validateDataSceneCombatProgress(
  value: unknown,
  source: unknown,
  instances: DataSceneProgressSnapshot["instances"],
): asserts value is DataSceneCombatProgressSnapshot {
  if (
    value &&
    typeof value === "object" &&
    "version" in value &&
    (value.version === 3 || value.version === 4)
  ) {
    validateSpawnProgress(value, source, instances);
    return;
  }
  if (projectileVisualsRequired(resolveSceneAuthoringDocument(source).gameplay?.projectilePrefabs))
    fail("projectile animation/rotation requires version 4.");
  if (Object.keys(resolveSceneAuthoringDocument(source).gameplay?.spawnPrefabs ?? {}).length)
    fail("spawn prefabs require version 3.");
  validateLegacyCombatProgress(value, source, instances);
}
export function validateLegacyCombatProgress(
  value: unknown,
  source: unknown,
  instances: DataSceneProgressSnapshot["instances"],
  visualStates?: readonly (DataSceneProjectileAnimationProgress | null)[],
): asserts value is DataSceneCombatLegacyProgressSnapshot {
  const document = resolveSceneAuthoringDocument(source);
  if (document.gameplay?.combat !== true) fail("requires a combat authoring document.");
  const object = record(value, ["version", "actors", "projectiles", "contacts"], "snapshot");
  if (object.version !== 1 && object.version !== 2) fail("requires version 1 or 2.");
  if (Object.keys(document.gameplay.projectilePrefabs ?? {}).length && object.version !== 2)
    fail("projectile prefabs require version 2.");
  const actors = array(object.actors, "actors", 2048),
    projectiles = array(object.projectiles, "projectiles", 512),
    contacts = array(object.contacts, "contacts", 4096);
  const plan = bindSceneBehaviorRecipes(document.sceneComposition, document.behaviorRecipes);
  if (plan.instances.length > 2048 || actors.length + projectiles.length > 2048)
    fail("exceeds the native entity capacity.");
  const components = new Map(
    plan.instances.map((instance) => [instance.id, resolveDataSceneInstanceComponents(instance)]),
  );
  for (const component of components.values())
    if (component.mode !== "inline" || component.body?.type === "dynamic")
      fail("requires inline static/kinematic components, including removed instances.");
  const live = new Set(
      instances.filter((instance) => !instance.removed).map((instance) => instance.id),
    ),
    all = new Set(instances.map((instance) => instance.id));
  const remaining = new Set(live);
  for (const [index, value] of actors.entries()) {
    const path = `actors.${index}`,
      actor = record(
        value,
        [
          "id",
          "pose",
          "velocityX",
          "velocityY",
          "angularVelocityRadiansPerSecond",
          "health",
          "lifetimeSeconds",
          "timer",
          "actionCooldowns",
          "reactionCooldowns",
        ],
        path,
      );
    if (typeof actor.id !== "string" || !remaining.delete(actor.id))
      fail(`${path} references a duplicate, removed or unknown actor.`);
    const component = components.get(actor.id)!;
    if (component.mode !== "inline") fail(`${path} requires inline components.`);
    const child = Object.prototype.hasOwnProperty.call(
      document.spatial?.attachments ?? {},
      actor.id,
    );
    if ((actor.pose === null) !== child)
      fail(`${path}.pose must match the authored attachment relationship.`);
    const contract = actorContract(plan, document, actor.id);
    validateCombatActorState(
      actor,
      path,
      component,
      contract,
      instances.find((instance) => instance.id === actor.id)?.spatialPose,
    );
    const modelPose = instances.find((instance) => instance.id === actor.id)?.spatialPose;
    if (
      document.spatial?.models?.[actor.id] &&
      actor.pose !== null &&
      (actor.pose as DataSceneCombatActorSnapshot["pose"])!.rotationRadians !==
        (modelPose?.rotationRadians ?? 0)
    )
      fail(`${path}.pose conflicts with spatial model rotation.`);
  }
  if (remaining.size) fail("must contain every live authored instance.");
  for (const [index, value] of projectiles.entries()) {
    const path = `projectiles.${index}`,
      projectile = record(
        value,
        [
          "prefab",
          "sourceInstanceId",
          "x",
          "y",
          "velocityX",
          "velocityY",
          "heightSpan",
          "lifetimeSeconds",
          "damage",
          "collisionTarget",
          "sprite",
          "collider",
          "billboard",
          "faction",
        ],
        path,
      );
    if (typeof projectile.sourceInstanceId !== "string" || !all.has(projectile.sourceInstanceId))
      fail(`${path} references an unknown authored source.`);
    for (const key of ["x", "y", "velocityX", "velocityY"]) f32(projectile[key], `${path}.${key}`);
    span(projectile.heightSpan, `${path}.heightSpan`);
    for (const key of ["lifetimeSeconds", "damage"])
      if (Math.fround(f32(projectile[key], `${path}.${key}`, 0)) <= 0)
        fail(`${path}.${key} must remain positive.`);
    if (projectile.collisionTarget !== "enemies" && projectile.collisionTarget !== "player")
      fail(`${path}.collisionTarget is unsupported.`);
    const sprite = record(
      projectile.sprite,
      ["width", "height", "u0", "v0", "u1", "v1"],
      `${path}.sprite`,
    );
    if (projectile.prefab === undefined) {
      if (sprite.width !== 4 || sprite.height !== 4)
        fail(`${path}.sprite requires the canonical 4 by 4 projectile.`);
    } else {
      if (
        object.version !== 2 ||
        typeof projectile.prefab !== "string" ||
        !Object.prototype.hasOwnProperty.call(
          document.gameplay.projectilePrefabs ?? {},
          projectile.prefab,
        )
      )
        fail(`${path}.prefab must reference a version 2 projectile prefab.`);
      const prefabName = projectile.prefab as string; // string and catalog reference checked above.
      const prefab = document.gameplay.projectilePrefabs![prefabName];
      const sourceActions = new Map<number, string | undefined>();
      for (const command of finalCombatActions(plan.commands, document.ids))
        if (
          command.entity === projectile.sourceInstanceId &&
          command.type === "configureProjectileAction"
        )
          sourceActions.set(
            command.actionId ?? document.ids?.actions?.[command.action] ?? 0,
            command.projectilePrefab,
          );
      if (![...sourceActions.values()].includes(prefabName))
        fail(`${path}.prefab is not bound to its source.`);
      const same = (actual: unknown, expected: number | undefined) =>
        typeof actual === "number" &&
        expected !== undefined &&
        Math.fround(actual) === Math.fround(expected);
      const authored = prefab.sprite,
        expectedFrame = projectileProgressFrame(prefab, visualStates?.[index]);
      if (
        !same(sprite.width, authored.width) ||
        !same(sprite.height, authored.height) ||
        !["u0", "v0", "u1", "v1"].every((key) =>
          same(sprite[key], expectedFrame[key as "u0" | "v0" | "u1" | "v1"]),
        )
      )
        fail(`${path}.sprite does not match its prefab.`);
      const collider = record(projectile.collider, ["halfWidth", "halfHeight"], `${path}.collider`),
        billboard = record(
          projectile.billboard,
          ["unitsPerPixel", "alphaCutoff", "elevation"],
          `${path}.billboard`,
        );
      if (
        !same(collider.halfWidth, prefab.collider.halfWidth) ||
        !same(collider.halfHeight, prefab.collider.halfHeight) ||
        !same(billboard.unitsPerPixel, prefab.billboard!.unitsPerPixel) ||
        !same(billboard.alphaCutoff, prefab.billboard!.alphaCutoff)
      )
        fail(`${path} collider/billboard does not match its prefab.`);
    }
    for (const key of ["u0", "v0", "u1", "v1"]) f32(sprite[key], `${path}.sprite.${key}`, 0, 1);
    const collider = record(projectile.collider, ["halfWidth", "halfHeight"], `${path}.collider`);
    for (const key of ["halfWidth", "halfHeight"])
      if (Math.fround(f32(collider[key], `${path}.collider.${key}`, 0)) <= 0)
        fail(`${path}.collider.${key} must remain positive.`);
    const billboard = record(
      projectile.billboard,
      ["unitsPerPixel", "alphaCutoff", "elevation"],
      `${path}.billboard`,
    );
    if (Math.fround(f32(billboard.unitsPerPixel, `${path}.billboard.unitsPerPixel`, 0)) <= 0)
      fail(`${path}.billboard.unitsPerPixel must remain positive.`);
    f32(billboard.alphaCutoff, `${path}.billboard.alphaCutoff`, 0, 1);
    f32(billboard.elevation, `${path}.billboard.elevation`);
    if (projectile.faction !== null) {
      const faction = record(projectile.faction, ["id", "damageMask"], `${path}.faction`);
      integer(faction.id, `${path}.faction.id`, 31);
      integer(faction.damageMask, `${path}.faction.damageMask`);
    }
  }
  const pairs = new Set<string>();
  for (const pair of contacts) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== "string" ||
      typeof pair[1] !== "string" ||
      !live.has(pair[0]) ||
      !live.has(pair[1]) ||
      pair[0] === pair[1]
    )
      fail("contacts require two distinct live authored IDs.");
    const key = JSON.stringify([...pair].sort());
    if (pairs.has(key)) fail("contains duplicate contact pairs.");
    pairs.add(key);
  }
}

/** Serialization only: encode native v1 indices relative to the complete authored ID list. */
export function combatProgressValues(
  progress: DataSceneCombatProgressSnapshot,
  ids: readonly string[],
  prefabNames: readonly string[] = [],
  spawnPrefabs: ReadonlyMap<number, string> = new Map(),
): Float64Array {
  if (progress.version === 3 || progress.version === 4)
    return spawnProgressValues(progress, ids, prefabNames, spawnPrefabs);
  const projectileStride = progress.version === 2 ? PROJECTILE_STRIDE + 1 : PROJECTILE_STRIDE;
  const values = new Float64Array(
    4 +
      ids.length * ACTOR_STRIDE +
      progress.projectiles.length * projectileStride +
      progress.contacts.length * 2,
  );
  values.set([progress.version, ids.length, progress.projectiles.length, progress.contacts.length]);
  const indices = new Map(ids.map((id, index) => [id, index]));
  for (const actor of progress.actors) {
    const index = indices.get(actor.id);
    if (index === undefined) fail("actor ID is missing from the authored handle list.");
    const offset = 4 + index * ACTOR_STRIDE,
      pose = actor.pose,
      span = pose?.heightSpan;
    values.set(
      [
        1,
        +(pose !== null),
        pose?.x ?? 0,
        pose?.y ?? 0,
        pose?.rotationRadians ?? 0,
        actor.velocityX,
        actor.velocityY,
        actor.angularVelocityRadiansPerSecond,
        +(span != null),
        span?.floorId ?? 0,
        span?.elevation ?? 0,
        span?.height ?? 0,
        +(actor.health !== null),
        actor.health ?? 0,
        +(actor.lifetimeSeconds !== null),
        actor.lifetimeSeconds ?? 0,
        +(actor.timer !== null),
        actor.timer?.timerId ?? 0,
        actor.timer?.remainingSeconds ?? 0,
        +(actor.timer?.fired ?? false),
        actor.actionCooldowns.length,
        actor.reactionCooldowns.length,
        0,
        0,
      ],
      offset,
    );
    actor.actionCooldowns.forEach((action, slot) =>
      values.set([action.actionId, action.remainingSeconds], offset + 24 + slot * 2),
    );
    values.set(actor.reactionCooldowns, offset + 56);
  }
  let offset = 4 + ids.length * ACTOR_STRIDE;
  for (const projectile of progress.projectiles) {
    const source = indices.get(projectile.sourceInstanceId);
    if (source === undefined) fail("projectile source is missing from authored handles.");
    const p = projectile;
    values.set(
      [
        source,
        p.x,
        p.y,
        p.velocityX,
        p.velocityY,
        p.heightSpan.floorId ?? 0,
        p.heightSpan.elevation,
        p.heightSpan.height,
        p.lifetimeSeconds,
        p.damage,
        +(p.collisionTarget === "player"),
        p.sprite.width,
        p.sprite.height,
        p.sprite.u0,
        p.sprite.v0,
        p.sprite.u1,
        p.sprite.v1,
        p.collider.halfWidth,
        p.collider.halfHeight,
        p.billboard.unitsPerPixel,
        p.billboard.alphaCutoff,
        p.billboard.elevation,
        +(p.faction !== null),
        p.faction?.id ?? 0,
        p.faction?.damageMask ?? 0,
      ],
      offset,
    );
    if (progress.version === 2) {
      const prefabId = p.prefab === undefined ? 0 : prefabNames.indexOf(p.prefab) + 1;
      if (p.prefab !== undefined && prefabId === 0)
        fail("projectile prefab is missing from the authored catalog.");
      values[offset + PROJECTILE_STRIDE] = prefabId;
    }
    offset += projectileStride;
  }
  const pairs = progress.contacts
    .map(([a, b]) => [indices.get(a)!, indices.get(b)!].sort((a, b) => a - b))
    .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  for (const pair of pairs) {
    values.set(pair, offset);
    offset += 2;
  }
  return values;
}

export function decodeCombatProgress(
  values: Float64Array,
  ids: readonly string[],
  prefabNames: readonly string[] = [],
  spawnPrefabs: ReadonlyMap<number, string> = new Map(),
): DataSceneCombatProgressSnapshot {
  if (values[0] === 3 || values[0] === 4)
    return decodeSpawnProgress(values, ids, prefabNames, spawnPrefabs);
  const [version, count, projectiles, contacts] = values;
  const projectileStride = version === 2 ? PROJECTILE_STRIDE + 1 : PROJECTILE_STRIDE;
  if (
    (version !== 1 && version !== 2) ||
    count !== ids.length ||
    !Number.isInteger(projectiles) ||
    projectiles! < 0 ||
    projectiles! > 512 ||
    !Number.isInteger(contacts) ||
    contacts! < 0 ||
    contacts! > 4096 ||
    values.length !==
      4 + ids.length * ACTOR_STRIDE + projectiles! * projectileStride + contacts! * 2
  )
    fail("has an unsupported native codec layout.");
  const actors: DataSceneCombatActorSnapshot[] = [],
    shots: DataSceneCombatProjectileSnapshot[] = [],
    pairs: [string, string][] = [];
  for (let index = 0; index < ids.length; index++) {
    const a = values.subarray(4 + index * ACTOR_STRIDE, 4 + (index + 1) * ACTOR_STRIDE);
    if (![a[20], a[21]].every((count) => Number.isInteger(count) && count! >= 0 && count! <= 16))
      fail("native actor slot count is out of bounds.");
    if (a[0] === 0) continue;
    actors.push({
      id: ids[index]!,
      pose:
        a[1] === 0
          ? null
          : {
              x: a[2]!,
              y: a[3]!,
              rotationRadians: a[4]!,
              heightSpan: a[8] === 0 ? null : { floorId: a[9]!, elevation: a[10]!, height: a[11]! },
            },
      velocityX: a[5]!,
      velocityY: a[6]!,
      angularVelocityRadiansPerSecond: a[7]!,
      health: a[12] === 0 ? null : a[13]!,
      lifetimeSeconds: a[14] === 0 ? null : a[15]!,
      timer: a[16] === 0 ? null : { timerId: a[17]!, remainingSeconds: a[18]!, fired: a[19] === 1 },
      actionCooldowns: Array.from({ length: a[20]! }, (_, slot) => ({
        actionId: a[24 + slot * 2]!,
        remainingSeconds: a[25 + slot * 2]!,
      })),
      reactionCooldowns: Array.from(a.subarray(56, 56 + a[21]!)),
    });
  }
  let offset = 4 + ids.length * ACTOR_STRIDE;
  for (let index = 0; index < projectiles!; index++, offset += projectileStride) {
    const p = values.subarray(offset, offset + projectileStride),
      source = ids[p[0]!];
    if (source === undefined) fail("native projectile source is out of bounds.");
    const prefabId = version === 2 ? p[25]! : 0;
    if (!Number.isInteger(prefabId) || prefabId < 0 || prefabId > prefabNames.length)
      fail("native projectile prefab is out of bounds.");
    shots.push({
      ...(prefabId === 0 ? {} : { prefab: prefabNames[prefabId - 1]! }),
      sourceInstanceId: source,
      x: p[1]!,
      y: p[2]!,
      velocityX: p[3]!,
      velocityY: p[4]!,
      heightSpan: { floorId: p[5]!, elevation: p[6]!, height: p[7]! },
      lifetimeSeconds: p[8]!,
      damage: p[9]!,
      collisionTarget: p[10] === 0 ? "enemies" : "player",
      sprite: { width: p[11]!, height: p[12]!, u0: p[13]!, v0: p[14]!, u1: p[15]!, v1: p[16]! },
      collider: { halfWidth: p[17]!, halfHeight: p[18]! },
      billboard: { unitsPerPixel: p[19]!, alphaCutoff: p[20]!, elevation: p[21]! },
      faction: p[22] === 0 ? null : { id: p[23]!, damageMask: p[24]! },
    });
  }
  for (let index = 0; index < contacts!; index++, offset += 2) {
    const a = ids[values[offset]!],
      b = ids[values[offset + 1]!];
    if (a === undefined || b === undefined) fail("native contact index is out of bounds.");
    pairs.push([a, b]);
  }
  return { version, actors, projectiles: shots, contacts: pairs };
}

/** Stable sorted names form only the cold native ID table, never the persisted identity. */
export function combatProjectilePrefabNames(document: unknown): string[] {
  return Object.keys(
    resolveSceneAuthoringDocument(document).gameplay?.projectilePrefabs ?? {},
  ).sort();
}
