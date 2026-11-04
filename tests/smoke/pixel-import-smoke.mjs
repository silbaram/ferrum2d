import assert from 'node:assert/strict';
import {smokePixelImportLayer} from './pixel-import-layer-smoke.mjs';
import {smokePixelImportTransfer} from './pixel-import-transfer-smoke.mjs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {encodePngRgba,decodePng} from '../../scripts/tools/pack-textures.mjs';
import {showPlacementBottom,showPlacementDock,showPlacementInspector,clickPlacementToolAction} from './placement-panel-navigation.mjs';

export async function smokePixelImport(page,mode,run) {
  await showPlacementBottom(page,'assets');
  const workspace=page.locator('#placement-pixel-workspace'),input=page.locator('[data-pixel-file]');
  const original={format:'ferrum2d.pixel-document',version:1,name:'import-baseline',width:2,height:2,colorSpace:'srgb',palette:['#ff0000ff','#0000ffff'],layer:{id:'base',name:'Base'},frame:{id:'idle',durationMs:100},rgba:Buffer.alloc(16).toString('base64')};
  const pixels=new Uint8Array(1024*512*4);
  for(let y=0;y<512;y++)for(let x=0;x<1024;x++)pixels.set(x<512?[255,0,0,255]:[0,0,255,128],(y*1024+x)*4);
  const png=Buffer.from(encodePngRgba(1024,512,pixels)),file={name:'web-generated.png',mimeType:'image/png',buffer:png};
  const dialog=page.locator('[data-pixel-import-dialog]'),field=k=>dialog.locator('[data-pixel-import-field="'+k+'"]');
  const action=k=>dialog.locator('[data-pixel-import-action="'+k+'"]');
  let serial=0;
  async function exportFile(kind,suffix){
    const menu=workspace.locator('.placement-pixel-export-menu');if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();
    const pending=page.waitForEvent('download');await clickPlacementToolAction(workspace.locator('[data-pixel-action="'+kind+'"]'));
    const download=await pending,path=resolve(run,mode+'-import-'+serial+++suffix);await download.saveAs(path);
    await menu.locator('summary').click();return readFile(path);
  }
  const source=async()=>JSON.parse(await exportFile('export-source','.pixel.json'));
  async function open(){await page.locator('[data-pixel-import-file]').setInputFiles(file);await dialog.waitFor();await page.waitForFunction(()=>document.querySelector('[data-pixel-import-action=apply]')?.disabled===false);}
  // Escape belongs to the import modal, including when the compact asset drawer is open.
  if(await workspace.isVisible()) await workspace.locator('[data-pixel-action=back]').click();
  const previousPanel=await page.locator('.demo-shell').getAttribute('data-compact-panel');
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.querySelector('.demo-shell')?.dataset.compact==='true');
  await showPlacementBottom(page,'assets');
  const waiting=page.waitForEvent('filechooser');await clickPlacementToolAction(page.locator('[data-pixel-launcher] [data-pixel-action=import-image]'));
  await (await waiting).setFiles(file);await dialog.waitFor();await page.waitForFunction(()=>document.querySelector('[data-pixel-import-action=apply]')?.disabled===false);
  if(process.argv.includes('--pixel-import-only')) assert.equal(await field('colors').locator('option[value=palette]').evaluate(e=>e.disabled),true,'no open document means no document palette');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(),0,'Escape closes the import modal on its first press');
  assert.equal(await page.locator('.demo-shell').getAttribute('data-compact-panel'),'runtime','Escape must preserve the underlying asset drawer');
  if(process.argv.includes('--pixel-import-only')) {
    await page.locator('[data-pixel-import-file]').setInputFiles(file);await dialog.waitFor();
    assert(await field('destination').locator('option[value=layer]').evaluate(e=>e.disabled));await page.keyboard.press('Escape');
  }
  // Preserve the caller's compact layout for the later layer/frame smoke cases.
  if(!previousPanel||previousPanel==='none') await page.locator('[data-placement-compact-viewport]').click();
  else await showPlacementDock(page,previousPanel);
  assert.equal(await page.locator('.demo-shell').getAttribute('data-compact-panel'),previousPanel??'none');
  await page.setViewportSize({width:1280,height:900});
  await page.waitForFunction(()=>document.querySelector('.demo-shell')?.dataset.compact==='false');
  await input.setInputFiles({name:'baseline.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))});await workspace.waitFor({state:'visible'});
  const transfer=await smokePixelImportTransfer(page,mode,run,{file,source,original});
  // A large PNG selected through the existing Open control automatically enters conversion.
  await input.setInputFiles(file);await dialog.waitFor();await page.waitForFunction(()=>document.querySelector('[data-pixel-import-action=apply]')?.disabled===false);
  assert.equal(await field('width').inputValue(),'64');assert.equal(await field('height').inputValue(),'32');
  const preview=dialog.locator('[data-pixel-import-preview]');
  assert.deepEqual(await preview.evaluate(c=>[...c.getContext('2d').getImageData(0,0,1,1).data]),[255,0,0,255]);
  assert.deepEqual(await preview.evaluate(c=>[...c.getContext('2d').getImageData(c.width-1,0,1,1).data]),[0,0,255,128]);
  await action('cancel').click();assert.deepEqual(await source(),original,'cancel leaves the current document untouched');
  await open();await field('crop-width').fill('4097');assert(await action('apply').isDisabled());
  await action('reset').click();await field('width').fill('257');assert(await action('apply').isDisabled());
  await field('preset').selectOption('32');await field('colors').selectOption('palette');
  const crop=dialog.locator('[data-pixel-import-source]');await crop.scrollIntoViewIfNeeded();const bounds=await crop.boundingBox();
  // A pending numeric preview must not re-enable Apply during a new crop gesture.
  await crop.evaluate(canvas=>canvas.addEventListener('pointerdown',()=>{
    const width=document.querySelector('[data-pixel-import-field=width]');
    width.dispatchEvent(new Event('input',{bubbles:true}));
  },{capture:true,once:true}));
  await page.mouse.move(bounds.x+1,bounds.y+1);await page.mouse.down();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert(await action('apply').isDisabled(),'a queued preview must not apply an unfinished crop');
  await page.mouse.move(bounds.x+bounds.width*.45,bounds.y+bounds.height-2,{steps:4});await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('[data-pixel-import-action=apply]')?.disabled===false);
  assert(Number(await field('crop-width').inputValue())<512);assert(Number(await field('crop-height').inputValue())>400);
  // Use exact numeric crop to exercise keyboard editing and a known expected result.
  await field('x').fill('0');await field('y').fill('0');await field('crop-width').fill('512');await field('crop-height').fill('512');
  await field('preset').selectOption('32');
  await page.waitForFunction(()=>document.querySelector('[data-pixel-import-preview]')?.width===32&&document.querySelector('[data-pixel-import-preview]')?.height===32);
  await page.screenshot({path:resolve(run,mode+'-pixel-image-import.png'),fullPage:true});
  await action('apply').click();await dialog.waitFor({state:'detached'});
  const converted=await source();assert.equal(converted.width,32);assert.equal(converted.height,32);assert.equal(converted.version,1);assert.equal(converted.name,'web-generated');
  const rgba=Buffer.from(converted.rgba,'base64');for(let i=0;i<rgba.length;i+=4)assert.deepEqual([...rgba.subarray(i,i+4)],[255,0,0,255]);
  const exported=decodePng(await exportFile('export-png','.png'));assert.equal(exported.width,32);assert.deepEqual(Buffer.from(exported.pixels),rgba);
  await input.setInputFiles({name:'roundtrip.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(converted))});assert.deepEqual(await source(),converted);
  // Invalid input and decoding failures keep the current document editable.
  const corrupt=Buffer.from(png);
  for(let offset=8;offset<corrupt.length;offset+=corrupt.readUInt32BE(offset)+12) {
    if(corrupt.toString('ascii',offset+4,offset+8)==='IDAT') {corrupt[offset+8]=0;break;}
  }
  for(const invalid of [Buffer.from('not a png'),(()=>{const b=Buffer.from(png);b.writeUInt32BE(4097,16);return b;})(),corrupt]){
    await page.locator('[data-pixel-import-file]').setInputFiles({...file,buffer:invalid});await dialog.waitFor();
    await page.waitForFunction(()=>{const e=document.querySelector('[data-pixel-import-status]');return e&&e.textContent&&!e.textContent.includes('Loading');});
    assert(await action('apply').isDisabled());await action('cancel').click();assert.deepEqual(await source(),converted);
  }
  // Cancel while the browser decoder is still pending; a late bitmap must be closed.
  await page.evaluate(()=>{
    const original=window.createImageBitmap;window.importBitmapOriginal=original;window.importBitmapClosed=0;
    window.createImageBitmap=async(...args)=>{const bitmap=await original(...args),close=bitmap.close.bind(bitmap);bitmap.close=()=>{window.importBitmapClosed++;close();};await new Promise(resolve=>{window.importBitmapRelease=resolve;});return bitmap;};
  });
  await page.locator('[data-pixel-import-file]').setInputFiles(file);await page.waitForFunction(()=>!!window.importBitmapRelease);
  await action('cancel').click();await page.evaluate(()=>{window.createImageBitmap=window.importBitmapOriginal;window.importBitmapRelease();});
  await page.waitForFunction(()=>window.importBitmapClosed===1);assert.equal(await dialog.count(),0);assert.deepEqual(await source(),converted);
  // Dirty-document confirmation is retained; rejecting it returns to conversion.
  const canvas=workspace.locator('[data-pixel-canvas]');await clickPlacementToolAction(workspace.locator('[data-pixel-action=tool-pencil]'));
  await workspace.locator('[data-pixel-color]').fill('#00ff00');
  const p=await canvas.evaluate(c=>{const r=c.getBoundingClientRect(),z=Number(c.dataset.pixelZoom);return{x:r.x+Number(c.dataset.pixelOriginX)+z/2,y:r.y+Number(c.dataset.pixelOriginY)+z/2};});await page.mouse.click(p.x,p.y);
  await open();await action('apply').click();await page.locator('[data-pixel-action=confirm-cancel]').click();assert(await dialog.isVisible());
  await action('cancel').click();assert.notDeepEqual(await source(),converted);
  // Detached callbacks from an old importer cannot close a newer import session.
  await open();const oldCancel=await action('cancel').elementHandle();await action('cancel').click();await open();
  await oldCancel.evaluate(e=>e.click());await oldCancel.dispose();assert(await dialog.isVisible());
  // Check the translated, narrow dialog with real CSS and numeric controls.
  await page.evaluate(()=>{const el=document.querySelector('[data-placement-language]');el.value='ko';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.setViewportSize({width:390,height:844});assert.equal(await action('apply').textContent(),'편집기로 열기');
  assert.equal(await field('colors').getAttribute('aria-label'),'색상');assert.equal(await field('preset').locator('option[value=custom]').textContent(),'사용자 지정');
  const size=await dialog.boundingBox();assert(size.width<=390);assert(size.height<=844);
  assert(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:resolve(run,mode+'-pixel-image-import-ko.png'),fullPage:true});
  await action('apply').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(run,mode+'-pixel-image-import-ko-controls.png'),fullPage:true});
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);
  await page.setViewportSize({width:1280,height:900});await page.locator('[data-placement-language]').selectOption('en');
  // Host tab switching invalidates the importer, including a decoded image preview.
  await open();await workspace.locator('[data-pixel-action=back]').evaluate(e=>e.click());assert.equal(await dialog.count(),0);
  if(mode==='hd2d') {
    // Spatial placement has a capture-phase shortcut, before modal bubbling handlers.
    await showPlacementInspector(page,'placement');
    await page.locator('[data-placement-spatial-add-asset]').selectOption('crate');
    const place=page.locator('[data-placement-spatial-place]');await place.click();
    assert.equal(await place.getAttribute('aria-pressed'),'true');
    await open();await page.keyboard.press('Escape');
    assert.equal(await dialog.count(),0,'pending spatial placement must not consume the modal Escape');
    assert.equal(await place.getAttribute('aria-pressed'),'true','cancelling the import preserves pending scene placement');
    await place.click();
  }
  await input.setInputFiles({name:'baseline.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))});await workspace.waitFor({state:'visible'});
  const layerImport=await smokePixelImportLayer(page,mode,run,{source,original,input});
  return {transfer,layerImport,largePng:true,crop:true,cropPreviewRace:true,compactEscape:true,...(mode==='hd2d'?{spatialModalEscape:true}:{}),palette:true,roundTrip:true,decodeFailure:true,cancel:true,lateBitmapClosed:true,dirtyConfirmation:true,staleDismiss:true,tabSwitch:true,koreanNarrowLayout:true};
}
