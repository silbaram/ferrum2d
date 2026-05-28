import type { PhysicsConvexPolygonVertexBuffer } from "./engineTypes.js";

export const DEFAULT_PHYSICS_MASK_BITS = 0xffffffff;

export function physicsMaskBits(maskBits: number | undefined): number {
  return maskBits === undefined ? DEFAULT_PHYSICS_MASK_BITS : maskBits >>> 0;
}

export function physicsVertexBuffer(vertices: PhysicsConvexPolygonVertexBuffer): Float32Array {
  return vertices instanceof Float32Array ? vertices : Float32Array.from(vertices);
}
