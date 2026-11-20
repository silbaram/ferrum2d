/** @internal Decode the versioned cold packet returned by the admitted native
 * candidate. A packet is metadata, never Engine access, historical entity proof,
 * resource-content validation or a whole-session Ready token. */
import { ResourceBudget, resourceInteger } from "./nativeFileResourceBudget.js";
import type { NativeDataSceneVariableLayoutEntry } from "./dataSceneVariables.js";
import type { GameplayEntityHandle } from "./gameplayAuthoringTypes.js";

const STRIDES = [20, 20, 8, 32, 16, 20, 20, 20, 16, 20, 12, 12, 68, 136] as const;
const START = 16 + STRIDES.length * 16;
const MAX_BYTES = 64 * 1024 * 1024;
const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!;
const TYPES = ["integer", "real", "bool"] as const;
const SCOPES = ["global", "scene"] as const;

export interface NativeFileFactTable {
  readonly count: number;
  readonly stride: number;
  /** Exact little-endian packet words; no float ID conversion or row sorting. */
  u32(row: number, word: number): number;
}
export interface NativeFileNativeFacts {
  readonly scene: "builtin" | "data";
  readonly epoch: number;
  readonly spatialRevision: number;
  /** Actual canonical SDK reader facts; raw saved counters above are separate. */
  readonly configurationRevision: number;
  readonly dataSceneEpoch: number;
  readonly variableLayout: readonly NativeDataSceneVariableLayoutEntry[];
  /** Same names/order as the native usage schema; logical counters, not RSS. */
  readonly usage: readonly number[];
  table(kind: number): NativeFileFactTable;
  classify(handle: GameplayEntityHandle): "live-exact" | "stored-slot-not-current" | "unknown-slot";
  /** Row in table4 only for a current live exact handle. */
  liveEntityRow(handle: GameplayEntityHandle): number | undefined;
}

