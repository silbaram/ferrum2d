/** @internal Two owned resource sections, never a GPU/host/native importer.
 * Owner-curated ordinary records/arrays form a DAG; exact object/view/backing
 * aliases survive. Owners still validate their DTOs and capture/publication
 * fences. Source objects are an actual owner's curated cut, not a hostile
 * Proxy/global sandbox. Quotas are logical requests, not a process/RSS cap. */
import { readNativeFileJson } from "./nativeFileJson.js";
import { ResourceBudget, resourceInteger, resourceKeys } from "./nativeFileResourceBudget.js";

export interface NativeFileResourceCodecLimits {
  readonly maxManifestBytes: number;
  readonly maxDataBytes: number;
  readonly maxNodes: number;
  readonly maxMembers: number;
  readonly maxDepth: number;
}
export interface NativeFileResourceSections {
  readonly manifestBytes: Uint8Array<ArrayBuffer>;
  readonly dataBytes: Uint8Array<ArrayBuffer>;
}
const DEFAULTS: NativeFileResourceCodecLimits = Object.freeze({
  maxManifestBytes: 4 * 1024 * 1024, maxDataBytes: 64 * 1024 * 1024,
  maxNodes: 65536, maxMembers: 262144, maxDepth: 64,
});
const HEADER = 16, MAGIC = [70, 50, 68, 82, 69, 83, 0, 0];
const encoder = new TextEncoder(), stringify = JSON.stringify;
const tp = Object.getPrototypeOf(Uint8Array.prototype);
const tagOf = Object.getOwnPropertyDescriptor(tp, Symbol.toStringTag)!.get!;
const bufferOf = Object.getOwnPropertyDescriptor(tp, "buffer")!.get!;
const lengthOf = Object.getOwnPropertyDescriptor(tp, "length")!.get!;
const offsetOf = Object.getOwnPropertyDescriptor(tp, "byteOffset")!.get!;
const bytesOf = Object.getOwnPropertyDescriptor(tp, "byteLength")!.get!;
const bufferBytes = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const copy = Uint8Array.prototype.set;
const scalar = new DataView(new ArrayBuffer(8));
const byteOrder = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 4 ? "le" : "be";
type Value = [0] | [1, boolean] | [2, string] | [3, number, number] | [4, number] | [5];
type ViewTag = 0 | 1 | 2 | 3;
type Node = [0, 0 | 1, [string, Value][]] | [1, Value[]] | [2, ViewTag, number, number, number];
interface Manifest {
  format: "ferrum-native-resource-graph";
  version: 1;
  byteOrder: "le" | "be";
  root: Value;
  nodes: Node[];
  buffers: number[];
}
const tags = ["Uint8Array", "Uint8ClampedArray", "Uint32Array", "Float32Array"] as const;
const widths = [1, 1, 4, 4] as const;
function requireData(ok: unknown, b: ResourceBudget, field: string): asserts ok {
  if (!ok) b.fail("DATA", field);
}
function limits(input: Partial<NativeFileResourceCodecLimits>, b: ResourceBudget, ceiling = DEFAULTS): NativeFileResourceCodecLimits {
  resourceKeys(input, Object.keys(DEFAULTS), b);
  const result = { ...ceiling };
  for (const key of Object.keys(DEFAULTS) as (keyof NativeFileResourceCodecLimits)[]) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (d) result[key] = resourceInteger(d.value, key, 0, ceiling[key]);
  }
  return result;
}
interface View { buffer: ArrayBuffer; offset: number; bytes: number; length: number; tag: number }
function view(value: unknown, b: ResourceBudget, expected?: ViewTag): View {
  try {
    requireData(ArrayBuffer.isView(value), b, "view");
    const tag = tags.indexOf(tagOf.call(value));
    requireData(tag >= 0 && (expected === undefined || tag === expected), b, "view type");
    const buffer: ArrayBuffer = bufferOf.call(value);
    bufferBytes.call(buffer); // Ordinary buffer brand: rejects SharedArrayBuffer.
    requireData(!resizable?.call(buffer), b, "resizable backing");
    const offset = offsetOf.call(value), bytes = bytesOf.call(value), length = lengthOf.call(value);
    // Detect detached/out-of-bounds backing, including a zero-length view.
    new Uint8Array(buffer, offset, bytes);
    return { buffer, offset, bytes, length, tag };
  } catch { return b.fail("DATA", "ordinary attached view"); }
}
function allocate<T>(operation: () => T, b: ResourceBudget): T {
  try { return operation(); } catch { return b.fail("ALLOCATION", "resource codec output"); }
}
function numberValue(value: number): [3, number, number] {
  scalar.setFloat64(0, value, true);
  return [3, scalar.getUint32(0, true), scalar.getUint32(4, true)];
}
function stringBytes(value: string): number {
  let size = 2;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 34 || c === 92 || c === 8 || c === 9 || c === 10 || c === 12 || c === 13) size += 2;
    else if (c < 32) size += 6;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { size += 4; i++; } else size += 6;
    } else if (c >= 0xdc00 && c <= 0xdfff) size += 6;
    else size += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return size;
}
/** Measure our own acyclic schema before stringify/UTF-8 output allocation. */
function jsonBytes(value: unknown, b: ResourceBudget): number {
  b.work(1);
  if (value === null) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") return String(value).length;
  if (typeof value === "string") { b.work(value.length); return stringBytes(value); }
  if (Array.isArray(value)) {
    let size = 2;
    for (let i = 0; i < value.length; i++) size += (i ? 1 : 0) + jsonBytes(value[i], b);
    return size;
  }
  let size = 2, n = 0;
  for (const key of Object.keys(value as object)) {
    b.work(key.length);
    size += (n++ ? 1 : 0) + stringBytes(key) + 1 + jsonBytes((value as Record<string, unknown>)[key], b);
  }
  return size;
}

