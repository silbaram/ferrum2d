#!/usr/bin/env node
// Original, deterministic art for the example site's "충돌과 트리거" example. No downloaded assets.
// The robot sheet is the Engine Playground robot (build-engine-playground.mjs), copied as is.
import {copyFile, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {encodePngRgba} from '../tools/pack-textures.mjs';

const root = fileURLToPath(new URL('../../examples/site/public/examples/collision/', import.meta.url));
await mkdir(root, {recursive: true});

function image(width, height) {
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
/** Small seeded generator (mulberry32) so the floor details are the same on every build. */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Floor: 32px slate tiles across the arena (608 × 352, world 16..624 × 16..368), drawn at 1:1 so nothing
// stretches. A soft shade runs along the outer walls.
{
  const floor = image(608, 352), next = random(2026);
  for (let ty = 0; ty < 11; ty++) for (let tx = 0; tx < 19; tx++) {
    const x = tx * 32, y = ty * 32, tone = next();
    floor.rect(x, y, 32, 32, tone < 0.12 ? '2b4752' : tone > 0.9 ? '27414c' : '29434e');
    floor.rect(x, y, 32, 1, '1c313b'); floor.rect(x, y, 1, 32, '1c313b');
    floor.rect(x + 1, y + 1, 30, 1, '33515c'); floor.rect(x + 1, y + 1, 1, 30, '2f4c57');
    floor.rect(x + 1, y + 31, 31, 1, '223a45'); floor.rect(x + 31, y + 1, 1, 31, '223a45');
    // A few worn pixels per tile.
    for (let n = 0; n < 3; n++) floor.point(x + 3 + Math.floor(next() * 26), y + 3 + Math.floor(next() * 26), next() < 0.5 ? '35545f' : '233c47');
    if (next() < 0.08) { const cx = x + 8 + Math.floor(next() * 14), cy = y + 8 + Math.floor(next() * 14); floor.rect(cx, cy, 3, 1, '1f3640'); floor.rect(cx + 2, cy + 1, 2, 1, '1f3640'); }
  }
  for (let y = 0; y < 352; y++) for (let x = 0; x < 608; x++) {
    const edge = Math.min(x, y, 607 - x, 351 - y) - 16;
    if (edge >= 0 && edge < 14) floor.point(x, y, [6, 14, 20, Math.round(110 * (1 - edge / 14) ** 2)]);
  }
  await floor.save('floor');
}

// Wall: a 16 × 16 nine-slice with 4px borders. Light from the top left, a flat face in the middle so any
// length stretches cleanly, and a rivet in each corner.
{
  const wall = image(16, 16);
  wall.rect(0, 0, 16, 16, '0c1c26');
  wall.rect(1, 1, 14, 14, '4a6d77');
  wall.rect(1, 1, 14, 1, '9cbcc0'); wall.rect(1, 2, 14, 2, '6f9298');
  wall.rect(1, 1, 1, 14, '7fa2a8');
  wall.rect(1, 12, 14, 2, '33525f'); wall.rect(1, 14, 14, 1, '213b48');
  wall.rect(14, 2, 1, 12, '3a5b68');
  for (const [x, y] of [[2, 2], [13, 2], [2, 12], [13, 12]]) wall.point(x, y, 'c8e0dc');
  await wall.save('wall');
}

// Zone: 112 × 96 hazard area at 1:1, red diagonal stripes inside a bright frame with corner brackets.
{
  const zone = image(112, 96);
  for (let y = 0; y < 96; y++) for (let x = 0; x < 112; x++) zone.point(x, y, ((x + y) % 16) < 8 ? [255, 107, 107, 72] : [255, 107, 107, 26]);
  zone.rect(0, 0, 112, 2, [255, 107, 107, 220]); zone.rect(0, 94, 112, 2, [255, 107, 107, 220]);
  zone.rect(0, 0, 2, 96, [255, 107, 107, 220]); zone.rect(110, 0, 2, 96, [255, 107, 107, 220]);
  zone.rect(2, 2, 108, 1, [255, 107, 107, 90]); zone.rect(2, 93, 108, 1, [255, 107, 107, 90]);
  zone.rect(2, 2, 1, 92, [255, 107, 107, 90]); zone.rect(109, 2, 1, 92, [255, 107, 107, 90]);
  for (const [x, y, dx, dy] of [[0, 0, 1, 1], [111, 0, -1, 1], [0, 95, 1, -1], [111, 95, -1, -1]]) {
    for (let i = 0; i < 10; i++) { zone.point(x + dx * i, y, 'ffc2b8'); zone.point(x, y + dy * i, 'ffc2b8'); zone.point(x + dx * i, y + dy, 'ffc2b8'); zone.point(x + dx, y + dy * i, 'ffc2b8'); }
  }
  await zone.save('zone');
}

// Energy: four 24 × 24 frames of the Engine Playground cell, its halo breathing in and out.
{
  const energy = image(96, 24);
  for (const [frame, glow] of [[0, 34], [1, 64], [2, 96], [3, 64]]) {
    const ox = frame * 24;
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
      const d = Math.hypot(x - 11.5, y - 11.5);
      if (d < 12) energy.point(ox + x, y, [110, 247, 208, Math.round(glow * (1 - d / 12) ** 1.5)]);
    }
    for (let y = 1; y < 23; y++) for (let x = 1; x < 23; x++) {
      const d = Math.abs(x - 12) + Math.abs(y - 12);
      if (d < 10) energy.point(ox + x, y, d < 6 ? (frame === 2 ? 'd2fff0' : 'b0ffe4') : '3cbbba');
    }
    energy.rect(ox + 11, 7, 2, 10, 'e5fff1');
  }
  await energy.save('energy');
}

await copyFile(fileURLToPath(new URL('../../examples/starter-runtime/public/playground/robot.png', import.meta.url)), root + 'robot.png');
console.log('Collision example art: floor, wall, zone, energy (4 frames) and the playground robot.');
