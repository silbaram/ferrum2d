// Original Ferrum2D pixel sources, generated deterministically without external art.
// The .pixel.json files are editable sources; PNGs and scene.json are derived assets.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { encodePngRgba } from '../../../scripts/tools/pack-textures.mjs';

const root = new URL('../public/', import.meta.url);
await mkdir(new URL('assets/', root), { recursive: true });
const rgba = hex => [...hex.match(/../g).map(n => parseInt(n, 16)), 255];
const palette = {
  ink: '25333d', hair: '513b40', hairLight: '80533e', skin: 'f3bd8a', blush: 'db8a70',
  coat: '53b89a', coatLight: '97dfb4', coatDark: '347768', boots: '43425b', gold: 'f4c879',
  grass: '3b624e', grassLight: '477658', grassDark: '315643', path: 'b2aa8a', pathLight: 'd2c5a0',
  stone: '627276', stoneLight: '92a09a', stoneDark: '46565f', water: '326c86', waterLight: '55a2aa',
  flower: 'e898a3', white: 'fff1cb',
};
const image = (width, height) => ({ width, height, pixels: Buffer.alloc(width * height * 4) });
function dot(img, x, y, color) {
  if (x >= 0 && x < img.width && y >= 0 && y < img.height) img.pixels.set(rgba(palette[color] ?? color), (y * img.width + x) * 4);
}
function rect(img, x, y, width, height, color) {
  for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) dot(img, xx, yy, color);
}
function paste(target, source, x, y) {
  for (let row = 0; row < source.height; row++) target.pixels.set(source.pixels.subarray(row * source.width * 4, (row + 1) * source.width * 4), ((y + row) * target.width + x) * 4);
}
async function json(name, value) { await writeFile(new URL(name, root), JSON.stringify(value, null, 2) + '\n'); }
async function png(name, value) { await writeFile(new URL('assets/' + name + '.png', root), encodePngRgba(value.width, value.height, value.pixels)); }
const sourcePalette = ['#00000000', ...Object.values(palette).map(hex => '#' + hex + 'ff')];
function source(name, frames, tags) {
  return {
    format: 'ferrum2d.pixel-document', version: 7, name, width: frames[0].width, height: frames[0].height,
    colorSpace: 'srgb', palette: sourcePalette,
    layers: [{ id: 'paint', name: '도트', visible: true, locked: false }],
    frames: frames.map((frame, i) => ({ id: 'frame_' + i, durationMs: [120, 90, 120, 160][i % 4], cels: [{ layerId: 'paint', rgba: frame.pixels.toString('base64') }] })),
    tags, initialTag: tags[0].id, nextClipId: tags.length,
  };
}

const heroFrames = Array.from({ length: 4 }, (_, frame) => {
  const img = image(24, 24), bob = frame % 2;
  rect(img, 7, 19, 11, 2, 'ink');
  rect(img, 8, 18 + bob, 3, 4 - bob, 'boots');
  rect(img, 14, 18 + (1 - bob), 3, 3 + bob, 'boots');
  rect(img, 7, 11 + bob, 11, 8, 'ink');
  rect(img, 8, 12 + bob, 9, 6, 'coat');
  rect(img, 8, 12 + bob, 3, 5, 'coatLight');
  rect(img, 15, 13 + bob, 2, 5, 'coatDark');
  rect(img, 11, 12 + bob, 2, 6, 'gold');
  rect(img, 5, 12 + bob, 3, 5, 'coatDark');
  rect(img, 5, 16 + bob, 3, 2, 'skin');
  rect(img, 17, 12 + bob, 3, 5, 'coatDark');
  rect(img, 18, 16 + bob, 2, 2, 'skin');
  rect(img, 7, 3 + bob, 11, 9, 'ink');
  rect(img, 8, 4 + bob, 9, 7, 'skin');
  rect(img, 8, 4 + bob, 9, 3, 'hair');
  rect(img, 9, 3 + bob, 7, 2, 'hairLight');
  rect(img, 8, 6 + bob, 2, 2, 'hair');
  dot(img, 11, 8 + bob, 'ink'); dot(img, 15, 8 + bob, 'ink');
  dot(img, 10, 9 + bob, 'blush'); dot(img, 16, 9 + bob, 'blush');
  return img;
});
const tags = [
  { id: 'idle', name: '가만히', clipId: 0, frameIds: ['frame_0'], loop: true },
  { id: 'walk', name: '걷기', clipId: 1, frameIds: ['frame_0', 'frame_1', 'frame_2', 'frame_3'], loop: true, direction: 'pingpong' },
];
await json('assets/keeper.pixel.json', source('정원지기', heroFrames, tags));
const hero = image(48, 48);
heroFrames.forEach((frame, i) => paste(hero, frame, i % 2 * 24, Math.floor(i / 2) * 24));
await png('keeper', hero);

