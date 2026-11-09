import assert from 'node:assert/strict';
import { checkLightingQuality } from './feature-lighting-quality-checks.mjs';
export const topicFeatureIds = new Set(['lighting','hd2d-environment','postprocess','camera','physics-queries','pixel-perfect','sprite-materials','rendering']);
export async function checkTopicFeature({page,id,control,snapshot,pixelHash,artifactDir}) {
  const rendered = async () => { await page.waitForTimeout(260); return page.evaluate(pixelHash); };
  if(id === 'physics-queries') {
    await control('query-center').click(); await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().query.hits.length===1);
    await control('query-left').click(); await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().query.hits.length===0);
    await control('query-kind').selectOption('cast'); await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().query.hits.length>0);
    await control('query-kind').selectOption('aabb'); await control('query-center').click();
    assert.equal((await snapshot()).query.hits.length,1);
  }
  if(id === 'pixel-perfect') {
    const start=await snapshot(); assert.equal(start.pixel.presentation.sourceWidth,320); assert.equal(start.pixel.viewport.width,640);
    await control('pixel-offset').fill('1.125'); await control('pixel-offset').dispatchEvent('input');
    await page.waitForFunction(()=>Math.abs(window.ferrumFeatureLab.snapshot().pixel.position.x-241.125)<.001);
    await control('pixel-zoom').fill('135'); await control('pixel-zoom').dispatchEvent('input');
    await control('pixel-snap').uncheck(); const unsnapped=await rendered();
    await control('pixel-snap').check(); const snapped=await rendered();
    assert.notEqual(snapped.hash,unsnapped.hash,'pixel snapping must affect real rendering at fractional zoom');
    await page.locator('.feature-atlas-comparison summary').click();
    assert.equal(await page.locator('.feature-atlas-comparison img').evaluateAll(images=>images.filter(img=>img.complete && img.naturalWidth>0).length),2);
    assert(Math.abs((await snapshot()).pixel.position.x-241.125)<.001,'snapping must preserve native coordinates');
    await control('pixel-enabled').uncheck(); assert.equal((await snapshot()).pixel.presentation,undefined);
    await control('pixel-enabled').check();
  }
  if(id === 'sprite-materials') {
    await control('sprite-style').selectOption('original'); const original=await rendered();
    for(const mode of ['palette','flash','outline']) {
      await control('sprite-style').selectOption(mode); const modified=await rendered();
      assert.notEqual(modified.hash,original.hash,`${mode} must change native sprite rendering`);
    }
    await control('sprite-style').selectOption('original'); assert.equal((await rendered()).hash,original.hash);
  }
  if(id === 'rendering') {
    const initial=await snapshot();
    await control('object-count').selectOption('128'); await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().entities===128);
    assert((await snapshot()).commands>=128);
    for(let attempt=0;attempt<2;attempt++) {
      const resources=(await snapshot()).resources;
      await control('probe-load').click(); await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().rendering.loaded);
      assert.equal((await snapshot()).resources.textureCount,resources.textureCount+1);
      await control('probe-release').click(); assert.equal((await snapshot()).resources.textureCount,resources.textureCount);
    }
    await control('reset').click(); await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().entities===2);
    assert.equal((await snapshot()).commands,initial.commands);
  }
  if(id === 'postprocess') {
    await control('effect').selectOption('clean'); const original=await rendered();
    for(const kind of ['vignette','glitch','pixelArt','fade']) {
      await control('effect').selectOption(kind); const changed=await rendered(); assert.notEqual(changed.hash,original.hash,`${kind} must change pixels`);
    }
    await control('effect-strength').fill('0'); await control('effect-strength').dispatchEvent('input');
    assert.equal((await rendered()).hash,original.hash,'zero strength restores original');
    await control('reset').click();
  }
  if(id === 'camera') {
    await control('zoom').fill('200'); await control('zoom').dispatchEvent('input');
    await control('camera').selectOption('follow'); await control('camera-bounds').check();
    await page.locator('[data-target="128"]').click(); await page.waitForTimeout(1500);
    assert((await snapshot()).cameraX>=159.5,'native camera must stay inside zoomed world bounds');
    await control('reset').click();
    await page.waitForTimeout(250);
    const center=await snapshot(); await control('camera-shake').click();
    await page.waitForFunction(base=>Math.abs(window.ferrumFeatureLab.snapshot().cameraX-base.x)+Math.abs(window.ferrumFeatureLab.snapshot().cameraY-base.y)>1,{x:center.cameraX,y:center.cameraY});
    await page.waitForFunction(()=>!window.ferrumFeatureLab.snapshot().cameraEffect.active);
    const shaken=await snapshot(); assert.equal(shaken.cameraEffect.impulses,1);
    assert.equal(shaken.actor.x,center.actor.x); assert.equal(shaken.actor.y,center.actor.y);
    await control('pause').click(); await control('camera-shake').click();
    assert.equal((await snapshot()).cameraEffect.active,false,'paused camera impulse must not start');
    await control('reset').click();
  }
  if(id === 'hd2d-environment') {
    return checkLightingQuality({page,control,snapshot,pixelHash,artifactDir});
  }
}
