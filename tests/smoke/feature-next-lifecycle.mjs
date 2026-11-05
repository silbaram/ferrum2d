import assert from 'node:assert/strict';
import { observeFeatureAudio } from './feature-extras-checks.mjs';

export async function checkNextRecovery(browser, address, gpuScript) {
  const results = [];
  for (const backend of ['webgl2', 'webgpu']) for (const scenario of ['animation-audio-failure', 'animation-audio-cancel']) {
    const page = await browser.newPage(); page.setDefaultTimeout(10000);
    await page.addInitScript(observeFeatureAudio);
    if (backend === 'webgpu') await page.addInitScript({ content: gpuScript });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let release;
    try {
      await page.goto(`${address}?feature=animation&renderer=${backend}`);
      await page.waitForFunction(() => window.ferrumFeatureLab?.snapshot().nativeState === 1);
      const audio = page.locator('[data-control="footstep-audio"]');
      if (scenario.endsWith('failure')) {
        await page.route('**/features/beacon.wav', route => route.fulfill({ status: 503, body: 'Expected audio failure' }), { times: 1 });
        await audio.click();
        await page.waitForFunction(() => !window.ferrumFeatureLab.snapshot().animationEvents.loading && document.querySelector('[data-value="footstep-status"]').textContent.includes('Error'));
        assert.equal(await page.evaluate(() => window.ferrumFeatureLab.snapshot().animationEvents.sound), false);
      } else {
        let arrived; const started = new Promise(resolve => { arrived = resolve; });
        const held = new Promise(resolve => { release = resolve; });
        await page.route('**/features/beacon.wav', async route => { arrived(); await held; await route.continue().catch(() => {}); }, { times: 1 });
        await audio.click();
        let timer; try { await Promise.race([started, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('No pending audio request')), 10000); })]); }
        finally { clearTimeout(timer); }
        await page.locator('[data-control="reset"]').click(); release();
        await page.waitForTimeout(200);
        const s = await page.evaluate(() => window.ferrumFeatureLab.snapshot());
        assert.equal(s.animationEvents.loading, false); assert.equal(s.animationEvents.sound, false);
        assert.equal(await page.evaluate(() => window.featureAudio.starts), 0, 'late load restarted audio after reset');
      }
      await audio.click();
      await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().animationEvents.sound);
      await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().animationEvents.cues > 0);
      const resources = await page.evaluate(() => window.ferrumFeatureLab.destroy());
      await page.waitForFunction(() => window.featureAudio.contexts.every(context => context.state === 'closed'));
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => window.playgroundGpuError), undefined);
      for (const key of ['textureCount', 'bufferCount', 'programCount', 'renderTargetCount']) assert.equal(resources[key], 0);
      results.push({ backend, scenario, recovered: true, resources });
    } finally { release?.(); await page.close(); }
  }
  return results;
}

export async function checkTerrainPointer(browser, address, gpuScript) {
  const results = [];
  for (const backend of ['webgl2', 'webgpu']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    page.setDefaultTimeout(10000);
    if (backend === 'webgpu') await page.addInitScript({ content: gpuScript });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${address}?feature=destructible-terrain&renderer=${backend}`);
      await page.waitForFunction(() => window.ferrumFeatureLab?.snapshot().nativeState === 1);
      await page.evaluate(() => document.fonts.ready);
      const canvas = page.locator('canvas'); await canvas.scrollIntoViewIfNeeded();
      const size = await canvas.evaluate(c => ({ pixels: c.width, css: c.getBoundingClientRect().width }));
      assert(Math.abs(size.pixels / size.css - 2) < .05);
      const rect = await canvas.boundingBox();
      await page.touchscreen.tap(rect.x + rect.width * 320 / 640, rect.y + rect.height * 256 / 384);
      const s = await page.evaluate(() => window.ferrumFeatureLab.snapshot());
      assert.equal(s.terrain.edits, 1); assert.equal(s.terrain.centerSolid, false);
      assert.equal(s.terrain.surfaceSolid, true, 'touch coordinates carved the wrong height');
      assert.equal(s.terrain.texturePatch.x, 52); assert.equal(s.terrain.texturePatch.y, 12);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const resources = await page.evaluate(() => window.ferrumFeatureLab.destroy());
      for (const key of ['textureCount', 'bufferCount', 'programCount', 'renderTargetCount']) assert.equal(resources[key], 0);
      assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => window.playgroundGpuError), undefined);
      results.push({ id: 'destructible-terrain', backend, dpr: 2, width: 390, touch: 'browser emulation', resources });
    } finally { await page.close(); }
  }
  return results;
}
