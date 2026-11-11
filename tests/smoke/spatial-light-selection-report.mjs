import assert from "node:assert/strict";
import { decodePng } from "../../scripts/tools/pack-textures.mjs";

/** A selected edge light must illuminate actual receivers in the wide presented view. */
export async function auditSpatialSelectionPresentationPixels(rows, readImage) {
  const row = rows.find(row => row.name === "presentation-wide");
  assert(row, "Missing wide presentation state");
  const image = decodePng(await readImage(row.image));
  let redReceiverPixels = 0;
  for (let i = 0; i < image.pixels.length; i += 4)
    if (image.pixels[i] > image.pixels[i + 1] + 20 && image.pixels[i] > image.pixels[i + 2] + 20)
      redReceiverPixels++;
  assert(redReceiverPixels > 64, "Wide presentation must visibly illuminate the edge receiver");
  return { redReceiverPixels };
}

/** Audits actual PNG evidence so an empty/unchanging scene cannot pass state/reference checks alone. */
export async function auditSpatialSelectionPixels(rows, readImage) {
  const get = async name => {
    const row = rows.find(row => row.name === name); assert(row, `Missing selection state ${name}`);
    return decodePng(await readImage(row.image));
  };
  const changed = (a, b, tolerance = 2) => {
    assert.equal(a.width, b.width); assert.equal(a.height, b.height);
    let count = 0;
    for (let i = 0; i < a.pixels.length; i += 4)
      if (Math.abs(a.pixels[i] - b.pixels[i]) > tolerance || Math.abs(a.pixels[i+1] - b.pixels[i+1]) > tolerance
          || Math.abs(a.pixels[i+2] - b.pixels[i+2]) > tolerance || Math.abs(a.pixels[i+3] - b.pixels[i+3]) > tolerance) count++;
    return count;
  };
  const out50 = await get("out-50");
  const signals = {
    fadeOutChangedPixels: changed(await get("out-75"), await get("out-25")),
    fadeInChangedPixels: changed(await get("in-25"), await get("settled")),
    restoredDifferentPixels: changed(out50, await get("restored-out-50"), 0),
    pausedDifferentPixels: changed(out50, await get("paused-out-50"), 0),
  };
  assert(signals.fadeOutChangedPixels > 64, "Fade-out must visibly change actual world pixels");
  assert(signals.fadeInChangedPixels > 64, "Fade-in must visibly change actual world pixels");
  assert.equal(signals.restoredDifferentPixels, 0); assert.equal(signals.pausedDifferentPixels, 0);
  return signals;
}
