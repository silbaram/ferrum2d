import assert from 'node:assert/strict';

/** Runs through smoke:topdown and its existing CI entry, against the production build. */
export async function smokeTopdownShowcase(page, timeout) {
  const action = name => page.locator(`[data-action=${name}]`);
  const state = phase => page.waitForFunction(expected => document.querySelector('.shooter-stage')?.dataset.state === expected, phase, { timeout });
  const native = () => page.evaluate(() => {
    const engine = window.ferrumEngine, snapshot = engine.captureShooterStateSnapshot();
    const read = engine.createBuiltInShooterStateAccessor(); read.bind(snapshot); read.selectFirst('player');
    return { state: engine.gameState(), score: engine.score(), time: engine.time(), wave: read.activeWaveIndex, elapsed: read.waveElapsedSeconds, x: read.x, y: read.y };
  });
  await state('title');
  await page.waitForFunction(() => window.ferrumRuntime.renderer.stats().renderCommandCount >= 20, null, { timeout });
  const initial = await native();
  assert.equal(initial.x, 800); assert.equal(initial.y, 480);
  const pixels = await page.evaluate(() => {
    const canvas = document.querySelector('canvas'), gl = canvas.getContext('webgl2');
    const data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const colors = new Set(); let brightness = 0;
    for (let i = 0; i < data.length; i += 4) {
      colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      brightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    return { colors: colors.size, brightness: brightness / (data.length / 4), error: gl.getError() };
  });
  assert(pixels.colors >= 24 && pixels.brightness > 5 && pixels.brightness < 150 && pixels.error === 0, `arena must contain visible art rather than a blank/washed-out frame: ${JSON.stringify(pixels)}`);
  assert.equal(await action('pause').isDisabled(), true);
  assert.equal(await action('start').isEnabled(), true);
  await action('start').click();
  await state('playing');
  await page.waitForFunction(() => window.ferrumEngine.entityCount() >= 2, null, { timeout });
  await action('pause').click();
  await state('paused');
  const frozen = await native();
  await page.waitForTimeout(250);
  assert.deepEqual(await native(), frozen, 'pause must freeze native time, position, score and wave');
  // P must also work while the pause button still owns keyboard focus.
  await page.keyboard.press('KeyP');
  await state('playing');
  await page.waitForFunction(time => window.ferrumEngine.time() > time, frozen.time, { timeout });
  await page.locator('canvas').focus(); await page.keyboard.press('KeyP'); await state('paused');
  await page.keyboard.press('Escape'); await state('playing');

  // Change only owned snapshot fixtures at a paused boundary; HUD must read native values.
  await action('pause').click(); await state('paused');
  assert.equal(await page.evaluate(() => {
    const engine = window.ferrumEngine, snapshot = engine.captureShooterStateSnapshot();
    const edit = engine.createBuiltInShooterStateAccessor(); edit.bindMutable(snapshot);
    edit.score = 17; edit.activeWaveIndex = 1; edit.waveElapsedSeconds = 1.25; edit.waveSpawnedCount = 3; edit.enemySpawnTimer = 30;
    return engine.restoreShooterStateSnapshot(snapshot);
  }), true);
  await action('start').click();
  await page.waitForFunction(() => document.querySelector('[data-readout=score]')?.textContent === '17' && document.querySelector('[data-readout=enemy]')?.textContent === '중장갑 드론', null, { timeout });
  assert.match(await page.locator('[data-readout=wave-detail]').textContent(), /출현 3/);
  await page.waitForFunction(() => {
    const stats = window.ferrumRuntime.renderer.stats();
    return stats.pointLightCount === 3 && stats.postProcessPassCount >= 2;
  }, null, { timeout });
  await page.locator('[data-setting=lighting]').uncheck();
  await page.locator('[data-setting=effects]').uncheck();
  await page.locator('[data-setting=motion]').check();
  await page.locator('[data-setting=mute]').check();
  await page.waitForFunction(() => {
    const stats = window.ferrumRuntime.renderer.stats();
    return stats.pointLightCount === 0 && stats.postProcessPassCount === 0;
  }, null, { timeout });
  await page.locator('[data-setting=lighting]').check();
  await page.locator('[data-setting=effects]').check();
  await page.locator('[data-setting=mute]').uncheck();
  await page.waitForFunction(() => window.ferrumRuntime.renderer.stats().pointLightCount === 3 && window.ferrumRuntime.renderer.stats().postProcessPassCount >= 2, null, { timeout });
  await action('pause').click(); await state('paused');
  await action('restart').click(); await state('playing');
  await page.waitForFunction(() => document.querySelector('[data-readout=score]')?.textContent === '0' && document.querySelector('[data-readout=wave]')?.textContent === 'WAVE 01', null, { timeout });
  const reset = await native(); assert.equal(reset.score, 0); assert.equal(reset.wave, 0);

  // End a real native run, then replay through the same visible button used by players.
  await action('pause').click(); await state('paused');
  assert.equal(await page.evaluate(() => {
    const e = window.ferrumEngine, snapshot = e.captureShooterStateSnapshot();
    const edit = e.createBuiltInShooterStateAccessor(); edit.bindMutable(snapshot); edit.gameState = "gameOver";
    return e.restoreShooterStateSnapshot(snapshot);
  }), true);
  await action('start').click(); await state('gameover');
  assert.equal(await action('pause').isDisabled(), true);
  await action('start').click(); await state('playing');

  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile layout overflows');
  const joystick = page.locator('[data-ferrum-virtual-joystick]');
  assert.equal(await joystick.isVisible(), true);
  assert(await page.locator('[data-ferrum-virtual-button=fire]').evaluate(button => getComputedStyle(button).fontFamily.includes('Ferrum Example UI')), 'touch fire label must use the bundled Korean font');
  assert.equal(await page.locator('.shooter-touch-hint').isVisible(), true);
  const rect = await joystick.boundingBox();
  const before = await native();
  const pointer = { pointerId: 10, pointerType: 'touch', clientX: rect.x + rect.width / 2 + 45, clientY: rect.y + rect.height / 2, buttons: 1, bubbles: true };
  await joystick.dispatchEvent('pointerdown', pointer);
  await page.waitForFunction(x => {
    const e = window.ferrumEngine, read = e.createBuiltInShooterStateAccessor();
    read.bind(e.captureShooterStateSnapshot()); read.selectFirst('player'); return read.x > x + 15;
  }, before.x, { timeout });
  await joystick.dispatchEvent('pointercancel', pointer);
  await action('pause').click(); await state('paused');
  assert.equal(await joystick.isVisible(), false);
  const cancelled = await native(); await page.waitForTimeout(100); assert.deepEqual(await native(), cancelled);
  await page.setViewportSize(viewport);
  await action('restart').click(); await state('playing');
  await page.waitForFunction(() => window.ferrumRuntime.renderer.viewportSize().width > 600 && window.ferrumRuntime.renderer.stats().renderCommandCount >= 20, null, { timeout });
  const stats = await page.evaluate(() => window.ferrumRuntime.renderer.stats());
  assert(stats.renderCommandCount >= 20 && stats.drawCalls > 0 && stats.drawCalls <= 16, JSON.stringify(stats));
  await page.evaluate(() => window.scrollTo(0, 0));
  return { topdownShowcase: { start: true, pauseResume: true, nativeHud: true, settings: true, restartWhilePaused: true, gameOverReplay: true, mobileMovement: true, commands: stats.renderCommandCount, draws: stats.drawCalls } };
}
