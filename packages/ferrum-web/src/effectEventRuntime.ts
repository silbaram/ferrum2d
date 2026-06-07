import { AUDIO_CHANNEL_SFX } from "./audioEventDecoder.js";
import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import { dispatchEffectEvents } from "./effectEventAdapters.js";
import type {
  EffectCameraShakeEventDispatch,
  EffectCustomEventDispatch,
  EffectParticleEventDispatch,
  EffectSoundEventDispatch,
  EffectEventDispatchOptions,
  EffectEventDispatchSummary,
  EffectEventDispatchTarget,
} from "./effectEventAdapters.js";
import type { AssetHost, FrameState } from "./engineTypes/frame.js";
import type { ResolvedPresentationEffectRegistry } from "./presentationEffects.js";

export type EffectEventAssetValidationPolicy = "ignore" | "error";

export interface EffectEventDispatchTargetFactoryOptions {
  path?: string;
  assetValidation?: EffectEventAssetValidationPolicy;
  assetHost?: Pick<AssetHost, "playAudioEvents" | "hasSound">;
  hasSoundEffect?: (soundId: number) => boolean;
  hasParticlePreset?: (presetId: number) => boolean;
  spawnParticleBurst?: (presetId: number, x: number, y: number) => number;
  shakeCameraEffect?: (dispatch: EffectCameraShakeEventDispatch) => void;
  applyCustomEffect?: (dispatch: EffectCustomEventDispatch) => void;
  target?: EffectEventDispatchTarget;
}

export interface EffectEventRuntimeOptions extends EffectEventDispatchOptions {
  registry: ResolvedPresentationEffectRegistry;
  assetValidation?: EffectEventAssetValidationPolicy;
  hasSoundEffect?: (soundId: number) => boolean;
  hasParticlePreset?: (presetId: number) => boolean;
  target?: EffectEventDispatchTarget;
  shakeCameraEffect?: (dispatch: EffectCameraShakeEventDispatch) => void;
  applyCustomEffect?: (dispatch: EffectCustomEventDispatch) => void;
  onDispatchSummary?: (summary: EffectEventDispatchSummary, frame: FrameState) => void;
}

export function createEffectEventDispatchTarget(
  options: EffectEventDispatchTargetFactoryOptions = {},
): EffectEventDispatchTarget {
  const path = options.path ?? "effectEvents";
  const assetValidation = effectEventAssetValidationPolicy(options.assetValidation ?? "ignore", `${path}.assetValidation`);
  const soundExists = options.hasSoundEffect ?? options.assetHost?.hasSound;
  const particlePresetExists = options.hasParticlePreset;
  const target: EffectEventDispatchTarget = { ...(options.target ?? {}) };

  if (target.playSoundEffect !== undefined) {
    const playSoundEffect = target.playSoundEffect;
    target.playSoundEffect = (dispatch) => {
      validateSoundEffect(dispatch, soundExists, assetValidation, path);
      playSoundEffect(dispatch);
    };
  } else if (options.assetHost?.playAudioEvents !== undefined) {
    const assetHost = options.assetHost;
    target.playSoundEffect = (dispatch) => {
      validateSoundEffect(dispatch, soundExists, assetValidation, path);
      assetHost.playAudioEvents?.([{
        soundId: dispatch.soundId,
        volume: dispatch.volume,
        pitch: dispatch.pitch,
        channelId: AUDIO_CHANNEL_SFX,
      }]);
    };
  }

  if (target.spawnParticleEffect !== undefined) {
    const spawnParticleEffect = target.spawnParticleEffect;
    target.spawnParticleEffect = (dispatch) => {
      validateParticlePreset(dispatch, particlePresetExists, assetValidation, path);
      spawnParticleEffect(dispatch);
    };
  } else if (options.spawnParticleBurst !== undefined) {
    const spawnParticleBurst = options.spawnParticleBurst;
    target.spawnParticleEffect = (dispatch) => {
      validateParticlePreset(dispatch, particlePresetExists, assetValidation, path);
      spawnParticleBurst(dispatch.particlePresetId, dispatch.x, dispatch.y);
    };
  }

  if (target.shakeCameraEffect === undefined && options.shakeCameraEffect !== undefined) {
    target.shakeCameraEffect = options.shakeCameraEffect;
  }

  if (target.applyCustomEffect === undefined && options.applyCustomEffect !== undefined) {
    target.applyCustomEffect = options.applyCustomEffect;
  }

  return target;
}

export function dispatchRuntimeEffectEvents(
  frame: FrameState,
  runtime: EffectEventRuntimeOptions,
  target: EffectEventDispatchTarget,
): EffectEventDispatchSummary {
  const summary = dispatchEffectEvents(frame.effectEvents, runtime.registry, target, runtime);
  runtime.onDispatchSummary?.(summary, frame);
  return summary;
}

function validateSoundEffect(
  dispatch: EffectSoundEventDispatch,
  soundExists: ((soundId: number) => boolean) | undefined,
  policy: EffectEventAssetValidationPolicy,
  path: string,
): void {
  if (policy === "ignore") {
    return;
  }
  if (soundExists === undefined) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.events.${dispatch.eventIndex}.soundId`,
      "must provide hasSoundEffect or AssetHost.hasSound when effect asset validation is enabled",
    );
  }
  if (!soundExists(dispatch.soundId)) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.events.${dispatch.eventIndex}.soundId`,
      `must reference a loaded sound id ${dispatch.soundId}`,
    );
  }
}

function validateParticlePreset(
  dispatch: EffectParticleEventDispatch,
  particlePresetExists: ((presetId: number) => boolean) | undefined,
  policy: EffectEventAssetValidationPolicy,
  path: string,
): void {
  if (policy === "ignore") {
    return;
  }
  if (particlePresetExists === undefined) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.events.${dispatch.eventIndex}.particlePresetId`,
      "must provide hasParticlePreset when effect asset validation is enabled",
    );
  }
  if (!particlePresetExists(dispatch.particlePresetId)) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.events.${dispatch.eventIndex}.particlePresetId`,
      `must reference a registered particle preset id ${dispatch.particlePresetId}`,
    );
  }
}

function effectEventAssetValidationPolicy(
  value: unknown,
  path: string,
): EffectEventAssetValidationPolicy {
  if (value === "ignore" || value === "error") {
    return value;
  }
  throw gameplayAuthoringDiagnosticError(path, "must be one of ignore or error");
}