function checkDag(edges: readonly number[][], nonempty: readonly boolean[], root: Value, b: ResourceBudget, maximum: number): void {
  b.charge("decodedBytes", edges.length * 5);
  const state = new Uint8Array(edges.length), heights = new Uint32Array(edges.length);
  let reached = 0;
  const check = (id: number, depth: number): number => {
    b.work(1);
    if (depth > maximum) b.fail("LIMIT", "graph depth");
    requireData(state[id] !== 1, b, "cyclic resource graph");
    if (state[id] === 2) {
      if (depth + heights[id] > maximum) b.fail("LIMIT", "shared graph depth");
      return heights[id];
    }
    state[id] = 1; reached++;
    // Primitive members also add one semantic level, even with no node edge.
    let height = nonempty[id] ? 1 : 0;
    for (const child of edges[id]) height = Math.max(height, 1 + check(child, depth + 1));
    if (depth + height > maximum) b.fail("LIMIT", "graph depth");
    state[id] = 2; heights[id] = height;
    return height;
  };
  if (root[0] === 4) check(root[1], 0);
  requireData(reached === edges.length, b, "unreachable node");
}

export function encodeNativeFileResourceGraph(
  value: unknown, b: ResourceBudget, overrides: Partial<NativeFileResourceCodecLimits> = {},
): NativeFileResourceSections { return encodeGraph(value, b, overrides, DEFAULTS); }
function encodeGraph(value: unknown, b: ResourceBudget, overrides: Partial<NativeFileResourceCodecLimits>, ceiling: NativeFileResourceCodecLimits): NativeFileResourceSections {
  const l = limits(overrides, b, ceiling), nodes: Node[] = [], buffers: number[] = [], sources: ArrayBuffer[] = [];
  const seen = new WeakMap<object, number>(), active = new WeakSet<object>(), backing = new WeakMap<ArrayBuffer, number>();
  let members = 0, dataLength = HEADER;
  const visit = (v: unknown, depth: number): Value => {
    b.work(1);
    if (depth > l.maxDepth) b.fail("LIMIT", "graph depth");
    if (v === null) return [0];
    if (v === undefined) return [5];
    if (typeof v === "boolean") return [1, v];
    if (typeof v === "string") { b.metadata(v); return [2, v]; }
    if (typeof v === "number") { requireData(Number.isFinite(v), b, "finite scalar"); return numberValue(v); }
    requireData(typeof v === "object", b, "graph value");
    requireData(!active.has(v), b, "cyclic resource graph");
    const previous = seen.get(v);
    if (previous !== undefined) return [4, previous];
    if (nodes.length >= l.maxNodes) b.fail("LIMIT", "graph nodes");
    b.charge("decodedBytes", 64);
    const id = nodes.length; seen.set(v, id); nodes.push([1, []]); active.add(v);
    if (ArrayBuffer.isView(v)) {
      const data = view(v, b);
      let index = backing.get(data.buffer);
      if (index === undefined) {
        const size = bufferBytes.call(data.buffer) as number;
        if (size > l.maxDataBytes - dataLength) b.fail("LIMIT", "data bytes");
        dataLength += size;
        index = buffers.length; backing.set(data.buffer, index); buffers.push(size); sources.push(data.buffer);
        b.charge("decodedBytes", 32);
      }
      nodes[id] = [2, data.tag as ViewTag, index, data.offset, data.length];
    } else {
      const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
      requireData(array ? proto === Array.prototype : proto === Object.prototype || proto === null, b, "plain graph node");
      const length = array ? v.length : 0;
      if (array && length > l.maxMembers - members) b.fail("LIMIT", "array members");
      b.work(length); b.charge("decodedBytes", length * 8);
      const keys = Reflect.ownKeys(v), entries: [string, Value][] = [], values: Value[] = [];
      for (const key of keys) {
        b.work(1);
        if (array && key === "length") continue;
        requireData(typeof key === "string", b, "symbol key");
        const d = Object.getOwnPropertyDescriptor(v, key);
        requireData(d && "value" in d && d.enumerable, b, "graph data descriptor");
        if (++members > l.maxMembers) b.fail("LIMIT", "graph members");
        b.metadata(key); b.charge("decodedBytes", 24);
        if (array) {
          requireData(String(values.length) === key, b, "dense array index");
          values.push(visit(d.value, depth + 1));
        } else entries.push([key, visit(d.value, depth + 1)]);
      }
      requireData(!array || values.length === length, b, "sparse resource array");
      nodes[id] = array ? [1, values] : [0, proto === null ? 0 : 1, entries];
    }
    active.delete(v);
    return [4, id];
  };
  const root = visit(value, 0);
  b.charge("decodedBytes", nodes.length * 16 + members * 8);
  const edges: number[][] = [], nonempty: boolean[] = [];
  for (const node of nodes) {
    const children: number[] = [];
    const add = (v: Value): void => { b.work(1); if (v[0] === 4) children.push(v[1]); };
    if (node[0] === 0) { for (const [, v] of node[2]) add(v); nonempty.push(node[2].length > 0); }
    else if (node[0] === 1) { for (const v of node[1]) add(v); nonempty.push(node[1].length > 0); }
    else nonempty.push(false);
    edges.push(children);
  }
  checkDag(edges, nonempty, root, b, l.maxDepth);
  if (dataLength > l.maxDataBytes) b.fail("LIMIT", "data header");
  const manifest: Manifest = { format: "ferrum-native-resource-graph", version: 1, byteOrder, root, nodes, buffers };
  const size = jsonBytes(manifest, b);
  if (size > l.maxManifestBytes) b.fail("LIMIT", "manifest bytes");
  b.charge("sourceBytes", size + dataLength);
  b.charge("decodedBytes", size * 3 + dataLength);
  b.work(size + dataLength);
  const manifestBytes = allocate(() => encoder.encode(stringify(manifest)), b);
  requireData(manifestBytes.length === size, b, "manifest size");
  const dataBytes = allocate(() => new Uint8Array(dataLength), b);
  copy.call(dataBytes, MAGIC);
  const header = new DataView(dataBytes.buffer);
  header.setUint32(8, 1, true); header.setUint32(12, dataLength - HEADER, true);
  let at = HEADER;
  for (let i = 0; i < sources.length; i++) {
    // Immutable owner cut/fence is the caller's contract. No URL refetch,
    // iterator/species/user callback or value-based buffer deduplication.
    let source: Uint8Array;
    try { source = new Uint8Array(sources[i], 0, buffers[i]); }
    catch { return b.fail("DATA", "changed backing"); }
    copy.call(dataBytes, source, at); at += buffers[i];
  }
  return Object.freeze({ manifestBytes, dataBytes });
}

