import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {clickPlacementToolAction,showPlacementBottom} from './placement-panel-navigation.mjs';
import {pixelCapacitySource} from './pixel-capacity-fixture.mjs';

/** Actual authoring controls, source reopen and an independent native runtime. */
export async function smokePixelAnimationTools(page,mode,run,verify) {
  await showPlacementBottom(page,'assets');
  const workspace=page.locator('#placement-pixel-workspace'),tags=workspace.locator('.placement-pixel-tags');
  const frames=workspace.locator('.placement-pixel-frames'),canvas=workspace.locator('canvas');
  const action=key=>workspace.locator('[data-pixel-action="'+key+'"]');let serial=0;
  const source=pixelCapacitySource({count:9,side:16,layers:1,version:5});
  source.name='direction-tools';source.frames.forEach((frame,i)=>{
    frame.durationMs=(i+1)*100;const bytes=Buffer.alloc(16*16*4);
    if(i<3)for(let p=0;p<bytes.length;p+=4)bytes.set([[0,0,255,255],[255,0,0,255],[0,255,0,255]][i],p);
    else if(i!==4)bytes.set([255,255,255,255],(i*16+i)*4);
    frame.cels[0].rgba=bytes.toString('base64');
  });
  source.tags=Array.from({length:4},(_,i)=>({id:'tag-'+i,name:['Forward','Reverse','Ping Once','Ping Loop'][i],clipId:i,frameIds:source.frames.slice(0,3).map(f=>f.id),loop:i===3}));
  source.initialTag='tag-0';source.nextClipId=4;
  async function open(value) {
    await page.locator('[data-pixel-file]').setInputFiles({name:'directions.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
    await workspace.waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelectorAll('[data-pixel-frame-select]').length===9);
  }
  async function exported(kind='export-source') {
    const menu=workspace.locator('.placement-pixel-export-menu');if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();
    const waiting=page.waitForEvent('download');await clickPlacementToolAction(action(kind));const file=await waiting,path=join(run,mode+'-animation-'+serial+++'.json');await file.saveAs(path);
    if(await menu.evaluate(e=>e.open))await menu.locator('summary').click();return JSON.parse(await readFile(path,'utf8'));
  }
  const beforeScene=await page.evaluate(()=>window.ferrumPlacementViewerState.draftPatch);
  await open(source);await tags.locator('summary').click();
  const select=tags.locator('[data-pixel-tag-select]'),direction=tags.locator('[data-pixel-tag-direction]');
  await select.selectOption('tag-1');await direction.selectOption('reverse');let saved=await exported();assert.equal(saved.version,7);assert.equal(saved.tags[1].direction,'reverse');
  await clickPlacementToolAction(action('undo'));assert.deepEqual(await exported(),source);await clickPlacementToolAction(action('redo'));assert.deepEqual(await exported(),saved);
  for(const id of ['tag-2','tag-3']){await select.selectOption(id);await direction.selectOption('pingpong');}
  saved=await exported();assert.deepEqual(saved.tags.map(t=>t.direction),[undefined,'reverse','pingpong','pingpong']);
  await open(saved);await tags.locator('summary').click();await select.selectOption('tag-1');assert.equal(await direction.inputValue(),'reverse');
  await tags.locator('summary').click();await frames.locator('[data-pixel-frame-select="frame-0"]').click();
  const initialPreview=await frames.locator('[data-pixel-frame-action="play"]').evaluate(button=>{button.click();return button.closest('.placement-pixel-frames').dataset.pixelPreviewFrame;});
  assert.equal(initialPreview,'frame-2','tag preview begins at the native initial frame');
  await page.waitForFunction(()=>document.querySelector('.placement-pixel-frames').dataset.pixelPreviewFrame==='frame-0');
  await page.waitForTimeout(200);assert.equal(await frames.getAttribute('data-pixel-preview-frame'),'frame-0');
  await frames.locator('[data-pixel-frame-action="play"]').click();assert.deepEqual(await exported(),saved);
  const menu=frames.locator('.placement-pixel-onion-menu');await frames.locator('[data-pixel-frame-select="frame-4"]').click();await menu.locator('summary').click();
  await menu.locator('[data-pixel-onion=enabled]').check();
  const ghosts=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));return JSON.parse(await canvas.getAttribute('data-pixel-onion-frames'));};
  assert.equal((await ghosts()).length,2);
  const before=await canvas.evaluate(e=>e.toDataURL());
  for(const key of ['previousCount','nextCount']) {
    const input=menu.locator('[data-pixel-onion-range="'+key+'"]');await input.fill('4');await input.dispatchEvent('change');
  }
  assert.equal((await ghosts()).length,8);assert.equal((await ghosts())[0].distance,4);
  assert.notEqual(await canvas.evaluate(e=>e.toDataURL()),before,'expanded onion range changes actual canvas pixels');
  const previous=menu.locator('[data-pixel-onion-range="previousCount"]');await previous.fill('5');await previous.dispatchEvent('change');assert.equal(await previous.inputValue(),'4');
  await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:840});
  assert.equal(await previous.getAttribute('aria-label'),'이전 프레임 수');assert(await workspace.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:join(run,mode+'-onion-range-ko-narrow.png'),fullPage:true});await menu.locator('summary').click();await tags.locator('summary').click();
  assert.equal(await direction.getAttribute('aria-label'),'재생 방향');await page.screenshot({path:join(run,mode+'-tag-direction-ko-narrow.png'),fullPage:true});
  await tags.locator('summary').click();await page.setViewportSize({width:1440,height:1000});await page.locator('[data-placement-language]').selectOption('en');
  assert.deepEqual(await exported(),saved);assert.deepEqual(await page.evaluate(()=>window.ferrumPlacementViewerState.draftPatch),beforeScene);
  await clickPlacementToolAction(action('apply'));await page.waitForFunction(()=>document.querySelector('#placement-pixel-workspace').dataset.pixelBusy==='false');
  const bundle=await exported('export-assets'),game=await verify(bundle);assert.equal(game.directionPlayback.clips.length,4);assert.equal(game.directionPlayback.playingState,1);
  await open(saved);await menu.locator('summary').click();assert.equal(await previous.inputValue(),'1','view preferences reset on source reopen');
  assert.equal(await menu.locator('[data-pixel-onion=enabled]').isChecked(),false);await menu.locator('summary').click();
  const sceneAfterApply=await page.evaluate(()=>window.ferrumPlacementViewerState.draftPatch);
  await page.evaluate(()=>{
    const selectors=[
      ['[data-pixel-onion-range="previousCount"]','change'],['[data-pixel-onion-opacity]','input'],
      ['[data-pixel-onion=enabled]','change'],['[data-pixel-tag-direction]','change'],
      ['[data-pixel-tag-name]','keydown'],['[data-pixel-tag-select]','change'],
      ['[data-pixel-tag-action=add]','click'],['[data-pixel-frame-action=add]','click'],
      ['[data-pixel-frame-action=play]','click'],['[data-pixel-frame-duration]','change'],
      ['[data-pixel-frame-duration]','keydown'],
      ['[data-pixel-frame-select="frame-2"]','click',true],
      ['[data-pixel-frame-select="frame-2"]','keydown',true],
      ['[data-pixel-tag-frame="frame-2"]','change',true],
    ];
    const controls=selectors.map(([selector,type,row])=>{
      const node=document.querySelector(selector);if(!node)throw Error('Missing lifecycle control '+selector);
      return {node,type,row};
    });
    window.pixelAnimationLateEvents=rowsOnly=>{
      for(const {node,type,row} of controls){
        if(rowsOnly&&!row)continue;
        node.dispatchEvent(type==='keydown'?new KeyboardEvent(type,{code:row?'End':'Escape'}):new Event(type));
      }
    };
  });
  await page.locator('[data-placement-close-document="ferrum:pixel-document"]').click();
  await workspace.waitFor({state:'hidden'});
  await page.evaluate(()=>window.pixelAnimationLateEvents(false));
  assert.equal(await frames.locator('[data-pixel-frame-select]').count(),0,'late events cannot repopulate a closed panel');
  assert.equal(await tags.locator('[data-pixel-tag-frame]').count(),0);
  assert.deepEqual(await page.evaluate(()=>window.ferrumPlacementViewerState.draftPatch),sceneAfterApply);
  await open(saved);await tags.locator('summary').click();await select.selectOption('tag-1');
  const name=tags.locator('[data-pixel-tag-name]');await name.fill('Uncommitted tag name');
  await page.evaluate(()=>window.pixelAnimationLateEvents(true));
  assert.equal(await name.inputValue(),'Uncommitted tag name','detached rows cannot reset an active input draft');
  assert.equal(await frames.getAttribute('data-pixel-preview-frame'),'frame-0','detached frame rows cannot select in a reopened document');
  await name.press('Escape');
  if(!await tags.evaluate(e=>e.open))await tags.locator('summary').click();
  assert.deepEqual(await exported(),saved,'detached tag rows cannot edit a reopened document');
  await direction.selectOption('forward');assert.equal((await exported()).tags[1].direction,undefined,'reused controls remain editable');
  await clickPlacementToolAction(action('undo'));assert.deepEqual(await exported(),saved);await tags.locator('summary').click();
  return {v7Reopen:true,legacyUndo:true,previewDirection:true,onionRange:4,onionPixels:true,viewOnly:true,localeAndNarrow:true,lateEventsIgnored:true,clearReopen:true,game};
}
