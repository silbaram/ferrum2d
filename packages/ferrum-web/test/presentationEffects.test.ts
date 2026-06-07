import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  bindPresentationEffectActions,
  resolvePresentationEffectRegistry,
} from "../src/presentationEffects.js";
import type { GameplayPresentationEffectEventAction } from "../src/gameplayEventActions.js";
import { GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM } from "../src/gameplayEventDecoder.js";

const presentationEffectAction: GameplayPresentationEffectEventAction = {
  type: "presentationEffect",
  actor: { entityId: 4, entityGeneration: 0 },
  source: { entityId: 1, entityGeneration: 0 },
  effectId: 42,
  effectType: GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
  effectKind: "custom",
  flags: 0,
  payloadBits: GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
  event: {
    kind: "presentationEffect",
    kindCode: 11,
    actorId: 4,
    actorGeneration: 0,
    sourceId: 1,
    sourceGeneration: 0,
    tokenId: 42,
    flags: 0,
    payloadBits: GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
    once: false,
    consumedThisFrame: false,
    targetRemoved: false,
  },
};

test("resolvePresentationEffectRegistry creates stable runtime ids and lookup entries", () => {
  const registry = resolvePresentationEffectRegistry({
    impactSpark: {
      effectId: 42,
      kind: "custom",
      key: "spark-small",
      intensity: 0.75,
      radius: 24,
      tags: ["impact", "projectile"],
    },
    pickupChime: {
      kind: "sound",
      soundId: 7,
    },
  }, {
    ids: {
      effects: { pickupChime: 77 },
    },
  });

  deepEqual(registry.ids.effects, {
    pickupChime: 77,
    impactSpark: 42,
  });
  deepEqual(registry.effects.impactSpark, {
    effect: "impactSpark",
    effectId: 42,
    kind: "custom",
    key: "spark-small",
    intensity: 0.75,
    radius: 24,
    tags: ["impact", "projectile"],
  });
  equal(registry.byId[77]?.effect, "pickupChime");
});

test("bindPresentationEffectActions maps presentation events to registry definitions", () => {
  const registry = resolvePresentationEffectRegistry({
    impactSpark: {
      effectId: 42,
      kind: "custom",
      key: "spark-small",
    },
  });

  const bindings = bindPresentationEffectActions([
    { type: "collisionDamage" } as never,
    presentationEffectAction,
  ], registry);

  equal(bindings.length, 1);
  equal(bindings[0]?.effect.effect, "impactSpark");
  equal(bindings[0]?.action, presentationEffectAction);
});

test("presentation effect registry reports actionable diagnostics", () => {
  expectMessage(() => resolvePresentationEffectRegistry({
    bad: { effectId: 0 },
  }), /path='presentationEffects\.bad\.effectId'/);

  expectMessage(() => resolvePresentationEffectRegistry({
    first: { effectId: 1 },
    second: { effectId: 1 },
  }), /path='presentationEffects\.second\.effectId'/);

  expectMessage(() => resolvePresentationEffectRegistry({
    impactSpark: { effectId: 8 },
  }, {
    ids: { effects: { impactSpark: 7 } },
  }), /path='presentationEffects\.impactSpark\.effectId'/);

  expectMessage(() => resolvePresentationEffectRegistry({
    sparkle: { kind: "flash" as "custom", effectId: 9 },
  }), /path='presentationEffects\.sparkle\.kind'/);

  const registry = resolvePresentationEffectRegistry({
    impactSpark: { effectId: 42, kind: "custom" },
  });

  expectMessage(() => bindPresentationEffectActions([{
    ...presentationEffectAction,
    effectId: 99,
  }], registry), /path='presentationEffects\.actions\.0\.effectId'/);

  const ignored = bindPresentationEffectActions([{
    ...presentationEffectAction,
    effectId: 99,
  }], registry, {
    unknownEffect: "ignore",
  });
  deepEqual(ignored, []);

  expectMessage(() => bindPresentationEffectActions([{
    ...presentationEffectAction,
    effectKind: "sound",
  }], registry), /path='presentationEffects\.actions\.0\.effectKind'/);
});

function expectMessage(fn: () => void, pattern: RegExp): void {
  try {
    fn();
  } catch (error) {
    equal(error instanceof Error, true);
    equal(pattern.test(error instanceof Error ? error.message : String(error)), true);
    return;
  }
  throw new Error("Expected function to throw.");
}
