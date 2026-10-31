import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import type { RenderCommandBufferView } from "../src/renderCommandDecoder.js";
import {
  configureSpriteNormals,
  readSpriteNormals,
  SPRITE_NORMAL_NONE,
  spriteNormalsActive,
  supportsSpriteNormals,
} from "../src/spriteNormals.js";

interface NativeNormals {
  sprite_normal_material_abi_version(): number;
  sprite_normal_material_size(): number;
  sprite_normal_material_ptr(): number;
  sprite_normal_material_len(): number;
  configure_sprite_normal_materials(records: Uint32Array): boolean;
}

const exports = [
  "sprite_normal_material_abi_version",
  "sprite_normal_material_size",
  "sprite_normal_material_ptr",
  "sprite_normal_material_len",
  "configure_sprite_normal_materials",
] as const;

function engineWith(exports: object): Engine {
  // Deliberately expose only this optional ABI; the tests must not need a Wasm instance.
  return exports as Engine;
}

function nativeNormals(records: readonly number[] = [7, 0], overrides: Partial<NativeNormals> = {}) {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 3 });
  const calls: Uint32Array[] = [];
  new Uint32Array(memory.buffer, 32, records.length).set(records);
  const native: NativeNormals = {
    sprite_normal_material_abi_version: () => 1,
    sprite_normal_material_size: () => 8,
    sprite_normal_material_ptr: () => 32,
    sprite_normal_material_len: () => records.length / 2,
    configure_sprite_normal_materials: values => {
      calls.push(values);
      return true;
    },
    ...overrides,
  };
  return { native, engine: engineWith(native), memory, calls };
}

function commands(records: readonly number[], count = records.length / 2): RenderCommandBufferView {
  return {
    buffer: new Float32Array(count * 15),
    commandCount: count,
    floatsPerCommand: 15,
    spriteNormalMaterials: { version: 1, stride: 2, buffer: Uint32Array.from(records) },
  };
}

test("sprite normals preserve the legacy path only when all optional exports are absent", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  for (const old of [{}, Object.fromEntries(exports.map(name => [name, undefined]))]) {
    const engine = engineWith(old);
    equal(supportsSpriteNormals(engine), false);
    equal(readSpriteNormals(engine, memory, 1), undefined);
    equal(configureSpriteNormals(engine, [{ entity: { entityId: 4, entityGeneration: 2 }, normalTextureId: 9 }]), false);
  }
  equal(spriteNormalsActive({ buffer: new Float32Array(15), commandCount: 1, floatsPerCommand: 15 }), false);
});

test("partial or non-callable optional exports cannot silently fall back to legacy rendering", () => {
  const fixture = nativeNormals();
  for (const missing of exports) {
    const partial = { ...fixture.native };
    Reflect.deleteProperty(partial, missing);
    equal(supportsSpriteNormals(engineWith(partial)), false);
    throws(() => readSpriteNormals(engineWith(partial), fixture.memory, 1), /sprite normal material ABI/);
    equal(configureSpriteNormals(engineWith(partial), []), false);
    const nonCallable = { ...fixture.native, [missing]: null };
    equal(supportsSpriteNormals(engineWith(nonCallable)), false);
    throws(() => readSpriteNormals(engineWith(nonCallable), fixture.memory, 1), /sprite normal material ABI/);
  }
  equal(fixture.calls.length, 0);
});

test("sprite normal support requires exactly the v1 eight-byte record ABI", () => {
  equal(SPRITE_NORMAL_NONE, 16_777_215);
  equal(supportsSpriteNormals(nativeNormals().engine), true);
  for (const version of [0, 2, -1, 1.5, NaN, Infinity]) {
    const fixture = nativeNormals([7, 0], { sprite_normal_material_abi_version: () => version });
    equal(supportsSpriteNormals(fixture.engine), false);
    throws(() => readSpriteNormals(fixture.engine, fixture.memory, 1), /sprite normal material ABI/);
    equal(configureSpriteNormals(fixture.engine, []), false);
    equal(fixture.calls.length, 0);
  }
  for (const size of [0, 4, 7, 9, 16, NaN, Infinity]) {
    const fixture = nativeNormals([7, 0], { sprite_normal_material_size: () => size });
    equal(supportsSpriteNormals(fixture.engine), false);
    throws(() => readSpriteNormals(fixture.engine, fixture.memory, 1), /sprite normal material ABI/);
  }
});

