import type { Engine } from "../pkg/ferrum_core.js";
import type { PhysicsBatchCastRequest, PhysicsBatchCastResult } from "./engineTypes/physicsQueries.js";
import { finiteNumber, uint32Number } from "./particlePreset.js";

const kinds = ["ray", "segment", "aabb", "circle", "orientedBox", "capsule", "convexPolygon"] as const;
const stride = 48;

/** One native call; owned results remain valid across subsequent queries/memory growth. */
export function batchCastBodies(engine: Engine, requests: readonly PhysicsBatchCastRequest[]): readonly PhysicsBatchCastResult[] {
  if (requests.length > 128) throw new RangeError("batch casts support at most 128 requests");
  const packet = new Float64Array(requests.length * stride);
  requests.forEach((q, index) => {
    const r = packet.subarray(index * stride, (index + 1) * stride);
    r[0] = kinds.indexOf(q.kind);
    if (r[0] < 0) throw new TypeError("unknown batch cast kind");
    r[1] = uint32Number(q.queryMaskBits ?? 0xffffffff, "queryMaskBits");
    r[2] = q.heightSpan ? 1 : 0;
    r[3] = uint32Number(q.heightSpan?.floorId ?? 0, "floorId");
    r[4] = uint32Number(q.maxHits ?? 32, "maxHits");
    if (r[4] < 1 || r[4] > 32) throw new RangeError("maxHits must be 1..32");
    r[6] = q.heightSpan?.elevation ?? 0;
    r[7] = q.heightSpan?.height ?? 0;
    if (r[7] < 0) throw new RangeError("height must be non-negative");
    if (q.kind === "ray") { r[8] = q.originX; r[9] = q.originY; }
    else if (q.kind === "segment" || q.kind === "capsule") {
      r[8] = q.startX; r[9] = q.startY; r[10] = q.endX; r[11] = q.endY;
      if (q.kind === "capsule") r[12] = positive(q.radius, "radius");
    } else if (q.kind === "convexPolygon") {
      if (q.vertices.length < 6 || q.vertices.length > 32 || q.vertices.length % 2 !== 0) throw new RangeError("convex polygon needs 3..16 vertices");
      r[5] = q.vertices.length / 2;
      r.set(q.vertices, 16);
    } else {
      r[8] = q.x; r[9] = q.y;
      if (q.kind === "circle") r[10] = positive(q.radius, "radius");
      else { r[10] = positive(q.halfWidth, "halfWidth"); r[11] = positive(q.halfHeight, "halfHeight"); }
      if (q.kind === "orientedBox") r[12] = q.rotationRadians;
    }
    if (q.kind !== "segment") {
      r[13] = q.directionX; r[14] = q.directionY; r[15] = q.maxDistance;
      if (r[15] < 0) throw new RangeError("maxDistance must be non-negative");
    }
    // Metadata was checked above; unused vertex slots are freshly zeroed padding.
    // Validate only the shape payload instead of walking 48 slots twice per query.
    const payloadEnd = 16 + r[5]! * 2;
    for (let i = 6; i < payloadEnd; i++) {
      const n = finiteNumber(r[i]!, "batch cast value");
      if (!Number.isFinite(Math.fround(n))) throw new RangeError("batch cast value exceeds f32");
    }
  });
  const data = engine.batch_cast_bodies(packet);
  if (data.length === 0 || data[0] !== requests.length) throw new Error("invalid batch cast geometry");
  const results: PhysicsBatchCastResult[] = [];
  let offset = 1;
  for (let requestIndex = 0; requestIndex < requests.length; requestIndex++) {
    const totalHits = data[offset++]!;
    const count = data[offset++]!;
    const hits = [];
    for (let j = 0; j < count; j++, offset += 7) hits.push({
      entityId: data[offset]!, entityGeneration: data[offset + 1]!, distance: data[offset + 2]!,
      pointX: data[offset + 3]!, pointY: data[offset + 4]!, normalX: data[offset + 5]!, normalY: data[offset + 6]!,
    });
    results.push({ requestIndex, hits, totalHits, truncated: totalHits > count });
  }
  return results;
}
function positive(value: number, name: string): number {
  finiteNumber(value, name);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}
