import { deepEqual, equal, rejects } from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { main, decodePng, packTexturePngs } from '../../scripts/tools/pack-textures.mjs';
import { createAtlasFixtures } from './atlas-extrusion-fixtures.mjs';

test('extrusion repeats exact edge/corner RGBA inside existing padding, preserving layout and source pixels', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ferrum-atlas-extrusion-'));
  try {
    const { sources, atlases } = await createAtlasFixtures(root);
    deepEqual(await readFile(join(root, 'default.png')), await readFile(join(root, 'extrude-0.png')));
    for (const atlas of atlases) {
      deepEqual(atlas.frames, atlases[0].frames);
      deepEqual(atlas.placements, atlases[0].placements);
      const png = decodePng(await readFile(join(root, atlas.image)));
      const expected = new Uint8Array(png.pixels.length);
      for (const p of atlas.placements) {
        const source = sources.find(s => s.name === p.name);
        for (let y = -atlas.extrude; y < p.height + atlas.extrude; y++) for (let x = -atlas.extrude; x < p.width + atlas.extrude; x++) {
          const sx = Math.max(0, Math.min(p.width - 1, x)), sy = Math.max(0, Math.min(p.height - 1, y));
          expected.set(source.pixels.subarray((sy * p.width + sx) * 4, (sy * p.width + sx) * 4 + 4), ((p.y + y) * png.width + p.x + x) * 4);
        }
      }
      deepEqual(png.pixels, expected, atlas.name + ': source, corners and untouched padding');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid extrusion rejects before overwriting PNG, metadata or Game Spec', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ferrum-atlas-invalid-'));
  try {
    const outputImage = join(root, 'out.png'), outputJson = join(root, 'atlas.json'), gameJson = join(root, 'game.json');
    for (const p of [outputImage, outputJson, gameJson]) await writeFile(p, 'preserve');
    for (const extrude of [-1, .5, 3, null, '1', true, NaN, Infinity]) {
      await rejects(packTexturePngs({ inputDir: join(root, 'missing'), outputImage, outputJson, gameJson, padding: 2, extrude }), /extrude must be an integer/);
      for (const p of [outputImage, outputJson, gameJson]) equal(await readFile(p, 'utf8'), 'preserve');
    }
    for (const padding of [-Infinity, Infinity, NaN]) {
      await rejects(packTexturePngs({ inputDir: join(root, 'missing'), outputImage, outputJson, gameJson, padding, extrude: 0 }), /padding must be finite/);
      for (const p of [outputImage, outputJson, gameJson]) equal(await readFile(p, 'utf8'), 'preserve');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI flag overrides config extrusion, while zero-padding images and Game Spec UVs remain compatible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ferrum-atlas-cli-'));
  try {
    const { inputDir, atlases } = await createAtlasFixtures(root), config = join(root, 'config.json');
    const outputImage = join(root, 'cli.png'), outputJson = join(root, 'cli.json'), gameJson = join(root, 'game.json');
    await writeFile(gameJson, JSON.stringify({ atlas: { frames: { keep: { texture: 'old' } } } }));
    await writeFile(config, JSON.stringify({ inputDir, outputImage, outputJson, gameJson, extrude: 0, padding: 2, maxSize: 64 }));
    await main(['--config', config, '--extrude', '2']);
    deepEqual(await readFile(outputImage), await readFile(join(root, 'extrude-2.png')));
    const game = JSON.parse(await readFile(gameJson, 'utf8'));
    deepEqual(game.atlas.frames.hero, atlases[0].frames.hero); equal(game.atlas.frames.keep.texture, 'old');
    await main(['--input-dir', inputDir, '--output-image', outputImage, '--padding', '0', '--extrude', '0']);
    await rejects(main(['--config', config, '--extrude', 'NaN']), /extrude/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('blank CLI extrusion cannot silently disable configured protection or overwrite existing outputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ferrum-atlas-blank-'));
  try {
    const { inputDir } = await createAtlasFixtures(root), config = join(root, 'config.json');
    const outputImage = join(root, 'out.png'), outputJson = join(root, 'out.json'), gameJson = join(root, 'game.json');
    await writeFile(config, JSON.stringify({ inputDir, outputImage, outputJson, gameJson, padding: 2, extrude: 2 }));
    for (const p of [outputImage, outputJson]) await writeFile(p, 'preserve');
    await writeFile(gameJson, '{}');
    for (const raw of ['', ' ', '\t', '\n']) {
      await rejects(main(['--config', config, '--extrude', raw]), /extrude.*(?:number|integer|value)/);
      for (const p of [outputImage, outputJson]) equal(await readFile(p, 'utf8'), 'preserve');
      equal(await readFile(gameJson, 'utf8'), '{}');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed browser rerun replaces a previous successful verification report', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ferrum-atlas-report-'));
  try {
    const reportPath = join(root, 'verification.json');
    await writeFile(reportPath, JSON.stringify({ ok: true, status: 'passed', run: 'old-success' }));
    await rejects(promisify(execFile)(process.execPath, ['tests/smoke/atlas-extrusion-browser-smoke.mjs', '--artifact-dir', root], {
      env: { ...process.env, FERRUM_BROWSER_EXECUTABLE: join(root, 'missing-browser') }, timeout: 30000,
    }), error => error.code === 1);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    equal(report.ok, false); equal(report.status, 'failed');
    equal(report.run.startsWith(join(root, 'run-')), true);
    equal(report.error.includes('missing-browser'), true);
    deepEqual(JSON.parse(await readFile(join(report.run, 'verification.json'), 'utf8')), report);
    t.diagnostic(JSON.stringify({ oldStatus: 'passed', newStatus: report.status, expectedExitCode: 1, reason: 'missing-browser' }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
