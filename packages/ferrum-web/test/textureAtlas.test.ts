import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  TEXTURE_ATLAS_PACK_FORMAT,
  generateTextureAtlasLayout,
  packTextureAtlas,
  textureAtlasDocumentToShooterAtlas,
} from "../src/textureAtlas.js";

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test("generateTextureAtlasLayout remains available as deprecated compatibility helper", () => {
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

test("packTextureAtlas emits deterministic atlas JSON and Shooter atlas frames", () => {
  const a = packTextureAtlas([
    { name: "crate", source: "crate.png", width: 16, height: 16 },
    { name: "hero", source: "hero.png", width: 32, height: 16 },
    { name: "spark", source: "spark.png", width: 8, height: 8 },
  ], { texture: "packed", image: "packed.png", padding: 1, maxSize: 128 });
  const b = packTextureAtlas([
    { name: "spark", source: "spark.png", width: 8, height: 8 },
    { name: "hero", source: "hero.png", width: 32, height: 16 },
    { name: "crate", source: "crate.png", width: 16, height: 16 },
  ], { texture: "packed", image: "packed.png", padding: 1, maxSize: 128 });

  deepEqual(a, b);
  equal(a.format, TEXTURE_ATLAS_PACK_FORMAT);
  equal(a.placements[0].name, "crate");
  const heroFrame = a.frames.hero;
  if (
    !heroFrame?.size
    || !heroFrame.uv
    || heroFrame.uv.u0 === undefined
    || heroFrame.uv.u1 === undefined
  ) {
    throw new Error("Expected hero atlas frame to include size and uv metadata.");
  }
  equal(heroFrame.texture, "packed");
  equal(heroFrame.size.width, 32);
  ok(heroFrame.uv.u0 >= 0 && heroFrame.uv.u1 <= 1);
  deepEqual(textureAtlasDocumentToShooterAtlas(a), { frames: a.frames });
});

test("packTextureAtlas rejects duplicate sprite names", () => {
  try {
    packTextureAtlas([
      { name: "hero", width: 8, height: 8 },
      { name: "hero", width: 16, height: 16 },
    ]);
  } catch (error) {
    equal(error instanceof Error ? error.message : String(error), "Duplicate texture atlas sprite name 'hero'.");
    return;
  }
  throw new Error("Expected duplicate texture atlas sprite names to throw.");
});