function tuple(value: unknown, length: number, b: ResourceBudget): asserts value is unknown[] {
  requireData(Array.isArray(value) && value.length === length, b, "tuple");
}
function uint(value: unknown, b: ResourceBudget, maximum = 0xffff_ffff): number {
  requireData(typeof value === "number" && !Object.is(value, -0), b, "canonical integer");
  return resourceInteger(value, "graph integer", 0, maximum);
}
function checkedValue(value: unknown, count: number, b: ResourceBudget): Value {
  requireData(Array.isArray(value), b, "value tuple");
  uint(value[0], b, 5);
  switch (value[0]) {
    case 0: case 5: tuple(value, 1, b); break;
    case 1: tuple(value, 2, b); requireData(typeof value[1] === "boolean", b, "boolean"); break;
    case 2: tuple(value, 2, b); requireData(typeof value[1] === "string", b, "string"); b.metadata(value[1]); break;
    case 3:
      tuple(value, 3, b); scalar.setUint32(0, uint(value[1], b), true); scalar.setUint32(4, uint(value[2], b), true);
      requireData(Number.isFinite(scalar.getFloat64(0, true)), b, "finite number bits"); break;
    case 4: tuple(value, 2, b); requireData(uint(value[1], b) < count, b, "node reference"); break;
    default: b.fail("DATA", "value tag");
  }
  b.work(1);
  return value as Value;
}

