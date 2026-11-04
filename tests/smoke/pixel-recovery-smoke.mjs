import {clickPlacementToolAction} from "./placement-panel-navigation.mjs";
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {showPlacementBottom} from './placement-panel-navigation.mjs';

const database='ferrum-pixel-recovery';
async function rows(page,replace) {
  return page.evaluate(async({database,replace})=>new Promise((resolve,reject)=>{
    const request=indexedDB.open(database);
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('checkpoints',replace?'readwrite':'readonly'),store=tx.objectStore('checkpoints');
      let result=[];if(replace)store.put(replace);
      const get=store.getAll();get.onsuccess=()=>{result=get.result;};
      tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(tx.error);};
    };
  }),{database,replace});
}
async function untilRows(page,predicate) {
  for(let i=0;i<100;i++) {const result=await rows(page);if(predicate(result))return result;await page.waitForTimeout(50);}
  throw Error('Pixel recovery checkpoint condition not reached');
}
export async function smokePixelRecovery(page,mode,run) {
  const errors=[],origin=new URL(page.url()).origin;
  const workspace=p=>p.locator('#placement-pixel-workspace'),action=(p,name)=>workspace(p).locator('[data-pixel-action="'+name+'"]');
  const ready=async p=>{
    await p.waitForFunction(()=>window.ferrumEngine&&document.querySelector('[data-pixel-recovery]'));
    await p.waitForFunction(async()=> (await indexedDB.databases()).some(db=>db.name==='ferrum-pixel-recovery'));
  };
  const scene=p=>p.evaluate(()=>({patch:window.ferrumPlacementViewerState.draftPatch,history:window.ferrumPlacementViewerHistory}));
  const before=await scene(page);
  await ready(page);
  assert.equal((await rows(page)).length,0,'isolated browser context begins without recovery data');
  const rgba=(offset)=>Buffer.from(Array.from({length:12},(_,i)=>[i+offset,50+i,180-i,i%3?255:0]).flat()).toString('base64');
  const source={format:'ferrum2d.pixel-document',version:8,name:'복구-'+mode,width:4,height:3,colorSpace:'srgb',palette:['#12345600','#abcdef80'],
    layers:[{id:'body',name:'Body',visible:true,locked:false,opacity:128},{id:'shadow',name:'Shadow',visible:false,locked:true,opacity:33}],
    frames:[{id:'idle',durationMs:100,cels:[{layerId:'body',rgba:rgba(1)},{layerId:'shadow',rgba:rgba(30)}]},
      {id:'walk',durationMs:200,cels:[{layerId:'body',rgba:rgba(60)},{layerId:'shadow',rgba:rgba(90)}]}],
    tags:[{id:'move',name:'Move',clipId:0,frameIds:['idle','walk'],loop:false,direction:'reverse'}],initialTag:'move',nextClipId:1};
  async function openSource(p) {
    await showPlacementBottom(p,'assets');
    await p.locator('[data-pixel-file]').setInputFiles({name:'recovery.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});
    await workspace(p).waitFor({state:'visible'});
  }
  async function move(p,key,commit=true) {
    await clickPlacementToolAction(action(p,'tool-select'));const canvas=workspace(p).locator('canvas');await canvas.focus();
    await p.keyboard.press('Control+a');await p.keyboard.press(key);if(commit)await p.keyboard.press('Enter');
  }
  async function exported(p,suffix) {
    const menu=workspace(p).locator('.placement-pixel-export-menu');if(await menu.getAttribute('open')===null)await menu.locator('summary').click();
    const waiting=p.waitForEvent('download');await clickPlacementToolAction(action(p,'export-source'));const file=await waiting;
    const path=resolve(run,mode+'-recovery-'+suffix+'.pixel.json');await file.saveAs(path);await menu.locator('summary').click();
    return JSON.parse(await readFile(path,'utf8'));
  }
  async function recoveryMenu(p) {
    const menu=await workspace(p).isVisible()?workspace(p).locator('[data-pixel-recovery]'):p.locator('[data-pixel-launcher] [data-pixel-recovery]');
    if(await menu.getAttribute('open')===null)await menu.locator('summary').click();
    await clickPlacementToolAction(menu.locator('[data-pixel-action="recovery-refresh"]'));return menu;
  }
  await openSource(page);await move(page,'ArrowRight',false);
  await page.waitForTimeout(750);assert.equal((await rows(page)).length,0,'floating pixels are never checkpointed');
  await page.keyboard.press('Enter');
  const [saved]=await untilRows(page,r=>r.length===1),committed=JSON.parse(saved.source),expected=structuredClone(source);
  const original=Buffer.from(source.frames[0].cels[0].rgba,'base64'),shifted=Buffer.alloc(original.length);
  for(let y=0;y<3;y++)original.copy(shifted,(y*4+1)*4,y*4*4,(y*4+3)*4);
  expected.frames[0].cels[0].rgba=shifted.toString('base64');assert.deepEqual(committed,expected);
  assert.equal(await workspace(page).getAttribute('data-pixel-dirty'),'true');
  await move(page,'ArrowDown',false);await page.waitForTimeout(750);
  assert.deepEqual(JSON.parse((await rows(page))[0].source),committed);
  page.once('dialog',dialog=>dialog.accept());await page.reload();await ready(page);await showPlacementBottom(page,'assets');
  let menu=await recoveryMenu(page);const old=menu.locator('[data-pixel-recovery-id="'+saved.id+'"]');await old.waitFor();
  await clickPlacementToolAction(old.locator('[data-pixel-action="recovery-restore"]'));await workspace(page).waitFor({state:'visible'});
  assert.equal(await workspace(page).getAttribute('data-pixel-dirty'),'true');
  assert(await action(page,'normal-apply').isDisabled());assert(await action(page,'undo').isDisabled(),'restoration does not manufacture Undo history');
  const restored=await exported(page,'restored');assert.deepEqual(restored,committed);assert.deepEqual(await scene(page),before);
  await untilRows(page,r=>r.length===1&&r[0].id===saved.id);
  const other=await page.context().newPage();other.on('pageerror',e=>errors.push(String(e)));
  try {
    await other.goto(origin);await ready(other);await openSource(other);await move(other,'ArrowDown');
    let list=await untilRows(other,r=>r.length===2),second=list.find(r=>r.id!==saved.id);
    assert(second);assert.deepEqual(JSON.parse(list.find(r=>r.id===saved.id).source),committed);
    await other.evaluate(()=>{window.restoreRecoveryPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='checkpoints')throw new DOMException('full','QuotaExceededError');return window.restoreRecoveryPut.apply(this,args);};});
    await move(other,'ArrowRight');
    await other.waitForFunction(()=>document.querySelector('#placement-pixel-workspace [data-pixel-recovery-status]').textContent.includes('storage is full'));
    assert.deepEqual((await rows(other)).find(r=>r.id===second.id),second,'aborted write retains the last completed checkpoint');
    const manual=await exported(other,'quota-manual');assert.notDeepEqual(manual,JSON.parse(second.source),'manual source export remains available after a failed checkpoint');
    await other.evaluate(()=>{IDBObjectStore.prototype.put=window.restoreRecoveryPut;});
    await untilRows(other,r=>r.length===1&&r[0].id===saved.id);
    await move(other,'ArrowDown');list=await untilRows(other,r=>r.length===2);
    assert(list.some(r=>r.id!==saved.id),'editing after storage recovery can checkpoint again');
    assert.equal(await workspace(other).locator('[data-pixel-palette-list] option').count(),source.palette.length);
    await other.locator('[data-placement-close-document="ferrum:pixel-document"]').click();
    await clickPlacementToolAction(other.locator('dialog[open] [data-pixel-action="confirm-discard"]'));
    await untilRows(other,r=>r.length===1&&r[0].id===saved.id);
    assert.equal(await workspace(other).locator('[data-pixel-palette-list] option').count(),0,'closed source clears palette UI and its editor cache');
    assert.equal(await workspace(other).locator('[data-pixel-recent-colors] button').count(),0);
  } finally {await other.close();}
  // Exercise actual Tool.destroy before the 600ms debounce can run. The source
  // must be captured while the host still owns its editor, not in a later task.
  const closing=await page.context().newPage();closing.on('pageerror',e=>errors.push(String(e)));
  let teardown;
  try {
    await closing.goto(origin);await ready(closing);await openSource(closing);
    await clickPlacementToolAction(action(closing,'tool-select'));await workspace(closing).locator('[data-pixel-canvas]').focus();
    await closing.keyboard.press('Control+a');
    await closing.evaluate(()=>{
      const canvas=document.querySelector('[data-pixel-canvas]');
      for(const code of ['ArrowRight','Enter'])canvas.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true}));
      window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));
    });
    assert.equal(await workspace(closing).count(),0,'pagehide releases the pixel workspace synchronously');
    teardown=(await untilRows(page,r=>r.length===2)).find(r=>r.id!==saved.id);
    assert.deepEqual(JSON.parse(teardown.source),expected,'teardown preserves the latest committed raw source');
  } finally {await closing.close();}
  menu=await recoveryMenu(page);
  await clickPlacementToolAction(menu.locator('[data-pixel-recovery-id="'+teardown.id+'"] [data-pixel-action="recovery-discard"]'));
  await untilRows(page,r=>r.length===1&&r[0].id===saved.id);
  // Corrupted stored JSON must neither replace the source nor create a scene edit.
  await rows(page,{...saved,source:'{',bytes:1});menu=await recoveryMenu(page);
  await clickPlacementToolAction(menu.locator('[data-pixel-recovery-id="'+saved.id+'"] [data-pixel-action="recovery-restore"]'));
  await page.waitForFunction(()=>document.querySelector('[data-pixel-status]').textContent.includes('Invalid pixel recovery data'));
  assert.deepEqual(await exported(page,'after-corrupt'),committed);assert.deepEqual(await scene(page),before);
  menu=await recoveryMenu(page);
  await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:840});
  menu=await recoveryMenu(page);
  assert.match(await menu.locator('summary').textContent(),/복구/);
  assert.equal(await menu.locator('[data-pixel-action="recovery-restore"]').textContent(),'복원');
  assert.equal(await menu.locator('[data-pixel-action="recovery-discard"]').textContent(),'폐기');
  assert(await workspace(page).evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:resolve(run,mode+'-pixel-recovery-ko-narrow.png'),fullPage:true});
  await clickPlacementToolAction(menu.locator('[data-pixel-recovery-id="'+saved.id+'"] [data-pixel-action="recovery-discard"]'));await untilRows(page,r=>!r.length);
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-placement-language]').selectOption('en');
  const denied=await page.context().newPage();denied.on('pageerror',e=>errors.push(String(e)));
  try {
    await denied.addInitScript(()=>Object.defineProperty(globalThis,'indexedDB',{get(){throw new DOMException('denied','SecurityError');}}));
    await denied.goto(origin);await denied.waitForFunction(()=>window.ferrumEngine);
    await showPlacementBottom(denied,'assets');await clickPlacementToolAction(denied.locator('[data-pixel-action="new"]'));
    await clickPlacementToolAction(denied.locator('dialog[open] [data-pixel-action="create"]'));await workspace(denied).waitFor({state:'visible'});
    await denied.waitForFunction(()=>document.querySelector('#placement-pixel-workspace [data-pixel-recovery-status]').textContent.includes('unavailable'));
    assert.equal((await exported(denied,'denied-manual')).format,'ferrum2d.pixel-document');
  } finally {await denied.close();}
  assert.deepEqual(errors,[]);assert.deepEqual(await scene(page),before);
  const currentMenu=workspace(page).locator('[data-pixel-recovery]');
  if(await currentMenu.getAttribute('open')!==null)await currentMenu.locator('summary').click();
  await clickPlacementToolAction(action(page,'tool-pencil'));await clickPlacementToolAction(action(page,'fit'));
  return {committedOnly:true,reloadRestoresExactV8:true,transparentRgbAndMetadata:true,restoredDirty:true,noSceneEdit:true,
    independentTabs:true,quotaRollbackAndManualExport:true,storageDeniedManualExport:true,corruptSourceRejected:true,
    explicitDiscard:true,exportClearsOwnedOnly:true,closeClearsOwned:true,closedPaletteCleared:true,teardownCapturesCommittedSource:true,localeAndNarrow:true};
}
