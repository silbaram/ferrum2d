import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {decodePng} from '../../scripts/tools/pack-textures.mjs';
import {smokePixelOnion} from './pixel-onion-smoke.mjs';

/** Extend the already verified two-layer source; keep the original layer regression intact. */
export async function smokePixelFrames(page,mode,run) {
  const workspace=page.locator('#placement-pixel-workspace'),panel=workspace.locator('.placement-pixel-frames');
  const frameAction=name=>panel.locator('[data-pixel-frame-action="'+name+'"]');
  const action=name=>workspace.locator('[data-pixel-action="'+name+'"]');
  const duration=panel.locator('[data-pixel-frame-duration]');
  async function exported(kind,suffix) {
    const menu=workspace.locator('.placement-pixel-export-menu');if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();
    const pending=page.waitForEvent('download');await action(kind).click();const file=await pending;
    const path=join(run,mode+'-frames-'+suffix);await file.saveAs(path);
    if(await menu.evaluate(e=>e.open))await menu.locator('summary').click();return {path,bytes:await readFile(path)};
  }
  const source=async name=>JSON.parse((await exported('export-source',name+'.pixel.json')).bytes);
  const first=await panel.locator('[data-pixel-frame-select]').getAttribute('data-pixel-frame-select');
  assert(await frameAction('remove').isDisabled());await frameAction('duplicate').click();
  const second=await panel.locator('[data-pixel-frame-select][aria-pressed=true]').getAttribute('data-pixel-frame-select');
  const duplicated=await source('duplicated');assert.equal(duplicated.version,3);
  assert.deepEqual(duplicated.frames[0].cels,duplicated.frames[1].cels,'duplication copies every layer');
  await duration.fill('200');await duration.press('Enter');
  await workspace.locator('[data-pixel-color]').fill('#ff0000');await workspace.locator('[data-pixel-alpha]').fill('255');await action('tool-fill').click();
  const canvas=workspace.locator('canvas');
  async function paint() {
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    const p=await canvas.evaluate(e=>{const r=e.getBoundingClientRect(),z=Number(e.dataset.pixelZoom);return {x:r.x+Number(e.dataset.pixelOriginX)+1.5*z,y:r.y+Number(e.dataset.pixelOriginY)+1.5*z};});
    await page.mouse.click(p.x,p.y);
  }
  await paint();let painted=await source('painted');assert.deepEqual(painted.frames[0],duplicated.frames[0]);
  assert.notDeepEqual(painted.frames[1].cels,painted.frames[0].cels,'painting affects only the selected frame');
  await frameAction('add').click();assert.equal((await source('added')).frames.length,3);
  await panel.locator('[data-pixel-frame-select][aria-pressed=true]').focus();await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-pixel-frame-select')),second,'Undo keeps focus in the pixel frame editor');
  assert.equal(await panel.locator('[data-pixel-frame-select]').count(),2);
  await page.keyboard.press('Control+Shift+z');assert.equal((await source('add-redo')).frames.length,3);
  await frameAction('remove').click();assert.equal((await source('removed')).frames.length,2);
  await action('undo').click();assert.equal((await source('remove-undo')).frames.length,3);
  await action('redo').click();assert.equal((await source('remove-redo')).frames.length,2);
  await frameAction('left').click();
  assert(await workspace.evaluate(e=>e.contains(document.activeElement)),'disabling the first-frame order button must keep keyboard focus in the pixel editor');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await panel.locator('[data-pixel-frame-select]').evaluateAll(nodes=>nodes.map(e=>e.dataset.pixelFrameSelect)),[first,second],'keyboard Undo after moving a frame targets pixel history');
  await page.keyboard.press('Control+Shift+z');
  assert.deepEqual((await source('reordered')).frames.map(f=>f.id),[second,first]);
  await frameAction('right').click();assert.deepEqual((await source('order-restored')).frames.map(f=>f.id),[first,second]);
  await duration.fill('0');await duration.press('Enter');assert.equal(await duration.inputValue(),'200');
  const select=id=>panel.locator('[data-pixel-frame-select="'+id+'"]');
  await select(first).click();assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false','frame selection is UI state');
  await duration.fill('83');await duration.press('Enter');await select(second).click();await duration.fill('124');await duration.press('Enter');
  assert.equal(await panel.locator('[data-pixel-frame-compatibility]').getAttribute('data-error'),'true');assert(await action('apply').isDisabled());
  await select(first).click();const beforePreview=await source('preview-source');
  await frameAction('play').click();assert.equal(await panel.getAttribute('data-pixel-playing'),'true');
  assert(await duration.isDisabled());assert(await frameAction('add').isDisabled());assert(await action('tool-pencil').isDisabled());
  await page.waitForFunction(id=>document.querySelector('.placement-pixel-frames').dataset.pixelPreviewFrame!==id,first);
  await paint();await frameAction('play').click();
  assert.equal(await panel.getAttribute('data-pixel-preview-frame'),first,'stopping restores the editing frame');
  assert.deepEqual(await source('preview-unchanged'),beforePreview,'preview and canvas clicks cannot edit source');
  await frameAction('play').click();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  assert.equal(await panel.getAttribute('data-pixel-playing'),'false');
  await frameAction('play').click();await action('back').click();await workspace.waitFor({state:'hidden'});
  assert.equal(await panel.getAttribute('data-pixel-playing'),'false','leaving the pixel tab stops its preview clock');
  await page.locator('[data-placement-document-key="ferrum:pixel-document"]').click();await workspace.waitFor({state:'visible'});
  assert.equal(await panel.getAttribute('data-pixel-preview-frame'),first,'returning to the tab restores the editing frame');
  await duration.fill('100');await duration.press('Enter');await select(second).click();await duration.fill('200');await duration.press('Enter');await select(first).click();
  await select(second).click();await frameAction('remove').click();
  assert(await workspace.evaluate(e=>e.contains(document.activeElement)),'disabling deletion at one remaining frame must keep pixel focus');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await panel.locator('[data-pixel-frame-select]').evaluateAll(nodes=>nodes.map(e=>e.dataset.pixelFrameSelect)),[first,second]);
  await select(first).click();
  const final=await source('source');assert.deepEqual(final.frames.map(f=>f.durationMs),[100,200]);
  const png=decodePng((await exported('export-png','sheet.png')).bytes);assert.equal(png.width,16);assert.equal(png.height,8);
  for(let y=0;y<8;y++)for(let x=0;x<16;x++)assert.deepEqual([...png.pixels.subarray((y*16+x)*4,(y*16+x)*4+4)],x<8?[64,0,191,255]:[255,0,0,255]);
  assert.equal(await panel.locator('[data-pixel-frame-compatibility]').getAttribute('data-error'),'false');
  await page.screenshot({path:join(run,mode+'-pixel-frames.png'),fullPage:true});
  await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:840});
  assert.equal(await frameAction('play').getAttribute('aria-label'),'프레임 재생');
  assert(await workspace.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'frames fit a narrow workspace');
  await page.screenshot({path:join(run,mode+'-pixel-frames-ko-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-placement-language]').selectOption('en');
  const onionSkin=await smokePixelOnion(page,mode,run,final,join(run,mode+'-frames-source.pixel.json'));
  return {source:final,frameIds:[first,second],durations:[100,200],frameOperations:true,independentCels:true,
    previewDoesNotEdit:true,blurStopsPreview:true,tabStopsPreview:true,boundaryActionFocus:true,unsupportedTimingDiagnosed:true,atlasVerified:true,onionSkin};
}

/** The owned second-frame card must open that cel, including after native restore. */
export async function smokePixelFrameCard(page,mode,run,assetId,source) {
  const workspace=page.locator('#placement-pixel-workspace'),menu=workspace.locator('.placement-pixel-export-menu');
  if(await menu.evaluate(e=>e.open))await menu.locator('summary').click();
  await workspace.locator('[data-pixel-action="back"]').click();
  const second=source.frames[1].id;
  await page.locator('[data-placement-edit-pixels="'+assetId+'"][data-placement-edit-pixel-frame="'+second+'"]').click();
  await workspace.waitFor({state:'visible'});
  assert.equal(await workspace.locator('[data-pixel-frame-select][aria-pressed=true]').getAttribute('data-pixel-frame-select'),second,
    'opening an owned frame card must preserve the chosen frame');
  assert(await workspace.locator('[data-pixel-action="undo"]').isDisabled(),'view selection cannot add pixel history');
  // This fixture's second cel is opaque red; the first is blue. Check rendered pixels too.
  await page.waitForFunction(()=>{
    const canvas=document.querySelector('[data-pixel-canvas]'),rect=canvas.getBoundingClientRect(),zoom=Number(canvas.dataset.pixelZoom);
    const x=(Number(canvas.dataset.pixelOriginX)+1.5*zoom)*canvas.width/rect.width;
    const y=(Number(canvas.dataset.pixelOriginY)+1.5*zoom)*canvas.height/rect.height;
    const pixel=canvas.getContext('2d').getImageData(Math.floor(x),Math.floor(y),1,1).data;
    return pixel[0]>240&&pixel[1]<10&&pixel[2]<10;
  });
  await page.evaluate(()=>{
    const original=globalThis.btoa,encode=original.bind(globalThis);window.pixelToolEncodingCalls=0;
    window.restorePixelToolEncoding=()=>{globalThis.btoa=original;};
    globalThis.btoa=value=>{window.pixelToolEncodingCalls++;return encode(value);};
  });
  let encodings;
  try {
    await workspace.locator('[data-pixel-action="tool-eraser"]').click();
    await workspace.locator('[data-pixel-action="tool-pencil"]').click();
    encodings=await page.evaluate(()=>window.pixelToolEncodingCalls);
  } finally { await page.evaluate(()=>window.restorePixelToolEncoding()); }
  assert.equal(encodings,0,'tool UI changes must not serialize every cel just to validate an Apply preview');
  await menu.locator('summary').click();
  const waiting=page.waitForEvent('download');await workspace.locator('[data-pixel-action="export-source"]').click();
  const download=await waiting,path=join(run,mode+'-frame-card.pixel.json');await download.saveAs(path);
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')),source,'opening a cel preserves the entire editing source');
  await menu.locator('summary').click();
  await workspace.locator('[data-pixel-frame-select="'+source.frames[0].id+'"]').click();
  assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false');
  return {chosenSecondFrame:true,renderedSecondCel:true,sourceUnchanged:true,selectionHasNoHistory:true,previewDoesNotEncodePixels:true};
}
