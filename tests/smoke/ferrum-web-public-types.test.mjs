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
      import type { PixelPerfectOptions, FerrumEngine } from '@ferrum2d/ferrum-web/core';
      import {
        createSceneInstanceHandleRegistry,
        type ApplySceneBehaviorRecipesOptions,
        type SceneInstanceHandleRegistry,
        type ScenePlacementViewer,
      } from '@ferrum2d/ferrum-web/authoring';
      import '@ferrum2d/ferrum-web/starter-scenes';
      import '@ferrum2d/ferrum-web/labs';
      import '@ferrum2d/ferrum-web/quality';
      const config: PixelPerfectOptions = { width: 320, height: 180, snap: true };
      const disabled: PixelPerfectOptions = { ...config, snap: false };
      // @ts-expect-error snap is strictly boolean
      const invalid: PixelPerfectOptions = { ...config, snap: 'on' };
      declare const engine: FerrumEngine;
      declare const viewer: ScenePlacementViewer;
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
      void [config, disabled, invalid, engine, behaviorOptions];
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
