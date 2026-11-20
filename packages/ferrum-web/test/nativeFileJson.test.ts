import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_NATIVE_FILE_JSON_LIMITS,
  NativeFileJsonError,
  readNativeFileJson,
  type NativeFileJsonErrorCode,
  type NativeFileJsonLimits,
} from "../src/nativeFileJson.js";

const utf8 = (value: string) => new TextEncoder().encode(value);
function fails(block: () => unknown, code?: NativeFileJsonErrorCode) {
  let error: unknown;
  try { block(); } catch (caught) { error = caught; }
  if (!(error instanceof NativeFileJsonError)) throw new Error("expected NativeFileJsonError");
  if (code !== undefined) equal(error.code, code);
  ok(Number.isInteger(error.offset) && error.offset >= 0);
}
function rejects(value: Uint8Array | string, code?: NativeFileJsonErrorCode, limits?: Partial<NativeFileJsonLimits>) {
  const bytes = typeof value === "string" ? utf8(value) : value;
  const before = bytes.slice();
  fails(() => readNativeFileJson(bytes, limits), code);
  deepEqual(bytes, before, "reader failure must not mutate source bytes");
}

test("native file JSON preserves native JSON data, Unicode, finite numbers and negative zero", () => {
  const corpus = [
    "null", "true", "false", "0", "-0", "1e308", "-1e-4000", "9007199254740993",
    '""', '"한글💡é"', '"\\ud800"', '"\\ud83d\\ude00"',
    '"a\\n\\t\\b\\f\\r\\/\\\\\\\"b"',
    "[]", "{}", ' { "a" : [1,-2.5e-3,true,false,null,{}], "b": "é" } \n\t\r',
    '{"é":1,"é":2}',
  ];
  for (const text of corpus) {
    const bytes = utf8(text);
    const before = bytes.slice();
    const result = readNativeFileJson(bytes);
    deepEqual(result.value, JSON.parse(text));
    equal(result.usage.bytes, bytes.byteLength);
    ok(Object.isFrozen(result));
    ok(Object.isFrozen(result.usage));
    deepEqual(bytes, before);
  }
  ok(Object.is(readNativeFileJson(utf8("-0")).value, -0));
  ok(Object.is(readNativeFileJson(utf8("-1e-4000")).value, -0));
});

test("native file JSON exact budgets admit and each one-below budget rejects", () => {
  const text = '{"a":["💡",-0,true,null],"b":{}}';
  const bytes = utf8(text);
  const exact: NativeFileJsonLimits = {
    maxBytes: bytes.byteLength, maxDepth: 2, maxValues: 7, maxMembers: 6,
    maxStringCodeUnits: 2, maxTotalStringCodeUnits: 4, maxNumberTokenChars: 2,
  };
  const result = readNativeFileJson(bytes, exact);
  deepEqual(result.usage, { bytes: bytes.byteLength, depth: 2, values: 7, members: 6,
    strings: 3, stringCodeUnits: 4, longestStringCodeUnits: 2, longestNumberTokenChars: 2 });
  const cases: readonly [keyof NativeFileJsonLimits, NativeFileJsonErrorCode][] = [
    ["maxBytes", "BYTES"], ["maxDepth", "DEPTH"], ["maxValues", "VALUES"],
    ["maxMembers", "MEMBERS"], ["maxStringCodeUnits", "STRING"],
    ["maxTotalStringCodeUnits", "STRINGS"], ["maxNumberTokenChars", "NUMBER"],
  ];
  for (const [key, code] of cases) rejects(bytes, code, { ...exact, [key]: exact[key] - 1 });
});

test("native file JSON depth is a container bound with a hard maximum 128", () => {
  equal(readNativeFileJson(utf8("0"), { maxDepth: 0 }).usage.depth, 0);
  rejects("[]", "DEPTH", { maxDepth: 0 });
  const nested = (depth: number) => "[".repeat(depth) + "0" + "]".repeat(depth);
  equal(readNativeFileJson(utf8(nested(32))).usage.depth, 32);
  rejects(nested(33), "DEPTH");
  equal(readNativeFileJson(utf8(nested(128)), { maxDepth: 128 }).usage.depth, 128);
  rejects(nested(129), "DEPTH", { maxDepth: 128 });
  rejects("0", "LIMITS", { maxDepth: 129 });
});