test("normal records stay aligned with every render command, including unmapped and texture zero", () => {
  const fixture = nativeNormals([SPRITE_NORMAL_NONE, 0, 0, 0, SPRITE_NORMAL_NONE - 1, 0]);
  const view = readSpriteNormals(fixture.engine, fixture.memory, 3);
  ok(view);
  if (!view) throw Error("expected mapped sidecar");
  equal(view.version, 1);
  equal(view.stride, 2);
  equal(view.buffer.buffer, fixture.memory.buffer);
  equal(view.buffer.byteOffset, 32);
  deepEqual(Array.from(view.buffer), [SPRITE_NORMAL_NONE, 0, 0, 0, SPRITE_NORMAL_NONE - 1, 0]);
  new Uint32Array(fixture.memory.buffer, 32, 6)[2] = 12;
  equal(view.buffer[2], 12, "the frame view borrows Wasm memory instead of copying records");
});

test("all-NONE and empty buffers preserve the color-only view shape", () => {
  const fixture = nativeNormals([SPRITE_NORMAL_NONE, 0, SPRITE_NORMAL_NONE, 0]);
  equal(readSpriteNormals(fixture.engine, fixture.memory, 2), undefined);
  equal(spriteNormalsActive(commands([SPRITE_NORMAL_NONE, 0, SPRITE_NORMAL_NONE, 0])), false);
  const empty = nativeNormals([], { sprite_normal_material_ptr: () => fixture.memory.buffer.byteLength });
  equal(readSpriteNormals(empty.engine, empty.memory, 0), undefined);
  equal(spriteNormalsActive(commands([])), false);
});

test("normal sidecar length must match the render count before a typed array is exposed", () => {
  const fixture = nativeNormals();
  for (const count of [0, 2])
    throws(() => readSpriteNormals(fixture.engine, fixture.memory, count), /sprite normal material ABI/);
  for (const count of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = nativeNormals([], { sprite_normal_material_len: () => count });
    throws(() => readSpriteNormals(invalid.engine, invalid.memory, count), /sprite normal material ABI|outside Wasm memory/);
  }
});

test("normal pointers must be safe, nonnegative, u32-aligned and wholly inside current Wasm memory", () => {
  for (const pointer of [-4, 1, 2, 6, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 65_532, 65_536]) {
    const fixture = nativeNormals([7, 0], { sprite_normal_material_ptr: () => pointer });
    throws(() => readSpriteNormals(fixture.engine, fixture.memory, 1), /outside Wasm memory/);
  }
  const fixture = nativeNormals([7, 0]);
  const end = fixture.memory.buffer.byteLength;
  fixture.native.sprite_normal_material_ptr = () => end - 8;
  new Uint32Array(fixture.memory.buffer, end - 8, 2).set([9, 0]);
  deepEqual(Array.from(readSpriteNormals(fixture.engine, fixture.memory, 1)!.buffer), [9, 0]);
  fixture.native.sprite_normal_material_ptr = () => 0;
  new Uint32Array(fixture.memory.buffer, 0, 2).set([11, 0]);
  deepEqual(Array.from(readSpriteNormals(fixture.engine, fixture.memory, 1)!.buffer), [11, 0]);
  fixture.native.sprite_normal_material_len = () => 0;
  fixture.native.sprite_normal_material_ptr = () => end + 4;
  throws(() => readSpriteNormals(fixture.engine, fixture.memory, 0), /outside Wasm memory/);
});

test("normal material views are reacquired after memory growth and pointer relocation", () => {
  const fixture = nativeNormals();
  const first = readSpriteNormals(fixture.engine, fixture.memory, 1)!;
  const oldBuffer = fixture.memory.buffer;
  fixture.memory.grow(1);
  ok(fixture.memory.buffer !== oldBuffer);
  equal(first.buffer.byteLength, 0, "a previously borrowed view is detached after growth");
  fixture.native.sprite_normal_material_ptr = () => 65_536;
  new Uint32Array(fixture.memory.buffer, 65_536, 2).set([21, 0]);
  const second = readSpriteNormals(fixture.engine, fixture.memory, 1)!;
  equal(second.buffer.buffer, fixture.memory.buffer);
  equal(second.buffer.byteOffset, 65_536);
  deepEqual(Array.from(second.buffer), [21, 0]);
  ok(second.buffer !== first.buffer);
});

