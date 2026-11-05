import assert from 'node:assert/strict';

function trackGlResources() {
  const original = HTMLCanvasElement.prototype.getContext, seen = new WeakSet();
  window.featureGlResources = [];
  HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
    const gl = Reflect.apply(original, this, [kind, ...args]);
    if (kind !== 'webgl2' || !gl || seen.has(gl)) return gl;
    seen.add(gl);
    const resources = {};
    for (const name of ['Texture', 'Buffer', 'Program', 'Shader', 'Framebuffer', 'Renderbuffer', 'VertexArray']) {
      const handles = new Set(), create = gl[`create${name}`].bind(gl), remove = gl[`delete${name}`].bind(gl);
      resources[name] = handles;
      gl[`create${name}`] = (...args) => { const handle = create(...args); if (handle) handles.add(handle); return handle; };
      gl[`delete${name}`] = handle => { remove(handle); handles.delete(handle); };
    }
    window.featureGlResources.push(resources);
    return gl;
  };
}

/** Validate partial bootstrap, which cannot use the ready-only application test hook. */
export async function checkFeatureLifecycle(browser, address, { feature = 'animation', texture = 'robot', stages = ['scene', 'texture', 'failure'] } = {}) {
  const cases = [];
  for (const stage of stages) {
    const page = await browser.newPage(); page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(trackGlResources);
    let release, arrived;
    const requestArrived = new Promise(resolve => { arrived = resolve; });
    const released = new Promise(resolve => { release = resolve; });
    const failure = stage.endsWith('failure');
    const pattern = stage.startsWith('model') ? '**/features/spatial/cart.glb' : stage === 'texture' ? `**/playground/${texture}.png` : `**/features/${feature}.json`;
    await page.route(pattern, async route => {
      arrived(); await released;
      try {
        if (failure) await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Unavailable test fixture' });
        else await route.continue();
      } catch { /* Navigation cancellation can close the request before release. */ }
    });
    try {
      await page.goto(`${address}?feature=${feature}`, { waitUntil: 'domcontentloaded' });
      let timer;
      try { await Promise.race([requestArrived, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`No ${stage} request`)), 10000); })]); }
      finally { clearTimeout(timer); }
      assert.equal(await page.locator('[data-control="pause"]').isDisabled(), true);
      const allocated = await page.evaluate(() => window.featureGlResources.reduce((n, r) => n + r.Program.size + r.Buffer.size, 0));
      assert(allocated > 0, `${stage} test did not reach allocated renderer`);
      if (!failure) await page.evaluate(persisted => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted })), stage === 'texture');
      release();
      if (failure) await page.waitForSelector('.demo-error-shell');
      await page.waitForFunction(() => window.featureGlResources.every(r => Object.values(r).every(set => set.size === 0)));
      await page.waitForTimeout(100); // Late responses must not adopt resources after teardown.
      const resources = await page.evaluate(() => window.featureGlResources.map(r => Object.fromEntries(Object.entries(r).map(([k, set]) => [k, set.size]))));
      assert(resources.every(r => Object.values(r).every(n => n === 0)));
      assert.equal(await page.evaluate(() => !!window.ferrumFeatureLab), false, 'cancelled initialization published a live runtime');
      let restored = false;
      if (stage === 'texture') {
        // A normal pageshow must not restart a cancelled bootstrap; BFcache restore must.
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })));
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => !!window.ferrumFeatureLab), false);
        await Promise.all([page.waitForNavigation(), page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))]);
        await page.waitForFunction(() => window.ferrumFeatureLab?.snapshot().nativeState === 1);
        assert.equal(await page.locator('[data-control="pause"]').isDisabled(), false);
        await page.evaluate(() => window.ferrumFeatureLab.destroy());
        assert(await page.evaluate(() => window.featureGlResources.every(r => Object.values(r).every(set => set.size === 0))));
        restored = true;
      }
      assert.deepEqual(errors, []);
      cases.push({ feature, stage, resources, cancelled: !failure, errorUi: failure, restored });
    } catch (error) {
      const state = await page.evaluate(() => ({ ready: !!window.ferrumFeatureLab,
        resources: window.featureGlResources?.map(r => Object.fromEntries(Object.entries(r).map(([k, set]) => [k, set.size]))) })).catch(() => undefined);
      throw new Error(`Bootstrap ${stage}: ${error.message}; ${JSON.stringify({ state, errors })}`, { cause: error });
    }
    finally { release(); await page.close(); }
  }
  return cases;
}
