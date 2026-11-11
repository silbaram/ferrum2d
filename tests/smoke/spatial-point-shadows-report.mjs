import assert from "node:assert/strict";
import { decodePng } from "../../scripts/tools/pack-textures.mjs";

export const POINT_SHADOW_STATES = Object.freeze([
  ...["hard", "pcf3"].flatMap(filter => ["plain", "a", "b", "dual"].map(name => `${filter}-${name}`)),
  "fresh-restore", "dual-plus-sun", "sixteen-lights", "dual-recovery-baseline", "off-preserved", "re-enabled",
  "array-single", "legacy-single", "resize", "pixel-art-wide",
]);
/** Validate PNG channels against the old single-shadow path, independently of browser pass flags. */
export async function auditSpatialPointShadowPixels(rows, readImage) {
  const byName = new Map(rows.map(row => [row.name, row]));
  assert.equal(byName.size, rows.length, "Duplicate point shadow state");
  assert(rows.length === POINT_SHADOW_STATES.length || rows.length === POINT_SHADOW_STATES.length + 1, "Incomplete point shadow state matrix");
  for (const name of POINT_SHADOW_STATES) assert(byName.has(name), `Missing point shadow state ${name}`);
  for (const row of rows) {
    assert(POINT_SHADOW_STATES.includes(row.name) || row.name === "recovered", `Unknown point shadow state ${row.name}`);
    const passes = row.name.endsWith("-plain") || row.name === "off-preserved" ? 0
      : row.name.endsWith("-a") || row.name.endsWith("-b") || row.name === "array-single" || row.name === "legacy-single" ? 6
      : row.name === "dual-plus-sun" ? 13 : 12;
    assert.equal(row.stats.shadowPassCount, passes, `Point shadow face count: ${row.name}`);
    assert.equal(row.warm.shadowPassCount, 0); assert.equal(row.warm.shadowUploadBytes, 0);
    assert(row.stats.shadowDrawCalls <= 256 && row.stats.shadowTriangleCount <= 1024, "Point shadow fixture work budget");
    assert(row.stats.modelCount === 2 && row.stats.modelDrawCalls > 0 && row.stats.modelInstancedDrawCalls > 0 && row.stats.triangleCount > 0, "Point shadow scene is not rendered/instanced");
    if (row.name === "pixel-art-wide") assert(row.stats.bloomDrawCalls > 0 && row.stats.bloomTextureBytes > 0, "Missing active wide Bloom with dual shadows/pixelArt");
  }
  const images = new Map();
  const get = async name => {
    if (!images.has(name)) {
      const row = byName.get(name), image = decodePng(await readImage(row.image));
      assert.equal(image.width, row.width); assert.equal(image.height, row.height); images.set(name, image);
    }
    return images.get(name);
  };
  const channel = (actual, expected, c) => {
    assert.equal(actual.width, expected.width); assert.equal(actual.height, expected.height);
    let different = 0;
    for (let i = c; i < actual.pixels.length; i += 4) different += Number(Math.abs(actual.pixels[i] - expected.pixels[i]) > 1);
    return different;
  };
  const coverage = (plain, reference, c) => {
    let count = 0;
    for (let i = c; i < plain.pixels.length; i += 4) count += Number(plain.pixels[i] - reference.pixels[i] > 8);
    return count;
  };
  const signals = [];
  for (const filter of ["hard", "pcf3"]) {
    const plain = await get(`${filter}-plain`), a = await get(`${filter}-a`), b = await get(`${filter}-b`), dual = await get(`${filter}-dual`);
    let emissionPixels = 0;
    for (let i = 0; i < plain.pixels.length; i += 4)
      emissionPixels += Number(plain.pixels[i + 1] > 160 && plain.pixels[i + 1] > plain.pixels[i] + 20 && plain.pixels[i + 1] > plain.pixels[i + 2] + 20);
    assert(emissionPixels > 16, "Point shadow reference has no green emission signal");
    const row = { filter, redDifferent: channel(dual, a, 0), blueDifferent: channel(dual, b, 2), greenDifferent: channel(dual, plain, 1),
      redShadowPixels: coverage(plain, a, 0), blueShadowPixels: coverage(plain, b, 2), emissionPixels };
    assert.equal(row.redDifferent, 0, "First light shadow differs from independent legacy red reference");
    assert.equal(row.blueDifferent, 0, "Second light shadow differs from independent legacy blue reference");
    assert.equal(row.greenDifferent, 0, "Point shadows changed unrelated green/ambient/emission");
    assert(row.redShadowPixels > 16 && row.blueShadowPixels > 16, "Point shadow reference has no shadow signal"); signals.push(row);
  }
  for (const [a, b] of [["fresh-restore", "pcf3-dual"], ["array-single", "legacy-single"],
    ...(byName.has("recovered") ? [["recovered", "dual-recovery-baseline"]] : [])]) {
    const first = await get(a), second = await get(b);
    for (const c of [0, 1, 2, 3]) assert.equal(channel(first, second, c), 0, `${a}/${b} pixels changed`);
  }
  return signals;
}
