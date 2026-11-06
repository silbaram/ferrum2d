import "./nativeRuntimeTestHelper.js";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { wasm_memory } from "../pkg/ferrum_core.js";
import {
  createPixelMaskTerrain,
  extractPixelMaskBoundaryChains,
  pixelMaskTerrainToTilemapLayer,
} from "../src/pixelMaskTerrain.js";

test("PixelMaskTerrain tracks destructive edits, dirty alpha patches, and tile occupancy", () => {
  const terrain = createPixelMaskTerrain({ width: 4, height: 3, fill: "solid" });

  equal(terrain.isSolid(1, 1), true);
  ok(terrain.carveRect(1, 1, 2, 1));
  equal(terrain.version, 1);
  deepEqual(terrain.dirtyRect(), { x: 1, y: 1, width: 2, height: 1 });

  const patch = terrain.dirtyAlphaPatch();
  deepEqual(patch?.rect, { x: 1, y: 1, width: 2, height: 1 });
  deepEqual(Array.from(patch?.alpha ?? []), [0, 0]);

  const layer = pixelMaskTerrainToTilemapLayer(terrain, { tileWidth: 8, tileHeight: 8 });
  equal(layer.columns, 4);
  equal(layer.rows, 3);
  equal(layer.data[5], 0);
  equal(layer.data[6], 0);
  equal(layer.data[0], 1);

  terrain.clearDirty();
  equal(terrain.dirtyRect(), undefined);
  terrain.destroy();
});

test("PixelMaskTerrain extracts Physics Spec chain boundaries from the remaining mask", () => {
  const terrain = createPixelMaskTerrain({ width: 3, height: 3, fill: "solid" });
  ok(terrain.carveCircle(1.5, 1.5, 0.75));

  const extracted = extractPixelMaskBoundaryChains(terrain, {
    tileWidth: 2,
    tileHeight: 2,
    physicsLayer: "world",
    material: "dirt",
  });

  ok(extracted.chainCount >= 1);
  ok(extracted.segmentCount > 0);
  equal(Object.values(extracted.bodies)[0]?.type, "static");
  equal(extracted.chains[0]?.collider.shape, "chain");
  equal(extracted.chains[0]?.collider.layer, "world");
  equal(extracted.chains[0]?.collider.material, "dirt");
  terrain.destroy();
});

test("PixelMaskTerrain snapshots cannot mutate native alpha, solidity, dirty state, or version", () => {
  const input = new Uint8Array([0, 127, 128, 255]);
  const terrain = createPixelMaskTerrain({ width: 2, height: 2, solidThreshold: 128, data: input });
  try {
    input.fill(255);
    const snapshot = terrain.data;
    snapshot.fill(42);
    const solid = terrain.solidData();
    solid.fill(0);
    deepEqual(Array.from(terrain.data), [0, 127, 128, 255]);
    deepEqual(Array.from(terrain.solidData()), [0, 0, 1, 1]);
    equal(terrain.version, 0);
    equal(terrain.dirtyRect(), undefined);
    ok(terrain.setPixel(0, 0, 128));
    ok(terrain.setPixel(1, 1, 0));
    const rect = terrain.dirtyRect()!;
    const patch = terrain.dirtyAlphaPatch()!;
    rect.x = 99;
    patch.rect.y = 99;
    patch.alpha.fill(42);
    deepEqual(terrain.dirtyRect(), { x: 0, y: 0, width: 2, height: 2 });
    deepEqual(Array.from(terrain.dirtyAlphaPatch()!.alpha), [128, 127, 128, 0]);
    equal(terrain.version, 2);
    equal(terrain.setPixel(1, 1, 0), false);
    equal(terrain.version, 2);
  } finally {
    terrain.destroy();
  }
});

test("PixelMaskTerrain owned snapshots survive native memory growth and reconstruct alpha independently", () => {
  const terrain = createPixelMaskTerrain({ width: 2, height: 2, fill: "solid" });
  terrain.setPixel(1, 0, 3.5);
  const snapshot = terrain.data;
  const patch = terrain.dirtyAlphaPatch()!;
  wasm_memory().grow(1);
  deepEqual(Array.from(snapshot), [255, 4, 255, 255]);
  deepEqual(Array.from(patch.alpha), [4]);
  const restored = createPixelMaskTerrain({ width: 2, height: 2, data: snapshot });
  try {
    equal(restored.version, 0);
    equal(restored.dirtyRect(), undefined);
    deepEqual(Array.from(restored.data), Array.from(snapshot));
    terrain.setPixel(1, 0, 20);
    equal(restored.alphaAt(1, 0), 4);
    equal(snapshot[1], 4);
    throws(() => createPixelMaskTerrain({ width: 2, height: 2, data: [1, 2, 3] }), /length/);
    equal(restored.alphaAt(1, 0), 4);
  } finally {
    terrain.destroy();
    restored.destroy();
  }
});

test("PixelMaskTerrain bounds allocation and rejects failed edits without partial native mutation", () => {
  for (const width of [0, -1, 0.5, 4097, Infinity, NaN, Number.MAX_SAFE_INTEGER]) {
    throws(() => createPixelMaskTerrain({ width, height: 1 }), /positive integer at most 4096/);
    throws(() => createPixelMaskTerrain({ width: 1, height: width }), /positive integer at most 4096/);
  }
  for (const data of [[], [0], [0, 0, 0, 256], [0, 0, 0, NaN]]) {
    throws(() => createPixelMaskTerrain({ width: 2, height: 2, data }), /length|between 0 and 255/);
  }
  const terrain = createPixelMaskTerrain({ width: 2, height: 2, solidThreshold: 0 });
  try {
    equal(terrain.isSolid(0, 0), true);
    equal(terrain.isSolid(-1, 0), false);
    equal(terrain.isSolid(0.5, 0), false);
    equal(terrain.alphaAt(Infinity, 0), 0);
    equal(terrain.setPixel(-1, 0, NaN), false);
    throws(() => terrain.setPixel(0, 0, NaN), /between 0 and 255/);
    throws(() => terrain.carveRect(0, 0, 2, 2, 256), /between 0 and 255/);
    throws(() => terrain.carveCircle(1, 1, 2, -1), /between 0 and 255/);
    deepEqual(Array.from(terrain.data), [0, 0, 0, 0]);
    equal(terrain.version, 0);
    equal(terrain.dirtyRect(), undefined);
    equal(terrain.carveCircle(0, 0, Infinity), false);
  } finally {
    terrain.destroy();
  }
});

test("PixelMaskTerrain destroy is idempotent and all state operations reject after release", () => {
  const terrain = createPixelMaskTerrain({ width: 1, height: 1 });
  terrain.destroy();
  terrain.destroy();
  for (const access of [
    () => terrain.data, () => terrain.version, () => terrain.solidData(),
    () => terrain.isSolid(0, 0), () => terrain.alphaAt(0, 0),
    () => terrain.setPixel(0, 0, 255), () => terrain.carveRect(0, 0, 1, 1),
    () => terrain.carveCircle(0, 0, 1), () => terrain.dirtyRect(),
    () => terrain.clearDirty(), () => terrain.dirtyAlphaPatch(), () => terrain.toTilemapLayer(),
  ]) throws(access, /destroyed/);
});
