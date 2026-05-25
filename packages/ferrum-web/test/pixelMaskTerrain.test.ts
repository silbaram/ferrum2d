import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
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
});
