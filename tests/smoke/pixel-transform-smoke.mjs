import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {showPlacementBottom,clickPlacementToolAction} from './placement-panel-navigation.mjs';
import {decodePng} from '../../scripts/tools/pack-textures.mjs';

export async function smokePixelTransform(page,mode,run) {
  await showPlacementBottom(page,'assets');
  const workspace=page.locator('#placement-pixel-workspace'),action=k=>workspace.locator('[data-pixel-action="'+k+'"]');
  const canvas=workspace.locator('[data-pixel-canvas]'),dialog=page.locator('[data-pixel-transform-dialog]'),angle=dialog.locator('[data-pixel-transform=angle]');
  const x=dialog.locator('[data-pixel-transform=x]'),y=dialog.locator('[data-pixel-transform=y]'),apply=dialog.locator('[data-pixel-transform-apply]');
  const raw=Buffer.alloc(8*8*4);for(let i=0;i<64;i++)raw.set([i*3,255-i*3,40,255],i*4);
  const original={format:'ferrum2d.pixel-document',version:1,name:'free-transform',width:8,height:8,colorSpace:'srgb',palette:[],layer:{id:'base',name:'Base'},frame:{id:'idle',durationMs:100},rgba:raw.toString('base64')};
  let serial=0;
  async function load(value){const dirty=await workspace.getAttribute("data-pixel-dirty")==="true";
    // Visibility must transition after the asynchronous File.text()/replacement, not match the old editor.
    if(await workspace.isVisible()){await action('back').click();await workspace.waitFor({state:'hidden'});}
    await page.locator('[data-pixel-file]').setInputFiles({name:'transform.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});if(dirty)await clickPlacementToolAction(page.locator('dialog[open] [data-pixel-action="confirm-discard"]'));await workspace.waitFor({state:'visible'});
  }
  async function exported(kind='export-source'){
    const menu=workspace.locator('.placement-pixel-export-menu');if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();
    const wait=page.waitForEvent('download');await clickPlacementToolAction(action(kind));const file=await wait,path=join(run,mode+'-transform-'+serial+++(kind==='export-png'?'.png':'.pixel.json'));await file.saveAs(path);await menu.locator('summary').click();return readFile(path);
  }
  const source=async()=>JSON.parse(await exported());
  async function selectAll(){await action('tool-select').click();await canvas.focus();await page.keyboard.press('Control+a');}
  async function open(){const menu=workspace.locator('.placement-pixel-selection details');if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();await action('free-transform').click();await dialog.waitFor({state:'visible'});}
  async function preview(){return dialog.locator('canvas').evaluate(e=>[...e.getContext('2d').getImageData(0,0,e.width,e.height).data]);}
  await load(original);await selectAll();await open();await apply.click();assert.deepEqual(await source(),original);assert(await action('undo').isDisabled());
  await open();await angle.fill('37');const first=await preview();await x.fill('75');assert.equal(await y.inputValue(),'75');await x.fill('100');assert.deepEqual(await preview(),first,'preview never reuses the previous resampled result');
  assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false');await angle.dispatchEvent('keydown',{code:'Enter',key:'Enter',isComposing:true,bubbles:true});assert.equal(await dialog.count(),1);
  await angle.fill('361');assert(await apply.isDisabled());await angle.fill('37');assert(await apply.isEnabled());
  assert(await dialog.evaluate(e=>{const data=new DataTransfer();data.items.add(new File(['unused'],'drop.png',{type:'image/png'}));return !e.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));}));
  await page.evaluate(()=>{const input=document.querySelector('[data-pixel-transform=angle]'),cancel=document.querySelector('[data-pixel-transform-cancel]');window.pixelTransformStaleCancel=()=>{input.oninput?.(new Event('input'));cancel.onclick?.(new MouseEvent('click'));};});
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert.deepEqual(await source(),original);
  await open();await page.evaluate(()=>window.pixelTransformStaleCancel());assert.equal(await dialog.count(),1,'old input and Cancel callbacks cannot close a newly opened session');await angle.fill('90');await apply.click();
  const rotated=Buffer.alloc(raw.length);for(let row=0;row<8;row++)for(let col=0;col<8;col++)raw.copy(rotated,((col*8)+(7-row))*4,(row*8+col)*4,(row*8+col+1)*4);
  assert.equal((await source()).rgba,rotated.toString('base64'),'clockwise rotation has independently calculated pixel positions');
  await action('undo').click();assert.deepEqual(await source(),original);assert(await action('undo').isDisabled());await action('redo').click();assert.equal((await source()).rgba,rotated.toString('base64'));
  await action('undo').click();await selectAll();await open();await angle.fill('31');await dialog.locator('[data-pixel-transform-lock]').uncheck();await x.fill('50');await y.fill('75');await dialog.locator('[data-pixel-transform-sampling]').selectOption('linear');const expected=await preview();
  await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:844});assert.equal(await dialog.getAttribute('aria-label'),'자유 변형');
  const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.height<=844);await page.screenshot({path:join(run,mode+'-transform-ko.png'),fullPage:true});await apply.click();
  await page.setViewportSize({width:1280,height:900});await page.locator('[data-placement-language]').selectOption('en');const transformed=await source();
  assert.deepEqual([...decodePng(await exported('export-png')).pixels],expected);await action('undo').click();assert.deepEqual(await source(),original);await action('redo').click();assert.deepEqual(await source(),transformed);
  await load(original);await selectAll();await canvas.focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('[data-pixel-canvas]').dataset.pixelSelectionPending==='true');assert.equal(await canvas.getAttribute('data-pixel-selection-pending'),'true');
  await open();await angle.fill('25');await dialog.locator('[data-pixel-transform-cancel]').click();assert.equal(await canvas.getAttribute('data-pixel-selection-pending'),'true');await canvas.focus();await page.keyboard.press('Escape');assert.deepEqual(await source(),original);
  await selectAll();await open();await angle.fill('90');
  await page.evaluate(()=>{const retained=document.querySelector('[data-pixel-transform-apply]'),button=document.querySelector('[data-pixel-action=free-transform]');window.pixelTransformLateApply=()=>{retained.onclick?.(new MouseEvent('click'));button.onclick?.(new MouseEvent('click'));};document.querySelector('[data-pixel-action=back]').click();});
  await workspace.waitFor({state:'hidden'});await page.evaluate(()=>window.pixelTransformLateApply());assert.equal(await dialog.count(),0);await page.locator('[role=tab][aria-controls=placement-pixel-workspace]').click();await workspace.waitFor({state:'visible'});assert.deepEqual(await source(),original);
  // A retained callback from a previous frame cannot apply to a newly selected frame.
  const animated={format:original.format,version:3,name:original.name,width:8,height:8,colorSpace:'srgb',palette:[],layers:[{id:'base',name:'Base',visible:true,locked:false}],frames:['a','b'].map(id=>({id,durationMs:100,cels:[{layerId:'base',rgba:original.rgba}]}))};
  await load(animated);await selectAll();await open();await angle.fill('90');
  await page.evaluate(()=>{const retained=document.querySelector('[data-pixel-transform-apply]');window.pixelTransformLateApply=()=>retained.onclick?.(new MouseEvent('click'));document.querySelector('[data-pixel-frame-select=b]').click();});
  assert.equal(await dialog.count(),0);await page.evaluate(()=>window.pixelTransformLateApply());assert.deepEqual(await source(),animated);
  await workspace.locator('[data-pixel-layer-locked=base]').check();await selectAll();const menu=workspace.locator('.placement-pixel-selection details');await menu.locator('summary').click();assert(await action('free-transform').isDisabled());await action('free-transform').dispatchEvent('click');assert.equal(await dialog.count(),0);await menu.locator('summary').click();
  return {purePreview:true,nonCumulative:true,clockwisePixelOracle:true,arbitraryAngleScaleAndLinear:true,undoRedoExact:true,pngParity:true,cancelAndEscape:true,pendingMovePreserved:true,invalidAndLockedGuards:true,dialogDropGuard:true,lateCallbackGuard:true,frameChangeGuard:true,koreanNarrow:true};
}