test("both normal readers reject invalid IDs and reserved flags even after an active record", () => {
  for (const records of [
    [7, 0, SPRITE_NORMAL_NONE + 1, 0],
    [7, 0, SPRITE_NORMAL_NONE, 1],
    [7, 0, 8, 0xffffffff],
    [SPRITE_NORMAL_NONE, 1],
  ]) {
    const fixture = nativeNormals(records);
    throws(() => readSpriteNormals(fixture.engine, fixture.memory, records.length / 2), /Invalid sprite normal material record/);
    throws(() => spriteNormalsActive(commands(records)), /Invalid sprite normal material record/);
  }
  equal(spriteNormalsActive(commands([SPRITE_NORMAL_NONE, 0, 0, 0])), true);
});

test("renderer sidecar validation rejects stale versions, strides and command counts", () => {
  for (const corruption of [{ version: 2 }, { stride: 1 }, { stride: 4 }, { buffer: new Uint32Array(1) }, { buffer: new Uint32Array(4) }]) {
    const view = commands([7, 0]);
    // Simulate malformed external runtime data without weakening the public sidecar type.
    Object.assign(view.spriteNormalMaterials!, corruption);
    throws(() => spriteNormalsActive(view), /Invalid sprite normal material sidecar/);
  }
});

test("bulk normal updates pack ordered generation-safe handles and detach in one native call", () => {
  const fixture = nativeNormals();
  const updates = [
    { entity: { entityId: 0, entityGeneration: 0 }, normalTextureId: 0 },
    { entity: { entityId: 42, entityGeneration: 9 }, normalTextureId: SPRITE_NORMAL_NONE - 1 },
    { entity: { entityId: 0xffffffff, entityGeneration: 0xffffffff } },
    { entity: { entityId: 3, entityGeneration: 2 }, normalTextureId: SPRITE_NORMAL_NONE },
  ];
  const before = updates.map(update => ({ ...update, entity: { ...update.entity } }));
  equal(configureSpriteNormals(fixture.engine, updates), true);
  equal(fixture.calls.length, 1);
  equal(fixture.calls[0].constructor, Uint32Array);
  deepEqual(Array.from(fixture.calls[0]), [0, 0, 0, 0, 42, 9, SPRITE_NORMAL_NONE - 1, 0,
    0xffffffff, 0xffffffff, SPRITE_NORMAL_NONE, 0, 3, 2, SPRITE_NORMAL_NONE, 0]);
  deepEqual(updates, before);
});

test("invalid late bulk entries reject the entire batch before any native mutation", () => {
  const valid = { entity: { entityId: 4, entityGeneration: 2 }, normalTextureId: 7 };
  const fixture = nativeNormals();
  for (const invalid of [-1, 0.5, NaN, Infinity, 0x100000000, Number.MAX_SAFE_INTEGER + 1]) {
    equal(configureSpriteNormals(fixture.engine, [valid, { entity: { entityId: invalid, entityGeneration: 1 } }]), false);
    equal(configureSpriteNormals(fixture.engine, [valid, { entity: { entityId: 5, entityGeneration: invalid } }]), false);
  }
  for (const normalTextureId of [-1, 0.5, NaN, Infinity, SPRITE_NORMAL_NONE + 1])
    equal(configureSpriteNormals(fixture.engine, [valid, { entity: { entityId: 5, entityGeneration: 1 }, normalTextureId }]), false);
  equal(configureSpriteNormals(fixture.engine, [valid, { entity: { entityId: 4, entityGeneration: 3 }, normalTextureId: 8 }]), false);
  equal(fixture.calls.length, 0, "no valid prefix may be committed before a rejected record");
});

test("bulk updates enforce the 65536-record limit before native configuration", () => {
  const fixture = nativeNormals();
  const updates = Array.from({ length: 65_536 }, (_, entityId) => ({ entity: { entityId, entityGeneration: 1 }, normalTextureId: 7 }));
  equal(configureSpriteNormals(fixture.engine, updates), true);
  equal(fixture.calls.length, 1);
  equal(fixture.calls[0].length, 65_536 * 4);
  equal(configureSpriteNormals(fixture.engine, [...updates, { entity: { entityId: 65_536, entityGeneration: 1 } }]), false);
  equal(fixture.calls.length, 1);
});

test("bulk updates propagate native rejection instead of claiming that stale handles were applied", () => {
  let calls = 0;
  const fixture = nativeNormals([], { configure_sprite_normal_materials: () => { calls++; return false; } });
  equal(configureSpriteNormals(fixture.engine, [{ entity: { entityId: 3, entityGeneration: 99 }, normalTextureId: 7 }]), false);
  equal(calls, 1);
});
