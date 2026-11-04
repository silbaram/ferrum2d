import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {decodePng} from '../../scripts/tools/pack-textures.mjs';
import {pixelCapacitySource} from './pixel-capacity-fixture.mjs';
import {showPlacementBottom,clickPlacementToolAction} from './placement-panel-navigation.mjs';

/** Real controls and downloads; optional real Rust save/runtime verification. */
export async function smokePixelOpacity(page,mode,run,verify) {
  await showPlacementBottom(page,'assets');
  const workspace=page.locator('#placement-pixel-workspace'),button=workspace.locator('[data-pixel-layer-opacity]');
  const dialog=page.locator('[data-pixel-opacity-dialog]'),number=dialog.locator('[data-pixel-opacity-value]');
  const apply=dialog.locator('[data-pixel-opacity-apply]'),cancel=dialog.locator('[data-pixel-opacity-cancel]');
  const action=k=>workspace.locator('[data-pixel-action="'+k+'"]');let serial=0;
  async function load(value){await page.locator('[data-pixel-file]').setInputFiles({name:'opacity.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});await workspace.waitFor({state:'visible'});}
  async function exported(kind='export-source'){
    const menu=workspace.locator('.placement-pixel-export-menu');if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();
    const waiting=page.waitForEvent('download');await clickPlacementToolAction(action(kind));const file=await waiting,path=join(run,mode+'-opacity-'+serial+++(kind==='export-png'?'.png':'.pixel.json'));await file.saveAs(path);
    await menu.locator('summary').click();return readFile(path);
  }
  const source=async()=>JSON.parse(await exported());
  const legacy={format:'ferrum2d.pixel-document',version:1,name:'legacy-opacity',width:1,height:1,colorSpace:'srgb',palette:[],layer:{id:'base',name:'Base'},frame:{id:'idle',durationMs:100},rgba:Buffer.from([255,0,0,255]).toString('base64')};
  await load(legacy);await button.click();await apply.click();assert.deepEqual(await source(),legacy,'255 no-op keeps legacy source');
  await button.click();await number.fill('50');assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false');
  await number.dispatchEvent('keydown',{code:'Enter',key:'Enter',isComposing:true,bubbles:true});assert.equal(await dialog.count(),1,'IME confirmation does not apply opacity');assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false');
  assert.deepEqual(await dialog.locator('canvas').evaluate(e=>[...e.getContext('2d').getImageData(0,0,1,1).data]),[255,0,0,128]);
  assert(await dialog.evaluate(e=>{const data=new DataTransfer();data.items.add(new File(['unused'],'drop.png',{type:'image/png'}));return !e.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));}),'dropping a file on the modal cannot navigate or replace the preview');
  await cancel.click();assert.deepEqual(await source(),legacy);
  await button.click();await number.fill('0');
  await page.evaluate(()=>{const retained=document.querySelector('[data-pixel-opacity-apply]'),open=document.querySelector('[data-pixel-layer-opacity]');window.pixelOpacityLateApply=()=>{retained.onclick?.(new MouseEvent('click'));open.onclick?.(new MouseEvent('click'));};document.querySelector('[data-pixel-action=back]').click();});
  await workspace.waitFor({state:'hidden'});await page.evaluate(()=>window.pixelOpacityLateApply());assert.equal(await dialog.count(),0,'suspending closes the preview and hidden controls cannot reopen it');
  await page.locator('[role=tab][aria-controls=placement-pixel-workspace]').click();await workspace.waitFor({state:'visible'});assert.deepEqual(await source(),legacy);
  await button.click();await number.fill('101');assert(await apply.isDisabled());await number.fill('50');
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert.deepEqual(await source(),legacy);
  await button.click();await number.fill('50');await apply.click();assert.equal(await workspace.getAttribute('data-pixel-dirty'),'true');
  const half=await source();assert.equal(half.version,8);assert.equal(half.layers[0].opacity,128);assert.equal(half.frames[0].cels[0].rgba,legacy.rgba);
  await action('undo').click();assert.deepEqual(await source(),legacy);await action('redo').click();assert.deepEqual(await source(),half);
  for(const [percent,opacity] of [['0.39',1],['99.61',254]]) {
    await button.click();await number.fill(percent);await apply.click();
    assert.equal(await button.textContent(),'Normal Blend · '+percent+'%','rounded byte opacity must not display as an invisible or opaque endpoint');
    assert.equal((await source()).layers[0].opacity,opacity);
  }
  await load(half);
  await workspace.locator('[data-pixel-layer-action=add]').click();const layered=await source();
  await workspace.locator('[data-pixel-layer-select=base]').click();
  await button.click();await number.fill('25.1');await apply.click();assert.equal(await workspace.getAttribute('data-pixel-dirty'),'true');
  await button.click();await number.fill('50.2');await apply.click();assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false','inverse opacity edits return a v8 document with a new layer to its saved state');
  assert.deepEqual(await source(),layered);await load(half);
  await workspace.locator('[data-pixel-layer-locked=base]').check();assert(await button.isDisabled());await button.dispatchEvent('click');assert.equal(await dialog.count(),0);
  await workspace.locator('[data-pixel-layer-locked=base]').uncheck();await source();
  // Clear detaches the open modal; a retained Apply cannot affect a reopened document.
  await button.click();await number.fill('0');
  await page.evaluate(()=>{const retained=document.querySelector('[data-pixel-opacity-apply]');window.pixelOpacityLateApply=()=>retained.onclick?.(new MouseEvent('click'));document.querySelector('[data-placement-close-document="ferrum:pixel-document"]').click();});
  await workspace.waitFor({state:'hidden'});assert.equal(await dialog.count(),0);
  await load(legacy);await page.evaluate(()=>window.pixelOpacityLateApply());assert.deepEqual(await source(),legacy);
  const initial=pixelCapacitySource({side:16,count:2,layers:2,version:7});initial.name='opacity-animated';initial.layers[1].visible=true;
  initial.tags[0].direction='reverse';initial.tags[0].frameIds.reverse();
  initial.frames.forEach((frame,i)=>{
    frame.cels[0].rgba=Buffer.from(Array.from({length:256},()=>i?[255,0,0,255]:[0,0,255,255]).flat()).toString('base64');
    frame.cels[1].rgba=Buffer.from(Array.from({length:256},()=>[255,255,255,128]).flat()).toString('base64');
  });
  await load(initial);await workspace.locator('[data-pixel-layer-select=layer-1]').click();await button.click();
  await dialog.locator('[data-pixel-opacity-slider]').fill('50');
  const dirty=await workspace.getAttribute('data-pixel-dirty');assert.equal(dirty,'false');
  await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:844});
  assert.equal(await number.getAttribute('aria-label'),'불투명도 (%)');const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=390);
  await page.screenshot({path:join(run,mode+'-opacity-ko.png'),fullPage:true});await apply.click();
  await page.setViewportSize({width:1280,height:900});await page.locator('[data-placement-language]').selectOption('en');
  const result=await source();assert.equal(result.version,8);assert.deepEqual(result.layers.map(l=>l.opacity),[255,128]);
  assert.deepEqual(result.frames,initial.frames);assert.deepEqual(result.tags,initial.tags);
  const png=decodePng(await exported('export-png'));assert.deepEqual([...png.pixels.slice(0,4)],[64,64,255,255]);
  await button.click();await number.fill('0');
  await page.evaluate(()=>{const retained=document.querySelector('[data-pixel-opacity-apply]');window.pixelOpacityLateApply=()=>retained.onclick?.(new MouseEvent('click'));document.querySelector('[data-pixel-frame-select="frame-1"]').click();});
  assert.equal(await dialog.count(),0);await page.evaluate(()=>window.pixelOpacityLateApply());assert.deepEqual(await source(),result,'queued frame selection invalidates the old preview');
  await workspace.locator('[data-pixel-frame-action=play]').click();assert(await button.isDisabled());await button.dispatchEvent('click');assert.equal(await dialog.count(),0);await workspace.locator('[data-pixel-frame-action=play]').click();
  const merge=workspace.locator('.placement-pixel-layer-merge');await merge.locator('summary').click();await merge.locator('[data-pixel-layer-merge=down]').click();
  const merged=await source();assert.equal(merged.layers[0].opacity,255);assert.deepEqual(decodePng(await exported('export-png')),png);
  await action('undo').click();assert.deepEqual(await source(),result);
  let game,id,tagged,saved=result;
  async function applyAndVerify() {
    await clickPlacementToolAction(action('apply'));
    const approval=page.locator('[data-pixel-action=confirm-migrate]');if(await approval.isVisible())await approval.click();
    await page.waitForFunction(()=>document.querySelector('#placement-pixel-workspace').dataset.pixelBusy==='false');
    const bundle=JSON.parse(await exported('export-assets')),texture=bundle.sceneDocument.sceneComposition.fragments.main.instances[0].props.components.visual.texture;
    id=bundle.assets.find(asset=>asset.id===texture).id;game=await verify(bundle);
    assert.equal(game.directionPlayback.playingState,1);assert.equal(game.directionPlayback.clips[0].frames,2);
  }
  if(verify){
    await applyAndVerify();tagged={id,source:result,game};
    saved=structuredClone(result);for(const key of ['tags','initialTag','nextClipId'])delete saved[key];
    await load(saved);await applyAndVerify();assert.equal(game.directionPlayback.clips[0].direction,'forward');
  }
  return {source:saved,...(id?{id,game,tagged,untaggedPlayback:true}:{}),purePreview:true,legacyNoOp:true,cancelAndEscape:true,suspendCancels:true,rawPixelsPreserved:true,undoRedo:true,lockedAndPlayingGuards:true,lateApplyIgnored:true,frameSwitchInvalidates:true,dialogDropGuard:true,pngAndMergeParity:true,koreanNarrow:true};
}