/** Validate the complete bounded graph/ranges before constructing output owners. */
export function decodeNativeFileResourceGraph(
  manifestBytes: Uint8Array, dataBytes: Uint8Array, b: ResourceBudget,
  overrides: Partial<NativeFileResourceCodecLimits> = {},
): unknown { return decodeGraph(manifestBytes, dataBytes, b, overrides, DEFAULTS); }
function decodeGraph(manifestBytes: Uint8Array, dataBytes: Uint8Array, b: ResourceBudget, overrides: Partial<NativeFileResourceCodecLimits>, ceiling: NativeFileResourceCodecLimits): unknown {
  const l = limits(overrides, b, ceiling), mb = view(manifestBytes, b, 0), db = view(dataBytes, b, 0);
  if (mb.bytes > l.maxManifestBytes || db.bytes > l.maxDataBytes) b.fail("LIMIT", "section bytes");
  b.charge("sourceBytes", mb.bytes + db.bytes); b.work(mb.bytes + db.bytes);
  // Conservative JSON staging allowance. Native parse/reflect bookkeeping is
  // logical metadata, not an exact JS heap or driver-memory estimate.
  b.charge("decodedBytes", mb.bytes * 32);
  const input = readNativeFileJson(manifestBytes, { maxBytes: l.maxManifestBytes, maxDepth: 32,
    maxValues: 1024 * 1024, maxMembers: 1024 * 1024, maxStringCodeUnits: 4 * 1024 * 1024,
    maxTotalStringCodeUnits: 16 * 1024 * 1024 }).value;
  requireData(input !== null && typeof input === "object", b, "manifest");
  resourceKeys(input, ["format", "version", "byteOrder", "root", "nodes", "buffers"], b);
  const m = input as Record<string, unknown>;
  requireData(m.format === "ferrum-native-resource-graph" && m.version === 1, b, "resource schema");
  requireData(m.byteOrder === byteOrder, b, "incompatible buffer byte order");
  requireData(Array.isArray(m.nodes) && m.nodes.length <= l.maxNodes && Array.isArray(m.buffers)
    && m.buffers.length <= l.maxNodes, b, "tables");
  const nodes = m.nodes as unknown[], sizes = m.buffers as unknown[];
  b.work(nodes.length + sizes.length); b.charge("decodedBytes", nodes.length * 80 + sizes.length * 24);
  const usedBuffers = new Set<number>(), edges: number[][] = [], nonempty: boolean[] = [], lengths: number[] = [];
  let total = HEADER, members = 0;
  for (const size of sizes) { const n = uint(size, b, l.maxDataBytes); if (n > l.maxDataBytes - total) b.fail("LIMIT", "buffer lengths"); total += n; lengths.push(n); }
  requireData(db.bytes === total && total >= HEADER, b, "data length");
  const binary = new DataView(db.buffer, db.offset, db.bytes);
  for (let i = 0; i < MAGIC.length; i++) requireData(binary.getUint8(i) === MAGIC[i], b, "data magic");
  requireData(binary.getUint32(8, true) === 1 && binary.getUint32(12, true) === total - HEADER, b, "data header");
  const root = checkedValue(m.root, nodes.length, b);
  for (const raw of nodes) {
    requireData(Array.isArray(raw), b, "node");
    uint(raw[0], b, 2);
    const children: number[] = [];
    const edge = (v: unknown): void => { const item = checkedValue(v, nodes.length, b); if (item[0] === 4) children.push(item[1]); };
    if (raw[0] === 0 || raw[0] === 1) {
      const record = raw[0] === 0;
      tuple(raw, record ? 3 : 2, b);
      if (record) uint(raw[1], b, 1);
      const entries = raw[record ? 2 : 1];
      requireData(Array.isArray(entries), b, "node members");
      if (entries.length > l.maxMembers - members) b.fail("LIMIT", "graph members");
      members += entries.length; b.work(entries.length); b.charge("decodedBytes", entries.length * 24);
      const keys = new Set<string>();
      for (const entry of entries) {
        if (record) {
          tuple(entry, 2, b); requireData(typeof entry[0] === "string" && !keys.has(entry[0]), b, "duplicate/property key");
          keys.add(entry[0]); b.metadata(entry[0]); edge(entry[1]);
        } else edge(entry);
      }
      nonempty.push(entries.length > 0);
    } else {
      tuple(raw, 5, b); requireData(raw[0] === 2, b, "node tag");
      const tag = uint(raw[1], b, 3), index = uint(raw[2], b), offset = uint(raw[3], b), length = uint(raw[4], b);
      requireData(index < lengths.length && offset % widths[tag] === 0 && offset <= lengths[index]
        && length <= (lengths[index] - offset) / widths[tag], b, "typed view range");
      usedBuffers.add(index);
      nonempty.push(false);
    }
    edges.push(children);
  }
  requireData(usedBuffers.size === sizes.length, b, "unreferenced backing");
  checkDag(edges, nonempty, root, b, l.maxDepth);
  // Only now copy buffers and create the ordinary output graph. Distinct equal
  // buffers remain distinct; views reuse exactly one new backing per source.
  b.charge("decodedBytes", total - HEADER); b.work(total - HEADER);
  const backings: ArrayBuffer[] = []; let at = HEADER;
  for (const size of lengths) {
    const target = allocate(() => new Uint8Array(size), b);
    copy.call(target, new Uint8Array(db.buffer, db.offset + at, size)); at += size; backings.push(target.buffer);
  }
  const out: unknown[] = nodes.map(raw => {
    const n = raw as Node;
    if (n[0] === 0) return n[1] ? {} : Object.create(null);
    if (n[0] === 1) return allocate(() => new Array(n[1].length), b);
    const buffer = backings[n[2]], offset = n[3], length = n[4];
    return allocate(() => n[1] === 0 ? new Uint8Array(buffer, offset, length)
      : n[1] === 1 ? new Uint8ClampedArray(buffer, offset, length)
      : n[1] === 2 ? new Uint32Array(buffer, offset, length) : new Float32Array(buffer, offset, length), b);
  });
  const valueOf = (v: Value): unknown => {
    switch (v[0]) {
      case 0: return null;
      case 1: case 2: return v[1];
      case 3: scalar.setUint32(0, v[1], true); scalar.setUint32(4, v[2], true); return scalar.getFloat64(0, true);
      case 4: return out[v[1]];
      case 5: return undefined;
    }
  };
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] as Node;
    if (n[0] === 0) for (const [key, value] of n[2]) Object.defineProperty(out[i], key, { value: valueOf(value), enumerable: true, writable: true, configurable: true });
    else if (n[0] === 1) for (let j = 0; j < n[1].length; j++) (out[i] as unknown[])[j] = valueOf(n[1][j]);
  }
  return valueOf(root);
}

/** @internal Fixed owner profiles. Existing resource entries retain 4MiB and
 * exact charges; no file/caller-supplied ceilings are admitted here. */
const AUTHORING_METADATA = Object.freeze({ ...DEFAULTS, maxManifestBytes: 16 * 1024 * 1024, maxDataBytes: 16 });
const VARIABLE_METADATA = Object.freeze({ ...DEFAULTS, maxDataBytes: 16 });
export function encodeNativeFileMetadataGraph(value: unknown, b: ResourceBudget, kind: "variables" | "authoring"): NativeFileResourceSections {
  if (kind !== "variables" && kind !== "authoring") b.fail("DATA", "metadata section kind");
  return encodeGraph(value, b, {}, kind === "authoring" ? AUTHORING_METADATA : VARIABLE_METADATA);
}
export function decodeNativeFileMetadataGraph(manifest: Uint8Array, data: Uint8Array, b: ResourceBudget, kind: "variables" | "authoring"): unknown {
  if (kind !== "variables" && kind !== "authoring") b.fail("DATA", "metadata section kind");
  return decodeGraph(manifest, data, b, {}, kind === "authoring" ? AUTHORING_METADATA : VARIABLE_METADATA);
}
