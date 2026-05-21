import { deepEqual } from "node:assert/strict";
import { test } from "node:test";
import { decodeCollisionEvents } from "../src/collisionEventDecoder.js";

test("decodeCollisionEvents parses packed collision event u32s", () => {
  const events = decodeCollisionEvents({
    buffer: new Uint32Array([
      1, 3, 0, 9, 2,
      2, 3, 0, 9, 2,
      3, 3, 0, 9, 2,
      4, 3, 0, 9, 2,
    ]),
    eventCount: 4,
    u32sPerEvent: 5,
  });

  deepEqual(events, [
    { kind: "enter", kindCode: 1, aId: 3, aGeneration: 0, bId: 9, bGeneration: 2 },
    { kind: "stay", kindCode: 2, aId: 3, aGeneration: 0, bId: 9, bGeneration: 2 },
    { kind: "exit", kindCode: 3, aId: 3, aGeneration: 0, bId: 9, bGeneration: 2 },
    { kind: "hit", kindCode: 4, aId: 3, aGeneration: 0, bId: 9, bGeneration: 2 },
  ]);
});
