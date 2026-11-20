/** @internal Native-file metadata bytes only. No caller callback/reviver is run.
 * The caller supplies an already-owned ordinary Uint8Array. Acquisition of that
 * buffer, hostile host Proxies/globals, a whole-session fence and total RSS/CPU
 * admission are separate contracts. This module is not a native-file importer. */

export interface NativeFileJsonLimits {
  readonly maxBytes: number;
  /** Number of simultaneously open arrays/objects; a primitive root has depth 0. */
  readonly maxDepth: number;
  /** JSON values, including the root and each array/object value; keys are not values. */
  readonly maxValues: number;
  /** Cumulative array elements plus object properties, across all containers. */
  readonly maxMembers: number;
  readonly maxStringCodeUnits: number;
  /** Decoded UTF-16 units of all keys and string values, before tree parsing. */
  readonly maxTotalStringCodeUnits: number;
  readonly maxNumberTokenChars: number;
}

export interface NativeFileJsonUsage {
  readonly bytes: number;
  readonly depth: number;
  readonly values: number;
  readonly members: number;
  readonly strings: number;
  readonly stringCodeUnits: number;
  readonly longestStringCodeUnits: number;
  readonly longestNumberTokenChars: number;
}

export type NativeFileJsonErrorCode =
  | "LIMITS" | "INPUT" | "BYTES" | "UTF8" | "SYNTAX"
  | "DEPTH" | "VALUES" | "MEMBERS" | "STRING" | "STRINGS"
  | "NUMBER" | "DUPLICATE_KEY";

export class NativeFileJsonError extends Error {
  /** Decoded source UTF-16 offset; not a raw UTF-8 byte offset. */
  readonly offset: number;
  readonly code: NativeFileJsonErrorCode;
  constructor(code: NativeFileJsonErrorCode, offset = 0) {
    super(`native file metadata JSON rejected (${code}) at ${offset}`);
    this.name = "NativeFileJsonError";
    this.code = code;
    this.offset = offset;
  }
}

export const DEFAULT_NATIVE_FILE_JSON_LIMITS: NativeFileJsonLimits = Object.freeze({
  maxBytes: 4 * 1024 * 1024,
  maxDepth: 32,
  maxValues: 65_536,
  maxMembers: 65_536,
  maxStringCodeUnits: 65_536,
  maxTotalStringCodeUnits: 1024 * 1024,
  maxNumberTokenChars: 128,
});

const ABSOLUTE_LIMITS: NativeFileJsonLimits = {
  maxBytes: 64 * 1024 * 1024,
  maxDepth: 128,
  maxValues: 1024 * 1024,
  maxMembers: 1024 * 1024,
  maxStringCodeUnits: 4 * 1024 * 1024,
  maxTotalStringCodeUnits: 16 * 1024 * 1024,
  maxNumberTokenChars: 1024,
};
const LIMIT_KEYS = Object.keys(DEFAULT_NATIVE_FILE_JSON_LIMITS) as (keyof NativeFileJsonLimits)[];
const nativeParse = JSON.parse;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const arrayTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)?.get;
const arrayByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
const arrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const ordinaryBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;

function limitsFor(input: Partial<NativeFileJsonLimits>): NativeFileJsonLimits {
  if (typeof input !== "object" || input === null
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw new NativeFileJsonError("LIMITS");
  }
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !LIMIT_KEYS.some(known => known === key)) {
      throw new NativeFileJsonError("LIMITS");
    }
  }
  const result = { ...DEFAULT_NATIVE_FILE_JSON_LIMITS };
  for (const key of LIMIT_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor && !("value" in descriptor)) throw new NativeFileJsonError("LIMITS");
    const value: unknown = descriptor?.value;
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > ABSOLUTE_LIMITS[key]) {
      throw new NativeFileJsonError("LIMITS");
    }
    result[key] = value;
  }
  return result;
}

