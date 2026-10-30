import { loadSpatialGlb, loadSpatialGltf, raycastSpatialModel } from "@ferrum2d/ferrum-web/core";
import { check, difference } from "/fixture.mjs";

// Independent oracle: bake the original Blender Mapping input in Blender's Y-up UV
// space, then convert to glTF's Y-down UVs. No extension values/engine matrix are reused.
const blenderMapping = {
  base: { offset: [.125, .25], rotation: Math.PI / 2, scale: [.75, 1.25] },
  normal: { offset: [.25, .125], rotation: -.35, scale: [-1, .75] },
  emissive: { offset: [.125, .5], rotation: .2, scale: [1.5, .5] },
};
function variant(bytes, slot, mode) {
  const size = new DataView(bytes).getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, size)));
  const binary = new Uint8Array(bytes, 28 + size).slice();
  const material = doc.materials[0];
  const refs = {
    base: material.pbrMetallicRoughness.baseColorTexture,
    normal: material.normalTexture,
    emissive: material.emissiveTexture,
  };
  if (slot !== "all") {
    if (slot !== "base") {
      delete material.pbrMetallicRoughness.baseColorTexture;
      material.pbrMetallicRoughness.baseColorFactor = [.5, .5, .5, 1];
      material.alphaMode = "OPAQUE";
    }
    if (slot !== "normal") delete material.normalTexture;
    if (slot !== "emissive") {
      delete material.emissiveTexture;
      material.emissiveFactor = [0, 0, 0];
    }
  }
  if (mode === "baked") {
    const transform = blenderMapping[slot];
    const accessor = doc.accessors[doc.meshes[0].primitives[0].attributes.TEXCOORD_0];
    const view = doc.bufferViews[accessor.bufferView], data = new DataView(binary.buffer);
    check(accessor.componentType === 5126 && accessor.type === "VEC2", "UV oracle requires float UV pairs");
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), stride = view.byteStride ?? 8;
    const [sx, sy] = transform.scale ?? [1, 1], [tx, ty] = transform.offset ?? [0, 0];
    const cosine = Math.cos(transform.rotation ?? 0), sine = Math.sin(transform.rotation ?? 0);
    for (let i = 0; i < accessor.count; i++) {
      const p = offset + i * stride, u = data.getFloat32(p, true), v = 1 - data.getFloat32(p + 4, true);
      data.setFloat32(p, tx + cosine * sx * u - sine * sy * v, true);
      data.setFloat32(p + 4, 1 - (ty + sine * sx * u + cosine * sy * v), true);
    }
  }
  if (mode === "invalid") refs.base.extensions.KHR_texture_transform.texCoord = 1;
  if (mode !== "transformed" && mode !== "invalid") {
    for (const ref of Object.values(refs)) delete ref.extensions;
    delete doc.extensionsRequired;
    delete doc.extensionsUsed;
  }
  const json = new TextEncoder().encode(JSON.stringify(doc)), padded = (json.length + 3) & ~3;
  const out = new ArrayBuffer(28 + padded + binary.length), header = new DataView(out);
  [0x46546c67, 2, out.byteLength, padded, 0x4e4f534a].forEach((n, i) => header.setUint32(i * 4, n, true));
  new Uint8Array(out, 20, padded).fill(32);
  new Uint8Array(out, 20, json.length).set(json);
  header.setUint32(20 + padded, binary.length, true);
  header.setUint32(24 + padded, 0x004e4942, true);
  new Uint8Array(out, 28 + padded).set(binary);
  return out;
}

