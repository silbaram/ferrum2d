import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {showPlacementBottom} from './placement-panel-navigation.mjs';
export async function smokePixelPalette(page,mode,run) {
  await showPlacementBottom(page,'assets');
  const rgba=Buffer.from(Array(16).fill([0,0,255,128]).flat()).toString('base64');
  const original={format:'ferrum2d.pixel-document',version:5,name:'palette-smoke',width:4,height:4,colorSpace:'srgb',palette:['#0000ff80','#11223300','#ffffffff'],
    layers:[{id:'body',name:'Body',visible:true,locked:false},{id:'locked',name:'Locked',visible:true,locked:true},{id:'hidden',name:'Hidden',visible:false,locked:false}],
    frames:['idle','walk'].map(id=>({id,durationMs:100,cels:['body','locked','hidden'].map(layerId=>({layerId,rgba}))})),
    tags:[{id:'idle',name:'Idle',clipId:0,frameIds:['idle','walk'],loop:true}],initialTag:'idle',nextClipId:1};
  await page.locator('[data-pixel-file]').setInputFiles({name:'palette.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))});
  const workspace=page.locator('#placement-pixel-workspace');await workspace.waitFor({state:'visible'});
  const menu=workspace.locator('.placement-pixel-palette-menu');await menu.locator('summary').click();
  const button=key=>menu.locator('[data-pixel-palette-action="'+key+'"]'),action=key=>workspace.locator('[data-pixel-action="'+key+'"]');
  const list=menu.locator('[data-pixel-palette-list]');let serial=0;
  async function source(){const exports=workspace.locator('.placement-pixel-export-menu');await exports.locator('summary').click();const waiting=page.waitForEvent('download');await action('export-source').click();const file=await waiting,path=resolve(run,mode+'-palette-'+serial+++'.pixel.json');await file.saveAs(path);await exports.locator('summary').click();return JSON.parse(await readFile(path,'utf8'));}
  async function color(hex,alpha=128){await workspace.locator('[data-pixel-color]').fill(hex);await workspace.locator('[data-pixel-alpha]').fill(String(alpha));await workspace.locator('[data-pixel-alpha]').dispatchEvent('input');}
  const scene=await page.evaluate(()=>({patch:window.ferrumPlacementViewerState.draftPatch,history:window.ferrumPlacementViewerHistory}));
  await color('#ff0000');await button('add').click();let value=await source();assert.deepEqual(value.palette,[...original.palette,'#ff000080']);assert.deepEqual(value.frames,original.frames);
  await button('up').click();assert.equal((await source()).palette[2],'#ff000080');await button('down').click();
  await color('#00ff00');await button('update').click();assert.equal((await source()).palette[3],'#00ff0080');
  await button('remove').click();assert.deepEqual(await source(),original);
  await list.selectOption({index:0});await color('#ff0000');await menu.locator('[data-pixel-color-scope]').selectOption('document');
  await button('replace').click();let dialog=page.locator('dialog[open]');assert.match(await dialog.textContent(),/32/);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(await source(),original);
  await button('replace').click();await page.locator('[data-pixel-palette-confirm]').click();value=await source();
  assert.deepEqual(value.palette,original.palette);assert.deepEqual(value.layers,original.layers);
  for(let i=0;i<2;i++){assert.deepEqual(value.frames[i].cels.slice(1),original.frames[i].cels.slice(1));assert.deepEqual([...Buffer.from(value.frames[i].cels[0].rgba,'base64').subarray(0,4)],[255,0,0,128]);}
  await action('undo').click();assert.deepEqual(await source(),original);
  const imported=['#0000ff80','#11223300'];
  const paletteFile=colors=>Buffer.from(JSON.stringify({format:'ferrum2d.pixel-palette',version:1,colors}));
  await menu.locator('[data-pixel-palette-file]').setInputFiles({name:'colors.json',mimeType:'application/json',buffer:paletteFile(imported)});
  await page.waitForFunction(()=>document.querySelector('[data-pixel-palette-list]').options.length===2);assert.deepEqual((await source()).palette,imported);
  let waiting=page.waitForEvent('download');await button('export').click();let file=await waiting;const palettePath=resolve(run,mode+'-exported.pixel-palette.json');await file.saveAs(palettePath);assert.deepEqual(JSON.parse(await readFile(palettePath,'utf8')).colors,imported);
  await page.evaluate(()=>{const original=File.prototype.text;window.restorePaletteRead=()=>{File.prototype.text=original;};File.prototype.text=function(){if(this.name==='late-palette.json')return new Promise(resolve=>{window.finishPaletteRead=()=>resolve(JSON.stringify({format:'ferrum2d.pixel-palette',version:1,colors:['#000000ff']}));});return original.call(this);};});
  await menu.locator('[data-pixel-palette-file]').setInputFiles({name:'late-palette.json',mimeType:'application/json',buffer:paletteFile(['#000000ff'])});
  await page.waitForFunction(()=>typeof window.finishPaletteRead==='function');await color('#ff0000');await button('add').click();
  await page.evaluate(async()=>{window.finishPaletteRead();await new Promise(requestAnimationFrame);window.restorePaletteRead();});
  const expected=[...imported,'#ff000080'];assert.deepEqual((await source()).palette,expected);
  await menu.locator('[data-pixel-palette-file]').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});
  await page.waitForFunction(()=>document.querySelector('[data-pixel-status]').textContent.includes('Invalid pixel palette file'));assert.deepEqual((await source()).palette,expected);
  for(let i=1;i<=14;i++)await color('#'+(i*0x10101).toString(16).padStart(6,'0'));
  assert.equal(await menu.locator('[data-pixel-recent-colors] button').count(),12);
  await menu.locator('[data-pixel-palette-file]').setInputFiles({name:'original.json',mimeType:'application/json',buffer:paletteFile(original.palette)});await page.waitForFunction(()=>document.querySelector('[data-pixel-palette-list]').options.length===3);
  await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:840});
  assert.equal(await list.getAttribute('aria-label'),'팔레트 색');assert(await workspace.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:resolve(run,mode+'-pixel-palette-ko-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-placement-language]').selectOption('en');await menu.locator('summary').click();await color('#ff0000',255);
  assert.deepEqual(await source(),original);assert.deepEqual(await page.evaluate(()=>({patch:window.ferrumPlacementViewerState.draftPatch,history:window.ferrumPlacementViewerHistory})),scene);
  return{metadataOnly:true,reorder:true,exactRgbaReplacement:true,hiddenAndLockedProtected:true,cancelReadonly:true,oneUndo:true,importExport:true,lateReadRejected:true,invalidInputPreserved:true,boundedRecents:true,localeAndNarrow:true,noSceneEdit:true};
}