test("native file JSON limits are checked before malformed later input is parsed", () => {
  rejects(new Uint8Array([0xff]), "BYTES", { maxBytes: 0 });
  rejects("[" + "0,".repeat(10_000) + "BROKEN]", "VALUES", { maxValues: 2 });
  rejects("[" + "0,".repeat(10_000) + "BROKEN]", "MEMBERS", { maxMembers: 1 });
  rejects('{"unterminated', "MEMBERS", { maxMembers: 0 });
  rejects('{"aaaa\\q":0}', "STRING", { maxStringCodeUnits: 2 });
  rejects('"aaaa\\q"', "STRINGS", { maxTotalStringCodeUnits: 2 });
  rejects("1" + "0".repeat(1000) + "BROKEN", "NUMBER", { maxNumberTokenChars: 8 });
});

test("native file JSON detects duplicate decoded keys before last-wins materialization", () => {
  for (const text of [
    '{"name":0,"name":1}', '{"name":0,"na\\u006de":1}',
    '{"a":0,"\\u0061":1}', '{"💡":0,"\\ud83d\\udca1":1}',
    '{"":0,"":1}', '{"x":{"a":0,"a":1}}',
  ]) rejects(text, "DUPLICATE_KEY");
  const separate = '{"a":{"key":1},"b":{"key":2}}';
  deepEqual(readNativeFileJson(utf8(separate)).value, JSON.parse(separate));
});

test("native file JSON decoded string quotas include keys and escaped UTF-16 units", () => {
  const escaped = '"\\u0061\\u0062"';
  equal(readNativeFileJson(utf8(escaped), { maxStringCodeUnits: 2 }).value, "ab");
  rejects(escaped, "STRING", { maxStringCodeUnits: 1 });
  equal(readNativeFileJson(utf8('"\\ud83d\\ude00"'), { maxStringCodeUnits: 2 }).value, "😀");
  rejects('"\\ud83d\\ude00"', "STRING", { maxStringCodeUnits: 1 });
  equal(readNativeFileJson(utf8('{"ab":"cd"}'), { maxTotalStringCodeUnits: 4 }).usage.stringCodeUnits, 4);
  rejects('{"ab":"cd"}', "STRINGS", { maxTotalStringCodeUnits: 3 });
  equal(readNativeFileJson(utf8('{"":""}'), { maxStringCodeUnits: 0, maxTotalStringCodeUnits: 0 }).usage.strings, 2);
});

test("native file JSON finite numbers and numeric token budgets preserve native values", () => {
  for (const text of ["1e309", "-1e309", "9e9999"]) rejects(text, "NUMBER");
  const longest = "-1.25e+30";
  equal(readNativeFileJson(utf8(longest), { maxNumberTokenChars: longest.length }).value, JSON.parse(longest));
  rejects(longest, "NUMBER", { maxNumberTokenChars: longest.length - 1 });
  rejects("0", "NUMBER", { maxNumberTokenChars: 0 });
  rejects("1".repeat(129), "NUMBER");
  for (const text of ["0", "-0", "1e-4000", "-1e-4000", "1.2345", "1e308", "9007199254740993"]) {
    equal(readNativeFileJson(utf8(text)).value, JSON.parse(text));
  }
});

test("native file JSON rejects invalid grammar, holes, trailing data and incomplete prefixes", () => {
  const malformed = [
    "", " ", "undefined", "NaN", "Infinity", "-Infinity", "+1", "01", "-01", "1.", "1e", "1e+",
    "[1,]", "[,,]", '{"a":1,}', '{"a"}', "{a:0}", "[true false]", '{"a":true false}',
    '"\\x01"', '"\\u123"', '"\\uZZZZ"', '"\\q"', '"\n"', '"unterminated',
    "/*x*/0", "0 trailing", "00.1", "true null", "[0]\u000c", "\u00a00",
  ];
  for (const text of malformed) rejects(text, "SYNTAX");
  const complete = utf8('{"a":["x",1,false,null,{}]}');
  for (let end = 0; end < complete.length; end += 1) rejects(complete.slice(0, end));
});

