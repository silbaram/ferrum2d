import assert from 'node:assert/strict';
import { observeFeatureAudio } from './feature-extras-checks.mjs';

// Inject failures at browser API boundaries; rendering, decoding and playback stay real.
export async function checkFeatureRecovery(browser, baseUrl, gpuScript) {
  const results = [];
  for (const backend of ['webgl2', 'webgpu']) for (const scenario of ['audio-denied', 'reset-unlock', 'skip-load', 'stream-failure']) {
    const id = scenario === 'stream-failure' ? 'streaming' : 'cutscene';
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(observeFeatureAudio);
    if (backend === 'webgpu') await page.addInitScript({ content: gpuScript });
    let release;
    try {
      await page.goto(`${baseUrl}?feature=${id}&renderer=${backend}`);
      await page.waitForFunction(() => window.ferrumFeatureLab?.snapshot().nativeState === 1);
      const control = key => page.locator(`[data-control="${key}"]`);
      const snapshot = () => page.evaluate(() => window.ferrumFeatureLab.snapshot());
      if (scenario === 'audio-denied') {
        await page.evaluate(() => {
          Object.defineProperty(window.AudioContext.prototype, 'state', { configurable: true, get: () => 'suspended' });
          window.AudioContext.prototype.resume = async () => { throw Error('Test audio permission denied'); };
        });
        await control('play-cutscene').click();
        await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().cutscene.completed, undefined, { timeout: 15000 });
        assert.match(await page.locator('[data-value="cutscene-audio"]').innerText(), /잠김/);
        assert.equal((await snapshot()).cutscene.emitted, 6, 'locked audio must not block the visual tour');
        assert.equal(await page.evaluate(() => window.featureAudio.starts), 0, 'locked audio still started a source');
        assert.equal((await snapshot()).cutscene.audioCues, 0);
        // Restore the real audio API before inspecting context teardown below.
        await page.evaluate(() => { delete window.AudioContext.prototype.state; delete window.AudioContext.prototype.resume; });
      } else if (scenario === 'reset-unlock') {
        await page.evaluate(() => {
          const resume = window.AudioContext.prototype.resume;
          const state = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'state').get;
          window.holdFeatureUnlock = true;
          Object.defineProperty(window.AudioContext.prototype, 'state', { configurable: true, get() { return window.holdFeatureUnlock ? 'suspended' : state.call(this); } });
          window.AudioContext.prototype.resume = function () {
            return new Promise((resolve, reject) => { window.releaseFeatureUnlock = () => { window.holdFeatureUnlock = false; return resume.call(this).then(resolve, reject); }; });
          };
          window.featureSoundRequests = 0;
          const original = window.fetch;
          window.fetch = (...args) => { if (String(args[0]).includes('beacon.wav')) window.featureSoundRequests++; return original(...args); };
        });
        await control('play-cutscene').click();
        await page.waitForFunction(() => typeof window.releaseFeatureUnlock === 'function');
        await control('reset').click();
        await page.evaluate(() => window.releaseFeatureUnlock());
        await page.waitForTimeout(400);
        assert.equal(await page.evaluate(() => window.featureSoundRequests), 0, 'reset tour started a stale sound request after unlock');
        assert.equal((await snapshot()).cutscene.running, false);
        assert.equal((await snapshot()).cutscene.loading, false);
      } else if (scenario === 'skip-load') {
        await page.evaluate(() => {
          window.featureSoundAborts = 0;
          const original = window.fetch;
          window.fetch = (url, options) => {
            if (String(url).includes('beacon.wav')) options?.signal?.addEventListener('abort', () => window.featureSoundAborts++, { once: true });
            return original(url, options);
          };
        });
        let began; const started = new Promise(resolve => { began = resolve; });
        const deferred = new Promise(resolve => { release = resolve; });
        await page.route('**/features/beacon.wav', async route => { began(); await deferred; await route.continue().catch(() => {}); }, { times: 1 });
        await control('play-cutscene').click();
        let timer;
        try { await Promise.race([started, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('sound request did not start')), 10000); })]); }
        finally { clearTimeout(timer); }
        await control('skip-cutscene').click();
        assert.equal(await page.evaluate(() => window.featureSoundAborts), 1, 'skip did not cancel in-flight sound loading');
        await control('play-cutscene').click();
        await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().cutscene.running);
        release();
        await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().cutscene.audioCues === 1);
        assert.equal(await page.evaluate(() => window.featureAudio.starts), 1, 'stale load changed restarted tour audio');
        await control('reset').click();
      } else {
        const base = (await snapshot()).resources.textureCount;
        await page.locator('[data-chunk="0"]').click();
        await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().streaming.state === 'ready');
        const cameraX = (await snapshot()).cameraX;
        await page.route('**/playground/ball.png', route => route.abort('failed'), { times: 1 });
        await page.locator('[data-chunk="1"]').click();
        await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().streaming.state === 'error');
        const failed = await snapshot();
        assert.equal(failed.streaming.visible, 0); assert.deepEqual(failed.streaming.loaded, ['0']);
        assert.deepEqual(failed.streaming.resident, ['stream_0', 'stream_ground']);
        assert.equal(failed.resources.textureCount, base + 2); assert.equal(failed.cameraX, cameraX);
        await page.locator('[data-chunk="1"]').click();
        await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().streaming.state === 'ready');
        assert.equal((await snapshot()).streaming.visible, 1);
        assert.equal((await snapshot()).resources.textureCount, base + 2);
      }
      const resources = await page.evaluate(() => window.ferrumFeatureLab.destroy());
      await page.waitForFunction(() => window.featureAudio.contexts.every(context => context.state === 'closed'));
      for (const key of ['textureCount', 'bufferCount', 'programCount', 'renderTargetCount']) assert.equal(resources[key], 0);
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => window.playgroundGpuError), undefined);
      results.push({ backend, scenario, recovered: true, resources });
    } finally { release?.(); await page.close(); }
  }
  return results;
}
