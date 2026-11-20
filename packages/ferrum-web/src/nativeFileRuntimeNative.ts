/** @internal Cold native participant for the whole-file coordinator. A prepared
 * target has a pristine placeholder and a sealed file candidate. It is not Ready;
 * SDK admission, platform publication and session epochs belong to the coordinator. */
import type { Engine } from "../pkg/ferrum_core.js";
import { WasmNamespace, initializeBridgeInWasmNamespace } from "./wasmNamespace.js";
import { WasmBridge } from "./wasmBridge.js";
import { guardWasmNamespaceObject, nativeWasmNamespaceObject } from "./wasmNamespaceObject.js";
import { ResourceBudget, resourceInteger } from "./nativeFileResourceBudget.js";
import { readNativeFileNativeFacts, type NativeFileNativeFacts } from "./nativeFileNativeFacts.js";
import { NATIVE_FILE_SDK_BUILD } from "./nativeFileSdkBuild.js";

const MIB = 1024 * 1024;
const defaults = [1, 64*MIB, 64*MIB, 64*MIB, 4*MIB, 16*MIB, 4*MIB, 64*MIB, 8*MIB, 4*MIB,
  64*MIB, 960*MIB, 64*MIB, 96, 64*MIB, 4096, 256*MIB, 1024*MIB, 128*MIB, 64*MIB, MIB, MIB,
  64*MIB, 64*MIB, 128*MIB, 64*MIB, 64*MIB] as const;
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const tagOf = Object.getOwnPropertyDescriptor(typedPrototype, Symbol.toStringTag)!.get!;
const sizeOf = Object.getOwnPropertyDescriptor(typedPrototype, "byteLength")!.get!;
const lengthOf = Object.getOwnPropertyDescriptor(typedPrototype, "length")!.get!;
const setBytes = Uint8Array.prototype.set;
const setWords = Uint32Array.prototype.set;

export interface NativeFileSdkSections {
  readonly variables: Uint8Array;
  readonly authoring: Uint8Array;
  readonly resourceManifest: Uint8Array;
  readonly resourceData: Uint8Array;
  readonly dialogueQuest: Uint8Array;
  readonly hostBindings: Uint8Array;
}
export interface NativeFileNativeOptions {
  /** Limits this target's Wasm linear memory, not host JS/GPU/process RSS. */
  readonly maximumMemoryPages?: number;
  /** Empty selects defaults;27 little numeric words use the native v1 schema.
   * Every supplied limit can only lower its corresponding default. */
  readonly limits?: Uint32Array;
}
interface NativePrepare {
  metadata_len(): number;
  metadata(): Uint8Array;
  sdk_section_len(kind: number): number;
  sdk_section(kind: number): Uint8Array;
  repack_sdk_sections(bytes: Uint8Array, lengths: Uint32Array): Uint8Array;
  is_consumed(): boolean;
  free(): void;
}
interface FileEngine extends Engine {
  capture_native_file(bytes: Uint8Array, lengths: Uint32Array, sdkLo: number, sdkHi: number, limits: Uint32Array): Uint8Array;
  install_native_file_prepare(value: NativePrepare): number;
}
interface PrepareConstructor {
  new(target: Engine, file: Uint8Array, sdkLo: number, sdkHi: number, limits: Uint32Array): NativePrepare;
  packet_version(): number;
}

function limits(input: Uint32Array | undefined, b: ResourceBudget): Uint32Array<ArrayBuffer> {
  if (input === undefined) return new Uint32Array();
  let count: number;
  try {
    if (tagOf.call(input) !== "Uint32Array") return b.fail("DATA", "native limits words");
    count = lengthOf.call(input);
  } catch { return b.fail("DATA", "native limits words"); }
  if (count !== 0 && count !== defaults.length) return b.fail("LIMITS", "native limits length");
  b.work(count); b.charge("decodedBytes", count * 4);
  const result = new Uint32Array(count); setWords.call(result, input);
  for (let i = 0; i < count; i++) if (i === 0 ? result[i] !== 1 : result[i] > defaults[i])
    return b.fail("LIMITS", "native limits value");
  return result;
}
function limit(words: Uint32Array, index: number): number { return words.length ? words[index] : defaults[index]; }
function count(bytes: Uint8Array, b: ResourceBudget): number {
  try { if (tagOf.call(bytes) === "Uint8Array") return sizeOf.call(bytes); }
  catch { /* Typed failure below. */ }
  return b.fail("DATA", "native file section bytes");
}
function sections(value: NativeFileSdkSections, words: Uint32Array, b: ResourceBudget) {
  const input = [value.variables, value.authoring, value.resourceManifest, value.resourceData, value.dialogueQuest, value.hostBindings];
  let total = 0;
  const lengths: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const n = count(input[i], b);
    if (n === 0 || n > limit(words, i + 4) || n > limit(words, 1) - total) return b.fail("LIMIT", "native SDK section length");
    total += n; lengths.push(n);
  }
  b.work(total + 6); b.charge("decodedBytes", total + 24);
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = new Uint8Array(total); } catch { return b.fail("ALLOCATION", "native SDK sections"); }
  let at = 0;
  for (const row of input) { setBytes.call(bytes, row, at); at += count(row, b); }
  return { bytes, lengths: Uint32Array.from(lengths) };
}
function returned(bytes: Uint8Array, maximum: number, b: ResourceBudget, expected?: number): Uint8Array {
  const n = count(bytes, b);
  if (n > maximum || expected !== undefined && n !== expected) return b.fail("DATA", "native output length");
  return bytes;
}

