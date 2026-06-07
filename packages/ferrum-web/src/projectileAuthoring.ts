import {
  type BehaviorRecipeEntitySpec,
  type ProjectileActionBehaviorRecipeSpec,
  type ResolvedBehaviorRecipeDocument,
  resolveBehaviorRecipeDocument,
} from "./behaviorRecipes.js";

export type ProjectileActionAim = "input" | "targetPlayer";
export type ProjectileCollisionTarget = "enemies" | "player";
export type ProjectileTileImpact = "despawn" | "passThrough" | "bounce";

export interface ProjectileDefinition {
  readonly id: string;
  readonly speed?: number;
  readonly damage?: number;
  readonly lifetimeSeconds?: number;
  readonly aim?: ProjectileActionAim;
  readonly collisionTarget?: ProjectileCollisionTarget;
  readonly tileImpact?: ProjectileTileImpact;
}

interface MutableProjectileDefinition {
  id: string;
  speed?: number;
  damage?: number;
  lifetimeSeconds?: number;
  aim?: ProjectileActionAim;
  collisionTarget?: ProjectileCollisionTarget;
  tileImpact?: ProjectileTileImpact;
}

export interface WeaponDefinition {
  readonly id: string;
  readonly action: string;
  readonly actionId?: number;
  readonly cooldownSeconds?: number;
  readonly projectile: ProjectileDefinition;
}

export interface WeaponDefinitionBuilder {
  readonly id: string;
  action(value: string): WeaponDefinitionBuilder;
  actionId(value: number): WeaponDefinitionBuilder;
  cooldown(value: number): WeaponDefinitionBuilder;
  fire(projectile: ProjectileDefinition | ProjectileDefinitionBuilder): WeaponDefinitionBuilder;
  build(): WeaponDefinition;
  toJSON(): WeaponDefinition;
}

export interface ProjectileDefinitionBuilder {
  readonly id: string;
  speed(value: number): ProjectileDefinitionBuilder;
  damage(value: number): ProjectileDefinitionBuilder;
  lifetime(value: number): ProjectileDefinitionBuilder;
  aim(value: ProjectileActionAim): ProjectileDefinitionBuilder;
  collisionTarget(value: ProjectileCollisionTarget): ProjectileDefinitionBuilder;
  tileImpact(value: ProjectileTileImpact): ProjectileDefinitionBuilder;
  build(): ProjectileDefinition;
  toJSON(): ProjectileDefinition;
}

export interface ProjectileAuthoringCompileOptions {
  path?: string;
  actionIds?: Record<string, number>;
}

interface WeaponBuilderState {
  id: string;
  action: string;
  actionId?: number;
  cooldownSeconds?: number;
  projectile?: ProjectileDefinition;
  hasFired: boolean;
}

export function projectile(id: string): ProjectileDefinitionBuilder {
  if (id.trim().length === 0) {
    throw new Error("projectile id must be a non-empty string");
  }
  const state: MutableProjectileDefinition = { id };

  const builder: ProjectileDefinitionBuilder = {
    id,
    speed(value: number) {
      return setPositiveProjectileField(value, `${id}.speed`, (next) => {
        state.speed = next;
        return builder;
      });
    },
    damage(value: number) {
      return setPositiveProjectileField(value, `${id}.damage`, (next) => {
        state.damage = next;
        return builder;
      });
    },
    lifetime(value: number) {
      return setPositiveProjectileField(value, `${id}.lifetime`, (next) => {
        state.lifetimeSeconds = next;
        return builder;
      });
    },
    aim(value: ProjectileActionAim) {
      state.aim = value;
      return builder;
    },
    collisionTarget(value: ProjectileCollisionTarget) {
      state.collisionTarget = value;
      return builder;
    },
    tileImpact(value: ProjectileTileImpact) {
      state.tileImpact = value;
      return builder;
    },
    build() {
      return toProjectileSpec(state);
    },
    toJSON() {
      return this.build();
    },
  };

  return builder;
}

