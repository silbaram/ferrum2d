import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  dispatchEffectEvents,
  effectDispatchesForEvents,
} from "../src/effectEventAdapters.js";
import type {
  EffectCustomEventDispatch,
  EffectEventDispatchTarget,
  EffectParticleEventDispatch,
  EffectSoundEventDispatch,
} from "../src/effectEventAdapters.js";
import type { EffectEventView } from "../src/effectEventDecoder.js";
import {
  GAMEPLAY_PRESENTATION_EFFECT_TYPE_CAMERA_SHAKE,
  GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
  GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE,
  GAMEPLAY_PRESENTATION_EFFECT_TYPE_SOUND,
} from "../src/gameplayEventDecoder.js";
import { resolvePresentationEffectRegistry } from "../src/presentationEffects.js";

test("dispatchEffectEvents routes sound events through registry payload overrides", () => {
  const registry = resolvePresentationEffectRegistry({
    impactSound: {
      effectId: 7,
      kind: "sound",
      soundId: 42,
      intensity: 0.75,
      radius: 18,
    },
  });
  const played: EffectSoundEventDispatch[] = [];

  const summary = dispatchEffectEvents([
    effectEvent({
      effectId: 7,
      effectType: GAMEPLAY_PRESENTATION_EFFECT_TYPE_SOUND,
      effectKind: "sound",
      intensity: 0.25,
      radius: 4,
      x: 12,
      y: -3,
    }),
  ], registry, {
    playSoundEffect: (dispatch) => played.push(dispatch),
  });

  deepEqual(summary, {
    totalEvents: 1,
    dispatches: 1,
    ignoredEvents: 0,
    missingHandlers: 0,
    soundEffects: 1,
    particleEffects: 0,
    cameraShakeEffects: 0,
    customEffects: 0,
  });
  equal(played[0]?.soundId, 42);
  equal(played[0]?.volume, 0.75);
  equal(played[0]?.radius, 18);
  equal(played[0]?.x, 12);
  equal(played[0]?.y, -3);
  equal(played[0]?.effect?.effect, "impactSound");
});

test("effectDispatchesForEvents keeps raw sound and particle ids with passthrough policy", () => {
  const registry = resolvePresentationEffectRegistry({});
  const dispatches = effectDispatchesForEvents([
    effectEvent({
      effectId: 9,
      effectType: GAMEPLAY_PRESENTATION_EFFECT_TYPE_SOUND,
      effectKind: "sound",
    }),
    effectEvent({
      effectId: 3,
      effectType: GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE,
      effectKind: "particle",
    }),
  ], registry);

  equal(dispatches.length, 2);
  equal(dispatches[0]?.kind, "sound");
  equal((dispatches[0] as EffectSoundEventDispatch | undefined)?.soundId, 9);
  equal(dispatches[1]?.kind, "particle");
  equal((dispatches[1] as EffectParticleEventDispatch | undefined)?.particlePresetId, 3);
});

test("dispatchEffectEvents routes camera shake and custom handlers", () => {
  const registry = resolvePresentationEffectRegistry({
    screenPulse: {
      effectId: 11,
      kind: "cameraShake",
      intensity: 0.4,
    },
    customSpark: {
      effectId: 12,
      kind: "custom",
      key: "spark-small",
    },
  });
  const calls: string[] = [];
  const custom: EffectCustomEventDispatch[] = [];
  const target: EffectEventDispatchTarget = {
    shakeCameraEffect: (dispatch) => calls.push(`shake:${dispatch.amplitude}`),
    applyCustomEffect: (dispatch) => {
      calls.push(`custom:${dispatch.key}`);
      custom.push(dispatch);
    },
  };

  const summary = dispatchEffectEvents([
    effectEvent({
      effectId: 11,
      effectType: GAMEPLAY_PRESENTATION_EFFECT_TYPE_CAMERA_SHAKE,
      effectKind: "cameraShake",
      intensity: 1,
    }),
    effectEvent({
      effectId: 12,
      effectType: GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
      effectKind: "custom",
    }),
  ], registry, target);

  deepEqual(calls, ["shake:0.4", "custom:spark-small"]);
  equal(summary.cameraShakeEffects, 1);
  equal(summary.customEffects, 1);
  equal(custom[0]?.effect?.effect, "customSpark");
});

test("effect event adapter policies report actionable diagnostics", () => {
  const registry = resolvePresentationEffectRegistry({
    particleImpact: {
      effectId: 5,
      kind: "particle",
    },
  });
  const sound = effectEvent({
    effectId: 5,
    effectType: GAMEPLAY_PRESENTATION_EFFECT_TYPE_SOUND,
    effectKind: "sound",
  });
  const unknown = effectEvent({
    effectId: 99,
    effectType: GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
    effectKind: "custom",
  });

  expectMessage(() => effectDispatchesForEvents([sound], registry), /path='effectEvents\.events\.0\.effectKind'/);
  expectMessage(() => effectDispatchesForEvents([unknown], registry, {
    unknownEffect: "error",
  }), /path='effectEvents\.events\.0\.effectId'/);
  deepEqual(effectDispatchesForEvents([unknown], registry, {
    unknownEffect: "ignore",
  }), []);

  const missingHandlerSummary = dispatchEffectEvents([unknown], registry, {}, {
    missingHandler: "ignore",
  });
  equal(missingHandlerSummary.missingHandlers, 1);
  equal(missingHandlerSummary.customEffects, 0);
  expectMessage(() => dispatchEffectEvents([unknown], registry, {}, {
    missingHandler: "error",
  }), /path='effectEvents\.events\.0\.handler'/);
});

function effectEvent(overrides: Partial<EffectEventView>): EffectEventView {
  return {
    effectId: 1,
    effectType: GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
    effectKind: "custom",
    actorId: 10,
    actorGeneration: 1,
    sourceId: 20,
    sourceGeneration: 2,
    x: 0,
    y: 0,
    intensity: 1,
    radius: 0,
    ...overrides,
  };
}

function expectMessage(fn: () => unknown, pattern: RegExp): void {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    if (!pattern.test(error.message)) {
      throw new Error(`Expected error message '${error.message}' to match ${pattern}`);
    }
    return;
  }
  throw new Error("Expected function to throw");
}
