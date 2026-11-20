import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { readNativeFileNativeFacts } from "../src/nativeFileNativeFacts.js";
import { ResourceBudget, type NativeFileResourceUsage } from "../src/nativeFileResourceBudget.js";

const STRIDES = [20, 20, 8, 32, 16, 20, 20, 20, 16, 20, 12, 12, 68, 136];
function words(...values: number[]): Uint8Array {
  const result = new Uint8Array(values.length * 4), view = new DataView(result.buffer);
  values.forEach((value, i) => view.setUint32(i * 4, value, true)); return result;
}
/** Independent small schema fixture. The actual native encoder is also checked
 * through fresh production Wasm during file coordinator integration. */
function packet(): Uint8Array<ArrayBuffer> {
  const variable = words(7, 1, 0, 0, 0); new DataView(variable.buffer).setFloat64(12, -0, true);
  const data = [words(1, 9, 12, 7, 9), variable,
    words(2, 0, 9, 1, 0xffffffff, 0), words(1, 9, 1, 1, 1, 3, 0, 0),
    words(1, 9, 0, 0), words(1, 9, 0, 17, 1), words(1, 9, 1, 2, 0), words(1, 9, 3, 4, 0),
    words(2, 3, 9, 1), words(0, 1, 0, 1, 2), words(0, 0, 17), words(0, 0, 0),
    words(35, 0, 4, 5, 6, 7, 0, 0, 0, 0, 0, 0, 1, 0x80000000, 0x12345678, 1, 0xffffffff),
    new Uint8Array(136)];
  const length = 240 + data.reduce((n, row) => n + row.length, 0), result = new Uint8Array(length), view = new DataView(result.buffer);
  result.set(words(0x3150464e, 1, length, 14)); let end = 240;
  for (let i = 0; i < data.length; i++) {
    result.set(words(i + 1, STRIDES[i], data[i].length / STRIDES[i], end), 16 + i * 16);
    result.set(data[i], end); end += data[i].length;
  }
  view.setUint32(length - 136, length, true); return result;
}
function offset(p: Uint8Array, kind: number): number { return new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(16 + (kind - 1) * 16 + 12, true); }
function changed(mutate: (v: DataView, p: Uint8Array<ArrayBuffer>) => void): Uint8Array<ArrayBuffer> { const p = packet(); mutate(new DataView(p.buffer), p); return p; }
function quota(u: NativeFileResourceUsage) {
  return { maxResources: u.resources, maxWork: u.work, maxMetadataBytes: u.metadataBytes,
    maxSourceBytes: u.sourceBytes, maxDecodedBytes: u.decodedBytes, maxGpuBytes: u.gpuBytes };
}

test("native facts preserves exact words/default bits and classifies current slots without invented history", () => {
  const input = packet(), before = input.slice(), result = readNativeFileNativeFacts(input, new ResourceBudget());
  equal(result.scene, "data"); equal(result.epoch, 9); equal(result.spatialRevision, 12);
  equal(result.configurationRevision, 7); equal(result.dataSceneEpoch, 9);
  deepEqual(result.variableLayout, [{ slot: 7, type: "real", scope: "global", default: -0 }]);
  ok(Object.is(result.variableLayout[0].default, -0)); equal(result.usage[0], input.length);
  equal(result.classify({ entityId: 1, entityGeneration: 9 }), "live-exact");
  equal(result.liveEntityRow({ entityId: 1, entityGeneration: 9 }), 0);
  for (const h of [{ entityId: 0, entityGeneration: 1 }, { entityId: 2, entityGeneration: 0xffffffff }, { entityId: 1, entityGeneration: 8 }]) {
    equal(result.classify(h), "stored-slot-not-current"); equal(result.liveEntityRow(h), undefined);
  }
  equal(result.classify({ entityId: 3, entityGeneration: 0 }), "unknown-slot");
  equal(result.table(5).u32(0, 3), 0); // ID0 is not a universal absence marker.
  equal(result.table(13).u32(0, 13), 0x80000000); equal(result.table(13).u32(0, 14), 0x12345678);
  equal(result.table(13).u32(0, 16), 0xffffffff);
  input.fill(0); equal(result.table(13).u32(0, 13), 0x80000000); ok(before[0] !== input[0]);
  throws(() => result.table(0), /DATA/); throws(() => result.table(14).u32(1, 0), /DATA/);
  throws(() => result.table(1).u32(0, 5), /DATA/);
  const builtin = changed((v, p) => { v.setUint32(offset(p, 1), 0, true); v.setUint32(offset(p, 1) + 16, 0, true); });
  const inactive = readNativeFileNativeFacts(builtin, new ResourceBudget()); equal(inactive.epoch, 9); equal(inactive.dataSceneEpoch, 0);
});

