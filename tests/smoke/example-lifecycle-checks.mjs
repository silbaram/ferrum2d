import assert from 'node:assert/strict';
import {trackGlResources} from './feature-lifecycle-checks.mjs';

const hosts = [
  {id:'topdown-shooter', path:'topdown-shooter/', stages:['**/game.json','**/assets/outpost/operator.png']},
  {id:'pixel-art', path:'pixel-art/', stages:['**/assets/keeper.png','**/scene.json','**/*.wasm']},
  {id:'engine-playground', path:'starter-runtime/?mode=playground', stages:['**/playground/robot.png','**/playground/scene.json','**/*.wasm']},
  {id:'breakout', path:'breakout/', stages:['**/*.wasm']},
  {id:'platformer', path:'platformer/', stages:['**/*.wasm']},
  {id:'minimal-game', path:'reference/minimal-game/', stages:['**/*.wasm']},
  {id:'starter-profiles', path:'starter-runtime/?mode=starter', stages:['**/*.wasm']},
  {id:'physics-sandbox', path:'physics-sandbox/', stages:['**/catalog.json','**/assets/debug-font.png','**/demos/rigid-materials.physics.json']},
];
const live = () => !!(window.ferrumRuntime || window.ferrumPixelShowcase || window.ferrumEnginePlayground);
const resources = () => window.featureGlResources.map(r => Object.fromEntries(Object.entries(r).map(([key, handles]) => [key, handles.size])));
const ready = () => window.ferrumPixelShowcase?.snapshot().commands > 0 || window.ferrumEnginePlayground?.snapshot().commands > 0 ||
  (window.ferrumRuntime?.renderer.stats().renderCommandCount > 0 && window.ferrumEngine?.entityCount() > 0);
function trackWasmInitialization() {
  window.examplePendingWasm = 0;
  for (const key of ['instantiateStreaming', 'instantiate']) {
    const original = WebAssembly[key];
    if (!original) continue;
    WebAssembly[key] = async function (...args) {
      window.examplePendingWasm++;
      try { return await Reflect.apply(original, WebAssembly, args); }
      finally { window.examplePendingWasm--; }
    };
  }
}
async function allReleased(page) {
  // The Wasm factory has no abort option. Wait for its real late result before
  // asserting cleanup, rather than closing the page while it is still pending.
  await page.waitForFunction(() => window.examplePendingWasm === 0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => window.featureGlResources.every(r => Object.values(r).every(handles => handles.size === 0)));
  await page.waitForTimeout(120); // Include late responses and RAF/resize callbacks.
  const counts = await page.evaluate(resources);
  assert(counts.every(r => Object.values(r).every(n => n === 0)), JSON.stringify(counts));
  assert.equal(await page.evaluate(live), false, 'teardown left a live runtime hook');
  return counts;
}

