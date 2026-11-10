import { equal } from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('packed public declarations compile in an ES2022 consumer without skipping library checks', async () => {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/ferrum-web');
  const project = await mkdtemp(join(tmpdir(), 'ferrum-public-types-'));
  try {
    const packed = join(project, 'packed');
    const installed = join(project, 'node_modules/@ferrum2d/ferrum-web');
    await mkdir(packed);
    await mkdir(installed, { recursive: true });
    await run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['pack', '--pack-destination', packed], packageRoot, 'Package pack');
    const tarballs = (await readdir(packed)).filter(name => name.endsWith('.tgz'));
    equal(tarballs.length, 1, 'expected one packed runtime package');
    await run('tar', ['-xzf', join(packed, tarballs[0]), '-C', installed, '--strip-components=1'], project, 'Packed package extraction');
    await writeFile(join(project, 'consumer.ts'), `
      import { createRenderer, restoreGameStateSnapshot,
        type PixelPerfectOptions, type FerrumEngine, type SpatialModelInstanceSpec, type SpatialDirectionalLightSpec,
        type SpriteLightingMaterialSpec, type SpriteLightingBufferView, type FlatLightingPreparer,
        type GameStateSnapshot,
      } from '@ferrum2d/ferrum-web/core';
      import {
        createSceneInstanceHandleRegistry,
        type ApplySceneBehaviorRecipesOptions,
        type SceneInstanceHandleRegistry,
        type ScenePlacementViewer,
        type SceneSpatialPatch,
        type FlatLightingAsset,
        type FlatLightingPreparer as AuthoringFlatLightingPreparer,
        applyDataSceneAuthoringDocument,
      } from '@ferrum2d/ferrum-web/authoring';
      import '@ferrum2d/ferrum-web/starter-scenes';
      import type { LightingScene2D } from '@ferrum2d/ferrum-web/labs';
      import '@ferrum2d/ferrum-web/quality';
      const config: PixelPerfectOptions = { width: 320, height: 180, snap: true };
      const disabled: PixelPerfectOptions = { ...config, snap: false };
      // @ts-expect-error snap is strictly boolean
      const invalid: PixelPerfectOptions = { ...config, snap: 'on' };
      declare const engine: FerrumEngine;
      declare const viewer: ScenePlacementViewer;
      declare const renderer: Awaited<ReturnType<typeof createRenderer>>;
      declare const saved: GameStateSnapshot;
      const receiver: SpriteLightingMaterialSpec = { mode: 'cutout', alphaCutoff: 0.5 };
      const lighting: LightingScene2D = { profile: 'lit', ambientIrradiance: [0.2, 0.2, 0.2] };
      const assets: FlatLightingAsset[] = [{ textureId: 1, lighting: receiver }];
      const preparer: FlatLightingPreparer = renderer;
      const authoredPreparer: AuthoringFlatLightingPreparer = preparer;
      const words = new Uint32Array(2);
      const sidecar: SpriteLightingBufferView = { version: 1, stride: 2, words, values: new Float32Array(words.buffer) };
      engine.configureSpriteLightingMaterials([{ entity: { entityId: 1, entityGeneration: 1 }, lighting: receiver }]);
      renderer.loadTexture(1, 'surface.png', { alphaMode: 'straight' });
      renderer.prepareFlatLighting(lighting, assets);
      renderer.setLighting(lighting);
      applyDataSceneAuthoringDocument(engine, {}, { flatLightingPreparer: authoredPreparer });
      restoreGameStateSnapshot(engine, saved, { dataSceneAuthoringApplyOptions: { flatLightingPreparer: preparer } });
      // @ts-expect-error receiver modes are explicit
      const invalidReceiver: SpriteLightingMaterialSpec = { mode: 'lit' };
      // @ts-expect-error the alpha upload override accepts straight alpha only
      renderer.loadTexture(1, 'surface.png', { alphaMode: 'premultiplied' });
      void [sidecar, invalidReceiver];
      const sun: SpatialDirectionalLightSpec = { direction: { x: -1, y: -1, elevation: 1 }, shadows: { center: { x: 0, y: 10, elevation: 12 } } };
      engine.setDataSceneSpatialEnvironment({ lighting: { lights: [], directional: sun } });
      engine.setDataSceneSpatialEnvironment({ composition: 'separated', lighting: { lights: [] }, ambientOcclusion: { strength: 0 } });
      // @ts-expect-error composition choices are explicit
      engine.setDataSceneSpatialEnvironment({ composition: 'ambient-only' });
      // @ts-expect-error fixed sun center requires all three world coordinates
      const incompleteCenter: NonNullable<SpatialDirectionalLightSpec['shadows']> = { center: { x: 0, y: 0 } };
      const proxy: SpatialModelInstanceSpec = { asset: 'proxy', contentId: 'a'.repeat(64), shadowOnly: true };
      const shadowPatch: SceneSpatialPatch = { format: 'ferrum2d.scene-spatial.patch', version: 7,
        operations: [{ kind: 'updateModel', id: 'proxy', changes: { shadowOnly: false } }] };
      viewer.updateSpatial(shadowPatch.operations);
      // @ts-expect-error shadowOnly requires a boolean
      const invalidProxy: SpatialModelInstanceSpec = { ...proxy, shadowOnly: 'on' };
      const registry: SceneInstanceHandleRegistry = createSceneInstanceHandleRegistry({
        entityExists: handle => handle.entityGeneration > 0,
      });
      registry.set('actor', { entityId: 1, entityGeneration: 1 });
      const behaviorOptions: ApplySceneBehaviorRecipesOptions = { instanceHandleRegistry: registry };
      viewer.addInstances('main', [{ id: 'tile_0', prefab: 'tile', x: 16, y: 16 }] as const);
      // @ts-expect-error batch requires a fragment string
      viewer.addInstances(1, []);
      // @ts-expect-error entries require a prefab
      viewer.addInstances('main', [{ id: 'tile_1' }]);
      void [config, disabled, invalid, engine, behaviorOptions, proxy, invalidProxy, sun, incompleteCenter];
    `);
    await writeFile(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: [], strict: true, skipLibCheck: false, noEmit: true,
    }, files: ['consumer.ts'] }));
    const require = createRequire(join(packageRoot, 'package.json'));
    const output = await run(process.execPath, [require.resolve('typescript/lib/tsc.js'), '--project', join(project, 'tsconfig.json')], project, 'ES2022 public declaration check');
    equal(output, '');
  } finally { await rm(project, { recursive: true, force: true }); }
});

function run(command, args, cwd, label) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) done(output);
      else reject(new Error(`${label} failed (${code ?? signal}):\n${output}`));
    });
  });
}
