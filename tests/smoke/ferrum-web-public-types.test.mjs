import { equal } from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('public package declarations compile in an ES2022 consumer without skipping library checks', async () => {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/ferrum-web');
  const project = await mkdtemp(join(tmpdir(), 'ferrum-public-types-'));
  try {
    await mkdir(join(project, 'node_modules/@ferrum2d'), { recursive: true });
    await symlink(packageRoot, join(project, 'node_modules/@ferrum2d/ferrum-web'), 'junction');
    await writeFile(join(project, 'consumer.ts'), `
      import type { PixelPerfectOptions, FerrumEngine } from '@ferrum2d/ferrum-web/core';
      import '@ferrum2d/ferrum-web/authoring';
      import '@ferrum2d/ferrum-web/starter-scenes';
      import '@ferrum2d/ferrum-web/labs';
      import '@ferrum2d/ferrum-web/quality';
      const config: PixelPerfectOptions = { width: 320, height: 180, snap: true };
      const disabled: PixelPerfectOptions = { ...config, snap: false };
      // @ts-expect-error snap is strictly boolean
      const invalid: PixelPerfectOptions = { ...config, snap: 'on' };
      declare const engine: FerrumEngine;
      void [config, disabled, invalid, engine];
    `);
    await writeFile(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: [], strict: true, skipLibCheck: false, noEmit: true,
    }, files: ['consumer.ts'] }));
    const require = createRequire(join(packageRoot, 'package.json'));
    const output = await new Promise((done, reject) => {
      const child = spawn(process.execPath, [require.resolve('typescript/lib/tsc.js'), '--project', join(project, 'tsconfig.json')], { cwd: project, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
      let diagnostics = '';
      child.stdout.on('data', bytes => { diagnostics += bytes; }); child.stderr.on('data', bytes => { diagnostics += bytes; });
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (code === 0) done(diagnostics);
        else reject(new Error(`ES2022 public declaration check failed (${code ?? signal}):\n${diagnostics}`));
      });
    });
    equal(output, '');
  } finally { await rm(project, { recursive: true, force: true }); }
});
