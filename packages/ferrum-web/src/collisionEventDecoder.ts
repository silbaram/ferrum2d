export type CollisionEventKind = "enter" | "stay" | "exit" | "hit" | "unknown";

export interface CollisionEventView {
  kind: CollisionEventKind;
  kindCode: number;
  aId: number;
  aGeneration: number;
  bId: number;
  bGeneration: number;
  damage: number;
}

export interface CollisionEventBufferView {
  buffer: Uint32Array;
  eventCount: number;
  u32sPerEvent: number;
}

export const U32S_PER_COLLISION_EVENT = 6;
export const EMPTY_COLLISION_EVENTS: readonly CollisionEventView[] = Object.freeze([]);
const DAMAGE_BITS = new Uint32Array(1);
const DAMAGE_VALUE = new Float32Array(DAMAGE_BITS.buffer);

export function decodeCollisionEvents(view: CollisionEventBufferView): readonly CollisionEventView[] {
  if (view.eventCount === 0) {
    return EMPTY_COLLISION_EVENTS;
  }

  const events: CollisionEventView[] = [];
  for (let i = 0; i < view.eventCount; i += 1) {
    const offset = i * view.u32sPerEvent;
    const kindCode = view.buffer[offset];
    const damageBits = view.u32sPerEvent > 5 ? view.buffer[offset + 5] : 0;
    events.push({
      kind: collisionEventKind(kindCode),
      kindCode,
      aId: view.buffer[offset + 1],
      aGeneration: view.buffer[offset + 2],
      bId: view.buffer[offset + 3],
      bGeneration: view.buffer[offset + 4],
      damage: f32FromBits(damageBits),
    });
  }
  return events;
}

export function collisionEventKind(kindCode: number): CollisionEventKind {
  if (kindCode === 1) return "enter";
  if (kindCode === 2) return "stay";
  if (kindCode === 3) return "exit";
  if (kindCode === 4) return "hit";
  return "unknown";
}

function f32FromBits(bits: number): number {
  DAMAGE_BITS[0] = bits >>> 0;
  return DAMAGE_VALUE[0];
}
