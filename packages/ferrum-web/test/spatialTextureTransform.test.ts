import { test } from "node:test";
import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadSpatialGlb, spatialModelResource } from "../src/spatialModel.js";
import { loadSpatialGltf } from "../src/spatialGltf.js";
import { SpatialModelImageReader } from "../src/spatialModelImage.js";
import { resolveSpatialTextureTransform, spatialTransformedUv, validateSpatialTransformedUvs } from "../src/spatialTextureTransform.js";
import { spatialModelMaterialValues } from "../src/webgpuSpatialMaterial.js";

type Ref = { index: number; texCoord?: unknown; extensions?: Record<string, unknown> };
interface Doc {
  extensionsRequired: string[];
  materials: { pbrMetallicRoughness: { baseColorTexture: Ref }; normalTexture: Ref; emissiveTexture: Ref }[];
  meshes: { primitives: { attributes: Record<string, number>; material: number }[] }[];
}
const options = { materialProfile: "diffuse" } as const;
const dir = new URL("../../../../tests/fixtures/spatial-texture-transform/", import.meta.url);
async function fixture(edit: (doc: Doc) => void = () => {}): Promise<ArrayBuffer> {
  const file = await readFile(new URL("mapping.glb", dir));
  const original = new DataView(file.buffer, file.byteOffset, file.byteLength), size = original.getUint32(12, true);
  const json: Doc = JSON.parse(new TextDecoder().decode(file.subarray(20, 20 + size)));
  edit(json);
  const text = new TextEncoder().encode(JSON.stringify(json)), padded = (text.length + 3) & ~3;
  const binary = file.subarray(28 + size), result = new ArrayBuffer(28 + padded + binary.length), v = new DataView(result);
  [0x46546c67, 2, result.byteLength, padded, 0x4e4f534a].forEach((n, i) => v.setUint32(i * 4, n, true));
  const bytes = new Uint8Array(result); bytes.fill(32, 20, 20 + padded); bytes.set(text, 20);
  v.setUint32(20 + padded, binary.length, true); v.setUint32(24 + padded, 0x004e4942, true); bytes.set(binary, 28 + padded);
  return result;
}
async function withImages(run: () => Promise<void>) {
  const bitmap = globalThis.createImageBitmap, read = SpatialModelImageReader.prototype.read;
  let closed = 0;
  globalThis.createImageBitmap = (async () => ({ width: 8, height: 8, close: () => { closed++; } }) as ImageBitmap) as typeof createImageBitmap;
  SpatialModelImageReader.prototype.read = () => new Uint8ClampedArray(8 * 8 * 4).fill(255);
  try { await run(); return closed; } finally { globalThis.createImageBitmap = bitmap; SpatialModelImageReader.prototype.read = read; }
}

test("UV transform applies scale then counterclockwise rotation then offset and supports reflected/collapsed axes", () => {
  const m = resolveSpatialTextureTransform({ extensions: { KHR_texture_transform: { offset: [.25, .5], scale: [2, -1], rotation: Math.PI / 2 } } });
  const [x, y] = spatialTransformedUv(.25, .5, m);
  ok(Math.abs(x + .25) < 1e-6 && Math.abs(y) < 1e-6);
  deepEqual(spatialTransformedUv(12, 45, resolveSpatialTextureTransform({ extensions: { KHR_texture_transform: { scale: [0, 0], offset: [-1, 2] } } })), [-1, 2]);
  equal(resolveSpatialTextureTransform({ extensions: { KHR_texture_transform: {} } }), undefined);
  equal(resolveSpatialTextureTransform({ texCoord: 1, extensions: { KHR_texture_transform: { texCoord: 0 } } }), undefined);
  throws(() => resolveSpatialTextureTransform({ texCoord: 0, extensions: { KHR_texture_transform: { texCoord: 1 } } }), /TEXCOORD_0/);
  throws(() => validateSpatialTransformedUvs([3e38, 3e38], resolveSpatialTextureTransform({ extensions: { KHR_texture_transform: { scale: [2, 1] } } })), /f32 range/);
});