export async function loadTextureTransformFixtures(assets) {
  const source = await (await fetch("/uv/mapping.glb")).arrayBuffer();
  for (const slot of ["base", "normal", "emissive"])
    for (const mode of ["transformed", "baked", "identity"])
      assets.set(`uv-${slot}-${mode}`, await loadSpatialGlb(variant(source, slot, mode), { materialProfile: "diffuse" }));
  assets.set("uv-combined", await loadSpatialGlb(source, { materialProfile: "diffuse" }));
  assets.set("uv-identity", await loadSpatialGlb(variant(source, "all", "identity"), { materialProfile: "diffuse" }));
  assets.set("uv-external", await loadSpatialGltf(new URL("/uv/mapping.gltf", location.href).href, { materialProfile: "diffuse" }));
  let hits = 0, misses = 0;
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
    const ray = { origin: [-32 + (x + .3) * 8, 8 + (y + .3) * 12, 100], direction: [0, 0, -1] };
    const hit = !!raycastSpatialModel(assets.get("uv-base-transformed"), ray);
    check(hit === !!raycastSpatialModel(assets.get("uv-base-baked"), ray), "UV alpha picking disagrees with baked oracle", { x, y });
    if (hit) hits++; else misses++;
  }
  check(hits > 0 && misses > 0, "UV alpha picking did not cover opaque and cutout pixels", { hits, misses });
  return { hits, misses };
}

export async function probeTextureTransforms(configure, currentPixels, sunEnvironment, reread) {
  const evidence = [];
  const equivalent = (name, reference) => {
    const diff = difference(reference, currentPixels(), 3), count = reference.length / 4;
    // A UV bake rounds vertices earlier. Permit only subpixel texture boundaries.
    check(diff < count * .001, "UV transform disagrees with independent baked UV reference", { name, diff, count });
    evidence.push({ name, differentPixels: diff, pixelCount: count });
  };
  for (const slot of ["base", "normal", "emissive"]) {
    await configure(`uv-${slot}`, sunEnvironment, `uv-${slot}-transformed`);
    const reference = currentPixels().slice();
    await configure(`uv-${slot}-baked`, sunEnvironment, `uv-${slot}-baked`);
    equivalent(slot, reference);
    await configure(`uv-${slot}-identity`, sunEnvironment, `uv-${slot}-identity`);
    check(difference(reference, currentPixels(), 3) > 20, "texture transform has no visible effect", slot);
  }
  await configure("uv-combined", sunEnvironment, "uv-combined");
  const combined = currentPixels().slice();
  const invalid = variant(await (await fetch("/uv/mapping.glb")).arrayBuffer(), "all", "invalid");
  let rejected = false;
  try { await loadSpatialGlb(invalid, { materialProfile: "diffuse" }); }
  catch (error) { rejected = /TEXCOORD_0/.test(String(error)); }
  check(rejected, "unsupported UV set did not reject before scene replacement");
  const preserved = await reread();
  check(difference(combined, preserved.data) === 0 && preserved.stats.modelUploadBytes === 0,
    "failed UV import changed the active scene or its GPU assets");
  await configure("uv-external", sunEnvironment, "uv-external");
  check(difference(combined, currentPixels()) === 0, "external glTF and GLB render differently");
  await configure("uv-identity", sunEnvironment, "uv-identity");
  check(difference(combined, currentPixels(), 3) > 20, "combined texture transforms have no effect");
  for (const kind of ["point", "sun"]) {
    const lighting = kind === "point"
      ? { ambient: [.05, .05, .05], lights: [{ position: { x: -80, y: -80, elevation: 120 }, radius: 500, intensity: 2 }], shadows: { lightIndex: 0, resolution: 128, bias: .02 } }
      : { ...sunEnvironment.lighting, directional: { ...sunEnvironment.lighting.directional, shadows: { resolution: 128, distance: 1000, extent: 300, bias: .02 } } };
    await configure(`uv-${kind}-shadow`, { lighting }, "uv-base-transformed");
    const reference = currentPixels().slice();
    await configure(`uv-${kind}-shadow-baked`, { lighting }, "uv-base-baked");
    equivalent(`${kind}-shadow`, reference);
    const noShadow = structuredClone(lighting);
    if (kind === "point") delete noShadow.shadows; else delete noShadow.directional.shadows;
    await configure(`uv-${kind}-no-shadow`, { lighting: noShadow }, "uv-base-transformed");
    check(difference(reference, currentPixels(), 3) > 10, "UV alpha shadow probe produced no visible shadow", kind);
  }
  return { comparisons: evidence, failedLoadPreserved: true };
}
