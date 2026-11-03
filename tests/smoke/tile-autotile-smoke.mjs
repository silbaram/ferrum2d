import assert from 'node:assert/strict';
import {tileMapFixture,tileFixture} from './tile-import-fixtures.mjs';
import {join} from 'node:path';

export const autotileRules={ground:{rules:[{match:'filled',neighbors:{n:'empty'},output:'terrain.1'}]}};
async function holdPreviewBitmap(page) {
  await page.evaluate(()=>{
    const original=window.createImageBitmap;
    const pending=[];
    const probe=window.tilePreviewBitmapProbe={created:0,closed:0,release:()=>pending.splice(0).forEach(done=>done()),restore:()=>{window.createImageBitmap=original;}};
    window.createImageBitmap=async(...args)=>{
      const bitmap=await original(...args),close=bitmap.close.bind(bitmap);
      bitmap.close=()=>{probe.closed++;close();};probe.created++;
      await new Promise(resolve=>{pending.push(resolve);});return bitmap;
    };
  });
}
async function releasePreviewBitmap(page) {
  await page.evaluate(()=>window.tilePreviewBitmapProbe.release());
  await page.waitForFunction(()=>window.tilePreviewBitmapProbe.closed===1);
  await page.evaluate(()=>window.tilePreviewBitmapProbe.restore());
}
export async function smokeTileAutotile({page,mode,stage,tool,action,click,document,snapshot,undo,redo,run}) {
  const settings=tool.getByLabel('Map placement options (JSON)',{exact:true});
  const source=async()=>{await tool.getByRole('tab',{name:'Source',exact:true}).click();await settings.locator('..').locator('..').evaluate(el=>{el.open=true;});};
  const preview=async()=>{await source();await click('preview-map');await page.waitForFunction(()=>document.querySelector('[data-tile-map-preview]').dataset.tileMapPreview==='ready');};
  if(mode!=='2d') {
    await stage('tiled',false,tileMapFixture('tiled'));await source();await settings.fill(JSON.stringify({autotile:autotileRules}));
    assert(await action('map').isDisabled());assert(await action('preview-map').isDisabled());
    return {autotile:{unsupportedSpatialRejected:true}};
  }
  const formats=[];
  for(const kind of ['tiled','ldtk']) {
    await stage(kind,false,tileMapFixture(kind));await source();
    const options={originX:-80,originY:-16,collisionLayers:['ground'],objectPrefabs:{Spawn:'map_spawn'},autotile:autotileRules};
    const baseline=(await snapshot()).state.draftPatch;
    await settings.fill(JSON.stringify(options));await preview();
    assert.deepEqual((await snapshot()).state.draftPatch,baseline);
    const pixels=await tool.getByLabel('Tile map preview',{exact:true}).evaluate(c=>{
      const bytes=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let green=0,red=0;
      for(let i=0;i<bytes.length;i+=4){if(bytes[i+1]>bytes[i]*2)green++;if(bytes[i]>bytes[i+1]*2)red++;}return{green,red};
    });assert(pixels.green>100&&pixels.red>100,'preview must draw baked and unchanged tile colors');
    const language=page.locator('[data-placement-language]');await language.selectOption('ko');assert.equal(await action('preview-map').textContent(),'맵 미리보기');await language.selectOption('en');
    await page.screenshot({path:join(run,kind+'-autotile-preview.png'),fullPage:true});
    await settings.fill(JSON.stringify({...options,autotile:{typo:{rules:[]}}}));
    assert(await action('map').isDisabled());assert.equal(await tool.locator('[data-tile-map-preview]').getAttribute('data-tile-map-preview'),'stale');
    assert.deepEqual((await snapshot()).state.draftPatch,baseline);
    await settings.fill(JSON.stringify(options));
    // A decoded bitmap can finish after another input invalidates the requested image.
    await holdPreviewBitmap(page);await click('preview-map');
    await page.waitForFunction(()=>window.tilePreviewBitmapProbe.created===1);
    const concurrent=await action('preview-map').evaluate(async button=>{
      for(let i=0;i<8;i++)button.dispatchEvent(new MouseEvent('click'));
      await new Promise(done=>setTimeout(done,50));
      return window.tilePreviewBitmapProbe.created;
    });
    assert.equal(concurrent,1,'Preview requests must keep at most one bitmap decode in flight');
    assert(await action('preview-map').isDisabled());
    await settings.fill(JSON.stringify({...options,autotile:{typo:{rules:[]}}}));
    await releasePreviewBitmap(page);
    assert.equal(await tool.locator('[data-tile-map-preview]').getAttribute('data-tile-map-preview'),'stale');
    assert(await tool.getByLabel('Tile map preview',{exact:true}).isHidden());
    assert.deepEqual((await snapshot()).state.draftPatch,baseline);
    await settings.fill(JSON.stringify(options));await click('map');
    assert.match(await tool.locator('[data-tile-status]').textContent(),/^Applied/);
    const applied=(await snapshot()).state.draftPatch,doc=await document(),cells=doc.sceneComposition.fragments.main.instances.filter(i=>i.props?.tileMapImport?.cell);
    assert.equal(cells.length,4);assert.deepEqual(cells[0].props.tileMapImport.options.autotile,autotileRules);
    assert(cells.every(i=>i.props.components.collider.type==='aabb'));
    await undo();assert.deepEqual((await snapshot()).state.draftPatch,baseline);await redo();assert.deepEqual((await snapshot()).state.draftPatch,applied);
    await stage(kind,true,tileMapFixture(kind,true));await click('map');
    const updated=await document(),next=updated.sceneComposition.fragments.main.instances.filter(i=>i.props?.tileMapImport?.cell);
    assert.equal(next.length,5);for(const c of cells)assert(next.some(n=>n.id===c.id));
    const top=next.filter(i=>i.props.tileMapImport.cell.row===0);
    assert(top.every(i=>i.props.components.visual.frame.u0===1/3&&i.props.components.visual.frame.u1===2/3));
    await undo();assert.deepEqual((await snapshot()).state.draftPatch,applied);await undo();assert.deepEqual((await snapshot()).state.draftPatch,baseline);
    formats.push({kind,previewPixels:pixels,previewNoMutation:true,invalidRulesAtomic:true,staleBitmapReleased:true,previewDecodeBounded:true,undoRedo:true,stableFrameReimport:true});
  }
  const budgets=[];
  await page.setViewportSize({width:2000,height:1400});
  for(const count of [64,512,2048]) {
    console.log('Autotile scale start',count);
    const f=tileFixture('tiled'),columns=count===64?8:64,rows=count/columns;
    Object.assign(f.json,{width:columns,height:rows});Object.assign(f.json.layers[0],{width:columns,height:rows,data:Array(count).fill(1)});
    await stage('tiled',false,f);await source();
    await settings.fill(JSON.stringify({originX:-columns*8,originY:-rows*8,collisionLayers:['ground'],autotile:autotileRules}));
    const start=performance.now();await preview();const previewMs=performance.now()-start;
    const applyStart=performance.now();await click('map');const applyMs=performance.now()-applyStart;
    assert.match(await tool.locator('[data-tile-status]').textContent(),/^Applied/);
    console.log('Autotile scale applied',{count,previewMs,applyMs});
    const cells=(await document()).sceneComposition.fragments.main.instances.filter(i=>i.props?.tileMapImport?.cell);assert.equal(cells.length,count);
    await page.locator('[data-placement-playback="play"]').click();
    // The shared import fixture starts at (800, 480); measure this centered map
    // with an explicit gameplay camera, independently of the editing camera.
    await page.evaluate(()=>window.ferrumEngine.setDataSceneCamera({x:0,y:0}));
    try {
      await page.waitForFunction(count=>window.ferrumEngine.dataSceneState()==='playing'&&window.ferrumPlacementViewerRuntimeFrame.renderCommandCount>=count,count);
    } catch(error) {
      console.error('Autotile gameplay diagnostics',await page.evaluate(()=>({state:window.ferrumEngine.dataSceneState(),frame:window.ferrumPlacementViewerRuntimeFrame,camera:[window.ferrumEngine.cameraX(),window.ferrumEngine.cameraY()],warnings:window.ferrumPlacementViewerState?.validation})));
      throw error;
    }
    const measured=await page.evaluate(async({count,columns,rows})=>{
      const renderer=window.ferrumRuntime.renderer,original=renderer.renderCommands,times=[],frames=[];
      renderer.renderCommands=function(...args){const before=performance.now();try{return original.apply(this,args);}finally{times.push(performance.now()-before);}};
      try {
        for(let i=0;i<30;i++){await new Promise(requestAnimationFrame);frames.push({...window.ferrumPlacementViewerRuntimeFrame,...renderer.stats()});}
        const hits=window.ferrumEngine.raycastBodies({originX:-columns*8-8,originY:-rows*8+8,directionX:1,directionY:0,maxDistance:columns*16+16});
        return{count,playing:window.ferrumEngine.dataSceneState(),samples:times.length,averageRenderCpuMs:times.reduce((a,b)=>a+b,0)/times.length,maxRenderCpuMs:Math.max(...times),maxDraws:Math.max(...frames.map(f=>f.drawCalls)),maxSwitches:Math.max(...frames.map(f=>f.textureSwitchCount)),minCommands:Math.min(...frames.map(f=>f.renderCommandCount)),entities:Math.min(...frames.map(f=>f.entityCount)),collisionHits:hits.length};
      }finally{renderer.renderCommands=original;}
    },{count,columns,rows});
    assert.equal(measured.playing,'playing');assert(measured.samples>=20&&measured.minCommands>=count&&measured.entities>=count);
    assert(measured.maxDraws>0&&measured.maxDraws<=32&&measured.maxSwitches<=8);assert(measured.averageRenderCpuMs<50);assert(measured.collisionHits>=columns);
    assert(previewMs<10000&&applyMs<10000);budgets.push({...measured,previewMs,applyMs});
    console.log('Autotile scale measured',measured);
    await page.locator('[data-placement-playback="stop"]').click();await undo();
  }
  await source();await holdPreviewBitmap(page);await click('preview-map');
  await page.waitForFunction(()=>window.tilePreviewBitmapProbe.created===1);
  assert.equal(await tool.locator('input[type="file"]').count(),3);
  for(const name of ['inspect','register','export'])assert(await action(name).isEnabled(),'Teardown must exercise live '+name);
  const pending=await tool.locator('[data-tile-map-preview]').elementHandle();
  const lateEvents=await tool.evaluate(async element=>{
    const errors=[],failed=event=>errors.push(String(event.error?.stack??event.message)),rejected=event=>errors.push(String(event.reason?.stack??event.reason));
    window.addEventListener('error',failed);window.addEventListener('unhandledrejection',rejected);
    try {
      const drained=new Promise(done=>setTimeout(()=>{
        for(const input of element.querySelectorAll('input, select, textarea'))
          for(const type of ['input','change'])input.dispatchEvent(new Event(type));
        for(const button of element.querySelectorAll('[data-tile-action]'))button.click();
        setTimeout(done,0);
      },0));
      window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));await drained;
      return errors;
    }finally{window.removeEventListener('error',failed);window.removeEventListener('unhandledrejection',rejected);}
  });
  assert.deepEqual(lateEvents,[],'Queued tile controls must not access disposed drafts');
  await releasePreviewBitmap(page);
  assert(await pending.evaluate(el=>el.querySelector('canvas').hidden&&el.dataset.tileMapPreview!=='ready'));
  await pending.dispose();
  return {autotile:{formats,budgets,disposedBitmapReleased:true,disposedControlsIgnored:true}};
}
