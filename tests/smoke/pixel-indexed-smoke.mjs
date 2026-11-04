import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {decodePng} from '../../scripts/tools/pack-textures.mjs';
import {pixelCapacitySource} from './pixel-capacity-fixture.mjs';
import {showPlacementBottom,clickPlacementToolAction} from './placement-panel-navigation.mjs';

/** User-facing mode/palette controls, independent index expectations and actual paired normal generation. */
export async function smokePixelIndexed(page,mode,run,verify) {
  await showPlacementBottom(page,'assets');
  const workspace=page.locator('#placement-pixel-workspace'),action=k=>workspace.locator('[data-pixel-action="'+k+'"]');
  const menu=workspace.locator('.placement-pixel-palette-menu'),colors=menu.locator('[data-pixel-palette-list]'),colorMode=menu.locator('[data-pixel-color-mode]');
  const paletteAction=k=>menu.locator('[data-pixel-palette-action="'+k+'"]'),idle=()=>page.waitForFunction(()=>document.querySelector('#placement-pixel-workspace').dataset.pixelBusy==='false');let serial=0;
  async function open(){if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();}
  async function load(value){const dirty=await workspace.getAttribute("data-pixel-dirty")==="true";if(await workspace.isVisible()){await action('back').click();await workspace.waitFor({state:'hidden'});}await page.locator('[data-pixel-file]').setInputFiles({name:'indexed.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});if(dirty)await clickPlacementToolAction(page.locator('dialog[open] [data-pixel-action="confirm-discard"]'));await workspace.waitFor({state:'visible'});}
  async function exported(kind='export-source'){
    const exports=workspace.locator('.placement-pixel-export-menu');if(!await exports.evaluate(e=>e.open))await exports.locator('summary').click();
    const waiting=page.waitForEvent('download');await clickPlacementToolAction(action(kind));const file=await waiting,path=join(run,mode+'-indexed-'+serial+++(kind==='export-png'?'.png':'.json'));await file.saveAs(path);await exports.locator('summary').click();return readFile(path);
  }
  const source=async()=>JSON.parse(await exported());
  const initial=pixelCapacitySource({side:16,count:2,layers:2,version:9});initial.name='indexed-animation';initial.tags[0].direction='pingpong';
  initial.layers.forEach((layer,i)=>{layer.opacity=255;layer.blendMode='normal';layer.locked=i===1;});
  initial.frames.forEach((frame,i)=>frame.cels.forEach((cel,l)=>{cel.rgba=Buffer.from(Array(256).fill(l?[0,0,255,255]:i?[255,0,0,255]:[0,0,255,255]).flat()).toString('base64');}));
  await load(initial);await open();await colorMode.selectOption('indexed');const saved=await source();
  assert.equal(saved.version,10);assert.deepEqual(saved.palette,['#00000000','#0000ffff','#ff0000ff']);
  for(const [f,frame]of saved.frames.entries())for(const [l,cel]of frame.cels.entries())assert.deepEqual([...Buffer.from(cel.indices,'base64')],Array(256).fill(l?1:f?2:1));
  assert(!('rgba' in saved.frames[0].cels[0]));await action('undo').click();assert.deepEqual(await source(),initial);await action('redo').click();assert.deepEqual(await source(),saved);
  await open();await colors.selectOption({index:1});await workspace.locator('[data-pixel-color]').fill('#00ff00');await open();await paletteAction('update').click();const green=await source();
  assert.equal(green.palette[1],'#00ff00ff');assert.deepEqual(green.frames,saved.frames,'global recoloring preserves index identity including locked hidden layers');assert.deepEqual([...decodePng(await exported('export-png')).pixels.slice(0,4)],[0,255,0,255]);
  await action('undo').click();assert.deepEqual(await source(),saved);
  await open();await colors.selectOption({index:2});await paletteAction('up').click();const reordered=await source();assert.deepEqual(reordered.palette,['#00000000','#ff0000ff','#0000ffff']);assert.equal(Buffer.from(reordered.frames[0].cels[0].indices,'base64')[0],2);assert.deepEqual([...decodePng(await exported('export-png')).pixels.slice(0,4)],[0,0,255,255]);
  await open();await colors.selectOption({index:2});await paletteAction('remove').click();assert.match(await workspace.locator('[data-pixel-status]').textContent(),/Cannot remove/);assert.deepEqual(await source(),reordered);
  await open();await colors.selectOption({index:0});assert(await paletteAction('update').isDisabled());assert(await paletteAction('remove').isDisabled());assert(await paletteAction('down').isDisabled());
  await workspace.locator('[data-pixel-color]').fill('#ffffff');await workspace.locator('[data-pixel-alpha]').fill('255');await open();await paletteAction('add').click();assert.equal((await source()).palette.at(-1),'#ffffffff');await open();await paletteAction('remove').click();assert.deepEqual(await source(),reordered);
  await open();await colorMode.selectOption('rgba');const rgba=await source();assert.equal(rgba.version,9);assert.deepEqual(rgba.frames,initial.frames);assert.deepEqual(rgba.layers,initial.layers);await action('undo').click();assert.deepEqual(await source(),reordered);
  await open();await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:844});await colorMode.scrollIntoViewIfNeeded();assert.equal(await colorMode.getAttribute('aria-label'),'색상 모드');const bounds=await menu.locator(':scope > div').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=390);await page.screenshot({path:join(run,mode+'-indexed-ko.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:900});await page.locator('[data-placement-language]').selectOption('en');if(await menu.evaluate(e=>e.open))await menu.locator('summary').click();
  // Source re-import is the exact index contract, not an RGBA conversion on load.
  await load(reordered);assert.deepEqual(await source(),reordered);
  const normals=workspace.locator('.placement-pixel-normal-menu');if(!await normals.evaluate(e=>e.open))await normals.locator('summary').click();await clickPlacementToolAction(action('normal-generate'));await idle();assert.match(await workspace.locator('[data-pixel-status]').textContent(),/Normals generated/);
  assert.equal(await normals.locator('[data-pixel-normal-status]').getAttribute('data-stale'),'false');
  let id,game;
  if(verify){
    await clickPlacementToolAction(action('normal-apply'));const approval=page.locator('[data-pixel-action=confirm-migrate]');if(await approval.isVisible())await approval.click();await idle();
    const bundle=JSON.parse(await exported('export-assets'));id=bundle.sceneDocument.sceneComposition.fragments.main.instances[0].props.components.visual.texture;
    assert.equal(bundle.assets.find(asset=>asset.id===id).source.version,10);assert(bundle.normalBindings.length>0);game=await verify(bundle);assert.equal(game.directionPlayback.playingState,1);assert.equal(game.directionPlayback.clips[0].frames,2);
  }
  return {source:reordered,...(id?{id,game}:{}),realIndices:true,globalRecolor:true,lockedHiddenIncluded:true,reorderPreservesPixels:true,protectedTransparent:true,usedDeleteRejected:true,unusedAddDelete:true,rgbaConversion:true,exactUndoRedo:true,sourceReopen:true,normalWorker:true,koreanNarrow:true};
}
