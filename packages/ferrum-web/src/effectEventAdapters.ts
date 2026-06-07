import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import type { EffectEventView } from "./effectEventDecoder.js";
import type { PresentationEffectKind, ResolvedPresentationEffectDefinition, ResolvedPresentationEffectRegistry } from "./presentationEffects.js";

export type UnknownEffectEventPolicy = "error" | "ignore" | "passthrough";
export type MissingEffectEventHandlerPolicy = "ignore" | "error";

export interface EffectEventDispatchBase {
  event: EffectEventView;
  eventIndex: number;
  effect?: ResolvedPresentationEffectDefinition;
  effectId: number;
  x: number;
  y: number;
  intensity: number;
  radius: number;
}

export interface EffectSoundEventDispatch extends EffectEventDispatchBase {
  kind: "sound";
  soundId: number;
  volume: number;
  pitch: number;
}

export interface EffectParticleEventDispatch extends EffectEventDispatchBase {
  kind: "particle";
  particlePresetId: number;
}

export interface EffectCameraShakeEventDispatch extends EffectEventDispatchBase {
  kind: "cameraShake";
  amplitude: number;
}

export interface EffectCustomEventDispatch extends EffectEventDispatchBase {
  kind: "custom";
  key?: string;
}

export type EffectEventDispatch =
  | EffectSoundEventDispatch
  | EffectParticleEventDispatch
  | EffectCameraShakeEventDispatch
  | EffectCustomEventDispatch;

export interface EffectEventDispatchOptions {
  path?: string;
  unknownEffect?: UnknownEffectEventPolicy;
  requireKindMatch?: boolean;
  missingHandler?: MissingEffectEventHandlerPolicy;
}

export interface EffectEventDispatchTarget {
  playSoundEffect?(dispatch: EffectSoundEventDispatch): void;
  spawnParticleEffect?(dispatch: EffectParticleEventDispatch): void;
  shakeCameraEffect?(dispatch: EffectCameraShakeEventDispatch): void;
  applyCustomEffect?(dispatch: EffectCustomEventDispatch): void;
}

export interface EffectEventDispatchSummary {
  totalEvents: number;
  dispatches: number;
  ignoredEvents: number;
  missingHandlers: number;
  soundEffects: number;
  particleEffects: number;
  cameraShakeEffects: number;
  customEffects: number;
}

export function effectDispatchesForEvents(
  events: readonly EffectEventView[],
  registry: ResolvedPresentationEffectRegistry,
  options: EffectEventDispatchOptions = {},
): readonly EffectEventDispatch[] {
  const path = options.path ?? "effectEvents";
  const unknownEffect = unknownEffectEventPolicy(options.unknownEffect ?? "passthrough", `${path}.unknownEffect`);
  const requireKindMatch = options.requireKindMatch !== false;
  const dispatches: EffectEventDispatch[] = [];

  events.forEach((event, eventIndex) => {
    const eventPath = `${path}.events.${eventIndex}`;
    const effect = registry.byId[event.effectId];
    if (effect === undefined && unknownEffect === "error") {
      throw gameplayAuthoringDiagnosticError(
        `${eventPath}.effectId`,
        `must resolve runtime presentation effect id ${event.effectId}`,
      );
    }
    if (effect === undefined && unknownEffect === "ignore") {
      return;
    }
    if (effect !== undefined && requireKindMatch && event.effectKind !== "unknown" && event.effectKind !== effect.kind) {
      throw gameplayAuthoringDiagnosticError(
        `${eventPath}.effectKind`,
        `must match presentation effect '${effect.effect}' kind '${effect.kind}'`,
      );
    }
    dispatches.push(effectDispatchForEvent(event, eventIndex, effect, eventPath));
  });

  return dispatches;
}