export function weapon(id: string): WeaponDefinitionBuilder {
  if (id.trim().length === 0) {
    throw new Error("weapon id must be a non-empty string");
  }
  const state: WeaponBuilderState = {
    id,
    action: id,
    hasFired: false,
  };

  const builder: WeaponDefinitionBuilder = {
    id,
    action(value: string) {
      if (value.trim().length === 0) {
        throw new Error("weapon action must be a non-empty string");
      }
      state.action = value;
      return builder;
    },
    actionId(value: number) {
      ensurePositiveInteger(value, `${id}.actionId`, "actionId");
      state.actionId = value;
      return builder;
    },
    cooldown(value: number) {
      ensurePositiveNumber(value, `${id}.cooldown`, "cooldownSeconds");
      state.cooldownSeconds = value;
      return builder;
    },
    fire(projectileDef: ProjectileDefinition | ProjectileDefinitionBuilder) {
      state.projectile = resolveProjectileDefinition(projectileDef);
      state.hasFired = true;
      return builder;
    },
    build() {
      if (!state.hasFired || state.projectile === undefined) {
        throw new Error(`${id}.build: fire() must be called`);
      }
      return {
        id: state.id,
        action: state.action,
        ...(state.actionId === undefined ? {} : { actionId: state.actionId }),
        ...(state.cooldownSeconds === undefined ? {} : { cooldownSeconds: state.cooldownSeconds }),
        projectile: state.projectile,
      };
    },
    toJSON() {
      return this.build();
    },
  };

  return builder;
}

export function compileWeaponProfiles(
  weapons: readonly (WeaponDefinition | WeaponDefinitionBuilder)[],
  options: ProjectileAuthoringCompileOptions = {},
): ResolvedBehaviorRecipeDocument {
  const path = options.path ?? "projectileAuthoring";
  const actionIds = normalizeActionIdMap(options.actionIds, `${path}.actionIds`);
  const weaponIds = new Set<string>();
  const compiledWeapons = weapons.map((entry, index) => {
    const weapon = toWeaponDefinition(entry);
    const weaponPath = `${path}.weapons.${index}`;
    ensureWeaponConfigured(weapon, weaponPath);
    if (weaponIds.has(weapon.id)) {
      throw new Error(`${weaponPath}: duplicate weapon id '${weapon.id}'`);
    }
    weaponIds.add(weapon.id);
    return weapon;
  });

  const entities: Record<string, BehaviorRecipeEntitySpec> = {};
  compiledWeapons.forEach((compiledWeapon, weaponIndex) => {
    const recipe = compileWeaponAsRecipe(compiledWeapon, actionIds);
    entities[compiledWeapon.id] = {
      recipes: [recipe],
    };
  });

  return resolveBehaviorRecipeDocument({ entities }, { path });
}

function toWeaponDefinition(value: WeaponDefinition | WeaponDefinitionBuilder): WeaponDefinition {
  if (isWeaponBuilder(value)) {
    return value.build();
  }
  return value;
}

function resolveProjectileDefinition(
  projectile: ProjectileDefinition | ProjectileDefinitionBuilder,
): ProjectileDefinition {
  if (isProjectileBuilder(projectile)) {
    return projectile.build();
  }
  return projectile;
}

function compileWeaponAsRecipe(
  weapon: WeaponDefinition,
  actionIds: Record<string, number> | undefined,
): ProjectileActionBehaviorRecipeSpec {
  const actionId = weapon.actionId === undefined
    ? resolveWeaponActionIdFromMap(weapon.action, actionIds, weapon.id)
    : weapon.actionId;
  return {
    kind: "projectileAction",
    action: weapon.action,
    ...(actionId === undefined ? {} : { actionId }),
    cooldownSeconds: weapon.cooldownSeconds,
    speed: weapon.projectile.speed,
    damage: weapon.projectile.damage,
    lifetimeSeconds: weapon.projectile.lifetimeSeconds,
    aim: weapon.projectile.aim,
    collisionTarget: weapon.projectile.collisionTarget,
    tileImpact: weapon.projectile.tileImpact,
  };
}

