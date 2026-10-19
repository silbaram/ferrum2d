import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";
import {
  spatialModelResource,
  type SpatialModelResource as SpatialModelAsset,
} from "./spatialModel.js";
export type SpatialModelFrame = NonNullable<SpatialRenderBufferView["models"]>;
/** Shared native packet validation; no GPU state is changed. */
export function validateSpatialModelFrame(frame?: SpatialModelFrame): void {
  if (!frame) return;
  if (
    frame.version !== 1 ||
    frame.stride !== 20 ||
    !(frame.words instanceof Uint32Array) ||
    !(frame.values instanceof Float32Array) ||
    !(frame.assets instanceof Map) ||
    frame.words.length !== frame.values.length ||
    frame.words.length % 20 ||
    frame.words.length > 1024 * 20
  )
    throw Error("Invalid spatial model buffer");
  let primitiveCount = 0,
    triangleCount = 0,
    resourceBytes = 0;
  // Resource data is private and immutable; only per-row flags/matrices/budgets scale with N.
  // Keep this cache frame-local so validation never retains an unused asset or skips a new frame.
  const checked = new Map<SpatialModelAsset, number>();
  for (let i = 0; i < frame.words.length; i += 20) {
    if (
      !frame.assets.has(frame.words[i]) ||
      frame.words[i + 1] > 3 ||
      frame.words[i + 2] > 255 ||
      frame.words[i + 3] !== 0
    )
      throw Error("Invalid model instance/resource");
    for (let j = i + 4; j < i + 20; j++)
      if (!Number.isFinite(frame.values[j])) throw Error("Invalid model instance/resource");
    const handle = frame.assets.get(frame.words[i])!;
    const asset = spatialModelResource(handle);
    if (!asset) throw Error("Invalid opaque spatial model asset");
    let triangles = checked.get(asset);
    if (triangles === undefined) {
      resourceBytes += handle.byteLength;
      if (checked.size >= 16 || resourceBytes > 128 * 1024 * 1024)
        throw Error("Spatial model resource budget exceeded");
      if (!asset.primitives.length || asset.primitives.length > 32)
        throw Error("Invalid model primitive count");
      triangles = 0;
      for (const p of asset.primitives) {
        if (
          typeof p.alphaCutoff !== "number" ||
          !Number.isFinite(Math.fround(p.alphaCutoff)) ||
          p.alphaCutoff < 0 ||
          (p.alphaCutoff > 0 && Math.fround(p.alphaCutoff) === 0) ||
          (p.alphaCutoff > 1 && Math.fround(p.alphaCutoff) <= 1) ||
          typeof p.doubleSided !== "boolean"
        )
          throw Error("Invalid model alpha/cull material");
        if (
          (p.unlit !== undefined && typeof p.unlit !== "boolean") ||
          !Array.isArray(p.emissiveFactor) ||
          p.emissiveFactor.length !== 3 ||
          p.emissiveFactor.some((x: number) => !Number.isFinite(x) || x < 0 || x > 64) ||
          (p.normal && (!Number.isFinite(p.normal.scale) || Math.abs(p.normal.scale) > 64)) ||
          [p.image, p.normal?.image, p.emissive?.image].some(
            (image) =>
              image !== undefined &&
              (!Number.isInteger(image) || image < 0 || image >= asset.images.length),
          )
        )
          throw Error("Invalid model normal/emissive material");
        triangles += p.indices.length / 3;
      }
      checked.set(asset, triangles);
    }
    primitiveCount += asset.primitives.length;
    triangleCount += triangles;
    if (primitiveCount > 4096 || triangleCount > 262144)
      throw Error("Spatial model submission budget exceeded");
  }
}
