import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {showPlacementMenu,clickPlacementControl,clickPlacementToolAction} from './placement-panel-navigation.mjs';

/** Isolated real UI preferences; the caller's documents, runtime and storage are untouched. */
export async function smokePlacementLayoutPresets(parent,mode,timeoutMs=30000){
  const artifact='artifacts/workspace-layout-presets';await mkdir(artifact,{recursive:true});
  const page=await parent.context().browser().newPage({viewport:{width:1440,height:960},deviceScaleFactor:mode==='spatial'?2:1});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const legacyKey='ferrum.placement.layout.v1:browser',presetsKey='ferrum.placement.layout-presets.v1:browser';
  const legacy=JSON.stringify({scene:280,inspector:352,runtime:152,hidden:['runtime']});
  await page.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,value);},{key:legacyKey,value:legacy});
  const layout=()=>page.evaluate(()=>window.ferrumPlacementWorkspaceLayout);
  const source=()=>page.evaluate(()=>JSON.stringify({document:window.ferrumPlacementSpatialExportDocument(),patch:window.ferrumPlacementViewerExportPatch(),
    history:window.ferrumPlacementViewerHistory,selected:window.ferrumPlacementViewerState.selectedInstanceIds,
    documentKey:window.ferrumPlacementWorkspaceActiveDocument,mode:window.ferrumPlacementWorkspaceMode,
    camera:window.ferrumPlacementWorkspaceMode==='spatial'?window.ferrumPlacementSpatialCamera:window.ferrumPlacementEditCamera}));
  const choose=async id=>{await clickPlacementControl(page,`[data-placement-layout-preset="${id}"]`);await page.waitForFunction(id=>window.ferrumPlacementWorkspaceLayout.preset===id,id);};
  const command=async id=>{await page.keyboard.press('F3');const dialog=page.locator('[data-placement-command-palette]');await dialog.waitFor({state:'visible'});
    await page.locator('[data-placement-command-query]').fill('layout');await dialog.locator(`[data-placement-command="layout-${id}"]`).click();await dialog.waitFor({state:'hidden'});};
  const stored=key=>page.evaluate(key=>localStorage.getItem(key),key);
  const composeView=()=>clickPlacementControl(page,mode==='spatial'?'[data-placement-spatial-camera="out"]':'[data-placement-view-action="zoom-out"]');
  const tab=()=>page.locator('.placement-runtime-dock > .placement-panel-tabs > .placement-panel-tablist > [data-placement-panel-tab][aria-selected="true"]').getAttribute('data-placement-panel-tab');
  try{
    const url=new URL(parent.url());url.search=mode==='spatial'?'?scene=hd2d':'';
    await page.goto(url.href,{waitUntil:'networkidle'});
    await page.waitForFunction(mode=>window.ferrumPlacementWorkspaceMode===mode&&window.ferrumPlacementViewerRuntimeFrame?.drawCalls>0&&!document.querySelector('.demo-shell').inert,mode,{timeout:timeoutMs});
    await page.locator('[data-placement-language]').selectOption('en');
    assert.equal((await layout()).preset,'custom');assert.equal(await stored(legacyKey),legacy);
    // A manual view stays fixed; initial Fit Scene intentionally adapts to the canvas aspect.
    await composeView();
    const before=await source(),originalTab=await tab();
    await choose('scene');assert.deepEqual((await layout()).hidden,['runtime']);assert.equal((await layout()).scene,240);
    await page.locator('[data-placement-dock-resize="scene"]').focus();await page.keyboard.press('ArrowRight');
    await clickPlacementControl(page,'[data-placement-dock-toggle="inspector"]');
    assert.equal((await layout()).scene,248);assert((await layout()).hidden.includes('inspector'));
    await choose('assets');assert.equal((await layout()).runtime,240);assert.equal(await tab(),'assets');
    assert.deepEqual((await layout()).hidden,['scene','inspector']);
    await page.locator('[data-placement-dock-resize="runtime"]').focus();await page.keyboard.press('ArrowUp');
    assert.equal((await layout()).runtime,248);
    await choose('scene');assert.equal((await layout()).scene,248);assert((await layout()).hidden.includes('inspector'));
    await clickPlacementControl(page,'[data-placement-action="reset-layout"]');
    assert.equal((await layout()).preset,'scene');assert.equal((await layout()).scene,240);assert.deepEqual((await layout()).hidden,['runtime']);
    await choose('assets');assert.equal((await layout()).runtime,248,'resetting Scene must preserve the Assets profile');
    await command('review');assert.equal(await tab(),'runtime');assert.equal((await layout()).runtime,120);
    await command('custom');assert.equal((await layout()).scene,280);assert.equal((await layout()).inspector,352);
    assert.equal((await layout()).runtime,152);assert.deepEqual((await layout()).hidden,['runtime']);assert.equal(await tab(),originalTab);
    assert.equal(await stored(legacyKey),legacy,'presets must preserve the legacy custom key');assert.equal(await source(),before);
    // Each profile also keeps its transient focus and compact drawer choice.
    await clickPlacementControl(page,'[data-placement-action="focus-viewport"]');assert((await layout()).focused);
    await command('assets');assert.equal((await layout()).focused,false);await command('custom');assert((await layout()).focused);
    await clickPlacementControl(page,'[data-placement-action="focus-viewport"]');
    for(const locale of ['ko','en']){
      await page.locator('[data-placement-language]').selectOption(locale);await showPlacementMenu(page,'layout');
      assert.equal(await page.locator('.placement-layout-presets button').count(),4);
      await page.screenshot({path:`${artifact}/${mode}-${locale}.png`,fullPage:true});await page.keyboard.press('Escape');await page.keyboard.press('Escape');
    }
    await choose('scene');const grip=page.locator('[data-placement-dock-resize="scene"]'),bounds=await grip.boundingBox();
    await page.mouse.move(bounds.x+2,bounds.y+20);await page.mouse.down();await page.mouse.move(bounds.x+22,bounds.y+20);
    const inFlight=await layout();await page.keyboard.press('F3');assert(await page.locator('[data-placement-command-palette]').isHidden());
    await page.locator('[data-placement-layout-preset="review"]').evaluate(button=>button.click());assert.equal((await layout()).preset,inFlight.preset);
    await page.keyboard.press('Escape');await page.mouse.up();assert.equal((await layout()).scene,240);
    for(const [index,[width,height]] of [[390,500],[320,360]].entries()){
      await page.setViewportSize({width,height});await choose('assets');assert.equal((await layout()).compactPanel,index===0?'runtime':'none');
      await clickPlacementControl(page,'[data-placement-compact-viewport]');await choose('scene');
      if((await layout()).compactPanel!=='inspector')await clickPlacementControl(page,'[data-placement-dock-toggle="inspector"]');assert.equal((await layout()).compactPanel,'inspector');
      await choose('assets');assert.equal((await layout()).compactPanel,'none');await choose('scene');assert.equal((await layout()).compactPanel,'inspector');
      const canvas=await page.locator('canvas.demo-canvas').boundingBox();assert(canvas.height>=128&&canvas.width>0);
      await showPlacementMenu(page,'layout');const panel=await page.locator('[data-placement-menu="layout"] .placement-control-panel').boundingBox();
      assert(panel.x>=0&&panel.x+panel.width<=width+1&&panel.y>=0&&panel.y+panel.height<=height+1);
      await page.screenshot({path:`${artifact}/${mode}-${width}.png`,fullPage:true});await page.keyboard.press('Escape');await page.keyboard.press('Escape');
    }
    await page.setViewportSize({width:1440,height:960});await command('review');assert.equal(await source(),before);
    // A layout choice does not start, stop or change the running game view.
    await page.locator('[data-placement-playback="play"]').click();await page.waitForFunction(()=>window.ferrumPlacementWorkspaceMode==='game'&&window.ferrumEngine.dataSceneState()==='playing');
    const playing=await source();await command('scene');await command('review');assert.equal(await source(),playing);
    assert.equal(await page.evaluate(()=>window.ferrumEngine.dataSceneState()),'playing');
    await page.locator('[data-placement-playback="stop"]').click();await page.waitForFunction(mode=>window.ferrumPlacementWorkspaceMode===mode,mode);
    await command('assets');await clickPlacementToolAction(page.locator('[data-pixel-launcher] [data-pixel-action="new"]'));
    const create=page.locator('dialog[open]');await create.getByLabel('Pixel Width',{exact:true}).fill('8');await create.getByLabel('Pixel Height',{exact:true}).fill('8');await create.locator('[data-pixel-action="create"]').click();
    const pixel=page.locator('#placement-pixel-workspace');await pixel.waitFor({state:'visible'});
    await pixel.locator('[data-pixel-canvas]').click();assert.equal(await pixel.getAttribute('data-pixel-dirty'),'true');
    const pixelTab=await page.locator('.placement-document-tabs [role="tab"][aria-selected="true"]').getAttribute('data-placement-document-key');
    await command('review');assert(await pixel.isVisible());assert.equal(await pixel.getAttribute('data-pixel-dirty'),'true');
    assert.equal(await page.locator('.placement-document-tabs [role="tab"][aria-selected="true"]').getAttribute('data-placement-document-key'),pixelTab);
    await pixel.locator('[data-pixel-canvas]').focus();await page.keyboard.press('Control+a');await page.keyboard.press('ArrowRight');
    await showPlacementMenu(page,'layout');assert(await page.locator('[data-placement-layout-preset="scene"]').isDisabled());
    await page.locator('[data-placement-layout-preset="scene"]').evaluate(button=>button.click());assert.equal((await layout()).preset,'review');
    await page.keyboard.press('F3');assert(await page.locator('[data-placement-command-palette]').isHidden());
    await page.keyboard.press('Escape');await page.keyboard.press('Escape');
    await pixel.locator('[data-pixel-canvas]').focus();await page.keyboard.press('Escape');
    await command('scene');assert.equal((await layout()).preset,'scene');assert(await pixel.isVisible());
    await pixel.locator('[data-pixel-action="undo"]').click();assert.equal(await pixel.getAttribute('data-pixel-dirty'),'true');
    assert(await pixel.locator('[data-pixel-action="undo"]').isDisabled(),'one undo must still remove the only pixel stroke');
    // Scene docks yield to the pixel editor without changing the saved layout.
    const shell=page.locator('.demo-shell'),dockHidden=dock=>shell.getAttribute(`data-${dock}-dock-hidden`),savedHidden=(await layout()).hidden;
    assert.equal(await dockHidden('scene'),'true');assert.equal(await dockHidden('inspector'),'true');
    await page.locator('[data-placement-dock-rail="inspector"] [data-placement-rail-tab="properties"]').click();assert.equal(await dockHidden('inspector'),'false');
    await page.locator('.placement-panel:not([hidden]) [data-placement-dock-minimize="inspector"]').click();assert.equal(await dockHidden('inspector'),'true');
    assert.deepEqual((await layout()).hidden,savedHidden,'Pixel docks are transient');
    await pixel.locator('[data-pixel-action="back"]').click();
    await page.waitForFunction(()=>document.querySelector('.demo-shell').dataset.sceneDockHidden==='false');assert.equal(await dockHidden('inspector'),'false');
    await page.locator('[data-placement-close-document="ferrum:pixel-document"]').click();await page.locator('dialog[open] [data-pixel-action="confirm-discard"]').click();
    assert.equal(await source(),before);
    // A dirty second scene must remain selected, with its patch and undo entry intact.
    const doc=await page.evaluate(()=>window.ferrumPlacementSpatialExportDocument());
    await page.locator('input[data-placement-document-file]').setInputFiles({name:'layout-second.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
    await page.waitForFunction(()=>!document.querySelector('.demo-shell').inert);
    await composeView();
    await page.evaluate(()=>{const state=window.__ferrumPlacementViewer.state(),selected=state.selected;if(!selected)throw Error('Expected a selected fixture object');window.ferrumPlacementViewerUpdateTransform(selected.instanceId,{x:selected.transform.x+2});});
    assert(await page.evaluate(()=>!!window.ferrumPlacementViewerExportPatch()&&window.ferrumPlacementViewerHistory.undoCount>0));
    const dirty=await source();await command('assets');await command('scene');assert.equal(await source(),dirty);
    await command('review');const saved=JSON.parse(await stored(presetsKey));assert.equal(saved.active,'review');
    await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.ferrumPlacementWorkspaceLayout?.preset==='review');
    assert.equal((await layout()).runtime,120);await command('assets');assert.equal((await layout()).runtime,248);await command('custom');
    assert.equal((await layout()).scene,280);assert.equal(await stored(legacyKey),legacy);
    await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Denied','SecurityError');};});
    await command('scene');assert.equal((await layout()).preset,'scene');assert.deepEqual(errors,[]);
    const frame=await page.evaluate(()=>window.ferrumPlacementViewerRuntimeFrame);assert(frame.entityCount>=3&&frame.drawCalls>0&&frame.drawCalls<=32);
    const report={ok:true,mode,dpr:await page.evaluate(()=>devicePixelRatio),legacyCustomPreserved:true,perProfileOverrides:true,resetIsScoped:true,
      focusAndDrawerRestored:true,runtimeTabs:true,reload:true,storageFailureSafe:true,dirtyDocumentPreserved:true,gamePreserved:true,pixelPreserved:true,
      dockAndPixelGestureGuards:true,readonlySourceHistoryCamera:true,bilingual:true,narrow:true,frame:{entities:frame.entityCount,draws:frame.drawCalls}};
    await writeFile(`${artifact}/${mode}.json`,JSON.stringify(report,null,2)+'\n');return report;
  }catch(error){await page.screenshot({path:`${artifact}/${mode}-failure.png`,fullPage:true}).catch(()=>{});throw error;}
  finally{await page.close();}
}
