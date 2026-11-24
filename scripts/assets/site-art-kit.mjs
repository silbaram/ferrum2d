// Pixel drawing helpers for the example site's own art (scripts/assets/build-example-*.mjs).
// Everything is drawn in code and written as PNG, so the same script always gives the same files.
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {encodePngRgba} from '../tools/pack-textures.mjs';

/** The public folder of one example, created if missing. */
export async function exampleFolder(id) {
  const root = fileURLToPath(new URL(`../../examples/site/public/examples/${id}/`, import.meta.url));
  await mkdir(root, {recursive: true});
  return root;
}

/** An RGBA image. Colors are "rrggbb" strings or [r, g, b, a] arrays. */
export function image(root, width, height) {
  const pixels = new Uint8Array(width * height * 4);
  const color = value => typeof value === 'string'
    ? [...value.matchAll(/[0-9a-f]{2}/gi)].map(v => parseInt(v[0], 16)).concat(255).slice(0, 4)
    : value;
  /** Source-over blend, so translucent layers build up. */
  const point = (x, y, c) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const [r, g, b, a] = color(c), i = (y * width + x) * 4, src = a / 255, dst = pixels[i + 3] / 255;
    const out = src + dst * (1 - src);
    if (out <= 0) return;
    for (const [k, v] of [[0, r], [1, g], [2, b]]) pixels[i + k] = Math.round((v * src + pixels[i + k] * dst * (1 - src)) / out);
    pixels[i + 3] = Math.round(out * 255);
  };
  const rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) point(i, j, c); };
  return {width, height, pixels, point, rect, save: name => writeFile(root + name + '.png', encodePngRgba(width, height, pixels))};
}

/** Small seeded generator (mulberry32) so random details are the same on every build. */
export function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