test("real Blender Mapping export imports independent map transforms without changing vertex layout or tangent basis", async () => {
  const closed = await withImages(async () => {
    const transformed = await loadSpatialGlb(await fixture(), options);
    const plain = await loadSpatialGlb(await fixture(j => {
      for (const ref of [j.materials[0].pbrMetallicRoughness.baseColorTexture, j.materials[0].normalTexture, j.materials[0].emissiveTexture]) delete ref.extensions;
    }), options);
    const p = spatialModelResource(transformed)!.primitives[0], q = spatialModelResource(plain)!.primitives[0];
    deepEqual(p.vertices, q.vertices); deepEqual(p.indices, q.indices); deepEqual(transformed.bounds, plain.bounds);
    equal(transformed.triangleCount, 2); equal(p.vertices.length, 48);
    ok(p.uvTransform && p.normal?.uvTransform && p.emissive?.uvTransform);
    // Independent Blender-space oracle: authored Mapping values, not glTF extension values.
    // Blender V points up. Convert both input and mapped output to glTF's top-left UVs.
    const mappings = [
      { matrix: p.uvTransform, offset: [.125, .25], scale: [.75, 1.25], rotation: Math.PI / 2 },
      { matrix: p.normal?.uvTransform, offset: [.25, .125], scale: [-1, .75], rotation: -.35 },
      { matrix: p.emissive?.uvTransform, offset: [.125, .5], scale: [1.5, .5], rotation: .2 },
    ];
    for (const mapping of mappings) for (const [u, v] of [[.25, .5], [.1, .8], [.9, .3]]) {
      const bu = mapping.scale[0] * u, bv = mapping.scale[1] * (1 - v);
      const bx = mapping.offset[0] + Math.cos(mapping.rotation) * bu - Math.sin(mapping.rotation) * bv;
      const by = mapping.offset[1] + Math.sin(mapping.rotation) * bu + Math.cos(mapping.rotation) * bv;
      const actual = spatialTransformedUv(u, v, mapping.matrix);
      ok(Math.abs(actual[0] - bx) < 1e-6 && Math.abs(actual[1] - (1 - by)) < 1e-6);
    }
    ok(transformed.contentId !== plain.contentId);
    equal(transformed.byteLength, plain.byteLength + 3 * 9 * 4);
    const packed = spatialModelMaterialValues(p);
    equal(packed.byteLength, 144);
    equal(packed[14], p.uvTransform![6]); equal(packed[22], p.normal!.uvTransform![6]); equal(packed[30], p.emissive!.uvTransform![6]);
    ok(packed[14] !== packed[22] && packed[22] !== packed[30]);
  });
  equal(closed, 6);
});

test("malformed texture transforms are rejected before image decode and do not alter a valid asset", async () => {
  const edits: ((j: Doc) => void)[] = [];
  for (const transform of [null, [], { offset: null }, { offset: [0] }, { offset: [0, "1"] }, { scale: [1, null] },
    { rotation: null }, { rotation: "1" }, { rotation: 1e40 }, { scale: [1e40, 1] }, { texCoord: -1 }, { texCoord: 1 }, { texCoord: .5 }]) {
    edits.push(j => { j.materials[0].pbrMetallicRoughness.baseColorTexture.extensions = { KHR_texture_transform: transform }; });
  }
  edits.push(j => { j.materials[0].normalTexture.extensions = { UNKNOWN: {} }; });
  edits.push(j => { j.materials[0].emissiveTexture.extensions = { KHR_texture_transform: { offset: [0, 1e40] } }; });
  edits.push(j => { j.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord = -1; });
  edits.push(j => { delete j.meshes[0].primitives[0].attributes.TEXCOORD_0; });
  edits.push(j => { j.extensionsRequired = ["KHR_draco_mesh_compression"]; });
  edits.push(j => { Object.assign(j, { extensionsRequired: null }); });
  edits.push(j => { j.materials[0].normalTexture.extensions = { KHR_texture_transform: { scale: [3e38, 3e38], rotation: Math.PI / 4 } }; });
  const closed = await withImages(async () => {
    const asset = await loadSpatialGlb(await fixture(), options), before = asset.contentId;
    for (const edit of edits) await rejects(loadSpatialGlb(await fixture(edit), options), /Spatial/);
    equal(asset.contentId, before); equal(asset.triangleCount, 2);
  });
  equal(closed, 3);
});

test("large source primitive groups keep different base UV transforms in separate material batches", async () => {
  await withImages(async () => {
    const asset = await loadSpatialGlb(await fixture(j => {
      const second = structuredClone(j.materials[0]);
      second.pbrMetallicRoughness.baseColorTexture.extensions = { KHR_texture_transform: { offset: [.2, .3] } };
      j.materials.push(second);
      const p = j.meshes[0].primitives[0];
      j.meshes[0].primitives = Array.from({ length: 40 }, (_, i) => ({ ...p, material: i % 2 }));
    }), options);
    equal(asset.primitiveCount, 2); equal(asset.triangleCount, 80);
  });
});

test("separated Blender glTF accepts the same required transform extension and external images", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async input => {
    const name = new URL(String(input)).pathname.slice(1); calls.push(name);
    const bytes = await readFile(new URL(name, dir)); return new Response(bytes.slice().buffer);
  };
  try {
    await withImages(async () => {
      const separated = await loadSpatialGltf("https://fixture.test/mapping.gltf", options);
      const packed = await loadSpatialGlb(await fixture(), options);
      deepEqual(separated.bounds, packed.bounds);
      const a = spatialModelResource(separated)!.primitives[0], b = spatialModelResource(packed)!.primitives[0];
      deepEqual(a.vertices, b.vertices); deepEqual(a.uvTransform, b.uvTransform);
      deepEqual(a.normal?.uvTransform, b.normal?.uvTransform); deepEqual(a.emissive?.uvTransform, b.emissive?.uvTransform);
      equal(calls.length, 5);
    });
  } finally { globalThis.fetch = originalFetch; }
});