// Deliberately painted rounded normals share the color sheet's exact frame layout.
// Normal RGB is data (colorSpace:none), not a palette-constrained color image.
// OpenGL tangent +Y points up, opposite to the image's increasing row coordinate.
const normal = image(48, 48);
for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
  const i = (y * 48 + x) * 4;
  if (!hero.pixels[i + 3]) continue;
  const nx = ((x % 24) - 12) / 16, ny = (12 - (y % 24)) / 22, nz = 1;
  const length = Math.hypot(nx, ny, nz);
  normal.pixels.set([Math.round((nx / length + 1) * 127.5), Math.round((ny / length + 1) * 127.5), Math.round((nz / length + 1) * 127.5), 255], i);
}
await png('keeper-normal', normal);

const tiles = image(64, 16);
for (let y = 0; y < 16; y++) for (let x = 0; x < 64; x++) {
  const col = x % 16, type = Math.floor(x / 16), speckle = (col * 11 + y * 7) % 23;
  let color = speckle < 2 ? 'grassLight' : speckle === 3 ? 'grassDark' : 'grass';
  if (type === 1) color = y % 8 === 0 || (col + (y < 8 ? 0 : 4)) % 8 === 0 ? 'stone' : speckle < 3 ? 'pathLight' : 'path';
  if (type === 2) color = y % 6 === 0 ? 'stoneDark' : y % 6 === 1 ? 'stoneLight' : 'stone';
  if (type === 3) color = y % 5 === 1 && col > 2 && col < 12 ? 'waterLight' : 'water';
  dot(tiles, x, y, color);
}
await png('tiles', tiles);
const star = image(16, 16);
for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
  if (Math.abs(x - 7.5) + Math.abs(y - 7.5) < 6) dot(star, x, y, x < 8 && y < 8 ? 'white' : 'gold');
}
await png('star', star);
await json('assets/star.pixel.json', source('빛의 씨앗', [star], [{ id: 'idle', name: '빛', clipId: 0, frameIds: ['frame_0'], loop: true }]));
const flower = image(16, 16);
rect(flower, 7, 7, 2, 8, 'coatDark'); rect(flower, 4, 10, 4, 2, 'coatLight');
rect(flower, 9, 11, 4, 2, 'coat'); rect(flower, 5, 3, 6, 6, 'flower');
rect(flower, 3, 5, 10, 2, 'flower'); rect(flower, 7, 4, 2, 4, 'white');
await png('flower', flower);