test("native facts rejects malformed framing, dimensions and cross-slot data without repairing source", () => {
  const fixtures = [
    changed(v => v.setUint32(0, 0, true)), changed(v => v.setUint32(4, 2, true)), changed(v => v.setUint32(12, 13, true)),
    changed(v => v.setUint32(16, 2, true)), changed(v => v.setUint32(20, 16, true)),
    changed(v => v.setUint32(28, 241, true)), changed(v => v.setUint32(24, 0xffffffff, true)),
    changed((v, p) => v.setUint32(offset(p, 1) + 16, 8, true)),
    changed((v, p) => v.setUint32(offset(p, 3) + 12, 0, true)),
    changed((v, p) => v.setUint32(offset(p, 4), 3, true)), changed((v, p) => v.setUint32(offset(p, 4) + 4, 8, true)),
    changed((v, p) => v.setUint32(offset(p, 4) + 16, 0, true)), // Absent projection retains a nonzero payload.
    changed((v, p) => v.setUint32(offset(p, 13) + 7 * 4, 1, true)),
    changed((v, p) => v.setUint32(offset(p, 13) + 9 * 4, 7, true)),
    changed((v, p) => v.setUint32(offset(p, 13) + 10 * 4, 7, true)),
    changed((v, p) => v.setUint32(offset(p, 13) + 13 * 4, 0x7fc01234, true)),
    changed((v, p) => v.setUint32(offset(p, 14) + 4, 0x200000, true)),
  ];
  const trailing = new Uint8Array(packet().length + 1); trailing.set(packet()); new DataView(trailing.buffer).setUint32(8, trailing.length, true); fixtures.push(trailing);
  for (const input of fixtures) { const before = input.slice(); throws(() => readNativeFileNativeFacts(input, new ResourceBudget()), /DATA/); deepEqual(input, before); }
  throws(() => readNativeFileNativeFacts(packet().subarray(0, 239), new ResourceBudget()), /header/);
});

test("native variable types/defaults and all boolean presence words fail closed", () => {
  for (const [field, value] of [[0, 0], [1, 3], [2, 2]] as const) {
    const p = changed((v, p) => v.setUint32(offset(p, 2) + field * 4, value, true));
    throws(() => readNativeFileNativeFacts(p, new ResourceBudget()), /variable/);
  }
  for (const [type, value] of [[0, .5], [0, Number.MAX_SAFE_INTEGER + 1], [1, NaN], [2, 2]]) {
    const p = changed((v, p) => { v.setUint32(offset(p, 2) + 4, type, true); v.setFloat64(offset(p, 2) + 12, value, true); });
    throws(() => readNativeFileNativeFacts(p, new ResourceBudget()), /DATA/);
  }
  const bool = changed((v, p) => { v.setUint32(offset(p, 2) + 4, 2, true); v.setFloat64(offset(p, 2) + 12, 1, true); });
  equal(readNativeFileNativeFacts(bool, new ResourceBudget()).variableLayout[0].default, true);
  for (const [kind, word] of [[3, 1], [4, 3], [4, 4], [4, 6], [4, 7], [6, 4], [8, 4], [10, 1], [10, 3], [13, 6], [13, 15]]) {
    const p = changed((v, p) => v.setUint32(offset(p, kind) + word * 4, 2, true));
    throws(() => readNativeFileNativeFacts(p, new ResourceBudget()), /DATA/);
  }
});

test("native facts charges its one shared ledger before copies/indexes and rejects exact one-below quotas", () => {
  const input = packet(), ledger = new ResourceBudget(); readNativeFileNativeFacts(input, ledger); const used = ledger.usage();
  readNativeFileNativeFacts(input, new ResourceBudget(quota(used)));
  for (const key of ["maxWork", "maxDecodedBytes"] as const) {
    const limits = quota(used); limits[key]--; throws(() => readNativeFileNativeFacts(input, new ResourceBudget(limits)), /LIMIT/);
  }
  throws(() => readNativeFileNativeFacts(input, new ResourceBudget(), input.length - 1), /LIMIT/);
  throws(() => readNativeFileNativeFacts(input, new ResourceBudget(), 64 * 1024 * 1024 + 1), /DATA/);
  const shared = new ResourceBudget(quota(used)); readNativeFileNativeFacts(input, shared);
  throws(() => readNativeFileNativeFacts(input, shared), /LIMIT/);
  const shadowed = packet(); let calls = 0;
  for (const name of ["byteLength", "buffer", "slice", Symbol.iterator]) Object.defineProperty(shadowed, name, { get() { calls++; throw Error("getter"); } });
  equal(readNativeFileNativeFacts(shadowed, new ResourceBudget()).epoch, 9); equal(calls, 0);
});
