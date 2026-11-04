import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {decodePng} from '../../scripts/tools/pack-textures.mjs';
import {pixelCapacitySource} from './pixel-capacity-fixture.mjs';
import {showPlacementBottom,clickPlacementToolAction} from './placement-panel-navigation.mjs';

/** Actual combined properties UI plus independent exported PNG assertions. */
export async function smokePixelBlend(page,mode,run,verify) {
  await showPlacementBottom(page,'assets');
  const workspace=page.locator('#placement-pixel-workspace'),button=workspace.locator('[data-pixel-layer-appearance]');
  const dialog=page.locator('[data-pixel-opacity-dialog]'),blend=dialog.locator('[data-pixel-layer-blend]');
  const number=dialog.locator('[data-pixel-opacity-value]'),apply=dialog.locator('[data-pixel-opacity-apply]');
  const action=k=>workspace.locator('[data-pixel-action="'+k+'"]');let serial=0;
  async function load(value){await page.locator('[data-pixel-file]').setInputFiles({name:'blend.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});await workspace.waitFor({state:'visible'});}
  async function exported(kind='export-source') {
    const menu=workspace.locator('.placement-pixel-export-menu');if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();
    const waiting=page.waitForEvent('download');await clickPlacementToolAction(action(kind));const file=await waiting,path=join(run,mode+'-blend-'+serial+++(kind==='export-png'?'.png':'.json'));await file.saveAs(path);await menu.locator('summary').click();return readFile(path);
  }
  const source=async()=>JSON.parse(await exported());
  const initial=pixelCapacitySource({side:16,count:2,layers:2,version:7});initial.name='blend-animated';initial.layers[1].visible=true;
  initial.tags[0].direction='reverse';initial.tags[0].frameIds.reverse();
  initial.frames.forEach((frame,i)=>{frame.cels[0].rgba=Buffer.from(Array.from({length:256},()=>i?[255,0,0,255]:[0,0,255,255]).flat()).toString('base64');frame.cels[1].rgba=Buffer.from(Array.from({length:256},()=>[128,128,128,255]).flat()).toString('base64');});
  await load(initial);await workspace.locator('[data-pixel-layer-select=layer-1]').click();
  await button.click();await blend.selectOption('normal');await apply.click();assert.deepEqual(await source(),initial,'normal no-op preserves v7');
  const preview=()=>dialog.locator('canvas').evaluate(e=>[...e.getContext('2d').getImageData(0,0,1,1).data]);
  await button.click();await blend.selectOption('multiply');assert.deepEqual(await preview(),[0,0,128,255]);assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false');
  await dialog.locator('[data-pixel-opacity-cancel]').click();assert.deepEqual(await source(),initial);
  await button.click();await blend.selectOption('multiply');await apply.click();const multiplied=await source();assert.equal(multiplied.version,9);assert.deepEqual(multiplied.frames,initial.frames);assert.equal(multiplied.layers[1].blendMode,'multiply');
  const dark=decodePng(await exported('export-png'));assert.deepEqual([...dark.pixels.slice(0,4)],[0,0,128,255]);assert.deepEqual([...dark.pixels.slice(64,68)],[128,0,0,255]);
  await action('undo').click();assert.deepEqual(await source(),initial);await action('redo').click();assert.deepEqual(await source(),multiplied);
  await button.click();await blend.selectOption('screen');await number.fill('50');assert.deepEqual(await preview(),[64,64,255,255]);
  await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:844});
  assert.equal(await blend.getAttribute('aria-label'),'레이어 합성 모드');assert.equal(await blend.locator('option:checked').textContent(),'스크린');
  const box=await dialog.boundingBox();assert(box.x>=0&&box.x+box.width<=390);await page.screenshot({path:join(run,mode+'-blend-ko.png'),fullPage:true});await apply.click();
  assert.match(await button.textContent(),/스크린.*50.2/);
  await page.setViewportSize({width:1280,height:900});await page.locator('[data-placement-language]').selectOption('en');
  const screened=await source();assert.equal(screened.layers[1].opacity,128);assert.equal(screened.layers[1].blendMode,'screen');assert.deepEqual(screened.frames,initial.frames);assert.deepEqual(screened.tags,initial.tags);
  await action('undo').click();assert.deepEqual(await source(),multiplied,'combined blend and opacity is one undo step');await action('redo').click();assert.deepEqual(await source(),screened);
  const png=decodePng(await exported('export-png'));assert.deepEqual([...png.pixels.slice(0,4)],[64,64,255,255]);assert.deepEqual([...png.pixels.slice(64,68)],[255,64,64,255]);
  await button.click();await blend.selectOption('multiply');await page.keyboard.press('Escape');assert.deepEqual(await source(),screened);
  await button.click();await blend.selectOption('multiply');
  await page.evaluate(()=>{const retained=document.querySelector('[data-pixel-opacity-apply]');window.blendLateApply=()=>retained.onclick?.(new MouseEvent('click'));document.querySelector('[data-pixel-frame-select="frame-1"]').click();});
  assert.equal(await dialog.count(),0);await page.evaluate(()=>window.blendLateApply());assert.deepEqual(await source(),screened);
  await workspace.locator('[data-pixel-layer-locked=layer-1]').check();assert(await button.isDisabled());await workspace.locator('[data-pixel-layer-locked=layer-1]').uncheck();
  const merge=workspace.locator('.placement-pixel-layer-merge');await merge.locator('summary').click();await merge.locator('[data-pixel-layer-merge=visible]').click();
  const merged=await source();assert.equal(merged.layers[0].blendMode,'normal');assert.equal(merged.layers[0].opacity,255);assert.deepEqual(decodePng(await exported('export-png')),png);await action('undo').click();assert.deepEqual(await source(),screened);
  let id,game,tagged,saved=screened;
  async function applyAndVerify(){
    await clickPlacementToolAction(action('apply'));const approval=page.locator('[data-pixel-action=confirm-migrate]');if(await approval.isVisible())await approval.click();
    await page.waitForFunction(()=>document.querySelector('#placement-pixel-workspace').dataset.pixelBusy==='false');
    const bundle=JSON.parse(await exported('export-assets'));id=bundle.sceneDocument.sceneComposition.fragments.main.instances[0].props.components.visual.texture;
    game=await verify(bundle);assert.equal(game.directionPlayback.playingState,1);assert.equal(game.directionPlayback.clips[0].frames,2);
  }
  if(verify){await applyAndVerify();tagged={id,source:screened,game};saved=structuredClone(screened);for(const key of ['tags','initialTag','nextClipId'])delete saved[key];await load(saved);await applyAndVerify();assert.equal(game.directionPlayback.clips[0].direction,'forward');}
  return {source:saved,...(id?{id,game,tagged}:{}),purePreview:true,normalNoOp:true,multiplyPng:true,screenPng:true,combinedUndo:true,rawPixelsPreserved:true,staleFrameGuard:true,mergeParity:true,koreanNarrow:true};
}
