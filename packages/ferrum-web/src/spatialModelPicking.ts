import { spatialTransformedUv } from "./spatialTextureTransform.js";
import { spatialModelResource, type SpatialModelAsset } from "./spatialModel.js";

export interface SpatialModelRay {
  /** Asset-local glTF XYZ. Direction must be nonzero; normalization is handled internally. */
  readonly origin: readonly [number, number, number];
  readonly direction: readonly [number, number, number];
  /** Local distances along the normalized ray, independent of its input magnitude. */
  readonly near?: number;
  readonly far?: number;
}
export interface SpatialModelRayHit {
  readonly distance: number;
  readonly point: readonly [number, number, number];
  readonly primitiveIndex: number;
  readonly triangleIndex: number;
}

/** Cold visual authoring query against immutable CPU triangles. Never a physics collider. */
export function raycastSpatialModel(asset: SpatialModelAsset, ray: SpatialModelRay): SpatialModelRayHit | undefined {
  const resource = spatialModelResource(asset), length = Math.hypot(...ray.direction), minimum = ray.near ?? 0, maximum = ray.far ?? Infinity;
  if (!resource || ray.origin.length !== 3 || ray.direction.length !== 3 || ![...ray.origin, ...ray.direction].every(Number.isFinite) || !Number.isFinite(length) || length <= 0 || !Number.isFinite(minimum) || minimum < 0 || maximum < minimum || (ray.far !== undefined && !Number.isFinite(maximum)))
    throw new Error("Spatial model picking requires a valid asset and finite nonzero ray");
  const o = ray.origin, d = ray.direction.map(n => n / length), bounds = resource.bounds;
  let near = minimum, far = maximum;
  for (let i = 0; i < 3; i++) {
    if (d[i] === 0) { if (o[i] < bounds[i] || o[i] > bounds[i+3]) return; }
    else {
      const a = (bounds[i] - o[i]) / d[i], b = (bounds[i+3] - o[i]) / d[i];
      near = Math.max(near, Math.min(a,b)); far = Math.min(far, Math.max(a,b));
      if (near > far) return;
    }
  }
  let hit: SpatialModelRayHit | undefined;
  for (const [primitiveIndex, p] of resource.primitives.entries()) {
    const stride = p.normal ? 12 : 8;
    for (let i = 0; i < p.indices.length; i += 3) {
      const a = p.indices[i]*stride, b = p.indices[i+1]*stride, c = p.indices[i+2]*stride, v = p.vertices,
        ex = v[b]-v[a], ey = v[b+1]-v[a+1], ez = v[b+2]-v[a+2],
        fx = v[c]-v[a], fy = v[c+1]-v[a+1], fz = v[c+2]-v[a+2],
        px = d[1]*fz-d[2]*fy, py = d[2]*fx-d[0]*fz, pz = d[0]*fy-d[1]*fx,
        det = ex*px+ey*py+ez*pz;
      // f32 meshes may be tiny and valid rays may graze a face. An absolute or
      // angular epsilon would discard real intersections before clip-distance checks.
      if (p.doubleSided ? det === 0 : det <= 0) continue;
      const tx = o[0]-v[a], ty = o[1]-v[a+1], tz = o[2]-v[a+2],
        u = (tx*px+ty*py+tz*pz)/det;
      if (u < 0 || u > 1) continue;
      const qx = ty*ez-tz*ey, qy = tz*ex-tx*ez, qz = tx*ey-ty*ex,
        w = (d[0]*qx+d[1]*qy+d[2]*qz)/det;
      if (w < 0 || u+w > 1) continue;
      const distance = (fx*qx+fy*qy+fz*qz)/det;
      if (!Number.isFinite(distance) || distance < minimum || distance > maximum || (hit && distance >= hit.distance)) continue;
      // Skip masked holes using the same immutable decoded pixels, UVs and wrap modes.
      if (p.alphaCutoff > 0) {
        let alpha = p.color[3] ?? 1;
        const image = p.image === undefined ? undefined : resource.images[p.image];
        if (image) {
          const sourceUv = [3,4].map(k => v[a+k]*(1-u-w)+v[b+k]*u+v[c+k]*w),
            uv = spatialTransformedUv(sourceUv[0], sourceUv[1], p.uvTransform),
            wrap = (value: number, mode: number) => mode === 33071 ? Math.max(0,Math.min(1,value))
              : mode === 33648 ? 1-Math.abs(((value%2)+2)%2-1) : value-Math.floor(value),
            x = Math.min(image.width-1,Math.floor(wrap(uv[0],p.sampler[2])*image.width)),
            y = Math.min(image.height-1,Math.floor(wrap(uv[1],p.sampler[3])*image.height));
          alpha *= image.pixels[(y*image.width+x)*4+3]/255;
        }
        if (alpha < p.alphaCutoff) continue;
      }
      hit = { distance, point: [o[0]+d[0]*distance,o[1]+d[1]*distance,o[2]+d[2]*distance], primitiveIndex, triangleIndex: i/3 };
    }
  }
  return hit;
}
