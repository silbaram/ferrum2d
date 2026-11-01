import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

/** Real app actions, both locales and edit contexts. Source/history comparisons are independent of command search. */
export async function smokePlacementCommandPalette(page,mode) {
  const artifact='artifacts/workspace-command-search';await mkdir(artifact,{recursive:true});
  const originalViewport=page.viewportSize(),language=page.locator('[data-placement-language]'),originalLocale=await language.inputValue();
  const palette=page.locator('[data-placement-command-palette]'),query=page.locator('[data-placement-command-query]');
  const canvas=page.locator('canvas.demo-canvas');
  const prefix=mode==='spatial'?'[data-placement-spatial-navigation=':'[data-placement-view-action=';
  const select=page.locator(prefix+'select]'),pan=page.locator(prefix+'pan]');
  const authored=()=>page.evaluate(()=>JSON.stringify({document:window.ferrumPlacementSpatialExportDocument(),history:window.ferrumPlacementViewerHistory,selected:window.ferrumPlacementViewerState.selectedInstanceIds}));
  const before=await authored();
  async function open(text=''){await page.keyboard.press('F3');await palette.waitFor({state:'visible'});await query.fill(text);}
  async function run(text,id){await open(text);await palette.locator(`[data-placement-command="${id}"]`).click();await palette.waitFor({state:'hidden'});}
  try {
    await language.selectOption('en');
    const rail=page.locator('[data-placement-navigation-rail]');assert(await rail.isVisible());
    assert.equal(await rail.locator('button:visible').count(),2,'only Select and Pan belong in the navigation rail');
    if(mode==='spatial'){
      const camera=page.locator('[data-placement-game-camera-edit]');assert(await camera.isVisible());
      assert(await camera.evaluate(e=>e.closest('.placement-camera-mount')!==null),'Game Camera stays in the header');
    }
    const selectBox=await select.boundingBox(),panBox=await pan.boundingBox(),surface=await canvas.boundingBox();
    assert(panBox.y>selectBox.y&&Math.abs(selectBox.x-panBox.x)<1,'selection tools form a vertical rail');
    assert(selectBox.x>=surface.x&&panBox.x+panBox.width<=surface.x+surface.width);
    await select.focus();await page.keyboard.press('ArrowDown');assert(await pan.evaluate(e=>e===document.activeElement));
    await page.keyboard.press('ArrowUp');assert(await select.evaluate(e=>e===document.activeElement));
    await canvas.focus();await open('no-command-can-match-this');
    assert.equal(await palette.locator('[role="option"]').count(),0);await page.keyboard.press('Enter');assert(await palette.isVisible());
    await page.keyboard.press('Escape');assert(await canvas.evaluate(e=>e===document.activeElement));assert.equal(await authored(),before);
    await run('viewport pan','pan');assert.equal(await pan.getAttribute('aria-pressed'),'true');
    await run('viewport select','select');assert.equal(await select.getAttribute('aria-pressed'),'true');
    await run('회전','properties');assert(await page.locator('.placement-inspector:visible [data-placement-panel-tab="properties"]').evaluate(e=>e===document.activeElement));
    const originalKey=await page.locator('.placement-document-tabs [role="tab"][aria-selected="true"]').getAttribute('data-placement-document-key');
    const cachedInspector=await page.locator('.placement-inspector:visible').elementHandle();
    await page.locator('.placement-inspector:visible [data-placement-panel-tab="placement"]').click();
    const source=await page.evaluate(()=>window.ferrumPlacementSpatialExportDocument());
    await page.locator('input[data-placement-document-file]').setInputFiles({name:'commands-document-context.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});
    await page.waitForFunction(element=>!!element.closest('[hidden]'),cachedInspector);
    await page.waitForFunction(()=>!document.querySelector('.demo-shell').inert);
    const temporaryKey=await page.locator('.placement-document-tabs [role="tab"][aria-selected="true"]').getAttribute('data-placement-document-key');
    await page.locator('.placement-inspector:visible [data-placement-panel-tab="placement"]').click();
    await run('회전','properties');
    assert.equal(await page.locator('.placement-inspector:visible [data-placement-panel-tab="properties"]').getAttribute('aria-selected'),'true');
    assert.equal(await cachedInspector.$eval('[data-placement-panel-tab="properties"]',e=>e.getAttribute('aria-selected')),'false','commands cannot select cached inactive document controls');
    await page.locator(`[data-placement-close-document=${JSON.stringify(temporaryKey)}]`).click();
    await page.locator(`[data-placement-document-key=${JSON.stringify(originalKey)}]`).click();
    await page.waitForFunction(key=>document.querySelector('.placement-document-tabs [role="tab"][aria-selected="true"]')?.dataset.placementDocumentKey===key,originalKey);
    await run('회전','properties');assert.equal(await authored(),before);
    await open('viewport pan');
    await pan.evaluate(e=>{e.disabled=true;});await page.keyboard.press('Enter');
    assert(await palette.isVisible(),'a newly disabled source action is not dispatched');
    assert.match(await palette.locator('[data-placement-command-status]').textContent(),/unavailable/);
    await pan.evaluate(e=>{e.disabled=false;});await page.keyboard.press('Escape');
    await open('viewport pan');
    await query.dispatchEvent('compositionstart',{data:'ㅎ'});
    await query.dispatchEvent('keydown',{code:'Enter',isComposing:true});assert(await palette.isVisible());
    await page.keyboard.press('Escape');assert(await palette.isVisible(),'IME cancellation does not dismiss search');
    await query.dispatchEvent('compositionend',{data:'화면 이동'});await page.keyboard.press('Escape');
    assert.equal(await select.getAttribute('aria-pressed'),'true');
    await open('viewport pan');await palette.getByRole('button',{name:'Close',exact:true}).focus();await page.keyboard.press('Enter');
    assert(await palette.isHidden(),'Enter on Close must not execute the active command');assert.equal(await select.getAttribute('aria-pressed'),'true');
    await pan.click();const box=await canvas.boundingBox(),start={x:box.x+box.width/2,y:box.y+box.height/2};
    await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+24,start.y+16);await page.keyboard.press('F3');
    assert(await palette.isHidden(),'F3 cannot take over an in-flight navigation gesture');
    await page.keyboard.press('Escape');await page.mouse.up();await select.click();
    await run('new pixel','new-pixel');const createDialog=page.locator('dialog[open]');
    await page.keyboard.press('F3');assert(await palette.isHidden());assert.equal(await page.locator('dialog[open]').count(),1);
    await createDialog.getByLabel('Pixel Width',{exact:true}).fill('8');await createDialog.getByLabel('Pixel Height',{exact:true}).fill('8');
    await createDialog.locator('[data-pixel-action="create"]').click();
    const pixel=page.locator('#placement-pixel-workspace');await pixel.waitFor({state:'visible'});assert(await rail.isHidden());
    const dirty=await pixel.getAttribute('data-pixel-dirty');await open('viewport pan');
    assert.equal(await palette.locator('[data-placement-command="pan"]').getAttribute('aria-disabled'),'true');
    await page.keyboard.press('Escape');await run('pixel art fit','pixel-fit');
    assert.equal(await pixel.getAttribute('data-pixel-dirty'),dirty);assert(await pixel.locator('[data-pixel-action="undo"]').isDisabled());
    await pixel.locator('[data-pixel-canvas]').focus();await page.keyboard.press('Control+a');await page.keyboard.press('ArrowRight');await page.keyboard.press('F3');
    assert(await palette.isHidden(),'unconfirmed pixel transforms block global commands');await page.keyboard.press('Escape');
    await run('back to scene','back-to-scene');assert(await pixel.isHidden());assert(await rail.isVisible());
    await page.locator('[data-placement-close-document="ferrum:pixel-document"]').click();
    await page.locator('dialog[open] [data-pixel-action="confirm-discard"]').click();
    assert.equal(await authored(),before,'command UI and pixel-only operations cannot alter scene source/history');
    await run('workspace game preview','view-game');await page.waitForFunction(()=>window.ferrumPlacementWorkspaceMode==='game');
    assert(await rail.isHidden());await open('viewport pan');assert.equal(await palette.locator('[data-placement-command="pan"]').getAttribute('aria-disabled'),'true');await page.keyboard.press('Escape');
    await run(mode==='spatial'?'HD-2D View':'2D View',mode==='spatial'?'view-hd2d':'view-2d');
    await page.waitForFunction(mode=>window.ferrumPlacementWorkspaceMode===mode,mode);assert(await rail.isVisible());
    for(const locale of ['ko','en']){
      await language.selectOption(locale);await canvas.focus();await open('카메라');assert(await palette.locator('[role="option"]').count()>0);
      const hasSpatial=await page.evaluate(()=>!!window.ferrumPlacementSpatialExportDocument().spatial);
      assert.equal(await palette.locator('[data-placement-command="game-camera"]').getAttribute('aria-disabled'),String(!hasSpatial),'camera commands respect the document capability');
      await page.screenshot({path:`${artifact}/${mode}-${locale}.png`,fullPage:true});await page.keyboard.press('Escape');
    }
    await language.selectOption('ko');await page.setViewportSize({width:390,height:500});await open('도트');
    const bounds=await palette.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=391&&bounds.y>=0&&bounds.y+bounds.height<=501);
    await page.screenshot({path:`${artifact}/${mode}-ko-narrow.png`,fullPage:true});await page.keyboard.press('Escape');
    await page.setViewportSize(originalViewport);assert.equal(await authored(),before);
    const report={ok:true,mode,verticalRail:true,searchIsReadonly:true,bilingual:true,aliases:true,ownerActionDelegation:true,activeDocumentOwner:true,cameraCapability:true,rechecksAvailability:true,ime:true,closeButtonEnter:true,dragGuard:true,pixelContextAndPendingGuard:true,gameContext:true,modalGuard:true,focusRestored:true,narrow:true,sourceAndHistoryPreserved:true};
    await writeFile(`${artifact}/${mode}.json`,JSON.stringify(report,null,2)+'\n');return report;
  } catch(error){await page.screenshot({path:`${artifact}/${mode}-failure.png`,fullPage:true});throw error;}
  finally{await page.keyboard.up('Space');await page.mouse.up();await page.setViewportSize(originalViewport);await language.selectOption(originalLocale);}
}
