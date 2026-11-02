import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encodePngRgba, packTexturePngs } from '../../scripts/tools/pack-textures.mjs';

// Deliberately contrasting neighbors, odd sizes, and nontrivial edge alpha/RGB.
export async function createAtlasFixtures(root) {
  const inputDir = join(root, 'input');
  await mkdir(inputDir, { recursive: true });
  const sources = [];
  for (const [name, width, height] of [['hero', 7, 5], ['neighbor', 3, 9], ['tiny', 1, 1]]) {
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const color = name === 'neighbor' ? [20, 240, 40, 255] : [180 + x * 8, 20 + y * 20, 80, 255];
      if (name === 'hero' && y === 0 && x < 2) color[3] = x === 0 ? 0 : 128;
      pixels.set(color, (y * width + x) * 4);
    }
    await writeFile(join(inputDir, name + '.png'), encodePngRgba(width, height, pixels));
    sources.push({ name, width, height, pixels });
  }
  const atlases = [];
  for (const extrude of [undefined, 0, 1, 2]) {
    const name = extrude === undefined ? 'default' : 'extrude-' + extrude;
    const outputImage = join(root, name + '.png'), outputJson = join(root, name + '.json');
    const layout = await packTexturePngs({ inputDir, outputImage, outputJson, padding: 2, extrude, maxSize: 64 });
    atlases.push({ name, extrude: extrude ?? 0, image: name + '.png', width: layout.width, height: layout.height,
      frames: layout.frames, placements: layout.placements.map(({ sprite, ...p }) => p) });
  }
  // Isolate frame boundaries from differences in normalized nearest sampling
  // between textures of different dimensions. Each reference has the identical
  // atlas dimensions/UVs, with a single frame clamped across the whole image.
  const layout = atlases[0];
  for (const source of sources) {
    const placement = layout.placements.find(p => p.name === source.name), pixels = new Uint8Array(layout.width * layout.height * 4);
    for (let y = 0; y < layout.height; y++) for (let x = 0; x < layout.width; x++) {
      const sx = Math.max(0, Math.min(source.width - 1, x - placement.x)), sy = Math.max(0, Math.min(source.height - 1, y - placement.y));
      pixels.set(source.pixels.subarray((sy * source.width + sx) * 4, (sy * source.width + sx) * 4 + 4), (y * layout.width + x) * 4);
    }
    await writeFile(join(root, 'reference-' + source.name + '.png'), encodePngRgba(layout.width, layout.height, pixels));
  }
  return { inputDir, sources, atlases };
}
