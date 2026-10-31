import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {decodePng} from '../../scripts/tools/pack-textures.mjs';

/** Real Worker output, isolated lighting, stale/cancel protection and paired scene application. */
export async function smokePixelNormals(page,mode,run,verify,persisted=false) {
  const workspace=page.locator('#placement-pixel-workspace'),action=name=>workspace.locator('[data-pixel-action="'+name+'"]');
  const idle=()=>page.waitForFunction(()=>document.querySelector('#placement-pixel-workspace').dataset.pixelBusy==='false');
  const menu=workspace.locator('.placement-pixel-export-menu');if(await menu.evaluate(e=>e.open))await menu.locator('summary').click();
  const rgba=(color,shift)=>{const bytes=Buffer.alloc(8*8*4);for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(Math.hypot(x-3.5-shift,y-3.5)<3)bytes.set(color,(y*8+x)*4);return bytes.toString('base64');};
  const source={format:'ferrum2d.pixel-document',version:5,name:'normal-sprite',width:8,height:8,colorSpace:'srgb',palette:['#0000ffff','#ff0000ff'],
    layers:[{id:'body',name:'Body',visible:true,locked:false}],frames:[{id:'blue',durationMs:100,cels:[{layerId:'body',rgba:rgba([0,0,255,255],0)}]},{id:'red',durationMs:200,cels:[{layerId:'body',rgba:rgba([255,0,0,255],0.5)}]}],
    tags:[{id:'idle',name:'idle',clipId:0,frameIds:['blue'],loop:true},{id:'walk',name:'walk',clipId:1,frameIds:['blue','red'],loop:false}],initialTag:'idle',nextClipId:2};
  await page.locator('[data-pixel-file]').setInputFiles({name:'normal-sprite.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});await idle();
  const controls=workspace.locator('.placement-pixel-normal-menu');await controls.locator('summary').click();
  assert(await action('normal-generate').evaluate(e=>e.scrollHeight<=e.clientHeight+1),'normal action labels must fit without overlapping the next button');
  const scene=()=>page.evaluate(()=>structuredClone(window.ferrumPlacementViewerState.draftPatch));
  const before=await scene();
  await page.evaluate(()=>{
    window.pixelNormalInputs=[];window.pixelNormalWorkers=new Set();const Original=window.Worker;window.restorePixelNormalWorkers=()=>{window.Worker=Original;};
    window.Worker=class extends Original{
      constructor(...args){super(...args);window.pixelNormalWorkers.add(this);}
      postMessage(message,...args){if(message.buffer){if(window.holdPixelNormalJob){window.heldPixelNormalJob=true;return;}window.pixelNormalInputs.push(Array.from(new Uint8Array(message.buffer)));}return super.postMessage(message,...args);}
      terminate(){window.pixelNormalWorkers.delete(this);return super.terminate();}
    };
  });
  try {
    const route='**/__ferrum-normal-generator/config.json';
    await page.route(route,route=>route.fulfill({status:503,body:'Unavailable'}));
    await action('normal-generate').click();await idle();await page.unroute(route);
    assert.deepEqual(await scene(),before,'generator failure cannot modify the scene');
    assert.match(await workspace.locator('[data-pixel-status]').textContent(),/unavailable/i);
    await action('normal-generate').click();await idle();
    assert.match(await workspace.locator('[data-pixel-status]').textContent(),/Normals generated/);
    assert.deepEqual(await scene(),before,'generation is explicit asset work, not a scene edit');
    assert.equal(await controls.locator('[data-pixel-normal-status]').getAttribute('data-stale'),'false');
    await page.evaluate(()=>{const original=window.btoa;window.normalUiEncodings=0;window.restoreNormalUiEncoding=()=>window.btoa=original;window.btoa=value=>{window.normalUiEncodings++;return original(value);};});
    try{await action('tool-eraser').click();await action('tool-pencil').click();assert.equal(await page.evaluate(()=>window.normalUiEncodings),0,'normal Apply validation must not encode all PNGs on tool changes');}
    finally{await page.evaluate(()=>window.restoreNormalUiEncoding());}
    const inputs=await page.evaluate(()=>window.pixelNormalInputs);
    assert.equal(inputs.length,2,'one Worker job per independent source frame');
    for(const [index,bytes] of inputs.entries()){
      const image=decodePng(Buffer.from(bytes));assert.equal(image.width,8);assert.equal(image.height,8);
      for(let i=0;i<image.pixels.length;i+=4)if(image.pixels[i+3])assert.equal(image.pixels[i+(index?2:0)],0,'neighbour frame colors cannot bleed into a crop');
    }
    await action('normal-preview').click();await idle();const dialog=page.locator('.placement-pixel-normal-dialog[open]');
    await dialog.waitFor();assert.equal(await dialog.locator('canvas').count(),3);
    const lighting=await dialog.locator('canvas').nth(2).evaluate(canvas=>{
      const gl=canvas.getContext('webgl2'),pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let difference=0;for(let y=0;y<192;y++)for(let x=0;x<192;x++){const a=(y*384+x)*4,b=(y*384+x+192)*4;if(pixels[a+3]>10&&Math.abs(pixels[a]-pixels[b])+Math.abs(pixels[a+1]-pixels[b+1])+Math.abs(pixels[a+2]-pixels[b+2])>8)difference++;}return {difference,error:gl.getError()};
    });
    assert.equal(lighting.error,0);assert(lighting.difference>20,'normal map must visibly change the isolated lighting');
    assert.deepEqual(await scene(),before,'lighting preview cannot change game state/camera or the scene');
    await page.screenshot({path:join(run,mode+'-pixel-normal-lighting.png'),fullPage:true});
    await dialog.locator('[data-pixel-action="normal-preview-close"]').click();
    await workspace.locator('[data-pixel-color]').fill('#ffffff');await action('tool-pencil').click();
    const canvas=workspace.locator('[data-pixel-canvas]');await page.evaluate(()=>new Promise(requestAnimationFrame));
    const point=await canvas.evaluate(e=>{const r=e.getBoundingClientRect(),z=Number(e.dataset.pixelZoom);return {x:r.x+Number(e.dataset.pixelOriginX)+3.5*z,y:r.y+Number(e.dataset.pixelOriginY)+3.5*z};});
    await page.mouse.click(point.x,point.y);
    assert.equal(await controls.locator('[data-pixel-normal-status]').getAttribute('data-stale'),'true');assert(await action('normal-apply').isDisabled());assert(await action('normal-preview').isDisabled());
    await action('undo').click();await action('normal-generate').click();await idle();
    assert.equal(await controls.locator('[data-pixel-normal-status]').getAttribute('data-stale'),'false');
    assert.equal(await page.evaluate(()=>window.pixelNormalInputs.length),2,'restored source reuses its immutable normal cache');
    const strength=controls.locator('[data-pixel-normal-strength]');await strength.fill('2');await strength.dispatchEvent('change');
    await page.evaluate(()=>{window.holdPixelNormalJob=true;window.heldPixelNormalJob=false;});
    await action('normal-generate').click();await page.waitForFunction(()=>window.heldPixelNormalJob);
    await action('normal-cancel').click();await idle();await page.evaluate(()=>window.holdPixelNormalJob=false);
    await strength.fill('1.5');await strength.dispatchEvent('change');assert.equal(await controls.locator('[data-pixel-normal-status]').getAttribute('data-stale'),'false');
    assert.deepEqual(await scene(),before,'cancel preserves the previous pair and scene');
    assert.equal(await page.evaluate(()=>window.pixelNormalWorkers.size),0);
    if(mode==='2d'){assert(await action('normal-apply').isDisabled());await action('apply').click();await idle();}
    else{await action('normal-apply').click();await idle();assert.match(await workspace.locator('[data-pixel-status]').textContent(),/color and normals applied/);assert(await action('apply').isDisabled(),'paired pixels cannot silently replace imagery without regenerating normals');}
    await menu.locator('summary').click();const waiting=page.waitForEvent('download');await action('export-assets').click();const file=await waiting,path=join(run,mode+'-pixel-normal-assets.json');await file.saveAs(path);await menu.locator('summary').click();
    const bundle=JSON.parse(await readFile(path,'utf8'));assert.equal(bundle.normalBindings.length,1);
    const pair=bundle.normalBindings[0];assert.equal(pair.report.format,'ferrum2d.pixel-normal.report');assert.deepEqual(pair.report.frames.map(frame=>({id:frame.id,rect:frame.rect})),[{id:'blue',rect:[0,0,8,8]},{id:'red',rect:[8,0,8,8]}]);
    assert.equal(bundle.manifest.textureOptions[pair.binding.textures.normal.asset].colorSpace,'none');
    const game=await verify(bundle);if(mode==='hd2d')assert.equal(game.normalMapping?.lightingChanged,true);
    const documentScope=await smokePixelNormalDocumentScope(page,mode,persisted);
    await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:840});
    assert.equal(await action('normal-generate').textContent(),'노멀 생성');assert(await workspace.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
    await page.screenshot({path:join(run,mode+'-pixel-normal-ko-narrow.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});await page.locator('[data-placement-language]').selectOption('en');
    return {source,id:pair.binding.textures.color.asset,normalId:pair.binding.textures.normal.asset,frameIsolation:true,previewLightingDifference:lighting.difference,
      generationDoesNotEditScene:true,staleBlocked:true,cancelPreservesPair:true,cacheReused:true,workersReleased:true,metadataOnlyValidation:true,documentScope,game};
  }finally{await page.evaluate(()=>window.restorePixelNormalWorkers?.());}
}

/** Short diagnostic entry; full gates also call the same assertions after earlier pixel work. */
export async function smokePixelNormalFocus(page,mode,run,verify,persisted=false) {
  const {showPlacementBottom}=await import('./placement-panel-navigation.mjs');await showPlacementBottom(page,'assets');
  await page.locator('[data-pixel-action="new"]').click();await page.locator('dialog[open] [data-pixel-action="create"]').click();
  const workspace=page.locator('#placement-pixel-workspace');await workspace.waitFor({state:'visible'});
  const menu=workspace.locator('.placement-pixel-export-menu');await menu.locator('summary').click();
  const waiting=page.waitForEvent('download');await workspace.locator('[data-pixel-action="export-source"]').click();const file=await waiting;await file.saveAs(join(run,mode+'-normal-focus-blank.json'));await menu.locator('summary').click();
  return smokePixelNormals(page,mode,run,verify,persisted);
}

/** View-only editor tabs cannot transfer document-owned generated GPU assets. */
async function smokePixelNormalDocumentScope(page,mode,persisted) {
  await page.locator('#placement-pixel-workspace [data-pixel-action="back"]').click();
  const original=await page.evaluate(()=>window.ferrumPlacementWorkspaceActiveDocument);
  const initialPatch=await page.evaluate(()=>structuredClone(window.ferrumPlacementViewerState.draftPatch));
  const document={format:'ferrum2d.consumer.scene-authoring',version:1,behaviorRecipes:{entities:{}},
    sceneComposition:{initialFragment:'main',prefabs:{object:{}},fragments:{main:{instances:[{id:'sprite',prefab:'object',x:0,y:0,
      props:{components:{collider:'none',layer:'wall',visual:{kind:'sprite',texture:'crate',width:32,height:32}}}}]}}}};
  if(mode==='hd2d')document.spatial={camera:{projection:'orthographic',position:{x:0,y:-200,elevation:80},target:{x:0,y:0,elevation:32},height:110,near:0.1,far:1200},terrain:[],billboards:{sprite:{}}};
  const name='pixel-normal-scope.json';
  if(persisted){
    const project=await page.evaluate(()=>window.ferrumPlacementViewerDesktop.projectPath),path=join(project,'public',name);
    await writeFile(path,JSON.stringify(document));
    const {showPlacementMenu}=await import('./placement-panel-navigation.mjs');
    await showPlacementMenu(page,'file');await page.locator('[data-placement-action="scene-explorer"]').click();
    await page.locator('.placement-scene-explorer:visible [data-placement-project-scene='+JSON.stringify(path)+']').dblclick();
  }else await page.locator('[data-placement-document-file]').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))});
  await page.waitForFunction(original=>!document.querySelector('.demo-shell').inert&&window.ferrumPlacementWorkspaceActiveDocument!==original&&window.ferrumPlacementWorkspaceActiveDocument!=='ferrum:pixel-document',original)
    .catch(async error=>{throw Error(String(error)+' '+JSON.stringify(await page.evaluate(()=>({tabs:window.ferrumPlacementWorkspaceDocuments,message:document.querySelector('.placement-workspace-message')?.textContent}))));});
  const sibling=await page.evaluate(()=>window.ferrumPlacementWorkspaceActiveDocument);
  await page.locator('[data-placement-document-key="ferrum:pixel-document"]').click();
  const workspace=page.locator('#placement-pixel-workspace'),action=name=>workspace.locator('[data-pixel-action="'+name+'"]');
  assert.equal(await action('normal-preview').isEnabled(),persisted,'only verified project pairs can be reused in another scene');
  assert.equal(await workspace.locator('[data-pixel-normal-status]').getAttribute('data-stale'),String(!persisted));
  if(persisted&&mode==='hd2d'){
    assert(await action('normal-apply').isEnabled());await action('normal-apply').click();
    await page.waitForFunction(()=>document.querySelector('#placement-pixel-workspace').dataset.pixelBusy==='false');
    assert.match(await workspace.locator('[data-pixel-status]').textContent(),/color and normals applied/);
    await page.evaluate(()=>window.ferrumPlacementViewerRefreshHandoff());
    assert.equal(await page.evaluate(()=>window.ferrumPlacementViewerAgentHandoff.normalBindings.length),1,'normal evidence belongs to the target scene');
    await action('back').click();await page.locator('[data-placement-action="undo"]').click();
  }
  await page.locator('[data-placement-document-key='+JSON.stringify(original)+']').click();
  await page.locator('[data-placement-close-document='+JSON.stringify(sibling)+']').click();
  await page.locator('[data-placement-document-key="ferrum:pixel-document"]').click();
  assert(await action('normal-preview').isEnabled(),'returning to the owner preserves the ready preview');
  assert.deepEqual(await page.evaluate(()=>window.ferrumPlacementViewerState.draftPatch),initialPatch);
  return {documentOwnedPairBlocked:!persisted,projectPairReused:persisted,ownerPreserved:true};
}

export async function reuseSavedPixelNormal(page) {
  const workspace=page.locator('#placement-pixel-workspace'),panel=workspace.locator('.placement-pixel-normal-menu');
  if(!await panel.evaluate(e=>e.open))await panel.locator('summary').click();
  await page.evaluate(()=>{const Base=window.Worker;window.restoredNormalWorkerCount=0;window.restoreSavedNormalWorkers=()=>window.Worker=Base;window.Worker=class extends Base{constructor(...args){super(...args);window.restoredNormalWorkerCount++;}};});
  try{
    await workspace.locator('[data-pixel-action="normal-generate"]').click();
    await page.waitForFunction(()=>document.querySelector('#placement-pixel-workspace').dataset.pixelBusy==='false');
    assert.match(await workspace.locator('[data-pixel-status]').textContent(),/Normals generated/);
    assert.equal(await panel.locator('[data-pixel-normal-status]').getAttribute('data-stale'),'false');
    assert.equal(await page.evaluate(()=>window.restoredNormalWorkerCount),0,'saved normal reuse must borrow the verified GPU texture without starting another Worker');
  }finally{await page.evaluate(()=>window.restoreSavedNormalWorkers());}
  return {restoredWithoutWorker:true};
}
