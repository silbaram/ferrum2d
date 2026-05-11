import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { generateTextureAtlasLayout } from "../src/textureAtlas.js";

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test("generateTextureAtlasLayout packs sprites without overlap and creates UVs", () => {
  const layout = generateTextureAtlasLayout([
    { name: "player", width: 64, height: 64 },
    { name: "enemy", width: 32, height: 32 },
    { name: "bullet", width: 8, height: 16 },
  ], { padding: 2, maxSize: 512 });

  equal(layout.sprites.length, 3);
  ok(layout.width > 0);
  ok(layout.height > 0);

  for (const sprite of layout.sprites) {
    ok(sprite.u0 >= 0 && sprite.u0 < sprite.u1 && sprite.u1 <= 1);
    ok(sprite.v0 >= 0 && sprite.v0 < sprite.v1 && sprite.v1 <= 1);
  }

  for (let i = 0; i < layout.sprites.length; i += 1) {
    for (let j = i + 1; j < layout.sprites.length; j += 1) {
      ok(!overlaps(layout.sprites[i], layout.sprites[j]));
    }
  }
});

test("generateTextureAtlasLayout keeps stable sprite names", () => {
  const layout = generateTextureAtlasLayout([
    { name: "zeta", width: 16, height: 16 },
    { name: "alpha", width: 32, height: 8 },
  ]);

  const names = layout.sprites.map((sprite) => sprite.name).sort();
  deepEqual(names, ["alpha", "zeta"]);
});
