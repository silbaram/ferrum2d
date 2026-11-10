import { check, difference } from "/fixture.mjs";

/** Actual surface pixels, not an ON/OFF image-difference proxy for energy preservation. */
export async function probeSeparatedComposition(configure, pixels) {
  const ao = { strength: 1, radius: 40, bias: 0.1 };
  const dark = { ambient: [0, 0, 0], lights: [] };
  const settings = { composition: "separated", lighting: dark };
  const evidence = [];
  for (const [name, lighting, asset] of [
    ["emission", dark, "emission-only"],
    ["direct", { ...dark, lights: [{ position: { x: 0, y: 0, elevation: 120 }, radius: 400, intensity: 1 }] }, "scale0"],
    ["unlit", { ...dark, ambient: [0.5, 0.5, 0.5] }, "unlit"],
  ]) {
    const base = await configure(`separated-${name}-base`, { ...settings, lighting }, asset);
    const before = pixels().slice();
    const occluded = await configure(`separated-${name}-ao`, { ...settings, lighting, ambientOcclusion: ao }, asset);
    const channelError = Math.max(...base.leaf.map((value, i) => Math.abs(value - occluded.leaf[i])));
    check(channelError <= 3, "AO changed preserved surface light", { name, before: base.leaf, after: occluded.leaf });
    if (name !== "unlit") check(difference(before, pixels(), 3) === 0, "AO changed direct/emission-only image", { name });
    evidence.push({ name, before: base.leaf, after: occluded.leaf, channelError });
  }
  const ambient = { ...settings, lighting: { ...dark, ambient: [0.5, 0.5, 0.5] } };
  const ambientBase = await configure("separated-ambient-base", ambient); const beforeAmbient = pixels().slice();
  const contact = await configure("separated-ambient-ao", { ...ambient, ambientOcclusion: ao });
  check(difference(beforeAmbient, pixels(), 3) > 20, "separated AO did not occlude ambient contact");
  check(contact.stats.effectTextureBytes * 12 === ambientBase.stats.effectTextureBytes * 28,
    "indirect composition target bytes missing", contact.stats);
  const fog = { color: [0.1, 0.2, 0.4], start: 0, end: 600 };
  const direct = { ...settings, lighting: { ...dark, lights: [{ position: { x: 0, y: 0, elevation: 120 }, radius: 400, intensity: 1 }] }, fog };
  const fogBase = await configure("separated-fog-base", direct);
  const fogAo = await configure("separated-fog-ao", { ...direct, ambientOcclusion: ao });
  for (const key of ["ground", "actor", "leaf"]) check(fogBase[key].every((v, i) => Math.abs(v - fogAo[key][i]) <= 3), "AO changed fog/direct contribution", { key, before: fogBase[key], after: fogAo[key] });
  const combined = { lighting: ambient.lighting, fog, ambientOcclusion: ao,
    bloom: { strength: 0.4, radius: 8, threshold: 0.1 },
    depthOfField: { focusDistance: 1, focusRange: 8, aperture: 8, maxBlurRadius: 6, quality: "high" },
  };
  await configure("composition-legacy-base", combined); const legacy = pixels().slice();
  await configure("composition-legacy-explicit", { ...combined, composition: "legacy" });
  check(difference(legacy, pixels()) === 0, "explicit legacy changed existing composition");
  await configure("separated-all-effects", { ...combined, composition: "separated" });
  check(difference(legacy, pixels(), 3) > 20, "separated effect order did not affect actual pixels");
  await configure("separated-zero-effects", { ...ambient, ambientOcclusion: { strength: 0 }, bloom: { strength: 0 } });
  return { preserved: evidence, ambientContact: true, fogPreserved: true, legacyIdentity: true, combined: true };
}
