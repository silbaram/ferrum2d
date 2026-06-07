import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import type { GameplayPresentationEffectEventAction, GameplayEventAction } from "./gameplayEventActions.js";
import type { GameplayPresentationEffectKind } from "./gameplayEventDecoder.js";
import type { GameplayBehaviorRuntimeIds } from "./gameplayAuthoring.js";

export type PresentationEffectKind = Exclude<GameplayPresentationEffectKind, "unknown">;
export type UnknownPresentationEffectPolicy = "error" | "ignore";

export interface PresentationEffectDefinitionSpec {
  effectId?: number;
  kind?: PresentationEffectKind;
  key?: string;
  soundId?: number;
  particlePresetId?: number;
  intensity?: number;
  radius?: number;
  tags?: readonly string[];
}

export type PresentationEffectRegistrySpec = Readonly<Record<string, PresentationEffectDefinitionSpec>>;

export interface ResolvedPresentationEffectDefinition {
  effect: string;
  effectId: number;
  kind: PresentationEffectKind;
  key?: string;
  soundId?: number;
  particlePresetId?: number;
  intensity?: number;
  radius?: number;
  tags: readonly string[];
}

export interface ResolvedPresentationEffectRegistry {
  effects: Readonly<Record<string, ResolvedPresentationEffectDefinition>>;
  byId: Readonly<Record<number, ResolvedPresentationEffectDefinition>>;
  ids: GameplayBehaviorRuntimeIds;
}

export interface ResolvePresentationEffectRegistryOptions {
  path?: string;
  ids?: GameplayBehaviorRuntimeIds;
}

export interface PresentationEffectActionBinding {
  action: GameplayPresentationEffectEventAction;
  effect: ResolvedPresentationEffectDefinition;
}

export interface PresentationEffectActionBindingOptions {
  path?: string;
  unknownEffect?: UnknownPresentationEffectPolicy;
  requireKindMatch?: boolean;
}

export function resolvePresentationEffectRegistry(
  value: unknown,
  options: ResolvePresentationEffectRegistryOptions = {},
): ResolvedPresentationEffectRegistry {
  const path = options.path ?? "presentationEffects";
  const raw = recordValue(value, path);
  const effects: Record<string, ResolvedPresentationEffectDefinition> = {};
  const byId: Record<number, ResolvedPresentationEffectDefinition> = {};
  const effectIds: Record<string, number> = {};

  for (const [effect, spec] of Object.entries(raw)) {
    const effectPath = `${path}.${effect}`;
    const name = nonEmptyString(effect, effectPath);
    const resolved = resolvePresentationEffectDefinition(name, spec, options.ids, effectPath);
    const existing = byId[resolved.effectId];
    if (existing !== undefined && existing.effect !== resolved.effect) {
      throw gameplayAuthoringDiagnosticError(
        `${effectPath}.effectId`,
        `conflicts with presentation effect '${existing.effect}' using runtime effect id ${resolved.effectId}`,
      );
    }
    effects[name] = resolved;
    byId[resolved.effectId] = resolved;
    effectIds[name] = resolved.effectId;
  }

  return {
    effects,
    byId,
    ids: {
      ...options.ids,
      effects: {
        ...(options.ids?.effects ?? {}),
        ...effectIds,
      },
    },
  };
}

export function bindPresentationEffectActions(
  actions: readonly GameplayEventAction[],
  registry: ResolvedPresentationEffectRegistry,
  options: PresentationEffectActionBindingOptions = {},
): readonly PresentationEffectActionBinding[] {
  const path = options.path ?? "presentationEffects";
  const unknownEffect = unknownPresentationEffectPolicy(options.unknownEffect ?? "error", `${path}.unknownEffect`);
  const requireKindMatch = options.requireKindMatch !== false;
  const bindings: PresentationEffectActionBinding[] = [];

  actions.forEach((action, index) => {
    if (action.type !== "presentationEffect") {
      return;
    }
    const actionPath = `${path}.actions.${index}`;
    const effect = registry.byId[action.effectId];
    if (effect === undefined) {
      if (unknownEffect === "error") {
        throw gameplayAuthoringDiagnosticError(
          `${actionPath}.effectId`,
          `must resolve runtime presentation effect id ${action.effectId}`,
        );
      }
      return;
    }
    if (requireKindMatch && action.effectKind !== "unknown" && action.effectKind !== effect.kind) {
      throw gameplayAuthoringDiagnosticError(
        `${actionPath}.effectKind`,
        `must match presentation effect '${effect.effect}' kind '${effect.kind}'`,
      );
    }
    bindings.push({ action, effect });
  });

  return bindings;
}

function resolvePresentationEffectDefinition(
  effect: string,
  value: unknown,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): ResolvedPresentationEffectDefinition {
  const spec = recordValue(value, path);
  const mappedEffectId = ids?.effects?.[effect];
  if (spec.effectId !== undefined && mappedEffectId !== undefined && spec.effectId !== mappedEffectId) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.effectId`,
      `conflicts with ids.effects mapping for presentation effect '${effect}'`,
    );
  }
  const effectId = spec.effectId === undefined ? ids?.effects?.[effect] : spec.effectId;
  if (effectId === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.effectId`, `must declare effectId or ids.effects mapping for presentation effect '${effect}'`);
  }
  const kind = presentationEffectKind(spec.kind ?? "custom", `${path}.kind`);
  return {
    effect,
    effectId: positiveU32(effectId, `${path}.effectId`),
    kind,
    ...(spec.key === undefined ? {} : { key: nonEmptyString(spec.key, `${path}.key`) }),
    ...(spec.soundId === undefined ? {} : { soundId: nonNegativeInteger(spec.soundId, `${path}.soundId`) }),
    ...(spec.particlePresetId === undefined ? {} : { particlePresetId: nonNegativeInteger(spec.particlePresetId, `${path}.particlePresetId`) }),
    ...(spec.intensity === undefined ? {} : { intensity: nonNegativeFiniteNumber(spec.intensity, `${path}.intensity`) }),
    ...(spec.radius === undefined ? {} : { radius: nonNegativeFiniteNumber(spec.radius, `${path}.radius`) }),
    tags: stringArray(spec.tags ?? [], `${path}.tags`),
  };
}

function presentationEffectKind(value: unknown, path: string): PresentationEffectKind {
  if (value === "sound" || value === "particle" || value === "cameraShake" || value === "custom") {
    return value;
  }
  throw gameplayAuthoringDiagnosticError(path, "must be one of sound, particle, cameraShake, or custom");
}

function unknownPresentationEffectPolicy(value: unknown, path: string): UnknownPresentationEffectPolicy {
  if (value === "error" || value === "ignore") {
    return value;
  }
  throw gameplayAuthoringDiagnosticError(path, "must be one of error or ignore");
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an array");
  }
  return value.map((entry, index) => nonEmptyString(entry, `${path}.${index}`));
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-empty string");
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-negative integer");
  }
  return value;
}

function nonNegativeFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-negative finite number");
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  }
  return value as Record<string, unknown>;
}