/** The source is the actual SDK-owned Engine. The native encoder owns its own
 * limits; this ledger reserves the maximum possible host return BEFORE calling it.
 * The caller still checks native/SDK/resource capture fences on the same cut. */
export function captureNativeFileCut(source: Engine, data: NativeFileSdkSections, b: ResourceBudget, options: NativeFileNativeOptions = {}): Uint8Array {
  const native = source as FileEngine;
  if (typeof native.capture_native_file !== "function") return b.fail("CAPABILITY", "native file capture ABI");
  const words = limits(options.limits, b), bulk = sections(data, words, b), maximum = limit(words, 25);
  b.work(maximum); b.charge("decodedBytes", maximum);
  return returned(native.capture_native_file(bulk.bytes, bulk.lengths, ...NATIVE_FILE_SDK_BUILD, words), maximum, b);
}

export class NativeFileUnpublishedTarget {
  private consumed = false;
  private disposed = false;
  private constructor(
    readonly namespace: WasmNamespace,
    /** Pristine placeholder only until install. This bridge stays private to the
     * coordinator and resource participants; the file Engine is sealed in Rust. */
    readonly placeholderBridge: WasmBridge,
    private readonly prepared: NativePrepare,
    readonly facts: NativeFileNativeFacts,
    private readonly words: Uint32Array,
    private readonly budget: ResourceBudget,
  ) {}

  static async prepare(wasmBytes: Uint8Array, input: Uint8Array, b: ResourceBudget, options: NativeFileNativeOptions = {}): Promise<NativeFileUnpublishedTarget> {
    const words = limits(options.limits, b), length = count(input, b);
    if (length > limit(words, 1)) return b.fail("LIMIT", "native file bytes");
    const file = b.bytes(input, "sourceBytes"), pages = resourceInteger(options.maximumMemoryPages ?? 8192, "native target memory pages", 0, 65536);
    const namespace = new WasmNamespace(wasmBytes, pages);
    let bridge: WasmBridge | undefined, prepared: NativePrepare | undefined;
    try {
      bridge = await initializeBridgeInWasmNamespace(namespace, WasmBridge.init);
      prepared = namespace.call(bindings => {
        const constructor = (bindings as unknown as { NativeFilePrepare?: PrepareConstructor }).NativeFilePrepare;
        if (!constructor || constructor.packet_version() !== 1) return b.fail("CAPABILITY", "native prepare ABI");
        return guardWasmNamespaceObject(namespace, new constructor(nativeWasmNamespaceObject(namespace, bridge!.engine()), file, ...NATIVE_FILE_SDK_BUILD, words));
      });
      const n = resourceInteger(prepared.metadata_len(), "native metadata length", 0, limit(words, 26));
      b.work(n); b.charge("decodedBytes", n);
      const packet = returned(prepared.metadata(), limit(words, 26), b, n);
      const facts = readNativeFileNativeFacts(packet, b, limit(words, 26));
      return new NativeFileUnpublishedTarget(namespace, bridge, prepared, facts, words, b);
    } catch (error) {
      // Generated guards skip frees after a real target trap. Old/source objects
      // are never supplied to this cleanup and cannot be freed here.
      try { prepared?.free(); } finally { try { bridge?.engine().free(); } finally { namespace.dispose(); } }
      throw error;
    }
  }

  private requirePending(): void {
    if (this.disposed || this.consumed) this.budget.fail("STALE", "native prepare consumed/disposed");
  }
  sdkSections(): NativeFileSdkSections {
    this.requirePending();
    const read = (kind: number) => {
      const n = resourceInteger(this.prepared.sdk_section_len(kind), "native section length", 1, limit(this.words, kind + 2));
      this.budget.work(n); this.budget.charge("decodedBytes", n);
      return returned(this.prepared.sdk_section(kind), n, this.budget, n);
    };
    return Object.freeze({ variables: read(2), authoring: read(3), resourceManifest: read(4), resourceData: read(5), dialogueQuest: read(6), hostBindings: read(7) });
  }
  repackSdkSections(data: NativeFileSdkSections): Uint8Array {
    this.requirePending();
    const bulk = sections(data, this.words, this.budget), n = 288 + this.facts.usage[1] + bulk.bytes.length;
    if (n > limit(this.words, 1) || n > limit(this.words, 25)) return this.budget.fail("LIMIT", "native file repack");
    this.budget.work(n); this.budget.charge("decodedBytes", n);
    return returned(this.prepared.repack_sdk_sections(bulk.bytes, bulk.lengths), n, this.budget, n);
  }
  /** Native install is only one participant. The coordinator calls this after
   * ALL SDK participants pass; this method does not grant a session Ready token. */
  installAfterSdkAdmission(): void {
    this.requirePending();
    const native = this.placeholderBridge.engine() as FileEngine;
    if (typeof native.install_native_file_prepare !== "function") return this.budget.fail("CAPABILITY", "native install ABI");
    const status = native.install_native_file_prepare(this.prepared);
    if (status !== 0 || !this.prepared.is_consumed()) return this.budget.fail("DATA", `native install status ${status}`);
    this.consumed = true; this.prepared.free();
  }
  /** Whole-target disposal. Platform resource owners are disposed by the caller. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try { this.prepared.free(); } finally {
      try { this.placeholderBridge.engine().free(); } finally { this.namespace.dispose(); }
    }
  }
}
