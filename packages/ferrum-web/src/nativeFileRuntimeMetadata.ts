/** @internal Fixed-section DTO framing and conservative admission reservations.
 * These are logical requests, not measured JS heap/RSS or a process cap. */
import { ResourceBudget } from "./nativeFileResourceBudget.js";
import { encodeNativeFileMetadataGraph, decodeNativeFileMetadataGraph } from "./nativeFileResourceCodec.js";
const EMPTY_DATA = new Uint8Array([70,50,68,82,69,83,0,0,1,0,0,0,0,0,0,0]);
export function encodeRuntimeMetadata(value: unknown, b: ResourceBudget, kind: "variables" | "authoring"): Uint8Array {
  return encodeNativeFileMetadataGraph(value, b, kind).manifestBytes;
}
export function decodeRuntimeMetadata(bytes: Uint8Array, b: ResourceBudget, kind: "variables" | "authoring"): unknown {
  return decodeNativeFileMetadataGraph(bytes, EMPTY_DATA, b, kind);
}
/** Owner helpers retain their existing local ceilings. Reserve their bounded
 * full scan/clone/resolver allowance on the ONE parent ledger before invoking.
 * No local defaults reset the shared ledger. This reservation is deliberately
 * conservative and independent of allocator addresses or success/failure. */
export function reserveRuntimeAuthoring(b: ResourceBudget): void {
  b.work(64 * 1024 * 1024); b.charge("decodedBytes", 32 * 1024 * 1024);
}
export function reserveRuntimeVariables(b: ResourceBudget): void {
  b.work(4096); b.charge("decodedBytes", 64 * 256 + 2 * 1048576);
}
export function assertRuntimeBytes(a: Uint8Array, c: Uint8Array, b: ResourceBudget, field: string): void {
  b.work(1 + a.length + c.length);
  if (a.length !== c.length) b.fail("STALE", field);
  for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) b.fail("STALE", field);
}
