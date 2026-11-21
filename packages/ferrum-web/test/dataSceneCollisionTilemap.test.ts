import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import { configureDataSceneCollisionTilemap, encodeDataSceneCollisionTilemap, type DataSceneCollisionTilemapOptions } from "../src/dataSceneCollisionTilemap.js";

const spec = (): DataSceneCollisionTilemapOptions => ({ columns: 1, rows: 1, tileWidth: 10, tileHeight: 10,
  tiles: new Uint32Array([1]), definitions: [{ id: 1, kind: "ramp", blocksMovement: false,
    ramp: { axis: "x", startElevation: 0, endElevation: 8 } }] });

test("Data Scene collision tilemap encodes one owned bulk packet and height/ramp defaults", () => {
  const input = spec(), packet = encodeDataSceneCollisionTilemap(input);
  deepEqual([...packet.metadata], [1, 1, 1, 1, 0, 2, 8, 0]);
  deepEqual([...packet.values], [10, 10, 0, 0, 0, 0, 0, 0, 8]);
  (input.tiles as Uint32Array)[0] = 0;
  deepEqual([...packet.cells], [1]);
  for (const [kind, code] of [["ledge", 3], ["bridge", 4]] as const) {
    equal(encodeDataSceneCollisionTilemap({ ...spec(), definitions: [{ id: 1, kind }] }).metadata[5], code);
  }
});
test("collision grid validates dimensions and float32 bounds before a Wasm call", () => {
  let calls = 0; const native = { configure_data_scene_collision_tilemap() { calls++; return true; } } as unknown as Engine;
  for (const input of [{ ...spec(), columns: 0 }, { ...spec(), rows: 257 }, { ...spec(), tileWidth: Number.NaN }, { ...spec(), originX: 1e6 }]) {
    throws(() => configureDataSceneCollisionTilemap(native, input));
  }
  equal(calls, 0);
});
test("collision grid rejects duplicate/undefined tile ids and inconsistent ramp metadata", () => {
  throws(() => encodeDataSceneCollisionTilemap({ ...spec(), definitions: [{ id: 1 }, { id: 1 }] }), /duplicate/);
  throws(() => encodeDataSceneCollisionTilemap({ ...spec(), tiles: [2] }), /undefined/);
  throws(() => encodeDataSceneCollisionTilemap({ ...spec(), definitions: [{ id: 1, kind: "ramp" }] }), /ramp/);
  throws(() => encodeDataSceneCollisionTilemap({ ...spec(), definitions: [{ id: 1, elevation: 1e6, height: 1 }] }), /span/);
});
test("collision grid clear uses empty buffers and old Wasm is rejected", () => {
  const packet = encodeDataSceneCollisionTilemap(false);
  equal(packet.metadata.length + packet.values.length + packet.cells.length, 0);
  throws(() => configureDataSceneCollisionTilemap({} as Engine, false), /does not support/);
});
test("native collision grid rejection propagates without editing input", () => {
  const input = spec(); let calls = 0;
  const native = { configure_data_scene_collision_tilemap() { calls++; return false; } } as unknown as Engine;
  equal(configureDataSceneCollisionTilemap(native, input), false); equal(calls, 1);
  deepEqual([...input.tiles], [1]);
});
test("collision grid admits its exact bounded maximum without truncation", () => {
  const tiles = new Uint32Array(256 * 256); tiles[tiles.length - 1] = 1;
  const packet = encodeDataSceneCollisionTilemap({ columns: 256, rows: 256, tileWidth: 1, tileHeight: 1, tiles, definitions: [{ id: 1 }] });
  equal(packet.cells.length, 65536); equal(packet.cells[65535], 1);
  deepEqual([...packet.metadata.slice(0, 3)], [256, 256, 1]);
});
