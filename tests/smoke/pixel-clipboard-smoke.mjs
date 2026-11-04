import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {decodePng} from '../../scripts/tools/pack-textures.mjs';
import {pixelMergeSource} from './pixel-layer-merge-fixture.mjs';
import {showPlacementBottom,clickPlacementToolAction} from './placement-panel-navigation.mjs';

export async function smokePixelClipboard(page,mode,run) {
  await showPlacementBottom(page,'assets');
  const workspace=page.locator('#placement-pixel-workspace'),input=page.locator('[data-pixel-file]');
  const action=k=>workspace.locator('[data-pixel-action="'+k+'"]'),menu=workspace.locator('.placement-pixel-export-menu');
  const copy=action('copy-png'),status=workspace.locator('[data-pixel-status]');let serial=0;
  async function open(){if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();}
  async function load(value){await input.setInputFiles({name:'clipboard.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});await workspace.waitFor({state:'visible'});}
  async function exported(kind){await open();const pending=page.waitForEvent('download');await clickPlacementToolAction(action(kind));const file=await pending,path=resolve(run,mode+'-clipboard-'+serial+++(kind==='export-source'?'.pixel.json':'.png'));await file.saveAs(path);await menu.locator('summary').click();return readFile(path);}
  const source=async()=>JSON.parse(await exported('export-source'));
  async function clipboard(){return Buffer.from(await page.evaluate(async()=>{const items=await navigator.clipboard.read();const item=items.find(i=>i.types.includes('image/png'));if(!item)throw Error('No clipboard PNG');return [...new Uint8Array(await(await item.getType('image/png')).arrayBuffer())];}));}
  async function copied(){await open();await copy.click();await page.waitForFunction(()=>document.querySelector('[data-pixel-status]')?.textContent.includes('PNG image copied')&&document.querySelector('#placement-pixel-workspace')?.dataset.pixelBusy==='false');assert.equal(await workspace.getAttribute('data-pixel-busy'),'false');}
  async function comparePng(){const result=decodePng(await clipboard()),downloaded=decodePng(await exported('export-png'));assert.deepEqual(result,downloaded);return result;}
  const base={format:'ferrum2d.pixel-document',version:1,name:'clipboard-original',width:2,height:1,colorSpace:'srgb',palette:['#0000ffff'],layer:{id:'base',name:'Base'},frame:{id:'idle',durationMs:100},rgba:Buffer.from([0,0,255,255,0,0,0,0]).toString('base64')};
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  try {
    await load(base);await workspace.locator('[data-pixel-layer-name]').fill('Edited Base');await workspace.locator('[data-pixel-layer-name]').press('Enter');
    const scene=await page.evaluate(()=>JSON.stringify(window.ferrumPlacementViewerState));
    await copied();assert.equal(await workspace.getAttribute('data-pixel-dirty'),'true','copy is not a source save');assert(!await action('undo').isDisabled());
    // Real paste must return the copied image to the existing converter. Applying a new document still asks about dirty edits.
    await menu.locator('summary').click();await action('import-image').focus();await page.keyboard.press('Control+v');
    const dialog=page.locator('[data-pixel-import-dialog]');await dialog.waitFor();await page.waitForFunction(()=>document.querySelector('[data-pixel-import-action=apply]')?.disabled===false);
    await dialog.locator('[data-pixel-import-action=apply]').click();await page.locator('[data-pixel-action=confirm-cancel]').click();await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);
    assert.equal(await workspace.getAttribute('data-pixel-dirty'),'true');assert.equal(await page.evaluate(()=>JSON.stringify(window.ferrumPlacementViewerState)),scene);
    const copiedImage=await comparePng();assert.equal(copiedImage.width,2);assert.equal(copiedImage.height,1);
    await action('undo').click();assert.deepEqual(await source(),base,'one Undo still targets the rename before copying');
    await action('redo').click();assert.equal((await source()).layer.name,'Edited Base');
    // Multiple frames copy the same complete sheet as Export PNG, even if another frame is selected.
    const animated=pixelMergeSource();animated.version=9;animated.layers=animated.layers.map((layer,i)=>({...layer,opacity:i?128:255,blendMode:i?"screen":"normal"}));await load(animated);await workspace.locator('[data-pixel-frame-select="frame-1"]').click();await copied();
    const sheet=await comparePng();assert.equal(sheet.width,4);assert.equal(sheet.height,1);assert.deepEqual(await source(),animated);
    await workspace.locator('[data-pixel-frame-action=play]').click();assert(await copy.isDisabled());await copy.dispatchEvent('click');await workspace.locator('[data-pixel-frame-action=play]').click();
    const canvas=workspace.locator('[data-pixel-canvas]');await canvas.focus();await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');
    await page.waitForFunction(()=>document.querySelector('[data-pixel-canvas]')?.dataset.pixelSelectionPending==='true');assert(await copy.isDisabled());await copy.dispatchEvent('click');await page.keyboard.press('Escape');
    assert.deepEqual(await source(),animated,'internal copy/paste and blocked image copy preserve the source');
    // Fixed-atlas output keeps its original layout rather than copying just the selected rect.
    const fixed={...base,version:4,atlas:{texture:'sheet',frames:[{id:'left',frame:{u0:0,v0:0,u1:.5,v1:1}},{id:'right',frame:{u0:.5,v0:0,u1:1,v1:1}}]}};
    await load(fixed);await workspace.locator('[data-pixel-atlas-frame]').selectOption('right');await copied();const atlas=await comparePng();assert.equal(atlas.width,2);assert.deepEqual(await source(),fixed);
    // Permission errors are recoverable and translated; the clipboard write is stubbed only for the failure route.
    await page.evaluate(()=>{window.originalPixelClipboardWrite=navigator.clipboard.write;navigator.clipboard.write=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));});
    await page.locator('[data-placement-language]').selectOption('ko');await open();await copy.click();await page.waitForFunction(()=>document.querySelector('[data-pixel-status]')?.textContent.includes('차단'));
    assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false');await page.setViewportSize({width:390,height:844});assert.equal(await copy.textContent(),'PNG 복사');
    await copy.scrollIntoViewIfNeeded();const bounds=await menu.locator('div').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=390,'export menu stays inside the narrow viewport');
    await page.screenshot({path:resolve(run,mode+'-pixel-clipboard-ko.png'),fullPage:true});
    await page.setViewportSize({width:1280,height:900});await page.locator('[data-placement-language]').selectOption('en');
    await page.evaluate(()=>{navigator.clipboard.write=undefined;});await action('tool-pencil').click();await open();assert(await copy.isDisabled());assert.match(await workspace.locator('[data-pixel-clipboard-hint]').textContent(),/unavailable.*Export PNG/);
    await page.evaluate(()=>{navigator.clipboard.write=window.originalPixelClipboardWrite;});await action('tool-pencil').click();assert(!await copy.isDisabled());
    // A pending OS permission/write must not trap the editor after Back. Its late rejection belongs to the old action.
    await page.evaluate(()=>{navigator.clipboard.write=()=>new Promise((resolve,reject)=>{window.releasePixelClipboardWrite=resolve;window.rejectPixelClipboardWrite=reject;});});
    await open();await copy.click();assert.equal(await workspace.getAttribute('data-pixel-busy'),'true');await menu.locator('summary').click();await action('back').click();
    await workspace.waitFor({state:'hidden'});await page.locator('[role=tab][aria-controls=placement-pixel-workspace]').click();await workspace.waitFor({state:'visible'});
    await load({...base,name:'replacement'});await page.evaluate(()=>{window.rejectPixelClipboardWrite(Error('Late OS write failure'));navigator.clipboard.write=window.originalPixelClipboardWrite;});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.doesNotMatch(await status.textContent(),/copy failed|Late OS/);
    assert.equal((await source()).name,'replacement');await load(base);
    return {nativePngReadBack:true,copyPasteImport:true,exportParity:true,dirtyAndUndoPreserved:true,allAnimationFrames:true,layerOpacity:true,layerBlending:true,fixedAtlasLayout:true,internalClipboardUnchanged:true,playbackAndSelectionGuard:true,permissionAndUnsupported:true,abortReleasesEditor:true,lateResultIgnored:true,koreanNarrow:true};
  } finally {
    await page.evaluate(()=>{if(window.originalPixelClipboardWrite)navigator.clipboard.write=window.originalPixelClipboardWrite;delete window.originalPixelClipboardWrite;return navigator.clipboard.writeText('');});
    await page.context().clearPermissions();
  }
}
