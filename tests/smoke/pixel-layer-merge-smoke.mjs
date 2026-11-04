import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {encodePngRgba,decodePng} from '../../scripts/tools/pack-textures.mjs';
import {pixelMergeSource} from './pixel-layer-merge-fixture.mjs';
import {showPlacementBottom,clickPlacementToolAction} from './placement-panel-navigation.mjs';

export async function smokePixelLayerMerge(page,mode,run) {
  await showPlacementBottom(page,'assets');
  const workspace=page.locator('#placement-pixel-workspace'),file=page.locator('[data-pixel-file]');
  const menu=workspace.locator('.placement-pixel-layer-merge'),merge=m=>menu.locator('[data-pixel-layer-merge="'+m+'"]');
  const reason=m=>menu.locator('[data-pixel-layer-merge-reason="'+m+'"]');
  const canvas=workspace.locator('[data-pixel-canvas]');let serial=0;
  async function load(value){await file.setInputFiles({name:'merge.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});await workspace.waitFor({state:'visible'});}
  async function open(){if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();}
  async function exported(kind){const exports=workspace.locator('.placement-pixel-export-menu');if(!await exports.evaluate(e=>e.open))await exports.locator('summary').click();
    const download=page.waitForEvent('download');await clickPlacementToolAction(workspace.locator('[data-pixel-action="'+kind+'"]'));
    const path=resolve(run,mode+'-merge-'+serial+++(kind==='export-source'?'.pixel.json':'.png'));await(await download).saveAs(path);await exports.locator('summary').click();return readFile(path);}
  const source=async()=>JSON.parse(await exported('export-source'));
  const png=async()=>decodePng(await exported('export-png'));
  const initial=pixelMergeSource();await load(initial);const beforePng=await png();
  await open();assert.match(await reason('down').textContent(),/Overlay.*Middle/);await merge('down').click();
  assert.equal(await menu.evaluate(e=>e.open),false);assert(await menu.locator('summary').evaluate(e=>e===document.activeElement));
  const down=await source();assert.equal(down.layers.length,3);assert(!down.layers.some(l=>l.id==='top'));
  assert.equal(await workspace.locator('[data-pixel-layer-select][aria-pressed=true]').getAttribute('data-pixel-layer-select'),'middle');
  assert.deepEqual(await png(),beforePng,'all exported animation frames keep exact pixels');
  // Keyboard Undo after merge stays within the pixel document.
  await menu.locator('summary').focus();await page.keyboard.press('Control+z');assert.deepEqual(await source(),initial);
  await menu.locator('summary').focus();await page.keyboard.press('Control+Shift+z');assert.deepEqual(await source(),down);
  await workspace.locator('[data-pixel-action=undo]').click();await source();
  // Lock and visibility blockers describe the adjacent pair, without touching hidden originals.
  await workspace.locator('[data-pixel-layer-locked=middle]').check();await open();assert(await merge('down').isDisabled());assert(await merge('visible').isDisabled());assert.match(await reason('down').textContent(),/Unlock/);
  await workspace.locator('[data-pixel-layer-locked=middle]').uncheck();await workspace.locator('[data-pixel-layer-visible=middle]').uncheck();
  assert(await merge('down').isDisabled());assert.match(await reason('down').textContent(),/Show both/);assert(!await merge('visible').isDisabled());
  await workspace.locator('[data-pixel-layer-visible=middle]').check();
  await workspace.locator('[data-pixel-layer-select=base]').click();assert(await merge('down').isDisabled());assert.match(await reason('down').textContent(),/bottom/);
  await workspace.locator('[data-pixel-layer-select=top]').click();
  // Playback and a floating selection block mutation; Escape in the menu only closes it.
  await workspace.locator('[data-pixel-frame-action=play]').click();assert(await merge('visible').isDisabled());
  await workspace.locator('[data-pixel-frame-action=play]').click();await canvas.focus();await page.keyboard.press('Control+a');await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>document.querySelector('[data-pixel-canvas]')?.dataset.pixelSelectionPending==='true');
  assert(await merge('down').isDisabled());assert(await merge('visible').isDisabled());
  await merge('visible').dispatchEvent('click');await menu.locator('summary').focus();await page.keyboard.press('Escape');
  assert.equal(await menu.evaluate(e=>e.open),false);assert.equal(await canvas.getAttribute('data-pixel-selection-pending'),'true');
  await canvas.focus();await page.keyboard.press('Escape');assert.deepEqual(await source(),initial);
  // A rounding difference in the non-current frame rejects the complete operation.
  const rounded=pixelMergeSource({rounding:true});await load(rounded);const roundingPng=await png();
  await open();await merge('down').click();assert.match(await reason('down').textContent(),/change the composite/);assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false');assert.deepEqual(await source(),rounded);
  // A pixel-only edit invalidates the old rounding diagnostic without a layer metadata change.
  await clickPlacementToolAction(workspace.locator('[data-pixel-action=tool-pencil]'));
  await workspace.locator('[data-pixel-color]').fill('#ff0000');await workspace.locator('[data-pixel-alpha]').fill('255');
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  const point=await canvas.evaluate(e=>{const r=e.getBoundingClientRect(),z=Number(e.dataset.pixelZoom);return{x:r.x+Number(e.dataset.pixelOriginX)+z/2,y:r.y+Number(e.dataset.pixelOriginY)+z/2};});
  await page.mouse.click(point.x,point.y);assert.doesNotMatch(await reason('down').textContent(),/change the composite/);
  await workspace.locator('[data-pixel-action=undo]').click();assert.deepEqual(await source(),rounded);
  await workspace.locator('[data-pixel-layer-select=hidden]').click();
  await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:844});
  await open();await merge('visible').scrollIntoViewIfNeeded();assert.equal(await merge('visible').textContent(),'보이는 레이어 병합');
  assert(await menu.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:resolve(run,mode+'-pixel-layer-merge-ko.png'),fullPage:true});
  await merge('visible').click();await page.setViewportSize({width:1280,height:900});await page.locator('[data-placement-language]').selectOption('en');
  const visible=await source();assert.deepEqual(visible.layers,[rounded.layers[0],rounded.layers[1]]);assert.deepEqual(visible.tags,rounded.tags);assert.deepEqual(visible.palette,rounded.palette);
  for(let i=0;i<2;i++) {assert.deepEqual(visible.frames[i].cels[1],rounded.frames[i].cels[1]);assert.equal(visible.frames[i].durationMs,rounded.frames[i].durationMs);}
  assert.deepEqual(await png(),roundingPng);await workspace.locator('[data-pixel-action=undo]').click();assert.deepEqual(await source(),rounded);
  await workspace.locator('[data-pixel-action=redo]').click();assert.deepEqual(await source(),visible);await load(visible);assert.deepEqual(await source(),visible);
  // Exercise the complete prior-step workflow: PNG -> new layer -> merge -> editable source.
  const base={format:'ferrum2d.pixel-document',version:1,name:'import-and-merge',width:2,height:1,colorSpace:'srgb',palette:['#0000ffff'],layer:{id:'base',name:'Base'},frame:{id:'idle',durationMs:100},rgba:Buffer.from([0,0,255,255,0,0,255,255]).toString('base64')};
  await load(base);
  await page.locator('[data-pixel-import-file]').setInputFiles({name:'red.png',mimeType:'image/png',buffer:Buffer.from(encodePngRgba(1,1,Uint8Array.from([255,0,0,255])))});
  const dialog=page.locator('[data-pixel-import-dialog]');await page.waitForFunction(()=>document.querySelector('[data-pixel-import-action=apply]')?.disabled===false);
  await dialog.locator('[data-pixel-import-field=destination]').selectOption('layer');await page.waitForFunction(()=>document.querySelector('[data-pixel-import-action=apply]')?.disabled===false);
  await dialog.locator('[data-pixel-import-action=apply]').click();await dialog.waitFor({state:'detached'});const imported=await source();assert.equal(imported.layers.length,2);
  await open();await merge('down').click();const combined=await source();assert.deepEqual([...Buffer.from(combined.layers[0].rgba,'base64')],[255,0,0,255,0,0,255,255]);
  await open();assert(await merge('down').isDisabled());assert(await merge('visible').isDisabled());
  await workspace.locator('[data-pixel-action=undo]').click();assert.deepEqual(await source(),imported);await workspace.locator('[data-pixel-action=redo]').click();assert.deepEqual(await source(),combined);
  await load(combined);await open();await page.screenshot({path:resolve(run,mode+'-pixel-layer-merge-result.png'),fullPage:true});
  await load(initial);
  // The shared harness dispatches pagehide, then these retained callbacks.
  await menu.evaluate(e=>{const buttons=[...e.querySelectorAll('[data-pixel-layer-merge]')];window.pixelLayerMergeLateEvents=()=>{for(const b of buttons){b.click();b.onclick?.(new MouseEvent('click'));}};});
  return {mergeDown:true,mergeVisible:true,allFramePixelsExact:true,hiddenLockedSourcePreserved:true,oneUndoRedo:true,roundingGuard:true,roundingDiagnosticRefresh:true,lockAndVisibility:true,playbackAndSelectionGuard:true,menuEscape:true,sourceRoundTrip:true,importThenMerge:true,koreanNarrow:true};
}
