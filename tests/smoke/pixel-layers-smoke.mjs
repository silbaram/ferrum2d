import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {decodePng} from '../../scripts/tools/pack-textures.mjs';

/** Shared UI scenario for browser exports and the real native project roundtrip. */
export async function smokePixelLayers(page,mode,run) {
  const workspace=page.locator('#placement-pixel-workspace');
  const action=name=>workspace.locator('[data-pixel-action="'+name+'"]');
  const layerAction=name=>workspace.locator('[data-pixel-layer-action="'+name+'"]');
  await page.locator('[data-pixel-action="new"]').click();
  const dialog=page.locator('dialog[open]');
  await dialog.getByLabel('Pixel Name',{exact:true}).fill('layered-sprite');
  await dialog.getByLabel('Pixel Width',{exact:true}).fill('8');
  await dialog.getByLabel('Pixel Height',{exact:true}).fill('8');
  await dialog.locator('[data-pixel-action="create"]').click();
  await workspace.waitFor({state:'visible'});
  const canvas=workspace.locator('canvas');
  async function click(x,y) {
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    const p=await canvas.evaluate((e,p)=>{const r=e.getBoundingClientRect(),z=Number(e.dataset.pixelZoom);
      return {x:r.x+Number(e.dataset.pixelOriginX)+(p.x+0.5)*z,y:r.y+Number(e.dataset.pixelOriginY)+(p.y+0.5)*z};},{x,y});
    await page.mouse.click(p.x,p.y);
  }
  async function exported(kind,suffix) {
    const menu=workspace.locator('.placement-pixel-export-menu');
    if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();
    const pending=page.waitForEvent('download');await action(kind).click();const file=await pending;
    const path=join(run,mode+'-layers-'+suffix);await file.saveAs(path);
    if(await menu.evaluate(e=>e.open))await menu.locator('summary').click();
    return await readFile(path);
  }
  const source=async suffix=>JSON.parse(await exported('export-source',suffix+'.pixel.json'));
  async function checkPng(expected,suffix) {
    const png=decodePng(await exported('export-png',suffix+'.png'));
    for(let i=0;i<png.pixels.length;i+=4)assert.deepEqual([...png.pixels.subarray(i,i+4)],expected);
  }
  assert(await layerAction('remove').isDisabled());
  await workspace.locator('[data-pixel-color]').fill('#0000ff');await workspace.locator('[data-pixel-alpha]').fill('255');
  await action('tool-fill').click();await click(1,1);
  assert.equal((await source('legacy')).version,1);
  await layerAction('add').click();
  const top=await workspace.locator('[data-pixel-layer-select][aria-pressed=true]').getAttribute('data-pixel-layer-select');
  await workspace.locator('[data-pixel-color]').fill('#ff0000');await workspace.locator('[data-pixel-alpha]').fill('64');
  await click(1,1);
  await workspace.locator('[data-pixel-layer-name]').fill('Armor');await workspace.locator('[data-pixel-layer-name]').press('Enter');
  const renamed=await source('renamed');assert.equal(renamed.layers[1].name,'Armor');
  await action('undo').click();assert.notEqual((await source('rename-undo')).layers[1].name,'Armor');
  await action('redo').click();assert.equal((await source('rename-redo')).layers[1].name,'Armor');
  const baseSelect=workspace.locator('[data-pixel-layer-select="'+renamed.layers[0].id+'"]');
  const topSelect=workspace.locator('[data-pixel-layer-select="'+top+'"]'),name=workspace.locator('[data-pixel-layer-name]');
  await baseSelect.focus();await baseSelect.press('Enter');
  assert(await baseSelect.evaluate(e=>document.activeElement===e),'selecting a layer retains keyboard focus');
  await name.fill('Body');await topSelect.click();
  assert.equal(await topSelect.getAttribute('aria-pressed'),'true','committing a rename on blur cannot swallow the next layer click');
  assert.equal((await source('rename-click')).layers[0].name,'Body');
  await name.fill('장비');await name.dispatchEvent('keydown',{code:'Enter',key:'Enter',isComposing:true,bubbles:true});
  assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false','IME Enter does not commit an unfinished layer name');
  assert.equal(await name.inputValue(),'장비');await name.press('Escape');assert.equal(await name.inputValue(),'Armor');
  await name.fill('');await name.press('Enter');assert.equal(await name.inputValue(),'Armor','invalid rename restores the source name');
  assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false');
  await checkPng([64,0,191,255],'composite');
  const beforePan=await canvas.evaluate(e=>({x:Number(e.dataset.pixelOriginX),y:Number(e.dataset.pixelOriginY)}));
  const rect=await canvas.boundingBox();await canvas.focus();await page.keyboard.down('Space');
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
  await page.mouse.move(rect.x+rect.width/2+24,rect.y+rect.height/2+12);await page.mouse.up();await page.keyboard.up('Space');
  await page.waitForFunction(before=>{
    const e=document.querySelector('[data-pixel-canvas]');
    return Math.abs(Number(e.dataset.pixelOriginX)-before.x-24)<1&&Math.abs(Number(e.dataset.pixelOriginY)-before.y-12)<1;
  },beforePan);
  assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false','Space pan changes view only');
  const visibility=workspace.locator('[data-pixel-layer-visible="'+top+'"]');
  await visibility.focus();await visibility.press('Space');assert(!await visibility.isChecked());
  assert(await visibility.evaluate(e=>document.activeElement===e),'visibility changes retain keyboard focus');
  await checkPng([0,0,255,255],'hidden');
  await workspace.locator('[data-pixel-layer-visible="'+top+'"]').check();
  await workspace.locator('[data-pixel-layer-locked="'+top+'"]').check();
  const locked=await source('locked');
  await workspace.locator('[data-pixel-color]').fill('#00ff00');await workspace.locator('[data-pixel-alpha]').fill('255');await click(2,2);
  assert.deepEqual((await source('locked-unchanged')).layers,locked.layers);
  await workspace.locator('[data-pixel-layer-locked="'+top+'"]').uncheck();
  await layerAction('down').click();
  assert(await workspace.evaluate(e=>e.contains(document.activeElement)),'disabling a layer order action must keep focus in the pixel editor');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await workspace.locator('[data-pixel-layer-select]').evaluateAll(nodes=>nodes.map(e=>e.dataset.pixelLayerSelect)),[top,renamed.layers[0].id],'keyboard Undo after a layer move targets pixel history');
  await page.keyboard.press('Control+Shift+z');
  await checkPng([0,0,255,255],'behind');
  await layerAction('up').click();await checkPng([64,0,191,255],'front');
  await layerAction('remove').click();
  assert(await workspace.evaluate(e=>e.contains(document.activeElement)),'disabling deletion at one remaining layer must keep pixel focus');
  await page.keyboard.press('Control+z');assert.equal((await source('remove-undo')).layers.length,2);
  const final=await source('source');assert.equal(final.version,2);assert.equal(final.layers[1].id,top);
  await workspace.locator('[data-pixel-layer-select="'+final.layers[0].id+'"]').click();
  assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false','selection is not source data');
  await workspace.locator('[data-pixel-layer-select="'+top+'"]').click();
  await checkPng([64,0,191,255],'sprite');
  await page.locator('[data-placement-close-document="ferrum:pixel-document"]').click();
  await workspace.waitFor({state:'hidden'});
  assert.equal(await workspace.locator('[data-pixel-layer-select]').count(),0,'closed source releases panel rows and editor references');
  await page.locator('[data-pixel-file]').setInputFiles(join(run,mode+'-layers-source.pixel.json'));
  await workspace.waitFor({state:'visible'});
  assert.equal(await workspace.locator('[data-pixel-layer-select]').count(),2);
  assert.equal(await name.inputValue(),'Armor');
  async function checkLayerLayout() {
    const bounds=await workspace.evaluate(e=>{
      const pane=e.querySelector('.placement-pixel-layers'),parent=e.getBoundingClientRect(),r=pane.getBoundingClientRect();
      return {inside:r.left>=parent.left&&r.right<=parent.right+1&&r.bottom<=parent.bottom+1,
        noHorizontalScroll:pane.scrollWidth<=pane.clientWidth+1,
        buttons:[...pane.querySelectorAll('[data-pixel-layer-action]')].every(button=>{
          const b=button.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right;
        })};
    });
    assert(bounds.inside&&bounds.noHorizontalScroll&&bounds.buttons,'layer panel content and all four actions remain visible');
  }
  await checkLayerLayout();
  await page.screenshot({path:join(run,mode+'-image-layers.png'),fullPage:true});
  await page.locator('[data-placement-language]').selectOption('ko');
  await page.setViewportSize({width:720,height:840});
  await page.waitForFunction(()=>document.querySelector('.demo-shell').dataset.compact==='true');
  assert(await workspace.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await checkLayerLayout();
  await page.screenshot({path:join(run,mode+'-image-layers-ko-compact.png'),fullPage:true});
  await page.setViewportSize({width:390,height:840});
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  await checkLayerLayout();
  const bottomPanel=await workspace.evaluate(e=>{
    const pane=e.querySelector('.placement-pixel-layers').getBoundingClientRect(),canvas=e.querySelector('canvas').getBoundingClientRect();
    return pane.top>=canvas.bottom-1;
  });
  assert(bottomPanel,'narrow workspaces put image layers below the canvas');
  await page.screenshot({path:join(run,mode+'-image-layers-ko-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-placement-language]').selectOption('en');
  return {source:final,composite:[64,0,191,255],metadataUndoRedo:true,paintLock:true,visibleOrder:true,selectionNotDirty:true,
    keyboardFocus:true,boundaryActionFocus:true,renameThenSelect:true,compositionSafe:true,invalidRenameRestored:true,pixelSpacePan:true,closeReleasesRows:true};
}
