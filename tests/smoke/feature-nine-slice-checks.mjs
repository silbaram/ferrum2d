import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, readFile, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {decodePng} from '../../scripts/tools/pack-textures.mjs';

/** Regenerate in isolation so other hand-edited example scenes remain untouched. */
export async function checkNineSliceFixtureGeneration() {
  const root = await mkdtemp(join(tmpdir(), 'ferrum-nine-slice-fixture-'));
  try {
    for (const file of ['scripts/assets/build-feature-examples.mjs', 'scripts/assets/build-hd2d-feature-scenes.mjs', 'scripts/assets/lighting-quality-model.mjs', 'scripts/assets/build-shadow-comparison.mjs', 'scripts/assets/shadow-comparison-models.mjs', 'scripts/tools/pack-textures.mjs',
      'examples/starter-runtime/public/playground/floor.png',
      'apps/studio/public/assets/lantern-garden/atlas.png', 'apps/studio/public/assets/lantern-garden/manifest.json',
      'apps/studio/public/assets/rpg-village/cart.glb', 'apps/studio/public/assets/rpg-village/lamp.glb']) {
      await mkdir(dirname(join(root, file)), {recursive:true}); await copyFile(resolve(file), join(root, file));
    }
    execFileSync(process.execPath, [join(root, 'scripts/assets/build-feature-examples.mjs')], {cwd:root,timeout:15000,stdio:'pipe'});
    for (const id of ['nine-slice','physics-queries','pixel-perfect','sprite-materials','rendering','hd2d-environment','hd2d-shadow-proxy']) {
      const file = `examples/starter-runtime/public/features/${id}.json`;
      assert.deepEqual(JSON.parse(await readFile(join(root, file), 'utf8')), JSON.parse(await readFile(file, 'utf8')), `${id}: generated scene must match maintained example`);
    }
    const emitter = 'examples/starter-runtime/public/features/spatial/emitter.glb';
    assert.deepEqual(await readFile(join(root, emitter)), await readFile(emitter), 'emissive model must regenerate byte-for-byte');
    for(const name of [...['actor','tree','lantern','crate'].flatMap(kind=>[`shadow-${kind}.glb`,`shadow-${kind}-low.glb`]),'shadow-garden.png','shadow-assets.json']){
      const file=`examples/starter-runtime/public/features/spatial/${name}`;
      assert.deepEqual(await readFile(join(root,file)),await readFile(file),`${name}: shadow comparison assets must regenerate byte-for-byte`);
    }
    const shadowScene=JSON.parse(await readFile(join(root,'examples/starter-runtime/public/features/hd2d-shadow-proxy.json'),'utf8'));
    const sun=shadowScene.spatial.environment.lighting.directional.direction;
    assert(Math.abs(Math.atan2(sun.elevation,Math.hypot(sun.x,sun.y))*180/Math.PI-45)<1e-6,'Authored shadow scene must use the same 45 degree sun as the initial UI');
    const assets=JSON.parse(await readFile(join(root,'examples/starter-runtime/public/features/spatial/shadow-assets.json'),'utf8'));
    const atlas=decodePng(await readFile(join(root,'examples/starter-runtime/public/features/spatial/shadow-garden.png')));
    const footPivots=[];
    for(const name of ['lantern','crate']){
      const frame=assets.frames[name],subject=assets.subjects[name];
      let top=frame.height,bottom=0;
      for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++)if(atlas.pixels[((frame.y+y)*atlas.width+frame.x+x)*4+3]){top=Math.min(top,y);bottom=Math.max(bottom,y+1);}
      const foot=bottom/frame.height*subject.height-subject.originY*subject.height;
      const height=(bottom-top)/frame.height*subject.height;
      assert.equal(foot,0,`${name}: actual opaque sprite foot must lie on the attachment plane`);
      assert.equal(height,subject.volumeHeight,`${name}: volume height must match the measured opaque sprite height`);
      footPivots.push({name,top,bottom,foot,height});
    }
    for (const extrude of [0,2]) {
      const file = `examples/starter-runtime/public/features/atlas/padding-${extrude}.png`;
      assert.deepEqual(await readFile(join(root,file)),await readFile(file),'atlas preview must match actual packer output');
    }
    return {regenerationMatches:true, isolated:true,footPivots};
  } finally { await rm(root, {recursive:true,force:true}); }
}

