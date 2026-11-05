import assert from 'node:assert/strict';
import { observeFeatureAudio } from './feature-extras-checks.mjs';

export async function checkSystemLifecycle(browser, baseUrl, gpuScript) {
  const results = [];
  for (const backend of ['webgl2', 'webgpu']) for (const id of ['cutscene', 'asset-loading', 'streaming']) {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(observeFeatureAudio);
    if (backend === 'webgpu') await page.addInitScript({ content: gpuScript });
    let release;
    try {
      await page.goto(`${baseUrl}?feature=${id}&renderer=${backend}`);
      await page.waitForFunction(() => window.ferrumFeatureLab?.snapshot().nativeState === 1);
      let began; const started = new Promise(resolve => { began = resolve; });
      const deferred = new Promise(resolve => { release = resolve; });
      const route = id === 'cutscene' ? '**/features/beacon.wav' : id === 'streaming' ? '**/playground/ball.png' : '**/playground/floor.png';
      await page.route(route, async request => { began(); await deferred; await request.continue().catch(() => {}); });
      const selector = id === 'cutscene' ? '[data-control="play-cutscene"]' : id === 'streaming' ? '[data-chunk="1"]' : '[data-control="load-assets"]';
      await page.locator(selector).click();
      let timer;
      try { await Promise.race([started, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${backend}/${id} did not start delayed request`)), 10000); })]); }
      finally { clearTimeout(timer); }
      await page.evaluate(() => window.ferrumFeatureLab.destroy());
      release(); await page.waitForTimeout(500);
      const resources = await page.evaluate(() => window.ferrumFeatureLab.destroy());
      for (const key of ['textureCount', 'bufferCount', 'programCount', 'renderTargetCount']) assert.equal(resources[key], 0, `${backend}/${id} late resource resurrection`);
      assert(await page.evaluate(() => window.featureAudio.contexts.every(context => context.state === 'closed')));
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => window.playgroundGpuError), undefined);
      results.push({ backend, id, inFlightDestroy: true, resources });
    } finally { release?.(); await page.close(); }
  }
  return results;
}
