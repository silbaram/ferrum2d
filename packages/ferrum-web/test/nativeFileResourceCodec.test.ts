import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { decodeNativeFileResourceGraph as decode, encodeNativeFileResourceGraph as encode } from "../src/nativeFileResourceCodec.js";
import type { NativeFileResourceCodecLimits, NativeFileResourceSections } from "../src/nativeFileResourceCodec.js";
import { ResourceBudget } from "../src/nativeFileResourceBudget.js";
import type { NativeFileResourceLimits, NativeFileResourceUsage } from "../src/nativeFileResourceBudget.js";

const utf8 = new TextEncoder();
const text = new TextDecoder();
type Wire = { format: string; version: number; byteOrder: string; root: unknown[]; nodes: unknown[][]; buffers: number[] };
function packet(value: unknown): NativeFileResourceSections { return encode(value, new ResourceBudget()); }
function manifest(p: NativeFileResourceSections): Wire { return JSON.parse(text.decode(p.manifestBytes)) as Wire; }
function changed(p: NativeFileResourceSections, mutate: (m: Wire) => void): NativeFileResourceSections {
  const m = manifest(p); mutate(m);
  return { manifestBytes: utf8.encode(JSON.stringify(m)), dataBytes: new Uint8Array(p.dataBytes) };
}
function read(p: NativeFileResourceSections, limits: Partial<NativeFileResourceCodecLimits> = {}): unknown {
  return decode(p.manifestBytes, p.dataBytes, new ResourceBudget(), limits);
}
function unchangedOnReject(p: NativeFileResourceSections, pattern = /DATA|LIMIT|SYNTAX|DUPLICATE_KEY/): void {
  const before = [new Uint8Array(p.manifestBytes), new Uint8Array(p.dataBytes)];
  throws(() => read(p), pattern);
  deepEqual(p.manifestBytes, before[0]); deepEqual(p.dataBytes, before[1]);
}
function budgetLimits(u: NativeFileResourceUsage): NativeFileResourceLimits {
  return { maxResources: u.resources, maxWork: u.work, maxMetadataBytes: u.metadataBytes,
    maxSourceBytes: u.sourceBytes, maxDecodedBytes: u.decodedBytes, maxGpuBytes: u.gpuBytes };
}
const categories = ["resources", "work", "metadataBytes", "sourceBytes", "decodedBytes", "gpuBytes"] as const;

test("resource codec preserves object, array, view and backing aliases without value deduplication", () => {
  const child = { value: "same" }, other = { value: "same" }, array = [child, child];
  const backing = new ArrayBuffer(32); new Uint8Array(backing).set(Array.from({ length: 32 }, (_, i) => i));
  const view = new Uint8Array(backing, 3, 7), otherView = new Uint8Array(backing, 3, 7);
  const separate = new Uint8Array(new Uint8Array(backing));
  const input = { child, alias: child, other, array, arrayAlias: array, view, viewAlias: view, otherView, separate };
  const p = packet(input), out = read(p) as typeof input;
  equal(out.child, out.alias); equal(out.array, out.arrayAlias); equal(out.array[0], out.child); equal(out.array[0], out.array[1]);
  ok(out.child !== child && out.child !== out.other); deepEqual(out.child, out.other);
  equal(out.view, out.viewAlias); ok(out.view !== out.otherView); equal(out.view.buffer, out.otherView.buffer);
  equal(out.view.byteOffset, 3); equal(out.view.length, 7); equal(out.otherView.byteOffset, 3);
  ok(out.view.buffer !== out.separate.buffer && out.view.buffer !== backing);
  deepEqual(new Uint8Array(out.view.buffer), new Uint8Array(backing));
  out.view[0] = 99; equal(out.otherView[0], 99); equal(view[0], 3); equal(out.separate[3], 3);
});

