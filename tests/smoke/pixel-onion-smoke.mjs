import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Sparse frames make real canvas ghosts observable, separately from saved/game PNGs. */
export async function smokePixelOnion(page,mode,run,original,restorePath) {
  const workspace=page.locator('#placement-pixel-workspace'),panel=workspace.locator('.placement-pixel-frames');
  const action=name=>workspace.locator('[data-pixel-action="'+name+'"]');
  const menu=panel.locator('.placement-pixel-onion-menu'),setting=key=>menu.locator('[data-pixel-onion="'+key+'"]');
  const opacity=menu.locator('[data-pixel-onion-opacity]'),canvas=workspace.locator('canvas');
  const ids=['onion-previous','onion-current','onion-next'],base=original.layers[0].id;
  function rgba(points) {const bytes=Buffer.alloc(8*8*4);for(const [x,y,...color]of points)bytes.set(color,(y*8+x)*4);return bytes.toString('base64');}
  const hidden=rgba([[2,5,255,255,255,255]]),colors=[
    rgba([[1,2,30,255,50,255],[3,2,30,255,50,255]]),
    rgba([[3,2,0,0,255,255]]),
    rgba([[5,2,255,30,50,128],[3,2,255,30,50,255]]),
  ];
  const fixture={...structuredClone(original),name:'onion-check',width:8,height:8,
    layers:original.layers.map((layer,i)=>({...layer,visible:i===0,locked:i!==0})),
    frames:ids.map((id,i)=>({id,durationMs:1000,cels:original.layers.map((layer,j)=>({layerId:layer.id,rgba:j===0?colors[i]:hidden}))}))};
  const select=id=>panel.locator('[data-pixel-frame-select="'+id+'"]');
  async function openSettings(){if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();}
  async function exported(kind,suffix) {
    const exports=workspace.locator('.placement-pixel-export-menu');
    if(!await exports.evaluate(e=>e.open))await exports.locator('summary').click();
    const pending=page.waitForEvent('download');await action(kind).click();const download=await pending;
    const path=join(run,mode+'-onion-'+suffix);await download.saveAs(path);
    if(await exports.evaluate(e=>e.open))await exports.locator('summary').click();
    return await readFile(path);
  }
  async function pixels() {
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    return await canvas.evaluate(e=>{
      const rect=e.getBoundingClientRect(),z=Number(e.dataset.pixelZoom),left=Number(e.dataset.pixelOriginX),top=Number(e.dataset.pixelOriginY),ctx=e.getContext('2d');
      return Object.fromEntries(Object.entries({previous:[1,2],next:[5,2],current:[3,2],hidden:[2,5]}).map(([name,[x,y]])=>{
        const px=Math.floor((left+(x+.5)*z)*e.width/rect.width),py=Math.floor((top+(y+.5)*z)*e.height/rect.height);
        if(px<0||px>=e.width||py<0||py>=e.height)throw Error('Onion sample outside canvas');
        return [name,[...ctx.getImageData(px,py,1,1).data]];
      }));
    });
  }
  async function click(x,y) {
    await pixels();const p=await canvas.evaluate((e,p)=>{const r=e.getBoundingClientRect(),z=Number(e.dataset.pixelZoom);return {x:r.x+Number(e.dataset.pixelOriginX)+(p.x+.5)*z,y:r.y+Number(e.dataset.pixelOriginY)+(p.y+.5)*z};},{x,y});
    await page.mouse.click(p.x,p.y);
  }
  async function ghosts(){await pixels();return JSON.parse(await canvas.getAttribute('data-pixel-onion-frames'));}
  await page.locator('[data-pixel-file]').setInputFiles({name:'onion-check.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  await page.waitForFunction(()=>document.querySelector('.placement-pixel-header strong').textContent.startsWith('onion-check'));
  await select(ids[1]).click();const sourceBefore=await exported('export-source','before.pixel.json'),pngBefore=await exported('export-png','before.png');
  const baseline=await pixels();assert.deepEqual(baseline.current,[0,0,255,255]);
  assert(!await setting('enabled').isChecked());assert(await action('undo').isDisabled());assert(await action('redo').isDisabled());
  await openSettings();await setting('enabled').check();assert.equal(await opacity.inputValue(),'30');
  const ghost30=await pixels();assert(ghost30.previous[0]>baseline.previous[0]+40,'previous frame has a coral ghost');
  assert(ghost30.next[1]>baseline.next[1]+12&&ghost30.next[2]>baseline.next[2]+12,'next frame has a cyan ghost with source alpha');
  assert.deepEqual(ghost30.current,baseline.current,'opaque current pixels cover ghosts');assert.deepEqual(ghost30.hidden,baseline.hidden,'hidden layers never contribute ghosts');
  await setting('next').uncheck();assert.deepEqual((await pixels()).next,baseline.next);
  await setting('previous').uncheck();assert.deepEqual(await pixels(),baseline);
  await setting('previous').check();await setting('next').check();
  await opacity.focus();await opacity.press('End');assert.equal(await opacity.inputValue(),'100');assert((await pixels()).previous[0]>ghost30.previous[0]+50);
  await opacity.press('Home');assert.equal(await opacity.inputValue(),'0');assert.deepEqual(await pixels(),baseline);
  await opacity.evaluate(e=>{e.value='50';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await opacity.press('Escape');assert.equal(await menu.evaluate(e=>e.open),false);
  assert(await menu.locator('summary').evaluate(e=>document.activeElement===e),'Escape returns focus to onion summary');
  assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false');assert(await action('undo').isDisabled());
  assert.deepEqual(await exported('export-source','view-only.pixel.json'),sourceBefore);
  assert.deepEqual(await exported('export-png','view-only.png'),pngBefore,'view settings cannot enter PNG output');
  await action('tool-eyedropper').click();await click(1,2);
  assert.equal(await workspace.locator('[data-pixel-alpha]').inputValue(),'0','picker samples the editing frame, never the ghost');
  await workspace.locator('[data-pixel-color]').fill('#ffffff');await workspace.locator('[data-pixel-alpha]').fill('255');await action('tool-pencil').click();await click(1,2);
  const painted=JSON.parse(await exported('export-source','painted.pixel.json')),before=JSON.parse(sourceBefore);
  assert.deepEqual(painted.frames[0],before.frames[0]);assert.deepEqual(painted.frames[2],before.frames[2]);
  const current=Buffer.from(painted.frames[1].cels[0].rgba,'base64');assert.deepEqual([...current.subarray((2*8+1)*4,(2*8+1)*4+4)],[255,255,255,255]);
  assert.deepEqual(painted.frames[1].cels[1],before.frames[1].cels[1]);
  await action('undo').click();assert.deepEqual(await exported('export-source','paint-undo.pixel.json'),sourceBefore);
  await openSettings();await setting('enabled').uncheck();await setting('enabled').check();
  assert(await action('redo').isEnabled(),'view toggles preserve pixel Redo');assert(await action('undo').isDisabled());
  await menu.locator('summary').click();
  const locked=workspace.locator('[data-pixel-layer-locked="'+base+'"]'),visible=workspace.locator('[data-pixel-layer-visible="'+base+'"]');
  const prior=await pixels();await locked.check();assert.deepEqual(await pixels(),prior,'locked layers still contribute to view');await action('undo').click();
  await visible.uncheck();const hiddenPixels=await pixels();assert.deepEqual(hiddenPixels.previous,baseline.previous);assert.deepEqual(hiddenPixels.next,baseline.next);
  await action('undo').click();assert.deepEqual(await pixels(),prior,'Undo invalidates all cached composites');
  await panel.locator('[data-pixel-frame-action=left]').click();const reordered=await pixels();
  assert(reordered.previous[2]>reordered.previous[0]+30,'reordered next frame changes ghost tint');assert.deepEqual(reordered.next,baseline.next);
  await page.keyboard.press('Control+z');assert.deepEqual(await pixels(),prior);
  await panel.locator('[data-pixel-frame-action=remove]').click();assert.deepEqual(await ghosts(),[{id:ids[0],side:'previous'}]);
  await page.keyboard.press('Control+z');assert.deepEqual(await pixels(),prior);
  await select(ids[0]).click();assert.deepEqual(await ghosts(),[{id:ids[1],side:'next'}]);assert.deepEqual((await pixels()).next,baseline.next,'first frame never wraps to last');
  await select(ids[2]).click();assert.deepEqual(await ghosts(),[{id:ids[1],side:'previous'}]);assert.deepEqual((await pixels()).previous,baseline.previous,'last frame never wraps to first');
  await select(ids[1]).click();
  await action('zoom-in').click();assert.deepEqual(await pixels(),prior,'ghost aligns after zoom');
  const bounds=await canvas.boundingBox();await canvas.focus();await page.keyboard.down('Space');
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+24,bounds.y+bounds.height/2+12);await page.mouse.up();await page.keyboard.up('Space');
  assert.deepEqual(await pixels(),prior,'ghost aligns after pan at either DPR');
  await panel.locator('[data-pixel-frame-action=play]').click();assert.deepEqual(await ghosts(),[]);
  // Capture one rendered blue frame atomically. A slow HD-2D host may advance
  // the preview between separate protocol roundtrips; that is normal playback.
  const previewSample=await page.waitForFunction(()=>{
    const e=document.querySelector('[data-pixel-canvas]'),r=e.getBoundingClientRect(),z=Number(e.dataset.pixelZoom),ctx=e.getContext('2d');
    const read=(x,y)=>[...ctx.getImageData(Math.floor((Number(e.dataset.pixelOriginX)+(x+.5)*z)*e.width/r.width),Math.floor((Number(e.dataset.pixelOriginY)+(y+.5)*z)*e.height/r.height),1,1).data];
    const current=read(3,2);if(current[0]!==0||current[1]!==0||current[2]!==255||current[3]!==255)return false;
    return {previous:read(1,2),next:read(5,2),current,hidden:read(2,5)};
  },undefined,{polling:'raf'});
  try{assert.deepEqual(await previewSample.jsonValue(),baseline,'preview hides ghosts on an actual rendered editing frame');}finally{await previewSample.dispose();}
  await menu.locator('summary').focus();await menu.locator('summary').press('Escape');
  assert.equal(await panel.getAttribute('data-pixel-playing'),'false','Escape from a closed menu still stops preview');assert.deepEqual(await pixels(),prior);
  await action('back').click();await workspace.waitFor({state:'hidden'});await page.locator('[data-placement-document-key="ferrum:pixel-document"]').click();await workspace.waitFor({state:'visible'});
  assert(await setting('enabled').isChecked());assert.equal(await opacity.inputValue(),'50');assert.deepEqual(await pixels(),prior);
  assert.deepEqual(await exported('export-source','after.pixel.json'),sourceBefore);assert.deepEqual(await exported('export-png','after.png'),pngBefore);
  await openSettings();await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:840});
  await openSettings();assert.equal(await menu.locator('summary').textContent(),'어니언 스킨');
  assert(await menu.locator('.placement-pixel-onion-options').evaluate(e=>{const p=document.querySelector('#placement-pixel-workspace').getBoundingClientRect(),r=e.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right+1&&r.top>=p.top&&r.bottom<=p.bottom;}),'onion settings fit a narrow workspace');
  assert(await workspace.evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:join(run,mode+'-onion-ko-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-placement-language]').selectOption('en');await openSettings();
  assert(await menu.evaluate(e=>Math.abs(e.getBoundingClientRect().right-e.querySelector('.placement-pixel-onion-options').getBoundingClientRect().right)<2),'wide onion menu stays anchored to its summary');
  await page.screenshot({path:join(run,mode+'-onion.png'),fullPage:true});await menu.locator('summary').click();
  await page.locator('[data-placement-close-document="ferrum:pixel-document"]').click();await workspace.waitFor({state:'hidden'});
  await page.locator('[data-pixel-file]').setInputFiles({name:'onion-check.pixel.json',mimeType:'application/json',buffer:sourceBefore});await workspace.waitFor({state:'visible'});
  assert(!await setting('enabled').isChecked());assert.equal(await opacity.inputValue(),'30');assert.deepEqual(await ghosts(),[]);
  await page.locator('[data-pixel-file]').setInputFiles(restorePath);
  await page.waitForFunction(name=>document.querySelector('.placement-pixel-header strong').textContent.startsWith(name),original.name);
  assert(!await setting('enabled').isChecked());assert.deepEqual(JSON.parse(await exported('export-source','restored.pixel.json')),original);
  return {actualGhostPixels:true,sourcePngBytesUnchanged:true,historyUnchanged:true,currentFrameOnlyPaint:true,pickerIgnoresGhost:true,
    hiddenAndLockedLayers:true,neighborsRefresh:true,noWrap:true,zoomPanDpr:true,playbackHidesGhosts:true,tabRetainsSettings:true,closeReplaceResets:true,compactKorean:true};
}
