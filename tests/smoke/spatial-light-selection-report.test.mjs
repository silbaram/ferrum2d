import { test } from "node:test";
import { rejects, equal } from "node:assert/strict";
import { encodePngRgba } from "../../scripts/tools/pack-textures.mjs";
import { auditSpatialSelectionPixels } from "./spatial-light-selection-report.mjs";

const image = red => encodePngRgba(16, 16, Buffer.from(Array.from({ length: 256 }, () => [red, 0, 0, 255]).flat()));
const rows = () => [
  ["out-75", 192], ["out-50", 128], ["out-25", 64], ["in-25", 64], ["settled", 255],
  ["restored-out-50", 128], ["paused-out-50", 128],
].map(([name, red]) => ({ name, image: image(red) }));

test("selection report gate rejects blank/unchanged renders and visually different restored or paused worlds", async () => {
  const read = async bytes => bytes;
  await rejects(auditSpatialSelectionPixels(rows().map(row => ({ ...row, image: image(0) })), read), /Fade-out/);
  for (const name of ["restored-out-50", "paused-out-50"]) {
    const changed = rows().map(row => row.name === name ? { ...row, image: image(129) } : row);
    await rejects(auditSpatialSelectionPixels(changed, read), /strictly equal/);
  }
  const proof = await auditSpatialSelectionPixels(rows(), read);
  equal(proof.fadeOutChangedPixels, 256); equal(proof.fadeInChangedPixels, 256);
  equal(proof.restoredDifferentPixels, 0); equal(proof.pausedDifferentPixels, 0);
});
