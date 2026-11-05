import assert from 'node:assert/strict';

export async function checkFeatureSystems({ page, id, control, snapshot, pixelHash }) {
  if (id === 'projectiles') {
    for (const impact of ['despawn', 'passThrough', 'bounce']) {
      await control('projectile').selectOption(impact);
      await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().nativeState === 1);
      await control('fire').click();
      await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().projectile.samples.length > 5);
      await page.waitForFunction(impact => {
        const shot = window.ferrumFeatureLab.snapshot().projectile;
        if (impact === 'despawn') return shot.bulletX === undefined;
        if (impact === 'passThrough') return shot.samples.some(x => x > 420);
        return shot.samples.some((x, i) => i > 0 && x < shot.samples[i - 1] - 1);
      }, impact);
      const shot = (await snapshot()).projectile;
      assert.equal(shot.shots, 1);
      if (impact === 'despawn') { assert.equal(shot.bulletX, undefined); assert(Math.max(...shot.samples) < 352); }
      if (impact === 'passThrough') assert(Math.max(...shot.samples) > 420, 'projectile failed to cross wall');
      if (impact === 'bounce') assert(shot.samples.some((x, i) => i > 0 && x < shot.samples[i - 1] - 1), 'projectile failed to reflect');
    }
    await control('pause').click(); const shots = (await snapshot()).projectile.shots;
    await control('fire').click(); assert.equal((await snapshot()).projectile.shots, shots);
    await control('reset').click(); assert.equal((await snapshot()).projectile.shots, 0);
  }
  if (id === 'cutscene') {
    await control('play-cutscene').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().cutscene.commandIndex === 1);
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().cameraX < 300);
    await control('pause').click(); const paused = (await snapshot()).cutscene;
    await page.waitForTimeout(150); assert.deepEqual((await snapshot()).cutscene, paused);
    await control('pause').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().cutscene.completed, undefined, { timeout: 12000 });
    assert.equal((await snapshot()).cutscene.audioCues, 1);
    assert(await page.evaluate(() => window.featureAudio.starts > 0), 'cutscene must start a real AudioBufferSourceNode');
    assert.equal((await snapshot()).cutscene.emitted, 6);
    await control('reset').click(); await control('reduced-motion').check(); await control('play-cutscene').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().cutscene.commandIndex === 1);
    await page.waitForFunction(() => Math.abs(window.ferrumFeatureLab.snapshot().cameraX - 240) < .01);
    await control('skip-cutscene').click(); assert((await snapshot()).cutscene.completed); assert(!(await snapshot()).cutscene.running);
    await control('reset').click(); assert.equal((await snapshot()).cutscene.emitted, 0);
  }
  if (id === 'asset-loading') {
    await control('load-assets').click(); await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().loading.state === 'complete');
    assert.equal((await snapshot()).loading.requests, 3); assert.equal((await snapshot()).loading.fetched, 3);
    await control('load-assets').click(); await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().loading.state === 'complete');
    assert.equal((await snapshot()).loading.requests, 0); assert.equal((await snapshot()).loading.cached, 3);
    await control('clear-cache').click(); await control('load-assets').click(); await control('cancel-assets').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().loading.state === 'cancelled');
    await control('fail-assets').click(); await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().loading.state === 'error');
    await control('load-assets').click(); await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().loading.state === 'complete');
    assert.equal((await snapshot()).loading.loaded, 3);
    await control('clear-cache').click(); await control('load-assets').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().loading.loaded === 1);
    await control('cancel-assets').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().loading.state === 'cancelled');
    const retained = (await snapshot()).loading.cacheEntries;
    assert(retained > 0 && retained < 3, 'cancel must preserve only completed entries');
    await control('load-assets').click(); await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().loading.state === 'complete');
    assert.equal((await snapshot()).loading.cached, retained);
    assert.equal((await snapshot()).loading.requests, 3 - retained);
    await control('reset').click(); await control('load-assets').click(); await control('reset').click();
    await page.waitForTimeout(500); assert.equal((await snapshot()).loading.state, 'idle'); assert.equal((await snapshot()).loading.cacheEntries, 0);
  }
  if (id === 'streaming') {
    const base = (await snapshot()).resources.textureCount;
    let previous;
    for (const index of [0, 1, 2, 2, 0]) {
      await page.locator(`[data-chunk="${index}"]`).click();
      await page.waitForFunction(index => { const s = window.ferrumFeatureLab.snapshot().streaming; return !s.pending && s.visible === index && s.state === 'ready'; }, index);
      const state = (await snapshot()).streaming;
      assert.deepEqual(state.loaded, [String(index)]); assert.deepEqual(state.resident, [`stream_${index}`, 'stream_ground']);
      assert.equal(state.resources.textureCount, base + 2, 'streamed textures leak or shared texture was released');
      if (previous && previous.index !== index) assert(state.releases > 0, 'unloaded textures were not evicted');
      const pixels = await page.evaluate(pixelHash);
      if (previous && previous.index !== index) assert.notEqual(pixels.hash, previous.hash);
      previous = { index, hash: pixels.hash };
    }
    await page.evaluate(() => { for (const i of [1, 0, 2]) document.querySelector(`[data-chunk="${i}"]`).click(); });
    await page.waitForFunction(() => { const s = window.ferrumFeatureLab.snapshot().streaming; return !s.pending && s.visible === 2; });
    await page.locator('[data-chunk="0"]').click(); await control('reset').click();
    await page.waitForTimeout(700);
    assert.equal((await snapshot()).streaming.visible, -1); assert.deepEqual((await snapshot()).streaming.loaded, []);
    assert.equal((await snapshot()).resources.textureCount, base);
  }
}