test("resource codec preserves four view kinds, overlap, raw f32 bits and empty views", () => {
  const buffer = new ArrayBuffer(32); const bits = new Uint32Array(buffer);
  bits.set([0x01020304, 0x12345678, 0x80000000, 0x7fc01234, 0x7f800000, 0xff800000, 0, 0xffffffff]);
  const source = { u8: new Uint8Array(buffer, 1, 13), clamped: new Uint8ClampedArray(buffer, 2, 12),
    u32: new Uint32Array(buffer, 4, 3), f32: new Float32Array(buffer, 8, 4), empty: new Float32Array(buffer, 32, 0) };
  const out = read(packet(source)) as typeof source;
  equal(Object.getPrototypeOf(out.u8), Uint8Array.prototype); equal(Object.getPrototypeOf(out.clamped), Uint8ClampedArray.prototype);
  equal(Object.getPrototypeOf(out.u32), Uint32Array.prototype); equal(Object.getPrototypeOf(out.f32), Float32Array.prototype);
  for (const key of ["u8", "clamped", "u32", "f32", "empty"] as const) {
    equal(out[key].buffer, out.u8.buffer); equal(out[key].byteOffset, source[key].byteOffset); equal(out[key].length, source[key].length);
  }
  deepEqual(new Uint32Array(out.f32.buffer), bits); ok(Object.is(out.f32[0], -0));
  equal(out.empty.length, 0); equal(out.empty.byteOffset, 32);
});

test("resource codec preserves finite f64 bits, undefined, Unicode and proto data properties", () => {
  const nil = Object.create(null) as Record<string, unknown>; nil["__proto__"] = "plain"; nil["constructor"] = undefined; nil["한글😀\ud800"] = "unicode key";
  const input = { numbers: [-0, 0, Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE],
    values: [undefined, null, false, true, "한글😀\u0000\ud800\udfff", "\ud800", "\udfff", "x\ud800Y\udfffz"], nil };
  Object.defineProperty(input, "__proto__", { value: { safe: true }, enumerable: true });
  const out = read(packet(input)) as typeof input & { __proto__: { safe: boolean } };
  for (let i = 0; i < input.numbers.length; i++) ok(Object.is(out.numbers[i], input.numbers[i]));
  deepEqual(out.values, input.values); equal(Object.getPrototypeOf(out), Object.prototype);
  equal(Object.getPrototypeOf(out.nil), null); equal(out.nil["__proto__"], "plain");
  ok(Object.prototype.hasOwnProperty.call(out.nil, "constructor")); equal(out.nil["constructor"], undefined); deepEqual(out.__proto__, { safe: true });
  equal((Object.prototype as { safe?: boolean }).safe, undefined);
  for (const v of [undefined, null, false, -0, "😀"]) ok(Object.is(read(packet(v)), v));
  for (const v of [NaN, Infinity, -Infinity, 1n, () => 0, Symbol("x")]) throws(() => packet(v), /DATA/);
});

test("resource codec rejects getters and exotic records without executing getters", () => {
  let calls = 0;
  for (const key of ["value", "hidden", Symbol("value")]) {
    const source = {}; Object.defineProperty(source, key, { enumerable: key !== "hidden", get: () => { calls++; throw Error("getter ran"); } });
    throws(() => packet(source), /DATA/);
  }
  const array = [1]; Object.defineProperty(array, "0", { enumerable: true, get: () => { calls++; throw Error("array getter ran"); } });
  throws(() => packet(array), /DATA/);
  const limits = {}; Object.defineProperty(limits, "maxDepth", { get: () => { calls++; return 0; } });
  throws(() => encode({}, new ResourceBudget(), limits), /DATA|LIMIT/);
  for (const value of [new Date(0), new Map(), new Set(), Object.create({ value: 1 }), [, 1], Object.assign([1], { extra: 2 })]) throws(() => packet(value), /DATA/);
  equal(calls, 0);
});

test("resource codec uses typed-array intrinsics and rejects shared, detached or unsupported views", () => {
  const source = new Uint8Array([1, 2, 3]); let calls = 0;
  for (const key of ["length", "byteLength", "byteOffset", "buffer", "slice", "set", "constructor", Symbol.iterator]) {
    Object.defineProperty(source, key, { get: () => { calls++; throw Error("shadow getter ran"); } });
  }
  deepEqual([...read(packet(source)) as Uint8Array], [1, 2, 3]); equal(calls, 0);
  const p = packet({ a: 1 });
  for (const key of ["length", "byteLength", "byteOffset", "buffer", "slice", "constructor"]) {
    Object.defineProperty(p.manifestBytes, key, { get: () => { calls++; throw Error("input getter ran"); } });
    Object.defineProperty(p.dataBytes, key, { get: () => { calls++; throw Error("input getter ran"); } });
  }
  // The bounded JSON reader deliberately rejects shadowed manifest bounds;
  // this remains a rejection without evaluating the accessor.
  throws(() => read(p), /INPUT/); equal(calls, 0);
  const cleanManifest = packet({ a: 1 }).manifestBytes;
  deepEqual(decode(cleanManifest, p.dataBytes, new ResourceBudget()), { a: 1 }); equal(calls, 0);
  for (const v of [new Uint8Array(new SharedArrayBuffer(4)), new DataView(new ArrayBuffer(4)), new Float64Array(2), new Int8Array(1)]) throws(() => packet(v), /DATA/);
  const detached = new Uint8Array(0); structuredClone(detached.buffer, { transfer: [detached.buffer] }); throws(() => packet(detached), /DATA/);
});

