import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {encodePngRgba} from '../../scripts/tools/pack-textures.mjs';
import {pixelCapacitySource} from './pixel-capacity-fixture.mjs';

export async function smokePixelImportLayer(page,mode,run,{source,original,input}) {
  const workspace=page.locator('#placement-pixel-workspace'),dialog=page.locator('[data-pixel-import-dialog]');
  const field=k=>dialog.locator('[data-pixel-import-field="'+k+'"]');
  const apply=dialog.locator('[data-pixel-import-action=apply]');
  const rgba=Uint8Array.from([255,0,0,255,0,0,255,128]);
  const file={name:'overlay.png',mimeType:'image/png',buffer:Buffer.from(encodePngRgba(2,1,rgba))};
  async function load(value){await input.setInputFiles({name:'layer-test.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});await workspace.waitFor({state:'visible'});}
  async function ready(){await page.waitForFunction(()=>document.querySelector('[data-pixel-import-action=apply]')?.disabled===false);}
  async function open(drop=false){
    if(drop) await workspace.evaluate((element,bytes)=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(bytes)],'overlay.png',{type:'image/png'}));element.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));},[...file.buffer]);
    else await page.locator('[data-pixel-import-file]').setInputFiles(file);
    await dialog.waitFor();await ready();
  }
  async function layer(){await field('destination').selectOption('layer');await ready();}
  async function cancel(){await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});}
  const baseline={...original,name:'layer-baseline',width:4,height:3,rgba:Buffer.from(Array.from({length:12},()=>[0,40,0,255]).flat()).toString('base64')};
  await load(baseline);
  // Preserve existing unsaved edits without asking to discard the document.
  await workspace.locator('[data-pixel-layer-name]').fill('Edited Base');await workspace.locator('[data-pixel-layer-name]').press('Enter');
  const before={...baseline,layer:{...baseline.layer,name:'Edited Base'}};assert.equal(await workspace.getAttribute('data-pixel-dirty'),'true');
  await open(true);await layer();assert.equal(await field('width').inputValue(),'2');assert.equal(await field('height').inputValue(),'1');
  assert.equal(await field('layer-x').inputValue(),'1');assert.equal(await field('layer-y').inputValue(),'1');
  const preview=dialog.locator('[data-pixel-import-preview]');
  assert.deepEqual(await preview.evaluate(c=>[c.width,c.height,...c.getContext('2d').getImageData(1,1,1,1).data]),[4,3,255,0,0,255]);
  assert.deepEqual(await preview.evaluate(c=>[...c.getContext('2d').getImageData(0,0,1,1).data]),[0,40,0,255]);
  await field('layer-x').fill('3');await page.waitForFunction(()=>document.querySelector('[data-pixel-import-status]')?.textContent.includes('fit inside'));
  assert(await apply.isDisabled());await dialog.locator('[data-pixel-import-action=center]').click();await ready();
  await cancel();assert.deepEqual(await source(),before);
  await workspace.locator('[data-pixel-layer-name]').fill('Unexported Base');await workspace.locator('[data-pixel-layer-name]').press('Enter');before.layer.name='Unexported Base';
  await open();await layer();await field('layer-x').fill('2');await field('layer-y').fill('2');await ready();
  await page.locator('[data-placement-language]').evaluate(e=>{e.value='ko';e.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.setViewportSize({width:390,height:844});assert.equal(await apply.textContent(),'레이어 추가');
  assert.equal(await field('destination').getAttribute('aria-label'),'가져오기 방식');
  assert(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await field('destination').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(run,mode+'-pixel-import-layer-ko.png'),fullPage:true});
  await apply.click();await dialog.waitFor({state:'detached'});assert.equal(await page.locator('[data-pixel-action=confirm-cancel]').count(),0);
  await page.setViewportSize({width:1280,height:900});await page.locator('[data-placement-language]').selectOption('en');
  const added=await source();assert.equal(added.name,before.name);assert.equal(added.version,2);assert.deepEqual(added.palette,before.palette);assert.deepEqual(added.frame,before.frame);
  assert.equal(added.layers.length,2);assert.equal(added.layers[0].rgba,before.rgba);assert.equal(added.layers[0].name,before.layer.name);assert.equal(added.layers[1].name,'overlay');
  const pixels=Buffer.from(added.layers[1].rgba,'base64');assert(pixels.slice(0,40).every(n=>n===0));assert.deepEqual([...pixels.slice(40)], [...rgba]);
  await workspace.locator('[data-pixel-action=undo]').click();assert.deepEqual(await source(),before,'one Undo removes both the layer and imported pixels');
  await workspace.locator('[data-pixel-action=redo]').click();assert.deepEqual(await source(),added);
  await load(added);assert.deepEqual(await source(),added,'new layer source round-trips');
  await page.screenshot({path:resolve(run,mode+'-pixel-import-layer-result.png'),fullPage:true});
  const animated=pixelCapacitySource({count:3,side:4,layers:1,version:7});animated.tags[0].direction='reverse';
  await load(animated);await workspace.locator('[data-pixel-frame-select="frame-1"]').click();
  await open();await layer();assert.match(await dialog.locator('[data-pixel-import-target]').textContent(),/frame-1/);
  await apply.click();await dialog.waitFor({state:'detached'});
  const animation=await source();assert.deepEqual(animation.tags,animated.tags);assert.equal(animation.version,7);assert.deepEqual(animation.palette,animated.palette);
  for(let i=0;i<3;i++) {
    assert.deepEqual(animation.frames[i].cels.slice(0,-1),animated.frames[i].cels);assert.equal(animation.frames[i].durationMs,animated.frames[i].durationMs);
    const bytes=Buffer.from(animation.frames[i].cels.at(-1).rgba,'base64');
    if(i!==1)assert(bytes.every(v=>v===0));else assert.deepEqual([...bytes.slice(20,28)],[...rgba]);
  }
  await workspace.locator('[data-pixel-action=undo]').click();assert.deepEqual(await source(),animated);
  // A queued frame-selection callback invalidates the importer even without a revision edit.
  await open();await layer();const oldApply=await apply.elementHandle();
  await workspace.locator('[data-pixel-frame-select="frame-0"]').evaluate(e=>e.click());
  assert.equal(await dialog.count(),0);await oldApply.evaluate(e=>e.click());await oldApply.dispose();assert.deepEqual(await source(),animated);
  // Changing the owning workspace cancels the layer preview as well as new-document import.
  await open();await layer();await workspace.locator('[data-pixel-action=back]').evaluate(e=>e.click());assert.equal(await dialog.count(),0);
  await page.locator('[role=tab][aria-controls=placement-pixel-workspace]').click();assert.deepEqual(await source(),animated);
  const fixed={...original,version:4,atlas:{texture:'sheet',frames:[{id:'only',frame:{u0:0,v0:0,u1:1,v1:1}}]}};
  for(const value of [pixelCapacitySource({count:1,side:2,layers:8,tagged:false}),fixed]) {
    await load(value);await open();assert(await field('destination').locator('option[value=layer]').evaluate(e=>e.disabled));
    assert.match(await dialog.locator('[data-pixel-import-target]').textContent(),/limit|fixed/);await cancel();assert.deepEqual(await source(),value);
  }
  await load(original);
  return {compositedPreview:true,placementBounds:true,dirtyDocumentPreserved:true,oneUndoRedo:true,roundTrip:true,currentFrameOnly:true,staleFrameGuard:true,dropRoute:true,tagsPreserved:true,layerAndAtlasLimits:true,tabCancellation:true,koreanNarrow:true};
}