export function readNativeFileNativeFacts(input: Uint8Array, b: ResourceBudget, maxBytes = MAX_BYTES): NativeFileNativeFacts {
  resourceInteger(maxBytes, "native facts limit", 0, MAX_BYTES);
  let length: number;
  try { length = byteLength.call(input); } catch { return b.fail("DATA", "native facts bytes"); }
  if (length > maxBytes) return b.fail("LIMIT", "native facts bytes");
  if (length < START) return b.fail("DATA", "native facts header");
  const bytes = b.bytes(input, "decodedBytes"), view = new DataView(bytes.buffer);
  const require = (ok: unknown, field: string): void => { if (!ok) b.fail("DATA", field); };
  require(view.getUint32(0, true) === 0x3150464e && view.getUint32(4, true) === 1
    && view.getUint32(8, true) === length && view.getUint32(12, true) === STRIDES.length, "native facts version/header");
  b.work(length); b.charge("decodedBytes", STRIDES.length * 64);
  const tables: NativeFileFactTable[] = [], offsets: number[] = [];
  let end = START;
  for (let index = 0; index < STRIDES.length; index++) {
    const at = 16 + index * 16, kind = view.getUint32(at, true), stride = view.getUint32(at + 4, true), count = view.getUint32(at + 8, true), offset = view.getUint32(at + 12, true);
    require(kind === index + 1 && stride === STRIDES[index] && offset === end, "native facts directory");
    const size = count * stride;
    require(size <= length - end, "native facts table length"); end += size; offsets.push(offset);
    const table: NativeFileFactTable = Object.freeze({ count, stride, u32: (row: number, word: number) => {
      resourceInteger(row, "native facts row", 0, count - 1);
      resourceInteger(word, "native facts word", 0, stride / 4 - 1);
      b.work(1); return view.getUint32(offset + row * stride + word * 4, true);
    } });
    tables.push(table);
  }
  require(end === length && tables[0].count === 1 && tables[13].count === 1, "native facts complete tables");
  const get = (kind: number, row: number, word: number) => tables[kind - 1].u32(row, word);
  const boolean = (kind: number, row: number, word: number) => { const v = get(kind, row, word); require(v <= 1, "native facts boolean"); return v === 1; };
  const optional = (kind: number, row: number, word: number, payloadWords = 1) => {
    const present = boolean(kind, row, word);
    if (!present) for (let i = 1; i <= payloadWords; i++) require(get(kind, row, word + i) === 0, "native facts absent payload");
    return present;
  };
  require(get(1, 0, 0) <= 1 && tables[1].count <= 64 && tables[2].count <= 1024 * 1024
    && tables[3].count <= tables[2].count && tables[8].count <= 1, "native facts counts/context");
  require(get(1, 0, 4) === (get(1, 0, 0) === 0 ? 0 : get(1, 0, 1)), "native facts canonical epoch");
  b.charge("decodedBytes", tables[2].count * 4 + tables[1].count * 64);
  b.work(tables[2].count + tables[3].count);
  let live: Uint32Array;
  try { live = new Uint32Array(tables[2].count); }
  catch { return b.fail("ALLOCATION", "native live slot index"); }
  let alive = 0;
  for (let i = 0; i < tables[2].count; i++) if (boolean(3, i, 1)) alive++;
  require(alive === tables[3].count, "native facts live census");
  for (let i = 0; i < tables[3].count; i++) {
    const id = get(4, i, 0);
    require(id < live.length && !live[id] && boolean(3, id, 1) && get(4, i, 1) === get(3, id, 0), "native facts live handle");
    live[id] = i + 1;
    boolean(4, i, 3); optional(4, i, 4); boolean(4, i, 6); boolean(4, i, 7);
  }
  const variables: NativeDataSceneVariableLayoutEntry[] = [], slots = new Set<number>();
  for (let i = 0; i < tables[1].count; i++) {
    const slot = get(2, i, 0), type = get(2, i, 1), scope = get(2, i, 2), value = view.getFloat64(offsets[1] + i * 20 + 12, true);
    require(slot >= 1 && slot <= 64 && !slots.has(slot) && type < TYPES.length && scope < SCOPES.length && Number.isFinite(value), "native facts variable layout");
    require(type !== 0 || Number.isSafeInteger(value), "native facts integer default");
    require(type !== 2 || value === 0 || value === 1, "native facts bool default"); slots.add(slot);
    variables.push(Object.freeze({ slot, type: TYPES[type], scope: SCOPES[scope], default: type === 2 ? value !== 0 : value }));
  }
  for (let i = 0; i < tables[4].count; i++) require(get(5, i, 2) <= 4, "native facts texture role");
  for (let i = 0; i < tables[5].count; i++) boolean(6, i, 4);
  for (let i = 0; i < tables[6].count; i++) require(get(7, i, 2) <= 1, "native facts model role");
  for (let i = 0; i < tables[7].count; i++) boolean(8, i, 4);
  for (let i = 0; i < tables[9].count; i++) { optional(10, i, 1); optional(10, i, 3); }
  for (let i = 0; i < tables[12].count; i++) {
    require(get(13, i, 0) <= 42 && get(13, i, 1) <= 1 && get(13, i, 9) <= 6
      && get(13, i, 11) <= 10 && get(13, i, 12) <= 1, "native facts resource enum");
    optional(13, i, 6, 2); optional(13, i, 15);
    if (get(13, i, 9) !== 5) require(get(13, i, 10) === 0, "native facts domain parameter");
    if (get(13, i, 12) === 1) require(Number.isFinite(view.getFloat32(offsets[12] + i * 68 + 13 * 4, true)), "native facts finite ID packet");
  }
  const usage: number[] = [];
  for (let i = 0; i < 17; i++) {
    const value = view.getUint32(offsets[13] + i * 8, true) + view.getUint32(offsets[13] + i * 8 + 4, true) * 4294967296;
    require(Number.isSafeInteger(value), "native facts usage precision"); usage.push(value);
  }
  const classify = (handle: GameplayEntityHandle) => {
    const id = resourceInteger(handle.entityId, "native handle id"), generation = resourceInteger(handle.entityGeneration, "native handle generation");
    b.work(1);
    return id >= live.length ? "unknown-slot" as const : live[id] && get(3, id, 0) === generation
      ? "live-exact" as const : "stored-slot-not-current" as const;
  };
  return Object.freeze({ scene: get(1, 0, 0) === 0 ? "builtin" : "data", epoch: get(1, 0, 1), spatialRevision: get(1, 0, 2),
    configurationRevision: get(1, 0, 3), dataSceneEpoch: get(1, 0, 4),
    variableLayout: Object.freeze(variables), usage: Object.freeze(usage),
    table: (kind: number) => tables[resourceInteger(kind, "native facts table kind", 1, STRIDES.length) - 1], classify,
    liveEntityRow: (handle: GameplayEntityHandle) => classify(handle) === "live-exact" ? live[handle.entityId] - 1 : undefined,
  });
}