test("native file JSON byte admission precedes UTF8 decode and rejects BOM and malformed UTF8", () => {
  for (const bytes of [
    [0xff], [0xc0, 0xaf], [0x22, 0xc3, 0x28, 0x22], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80],
  ]) rejects(new Uint8Array(bytes), "UTF8");
  rejects(new Uint8Array([0xef, 0xbb, 0xbf, 0x30]), "SYNTAX");
  const multibyte = utf8('"한글"');
  equal(readNativeFileJson(multibyte, { maxBytes: multibyte.byteLength }).value, "한글");
  rejects(multibyte, "BYTES", { maxBytes: multibyte.byteLength - 1 });
});

test("native file JSON never calls substituted limit/input getters or alternate parser callbacks", () => {
  let calls = 0;
  const limits = Object.defineProperty({}, "maxBytes", { get() { calls += 1; return 999; } });
  rejects("{}", "LIMITS", limits);
  const bytes = utf8("{}");
  Object.defineProperty(bytes, "byteLength", { get() { calls += 1; return 0; } });
  fails(() => readNativeFileJson(bytes), "INPUT");
  const fake = Object.defineProperty({}, "byteLength", { get() { calls += 1; return 2; } });
  fails(() => readNativeFileJson(fake as Uint8Array), "INPUT");
  const callback = () => { calls += 1; return 1; };
  fails(() => readNativeFileJson(utf8("0"), callback as Partial<NativeFileJsonLimits>), "LIMITS");
  equal(calls, 0);
});

test("native file JSON rejects invalid configuration, wrong views and shared input", () => {
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) rejects("0", "LIMITS", { maxValues: value });
  rejects("0", "LIMITS", { maxBytes: 64 * 1024 * 1024 + 1 });
  rejects("0", "LIMITS", { unexpected: 1 } as Partial<NativeFileJsonLimits>);
  for (const input of [new Uint16Array([0x30]), new DataView(new ArrayBuffer(1)), Object.create(Uint8Array.prototype)]) {
    fails(() => readNativeFileJson(input as Uint8Array), "INPUT");
  }
  if (typeof SharedArrayBuffer !== "undefined") {
    fails(() => readNativeFileJson(new Uint8Array(new SharedArrayBuffer(1))), "INPUT");
  }
  equal(DEFAULT_NATIVE_FILE_JSON_LIMITS.maxDepth, 32);
  ok(Object.isFrozen(DEFAULT_NATIVE_FILE_JSON_LIMITS));
});

test("native file JSON __proto__ remains an own data property without prototype mutation", () => {
  const text = '{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}}}';
  const value = readNativeFileJson(utf8(text)).value;
  deepEqual(value, JSON.parse(text));
  equal(Object.getPrototypeOf(value), Object.prototype);
  equal(Object.prototype.hasOwnProperty.call(value, "__proto__"), true);
  equal(Object.getOwnPropertyDescriptor(Object.prototype, "polluted"), undefined);
});

test("native file JSON result is detached from source bytes and deterministic across a normal corpus", () => {
  const bytes = utf8('{"a":[1,2],"b":"x"}');
  const result = readNativeFileJson(bytes);
  bytes.fill(0);
  deepEqual(result.value, { a: [1, 2], b: "x" });
  for (let index = 0; index < 128; index += 1) {
    const text = JSON.stringify({ key: `값${index}💡`, values: [index, index / 3, !!(index & 1), null], nested: { text: "a\n\\\"" } });
    deepEqual(readNativeFileJson(utf8(text)).value, JSON.parse(text));
  }
  rejects("0", "VALUES", { maxValues: 0 });
  equal(readNativeFileJson(utf8("[]"), { maxMembers: 0 }).usage.members, 0);
});
