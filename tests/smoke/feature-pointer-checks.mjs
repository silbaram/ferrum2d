import assert from 'node:assert/strict';

/** Browser-emulated touch and DPR 2 exercise CSS-to-world mapping, not physical devices. */
export async function checkFeaturePointer(browser, address, webgpuSetup) {
  const results = [];
  for (const backend of ['webgl2', 'webgpu']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    page.setDefaultTimeout(10000);
    await page.addInitScript(() => {
      window.featureTouchTrace = [];
      for (const kind of ['pointerdown', 'pointerup', 'pointercancel']) document.addEventListener(kind, event => {
        window.featureTouchTrace.push({ kind, x: event.clientX, y: event.clientY,
          joystick: !!event.target.closest?.('[data-ferrum-virtual-joystick]'), scrollY });
        if (window.featureTouchTrace.length > 12) window.featureTouchTrace.shift();
      });
    });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    if (backend === 'webgpu') await page.addInitScript({ content: webgpuSetup });
    try {
      for (const id of ['tilemap', 'input']) {
        await page.goto(`${address}?feature=${id}&renderer=${backend}`);
        await page.waitForFunction(() => window.ferrumFeatureLab?.snapshot().nativeState === 1);
        assert.match(await page.locator('.feature-statistics').textContent(), /오브젝트 \d+/, 'first native frame must also publish statistics before touch targets are measured');
        await page.evaluate(() => document.fonts.ready);
        const canvas = page.locator('canvas'), control = key => page.locator(`[data-control="${key}"]`);
        const snapshot = () => page.evaluate(() => window.ferrumFeatureLab.snapshot());
        assert.equal((await snapshot()).backend, backend);
        const size = await canvas.evaluate(c => ({ pixels: c.width, css: c.getBoundingClientRect().width }));
        assert(Math.abs(size.pixels / size.css - 2) < .05, 'DPR test did not allocate a 2x drawing buffer');
        if (id === 'tilemap') {
          const tapTile = async () => {
            await canvas.scrollIntoViewIfNeeded();
            const r = await canvas.boundingBox();
            await page.touchscreen.tap(r.x + r.width * 208 / 640, r.y + r.height * 176 / 384);
          };
          const move = async () => {
            await canvas.focus(); await page.keyboard.down('KeyD');
            try { await page.waitForTimeout(650); } finally { await page.keyboard.up('KeyD'); }
          };
          await tapTile(); assert.equal((await snapshot()).tilemap.edits, 1);
          await move();
          const blocked = (await snapshot()).actor.x;
          assert(blocked > 170 && blocked < 190, `DPR/touch edit placed the wall in the wrong cell: ${blocked}`);
          await control('brush').selectOption('floor'); await tapTile(); await move();
          assert((await snapshot()).actor.x > 230, 'erased touch tile still blocked native movement');
        } else {
          const stick = page.locator('[data-ferrum-virtual-joystick]'); await stick.scrollIntoViewIfNeeded();
          const box = await stick.boundingBox(), before = (await snapshot()).actor.x;
          const cdp = await page.context().newCDPSession(page);
          try {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width - 4, y: box.y + box.height / 2, id: 1 }] });
            // Wait for the native effect, not a fixed wall-clock delay under software GPU load.
            await page.waitForFunction(x => window.ferrumFeatureLab.snapshot().actor.x > x + 20, before, { timeout: 5000 });
          } finally {
            try { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
            finally { await cdp.detach(); }
          }
          assert((await snapshot()).actor.x > before + 20, 'emulated touch joystick did not move native actor');
          await page.waitForFunction(() => !window.ferrumFeatureLab.snapshot().input.d);
          const stopped = (await snapshot()).actor;
          await page.waitForTimeout(150); assert.deepEqual((await snapshot()).actor, stopped, 'touch release left input held');
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.deepEqual(errors, []);
        assert.equal(await page.evaluate(() => window.playgroundGpuError), undefined);
        const resources = await page.evaluate(() => window.ferrumFeatureLab.destroy());
        for (const key of ['textureCount', 'bufferCount', 'programCount', 'renderTargetCount']) assert.equal(resources[key], 0);
        results.push({ id, backend, dpr: 2, width: 390, touch: 'browser emulation', resources });
      }
    } catch (error) {
      const evidence = await page.evaluate(() => ({ state: window.ferrumFeatureLab?.snapshot(),
        events: window.featureTouchTrace, visible: document.visibilityState, focused: document.hasFocus(),
        joystick: document.querySelector('[data-ferrum-virtual-joystick]')?.getBoundingClientRect().toJSON(), scrollY })).catch(() => undefined);
      throw new Error(`DPR/touch ${backend}: ${error.message}; ${JSON.stringify(evidence)}`, { cause: error });
    }
    finally { await page.close(); }
  }
  return results;
}