function normalizeActionIdMap(
  actionIds: Record<string, number> | undefined,
  path: string,
): Record<string, number> | undefined {
  if (actionIds === undefined) {
    return undefined;
  }
  if (actionIds === null || typeof actionIds !== "object" || Array.isArray(actionIds)) {
    throw new Error(`${path}: actionIds must be a record of action name to positive integer`);
  }

  for (const [actionName, mappedActionId] of Object.entries(actionIds)) {
    if (!isNonEmptyString(actionName)) {
      throw new Error(`${path}: action names must be non-empty strings`);
    }
    if (!Number.isInteger(mappedActionId) || mappedActionId <= 0) {
      throw new Error(`${path}.${actionName}: action id must be a positive integer`);
    }
  }

  return actionIds;
}

function resolveWeaponActionIdFromMap(
  action: string,
  actionIds: Record<string, number> | undefined,
  weaponId: string,
): number | undefined {
  if (actionIds === undefined) {
    return undefined;
  }

  const actionId = actionIds[action];
  if (actionId === undefined) {
    throw new Error(`actionIds.${action}: missing action id for weapon '${weaponId}'`);
  }

  return actionId;
}

function toProjectileSpec(definition: ProjectileDefinition): ProjectileDefinition {
  return {
    id: definition.id,
    ...(definition.speed === undefined ? {} : { speed: definition.speed }),
    ...(definition.damage === undefined ? {} : { damage: definition.damage }),
    ...(definition.lifetimeSeconds === undefined ? {} : { lifetimeSeconds: definition.lifetimeSeconds }),
    ...(definition.aim === undefined ? {} : { aim: definition.aim }),
    ...(definition.collisionTarget === undefined ? {} : { collisionTarget: definition.collisionTarget }),
    ...(definition.tileImpact === undefined ? {} : { tileImpact: definition.tileImpact }),
  };
}

function isWeaponBuilder(value: unknown): value is WeaponDefinitionBuilder {
  return value !== null
    && typeof value === "object"
    && "build" in value
    && typeof value.build === "function"
    && "fire" in value
    && typeof value.fire === "function";
}

function isProjectileBuilder(value: unknown): value is ProjectileDefinitionBuilder {
  return value !== null
    && typeof value === "object"
    && "build" in value
    && typeof value.build === "function"
    && "speed" in value
    && typeof value.speed === "function";
}

function setPositiveProjectileField(
  value: number,
  path: string,
  set: (value: number) => ProjectileDefinitionBuilder,
): ProjectileDefinitionBuilder {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${path}: must be a positive finite number`);
  }
  return set(value);
}

function ensureWeaponConfigured(weapon: WeaponDefinition, path: string): void {
  if (!isNonEmptyString(weapon.id)) {
    throw new Error(`${path}.id: weapon id must be a non-empty string`);
  }
  if (!isNonEmptyString(weapon.action)) {
    throw new Error(`${path}.action: weapon action must be a non-empty string`);
  }
  if (weapon.projectile === undefined) {
    throw new Error(`${path}.projectile: fire() must be called`);
  }
  if (weapon.actionId !== undefined) {
    ensurePositiveInteger(weapon.actionId, `${path}.actionId`, "actionId");
  }
  if (weapon.cooldownSeconds !== undefined) {
    ensurePositiveNumber(weapon.cooldownSeconds, `${path}.cooldownSeconds`, "cooldownSeconds");
  }
  if (!isNonEmptyString(weapon.projectile.id)) {
    throw new Error(`${path}.projectile.id: projectile id must be a non-empty string`);
  }
}

function ensurePositiveNumber(value: number, fieldPath: string, fieldLabel: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldPath}: ${fieldLabel} must be a non-negative finite number`);
  }
}

function ensurePositiveInteger(value: number, fieldPath: string, fieldLabel: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldPath}: ${fieldLabel} must be a positive integer`);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