const uv = index => ({ u0: index % 2 / 2, v0: Math.floor(index / 2) / 2, u1: (index % 2 + 1) / 2, v1: (Math.floor(index / 2) + 1) / 2 });
const components = (texture, width, height, extra = {}) => ({ visual: { kind: 'sprite', texture, width, height, originX: .5, originY: .5, ...extra }, collider: 'none', layer: 'wall' });
const instances = [], costs = [];
for (let row = 0; row < 12; row++) for (let col = 0; col < 20; col++) {
  const edge = row === 0 || row === 11 || col === 0 || col === 19;
  const pond = col >= 13 && col <= 16 && row >= 2 && row <= 4;
  const path = row === 6 || row === 7 || col === 9 || col === 10;
  const tile = edge ? 2 : pond ? 3 : path ? 1 : 0;
  const c = components('tiles', 16, 16, { frame: { u0: tile / 4, v0: 0, u1: (tile + 1) / 4, v1: 1 } });
  if (edge || pond) c.collider = { type: 'aabb', halfWidth: 8, halfHeight: 8, isTrigger: false };
  instances.push({ id: `ground_${col}_${row}`, prefab: 'object', x: col * 16 + 8, y: row * 16 + 8, layer: -10, props: { components: c } });
  costs.push(edge || pond ? 0 : 1);
}
for (const [index, x, y] of [[0, 56, 48], [1, 112, 48], [2, 48, 144], [3, 272, 144], [4, 80, 152], [5, 288, 48]]) {
  instances.push({ id: 'flower_' + index, prefab: 'object', x, y, props: { components: components('flower', 16, 16) } });
}
const targets = [{ x: 72, y: 72 }, { x: 248, y: 120 }, { x: 168, y: 40 }];
targets.forEach((p, i) => instances.push({ id: 'star_' + i, prefab: 'star', ...p }));
instances.push({ id: 'keeper', prefab: 'keeper', x: 152, y: 152 });
const actor = components('keeper', 24, 24, { normalTexture: 'keeperNormal', originY: .8, animationSet: {
  initialClip: 0, clips: tags.map(tag => ({ id: tag.clipId, frames: tag.frameIds.map(id => uv(Number(id.slice(6)))), frameDurationsMs: tag.frameIds.map(id => [120, 90, 120, 160][Number(id.slice(6))]), loop: true, ...(tag.direction ? { direction: tag.direction } : {}) })),
} });
actor.layer = 'player'; actor.collider = { type: 'aabb', halfWidth: 4, halfHeight: 4, isTrigger: false };
actor.body = { type: 'kinematic', heightSpan: { floorId: 0, elevation: 0, height: 1 } };
const pickup = components('star', 12, 12);
pickup.layer = 'pickup'; pickup.collider = { type: 'aabb', halfWidth: 5, halfHeight: 5, isTrigger: true };
const scene = {
  format: 'ferrum2d.consumer.scene-authoring', version: 1,
  display: { pixelPerfect: { width: 320, height: 192 } },
  gameplay: { primaryActor: 'keeper' }, ids: { items: { seed: 1 } },
  variables: [{ name: 'seeds', scope: 'scene', type: 'integer', default: 0 }],
  navigation: { columns: 20, rows: 12, cellWidth: 16, cellHeight: 16, costs },
  sceneComposition: { initialFragment: 'garden', prefabs: {
    object: {}, keeper: { props: { components: actor, behaviorRecipes: ['keeper'] } },
    star: { props: { components: pickup, behaviorRecipes: ['seed'] } },
  }, fragments: { garden: { instances } } },
  behaviorRecipes: { entities: {
    keeper: { recipes: [{ kind: 'collisionPickup', target: 'other' }, { kind: 'incrementVariable', variable: 'seeds', amount: 1, when: { type: 'gameplayEvent', event: 'pickupCollected', item: 'seed' } }] },
    seed: { recipes: [{ kind: 'pickup', item: 'seed', count: 1, despawn: true }] },
  } },
};
await json('scene.json', scene);
await json('assets/pixel-art.profile.json', {
  format: 'ferrum2d.consumer.pixel-art-profile', version: 1, scale: 3, filter: 'nearest', palette: sourcePalette,
  assets: [{ source: 'public/assets/keeper.png', tileWidth: 24, tileHeight: 24 }, { source: 'public/assets/tiles.png', tileWidth: 16, tileHeight: 16 }, { source: 'public/assets/star.png', tileWidth: 16, tileHeight: 16 }, { source: 'public/assets/flower.png', tileWidth: 16, tileHeight: 16 }],
});
console.log('Pixel showcase assets generated in ' + fileURLToPath(root));
