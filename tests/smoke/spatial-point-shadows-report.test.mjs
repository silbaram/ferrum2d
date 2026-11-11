import { test } from "node:test";
import { deepEqual, rejects } from "node:assert/strict";
import { encodePngRgba } from "../../scripts/tools/pack-textures.mjs";
import { auditSpatialPointShadowPixels, POINT_SHADOW_STATES, OWNER_SHADOW_PASSES } from "./spatial-point-shadows-report.mjs";
const read = async value => value;
function fixture() {
  const rgba = name => {
    const pixels = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 64; i++) pixels.set([
      (name === "a" || name === "dual") && i < 32 ? 60 : 120, 200,
      (name === "b" || name === "dual") && i >= 32 ? 60 : 120, 255,
    ], i * 4);
    return encodePngRgba(8, 8, pixels);
  };
  const a = rgba("a"), dual = rgba("dual");
  const rows = POINT_SHADOW_STATES.map(name => {
    const plain = name.endsWith("-plain") || name === "off-preserved";
    const single = name.endsWith("-a") || name.endsWith("-b") || name === "array-single" || name === "legacy-single";
    const passes = OWNER_SHADOW_PASSES[name] ?? (plain ? 0 : single || name === "resize" ? 6 : name === "dual-plus-sun" ? 13 : 12);
    return { name, width: 8, height: 8, stats: { shadowPassCount: passes, shadowCacheHit: passes === 0, shadowDrawCalls: passes, shadowTriangleCount: passes * 2,
      modelCount: 2, modelDrawCalls: 1, modelInstancedDrawCalls: 1, triangleCount: 12,
      bloomDrawCalls: name === "pixel-art-wide" ? 2 : 0, bloomTextureBytes: name === "pixel-art-wide" ? 1024 : 0 }, warm: { shadowPassCount: 0, shadowUploadBytes: 0, shadowCacheHit: true },
      ...(name in OWNER_SHADOW_PASSES ? { cold: { stats: { shadowPassCount: name === "sun-disabled" ? 12 : 13 }, image: dual } } : {}),
      image: plain ? rgba("plain") : name.endsWith("-b") ? rgba("b") : single ? a : dual };
  });
  return { rows, a, dual };
}
test("point shadow PNG audit verifies both old single-light references", async () => {
  const { rows } = fixture();
  deepEqual((await auditSpatialPointShadowPixels(rows, read)).map(row => [row.redShadowPixels, row.blueShadowPixels]), [[32, 32], [32, 32]]);
});
test("point shadow PNG audit rejects empty or missing evidence despite successful state flags", async () => {
  const { rows } = fixture(), blank = encodePngRgba(8, 8, new Uint8Array(8 * 8 * 4));
  await rejects(auditSpatialPointShadowPixels(rows.map(row => ({ ...row, passed: true, image: blank,
    ...(row.cold ? { cold: { ...row.cold, image: blank } } : {}) })), read), /signal/);
  await rejects(auditSpatialPointShadowPixels(rows.slice(1), read), /state matrix/);
});
test("point shadow PNG audit rejects missing second shadow and unrelated channel darkening", async () => {
  const missing = fixture(); missing.rows.find(row => row.name === "hard-dual").image = missing.a;
  await rejects(auditSpatialPointShadowPixels(missing.rows, read), /Second light shadow/);
  const dark = fixture(), pixels = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < 64; i++) pixels.set([i < 32 ? 60 : 120, 60, i >= 32 ? 60 : 120, 255], i * 4);
  dark.rows.find(row => row.name === "hard-dual").image = encodePngRgba(8, 8, pixels);
  await rejects(auditSpatialPointShadowPixels(dark.rows, read), /unrelated green/);
});
test("point shadow audit rejects missing face measurements and warm shadow submissions", async () => {
  const missing = fixture(); delete missing.rows.find(row => row.name === "hard-dual").stats.shadowPassCount;
  await rejects(auditSpatialPointShadowPixels(missing.rows, read), /face count/);
  const warm = fixture(); warm.rows.find(row => row.name === "hard-dual").warm.shadowPassCount = 12;
  await rejects(auditSpatialPointShadowPixels(warm.rows, read));
  const bloom = fixture(); bloom.rows.find(row => row.name === "pixel-art-wide").stats.bloomDrawCalls = 0;
  await rejects(auditSpatialPointShadowPixels(bloom.rows, read), /Missing active wide Bloom/);
});

test("owner cache audit rejects missing cold references, stale pixels and incorrect partial work", async () => {
  const missing = fixture(); delete missing.rows.find(r => r.name === "primary-moved").cold;
  await rejects(auditSpatialPointShadowPixels(missing.rows, read), /cold reference/);
  const stale = fixture(); stale.rows.find(r => r.name === "secondary-moved").image = stale.a;
  await rejects(auditSpatialPointShadowPixels(stale.rows, read), /Partial\/cold pixels/);
  const work = fixture(); work.rows.find(r => r.name === "primary-moved").stats.shadowPassCount = 12;
  await rejects(auditSpatialPointShadowPixels(work.rows, read), /face count/);
  const flag = fixture(); flag.rows.find(r => r.name === "secondary-moved").stats.shadowCacheHit = true;
  await rejects(auditSpatialPointShadowPixels(flag.rows, read), /cache flag/);
});
