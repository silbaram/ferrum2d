export type CollisionEventKind = "enter" | "stay" | "exit" | "hit" | "unknown";

export interface CollisionEventView {
  kind: CollisionEventKind;
  kindCode: number;
  aId: number;
  aGeneration: number;
  bId: number;
  bGeneration: number;
}

export interface CollisionEventBufferView {
  buffer: Uint32Array;
  eventCount: number;
  u32sPerEvent: number;
}

export const U32S_PER_COLLISION_EVENT = 5;
export const EMPTY_COLLISION_EVENTS: readonly CollisionEventView[] = Object.freeze([]);

export function decodeCollisionEvents(view: CollisionEventBufferView): readonly CollisionEventView[] {
  if (view.eventCount === 0) {
    return EMPTY_COLLISION_EVENTS;
  }

  const events: CollisionEventView[] = [];
  for (let i = 0; i < view.eventCount; i += 1) {
    const offset = i * view.u32sPerEvent;
    const kindCode = view.buffer[offset];
    events.push({
      kind: collisionEventKind(kindCode),
      kindCode,
      aId: view.buffer[offset + 1],
      aGeneration: view.buffer[offset + 2],
      bId: view.buffer[offset + 3],
      bGeneration: view.buffer[offset + 4],
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
