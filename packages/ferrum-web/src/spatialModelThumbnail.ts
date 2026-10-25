import {
  spatialModelResource,
  type SpatialModelAsset,
} from "./spatialModel.js";

/** Cold, bounded diffuse geometry thumbnail. No DOM, GPU allocation or mutable geometry escapes. */
export function createSpatialModelThumbnailSvg(
  asset: SpatialModelAsset,
  size = 80,
): string {
  if (!Number.isInteger(size) || size < 16 || size > 256)
    throw new Error("Model thumbnail size must be 16–256");
  const resource = spatialModelResource(asset);
  if (!resource) throw new Error("Unknown spatial model asset");
  const project = (x: number, y: number, z: number) => ({
    x: x - z,
    y: (x + z) * 0.45 - y * 1.2,
    depth: x + y + z,
  });
  const corners = [];
  for (const x of [asset.bounds[0], asset.bounds[3]])
    for (const y of [asset.bounds[1], asset.bounds[4]])
      for (const z of [asset.bounds[2], asset.bounds[5]])
        corners.push(project(x, y, z));
  const left = Math.min(...corners.map((p) => p.x)),
    top = Math.min(...corners.map((p) => p.y));
  const width = Math.max(0.01, Math.max(...corners.map((p) => p.x)) - left),
    height = Math.max(0.01, Math.max(...corners.map((p) => p.y)) - top);
  const factor = (size - 8) / Math.max(width, height),
    offsetX = (size - width * factor) / 2,
    offsetY = (size - height * factor) / 2;
  const triangles: { depth: number; path: string }[] = [];
  let sampled = 0;
  const stride = Math.max(1, Math.ceil(asset.triangleCount / 2048));
  for (const primitive of resource.primitives) {
    const vertexStride = primitive.normal ? 12 : 8;
    for (let index = 0; index < primitive.indices.length; index += 3) {
      if (sampled++ % stride) continue;
      const points = [];
      let u = 0,
        v = 0;
      for (let k = 0; k < 3; k++) {
        const at = primitive.indices[index + k] * vertexStride;
        points.push(
          project(
            primitive.vertices[at],
            primitive.vertices[at + 1],
            primitive.vertices[at + 2],
          ),
        );
        u += primitive.vertices[at + 3] / 3;
        v += primitive.vertices[at + 4] / 3;
      }
      const color = [...primitive.color];
      const image =
        primitive.image === undefined
          ? undefined
          : resource.images[primitive.image];
      if (image) {
        const px = Math.max(
            0,
            Math.min(image.width - 1, Math.floor(u * image.width)),
          ),
          py = Math.max(
            0,
            Math.min(image.height - 1, Math.floor(v * image.height)),
          );
        const at = (py * image.width + px) * 4;
        for (let channel = 0; channel < 4; channel++)
          color[channel] *= image.pixels[at + channel] / 255;
      }
      if (color[3] < primitive.alphaCutoff) continue;
      const shade =
        0.8 +
        0.2 *
          Math.max(
            0,
            Math.min(
              1,
              points[0].depth / Math.max(1, Math.abs(points[0].depth)),
            ),
          );
      const rgb = color
        .slice(0, 3)
        .map((value) =>
          Math.round(Math.max(0, Math.min(1, value * shade)) * 255),
        );
      const polygon = points
        .map(
          (p) =>
            `${(offsetX + (p.x - left) * factor).toFixed(2)},${(offsetY + (p.y - top) * factor).toFixed(2)}`,
        )
        .join(" ");
      triangles.push({
        depth: points.reduce((sum, p) => sum + p.depth, 0),
        path: `<polygon points="${polygon}" fill="rgb(${rgb.join(",")})"/>`,
      });
    }
  }
  triangles.sort((a, b) => a.depth - b.depth);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${triangles.map((t) => t.path).join("")}</svg>`;
}
