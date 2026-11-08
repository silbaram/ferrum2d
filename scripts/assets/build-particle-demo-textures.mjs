// Original deterministic masks for the Feature Lab. White RGB is tinted by native particles.
import { mkdir, writeFile } from 'node:fs/promises';
import { encodePngRgba } from '../tools/pack-textures.mjs';
const out = new URL('../../examples/starter-runtime/public/playground/', import.meta.url);
await mkdir(out, { recursive: true });
const smooth = x => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const masks = {
  spark(x, y) {
    const radius = Math.hypot(x, y);
    return Math.max(Math.exp(-radius * radius * 25),
      smooth(1 - Math.abs(x) / .12) * smooth(1 - Math.abs(y) / .94),
      smooth(1 - Math.abs(y) / .12) * smooth(1 - Math.abs(x) / .94));
  },
  dust(x, y) {
    let alpha = 0;
    for (const [cx, cy, r] of [[-.29,.12,.51],[.18,.26,.48],[.31,-.14,.4],[-.12,-.27,.48],[0,0,.62]]) {
      const d = Math.hypot(x - cx, y - cy) / r;
      alpha = 1 - (1 - alpha) * (1 - smooth((1 - d) / .48) * .65);
    }
    return alpha * (.9 + .1 * Math.sin(x * 19 + y * 13));
  },
  trail(x, y) { return smooth((1 - Math.hypot(x, y)) / .8); },
};
for (const [name, mask] of Object.entries(masks)) {
  const size = name === 'dust' ? 48 : 24, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (y * size + x) * 4;
    pixels.set([255,255,255,Math.round(Math.max(0,Math.min(1,mask((x + .5) / size * 2 - 1,(y + .5) / size * 2 - 1))) * 255)],at);
  }
  await writeFile(new URL(`particle-${name}.png`,out), encodePngRgba(size,size,pixels));
}
console.log('Generated original spark, dust and trail particle masks.');
