import assert from "node:assert/strict";

/** Checks the design reference vectors with the documented sRGB math; it does not render. */
export function checkFlatLightingReferenceVectors(reference) {
  assert.equal(reference.status, "design-reference-only");
  assert.equal(reference.implementedRendererProfile, "legacy-overlay");
  assert.equal(reference.workingSpace, "linear-rgb");
  assert.equal(reference.output, "srgb8");
  assert.deepEqual(reference.vectors.map(v => v.id), ["black", "grey", "white", "blocked-red-visible-blue", "excluded-receiver", "cutout-hole"]);
  const decode = x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
  const encode = x => x <= .0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - .055;
  for (const v of reference.vectors) {
    // A design-vector consistency check, explicitly separate from real GPU acceptance.
    const rgb = v.albedoSrgb8.map((b, i) => {
      const illumination = v.ambient[i] + v.lights.reduce((sum, light) => sum + light.rgb[i] * light.energy * light.visibility[i], 0);
      return Math.round(255 * encode(Math.min(1, decode(b / 255) * (v.receiveLighting === false ? 1 : illumination))));
    });
    assert.deepEqual(v.coverage === 0 ? [0, 0, 0, 0] : [...rgb, 255], v.expectedSrgb8, v.id);
  }
  return { status: reference.status, count: reference.vectors.length, renderedByEngine: false, vectors: reference.vectors };
}