test("resource codec rejects corrupt references, duplicate keys, cycles and unreachable payload", () => {
  const p = packet({ item: { x: 1 } });
  const mutations: ((m: Wire) => void)[] = [
    m => { m.root = [4, 999]; }, m => { m.root = [4, -1]; }, m => { m.root = [6]; },
    m => { m.nodes[0] = [0, 1, [["a", [0]], ["a", [1, true]]]]; },
    m => { m.nodes[0] = [0, 1, [["cycle", [4, 0]]]]; },
    m => { m.nodes.push([0, 1, []]); }, m => { m.buffers.push(0); },
    m => { m.version = 2; }, m => { m.byteOrder = m.byteOrder === "le" ? "be" : "le"; },
    m => { m.root = [3, 0, 0x7ff00000]; }, m => { m.root = [3, 1, 0x7ff00000]; },
  ];
  for (const mutate of mutations) unchangedOnReject(changed(p, mutate));
  const cycle: Record<string, unknown> = {}; cycle["self"] = cycle;
  throws(() => packet(cycle), /DATA/); equal(cycle["self"], cycle);
});

test("resource codec rejects malformed view ranges and alignment before output construction", () => {
  const p = packet(new Uint32Array([1, 2]));
  for (const node of [[2, 2, 0, 1, 1], [2, 3, 0, 2, 1], [2, 2, 0, 12, 0], [2, 2, 0, 4, 2], [2, 2, 9, 0, 1], [2, 4, 0, 0, 1]]) {
    unchangedOnReject(changed(p, m => { m.nodes[0] = node; }));
  }
});

test("resource codec rejects invalid JSON, escaped equivalent duplicate keys and trailing bytes", () => {
  const p = packet({ a: 1 });
  for (const source of [text.decode(p.manifestBytes) + "{}", '{"format":1,"for\\u006dat":2}', '{"x":1e400}', '{"x":[,]}']) {
    unchangedOnReject({ manifestBytes: utf8.encode(source), dataBytes: new Uint8Array(p.dataBytes) }, /SYNTAX|NUMBER|DUPLICATE_KEY/);
  }
  const negativeZeroRef = text.decode(p.manifestBytes).replace('"root":[4,0]', '"root":[4,-0]');
  unchangedOnReject({ manifestBytes: utf8.encode(negativeZeroRef), dataBytes: new Uint8Array(p.dataBytes) });
  const invalidUtf8 = new Uint8Array([0xc0, 0x80]); unchangedOnReject({ manifestBytes: invalidUtf8, dataBytes: new Uint8Array(p.dataBytes) }, /UTF8/);
  const trailing = new Uint8Array(p.dataBytes.length + 1); trailing.set(p.dataBytes);
  unchangedOnReject({ manifestBytes: new Uint8Array(p.manifestBytes), dataBytes: trailing });
  for (const offset of [0, 8, 12]) { const bad = new Uint8Array(p.dataBytes); bad[offset] ^= 1; unchangedOnReject({ manifestBytes: new Uint8Array(p.manifestBytes), dataBytes: bad }); }
});

