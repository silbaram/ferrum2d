import { gameplayPresentationEffectKind } from "./gameplayEventDecoder.js";
import type { GameplayPresentationEffectKind } from "./gameplayEventDecoder.js";

export const BYTES_PER_EFFECT_EVENT = 40;

export interface EffectEventView {
  effectId: number;
  effectType: number;
  effectKind: GameplayPresentationEffectKind;
  actorId: number;
  actorGeneration: number;
  sourceId: number;
  sourceGeneration: number;
  x: number;
  y: number;
  intensity: number;
  radius: number;
}

export interface EffectEventBufferView {
  buffer: DataView;
  eventCount: number;
  bytesPerEvent: number;
}

export const EMPTY_EFFECT_EVENTS: readonly EffectEventView[] = Object.freeze([]);

export function decodeEffectEvents(view: EffectEventBufferView): readonly EffectEventView[] {
  if (view.eventCount === 0) {
    return EMPTY_EFFECT_EVENTS;
  }

  const events: EffectEventView[] = [];
  for (let index = 0; index < view.eventCount; index += 1) {
    const offset = index * view.bytesPerEvent;
    const effectType = view.buffer.getUint32(offset + 4, true);
    events.push({
      effectId: view.buffer.getUint32(offset, true),
      effectType,
      effectKind: gameplayPresentationEffectKind(effectType),
      actorId: view.buffer.getUint32(offset + 8, true),
      actorGeneration: view.buffer.getUint32(offset + 12, true),
      sourceId: view.buffer.getUint32(offset + 16, true),
      sourceGeneration: view.buffer.getUint32(offset + 20, true),
      x: view.buffer.getFloat32(offset + 24, true),
      y: view.buffer.getFloat32(offset + 28, true),
      intensity: view.buffer.getFloat32(offset + 32, true),
      radius: view.buffer.getFloat32(offset + 36, true),
    });
  }
  return events;
}