/** Compare native corner geometry and rendered pixels, plus the user-facing explanation. */
export async function checkFeatureNineSlice({page, control, snapshot, pixelHash}) {
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().nineSlice?.nativeCorner);
  assert.equal((await snapshot()).commands, 11, 'one native nine-slice (9), stretched frame (1), source (1)');
  assert.match(await page.locator('[data-value=observation]').textContent(), /같은 원본 24/);
  assert.equal(await page.locator('[data-panel-content] strong').first().textContent(), '마을의 안내인');
  const initial = await snapshot(), original = await page.evaluate(pixelHash);
  const corner = initial.nineSlice.nativeCorner;
  assert(corner.width > 0 && Math.abs(corner.width - corner.height) < .01, 'corners must remain square');
  for (const [name, value] of [['panel-width','280'], ['panel-height','224']]) {
    await control(name).fill(value); await control(name).dispatchEvent('input'); await settle();
    const changed = await snapshot();
    assert(Math.abs(changed.nineSlice.nativeCorner.width - corner.width) < .01);
    assert(Math.abs(changed.nineSlice.nativeCorner.height - corner.height) < .01);
  }
  assert.notEqual((await page.evaluate(pixelHash)).hash, original.hash, 'resizing must change the native canvas');
  await control('border').fill('4'); await control('border').dispatchEvent('input');
  await page.waitForFunction(width => Math.abs(window.ferrumFeatureLab.snapshot().nineSlice.nativeCorner.width - width * 2) < .01, corner.width);
  await control('sliced').uncheck();
  await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().commands === 3 && !window.ferrumFeatureLab.snapshot().nineSlice.nativeCorner);
  assert.equal(await page.locator('[data-comparison-label=sliced] h3').textContent(), '9-slice 끔');
  await control('sliced').check(); await control('panel-example').selectOption('inventory'); await settle();
  assert.equal((await snapshot()).nineSlice.mode, 'inventory');
  assert.equal(await page.locator('.nine-slice-items span').count(), 12);
  await control('slice-guides').uncheck(); assert(await page.locator('.nine-slice-source-grid').isHidden());
  await control('pause').click();
  await control('panel-width').fill('192'); await control('panel-width').dispatchEvent('input'); await settle();
  assert.equal((await snapshot()).state, 'paused', 'resizing while paused must preserve native pause');
  assert.equal((await snapshot()).nativeState, 3);
  await control('reset').click();
  await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().nativeState === 1 && window.ferrumFeatureLab.snapshot().commands === 11);
  const reset = (await snapshot()).nineSlice;
  assert.equal(reset.mode, 'dialogue'); assert.equal(reset.width, 256); assert.equal(reset.height, 144);
  assert.equal(reset.borderPixels, 8); assert(reset.enabled); assert(await page.locator('.nine-slice-source-grid').isVisible());
  await control('panel-width').focus(); await page.keyboard.press('ArrowRight'); await settle();
  assert.equal((await snapshot()).nineSlice.width, 264, 'keyboard resize must work');
  await control('panel-example').selectOption('inventory');
  for (const width of [390, 320]) {
    await page.setViewportSize({width,height:844});
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().nineSlice.stacked);
    await settle();
    const first = await page.locator('[data-comparison-label=plain]').boundingBox(), second = await page.locator('[data-comparison-label=sliced]').boundingBox();
    assert(second.y > first.y + first.height && Math.abs(first.x - second.x) < 2, 'mobile comparison must stack vertically');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert(await page.locator('.nine-slice-source-caption').evaluate(element => {
      const caption = element.getBoundingClientRect(), canvas = document.querySelector('canvas').getBoundingClientRect();
      return caption.top >= canvas.top && caption.bottom <= canvas.bottom + 1;
    }), 'source explanation must stay inside the canvas');
  }
  await page.setViewportSize({width:1440,height:1000}); await settle();
  await control('reset').click(); await settle();
  return {nativeCornerInvariant:true,resizing:true,borderScale:true,detach:true,presets:true,pausedResize:true,reset:true,keyboard:true,mobileWidths:[390,320]};
}
