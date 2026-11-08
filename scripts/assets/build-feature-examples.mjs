// Small independent scenes, using the existing original Engine Playground textures.
// Regenerates feature JSON and an original audio cue; it does not modify hand-edited artwork.
import { mkdir, writeFile } from 'node:fs/promises';
const out = new URL('../../examples/starter-runtime/public/features/', import.meta.url);
await mkdir(out, { recursive: true });
const sprite = (texture, width, height, extra = {}) => ({ kind: 'sprite', texture, width, height, ...extra });
const box = (w, h) => ({ type: 'aabb', halfWidth: w / 2, halfHeight: h / 2, isTrigger: false });
const object = (id, x, y, visual, collider = 'none', body, layer = 'wall') => ({
  id, prefab: 'object', x, y, props: { components: { visual, collider, layer, ...(body ? { body } : {}) } },
});
const frames = Array.from({ length: 4 }, (_, i) => ({ u0: i / 4, v0: 0, u1: (i + 1) / 4, v1: 1 }));
const animationSet = { initialClip: 1, clips: [{ id: 0, frames: [frames[0]], fps: 1, loop: true }, { id: 1, frames, fps: 6, loop: true }] };
const border = { sourceWidth: 24, sourceHeight: 24, left: 4, right: 4, top: 4, bottom: 4, borderScale: 2 };
const robot = (x, y, scale = 1, moving = false) => object('robot', x, y,
  sprite('robot', 32 * scale, 40 * scale, { animationSet, ...(moving ? { originY: .85 } : {}) }),
  moving ? box(12, 12) : 'none', moving ? { type: 'kinematic' } : undefined, 'player');
