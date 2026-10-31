import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {showPlacementBottom} from './placement-panel-navigation.mjs';

/** Real resize dialog + CSS-pixel preview, shared with the full authoring CI smoke. */
export async function smokePixelCanvasPreview(page,mode,run) {
  await showPlacementBottom(page,'assets');
  const layers=[{id:'body',name:'Body',visible:true,locked:false},{id:'hidden',name:'Hidden',visible:false,locked:false},{id:'locked',name:'Locked',visible:true,locked:true}];
  const raw=(f,l)=>Buffer.from(Array.from({length:16},(_,i)=>[f?0:255,l*40,i*8,255]).flat());
  const original={format:'ferrum2d.pixel-document',version:5,name:'canvas-preview',width:4,height:4,colorSpace:'srgb',palette:['#ff0000ff'],layers,
    frames:['idle','walk'].map((id,f)=>({id,durationMs:160,cels:layers.map((l,i)=>({layerId:l.id,rgba:raw(f,i).toString('base64')}))})),
    tags:[{id:'tag',name:'Walk',clipId:2,frameIds:['idle','walk'],loop:true}],initialTag:'tag',nextClipId:3};
  const workspace=page.locator('#placement-pixel-workspace'),action=k=>workspace.locator('[data-pixel-action="'+k+'"]');
  const input=page.locator('[data-pixel-file]');
  async function open(value){await input.setInputFiles({name:'canvas.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});await workspace.waitFor({state:'visible'});}
  await open(original);
  let serial=0;
  async function source(){const menu=workspace.locator('.placement-pixel-export-menu');await menu.locator('summary').click();const waiting=page.waitForEvent('download');await action('export-source').click();const download=await waiting,path=resolve(run,mode+'-canvas-'+serial+++'.pixel.json');await download.saveAs(path);await menu.locator('summary').click();return JSON.parse(await readFile(path,'utf8'));}
  const scene=await page.evaluate(()=>({patch:window.ferrumPlacementViewerState.draftPatch,history:window.ferrumPlacementViewerHistory}));
  const preview=workspace.locator('[data-pixel-size-preview]'),pixels=preview.locator('[data-pixel-size-canvas]');
  assert.equal(await pixels.count(),0,'folded preview owns no canvas');
  await preview.locator('summary').click();await pixels.waitFor();
  async function bounds(scale,width=4,height=4){await page.waitForFunction(({scale,width,height})=>{const c=document.querySelector('[data-pixel-size-canvas]');return c&&c.width===width&&c.height===height&&c.getBoundingClientRect().width===width*scale&&c.getBoundingClientRect().height===height*scale;},{scale,width,height});}
  const pixelBytes=()=>pixels.evaluate(c=>[...c.getContext('2d').getImageData(0,0,c.width,c.height).data]);
  await bounds(1);assert.deepEqual(await pixelBytes(),[...raw(0,2)]);
  await preview.locator('select').selectOption('2');await bounds(2);assert.deepEqual(await source(),original);
  const canvas=workspace.locator('[data-pixel-canvas]');await action('tool-pencil').click();await workspace.locator('[data-pixel-color]').fill('#00ff00');
  const point=await canvas.evaluate(c=>{const r=c.getBoundingClientRect(),z=Number(c.dataset.pixelZoom);return{x:r.x+Number(c.dataset.pixelOriginX)+z/2,y:r.y+Number(c.dataset.pixelOriginY)+z/2};});
  // Top visible layer is locked: temporarily hide it using the existing layer view toggle.
  const locked=workspace.locator('[data-pixel-layer-select="locked"]');await locked.click();
  await workspace.locator('[data-pixel-layer-visible="locked"]').uncheck();
  await workspace.locator('[data-pixel-layer-select="body"]').click();
  await page.mouse.click(point.x,point.y);
  await page.waitForFunction(()=>{const c=document.querySelector('[data-pixel-size-canvas]');const p=c?.getContext('2d').getImageData(0,0,1,1).data;return p&&p[0]===0&&p[1]===255;});
  await action('undo').click();await action('undo').click();assert.deepEqual(await source(),original);
  await workspace.locator('[data-pixel-frame-select="walk"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-pixel-size-canvas]')?.getContext('2d').getImageData(0,0,1,1).data[0]===0);
  await workspace.locator('[data-pixel-frame-select="idle"]').click();
  await workspace.locator('[data-pixel-frame-action="play"]').click();
  await page.waitForFunction(()=>document.querySelector('.placement-pixel-frames').dataset.pixelPreviewFrame==='walk'&&document.querySelector('[data-pixel-size-canvas]')?.getContext('2d').getImageData(0,0,1,1).data[0]===0);
  assert(await action('resize-canvas').isDisabled());await workspace.locator('[data-pixel-frame-action="play"]').click();
  assert.deepEqual(await source(),original,'frame/tag preview does not edit source');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal(await pixels.count(),0);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await pixels.waitFor();
  await preview.locator('summary').focus();await page.keyboard.press('Escape');assert.equal(await preview.evaluate(e=>e.open),false);assert.equal(await pixels.count(),0);
  // Resize is global even with a selected locked layer; cancellation/invalid fields are read-only.
  await locked.click();await action('resize-canvas').click();let dialog=page.locator('dialog[open]');
  const field=key=>dialog.locator('[data-pixel-resize="'+key+'"]'),confirm=()=>dialog.locator('[data-pixel-resize-confirm]');
  await field('width').fill('257');assert(await confirm().isDisabled());await field('width').fill('6');await field('height').fill('5');await field('anchor').selectOption('bottom-right');
  assert.equal(await dialog.locator('[data-pixel-resize-preview]').getAttribute('width'),'6');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(await source(),original);
  await action('resize-canvas').click();await field('width').fill('6');await field('height').fill('5');await field('anchor').selectOption('bottom-right');await confirm().click();
  const resized=await source();assert.equal(resized.width,6);assert.equal(resized.height,5);assert.deepEqual(resized.tags,original.tags);assert.deepEqual(resized.layers,original.layers);
  for(let f=0;f<2;f++)for(let l=0;l<3;l++){const bytes=Buffer.from(resized.frames[f].cels[l].rgba,'base64');for(let y=0;y<5;y++)for(let x=0;x<6;x++)assert.deepEqual(bytes.subarray((y*6+x)*4,(y*6+x+1)*4),x>=2&&y>=1?raw(f,l).subarray(((y-1)*4+x-2)*4,((y-1)*4+x-1)*4):Buffer.alloc(4));}
  await preview.locator('summary').click();await bounds(2,6,5);await action('undo').click();await bounds(2);assert.deepEqual(await source(),original);await action('redo').click();await bounds(2,6,5);assert.deepEqual(await source(),resized);
  await action('resize-canvas').click();await field('width').fill('4');await field('height').fill('4');await field('anchor').selectOption('bottom-right');
  const beforeCrop=dialog.locator('[data-pixel-resize-before]');assert(await beforeCrop.isVisible());assert.equal(await beforeCrop.getAttribute('width'),'6');
  assert((await beforeCrop.evaluate(c=>c.getContext('2d').getImageData(0,0,1,1).data[3]))>0,'removed transparent padding is marked in the crop preview');
  await page.screenshot({path:resolve(run,mode+'-pixel-canvas-crop-preview.png'),fullPage:true});
  await confirm().click();assert.deepEqual(await source(),original);
  await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:840});assert.equal(await preview.locator('summary').textContent(),'실제 크기');assert.match(await workspace.locator('[data-pixel-brush-size]').locator('..').textContent(),/크기/);assert(await workspace.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:resolve(run,mode+'-pixel-canvas-preview-ko-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-placement-language]').selectOption('en');
  await action('back').click();assert.equal(await pixels.count(),0);await page.locator('[data-placement-document-key="ferrum:pixel-document"]').click();await pixels.waitFor();
  // Reset releases the old canvas. Fixed atlases explicitly disable resize.
  const atlas={format:original.format,version:4,name:'fixed-preview',width:4,height:4,colorSpace:'srgb',palette:original.palette,layer:{id:'layer',name:'Layer'},frame:{id:'frame',durationMs:100},rgba:raw(0,0).toString('base64'),atlas:{texture:'test',frames:[{id:'left',frame:{u0:0,v0:0,u1:.5,v1:1}},{id:'right',frame:{u0:.5,v0:0,u1:1,v1:1}}]}};
  await open(atlas);assert.equal(await pixels.count(),0);assert(await action('resize-canvas').isDisabled());
  await open(original);assert.equal(await pixels.count(),0);assert.deepEqual(await source(),original);
  assert.deepEqual(await page.evaluate(()=>({patch:window.ferrumPlacementViewerState.draftPatch,history:window.ferrumPlacementViewerHistory})),scene);
  return{resizeAllCels:true,nineAnchorsUnitCovered:true,paddingAndCrop:true,cancelReadonly:true,invalidInputPreserved:true,oneUndoRedo:true,fixedAtlasBlocked:true,cssScale1And2:true,dpr:await page.evaluate(()=>devicePixelRatio),liveEditUndo:true,frameTagClockShared:true,blurAndSuspendReleaseCanvas:true,foldAndResetReleaseCanvas:true,localeAndNarrow:true,noSceneEdit:true};
}