export function dispatchEffectEvents(
  events: readonly EffectEventView[],
  registry: ResolvedPresentationEffectRegistry,
  target: EffectEventDispatchTarget,
  options: EffectEventDispatchOptions = {},
): EffectEventDispatchSummary {
  const path = options.path ?? "effectEvents";
  const missingHandler = missingEffectEventHandlerPolicy(options.missingHandler ?? "ignore", `${path}.missingHandler`);
  const dispatches = effectDispatchesForEvents(events, registry, options);
  const summary: MutableEffectEventDispatchSummary = {
    totalEvents: events.length,
    dispatches: dispatches.length,
    ignoredEvents: events.length - dispatches.length,
    missingHandlers: 0,
    soundEffects: 0,
    particleEffects: 0,
    cameraShakeEffects: 0,
    customEffects: 0,
  };

  for (const dispatch of dispatches) {
    if (dispatch.kind === "sound") {
      if (target.playSoundEffect === undefined) {
        handleMissingHandler(dispatch, "playSoundEffect", missingHandler, summary, path);
      } else {
        target.playSoundEffect(dispatch);
        summary.soundEffects += 1;
      }
      continue;
    }
    if (dispatch.kind === "particle") {
      if (target.spawnParticleEffect === undefined) {
        handleMissingHandler(dispatch, "spawnParticleEffect", missingHandler, summary, path);
      } else {
        target.spawnParticleEffect(dispatch);
        summary.particleEffects += 1;
      }
      continue;
    }
    if (dispatch.kind === "cameraShake") {
      if (target.shakeCameraEffect === undefined) {
        handleMissingHandler(dispatch, "shakeCameraEffect", missingHandler, summary, path);
      } else {
        target.shakeCameraEffect(dispatch);
        summary.cameraShakeEffects += 1;
      }
      continue;
    }
    if (target.applyCustomEffect === undefined) {
      handleMissingHandler(dispatch, "applyCustomEffect", missingHandler, summary, path);
    } else {
      target.applyCustomEffect(dispatch);
      summary.customEffects += 1;
    }
  }

  return summary;
}

type MutableEffectEventDispatchSummary = {
  -readonly [K in keyof EffectEventDispatchSummary]: EffectEventDispatchSummary[K];
};

function effectDispatchForEvent(
  event: EffectEventView,
  eventIndex: number,
  effect: ResolvedPresentationEffectDefinition | undefined,
  path: string,
): EffectEventDispatch {
  const kind = effect?.kind ?? knownEffectEventKind(event.effectKind, `${path}.effectKind`);
  const base: EffectEventDispatchBase = {
    event,
    eventIndex,
    ...(effect === undefined ? {} : { effect }),
    effectId: event.effectId,
    x: finiteNumber(event.x, `${path}.x`),
    y: finiteNumber(event.y, `${path}.y`),
    intensity: nonNegativeFiniteNumber(effect?.intensity ?? event.intensity, `${path}.intensity`),
    radius: nonNegativeFiniteNumber(effect?.radius ?? event.radius, `${path}.radius`),
  };

  if (kind === "sound") {
    return {
      ...base,
      kind,
      soundId: positiveSafeInteger(effect?.soundId ?? event.effectId, `${path}.soundId`),
      volume: base.intensity,
      pitch: 1,
    };
  }
  if (kind === "particle") {
    return {
      ...base,
      kind,
      particlePresetId: nonNegativeSafeInteger(effect?.particlePresetId ?? event.effectId, `${path}.particlePresetId`),
    };
  }
  if (kind === "cameraShake") {
    return {
      ...base,
      kind,
      amplitude: base.intensity,
    };
  }
  return {
    ...base,
    kind,
    ...(effect?.key === undefined ? {} : { key: effect.key }),
  };
}

function handleMissingHandler(
  dispatch: EffectEventDispatch,
  handler: keyof EffectEventDispatchTarget,
  policy: MissingEffectEventHandlerPolicy,
  summary: MutableEffectEventDispatchSummary,
  path: string,
): void {
  summary.missingHandlers += 1;
  if (policy === "error") {
    throw gameplayAuthoringDiagnosticError(
      `${path}.events.${dispatch.eventIndex}.handler`,
      `must provide ${handler} for ${dispatch.kind} effect events`,
    );
  }
}

function knownEffectEventKind(value: string, path: string): PresentationEffectKind {
  if (value === "sound" || value === "particle" || value === "cameraShake" || value === "custom") {
    return value;
  }
  throw gameplayAuthoringDiagnosticError(path, "must be one of sound, particle, cameraShake, or custom");
}

function unknownEffectEventPolicy(value: unknown, path: string): UnknownEffectEventPolicy {
  if (value === "error" || value === "ignore" || value === "passthrough") {
    return value;
  }
  throw gameplayAuthoringDiagnosticError(path, "must be one of error, ignore, or passthrough");
}

function missingEffectEventHandlerPolicy(value: unknown, path: string): MissingEffectEventHandlerPolicy {
  if (value === "ignore" || value === "error") {
    return value;
  }
  throw gameplayAuthoringDiagnosticError(path, "must be one of ignore or error");
}

function finiteNumber(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be a finite number");
  }
  return value;
}

function nonNegativeFiniteNumber(value: number, path: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-negative finite number");
  }
  return value;
}

function positiveSafeInteger(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a positive safe integer");
  }
  return value;
}

function nonNegativeSafeInteger(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-negative safe integer");
  }
  return value;
}