test("resource codec handles section view offsets and rejects mismatched section types", () => {
  const p = packet({ view: new Float32Array([-0, 0.5]) });
  const wrap = (v: Uint8Array): Uint8Array<ArrayBuffer> => { const a = new Uint8Array(v.length + 13); a.fill(0x88); a.set(v, 7); return new Uint8Array(a.buffer, 7, v.length); };
  const m = wrap(p.manifestBytes), d = wrap(p.dataBytes), before = [new Uint8Array(m.buffer), new Uint8Array(d.buffer)];
  const out = decode(m, d, new ResourceBudget()) as { view: Float32Array }; ok(Object.is(out.view[0], -0)); equal(out.view[1], 0.5);
  deepEqual(new Uint8Array(m.buffer), before[0]); deepEqual(new Uint8Array(d.buffer), before[1]);
  throws(() => decode(new Uint8ClampedArray(p.manifestBytes) as unknown as Uint8Array, p.dataBytes, new ResourceBudget()), /DATA/);
  throws(() => decode(p.manifestBytes, new Uint8Array(new SharedArrayBuffer(16)), new ResourceBudget()), /DATA/);
});

test("resource codec checks manifest, data, nodes and members at exact and one-below limits", () => {
  const value = { list: [new Uint8Array([1, 2, 3]), { text: "ab" }] }, p = packet(value), m = manifest(p);
  const members = m.nodes.reduce((n, node) => n + (node[0] === 0 ? (node[2] as unknown[]).length : node[0] === 1 ? (node[1] as unknown[]).length : 0), 0);
  const l = { maxManifestBytes: p.manifestBytes.length, maxDataBytes: p.dataBytes.length, maxNodes: m.nodes.length, maxMembers: members };
  deepEqual(encode(value, new ResourceBudget(), l), p); deepEqual(read(p, l), value);
  for (const key of Object.keys(l) as (keyof typeof l)[]) {
    const low = { ...l, [key]: l[key] - 1 }; throws(() => encode(value, new ResourceBudget(), low), /DATA|LIMIT/); throws(() => read(p, low), /DATA|LIMIT/);
  }
  equal((read(packet(1), { maxNodes: 0, maxMembers: 0, maxDepth: 0, maxDataBytes: 16 })), 1);
});

test("resource codec applies primitive leaf depth symmetrically on encode and decode", () => {
  for (const value of [{ p: 1 }, [undefined], { p: "x" }]) {
    const p = packet(value); deepEqual(read(p, { maxDepth: 1 }), value);
    deepEqual(encode(value, new ResourceBudget(), { maxDepth: 1 }), p);
    throws(() => encode(value, new ResourceBudget(), { maxDepth: 0 }), /DATA|LIMIT/);
    throws(() => read(p, { maxDepth: 0 }), /DATA|LIMIT/);
  }
});

test("resource codec checks longest shared diamond depth independent of property order", () => {
  const leaf = {}, shared = { child: leaf };
  for (const value of [{ short: shared, long: { hop: shared } }, { long: { hop: shared }, short: shared }]) {
    const p = packet(value); deepEqual(encode(value, new ResourceBudget(), { maxDepth: 3 }), p);
    const out = read(p, { maxDepth: 3 }) as typeof value; equal(out.short, out.long.hop); equal(out.short.child, out.long.hop.child);
    throws(() => encode(value, new ResourceBudget(), { maxDepth: 2 }), /DATA|LIMIT/);
    throws(() => read(p, { maxDepth: 2 }), /DATA|LIMIT/);
  }
});

test("resource codec uses the caller ledger cumulatively without resetting prior owner charges", () => {
  const value = { name: "payload😀", data: new Float32Array([-0, 0.5]), alias: undefined }, p = packet(value);
  const eb = new ResourceBudget(); encode(value, eb); const e = eb.usage();
  const db = new ResourceBudget(); decode(p.manifestBytes, p.dataBytes, db); const d = db.usage();
  const b = new ResourceBudget(); b.charge("resources", 1); b.work(2); b.metadata("prior"); b.charge("sourceBytes", 3); b.charge("decodedBytes", 4); b.charge("gpuBytes", 5);
  const start = b.usage(); encode(value, b); const out = decode(p.manifestBytes, p.dataBytes, b) as typeof value; ok(Object.is(out.data[0], -0));
  for (const key of categories) equal(b.usage()[key], start[key] + e[key] + d[key]);
  const exact = new ResourceBudget(budgetLimits(b.usage()));
  for (const key of categories) exact.charge(key, start[key]);
  encode(value, exact); decode(p.manifestBytes, p.dataBytes, exact); deepEqual(exact.usage(), b.usage());
  throws(() => encode(value, exact), /LIMIT/); deepEqual(exact.usage(), b.usage());
});

