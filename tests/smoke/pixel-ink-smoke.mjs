import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {clickPlacementToolAction,showPlacementBottom} from './placement-panel-navigation.mjs';

export async function smokePixelInk(page,mode,run) {
  await showPlacementBottom(page,'assets');await clickPlacementToolAction(page.locator('[data-pixel-action="new"]'));
  const dialog=page.locator('dialog[open]');await dialog.getByLabel('Pixel Width',{exact:true}).fill('8');await dialog.getByLabel('Pixel Height',{exact:true}).fill('8');
  await dialog.getByLabel('Pixel Name',{exact:true}).fill('ink-smoke');await clickPlacementToolAction(dialog.locator('[data-pixel-action="create"]'));
  const workspace=page.locator('#placement-pixel-workspace'),canvas=workspace.locator('[data-pixel-canvas]'),picker=workspace.locator('[data-pixel-shape-tool]');
  const action=key=>workspace.locator('[data-pixel-action="'+key+'"]');let serial=0;
  async function source() {
    const menu=workspace.locator('.placement-pixel-export-menu');if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();
    const waiting=page.waitForEvent('download');await clickPlacementToolAction(action('export-source'));const file=await waiting,path=resolve(run,mode+'-ink-'+serial+++'.pixel.json');await file.saveAs(path);await menu.locator('summary').click();return JSON.parse(await readFile(path,'utf8'));
  }
  async function point(x,y){await page.evaluate(()=>new Promise(requestAnimationFrame));return canvas.evaluate((e,p)=>{const r=e.getBoundingClientRect(),z=Number(e.dataset.pixelZoom);return{x:r.x+Number(e.dataset.pixelOriginX)+(p.x+.5)*z,y:r.y+Number(e.dataset.pixelOriginY)+(p.y+.5)*z};},{x,y});}
  async function drag(a,b,end=true){const p=await point(...a),q=await point(...b);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(q.x,q.y);if(end)await page.mouse.up();}
  const initial=await source(),scene=await page.evaluate(()=>({patch:window.ferrumPlacementViewerState.draftPatch,history:window.ferrumPlacementViewerHistory}));
  const colors=async()=>{await workspace.locator('[data-pixel-color]').fill('#ff0000');await workspace.locator('[data-pixel-alpha]').fill('128');await workspace.locator('[data-pixel-alpha]').dispatchEvent('input');
    await workspace.locator('[data-pixel-secondary]').fill('#0000ff');await workspace.locator('[data-pixel-secondary]').dispatchEvent('change');await workspace.locator('[data-pixel-secondary-alpha]').fill('64');await workspace.locator('[data-pixel-secondary-alpha]').dispatchEvent('change');};
  await canvas.focus();await page.keyboard.press('d');assert.equal(await picker.inputValue(),'dither');await colors();
  const size=workspace.locator('[data-pixel-brush-size]');await size.fill('8');await size.dispatchEvent('change');await drag([3,3],[3,3]);
  let value=await source(),bytes=Buffer.from(value.rgba,'base64'),blue=0;
  for(let i=0;i<bytes.length;i+=4){const p=[...bytes.subarray(i,i+4)];if(p[2]===255){assert.deepEqual(p,[0,0,255,64]);blue++;}else assert.deepEqual(p,[255,0,0,128]);}
  assert.equal(blue,32);await clickPlacementToolAction(action('undo'));assert.deepEqual(await source(),initial);
  assert(await action('undo').isDisabled());await clickPlacementToolAction(action('redo'));assert.deepEqual(await source(),value);await clickPlacementToolAction(action('undo'));
  for(const cancel of ['Escape','pointercancel','blur']) {
    await drag([3,3],[4,3],false);assert(await action('export-source').isDisabled());
    if(cancel==='Escape')await page.keyboard.press('Escape');
    else if(cancel==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    else await canvas.dispatchEvent('pointercancel',{pointerId:1});
    await page.mouse.up();assert.deepEqual(await source(),initial);assert(await action('redo').isEnabled());
  }
  await canvas.focus();await page.keyboard.press('j');assert.equal(await picker.inputValue(),'gradient');
  const gradient=workspace.locator('[data-pixel-gradient-mode]');await gradient.selectOption('colors');await drag([0,0],[7,0],false);
  assert.equal(await canvas.getAttribute('data-pixel-shape-pending'),'true');assert(await action('export-source').isDisabled());
  await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await source(),initial);assert(await action('redo').isEnabled());
  await drag([0,0],[7,0]);value=await source();bytes=Buffer.from(value.rgba,'base64');assert.deepEqual([...bytes.subarray(0,4)],[255,0,0,128]);assert.deepEqual([...bytes.subarray(28,32)],[0,0,255,64]);
  assert.deepEqual([...bytes.subarray(12,16)],[146,0,109,101]);await clickPlacementToolAction(action('undo'));assert.deepEqual(await source(),initial);
  await gradient.selectOption('dither');await drag([0,0],[7,0]);bytes=Buffer.from((await source()).rgba,'base64');
  for(let i=0;i<bytes.length;i+=4)assert(bytes[i]===255&&bytes[i+2]===0||bytes[i]===0&&bytes[i+2]===255);await clickPlacementToolAction(action('undo'));
  await gradient.selectOption('palette');await drag([0,0],[7,0]);bytes=Buffer.from((await source()).rgba,'base64');
  const expected=hex=>[...Buffer.from(hex.slice(1),'hex')];assert.deepEqual([...bytes.subarray(0,4)],expected(initial.palette[0]));assert.deepEqual([...bytes.subarray(28,32)],expected(initial.palette.at(-1)));await clickPlacementToolAction(action('undo'));
  await clickPlacementToolAction(action('tool-select'));await drag([2,2],[3,3]);await picker.selectOption('gradient');await gradient.selectOption('colors');await drag([0,0],[7,0]);
  bytes=Buffer.from((await source()).rgba,'base64');assert.equal(bytes.filter((v,i)=>i%4===3&&v>0).length,4);await clickPlacementToolAction(action('undo'));
  await canvas.focus();await page.keyboard.press('Escape');await drag([0,0],[7,0],false);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();assert.deepEqual(await source(),initial);
  await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:840});
  assert.equal(await picker.getAttribute('aria-label'),'도형·채색 도구');assert.equal(await gradient.getAttribute('aria-label'),'그라데이션 방식');assert(await workspace.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:resolve(run,mode+'-pixel-ink-ko-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-placement-language]').selectOption('en');await clickPlacementToolAction(action('tool-pencil'));
  assert.deepEqual(await source(),initial);assert.deepEqual(await page.evaluate(()=>({patch:window.ferrumPlacementViewerState.draftPatch,history:window.ferrumPlacementViewerHistory})),scene);
  return {ditherSourceColors:true,ditherRollback:true,gradientModes:3,previewCancel:true,oneUndo:true,selectionProtected:true,blurRollback:true,localeAndNarrow:true,noSceneEdit:true};
}
