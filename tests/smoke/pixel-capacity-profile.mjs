import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pixelDocument as d, documentUrl, pixelModuleUrl, checkedPixelImport } from './pixel-editing-modules.mjs';
import { pixelCapacitySource } from './pixel-capacity-fixture.mjs';

const { pixelPng, verifyPixelPng } = await checkedPixelImport(await pixelModuleUrl('placementPixelPng', { './placementPixelDocument': documentUrl }));
const directory = resolve('artifacts/pixel-editor-capacity');
await mkdir(directory, { recursive: true });
const report = { ok: false, status: 'running', startedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, gc: typeof globalThis.gc === 'function' }, memoryScope: 'Observed Node process samples at stage boundaries; not exact allocation totals or browser/mobile performance.', cases: [] };
const save = () => writeFile(resolve(directory, 'profile.json'), JSON.stringify(report, null, 2) + '\n');
await save();
try {
  for (const [name, options, entropy] of [
    ['baseline16', { count: 16, version: 3, tagged: false }],
    ['directional64', {}],
    ['layered64', { layers: 8 }],
    ['maximumCelBudget', { side: 64, layers: 8 }],
    ['wideEntropy32', { side: 256, count: 32, layers: 1, tagged: false }, true],
  ]) {
    globalThis.gc?.();
    const memory = [], timings = {};
    const sample = stage => memory.push({ stage, ...process.memoryUsage() });
    const measure = async (stage, run) => {
      const start = performance.now(), result = await run();
      timings[stage] = performance.now() - start; sample(stage); return result;
    };
    sample('before');
    const source = pixelCapacitySource(options);
    if (entropy) {
      let seed = 0x12345678;
      for (const frame of source.frames) {
        const bytes = new Uint8Array(source.width * source.height * 4);
        for (let i = 0; i < bytes.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; bytes[i] = seed & 255; }
        frame.cels[0].rgba = Buffer.from(bytes).toString('base64');
      }
    }
    const editor = await measure('openMs', () => d.createPixelEditor(source));
    editor.selectFrame(source.frames.at(-1).id);
    await measure('editMs', () => { editor.begin(); editor.line(1, 1, 1, 1, [1, 2, 3, 255]); editor.commit(); });
    const after = editor.document();
    await measure('undoMs', () => editor.undo()); assert.deepEqual(editor.document(), source);
    await measure('redoMs', () => editor.redo()); assert.deepEqual(editor.document(), after);
    const saved = await measure('saveMs', () => JSON.stringify(editor.document()));
    const reopened = await measure('reopenMs', () => d.readPixelDocument(saved));
    assert.deepEqual(reopened, after);
    const png = await measure('exportPngMs', () => pixelPng(reopened));
    await measure('verifyPngMs', () => verifyPixelPng(png, reopened));
    const sourceBytes = Buffer.byteLength(saved), history = editor.history(), layout = d.pixelAtlasLayout(reopened, source.frames.length);
    assert(sourceBytes <= d.PIXEL_LIMITS.sourceBytes);
    assert(png.byteLength <= d.PIXEL_LIMITS.pngBytes);
    assert(history.bytes <= d.PIXEL_LIMITS.historyBytes && history.undo <= d.PIXEL_LIMITS.historySteps);
    for (const [stage, ms] of Object.entries(timings)) assert(ms < 30_000, `${name} ${stage} exceeded coarse 30s hang guard`);
    if (entropy) assert(png.byteLength > 8 * 1024 * 1024, 'High-entropy accepted source must cover the old PNG limit');
    report.cases.push({ name, frames: source.frames.length, layers: source.layers.length, sourceVersion: reopened.version, sourceBytes, celRgbaBytes: source.width * source.height * source.frames.length * source.layers.length * 4, atlasRgbaBytes: layout.width * layout.height * 4, pngBytes: png.byteLength, history, timings, memorySamples: memory, observedPeakRss: Math.max(...memory.map(s => s.rss)), observedPeakArrayBuffers: Math.max(...memory.map(s => s.arrayBuffers)) });
    await save();
  }
  report.ok = true; report.status = 'passed'; report.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ ok: true, cases: report.cases.map(({ name, frames, celRgbaBytes, pngBytes, history, timings }) => ({ name, frames, celRgbaBytes, pngBytes, history, timings })) }, null, 2));
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack ?? error); await save(); throw error;
}
