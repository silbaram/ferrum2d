import { deepEqual } from "node:assert/strict";
import { test } from "node:test";
import { decodeCollisionEvents } from "../src/collisionEventDecoder.js";

test("decodeCollisionEvents parses packed collision event u32s", () => {
  const events = decodeCollisionEvents({
    buffer: new Uint32Array([
      1, 3, 0, 9, 2, 0,
      2, 3, 0, 9, 2, 0,
      3, 3, 0, 9, 2, 0,
      4, 3, 0, 9, 2, f32Bits(2.5),
    ]),
    eventCount: 4,
    u32sPerEvent: 6,
  });

  deepEqual(events, [
    { kind: "enter", kindCode: 1, aId: 3, aGeneration: 0, bId: 9, bGeneration: 2, damage: 0 },
    { kind: "stay", kindCode: 2, aId: 3, aGeneration: 0, bId: 9, bGeneration: 2, damage: 0 },
    { kind: "exit", kindCode: 3, aId: 3, aGeneration: 0, bId: 9, bGeneration: 2, damage: 0 },
    { kind: "hit", kindCode: 4, aId: 3, aGeneration: 0, bId: 9, bGeneration: 2, damage: 2.5 },
  ]);
});

function f32Bits(value: number): number {
  const damage = new Float32Array([value]);
  return new Uint32Array(damage.buffer)[0];
}
