import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {showPlacementBottom} from './placement-panel-navigation.mjs';

/** Actual input/preview/source/Undo checks, shared by the full authoring gate. */
export async function smokePixelDrawing(page,mode,run) {
  await showPlacementBottom(page,'assets');await page.locator('[data-pixel-action="new"]').click();
  const dialog=page.locator('dialog[open]');await dialog.getByLabel('Pixel Width',{exact:true}).fill('8');await dialog.getByLabel('Pixel Height',{exact:true}).fill('8');
  await dialog.getByLabel('Pixel Name',{exact:true}).fill('drawing-smoke');await dialog.locator('[data-pixel-action="create"]').click();
  const workspace=page.locator('#placement-pixel-workspace'),canvas=workspace.locator('[data-pixel-canvas]');await workspace.waitFor({state:'visible'});
  const action=name=>workspace.locator('[data-pixel-action="'+name+'"]'),size=workspace.locator('[data-pixel-brush-size]'),picker=workspace.locator('[data-pixel-shape-tool]');
  const option=key=>workspace.locator('[data-pixel-drawing="'+key+'"]');
  let count=0;
  async function source() {
    const menu=workspace.locator('.placement-pixel-export-menu');if(await menu.getAttribute('open')===null)await menu.locator('summary').click();
    const waiting=page.waitForEvent('download');await action('export-source').click();const file=await waiting,path=resolve(run,mode+'-drawing-'+count+++'.pixel.json');await file.saveAs(path);await menu.locator('summary').click();
    return JSON.parse(await readFile(path,'utf8'));
  }
  async function point(x,y) {await page.evaluate(()=>new Promise(requestAnimationFrame));return canvas.evaluate((e,p)=>{const r=e.getBoundingClientRect(),z=Number(e.dataset.pixelZoom);return{x:r.x+Number(e.dataset.pixelOriginX)+(p.x+.5)*z,y:r.y+Number(e.dataset.pixelOriginY)+(p.y+.5)*z};},{x,y});}
  async function drag(a,b,{end=true,shift=false}={}) {
    const start=await point(...a),finish=await point(...b);if(shift)await page.keyboard.down('Shift');await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(finish.x,finish.y);
    if(end)await page.mouse.up();if(shift)await page.keyboard.up('Shift');
  }
  const countPixels=s=>Buffer.from(s.rgba,'base64').filter((n,i)=>i%4===3&&n).length;
  const initial=await source(),scene=await page.evaluate(()=>({patch:window.ferrumPlacementViewerState.draftPatch,history:window.ferrumPlacementViewerHistory}));
  await workspace.locator('[data-pixel-color]').fill('#ff0000');await workspace.locator('[data-pixel-alpha]').fill('128');await workspace.locator('[data-pixel-alpha]').dispatchEvent('input');
  await size.fill('3');await size.dispatchEvent('change');await drag([3,3],[4,3]);let painted=await source();assert.equal(countPixels(painted),12);
  for(let i=0,bytes=Buffer.from(painted.rgba,'base64');i<bytes.length;i+=4)if(bytes[i+3])assert.deepEqual([...bytes.subarray(i,i+4)],[255,0,0,128]);
  await action('undo').click();assert.deepEqual(await source(),initial);assert(await action('undo').isDisabled());
  await size.fill('1');await size.dispatchEvent('change');await option('mirrorX').check();await option('mirrorY').check();await drag([1,2],[1,2]);painted=await source();assert.equal(countPixels(painted),4);
  for(const [x,y]of [[1,2],[6,2],[1,5],[6,5]])assert.equal(Buffer.from(painted.rgba,'base64')[(y*8+x)*4+3],128);
  await action('undo').click();await option('mirrorX').uncheck();await option('mirrorY').uncheck();
  await picker.selectOption('rectangle');await drag([1,1],[5,4],{end:false});
  assert.equal(await canvas.getAttribute('data-pixel-shape-pending'),'true');assert(await action('export-source').isDisabled());assert(await workspace.locator('[data-pixel-frame-action="add"]').isDisabled());
  await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await source(),initial);assert(await action('redo').isEnabled(),'cancel preserves old Redo');
  await drag([1,1],[5,4]);assert.equal(countPixels(await source()),14);await action('undo').click();
  await option('filled').check();await drag([1,1],[5,4]);assert.equal(countPixels(await source()),20);await action('undo').click();
  await picker.selectOption('ellipse');await drag([1,1],[4,2],{shift:true});assert.equal(countPixels(await source()),12);await action('undo').click();
  await picker.selectOption('line');await drag([0,0],[7,7]);assert.equal(countPixels(await source()),8);await action('undo').click();
  await picker.selectOption('rectangle');await drag([1,1],[4,4],{end:false});await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();assert.deepEqual(await source(),initial);
  await action('tool-select').click();await drag([2,2],[3,3]);await action('tool-pencil').click();
  assert.deepEqual(JSON.parse(await canvas.getAttribute('data-pixel-selection')),{x:2,y:2,width:2,height:2});
  await size.fill('32');await size.dispatchEvent('change');await drag([3,3],[3,3]);assert.equal(countPixels(await source()),4);await action('undo').click();
  await canvas.focus();await page.keyboard.press('Escape');await action('tool-select').click();await drag([2,2],[3,3]);await action('tool-fill').click();await drag([2,2],[2,2]);assert.equal(countPixels(await source()),4);await action('undo').click();
  await canvas.focus();await page.keyboard.press('Escape');await action('tool-pencil').click();await size.fill('');await size.dispatchEvent('change');assert.equal(await size.inputValue(),'32');
  await size.fill('1');await size.dispatchEvent('change');await picker.selectOption('ellipse');
  await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:840});
  assert.equal(await picker.getAttribute('aria-label'),'도형 도구');assert(await workspace.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:resolve(run,mode+'-pixel-drawing-ko-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-placement-language]').selectOption('en');
  await action('tool-pencil').click();await workspace.locator('[data-pixel-alpha]').fill('255');await workspace.locator('[data-pixel-alpha]').dispatchEvent('input');
  assert.deepEqual(await source(),initial);assert.deepEqual(await page.evaluate(()=>({patch:window.ferrumPlacementViewerState.draftPatch,history:window.ferrumPlacementViewerHistory})),scene);
  return{squareBrush:true,alphaReplacement:true,mirrors:true,shapePreviewReadonly:true,oneUndo:true,outlineAndFill:true,shiftCircle:true,line:true,cancelAndBlur:true,selectionMaskAndFill:true,invalidSizeRestored:true,localeAndNarrow:true,noSceneEdit:true};
}
