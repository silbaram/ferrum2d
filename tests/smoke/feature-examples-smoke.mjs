import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright-core';
import {installSpatialGpuTarget} from './spatial-webgpu-capture.mjs';
import {checkFeatureExtra, observeFeatureAudio} from './feature-extras-checks.mjs';
import {checkFeatureLifecycle} from './feature-lifecycle-checks.mjs';
import {checkFeaturePointer} from './feature-pointer-checks.mjs';

const dist=resolve('examples/starter-runtime/dist'),prefix='/nested/starter-runtime/';
const parent=resolve('artifacts/feature-examples');await mkdir(parent,{recursive:true});const run=await mkdtemp(resolve(parent,'run-'));
await writeFile(resolve(parent, 'verification.json'), JSON.stringify({ ok: false, status: 'running', run }, null, 2) + '\n');
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.json':'application/json'};
const server=createServer((req,res)=>void(async()=>{
  const url=new URL(req.url,'http://localhost');if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const route = /^\/nested\/(starter-runtime|platformer|breakout|topdown-shooter)\/(.*)$/.exec(url.pathname);
  if(!route){res.writeHead(404).end();return;}
  const root = resolve(`examples/${route[1]}/dist`);
  const path=resolve(root,decodeURIComponent(route[2])||'index.html');
  if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',mime[extname(path)]??'application/octet-stream');res.end(await readFile(path));
})().catch(()=>res.writeHead(404).end()));
function gpuCapture() {
  const original=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(kind,...args){if(kind==='webgpu')this.dataset.spatialGpuTarget='true';return Reflect.apply(original,this,[kind,...args]);};
  const requestAdapter=navigator.gpu.requestAdapter.bind(navigator.gpu);
  navigator.gpu.requestAdapter=async(...args)=>{const adapter=await requestAdapter(...args);if(!adapter)return adapter;const requestDevice=adapter.requestDevice.bind(adapter);
    adapter.requestDevice=async(...args)=>{const device=await requestDevice(...args);window.playgroundGpuDevice=device;device.addEventListener('uncapturederror',e=>{window.playgroundGpuError=e.error.message;});return device;};return adapter;};
}
async function pixelHash() {
  const canvas=document.querySelector('canvas'),device=window.playgroundGpuDevice;
  let bytes;
  if(!device){const gl=canvas.getContext('webgl2');const before=gl.getError();bytes=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);const after=gl.getError();if(before||after)throw Error(`GL readback: before=${before}, after=${after}, contextLost=${gl.isContextLost()}`);}
  else {
    await device.queue.onSubmittedWorkDone();const texture=canvas.getContext('webgpu').getCurrentTexture(),stride=Math.ceil(canvas.width*4/256)*256;
    const buffer=device.createBuffer({size:stride*canvas.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:stride,rowsPerImage:canvas.height},{width:canvas.width,height:canvas.height,depthOrArrayLayers:1});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);bytes=new Uint8Array(buffer.getMappedRange()).slice();buffer.unmap();}finally{buffer.destroy();}
  }
  const colors=new Set();for(let i=0;i<bytes.length;i+=4)colors.add((bytes[i]<<16)|(bytes[i+1]<<8)|bytes[i+2]);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  return {hash,colors:colors.size};
}
const catalog = JSON.parse(await readFile('examples/shared/featureCatalog.json', 'utf8'));
const results = [];
let browser, activePage;
try {
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  browser = await chromium.launch({ headless: true, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--use-vulkan=swiftshader'] });
  for (const backend of ['webgl2', 'webgpu']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(10000);
    activePage = page;
    await page.addInitScript(observeFeatureAudio);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (!response.ok()) errors.push(`HTTP ${response.status()} ${response.url()}`); });
    if (backend === 'webgpu') await page.addInitScript({ content: `(${installSpatialGpuTarget.toString()})();(${gpuCapture.toString()})();` });
    const snapshot = () => page.evaluate(() => window.ferrumFeatureLab.snapshot());
    const control = key => page.locator(`[data-control="${key}"]`);
    for (const { id } of catalog) {
      console.log(`Checking ${backend}/${id}`);
      await page.goto(`http://127.0.0.1:${server.address().port}${prefix}?feature=${id}&renderer=${backend}`);
      // The Shooter controller consumes the queued start input on its next native update.
      await page.waitForFunction(() => window.ferrumFeatureLab?.snapshot().nativeState === 1 || document.querySelector('.demo-error-shell'), undefined, { timeout: 30000 });
      assert.equal(await page.locator('.demo-error-shell').count(), 0, await page.locator('body').innerText());
      const initial = await snapshot();
      const scene = JSON.parse(await readFile(resolve(dist, `features/${id}.json`), 'utf8'));
      assert.equal(initial.id, id);
      assert.equal(initial.backend, backend, 'requested backend must really render');
      if (scene.sceneComposition) assert.equal(initial.entities, scene.sceneComposition.fragments.lab.instances.length);
      else assert(initial.entities >= 1 && initial.entities < 4, 'isolated tile/controller fixture must have no enemy waves');
      assert(initial.commands > 0 && initial.drawCalls > 0);
      assert.equal(initial.nativeState, 1, `${id} must actually run in native Playing state`);
      assert(initial.entities <= 100 && initial.commands <= 400 && initial.drawCalls <= 64, `${id} initial scene/render budget exceeded`);
      assert.equal(await page.locator('.feature-topics a').count(), catalog.length);
      assert.equal(await page.locator('.feature-topics a[aria-current=page]').count(), 1);
      assert.equal(await page.locator('.playground-progress').count(), 0);
      const pixels = await page.evaluate(pixelHash);
      // The original panel PNG deliberately has only five colors plus the canvas background.
      assert(pixels.colors >= (['nine-slice', 'particles'].includes(id) ? 6 : 13), `${id} canvas appears empty (${pixels.colors} colors)`);
      if (['layers', 'lighting', 'postprocess', 'audio'].includes(id)) {
        await page.waitForTimeout(220);
        assert.equal((await page.evaluate(pixelHash)).hash, pixels.hash, `${id} baseline changes without a feature edit`);
      }
      if (id === 'animation') {
        await control('pause').click();
        const paused = (await snapshot()).animation;
        await page.waitForTimeout(200); assert.deepEqual((await snapshot()).animation, paused);
        await control('fps').fill('12'); await control('fps').dispatchEvent('input');
        await control('direction').selectOption('reverse'); await control('flip').check();
        assert.equal((await snapshot()).animation.flipX, true);
        const before = await page.evaluate(pixelHash);
        await control('pause').click();
        await page.waitForFunction(frame => window.ferrumFeatureLab.snapshot().animation.frame !== frame, (await snapshot()).animation.frame);
        assert.notEqual((await page.evaluate(pixelHash)).hash, before.hash);
        await control('reset').click();
        assert.equal(await control('fps').inputValue(), '6'); assert.equal((await snapshot()).animation.flipX, false);
      }
      if (id === 'navigation') {
        await page.evaluate(() => {
          window.featureTrace = [];
          window.featureTraceTimer = setInterval(() => { const p = window.ferrumFeatureLab.snapshot().actor; window.featureTrace.push([p.x, p.y]); }, 25);
        });
        await page.locator('[data-target="512"]').click();
        await page.waitForFunction(() => { const p = window.ferrumFeatureLab.snapshot().actor; return p.x > 506 && Math.abs(p.y - 192) < 3; }, undefined, { timeout: 12000 });
        const trace = await page.evaluate(() => { clearInterval(window.featureTraceTimer); return window.featureTrace; });
        assert(trace.some(([, y]) => y < 94 || y > 290), 'did not route around wall');
        assert(!trace.some(([x, y]) => x > 288 && x < 352 && y > 96 && y < 288), 'passed through obstacle');
        await control('reset').click(); assert.equal((await snapshot()).actor.x, 128);
        await page.locator('canvas').focus(); await page.keyboard.press('ArrowDown');
        await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().actor.y > 212);
        const point = await page.locator('canvas').evaluate(c => { const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        await page.mouse.click(point.x, point.y);
        assert.match(await page.locator('[data-value=destination]').textContent(), /이동할 수 없는/);
      }
      if (id === 'physics') {
        await control('launch').click(); await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().collisions > 0);
        await control('pause').click(); const ball = (await snapshot()).ball;
        await page.waitForTimeout(200); assert.deepEqual((await snapshot()).ball, ball);
        await control('pause').click(); await control('launch').click(); await page.waitForTimeout(1300);
        const rubber = (await snapshot()).ball;
        await control('material').selectOption('clay'); await control('launch').click(); await page.waitForTimeout(1300);
        const clay = (await snapshot()).ball;
        assert(Math.hypot(clay.velocityX, clay.velocityY) < Math.hypot(rubber.velocityX, rubber.velocityY) * .5, 'material did not affect velocity');
        await control('reset').click();
        assert.equal((await snapshot()).launches, 0); assert.equal((await snapshot()).ball.x, 200);
        assert.equal(await control('material').inputValue(), 'rubber');
      }
      if (id === 'lighting') {
        await control('pause').click(); await page.waitForTimeout(100);
        const normal = await page.evaluate(pixelHash);
        assert((await snapshot()).normalDrawCalls > 0);
        await control('normal').uncheck(); await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().normalDrawCalls === 0);
        assert.notEqual((await page.evaluate(pixelHash)).hash, normal.hash);
        await control('normal').check(); await page.locator('[data-light="480"]').click(); await page.waitForTimeout(100);
        assert.notEqual((await page.evaluate(pixelHash)).hash, normal.hash);
        await control('lighting').selectOption('off'); await page.waitForTimeout(100);
        assert.equal((await snapshot()).normalDrawCalls, 0);
      }
      if (id === 'postprocess') {
        await control('pause').click(); await page.waitForTimeout(100);
        const original = await page.evaluate(pixelHash);
        for (const effect of ['bloom', 'crt']) {
          await control('effect').selectOption(effect);
          await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().postProcessPassCount > 0);
          await page.waitForTimeout(100); assert.notEqual((await page.evaluate(pixelHash)).hash, original.hash);
        }
        await control('reset').click(); await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().postProcessPassCount === 0);
      }
      if (id === 'camera') {
        await control('zoom').fill('200'); await control('zoom').dispatchEvent('input'); await control('camera').selectOption('follow');
        await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().cameraX < 150);
        await page.locator('[data-target="512"]').click();
        await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().cameraX > 480, undefined, { timeout: 10000 });
        await control('camera').selectOption('fixed'); await page.waitForFunction(() => Math.abs(window.ferrumFeatureLab.snapshot().cameraX - 320) < 1);
        await control('reset').click(); assert.equal(await control('zoom').inputValue(), '100'); assert.equal((await snapshot()).actor.x, 128);
      }
      if (id === 'nine-slice') {
        assert.equal(initial.commands, 19);
        const original = await page.evaluate(pixelHash);
        await control('border').fill('4'); await control('border').dispatchEvent('input'); await page.waitForTimeout(100);
        assert.notEqual((await page.evaluate(pixelHash)).hash, original.hash);
        await control('sliced').uncheck(); await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().commands === 3);
        assert.notEqual((await page.evaluate(pixelHash)).hash, original.hash);
        await control('reset').click(); await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().commands === 19);
      }
      await checkFeatureExtra({ page, id, control, snapshot, pixelHash });
      console.log(`Controls passed ${backend}/${id}`);
      if (backend === 'webgl2') await page.screenshot({ path: resolve(run, `${id}.png`), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(100);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${id} narrow overflow`);
      const bounds = await page.locator('canvas').boundingBox(); assert(bounds.width >= 300 && bounds.x >= 0 && bounds.x + bounds.width <= 390);
      const state = (await snapshot()).state;
      await control('pause').focus(); await page.keyboard.press('Enter'); assert.notEqual((await snapshot()).state, state);
      if (id === 'animation' && backend === 'webgl2') await page.screenshot({ path: resolve(run, 'mobile.png'), fullPage: true });
      assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => window.playgroundGpuError), undefined);
      const resources = await page.evaluate(() => window.ferrumFeatureLab.destroy());
      console.log(`Destroyed ${backend}/${id}`);
      if (id === 'audio') await page.waitForFunction(() => window.featureAudio.contexts.every(c => c.state === 'closed'));
      assert.equal(await page.locator('[data-ferrum-virtual-controls], .feature-input-menu').count(), 0);
      for (const key of ['textureCount', 'bufferCount', 'programCount', 'renderTargetCount']) assert.equal(resources[key], 0, `${id} leaked ${key}`);
      results.push({ backend, id, initial, pixels, controls: 'native state / GPU readback checked', narrow: true, resources });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.close();
  }
  const guides = [];
  for (const id of ['platformer', 'breakout', 'topdown-shooter']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    activePage = page;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (!response.ok()) errors.push(`HTTP ${response.status()} ${response.url()}`); });
    await page.goto(`http://127.0.0.1:${server.address().port}/nested/${id}/`);
    await page.waitForFunction(() => window.ferrumEngine?.entityCount() > 0 || document.querySelector('.demo-error-shell'));
    assert.equal(await page.locator('.demo-error-shell').count(), 0, await page.locator('body').innerText());
    await page.evaluate(() => document.fonts.ready);
    assert(await page.evaluate(() => document.fonts.check('13px "Ferrum Example UI"')), `${id} Korean font did not load`);
    if (id === 'platformer') {
      await page.evaluate(() => window.ferrumRuntime.pause());
      for (const [index, x, y] of [[0, 260, 420], [1, 610, 272], [2, 760, 440]]) {
        await page.locator('.example-guide select').selectOption(String(index));
        await page.locator('.example-guide button').click();
        // Built-in controller entities need not own rigid bodies. Query the public native
        // transform buffer rather than the rigid-body-only diagnostic getPhysicsEntity.
        const actor = await page.evaluate(() => {
          const e = window.ferrumEngine, h = e.builtInPlatformerPlayerHandle();
          const pose = e.queryAudioPoseBuffer(new Uint32Array([h.entityId, h.entityGeneration]));
          if (!pose.words[0]) throw Error('Missing player transform');
          return { x: pose.floats[4], y: pose.floats[5] };
        });
        assert.equal(actor.x, x); assert.equal(actor.y, y);
      }
      await page.evaluate(() => window.ferrumRuntime.resume());
    } else {
      const initial = await page.locator('.example-guide p').allTextContents();
      await page.locator('.example-guide select').selectOption('1');
      assert.notDeepEqual(await page.locator('.example-guide p').allTextContents(), initial);
      assert.equal(await page.locator('.example-guide button').isVisible(), false);
    }
    await page.locator('.example-guide select').focus();
    await page.locator('canvas').click();
    assert(await page.locator('canvas').evaluate(c => document.activeElement === c), `${id} guide trapped game keyboard focus`);
    await page.locator('.example-guide a').click();
    await page.waitForURL('**/*physicsDebugLines=true*');
    await page.waitForFunction(() => window.ferrumEngine?.entityCount() > 0);
    // Shooter's title scene has no active collision bodies; start through its public UI.
    if (id === 'topdown-shooter') {
      await page.locator('canvas').click(); await page.keyboard.down('Enter');
      try { await page.waitForFunction(() => window.ferrumEngine.gameState() === 1); }
      finally { await page.keyboard.up('Enter'); }
    }
    await page.waitForFunction(() => window.ferrumRuntime.renderer.stats().physicsDebugLineCount > 0);
    await page.screenshot({ path: resolve(run, `${id}-guide.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(100);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${id} guide layout overflows`);
    const canvas = await page.locator('canvas').boundingBox();
    assert(canvas.width > 300 && canvas.x + canvas.width <= 390);
    assert.deepEqual(errors, []);
    guides.push({ id, controls: true, debugReload: true, narrow: true });
    await page.close();
  }
  const lifecycle = await checkFeatureLifecycle(browser, `http://127.0.0.1:${server.address().port}${prefix}`);
  const pointer = await checkFeaturePointer(browser, `http://127.0.0.1:${server.address().port}${prefix}`, `(${installSpatialGpuTarget.toString()})();(${gpuCapture.toString()})();`);
  const report = { ok: true, run, browser: browser.version(), webgpu: 'Software offscreen target, not real GPU compositor coverage', results, guides, lifecycle, pointer };
  await writeFile(resolve(run, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(resolve(parent, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Feature examples passed: ${results.length} renderer/topic cases, ${guides.length} existing example guides, ${lifecycle.length} lifecycle cases, ${pointer.length} DPR/touch cases. ${run}`);
} catch (error) {
  const state = await activePage?.evaluate(() => window.ferrumFeatureLab?.snapshot()).catch(() => undefined);
  await activePage?.screenshot({ path: resolve(run, 'failure.png'), fullPage: true }).catch(() => {});
  const failure = JSON.stringify({ ok: false, run, state, results, error: String(error.stack ?? error) }, null, 2) + '\n';
  await writeFile(resolve(run, 'failure.json'), failure);
  await writeFile(resolve(parent, 'verification.json'), failure);
  throw error;
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
