import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  createEffectEventDispatchTarget,
  dispatchRuntimeEffectEvents,
} from "../src/effectEventRuntime.js";
import type {
  EffectCameraShakeEventDispatch,
  EffectCustomEventDispatch,
  EffectEventDispatchBase,
} from "../src/effectEventAdapters.js";
import type { EffectEventView } from "../src/effectEventDecoder.js";
import type { FrameState } from "../src/engineTypes.js";
import { resolvePresentationEffectRegistry } from "../src/presentationEffects.js";

test("createEffectEventDispatchTarget adapts sound, particle, camera shake, and custom effect handlers", () => {
  const audioEvents: unknown[] = [];
  const particleBursts: Array<{ presetId: number; x: number; y: number }> = [];
  const cameraShakes: EffectCameraShakeEventDispatch[] = [];
  const customEffects: EffectCustomEventDispatch[] = [];
  const target = createEffectEventDispatchTarget({
    assetHost: {
      playAudioEvents: (events) => {
        audioEvents.push(...events);
      },
    },
    spawnParticleBurst: (presetId, x, y) => {
      particleBursts.push({ presetId, x, y });
      return particleBursts.length;
    },
    shakeCameraEffect: (dispatch) => cameraShakes.push(dispatch),
    applyCustomEffect: (dispatch) => customEffects.push(dispatch),
  });
  const base = dispatchBase();

  target.playSoundEffect?.({
    ...base,
    kind: "sound",
    soundId: 7,
    volume: 0.5,
    pitch: 1.25,
  });
  target.spawnParticleEffect?.({
    ...base,
    kind: "particle",
    particlePresetId: 3,
  });
  target.shakeCameraEffect?.({
    ...base,
    kind: "cameraShake",
    amplitude: 2,
  });
  target.applyCustomEffect?.({
    ...base,
    kind: "custom",
    key: "impactSpark",
  });

  deepEqual(audioEvents, [{ soundId: 7, volume: 0.5, pitch: 1.25, channelId: 1 }]);
  deepEqual(particleBursts, [{ presetId: 3, x: 12, y: 16 }]);
  equal(cameraShakes[0]?.amplitude, 2);
  equal(customEffects[0]?.key, "impactSpark");
});

test("dispatchRuntimeEffectEvents dispatches frame effect events and reports the summary", () => {
  const registry = resolvePresentationEffectRegistry({
    impactBurst: {
      effectId: 99,
      kind: "particle",
      particlePresetId: 4,
    },
  });
  const event: EffectEventView = {
    effectId: 99,
    effectType: 2,
    effectKind: "particle",
    actorId: 1,
    actorGeneration: 0,
    sourceId: 2,
    sourceGeneration: 0,
    x: 20,
    y: 24,
    intensity: 1,
    radius: 0,
  };
  const frame = { effectEvents: [event] } as unknown as FrameState;
  const particleBursts: Array<{ presetId: number; x: number; y: number }> = [];
  let reportedDispatches = 0;

  const summary = dispatchRuntimeEffectEvents(frame, {
    registry,
    onDispatchSummary: (reported, reportedFrame) => {
      reportedDispatches = reported.dispatches;
      equal(reportedFrame, frame);
    },
  }, createEffectEventDispatchTarget({
    spawnParticleBurst: (presetId, x, y) => {
      particleBursts.push({ presetId, x, y });
      return particleBursts.length;
    },
  }));

  equal(summary.particleEffects, 1);
  equal(reportedDispatches, 1);
  deepEqual(particleBursts, [{ presetId: 4, x: 20, y: 24 }]);
});

test("createEffectEventDispatchTarget validates loaded sound and registered particle assets", () => {
  const target = createEffectEventDispatchTarget({
    assetValidation: "error",
    assetHost: {
      hasSound: (soundId) => soundId === 7,
      playAudioEvents: () => undefined,
    },
    hasParticlePreset: (presetId) => presetId === 3,
    spawnParticleBurst: () => 1,
  });
  const base = dispatchBase();

  target.playSoundEffect?.({
    ...base,
    kind: "sound",
    soundId: 7,
    volume: 1,
    pitch: 1,
  });
  target.spawnParticleEffect?.({
    ...base,
    kind: "particle",
    particlePresetId: 3,
  });

  let missingSoundError: unknown;
  try {
    target.playSoundEffect?.({
      ...base,
      kind: "sound",
      soundId: 8,
      volume: 1,
      pitch: 1,
    });
  } catch (error) {
    missingSoundError = error;
  }
  equal(
    missingSoundError instanceof Error ? missingSoundError.message : String(missingSoundError),
    "Invalid gameplay authoring data: kind=gameplay-authoring path='effectEvents.events.0.soundId' detail='must reference a loaded sound id 8'.",
  );

  let missingParticleError: unknown;
  try {
    target.spawnParticleEffect?.({
      ...base,
      kind: "particle",
      particlePresetId: 4,
    });
  } catch (error) {
    missingParticleError = error;
  }
  equal(
    missingParticleError instanceof Error ? missingParticleError.message : String(missingParticleError),
    "Invalid gameplay authoring data: kind=gameplay-authoring path='effectEvents.events.0.particlePresetId' detail='must reference a registered particle preset id 4'.",
  );
});

test("createEffectEventDispatchTarget reports missing validators when asset validation is enabled", () => {
  const target = createEffectEventDispatchTarget({
    assetValidation: "error",
    target: {
      playSoundEffect: () => undefined,
    },
  });

  try {
    target.playSoundEffect?.({
      ...dispatchBase(),
      kind: "sound",
      soundId: 7,
      volume: 1,
      pitch: 1,
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid gameplay authoring data: kind=gameplay-authoring path='effectEvents.events.0.soundId' detail='must provide hasSoundEffect or AssetHost.hasSound when effect asset validation is enabled'.",
    );
    return;
  }
  throw new Error("Expected missing sound validator to throw.");
});

function dispatchBase(): EffectEventDispatchBase {
  const event: EffectEventView = {
    effectId: 1,
    effectType: 1,
    effectKind: "sound",
    actorId: 1,
    actorGeneration: 0,
    sourceId: 2,
    sourceGeneration: 0,
    x: 12,
    y: 16,
    intensity: 1,
    radius: 0,
  };
  return {
    event,
    eventIndex: 0,
    effectId: 1,
    x: event.x,
    y: event.y,
    intensity: event.intensity,
    radius: event.radius,
  };
}