test("resource codec rejects each one-below shared byte/work budget and preserves inputs", () => {
  const value = { name: "data", view: new Uint8Array([1, 2, 3]) }, p = packet(value), original = new Uint8Array(value.view);
  for (const action of [(b: ResourceBudget) => encode(value, b), (b: ResourceBudget) => decode(p.manifestBytes, p.dataBytes, b)]) {
    const measured = new ResourceBudget(); action(measured); const usage = measured.usage(); const exact = budgetLimits(usage);
    action(new ResourceBudget(exact));
    for (const key of ["maxWork", "maxMetadataBytes", "maxSourceBytes", "maxDecodedBytes"] as const) {
      ok(exact[key] > 0); const b = new ResourceBudget({ ...exact, [key]: exact[key] - 1 }); throws(() => action(b), /LIMIT/);
      deepEqual(value.view, original); deepEqual(p, packet(value));
    }
  }
});

test("resource codec rejects negative-zero tags, prototypes, references and buffer lengths", () => {
  const root = Object.assign(Object.create(null) as Record<string, unknown>, { a: null }); const p = packet(root);
  const original = text.decode(p.manifestBytes);
  for (const [from, to] of [['"root":[4,0]', '"root":[4,-0]'], ['"nodes":[[0,0,', '"nodes":[[-0,0,'],
    ['"nodes":[[0,0,', '"nodes":[[0,-0,'], ['["a",[0]]', '["a",[-0]]']]) {
    const raw = original.replace(from, to); ok(raw !== original); unchangedOnReject({ manifestBytes: utf8.encode(raw), dataBytes: new Uint8Array(p.dataBytes) });
  }
  const empty = packet(new Uint8Array(0)); const raw = text.decode(empty.manifestBytes).replace('"buffers":[0]', '"buffers":[-0]');
  unchangedOnReject({ manifestBytes: utf8.encode(raw), dataBytes: new Uint8Array(empty.dataBytes) });
});

test("resource codec charges a whole shared backing even when the only view is empty or tiny", () => {
  for (const length of [0, 1]) {
    const bytes = new Uint8Array(1024); bytes[0] = 17; bytes[1023] = 29; const view = new Uint8Array(bytes.buffer, 100, length);
    const p = packet(view); equal(p.dataBytes.length, 16 + 1024); deepEqual(manifest(p).buffers, [1024]);
    const out = read(p, { maxDataBytes: 1040 }) as Uint8Array; equal(out.byteOffset, 100); equal(out.length, length);
    deepEqual(new Uint8Array(out.buffer), bytes); ok(out.buffer !== bytes.buffer);
    throws(() => encode(view, new ResourceBudget(), { maxDataBytes: 1039 }), /LIMIT/);
    throws(() => read(p, { maxDataBytes: 1039 }), /LIMIT/);
    deepEqual(bytes.subarray(0, 1), new Uint8Array([17])); equal(bytes[1023], 29);
  }
  throws(() => packet(new ArrayBuffer(4)), /DATA/);
});

test("resource codec admits depth64 exactly and traverses an exponentially shared DAG within one ledger", () => {
  let deep: Record<string, unknown> = {};
  for (let i = 0; i < 64; i++) deep = { next: deep };
  const p = packet(deep); deepEqual(read(p, { maxDepth: 64 }), deep);
  throws(() => encode(deep, new ResourceBudget(), { maxDepth: 63 }), /LIMIT/); throws(() => read(p, { maxDepth: 63 }), /LIMIT/);
  throws(() => packet({ next: deep }), /LIMIT/);
  unchangedOnReject(changed(p, m => { m.nodes.push([0, 1, [["next", m.root]]]); m.root = [4, m.nodes.length - 1]; }));
  let shared: Record<string, unknown> = {};
  for (let i = 0; i < 32; i++) shared = { left: shared, right: shared };
  const b = new ResourceBudget({ maxWork: 100_000 }); const sections = encode(shared, b);
  let out = decode(sections.manifestBytes, sections.dataBytes, b) as Record<string, unknown>;
  for (let i = 0; i < 32; i++) { equal(out["left"], out["right"]); out = out["left"] as Record<string, unknown>; }
  deepEqual(out, {}); ok(b.usage().work < 100_000); equal(manifest(sections).nodes.length, 33);
});