function byteLengthOf(bytes: Uint8Array): number {
  if (!ArrayBuffer.isView(bytes) || !arrayTag || !arrayByteLength || !arrayBuffer || !ordinaryBufferByteLength
    || arrayTag.call(bytes) !== "Uint8Array") throw new NativeFileJsonError("INPUT");
  // Never use caller-shadowed getters to determine the admission bound.
  for (const key of ["length", "byteLength", "byteOffset", "buffer"]) {
    if (Object.getOwnPropertyDescriptor(bytes, key)) throw new NativeFileJsonError("INPUT");
  }
  try {
    // The intrinsic ordinary ArrayBuffer getter also rejects SharedArrayBuffer.
    ordinaryBufferByteLength.call(arrayBuffer.call(bytes));
    const length: unknown = arrayByteLength.call(bytes);
    if (typeof length !== "number") throw new NativeFileJsonError("INPUT");
    return length;
  } catch {
    throw new NativeFileJsonError("INPUT");
  }
}

/** @internal Parse after byte, structural, string and numeric admission.
 * Key strings are decoded only after their per-string/cumulative quota checks;
 * bounded key Sets are the scanner's only input-sized retained structures.
 * The complete object/array tree is allocated by native JSON.parse only after
 * every grammar/limit check. These logical limits are not a heap/RSS estimate. */
export function readNativeFileJson(
  bytes: Uint8Array,
  overrides: Partial<NativeFileJsonLimits> = {},
): { readonly value: unknown; readonly usage: NativeFileJsonUsage } {
  const limits = limitsFor(overrides);
  const length = byteLengthOf(bytes);
  if (length > limits.maxBytes) throw new NativeFileJsonError("BYTES");
  let text: string;
  try {
    // Preserve a BOM so grammar rejects it instead of silently stripping bytes.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new NativeFileJsonError("UTF8");
  }
  const usage = new Scanner(text, limits).scan(length);
  let value: unknown;
  try { value = nativeParse(text); }
  catch { throw new NativeFileJsonError("SYNTAX"); }
  return Object.freeze({ value, usage });
}

class Scanner {
  private at = 0;
  private values = 0;
  private members = 0;
  private strings = 0;
  private stringUnits = 0;
  private longestString = 0;
  private longestNumber = 0;
  private depth = 0;

  constructor(private readonly text: string, private readonly limits: NativeFileJsonLimits) {}

  scan(bytes: number): NativeFileJsonUsage {
    this.space();
    this.value(0);
    this.space();
    if (this.at !== this.text.length) this.fail("SYNTAX");
    return Object.freeze({ bytes, depth: this.depth, values: this.values, members: this.members,
      strings: this.strings, stringCodeUnits: this.stringUnits,
      longestStringCodeUnits: this.longestString, longestNumberTokenChars: this.longestNumber });
  }

  private fail(code: NativeFileJsonErrorCode): never {
    throw new NativeFileJsonError(code, this.at);
  }

  private space(): void {
    while (whitespace(this.text.charCodeAt(this.at))) this.at += 1;
  }

  private value(depth: number): void {
    if (this.values >= this.limits.maxValues) this.fail("VALUES");
    this.values += 1;
    const char = this.text.charCodeAt(this.at);
    if (char === 0x7b) this.object(depth + 1);
    else if (char === 0x5b) this.array(depth + 1);
    else if (char === 0x22) this.string();
    else if (char === 0x74) this.literal("true");
    else if (char === 0x66) this.literal("false");
    else if (char === 0x6e) this.literal("null");
    else if (char === 0x2d || digit(char)) this.number();
    else this.fail("SYNTAX");
  }

  private enter(depth: number): void {
    if (depth > this.limits.maxDepth) this.fail("DEPTH");
    this.depth = Math.max(this.depth, depth);
    this.at += 1;
    this.space();
  }

  private member(): void {
    if (this.members >= this.limits.maxMembers) this.fail("MEMBERS");
    this.members += 1;
  }

