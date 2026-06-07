import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  BYTES_PER_EFFECT_EVENT,
  decodeEffectEvents,
  EMPTY_EFFECT_EVENTS,
} from "../src/effectEventDecoder.js";
import { GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM } from "../src/gameplayEventDecoder.js";

test("decodeEffectEvents parses mixed u32/f32 presentation effect ABI", () => {
  const bytes = new ArrayBuffer(BYTES_PER_EFFECT_EVENT * 2);
  const view = new DataView(bytes);
  writeEffectEvent(view, 0, {
    effectId: 99,
    effectType: GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
    actorId: 13,
    actorGeneration: 2,
    sourceId: 7,
    sourceGeneration: 1,
    x: 12.5,
    y: -3,
    intensity: 0.75,
    radius: 32,
  });
  writeEffectEvent(view, BYTES_PER_EFFECT_EVENT, {
    effectId: 5,
    effectType: 99,
    actorId: 4,
    actorGeneration: 3,
    sourceId: 2,
    sourceGeneration: 1,
    x: 0,
    y: 1,
    intensity: 1,
    radius: 0,
  });

  deepEqual(decodeEffectEvents({
    buffer: view,
    eventCount: 2,
    bytesPerEvent: BYTES_PER_EFFECT_EVENT,
  }), [
    {
      effectId: 99,
      effectType: GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
      effectKind: "custom",
      actorId: 13,
      actorGeneration: 2,
      sourceId: 7,
      sourceGeneration: 1,
      x: 12.5,
      y: -3,
      intensity: 0.75,
      radius: 32,
    },
    {
      effectId: 5,
      effectType: 99,
      effectKind: "unknown",
      actorId: 4,
      actorGeneration: 3,
      sourceId: 2,
      sourceGeneration: 1,
      x: 0,
      y: 1,
      intensity: 1,
      radius: 0,
    },
  ]);
});

test("decodeEffectEvents reuses the frozen empty event list", () => {
  const decoded = decodeEffectEvents({
    buffer: new DataView(new ArrayBuffer(0)),
    eventCount: 0,
    bytesPerEvent: BYTES_PER_EFFECT_EVENT,
  });

  equal(decoded, EMPTY_EFFECT_EVENTS);
});

interface EffectEventFixture {
  effectId: number;
  effectType: number;
  actorId: number;
  actorGeneration: number;
  sourceId: number;
  sourceGeneration: number;
  x: number;
  y: number;
  intensity: number;
  radius: number;
}

function writeEffectEvent(view: DataView, offset: number, event: EffectEventFixture): void {
  view.setUint32(offset, event.effectId, true);
  view.setUint32(offset + 4, event.effectType, true);
  view.setUint32(offset + 8, event.actorId, true);
  view.setUint32(offset + 12, event.actorGeneration, true);
  view.setUint32(offset + 16, event.sourceId, true);
  view.setUint32(offset + 20, event.sourceGeneration, true);
  view.setFloat32(offset + 24, event.x, true);
  view.setFloat32(offset + 28, event.y, true);
  view.setFloat32(offset + 32, event.intensity, true);
  view.setFloat32(offset + 36, event.radius, true);
}