// Comparison topics keep the source pixels fixed so only the feature under test changes.
const stillRobot = (x, y, scale = 1) => object('robot', x, y, sprite('robot', 32 * scale, 40 * scale, { frame: frames[0] }), 'none', undefined, 'player');
const wall = (id, x, y, w, h) => object(id, x, y, sprite('wall', w, h), box(w, h), { type: 'static' });
const floor = () => Array.from({ length: 60 }, (_, i) => object(`floor_${i}`, (i % 10) * 64 + 32, Math.floor(i / 10) * 64 + 32, sprite('floor', 64, 64, { layer: -100 })));
const scenes = {
  animation: [robot(320, 192, 3, true)],
  'destructible-terrain': [object('terrain', 320, 256, sprite('floor', 512, 192)),
    object('ball', 320, 80, sprite('ball', 24, 24), { type: 'circle', radius: 12, isTrigger: false }, { type: 'dynamic', mass: 1, canSleep: false }, 'player'),
    wall('bedrock', 320, 376, 592, 16)],
  navigation: [...floor(), wall('obstacle', 320, 192, 64, 192), robot(128, 192, 1, true)],
  physics: [
    object('tray', 320, 192, sprite('panel', 464, 272, { nineSlice: border, layer: -10 })),
    wall('north', 320, 64, 448, 8), wall('south', 320, 320, 448, 8), wall('west', 100, 192, 8, 256), wall('east', 540, 192, 8, 256),
    object('ball', 200, 192, sprite('ball', 32, 32), { type: 'circle', radius: 16, isTrigger: false }, { type: 'dynamic', mass: 1, gravityScale: 0, linearDamping: .08, material: { friction: .02, restitution: .92 } }),
  ],
  lighting: [stillRobot(240, 192, 3), object('ball', 432, 192, sprite('ball', 128, 128))],
  postprocess: [object('panel', 320, 192, sprite('panel', 400, 256, { nineSlice: border, layer: -10 })), stillRobot(240, 192, 2), object('ball', 400, 192, sprite('energy', 96, 96))],
  camera: [...floor(), robot(128, 192, 1, true), object('marker_left', 64, 96, sprite('energy', 24, 24)), object('marker_right', 576, 288, sprite('ball', 32, 32))],
  'nine-slice': [object('stretched', 160, 176, sprite('panel', 256, 144)), object('sliced', 480, 176, sprite('panel', 256, 144, { nineSlice: border })), object('source', 320, 352, sprite('panel', 72, 72))],
  layers: [object('backdrop', 320, 192, sprite('panel', 480, 288, { layer: -100, nineSlice: border })),
    { ...stillRobot(300, 192, 3), layer: 2 },
    { ...object('orb', 340, 160, sprite('ball', 128, 128)), layer: 1 },
    { ...object('panel', 340, 264, sprite('panel', 224, 112, { nineSlice: border })), layer: -1 }],
  particles: [object('tray', 320, 192, sprite('panel', 560, 320, { nineSlice: border, layer: -100 })), object('marker', 320, 192, sprite('energy', 8, 8))],
  audio: [...floor(), stillRobot(320, 304, 1.5), object('source', 160, 176, sprite('energy', 48, 48), { type: 'circle', radius: 1, isTrigger: true }, { type: 'kinematic' })],
};
for (const [id, instances] of Object.entries(scenes)) {
  const moving = id === 'animation' || id === 'navigation' || id === 'camera';
  const costs = Array.from({ length: 40 * 24 }, (_, i) => {
    const x = (i % 40) * 16 + 8, y = Math.floor(i / 40) * 16 + 8;
    return x < 16 || x > 624 || y < 16 || y > 368 || (id === 'navigation' && Math.abs(x - 320) < 40 && Math.abs(y - 192) < 104) ? 0 : 1;
  });
  const scene = {
    format: 'ferrum2d.consumer.scene-authoring', version: 1,
    behaviorRecipes: { entities: {} },
    ...(moving ? { gameplay: { primaryActor: 'robot' }, navigation: { columns: 40, rows: 24, cellWidth: 16, cellHeight: 16, costs } } : {}),
    sceneComposition: { initialFragment: 'lab', prefabs: { object: id === 'nine-slice' ? { props: { behaviorRecipes: [] } } : {} }, fragments: { lab: { instances } } },
  };
  await writeFile(new URL(`${id}.json`, out), JSON.stringify(scene, null, 2) + '\n');
}
// Gameplay/content labs use the same assets, with native recipes and variable storage.
const bind = (instance, recipe) => ({ ...instance, props: { ...instance.props, behaviorRecipes: [recipe] } });
for (const id of ['scenes', 'interaction', 'save-load', 'dialogue', 'hud', 'cutscene', 'asset-loading', 'streaming']) {
  const moving = id === 'interaction' || id === 'save-load';
  const instances = [...floor(), moving ? robot(128, 192, 1, true) : stillRobot(240, 192, 2)];
  const scene = {
    format: 'ferrum2d.consumer.scene-authoring', version: 1, behaviorRecipes: { entities: {} },
    sceneComposition: { initialFragment: 'lab', prefabs: { object: {} }, fragments: { lab: { instances } } },
  };
  if (moving) {
    scene.gameplay = { primaryActor: 'robot' };
    scene.navigation = { columns: 40, rows: 24, cellWidth: 16, cellHeight: 16,
      costs: Array.from({ length: 960 }, (_, i) => i % 40 === 0 || i % 40 === 39 || i < 40 || i >= 920 ? 0 : 1) };
  }
  if (id === 'scenes') {
    scene.variables = [{ name: 'local', scope: 'scene', type: 'integer', default: 0 }, { name: 'total', scope: 'global', type: 'integer', default: 0 }];
    instances.push(object('beacon', 416, 192, sprite('energy', 80, 80)));
    scene.sceneComposition.fragments.other = { instances: [...floor(), stillRobot(400, 192, 2), object('beacon', 224, 192, sprite('ball', 80, 80))] };
  }
  if (id === 'interaction') {
    scene.gameplay.interactionInputActionId = 91;
    scene.ids = { actions: { unlock: 17, open: 18 } };
    scene.variables = [{ name: 'unlocked', scope: 'scene', type: 'bool', default: false }, { name: 'uses', scope: 'scene', type: 'integer', default: 0 }];
    instances[60] = bind(instances[60], 'operator');
    instances.push(
      bind(object('switch', 224, 160, sprite('energy', 32, 32)), 'switch'),
      bind(object('door', 480, 160, sprite('panel', 48, 64, { nineSlice: border })), 'door'),
      object('zone', 320, 272, sprite('panel', 128, 80, { nineSlice: border, layer: -50 }), { ...box(128, 80), isTrigger: true }, { type: 'static' }, 'enemy'),
    );
    scene.behaviorRecipes.entities = {
      operator: { recipes: [
        { kind: 'setVariable', variable: 'unlocked', value: true, when: { type: 'gameplayEvent', event: 'interaction', action: 'unlock' } },
        { kind: 'incrementVariable', variable: 'uses', amount: 1, when: { type: 'gameplayEvent', event: 'interaction', action: 'open' } },
      ] },
      switch: { recipes: [{ kind: 'interaction', action: 'unlock', radius: 64, once: true }] },
      door: { recipes: [{ kind: 'interaction', action: 'open', radius: 64, once: false, guard: { variable: 'unlocked', op: '==', value: true } }] },
    };
  }
  if (id === 'save-load') {
    scene.ids = { items: { energy: 2 } };
    scene.variables = [{ name: 'collected', scope: 'scene', type: 'integer', default: 0 }];
    instances[60] = bind(instances[60], 'collector');
    instances.push(bind(object('energy', 448, 192, sprite('energy', 32, 32), { ...box(24, 24), isTrigger: true }, { type: 'static' }, 'pickup'), 'energy'));
    scene.behaviorRecipes.entities = {
      collector: { recipes: [{ kind: 'collisionPickup', target: 'other' }, { kind: 'incrementVariable', variable: 'collected', amount: 1, when: { type: 'gameplayEvent', event: 'pickupCollected', item: 'energy' } }] },
      energy: { recipes: [{ kind: 'pickup', item: 'energy', count: 1, despawn: true }] },
    };
  }
  if (['dialogue', 'hud', 'cutscene', 'asset-loading', 'streaming'].includes(id)) instances.push(object('energy', 416, 192, sprite('energy', 64, 64)));
  if (id === 'hud') scene.variables = [{ name: 'health', scope: 'scene', type: 'integer', default: 100 }];
  await writeFile(new URL(`${id}.json`, out), JSON.stringify(scene, null, 2) + '\n');
}
// Tilemap/input deliberately reuse the native Shooter controller, without enemy waves.
for (const id of ['tilemap', 'input', 'projectiles']) {
  const cells = Array.from({ length: 20 * 12 }, (_, i) => {
    const x = i % 20, y = Math.floor(i / 20);
    return x === 0 || x === 19 || y === 0 || y === 11 || ((id === 'tilemap' || id === 'projectiles') && x === 10) ? 2 : 0;
  });
  const frame = (texture, width, height, u1 = 1) => ({ texture, size: { width, height }, uv: { u0: 0, v0: 0, u1, v1: 1 } });
  await writeFile(new URL(`${id}.json`, out), JSON.stringify({
    world: { width: 640, height: 384 }, player: { speed: 144 },
    enemies: { spawnInterval: 86400 }, weapons: { cooldown: 1, lifetime: .2 },
    prefabs: { player: { frame: 'robot' }, enemy: { frame: 'robot' }, bullet: { frame: 'energy' } },
    atlas: { frames: { robot: frame('robot', 24, 30, .25), energy: frame('energy', 6, 6), floor: frame('floor', 32, 32), wall: frame('wall', 32, 32) } },
    tilemap: { tileWidth: 32, tileHeight: 32, tiles: { 1: { frame: 'floor' }, 2: { frame: 'wall' } },
      layers: [{ name: 'floor', columns: 20, rows: 12, data: Array(240).fill(1) }, { name: 'walls', columns: 20, rows: 12, collision: true, data: cells }] },
    camera: { preset: 'dead-zone', deadZone: { width: 640, height: 384 } }, physics: { mode: 'arcade' },
  }, null, 2) + '\n');
}
// Original, quiet two-harmonic cue. PCM WAV keeps this demo offline and reproducible.
const rate = 22050, samples = rate, wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
  const t = i / rate, envelope = Math.sin(Math.PI * t) ** 2;
  wav.writeInt16LE(Math.round(6000 * envelope * (Math.sin(2 * Math.PI * 440 * t) + .3 * Math.sin(2 * Math.PI * 660 * t))), 44 + i * 2);
}
await writeFile(new URL('beacon.wav', out), wav);
console.log('Generated twenty-two flat engine feature fixtures and the original spatial audio cue.');
await import('./build-hd2d-feature-scenes.mjs');