  private object(depth: number): void {
    this.enter(depth);
    if (this.text.charCodeAt(this.at) === 0x7d) { this.at += 1; return; }
    const keys = new Set<string>();
    for (;;) {
      this.member();
      if (this.text.charCodeAt(this.at) !== 0x22) this.fail("SYNTAX");
      const start = this.at;
      this.string();
      // String units/member admission preceded this bounded key allocation.
      const key: unknown = nativeParse(this.text.slice(start, this.at));
      if (typeof key !== "string") this.fail("SYNTAX");
      if (keys.has(key)) this.fail("DUPLICATE_KEY");
      keys.add(key);
      this.space();
      if (this.text.charCodeAt(this.at) !== 0x3a) this.fail("SYNTAX");
      this.at += 1;
      this.space();
      this.value(depth);
      this.space();
      if (this.text.charCodeAt(this.at) === 0x7d) { this.at += 1; return; }
      if (this.text.charCodeAt(this.at) !== 0x2c) this.fail("SYNTAX");
      this.at += 1;
      this.space();
    }
  }

  private array(depth: number): void {
    this.enter(depth);
    if (this.text.charCodeAt(this.at) === 0x5d) { this.at += 1; return; }
    for (;;) {
      this.member();
      this.value(depth);
      this.space();
      if (this.text.charCodeAt(this.at) === 0x5d) { this.at += 1; return; }
      if (this.text.charCodeAt(this.at) !== 0x2c) this.fail("SYNTAX");
      this.at += 1;
      this.space();
    }
  }

  private literal(value: string): void {
    for (let index = 0; index < value.length; index += 1) {
      if (this.text[this.at] !== value[index]) this.fail("SYNTAX");
      this.at += 1;
    }
  }

  private string(): void {
    this.at += 1;
    this.strings += 1;
    let units = 0;
    for (;;) {
      const char = this.text.charCodeAt(this.at);
      if (char === 0x22) { this.at += 1; this.longestString = Math.max(this.longestString, units); return; }
      if (!Number.isFinite(char) || char < 0x20) this.fail("SYNTAX");
      if (units >= this.limits.maxStringCodeUnits) this.fail("STRING");
      if (this.stringUnits >= this.limits.maxTotalStringCodeUnits) this.fail("STRINGS");
      units += 1;
      this.stringUnits += 1;
      this.at += 1;
      if (char === 0x5c) {
        const escape = this.text.charCodeAt(this.at);
        if (escape === 0x75) {
          this.at += 1;
          for (let i = 0; i < 4; i += 1) {
            if (!hex(this.text.charCodeAt(this.at))) this.fail("SYNTAX");
            this.at += 1;
          }
        } else if (simpleEscape(escape)) this.at += 1;
        else this.fail("SYNTAX");
      }
    }
  }

  private numberChar(start: number): void {
    if (this.at - start >= this.limits.maxNumberTokenChars) this.fail("NUMBER");
    this.at += 1;
  }

  private digits(start: number): void {
    if (!digit(this.text.charCodeAt(this.at))) this.fail("SYNTAX");
    while (digit(this.text.charCodeAt(this.at))) this.numberChar(start);
  }

  private number(): void {
    const start = this.at;
    if (this.text.charCodeAt(this.at) === 0x2d) this.numberChar(start);
    if (this.text.charCodeAt(this.at) === 0x30) this.numberChar(start);
    else this.digits(start);
    if (this.text.charCodeAt(this.at) === 0x2e) { this.numberChar(start); this.digits(start); }
    if (this.text.charCodeAt(this.at) === 0x65 || this.text.charCodeAt(this.at) === 0x45) {
      this.numberChar(start);
      if (this.text.charCodeAt(this.at) === 0x2b || this.text.charCodeAt(this.at) === 0x2d) this.numberChar(start);
      this.digits(start);
    }
    if (!Number.isFinite(Number(this.text.slice(start, this.at)))) this.fail("NUMBER");
    this.longestNumber = Math.max(this.longestNumber, this.at - start);
  }
}

function digit(char: number): boolean { return char >= 0x30 && char <= 0x39; }
function whitespace(char: number): boolean {
  return char === 0x20 || char === 0x09 || char === 0x0a || char === 0x0d;
}
function simpleEscape(char: number): boolean {
  return char === 0x22 || char === 0x5c || char === 0x2f || char === 0x62
    || char === 0x66 || char === 0x6e || char === 0x72 || char === 0x74;
}
function hex(char: number): boolean {
  return digit(char) || (char >= 0x41 && char <= 0x46) || (char >= 0x61 && char <= 0x66);
}