/** Delayed real HTTP/Wasm initialization, failures, BFcache and normal teardown. */
export async function checkExampleLifecycles(browser, base) {
  const results = [];
  for (const host of hosts) {
    for (const [index, pattern] of host.stages.entries()) {
      const failure = index === 0;
      for (const fail of failure ? [false, true] : [false]) {
        const persisted = !fail && host.id === 'pixel-art' && index === 0;
        const page = await browser.newPage(); page.setDefaultTimeout(15000);
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.text().startsWith('Ferrum2D cleanup failed')) errors.push(message.text()); });
        await page.addInitScript(trackGlResources);
        await page.addInitScript(trackWasmInitialization);
        let release, arrive, timer;
        const gate = new Promise(resolve => { release = resolve; });
        const arrival = new Promise(resolve => { arrive = resolve; });
        await page.route(pattern, async route => {
          arrive(); await gate;
          try {
            if (fail) await route.fulfill({status:503, body:'Lifecycle test fixture'});
            else await route.continue();
          } catch { /* A cancelled page may already have closed the request. */ }
        });
        try {
          await page.goto(new URL(host.path, base).href, {waitUntil:'domcontentloaded'});
          try { await Promise.race([arrival, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Expected request not reached: '+pattern)), 15000); })]); }
          finally { clearTimeout(timer); }
          const lateWasm = pattern.endsWith('*.wasm') ? page.waitForResponse(response => response.url().endsWith('.wasm')) : undefined;
          if (!fail) await page.evaluate(persisted => window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted})), persisted);
          release();
          if (lateWasm) await (await lateWasm).finished();
          if (fail) await page.waitForSelector('.demo-error-shell, .error-shell');
          const counts = await allReleased(page);
          if (!fail) assert.equal(await page.locator('.demo-error-shell, .error-shell').count(), 0, 'cancellation rendered a startup error');
          if (persisted) {
            await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:false})));
            assert.equal(await page.evaluate(live), false);
            await Promise.all([page.waitForNavigation(), page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true})))]);
            await page.waitForFunction(ready);
            await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted:false})));
            await allReleased(page);
          }
          assert.deepEqual(errors, []);
          results.push({id:host.id, pattern, failure:fail, persisted, resources:counts});
        } catch (error) {
          throw new Error(`${host.id} lifecycle ${pattern} failure=${fail}: ${error.message}; pageErrors=${JSON.stringify(errors)}`, {cause:error});
        } finally { release(); await page.close(); }
      }
    }
    const page = await browser.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.text().startsWith('Ferrum2D cleanup failed')) errors.push(message.text()); });
    await page.addInitScript(trackGlResources);
    await page.addInitScript(trackWasmInitialization);
    try {
      await page.goto(new URL(host.path, base).href); await page.waitForFunction(ready);
      assert((await page.evaluate(resources)).some(r => r.Program > 0), 'ready test must allocate real GPU resources');
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true})));
      assert(await page.evaluate(live), 'ready BFcache page must retain its runtime');
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true})));
      await page.waitForFunction(ready);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted:false})));
      const counts = await allReleased(page);
      assert.deepEqual(errors, []);
      results.push({id:host.id, readyTeardown:true, bfcacheRetention:true, resources:counts});
    } finally { await page.close(); }
  }
  return results;
}

/** The most recently selected scenario wins, including a slow stale request and recovery. */
export async function checkPhysicsScenarioRequests(browser, base) {
  const page = await browser.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let release;
  try {
    await page.goto(new URL('physics-sandbox/', base).href);
    await page.waitForFunction(() => window.ferrumPhysicsSandboxSmokeFrame?.demoId);
    const options = await page.locator('.scenario-select option').evaluateAll(options => options.map(o => o.value));
    const older = options[1], latest = options[2];
    let arrive, timer;
    const gate = new Promise(resolve => { release = resolve; }), arrival = new Promise(resolve => { arrive = resolve; });
    const slow = `**/demos/${older}.physics.json`;
    await page.route(slow, async route => { arrive(); await gate; try { await route.continue(); } catch {} });
    await page.locator('.scenario-select').selectOption(older);
    try { await Promise.race([arrival, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Slow scenario request not reached')), 15000); })]); }
    finally { clearTimeout(timer); }
    await page.locator('.scenario-select').selectOption(latest);
    await page.waitForFunction(id => window.ferrumPhysicsSandboxSmokeFrame?.demoId === id, latest);
    release(); await page.waitForTimeout(250);
    assert.equal(await page.locator('.scenario-select').inputValue(), latest);
    assert.equal(await page.evaluate(() => window.ferrumPhysicsSandboxSmokeFrame.demoId), latest);
    await page.unroute(slow);
    await page.route(slow, route => route.fulfill({status:503, body:'Scenario failure fixture'}));
    await page.locator('.scenario-select').selectOption(older);
    await page.waitForSelector('.error-box:not([hidden])');
    await page.waitForFunction(id => window.ferrumPhysicsSandboxSmokeFrame?.demoId === id, latest);
    assert.equal(await page.evaluate(() => window.ferrumPhysicsSandboxSmokeFrame.demoId), latest, 'failed request must retain the last valid world');
    await page.unroute(slow);
    await page.locator('.scenario-select').selectOption(older);
    await page.waitForFunction(id => window.ferrumPhysicsSandboxSmokeFrame?.demoId === id, older);
    assert.deepEqual(errors, [], 'handled scenario failures must not become unhandled rejections');
    return {older, latest, staleResponseIgnored:true, failedRequestRetainsWorld:true, recovered:true};
  } finally { release?.(); await page.close(); }
}
