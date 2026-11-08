import assert from 'node:assert/strict';

export async function smokeGuidedExample(page, id, timeout = 15000) {
  const control = name => page.locator(`[data-demo-control=${name}]`);
  const phase = value => page.waitForFunction(expected => document.querySelector('.demo-shell')?.dataset.playback === expected, value, { timeout });
  const pose = () => page.evaluate(kind => {
    const engine = window.ferrumEngine;
    const handle = kind === 'platformer' ? engine.builtInPlatformerPlayerHandle() : engine.builtInBreakoutPaddleHandle();
    const buffer = engine.queryAudioPoseBuffer(new Uint32Array([handle.entityId, handle.entityGeneration]));
    return { x: buffer.floats[4], y: buffer.floats[5] };
  }, id);
  await phase('playing');
  assert.deepEqual(await page.evaluate(() => window.ferrumRuntime.renderer.viewportSize()), { width: 800, height: 480 });
  assert.equal(await page.locator('.demo-actions button:visible').count(), 2);
  assert.equal(await control('start').isVisible(), false);
  await control('pause').click(); await phase('paused');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.demo-metrics dt')].find(t => t.textContent === '상태')?.nextElementSibling.textContent), '일시정지');
  const time = await page.evaluate(() => window.ferrumEngine.time());
  const frozen = await pose(); await page.waitForTimeout(160);
  assert.equal(await page.evaluate(() => window.ferrumEngine.time()), time);
  assert.deepEqual(await pose(), frozen);
  // The shortcut must work even while the button retains keyboard focus.
  await page.keyboard.press('KeyP'); await phase('playing');
  await page.waitForFunction(before => window.ferrumEngine.time() > before, time, { timeout });
  await page.keyboard.press('Escape'); await phase('paused');
  await control('reset').click(); await phase('playing');
  await page.waitForFunction(() => window.ferrumEngine.gameState() === 1 && window.ferrumEngine.score() === 0, null, { timeout });
  await page.waitForFunction(before => window.ferrumEngine.time() > before, time, { timeout });

  if (id === 'breakout') {
    await page.evaluate(() => {
      const e = window.ferrumEngine;
      e.setBuiltInSceneEntityPosition(e.builtInBreakoutBallHandle(), 400, 700);
    });
    await phase('ended');
    assert.equal(await control('start').isVisible(), true);
    assert.equal(await control('pause').isVisible(), false);
    await control('start').click(); await phase('playing');
  }

  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('canvas').clientWidth < 400, null, { timeout });
  assert.deepEqual(await page.evaluate(() => window.ferrumRuntime.renderer.viewportSize()), { width: 800, height: 480 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const right = page.locator('[data-ferrum-virtual-button=right]');
  assert.equal(await right.isVisible(), true);
  assert(await right.evaluate(button => getComputedStyle(button).fontFamily.includes('Ferrum Example UI')));
  const initial = await pose();
  const pointer = { pointerId: 91, pointerType: 'touch', buttons: 1, bubbles: true };
  await right.dispatchEvent('pointerdown', pointer);
  await page.waitForFunction(({ kind, x }) => {
    const e = window.ferrumEngine, handle = kind === 'platformer' ? e.builtInPlatformerPlayerHandle() : e.builtInBreakoutPaddleHandle();
    const pose = e.queryAudioPoseBuffer(new Uint32Array([handle.entityId, handle.entityGeneration]));
    return pose.floats[4] > x + 15;
  }, { kind: id, x: initial.x }, { timeout });
  await control('pause').click(); await phase('paused');
  assert.equal(await right.getAttribute('aria-pressed'), 'false');
  assert.equal(await right.isVisible(), false);
  const cancelled = await pose();
  await control('resume').click(); await phase('playing');
  await page.waitForTimeout(150);
  assert(Math.abs((await pose()).x - cancelled.x) < .1, 'a held touch must not survive pause/resume');
  if (id === 'platformer') {
    await page.evaluate(() => {
      const e = window.ferrumEngine;
      e.setBuiltInSceneEntityPosition(e.builtInPlatformerPlayerHandle(), 260, 420);
    });
    await page.waitForTimeout(200);
    const grounded = await pose(), jump = page.locator('[data-ferrum-virtual-button=jump]');
    await jump.dispatchEvent('pointerdown', { ...pointer, pointerId: 92 });
    await page.waitForFunction(y => {
      const e = window.ferrumEngine, h = e.builtInPlatformerPlayerHandle();
      return e.queryAudioPoseBuffer(new Uint32Array([h.entityId, h.entityGeneration])).floats[5] < y - 10;
    }, grounded.y, { timeout });
    await jump.dispatchEvent('pointercancel', { ...pointer, pointerId: 92 });
    assert.equal(await jump.getAttribute('aria-pressed'), 'false');
  }
  await page.setViewportSize(viewport);
  await control('reset').click(); await phase('playing');
  const stats = await page.evaluate(() => window.ferrumRuntime.renderer.stats());
  assert(stats.renderCommandCount >= 6 && stats.drawCalls > 0 && stats.drawCalls <= 8, JSON.stringify(stats));
  return { id, pauseResume: true, resetWhilePaused: true, touchMovement: true, touchCancel: true, touchJump: id === 'platformer', fixedViewport: true, draws: stats.drawCalls };
}

export async function smokePhysicsLabViewport(page, timeout = 15000) {
  const bodies = () => page.evaluate(() => {
    const e = window.ferrumEngine, hits = e.queryAabbBodies({ x: 400, y: 240, halfWidth: 2000, halfHeight: 2000 });
    const handles = [...new Map(hits.map(h => [`${h.entityId}:${h.entityGeneration}`, h])).values()];
    return e.capturePhysicsBodyStateBuffer(handles).states.map(s => ({ id: s.entityId, x: s.x, y: s.y, vx: s.velocityX, vy: s.velocityY, angle: s.rotationRadians }));
  });
  assert.deepEqual(await page.evaluate(() => window.ferrumRuntime.renderer.viewportSize()), { width: 800, height: 480 });
  assert.deepEqual(await page.evaluate(() => ({ x: window.ferrumEngine.cameraX(), y: window.ferrumEngine.cameraY(), actor: window.ferrumEngine.builtInShooterPlayerHandle() })), { x: 400, y: 240, actor: undefined });
  assert.equal(await page.evaluate(() => window.ferrumEngine.entityCount()), 8, 'physics fixture must not contain the default Shooter player');
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  const frozen = await bodies(); await page.waitForTimeout(160); assert.deepEqual(await bodies(), frozen);
  await page.evaluate(() => {
    const e = window.ferrumEngine; window.physicsOriginalStep = e.stepRigidBodies; window.physicsStepCalls = 0;
    e.stepRigidBodies = (...args) => { window.physicsStepCalls++; return window.physicsOriginalStep(...args); };
  });
  await page.getByRole('button', { name: '한 프레임', exact: true }).click();
  await page.waitForFunction(() => window.physicsStepCalls === 1, null, { timeout });
  const stepped = await bodies(); assert.notDeepEqual(stepped, frozen, 'one frame must move native bodies');
  await page.waitForTimeout(100); assert.deepEqual(await bodies(), stepped);
  assert.equal(await page.evaluate(() => window.physicsStepCalls), 1, 'one click must not double-step the solver');
  await page.evaluate(() => { window.ferrumEngine.stepRigidBodies = window.physicsOriginalStep; });
  const viewport = page.viewportSize();
  await page.evaluate(() => document.fonts.ready);
  for (const width of [viewport.width, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    // DOM layout can resize before the renderer's resize observer updates
    // the backbuffer. Sampling both sizes in that interval yields a stale pick.
    await page.waitForFunction(() => {
      const canvas = document.querySelector('canvas'), presentation = window.ferrumRuntime.renderer.pixelPerfectPresentation();
      return presentation.canvasWidth === canvas.width && presentation.canvasHeight === canvas.height &&
        Math.abs(canvas.width - Math.round(canvas.clientWidth * devicePixelRatio)) <= 1 &&
        Math.abs(canvas.height - Math.round(canvas.clientHeight * devicePixelRatio)) <= 1;
    }, null, { timeout });
    const point = await page.evaluate(() => {
      const c = document.querySelector('canvas'), rect = c.getBoundingClientRect();
      const p = window.ferrumRuntime.renderer.pixelPerfectPresentation();
      return { x: rect.x + (p.x + 610 * p.width / p.sourceWidth) * rect.width / p.canvasWidth,
        y: rect.y + (p.y + 216 * p.height / p.sourceHeight) * rect.height / p.canvasHeight };
    });
    const beforeFrame = await page.evaluate(() => window.ferrumPhysicsSandboxSmokeFrame.frameCount);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(before => { const f = window.ferrumPhysicsSandboxSmokeFrame; return f.frameCount > before && Math.abs(f.pointerWorld?.x - 610) < 1 && Math.abs(f.pointerWorld?.y - 216) < 1; }, beforeFrame, { timeout });
    await page.waitForFunction(() => document.querySelector('.selected-body')?.textContent.includes('낮은 반발 패드'), null, { timeout });
    const world = await page.evaluate(() => window.ferrumPhysicsSandboxSmokeFrame.pointerWorld);
    assert(Math.abs(world.x - 610) < 1 && Math.abs(world.y - 216) < 1, `letterbox pointer projection drifted: ${JSON.stringify(world)}`);
  }
  await page.setViewportSize(viewport);
  await page.getByRole('button', { name: '실행', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.status-badge').dataset.status === 'running', null, { timeout });
  return { fixedViewport: true, noDefaultActor: true, nativePause: true, singleSolverStep: true, letterboxPicking: true };
}

export async function smokeStarterProfileReset(page, timeout = 15000) {
  const action = key => page.locator(`[data-demo-control=${key}]`);
  const phase = expected => page.waitForFunction(value => document.querySelector('.demo-shell')?.dataset.playback === value, expected, { timeout });
  const config = () => page.evaluate(() => {
    const e = window.ferrumEngine, r = e.createBuiltInShooterStateAccessor();
    r.bind(e.captureShooterStateSnapshot()); r.selectFirst('player');
    return { id: r.primaryActionId, speed: r.primaryActionProjectileSpeed, damage: r.primaryActionProjectileDamage,
      lifetime: r.primaryActionProjectileLifetime, cooldown: r.primaryActionCooldownDuration };
  });
  const expected = await config(); assert(expected.id > 0 && expected.speed > 0);
  await action('pause').click(); await phase('paused');
  await action('reset').click(); await phase('playing');
  assert.deepEqual(await config(), expected, 'reset must reapply the selected native profile');
  for (const retry of ['button', 'keyboard']) {
    assert.equal(await page.evaluate(() => {
      const e = window.ferrumEngine, snapshot = e.captureShooterStateSnapshot(), r = e.createBuiltInShooterStateAccessor();
      r.bindMutable(snapshot); r.gameState = 'gameOver'; return e.restoreShooterStateSnapshot(snapshot);
    }), true);
    await phase('ended');
    if (retry === 'button') await action('start').click();
    else { await page.locator('canvas').focus(); await page.keyboard.down('Space'); }
    await phase('playing'); await page.keyboard.up('Space');
    assert.deepEqual(await config(), expected, `${retry} retry must reapply the selected native profile`);
  }
  await page.waitForFunction(() => window.ferrumEngine.entityCount() >= 2, null, { timeout });
  return { resetWhilePaused: true, gameOverButton: true, gameOverKeyboard: true, nativeProfile: expected };
}
