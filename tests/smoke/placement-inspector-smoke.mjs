import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {showPlacementInspector,showPlacementDock} from './placement-panel-navigation.mjs';

/** Existing control owners, real patches/Undo and native rendering in an isolated page. */
export async function smokePlacementInspector(parent,mode,timeoutMs=30000){
 const artifact='artifacts/inspector-properties';await mkdir(artifact,{recursive:true});
 const page=await parent.context().browser().newPage({viewport:{width:1440,height:960},deviceScaleFactor:mode==='spatial'?2:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const inspector=page.locator('.placement-inspector:visible'),feedback=inspector.locator('[data-placement-inspector-context]');
 const doc=()=>page.evaluate(()=>window.ferrumPlacementSpatialExportDocument());
 const history=()=>page.evaluate(()=>window.ferrumPlacementViewerHistory);
 const source=()=>page.evaluate(()=>JSON.stringify({document:window.ferrumPlacementSpatialExportDocument(),patch:window.ferrumPlacementViewerExportPatch(),history:window.ferrumPlacementViewerHistory}));
 const state=()=>page.evaluate(()=>window.ferrumPlacementViewerState);
 const paint=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
 const undo=async()=>{await page.locator('[data-placement-action="undo"]').click();await paint();};
 const input=async(locator,value)=>{await locator.fill(String(value));await locator.press('Tab');await inspector.locator('[data-placement-selection-header]').click();await paint();};
 try{
  if(mode==='2d')await page.route('**/placement.scene-authoring.json',async route=>{
   const response=await route.fetch(),fixture=await response.json();
   const c=fixture.sceneComposition.prefabs.crate.props.components;
   Object.assign(c.sprite,{normalTexture:'crate',projection:'upright',shadow:{shape:'ellipse'},animationSet:{clips:[{id:0,fps:8,frames:[{u0:0,v0:0,u1:1,v1:1}]}],initialClip:0}});
   c.body={type:'dynamic',mass:3,canSleep:false,gravityScale:0.2,linearDamping:0.3,angularDamping:0.4,material:{friction:0.8,restitution:0.1}};
   await route.fulfill({response,json:fixture});
  });
  const url=new URL(parent.url());url.search=mode==='spatial'?'?scene=hd2d':'';
  await page.goto(url.href,{waitUntil:'networkidle'});await page.waitForFunction(mode=>window.ferrumPlacementWorkspaceMode===mode&&window.ferrumPlacementViewerRuntimeFrame?.drawCalls>0,mode,{timeout:timeoutMs});
  await page.locator('[data-placement-language]').selectOption('en');await showPlacementInspector(page);
  if(mode==='2d'){await page.evaluate(()=>window.ferrumPlacementViewerSelect('crate_left'));await paint();}
  const original=await doc(),initial=await state(),id=initial.selectedInstanceId;
  assert(id);assert.equal(await inspector.locator('[data-section="identity"]').getAttribute('open'),null);
  assert.equal(await inspector.locator('[data-section="diagnostics"]').getAttribute('open'),null);
  const beforeRead=await source();
  for(const name of ['identity','diagnostics']){await inspector.locator(`[data-section="${name}"] > summary`).click();assert(await inspector.locator(`[data-section="${name}"] dd`).first().isVisible());await inspector.locator(`[data-section="${name}"] > summary`).click();}
  assert.equal(await source(),beforeRead,'opening read-only details must preserve source and history');
  const search=inspector.locator('[data-placement-property-search]'),changed=inspector.locator('[data-placement-property-changed]'),advanced=inspector.locator('[data-placement-property-advanced]');
  const activeField=name=>inspector.locator(`[data-placement-${mode==='2d'?'transform':'spatial'}-field="${name}"]`);
  const resetField=name=>inspector.locator(`[data-placement-property-reset="${mode==='2d'?'transform':'spatial'}:${name}"]`);
  await search.fill('회전');assert(await activeField('x').isHidden(),'Korean metadata search works in English UI');
  await search.press('Escape');assert(await activeField('x').isVisible());
  await advanced.uncheck();assert(await inspector.locator('[data-section="identity"]').isHidden());
  await inspector.locator('[data-placement-property-clear]').click();assert(await advanced.isChecked());
  await changed.check();assert(await activeField('x').isHidden());await changed.uncheck();
  assert.equal(await source(),beforeRead,'search and disclosure filters must be view only');
  const originalX=Number(await activeField('x').inputValue());await input(activeField('x'),originalX+12);
  await changed.check();assert(await activeField('x').isVisible());
  const beforeHeld=await source();await page.evaluate(()=>window.__ferrumPlacementViewer.beginEdit('External Edit'));
  await resetField('x').click();assert.equal(await source(),beforeHeld,'Property restore must not commit another owner\'s pending transaction');
  assert.equal(await page.evaluate(()=>window.__ferrumPlacementViewer.historyState().transactionLabel),'External Edit');
  await page.evaluate(id=>{window.__ferrumPlacementViewer.cancelEdit();window.ferrumPlacementViewerSelect(id);},id);
  await resetField('x').click();await paint();
  assert.equal((await history()).undoCount,2,'restore is one additional undo');
  assert(await search.evaluate(node=>node===document.activeElement),'Resetting the last modified field keeps keyboard focus on a visible filter');
  await changed.uncheck();assert.equal(Number(await activeField('x').inputValue()),originalX);
  await undo();assert.equal(Number(await activeField('x').inputValue()),originalX+12);await undo();assert.deepEqual(await doc(),original);
  if(mode==='2d'){
   const sections=await inspector.locator('[data-placement-panel-body="properties"] [data-section]').evaluateAll(nodes=>nodes.map(n=>n.dataset.section));
   assert(sections.indexOf('transform')<sections.indexOf('visual')&&sections.indexOf('visual')<sections.indexOf('identity'));
   assert.equal(await inspector.locator('[data-section="transform"] .placement-details').count(),0);
   const field=name=>inspector.locator(`[data-placement-transform-field="${name}"]`);
   assert.match(await field('rotationRadians').evaluate(e=>e.labels[0].textContent),/Rotation.*rad/);
   assert.match(await field('scale').evaluate(e=>e.labels[0].textContent),/Scale.*×/);
   await input(field('rotationRadians'),0.5);assert(Math.abs((await state()).selected.transform.rotationRadians-0.5)<1e-8);assert.equal((await history()).undoCount,1);await undo();
   const component=inspector.locator('[data-placement-component-field="visualWidth"]'),width=(await state()).selected.visual.width;
   await component.fill(String(width+4));await inspector.locator('[data-placement-action="apply-components"]').click();await paint();
   assert.equal((await state()).selected.visual.width,width+4);assert.equal((await history()).undoCount,1);assert.deepEqual((await doc()).sceneComposition.prefabs,original.sceneComposition.prefabs);
   const authored=(await doc()).sceneComposition.fragments.main.instances.find(i=>i.id===id).props.components;
   const originalComponents=original.sceneComposition.prefabs.crate.props.components;
   for(const key of ['normalTexture','projection','shadow','animationSet'])assert.deepEqual(authored.visual[key],originalComponents.sprite[key],`Component Apply preserves ${key}`);
   assert.deepEqual(authored.body,originalComponents.body,'Component Apply preserves all dynamic body fields');
   const staged=inspector.locator('[data-placement-component-field="visualHeight"]'),height=Number(await staged.inputValue());await staged.fill(String(height+6));
   const pending=await source();await search.fill('width');assert(await staged.isHidden());assert.equal(await staged.inputValue(),String(height+6));await search.fill('');assert.equal(await source(),pending,'Filtering preserves uncommitted component input');
   await inspector.locator('[data-placement-property-reset="component:visualWidth"]').click();await paint();
   assert.equal((await state()).selected.visual.width,width);assert.equal((await state()).selected.visual.height,height);assert.equal(await staged.inputValue(),String(height+6),'Resetting one field preserves other staged input');
   await staged.fill(String(height));await undo();assert.equal((await state()).selected.visual.width,width+4);await undo();
   const other=initial.instances.find(i=>i.instanceId!==id&&!initial.lockedInstanceIds.includes(i.instanceId));assert(other);
   await page.locator(`button[data-instance-id=${JSON.stringify(other.instanceId)}]:visible`).click({modifiers:['Control']});
   assert.equal((await state()).selectedInstanceIds.length,2);assert.equal(await feedback.getAttribute('data-state'),'multiple');
   assert(await inspector.locator('[data-placement-action="apply-components"]').isDisabled());
   const group=await state(),x=group.selected.transform.x;
   await input(field('x'),x+10);const moved=await state();assert.equal((await history()).undoCount,1);
   for(const selected of group.instances.filter(i=>group.selectedInstanceIds.includes(i.instanceId)))assert.equal(moved.instances.find(i=>i.instanceId===selected.instanceId).transform.x,selected.transform.x+10);
   assert.deepEqual((await doc()).sceneComposition.prefabs,original.sceneComposition.prefabs);await undo();
   await page.locator('[data-placement-selection-action="lock"]').click();assert.equal(await feedback.getAttribute('data-state'),'locked');assert(await field('x').isDisabled());
   const locked=await source();await page.locator('canvas.demo-canvas').focus();await page.keyboard.press('ArrowRight');assert.equal(await source(),locked);
   await page.locator('[data-placement-selection-action="unlock"]').click();assert.equal(await feedback.getAttribute('data-state'),'multiple');
   await page.locator('[data-placement-selection-action="clear"]').click();assert.equal(await feedback.getAttribute('data-state'),'empty');assert(await field('x').isDisabled());
   await page.locator(`button[data-instance-id=${JSON.stringify(id)}]:visible`).click();assert.equal(await feedback.getAttribute('data-state'),'single');
   const longId='inspector_target_'+('long_name_'.repeat(4));
   await inspector.locator('[data-placement-rename-id]').fill(longId);await inspector.locator('[data-placement-action="rename-selected"]').click();await paint();
   assert.match(await inspector.locator('[data-placement-selection-header]').getAttribute('title'),new RegExp(longId));
  }else{
   const field=name=>inspector.locator(`[data-placement-spatial-field="${name}"]`);
   assert.equal(await feedback.getAttribute('data-state'),'spatial');
   const position=await field('x').boundingBox(),actions=await inspector.locator('.placement-spatial-object-actions').boundingBox();assert(position.y<actions.y,'spatial transform fields precede rename/delete');
   await input(field('yaw'),45);assert(Math.abs((await state()).selected.transform.rotationRadians-Math.PI/4)<1e-6);assert.equal((await history()).undoCount,1);await undo();
   const oldElevation=Number(await field('elevation').inputValue());await input(field('elevation'),oldElevation+8);assert.equal((await state()).selected.body.heightSpan.elevation,oldElevation+8);assert.equal((await history()).undoCount,1);await undo();
   assert.deepEqual((await doc()).sceneComposition.prefabs,original.sceneComposition.prefabs);
   await page.locator(`[data-placement-lock-instance=${JSON.stringify(id)}]:visible`).click();assert.equal(await feedback.getAttribute('data-state'),'locked');assert(await field('x').isDisabled());
   await page.locator(`[data-placement-lock-instance=${JSON.stringify(id)}]:visible`).click();assert.equal(await feedback.getAttribute('data-state'),'spatial');
   await inspector.locator('[data-placement-spatial-target]').selectOption('surface:ground');assert.equal(await feedback.getAttribute('data-state'),'spatial');assert(await field('x').isEnabled());assert(await field('yaw').isHidden());
   await search.fill('yaw');assert.match(await inspector.locator('.placement-inspector-search > output[role=status]').textContent(),/^0 fields/,'Owner-hidden fields are excluded from search counts');await search.fill('');
   const canvas=await page.locator('canvas.demo-canvas').boundingBox();await page.mouse.click(canvas.x+12,canvas.y+canvas.height-20);await paint();
   assert.equal(await feedback.getAttribute('data-state'),'empty');
   await inspector.locator('[data-placement-spatial-target]').selectOption('billboard:'+id);assert.equal(await feedback.getAttribute('data-state'),'spatial');
  }
  // The header and original tablist move as one sticky unit, including at 240px.
  for(const width of [320,240]){
   if(width===240){await page.locator('[data-placement-dock-resize="inspector"]').focus();await page.keyboard.press('Home');}
   await inspector.locator('[data-section="handoff"] > summary').scrollIntoViewIfNeeded();
   const bounds=await inspector.evaluate(element=>{const rect=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom};};return{panel:rect(element),header:rect(element.querySelector('[data-placement-selection-header]')),tabs:rect(element.querySelector('.placement-inspector-header .placement-panel-tablist'))};});
   assert(bounds.header.y>=bounds.panel.y&&bounds.tabs.y>=bounds.header.bottom-1&&bounds.tabs.right<=bounds.panel.right+1,'sticky name and tabs must not overlap or overflow');
   if(mode==='2d'){
    const snap=inspector.locator('.placement-control-grid-secondary');await snap.scrollIntoViewIfNeeded();
    const sizes=await snap.evaluate(element=>{const r=e=>e.getBoundingClientRect();const inputs=[...element.querySelectorAll('input[type=number]')],buttons=[...element.querySelectorAll('button')];return{numberWidth:r(inputs[0]).width,buttons:buttons.map(e=>({width:r(e).width,height:r(e).height})),gridBottom:r(inputs[0]).bottom,buttonsTop:r(buttons[0]).top};});
    assert(sizes.numberWidth>=64&&sizes.buttons.every(b=>b.width>=64&&b.height>=24)&&sizes.buttonsTop>=sizes.gridBottom,'snap controls and save actions need separate readable rows');
   }
  }
  if(mode==='2d')await undo();
  await page.locator('[data-placement-playback="play"]').click();await page.waitForFunction(()=>window.ferrumPlacementWorkspaceMode==='game');assert.equal(await feedback.getAttribute('data-state'),'game');
  await page.locator('[data-placement-playback="stop"]').click();await page.waitForFunction(mode=>window.ferrumPlacementWorkspaceMode===mode,mode);
  assert.deepEqual(await doc(),original);
  for(const locale of ['ko','en']){
   await page.locator('[data-placement-language]').selectOption(locale);await showPlacementDock(page,'inspector');await inspector.locator('.placement-inspector-header [data-placement-panel-tab="properties"]').click();await inspector.evaluate(e=>{e.scrollTop=0;});
   assert.match(await feedback.textContent(),locale==='ko'?/공간|라디안/:/Spatial|radians/);
   await page.screenshot({path:`${artifact}/${mode}-${locale}.png`,fullPage:true});
  }
  await page.setViewportSize({width:320,height:500});await showPlacementDock(page,'inspector');await inspector.locator('.placement-inspector-header [data-placement-panel-tab="properties"]').click();await page.screenshot({path:`${artifact}/${mode}-320.png`,fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const frame=await page.evaluate(()=>window.ferrumPlacementViewerRuntimeFrame);assert(frame.entityCount>=3&&frame.drawCalls>0&&frame.drawCalls<=32);assert.deepEqual(errors,[]);
  const report={ok:true,mode,dpr:await page.evaluate(()=>devicePixelRatio),searchAndModified:true,fieldResetSingleUndo:true,...(mode==='2d'?{stagedComponentsPreserved:true}:{}),fieldsFirst:true,readonlyDetails:true,unitsAndUndo:true,prefabsPreserved:true,lockFeedback:true,selectionFeedback:true,stickyHeader:true,bilingual:true,narrow:true,frame:{entities:frame.entityCount,draws:frame.drawCalls}};
  await writeFile(`${artifact}/${mode}.json`,JSON.stringify(report,null,2)+'\n');return report;
 }catch(error){await page.screenshot({path:`${artifact}/${mode}-failure.png`,fullPage:true}).catch(()=>{});throw error;}
 finally{await page.close();}
}
