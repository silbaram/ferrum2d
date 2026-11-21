/** @internal Cold SDK resource ledger. Logical byte/work quotas precede copies,
 * scans and GPU preparation. Browser/driver internal allocation and an external
 * host capture fence are separate obligations. No native-file publication. */
export interface NativeFileResourceLimits {
  readonly maxResources: number;
  readonly maxWork: number;
  readonly maxMetadataBytes: number;
  readonly maxSourceBytes: number;
  readonly maxDecodedBytes: number;
  readonly maxGpuBytes: number;
}
export interface NativeFileResourceUsage {
  readonly resources: number;
  readonly work: number;
  readonly metadataBytes: number;
  readonly sourceBytes: number;
  readonly decodedBytes: number;
  readonly gpuBytes: number;
}
export type NativeFileResourceErrorCode = "LIMITS" | "LIMIT" | "DATA" | "STALE" | "BUSY" | "CAPABILITY" | "ALLOCATION" | "GPU";
export class NativeFileResourceError extends Error {
  constructor(readonly code: NativeFileResourceErrorCode, readonly field: string) {
    super(`Native-file resource rejected (${code}): ${field}`);
    this.name = "NativeFileResourceError";
  }
}
export const DEFAULT_NATIVE_FILE_RESOURCE_LIMITS: NativeFileResourceLimits = Object.freeze({
  maxResources: 4096, maxWork: 1024 * 1024 * 1024, maxMetadataBytes: 16 * 1024 * 1024,
  maxSourceBytes: 256 * 1024 * 1024, maxDecodedBytes: 512 * 1024 * 1024, maxGpuBytes: 512 * 1024 * 1024,
});
type Charge = keyof NativeFileResourceUsage;
const keys: readonly (keyof NativeFileResourceLimits)[] = ["maxResources", "maxWork", "maxMetadataBytes", "maxSourceBytes", "maxDecodedBytes", "maxGpuBytes"];
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedTag = Object.getOwnPropertyDescriptor(typedPrototype, Symbol.toStringTag)?.get;
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, "length")?.get;
const typedByteLength = Object.getOwnPropertyDescriptor(typedPrototype, "byteLength")?.get;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, "buffer")?.get;
const ordinaryBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
const copyBytes = Uint8Array.prototype.set;
const copyFloats = Float32Array.prototype.set;
function admittedArray(value: unknown, tag: "Uint8Array" | "Float32Array"): { length: number; byteLength: number } {
  try {
    if (!ArrayBuffer.isView(value) || !typedTag || !typedLength || !typedByteLength || !typedBuffer || !ordinaryBufferLength
      || typedTag.call(value) !== tag) throw new NativeFileResourceError("DATA", "typed array");
    // Intrinsic brand checks reject shared/detached/proxy backing without using
    // caller-shadowed length/buffer/slice/iterator getters or species callbacks.
    ordinaryBufferLength.call(typedBuffer.call(value));
    const length: unknown = typedLength.call(value), byteLength: unknown = typedByteLength.call(value);
    if (typeof length !== "number" || typeof byteLength !== "number") throw new NativeFileResourceError("DATA", "typed array bounds");
    return { length, byteLength };
  } catch { throw new NativeFileResourceError("DATA", "ordinary typed array"); }
}
export class ResourceBudget {
  private readonly limit: NativeFileResourceLimits;
  private readonly used = { resources: 0, work: 0, metadataBytes: 0, sourceBytes: 0, decodedBytes: 0, gpuBytes: 0 };
  constructor(input: Partial<NativeFileResourceLimits> = {}) {
    if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) this.fail("LIMITS", "limits");
    const limit = { ...DEFAULT_NATIVE_FILE_RESOURCE_LIMITS };
    for (const key of Reflect.ownKeys(input)) if (typeof key !== "string" || !keys.some(k => k === key)) this.fail("LIMITS", "unknown limit");
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor) continue;
      if (!("value" in descriptor) || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0 || descriptor.value > limit[key]) this.fail("LIMITS", key);
      limit[key] = descriptor.value;
    }
    this.limit = Object.freeze(limit);
  }
  fail(code: NativeFileResourceErrorCode, field: string): never { throw new NativeFileResourceError(code, field); }
  charge(key: Charge, amount: number): void {
    const map = { resources: "maxResources", work: "maxWork", metadataBytes: "maxMetadataBytes", sourceBytes: "maxSourceBytes", decodedBytes: "maxDecodedBytes", gpuBytes: "maxGpuBytes" } as const;
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > this.limit[map[key]] - this.used[key]) this.fail("LIMIT", key);
    this.used[key] += amount;
  }
  work(n: number): void { this.charge("work", n); }
  metadata(value: string): void {
    if (typeof value !== "string") this.fail("DATA", "string");
    this.charge("metadataBytes", value.length * 2); this.work(value.length);
  }
  bytes(bytes: Uint8Array, kind: "sourceBytes" | "decodedBytes", expectedBytes?: number): Uint8Array<ArrayBuffer> {
    const bounds = admittedArray(bytes, "Uint8Array");
    if (expectedBytes !== undefined && bounds.byteLength !== expectedBytes) this.fail("DATA", "byte length");
    this.charge(kind, bounds.byteLength); this.work(bounds.byteLength);
    try { const result = new Uint8Array(bounds.length); copyBytes.call(result, bytes); return result; }
    catch { return this.fail("ALLOCATION", "bytes copy"); }
  }
  floats(values: Float32Array, expectedLength?: number): Float32Array<ArrayBuffer> {
    const bounds = admittedArray(values, "Float32Array");
    if (expectedLength !== undefined && bounds.length !== expectedLength) this.fail("DATA", "sample length");
    this.charge("decodedBytes", bounds.byteLength); this.work(bounds.length * 2);
    for (let i = 0; i < bounds.length; i++) if (!Number.isFinite(values[i])) this.fail("DATA", "finite samples");
    try { const result = new Float32Array(bounds.length); copyFloats.call(result, values); return result; }
    catch { return this.fail("ALLOCATION", "sample copy"); }
  }
  usage(): NativeFileResourceUsage { return Object.freeze({ ...this.used }); }
  remaining(): NativeFileResourceLimits {
    return Object.freeze({ maxResources: this.limit.maxResources - this.used.resources, maxWork: this.limit.maxWork - this.used.work,
      maxMetadataBytes: this.limit.maxMetadataBytes - this.used.metadataBytes, maxSourceBytes: this.limit.maxSourceBytes - this.used.sourceBytes,
      maxDecodedBytes: this.limit.maxDecodedBytes - this.used.decodedBytes, maxGpuBytes: this.limit.maxGpuBytes - this.used.gpuBytes });
  }
}
export function resourceInteger(value: unknown, field: string, min = 0, max = 0xffff_ffff): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new NativeFileResourceError("DATA", field);
  return value;
}
export function resourceFinite(value: unknown, field: string, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new NativeFileResourceError("DATA", field);
  return value;
}
export function resourceString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new NativeFileResourceError("DATA", field);
  return value;
}

/** Ordinary owned file records only; reject accessors/unknown fields without invoking them.
 * The bounded reader admits record construction before this projection. Reflection
 * uses a JS-owned key array; its allocation is not a process-memory ceiling. */
export function resourceKeys(value: object, keys: readonly string[], b: ResourceBudget): void {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) b.fail("DATA", "record");
  b.work(keys.length);
  // for-in omits hidden and Symbol properties, including unknown fields.
  // Inspect descriptors, so rejection never reads a field or invokes its getter.
  for (const key of Reflect.ownKeys(value)) {
    b.work(1);
    if (typeof key !== "string") b.fail("DATA", "record key");
    b.metadata(key);
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!keys.includes(key) || !d || !("value" in d) || !d.enumerable) b.fail("DATA", "record key/accessor");
  }
}
