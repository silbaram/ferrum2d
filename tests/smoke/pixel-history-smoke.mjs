import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pixelCapacitySource} from './pixel-capacity-fixture.mjs';
import {showPlacementBottom,clickPlacementToolAction} from './placement-panel-navigation.mjs';

/** Maximum document through real pointer edits and UI Undo, with exact source comparison. */
export async function smokePixelHistory(page,mode,run){
  await showPlacementBottom(page,'assets');
  const original=pixelCapacitySource({side:64,count:64,layers:8}),expected=structuredClone(original);
  const workspace=page.locator('#placement-pixel-workspace'),action=name=>workspace.locator('[data-pixel-action="'+name+'"]');
  await page.locator('[data-pixel-file]').setInputFiles({name:'history.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))});
  await workspace.waitFor({state:'visible'});
  await workspace.locator('[data-pixel-frame-select="frame-63"]').click();
  await clickPlacementToolAction(action('tool-pencil'));
  await workspace.locator('[data-pixel-color]').fill('#ff0000');
  const alpha=workspace.locator('[data-pixel-alpha]');await alpha.fill('255');await alpha.dispatchEvent('input');
  const canvas=workspace.locator('[data-pixel-canvas]');
  const rgba=Buffer.from(expected.frames[63].cels[0].rgba,'base64');
  for(let x=1;x<=4;x++){
    const point=await canvas.evaluate((e,x)=>{const r=e.getBoundingClientRect(),z=Number(e.dataset.pixelZoom);return{x:r.x+Number(e.dataset.pixelOriginX)+(x+.5)*z,y:r.y+Number(e.dataset.pixelOriginY)+1.5*z};},x);
    await page.mouse.click(point.x,point.y);rgba.set([255,0,0,255],(64+x)*4);
  }
  expected.frames[63].cels[0].rgba=rgba.toString('base64');let serial=0;
  async function source(){
    const menu=workspace.locator('.placement-pixel-export-menu');if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();
    const waiting=page.waitForEvent('download');await clickPlacementToolAction(action('export-source'));const file=await waiting,path=join(run,mode+'-history-'+serial+++'.pixel.json');await file.saveAs(path);await menu.locator('summary').click();return JSON.parse(await readFile(path,'utf8'));
  }
  assert.deepEqual(await source(),expected);
  for(let i=0;i<4;i++){assert(await action('undo').isEnabled());await action('undo').click();}
  assert.deepEqual(await source(),original,'maximum source must retain more than the old single snapshot');
  for(let i=0;i<4;i++)await action('redo').click();assert.deepEqual(await source(),expected);
  await workspace.locator('[data-pixel-layer-appearance]').click();
  await page.locator('[data-pixel-opacity-value]').fill('50');await page.locator('[data-pixel-opacity-apply]').click();
  assert.equal((await source()).layers[0].opacity,128);await action('undo').click();assert.deepEqual(await source(),expected,'snapshot fallback preserves the preceding pixel edits');
  return {maximumCelBytes:64*64*64*8*4,pointerEdits:4,undoRedoExact:true,otherCelsPreserved:true,snapshotFallback:true};
}
