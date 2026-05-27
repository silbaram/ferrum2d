import { behaviorRecipeDiagnosticError } from "./diagnostics.js";

export type BehaviorRecipeKind = "health" | "damage" | "pickup" | "chase" | "interaction";
export type BehaviorRecipeHealthZeroAction = "none" | "despawn" | "event";
export type BehaviorRecipeDamageTarget = "other" | "self";

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

export interface PickupBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "pickup";
  item: string;
  count?: number;
  despawn?: boolean;
}

export interface ChaseBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "chase";
  target?: string;
  speed?: number;
  stopDistance?: number;
  maxDistance?: number;
}

export interface InteractionBehaviorRecipeSpec extends BehaviorRecipeBaseSpec {
  kind: "interaction";
  action: string;
  radius?: number;
  prompt?: string;
  once?: boolean;
}

export type BehaviorRecipeSpec =
  | HealthBehaviorRecipeSpec
  | DamageBehaviorRecipeSpec
  | PickupBehaviorRecipeSpec
  | ChaseBehaviorRecipeSpec
  | InteractionBehaviorRecipeSpec;

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

export interface ResolvedPickupBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "pickup";
  item: string;
  count: number;
  despawn: boolean;
}

export interface ResolvedChaseBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "chase";
  target: string;
  speed: number;
  stopDistance: number;
  maxDistance?: number;
}

export interface ResolvedInteractionBehaviorRecipe extends ResolvedBehaviorRecipeBase {
  kind: "interaction";
  action: string;
  radius: number;
  prompt?: string;
  once: boolean;
}

export type ResolvedBehaviorRecipe =
  | ResolvedHealthBehaviorRecipe
  | ResolvedDamageBehaviorRecipe
  | ResolvedPickupBehaviorRecipe
  | ResolvedChaseBehaviorRecipe
  | ResolvedInteractionBehaviorRecipe;

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
  | ConfigureHealthBehaviorCommand
  | ConfigureDamageBehaviorCommand
  | ConfigurePickupBehaviorCommand
  | ConfigureChaseBehaviorCommand
  | ConfigureInteractionBehaviorCommand;

export interface BehaviorRecipeCommandBase {
  entity: string;
  recipe: string;
  tags: readonly string[];
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

export interface ConfigurePickupBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configurePickup";
  item: string;
  count: number;
  despawn: boolean;
}

export interface ConfigureChaseBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureChase";
  target: string;
  speed: number;
  stopDistance: number;
  maxDistance?: number;
}

export interface ConfigureInteractionBehaviorCommand extends BehaviorRecipeCommandBase {
  type: "configureInteraction";
  action: string;
  radius: number;
  prompt?: string;
  once: boolean;
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
  return entity.recipes
    .filter((recipe) => recipe.enabled && (kinds === undefined || kinds.has(recipe.kind)))
    .map((recipe) => commandForRecipe(entity.id, recipe));
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
    case "pickup":
      return {
        ...base,
        kind,
        item: requiredString(value.item, `${path}.item`),
        count: positiveInteger(value.count ?? 1, `${path}.count`),
        despawn: optionalBoolean(value.despawn, `${path}.despawn`, true),
      };
    case "chase":
      return {
        ...base,
        kind,
        target: optionalString(value.target, `${path}.target`, "player"),
        speed: positiveNumber(value.speed ?? 80, `${path}.speed`),
        stopDistance: nonNegativeNumber(value.stopDistance ?? 12, `${path}.stopDistance`),
        ...(value.maxDistance === undefined ? {} : { maxDistance: positiveNumber(value.maxDistance, `${path}.maxDistance`) }),
      };
    case "interaction":
      return {
        ...base,
        kind,
        action: requiredString(value.action, `${path}.action`),
        radius: positiveNumber(value.radius ?? 24, `${path}.radius`),
        ...(value.prompt === undefined ? {} : { prompt: requiredString(value.prompt, `${path}.prompt`) }),
        once: optionalBoolean(value.once, `${path}.once`, false),
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
    case "pickup":
      return {
        ...base,
        type: "configurePickup",
        item: recipe.item,
        count: recipe.count,
        despawn: recipe.despawn,
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
    case "interaction":
      return {
        ...base,
        type: "configureInteraction",
        action: recipe.action,
        radius: recipe.radius,
        ...(recipe.prompt === undefined ? {} : { prompt: recipe.prompt }),
        once: recipe.once,
      };
  }
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
  if (value === "health" || value === "damage" || value === "pickup" || value === "chase" || value === "interaction") {
    return value;
  }
  throw behaviorRecipeDiagnosticError(path, "must be one of health, damage, pickup, chase, or interaction");
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
