import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tileFixture,tileMapFixture} from './tile-import-fixtures.mjs';

export const tileAnimationClips={'terrain.0':{frames:[{frame:'terrain.0',durationMs:90},{frame:'terrain.1',durationMs:180}],loop:true}};

/** Sample the actual Playing scene, native clock/physics, and renderer command consumer. */
export async function sampleTileAnimation(page,cell,count) {
  return page.evaluate(async({cell,count})=>{
    const engine=window.ferrumEngine,renderer=window.ferrumRuntime.renderer;
    const query={originX:cell.x-9,originY:cell.y,directionX:1,directionY:0,maxDistance:10};
    const initialHits=engine.raycastBodies(query),handle=initialHits[0];
    if(!handle)throw Error('Animated tile collider missing');
    const frames=new Set(),uvs=new Set(),times=[],stats=[];
    const texture=engine.textureId(cell.props.components.visual.asset),original=renderer.renderCommands;
    // Existing packed render-command layout; copied numbers only, never retain Wasm views.
    const fields={u0:4,u1:6,texture:12};
    renderer.renderCommands=function(commands){
      const before=performance.now();
      try{return original.call(this,commands);}finally{
        times.push(performance.now()-before);
        for(let i=0;i<commands.commandCount;i++){
          const offset=i*commands.floatsPerCommand;
          if(commands.buffer[offset+fields.texture]===texture){uvs.add(commands.buffer[offset+fields.u0]+','+commands.buffer[offset+fields.u1]);break;}
        }
      }
    };
    try{
      for(let i=0;i<40;i++){
        await new Promise(requestAnimationFrame);
        const state=engine.dataSceneSpriteAnimationState(handle);
        if(!state)throw Error('Native tile clip missing');
        frames.add(state.frame);stats.push({...window.ferrumPlacementViewerRuntimeFrame,...renderer.stats()});
      }
      if(JSON.stringify(engine.raycastBodies(query))!==JSON.stringify(initialHits))throw Error('Animated tile collision changed');
      const rust=stats.map(s=>s.rustUpdateTimeMs);
      if(!rust.every(Number.isFinite)||!rust.some(ms=>ms>0))throw Error('Native update metric was not sampled');
      return{count,playing:engine.dataSceneState(),frames:[...frames],uvs:[...uvs],samples:times.length,averageRenderCpuMs:times.reduce((a,b)=>a+b,0)/times.length,averageRustUpdateMs:rust.reduce((a,b)=>a+b,0)/rust.length,maxRustUpdateMs:Math.max(...rust),maxDraws:Math.max(...stats.map(s=>s.drawCalls)),maxSwitches:Math.max(...stats.map(s=>s.textureSwitchCount)),minCommands:Math.min(...stats.map(s=>s.renderCommandCount)),minEntities:Math.min(...stats.map(s=>s.entityCount)),fixedCollision:true,handle};
    }finally{renderer.renderCommands=original;}
  },{cell,count});
}

export async function smokeTileAnimation({page,mode,stage,tool,action,click,document,snapshot,undo,redo,run}) {
  const settings=tool.getByLabel('Map placement options (JSON)',{exact:true}),time=tool.getByLabel('Map preview time (ms)',{exact:true});
  const source=async()=>{await tool.getByRole('tab',{name:'Source',exact:true}).click();await settings.locator('..').locator('..').evaluate(el=>{el.open=true;});};
  if(mode!=='2d'){
    await stage('tiled',false,tileMapFixture('tiled'));await source();await settings.fill(JSON.stringify({animations:tileAnimationClips}));
    assert(await action('map').isDisabled());assert(await action('preview-map').isDisabled());return{tileAnimation:{unsupportedSpatialRejected:true}};
  }
  const colors=async ms=>{
    await time.fill(String(ms));await click('preview-map');await page.waitForFunction(()=>document.querySelector('[data-tile-map-preview]').dataset.tileMapPreview==='ready');
    return tool.getByLabel('Tile map preview',{exact:true}).evaluate(c=>{
      const b=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let red=0,green=0;
      for(let i=0;i<b.length;i+=4){if(b[i]>b[i+1]*2)red++;if(b[i+1]>b[i]*2)green++;}return{red,green};
    });
  };
  const formats=[];
  for(const kind of ['tiled','ldtk']){
    const fixture=tileMapFixture(kind);
    if(kind==='tiled')fixture.json.tilesets[0].tiles=[{id:0,animation:[{tileid:0,duration:90},{tileid:1,duration:180}]}];
    await stage(kind,false,fixture);await source();
    const options={originX:-32,originY:-16,collisionLayers:['ground'],objectPrefabs:{Spawn:'map_spawn'},animations:kind==='tiled'?'source':tileAnimationClips};
    if(kind==='tiled')assert(await action('map').isDisabled());
    await settings.fill(JSON.stringify(options));const before=(await snapshot()).state.draftPatch;
    const step={frame:'terrain.0',durationMs:90};
    const oversized=JSON.stringify({objectPrefabs:options.objectPrefabs,animations:{'terrain.0':{frames:Array(256).fill(step)},'terrain.1':{frames:Array(172).fill(step)}}});
    assert(Buffer.byteLength(oversized)<=16384,'Options fit by themselves; the provenance envelope must trigger rejection');
    await settings.fill(oversized);
    assert(await action('map').isDisabled());assert(await action('preview-map').isDisabled());
    assert.match(await action('map').getAttribute('title'),/metadata.*16 KiB/);
    assert.deepEqual((await snapshot()).state.draftPatch,before);
    await settings.fill(JSON.stringify(options));
    const first=await colors(0),second=await colors(100),loop=await colors(280);
    assert(first.red>100&&second.red===0&&second.green>first.green);assert.deepEqual(loop,first);
    // Integer ms must stay exact at frame/cycle boundaries (1001 / 1000 * 1000 rounds down).
    const boundaryClips=structuredClone(tileAnimationClips);
    boundaryClips['terrain.0'].frames.forEach(frame=>{frame.durationMs=1001;});
    await settings.fill(JSON.stringify({...options,animations:boundaryClips}));
    assert.deepEqual(await colors(1000),first);
    assert.deepEqual(await colors(1001),second,'Exact frame boundary must show the next frame');
    assert.deepEqual(await colors(2002),first,'Exact cycle boundary must wrap to frame zero');
    boundaryClips['terrain.0'].loop=false;
    await settings.fill(JSON.stringify({...options,animations:boundaryClips}));
    assert.deepEqual(await colors(1001),second);
    assert.deepEqual(await colors(2002),second,'A non-loop clip must hold its last frame at completion');
    await settings.fill(JSON.stringify(options));
    assert.deepEqual((await snapshot()).state.draftPatch,before);
    for(const invalid of ['','-1','0.5','3600001']){
      await time.fill(invalid);assert(await action('preview-map').isDisabled());assert(await action('map').isEnabled());
    }
    assert.deepEqual(await colors(3600000),second);
    await time.fill('0');
    await page.locator('[data-placement-language]').selectOption('ko');assert(await tool.getByLabel('맵 미리보기 시간 (ms)',{exact:true}).isVisible());await page.locator('[data-placement-language]').selectOption('en');
    await colors(100);await tool.locator('[data-tile-map-preview]').screenshot({path:join(run,kind+'-preview-100ms.png')});
    await click('map');assert.match(await tool.locator('[data-tile-status]').textContent(),/^Applied/);
    const applied=(await snapshot()).state.draftPatch,cells=(await document()).sceneComposition.fragments.main.instances.filter(i=>i.props?.components?.visual?.animationSet);
    assert.equal(cells.length,2);assert(cells.every(c=>c.props.components.collider.type==='aabb'));
    await undo();assert.deepEqual((await snapshot()).state.draftPatch,before);await redo();assert.deepEqual((await snapshot()).state.draftPatch,applied);
    await page.locator('[data-placement-playback="play"]').click();await page.waitForFunction(()=>window.ferrumEngine.dataSceneState()==='playing');
    await page.evaluate(()=>window.ferrumEngine.setDataSceneCamera({x:0,y:0}));
    const sample=await sampleTileAnimation(page,cells[0],4);assert.deepEqual(sample.frames.sort(),[0,1]);
    await page.locator('[data-placement-playback="pause"]').click();
    const paused=await page.evaluate(handle=>window.ferrumEngine.dataSceneSpriteAnimationState(handle),sample.handle);
    await page.evaluate(async()=>{for(let i=0;i<8;i++)await new Promise(requestAnimationFrame);});
    assert.deepEqual(await page.evaluate(handle=>window.ferrumEngine.dataSceneSpriteAnimationState(handle),sample.handle),paused);
    await page.locator('[data-placement-playback="pause"]').click();
    await page.waitForFunction(({handle,elapsed})=>window.ferrumEngine.dataSceneSpriteAnimationState(handle)?.elapsedSeconds!==elapsed,{handle:sample.handle,elapsed:paused.elapsedSeconds});
    await page.locator('[data-placement-playback="stop"]').click();await undo();
    // Non-loop clips hold the final frame in both still preview and native gameplay.
    const once=structuredClone(tileAnimationClips);once['terrain.0'].loop=false;
    await source();await settings.fill(JSON.stringify({...options,animations:once}));const last=await colors(3000);assert.deepEqual(last,second);
    await click('map');await page.locator('[data-placement-playback="play"]').click();
    await page.waitForFunction(cell=>{
      const e=window.ferrumEngine,h=e.raycastBodies({originX:cell.x-9,originY:cell.y,directionX:1,directionY:0,maxDistance:10})[0];
      const state=h&&e.dataSceneSpriteAnimationState(h);
      return state?.finished===true&&state.frame===1;
    },cells[0]);
    await page.locator('[data-placement-playback="stop"]').click();await undo();
    formats.push({kind,previewTiming:true,exactPreviewBoundaries:true,metadataBudgetBeforeApply:true,loopAndNonLoop:true,nonLoopFinalFrame:true,nativeFrames:sample.frames,pauseResume:true,fixedCollision:true,oneUndo:true});
  }
  const budgets=[];
  await page.setViewportSize({width:2000,height:1400});
  for(const count of [64,512,2048]){
    const fixture=tileFixture('tiled'),columns=count===64?8:64,rows=count/columns;
    Object.assign(fixture.json,{width:columns,height:rows});Object.assign(fixture.json.layers[0],{width:columns,height:rows,data:Array(count).fill(1)});
    await stage('tiled',false,fixture);await source();await settings.fill(JSON.stringify({originX:-columns*8,originY:-rows*8,collisionLayers:['ground'],animations:tileAnimationClips}));
    const start=performance.now();await click('map');const applyMs=performance.now()-start;
    assert.match(await tool.locator('[data-tile-status]').textContent(),/^Applied/);
    const cells=(await document()).sceneComposition.fragments.main.instances.filter(i=>i.props?.components?.visual?.animationSet);assert.equal(cells.length,count);
    await page.locator('[data-placement-playback="play"]').click();await page.evaluate(()=>window.ferrumEngine.setDataSceneCamera({x:0,y:0}));
    await page.waitForFunction(count=>window.ferrumEngine.dataSceneState()==='playing'&&window.ferrumPlacementViewerRuntimeFrame.renderCommandCount>=count,count);
    const measured=await sampleTileAnimation(page,cells[0],count);
    assert.deepEqual(measured.frames.sort(),[0,1]);assert.equal(measured.uvs.length,2);assert(measured.samples>=20&&measured.minCommands>=count&&measured.minEntities>=count);
    assert(measured.playing==='playing'&&measured.maxDraws>0&&measured.maxDraws<=32&&measured.maxSwitches<=8&&measured.averageRenderCpuMs<50&&measured.averageRustUpdateMs<50&&applyMs<10000);
    budgets.push({...measured,applyMs});console.log('Animated map budget',budgets.at(-1));
    await page.locator('[data-placement-playback="stop"]').click();await undo();
  }
  return{tileAnimation:{formats,budgets}};
}
