import {smokePixelBlend} from "./pixel-blend-smoke.mjs";
import {smokePixelIndexed} from "./pixel-indexed-smoke.mjs";
import {smokePixelOpacity} from "./pixel-opacity-smoke.mjs";
import { smokePixelNormals, smokePixelNormalFocus, reuseSavedPixelNormal } from "./pixel-normals-smoke.mjs";
import { smokePixelTags } from "./pixel-tags-smoke.mjs";
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { showPlacementBottom, inspectPlacementAsset, clickPlacementToolAction } from './placement-panel-navigation.mjs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { filteredPixelPng } from './pixel-png-fixture.mjs';
import { smokePixelLayers } from './pixel-layers-smoke.mjs';
import { smokePixelAtlas } from './pixel-atlas-smoke.mjs';
import { smokePixelFrames, smokePixelFrameCard } from './pixel-frames-smoke.mjs';
import { smokePixelCapacity } from './pixel-capacity-smoke.mjs';

/** The browser calls actual Rust storage/protocol functions over the shared test transport. */
export async function smokeNativePixels({getPage,mode,project,scene,initial,run,invoke,setCorrupt,holdSave,waitHeld,releaseSave,restart,close,freshGame}) {
  let page=getPage();
  const workspace=()=>page.locator('#placement-pixel-workspace');
  const action=name=>workspace().locator('[data-pixel-action="'+name+'"]');
  const idle=()=>page.waitForFunction(()=>document.querySelector('#placement-pixel-workspace').dataset.pixelBusy==='false');
  const status=()=>workspace().locator('[data-pixel-status]').textContent();
  async function editAsset(id,frame){await inspectPlacementAsset(page,page.locator('[data-placement-browser-asset="sprite:'+id+(frame?'/'+frame:'')+'"]'));await page.locator('[data-placement-edit-pixels="'+id+'"]'+(frame?'[data-placement-edit-pixel-frame="'+frame+'"]':':not([data-placement-edit-pixel-frame])')).click();}
  const save=async()=>{await clickPlacementToolAction(action('save-project'));await idle();};
  async function recoveryRows() {
    return page.evaluate(()=>new Promise((resolve,reject)=>{
      const open=indexedDB.open('ferrum-pixel-recovery');open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{const db=open.result,tx=db.transaction('checkpoints'),get=tx.objectStore('checkpoints').getAll();
        tx.oncomplete=()=>{db.close();resolve(get.result);};tx.onabort=()=>{db.close();reject(tx.error);};};
    }));
  }
  async function waitRecovery(predicate) {
    for(let i=0;i<100;i++){const rows=await recoveryRows();if(predicate(rows))return rows;await page.waitForTimeout(50);}
    throw Error('Native pixel recovery lifecycle condition not reached');
  }
  async function saveNormalWithRecovery(bundle) {
    const source=bundle.assets.find(asset=>asset.id===bundle.normalBindings[0].binding.textures.color.asset).source;
    setCorrupt(true);try{await save();}finally{setCorrupt(false);}
    assert.match(await status(),/differs/);
    const rows=await waitRecovery(rows=>rows.some(row=>isDeepStrictEqual(JSON.parse(row.source),source)));
    const ids=rows.filter(row=>isDeepStrictEqual(JSON.parse(row.source),source)).map(row=>row.id);
    await save();assert.match(await status(),/^Project saved/);
    await waitRecovery(rows=>rows.filter(row=>ids.includes(row.id)).length<ids.length);
    return freshGame();
  }
  async function assertReopenedSource(expected) {
    const exports=workspace().locator('.placement-pixel-export-menu');if(!await exports.evaluate(e=>e.open))await exports.locator('summary').click();
    const waiting=page.waitForEvent('download');await clickPlacementToolAction(action('export-source'));const file=await waiting,path=join(run,mode+'-restored-new-tools.pixel.json');await file.saveAs(path);await exports.locator('summary').click();
    assert.deepEqual(JSON.parse(await readFile(path,'utf8')),expected,'native reopen must preserve the retained outline and multi-frame transform bytes');
  }
  const root=join(project,'public/assets/.ferrum-pixels'),catalogPath=join(root,'catalog.json');
  if(process.argv.includes('--pixel-indexed-only')) {
    const indexed=await smokePixelIndexed(page,mode,run,async()=>{await save();assert.match(await status(),/^Project saved/);return freshGame();});
    assert.deepEqual(JSON.parse(await readFile(join(root,indexed.id+'.json'),'utf8')),indexed.source);
    await restart();page=getPage();await showPlacementBottom(page,'assets');await editAsset(indexed.id,'frame-0');await workspace().waitFor({state:'visible'});await assertReopenedSource(indexed.source);
    const restoredGame=await freshGame();assert.equal(restoredGame.directionPlayback.clips[0].frames,2);await close();
    return {mode,focus:'pixel-indexed',indexed,restoredGame,realRustStorageAndProtocol:true,restoredSourceExact:true,freshRustAndBrowserSessions:true,released:{urls:0,textures:0}};
  }
  if(process.argv.includes('--pixel-opacity-only')||process.argv.includes('--pixel-blend-only')) {
    const helper=process.argv.includes('--pixel-blend-only')?smokePixelBlend:smokePixelOpacity;
    const opacity=await helper(page,mode,run,async()=>{await save();assert.match(await status(),/^Project saved/);return freshGame();});
    assert.deepEqual(JSON.parse(await readFile(join(root,opacity.id+'.json'),'utf8')),opacity.source);
    assert.deepEqual(JSON.parse(await readFile(join(root,opacity.tagged.id+'.json'),'utf8')),opacity.tagged.source);
    await restart();page=getPage();await showPlacementBottom(page,'assets');
    await editAsset(opacity.tagged.id,'frame-1');await workspace().waitFor({state:'visible'});await assertReopenedSource(opacity.tagged.source);
    await editAsset(opacity.id,'frame-1');await workspace().waitFor({state:'visible'});
    await assertReopenedSource(opacity.source);
    const restoredGame=await freshGame();assert.equal(restoredGame.directionPlayback.clips[0].frames,2);
    await close();
    return {mode,focus:helper===smokePixelBlend?'pixel-blend':'pixel-opacity',opacity,restoredGame,realRustStorageAndProtocol:true,restoredSourceExact:true,freshRustAndBrowserSessions:true,released:{urls:0,textures:0}};
  }
  if(process.argv.includes('--pixel-capacity-only')) {
    const capacity=await smokePixelCapacity(page,mode,run,async()=>{await save();assert.match(await status(),/^Project saved/);return freshGame();});
    assert.deepEqual(JSON.parse(await readFile(join(root,capacity.id+'.json'),'utf8')),capacity.source);
    await restart();page=getPage();await showPlacementBottom(page,'assets');
    await editAsset(capacity.id,'frame-63');await workspace().waitFor({state:'visible'});
    assert.equal(await workspace().locator('[data-pixel-frame-select][aria-pressed=true]').getAttribute('data-pixel-frame-select'),'frame-63');
    await assertReopenedSource(capacity.source);
    const restoredGame=await freshGame();assert.equal(restoredGame.capacityPlayback.visitedOriginalFrames,64);
    await close();
    return {mode,focus:'pixel-capacity',capacity,restoredGame,realRustStorageAndProtocol:true,restoredSourceExact:true,freshRustAndBrowserSessions:true,released:{urls:0,textures:0}};
  }
  if(process.argv.includes('--pixel-normals-only')) {
    const pixelNormals=await smokePixelNormalFocus(page,mode,run,saveNormalWithRecovery,true);
    await restart();page=getPage();await showPlacementBottom(page,'assets');
    await editAsset(pixelNormals.id);await workspace().waitFor({state:'visible'});
    await assertReopenedSource(pixelNormals.source);await reuseSavedPixelNormal(page);
    const restoredNormalGame=await freshGame();await close();
    return {mode,focus:'pixel-normals',pixelNormals,restoredNormalGame,realRustStorageAndProtocol:true,newToolsSourceExact:true,recoveryFailedSaveKept:true,recoverySavedSessionCleared:true,released:{urls:0,textures:0}};
  }
  await showPlacementBottom(page,'assets');
  await clickPlacementToolAction(page.locator('[data-pixel-action="new"]'));
  const dialog=page.locator('dialog[open]');
  await dialog.getByLabel('Pixel Name',{exact:true}).fill('native-pixel');
  await dialog.getByLabel('Pixel Width',{exact:true}).fill('8');
  await dialog.getByLabel('Pixel Height',{exact:true}).fill('8');
  await dialog.locator('[data-pixel-action="create"]').click();
  await workspace().waitFor({state:'visible'});
  await workspace().locator('[data-pixel-color]').fill('#0000ff');await clickPlacementToolAction(action('tool-fill'));
  async function point(x,y) {
    return workspace().locator('canvas').evaluate((e,p)=>{
      const r=e.getBoundingClientRect(),z=Number(e.dataset.pixelZoom);
      return {x:r.x+Number(e.dataset.pixelOriginX)+(p.x+0.5)*z,y:r.y+Number(e.dataset.pixelOriginY)+(p.y+0.5)*z};
    },{x,y});
  }
  await page.waitForFunction(()=>Number(document.querySelector('[data-pixel-canvas]').dataset.pixelZoom)>1);
  let p=await point(2,2);await page.mouse.click(p.x,p.y);
  // Save/reopen a resized source and an edited palette through the real native host.
  await clickPlacementToolAction(action('resize-canvas'));const resize=page.locator('dialog[open]');
  await resize.locator('[data-pixel-resize="width"]').fill('10');await resize.locator('[data-pixel-resize="height"]').fill('10');
  await resize.locator('[data-pixel-resize="anchor"]').selectOption('top-left');await resize.locator('[data-pixel-resize-confirm]').click();
  const palette=workspace().locator('.placement-pixel-palette-menu');await palette.locator('summary').click();
  await palette.locator('[data-pixel-palette-action="add"]').click();await palette.locator('summary').click();
  await clickPlacementToolAction(action('apply'));await idle();
  setCorrupt(true);await save();setCorrupt(false);
  assert.match(await status(),/differs/);
  assert.equal(await workspace().getAttribute('data-pixel-dirty'),'true');
  assert.deepEqual(JSON.parse(await readFile(scene,'utf8')),initial,'unverified reply cannot save scene');
  await save();assert.match(await status(),/^Project saved/);
  assert.equal(await workspace().getAttribute('data-pixel-dirty'),'false');
  const saved=JSON.parse(await readFile(scene,'utf8')),catalog=JSON.parse(await readFile(catalogPath,'utf8'));
  assert.equal(catalog.revisions.length,1);
  const first=saved.sceneComposition.fragments.main.instances[0];
  assert.match(first.props.components.visual.texture,/^pixel\./);
  for(const key of ['x','y','rotationRadians','scale'])assert.equal(first[key],initial.sceneComposition.fragments.main.instances[0][key]);
  for(const key of ['collider','body','layer'])assert.deepEqual(first.props.components[key],initial.sceneComposition.fragments.main.instances[0].props.components[key]);
  for(const key of ['width','height','originX','originY'])assert.equal(first.props.components.visual[key],initial.sceneComposition.fragments.main.instances[0].props.components.visual[key]);
  const id=catalog.revisions[0].assetId,source=JSON.parse(await readFile(join(root,id+'.json'),'utf8'));
  assert.equal(source.layer.id,'layer-1');assert.equal(source.frame.id,'frame-1');assert.equal(source.palette.length,17);assert.equal(source.palette.at(-1),'#0000ffff');assert.equal(source.width,10);assert.equal(source.height,10);
  const sourceBytes=Buffer.from(source.rgba,'base64');
  for(let y=0;y<10;y++)for(let x=0;x<10;x++)assert.deepEqual([...sourceBytes.subarray((y*10+x)*4,(y*10+x+1)*4)],x<8&&y<8?[0,0,255,255]:[0,0,0,0]);
  const resizedGame=await freshGame();
  // A valid external catalog edit must conflict with the token captured when opened.
  const originalCatalog=await readFile(catalogPath);const externalCatalog=Buffer.concat([originalCatalog,Buffer.from('\n')]);
  await writeFile(catalogPath,externalCatalog);
  await workspace().locator('[data-pixel-color]').fill('#ff0000');await clickPlacementToolAction(action('tool-pencil'));
  p=await point(0,0);await page.mouse.click(p.x,p.y);await save();
  assert.match(await status(),/changed on disk/);assert.equal(await workspace().getAttribute('data-pixel-dirty'),'true');
  assert.deepEqual(await readFile(catalogPath),externalCatalog);assert.deepEqual(JSON.parse(await readFile(scene,'utf8')),saved);
  await writeFile(catalogPath,originalCatalog);await save();assert.match(await status(),/^Project saved/);
  assert.equal(JSON.parse(await readFile(catalogPath,'utf8')).revisions.length,2);
  // Source save and scene save have separate commit boundaries.
  await clickPlacementToolAction(action('apply'));await idle();
  const previousScene=await readFile(scene);await writeFile(scene,JSON.stringify({...saved,externalEdit:true}));
  await save();assert.match(await status(),/changed|conflict/i);
  assert.equal(await workspace().getAttribute('data-pixel-dirty'),'false','source really committed even if scene failed');
  assert.equal(JSON.parse(await readFile(scene,'utf8')).externalEdit,true);
  await writeFile(scene,previousScene);await save();assert.match(await status(),/^Project saved/);
  await page.screenshot({path:join(run,mode+'-pixel-project.png'),fullPage:true});
  // The native transaction may commit before cancellation reaches the UI.
  const committedScene=await readFile(scene);
  await workspace().locator('[data-pixel-color]').fill('#00ff00');
  p=await point(1,1);await page.mouse.click(p.x,p.y);
  holdSave();await clickPlacementToolAction(action('save-project'));await waitHeld();
  await clickPlacementToolAction(action('back'));releaseSave();
  await page.waitForFunction(()=>!document.querySelector('[data-pixel-action="new"]').disabled);
  assert.deepEqual(await readFile(scene),committedScene,'late native completion cannot save the scene after leaving the source');
  assert.match(await page.locator('[data-pixel-launcher]').textContent(),/interrupted/);
  // Independently encoded PNG and formatted source are valid native inputs too.
  const prior=JSON.parse(await readFile(catalogPath,'utf8')).revisions.at(-1);
  const original=JSON.parse(await readFile(join(root,prior.assetId+'.json'),'utf8'));
  const raw=JSON.stringify(original,null,2).replace(/"(version|width|height|durationMs)": (\d+)/g,(_,key,value)=>'"'+key+'": '+value+'.0')+'\n';
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const assetId='pixel.'+hash(JSON.stringify([prior.identityDocument,raw])).slice(0,24);
  const png=filteredPixelPng(original.width,original.height,Buffer.from(original.rgba,'base64'),true);
  const metadata={...prior,assetId,jsonSha256:hash(raw),pngSha256:hash(png)};
  await invoke('save_placement_pixel_assets',{projectPath:project,bundle:{
    format:'ferrum2d.pixel-project.assets',version:1,overwrite:false,expectedCatalogRevision:hash(await readFile(catalogPath)),
    revisions:[metadata],manifest:{textures:{[assetId]:assetId+'.png'},textureOptions:{[assetId]:{colorSpace:'srgb'}}},
    files:[{path:assetId+'.json',mediaType:'application/json',sha256:hash(raw),base64:Buffer.from(raw).toString('base64')},
      {path:assetId+'.png',mediaType:'image/png',sha256:hash(png),base64:png.toString('base64')}],
  }});
  await restart();page=getPage();
  await showPlacementBottom(page,'assets');
  // Select the saved revision card by its stable ID rather than runtime texture number.
  const lastCatalog=JSON.parse(await readFile(catalogPath,'utf8'));
  const latest=lastCatalog.revisions.at(-1);
  await editAsset(latest.assetId);await workspace().waitFor({state:'visible'});
  assert.equal(await workspace().getAttribute('data-pixel-dirty'),'false');
  const download=page.waitForEvent('download');
  await workspace().locator('.placement-pixel-export-menu > summary').click();
  await clickPlacementToolAction(action('export-source'));const file=await download;const exported=join(run,mode+'-restored.pixel.json');await file.saveAs(exported);
  const reopened=JSON.parse(await readFile(exported,'utf8'));
  assert.deepEqual(reopened,JSON.parse(await readFile(join(root,latest.assetId+'.json'),'utf8')));
  await workspace().locator('.placement-pixel-export-menu > summary').click();
  await save();assert.match(await status(),/^Project saved/);
  assert.equal((await readFile(join(root,assetId+'.json'))).toString(),raw,'resaving preserves the formatted immutable source bytes');
  assert.equal(JSON.parse(await readFile(catalogPath,'utf8')).revisions.length,4);
  const imageLayers=await smokePixelLayers(page,mode,run);
  const imageFrames=await smokePixelFrames(page,mode,run);
  await clickPlacementToolAction(action('apply'));await idle();await save();assert.match(await status(),/^Project saved/);
  const layeredCatalog=JSON.parse(await readFile(catalogPath,'utf8'));
  assert.equal(layeredCatalog.revisions.length,5);
  const layeredId=layeredCatalog.revisions.at(-1).assetId;
  assert.deepEqual(JSON.parse(await readFile(join(root,layeredId+'.json'),'utf8')),imageFrames.source);
  await restart();page=getPage();await showPlacementBottom(page,'assets');
  await editAsset(layeredId);await workspace().waitFor({state:'visible'});
  assert.equal(await workspace().locator('[data-pixel-layer-select]').count(),2);
  assert.equal(await workspace().locator('[data-pixel-layer-name]').inputValue(),'Armor');
  assert.equal(await workspace().locator('[data-pixel-frame-select]').count(),2);
  const downloadFrames=page.waitForEvent('download');await workspace().locator('.placement-pixel-export-menu > summary').click();await clickPlacementToolAction(action('export-source'));
  const frameFile=await downloadFrames,framePath=join(run,mode+'-restored-frames.pixel.json');await frameFile.saveAs(framePath);
  assert.deepEqual(JSON.parse(await readFile(framePath,'utf8')),imageFrames.source);
  const game=await freshGame();
  const frameCard=await smokePixelFrameCard(page,mode,run,layeredId,imageFrames.source);
  const tags=await smokePixelTags(page,mode,run,async()=>{await save();assert.match(await status(),/^Project saved/);return freshGame();});
  assert.deepEqual(JSON.parse(await readFile(join(root,tags.id+'.json'),'utf8')),tags.source);
  await restart();page=getPage();await showPlacementBottom(page,'assets');
  await editAsset(tags.id);await workspace().waitFor({state:'visible'});
  const tagReopen=page.waitForEvent('download');await workspace().locator('.placement-pixel-export-menu > summary').click();await clickPlacementToolAction(action('export-source'));
  const tagFile=await tagReopen,tagPath=join(run,mode+'-restored-tags.pixel.json');await tagFile.saveAs(tagPath);
  assert.deepEqual(JSON.parse(await readFile(tagPath,'utf8')),tags.source);
  await workspace().locator('.placement-pixel-export-menu > summary').click();
  const atlas=await smokePixelAtlas(page,mode,run,JSON.parse(await readFile(scene,'utf8')),async()=>{
    await save();assert.match(await status(),/^Project saved/);return freshGame();
  });
  await save();assert.match(await status(),/^Project saved/);
  assert.equal(JSON.parse(await readFile(catalogPath,'utf8')).revisions.length,7);
  assert.deepEqual(JSON.parse(await readFile(join(root,atlas.id+'.json'),'utf8')),atlas.source);
  await restart();page=getPage();await showPlacementBottom(page,'assets');
  await editAsset(atlas.id,'right');
  await workspace().waitFor({state:'visible'});assert.equal(await workspace().locator('[data-pixel-atlas-frame]').inputValue(),'right');
  const atlasDownload=page.waitForEvent('download');await workspace().locator('.placement-pixel-export-menu > summary').click();await clickPlacementToolAction(action('export-source'));
  const atlasFile=await atlasDownload,atlasPath=join(run,mode+'-restored-atlas.pixel.json');await atlasFile.saveAs(atlasPath);
  assert.deepEqual(JSON.parse(await readFile(atlasPath,'utf8')),atlas.source);
  await workspace().locator('.placement-pixel-export-menu > summary').click();
  const pixelNormals=await smokePixelNormals(page,mode,run,saveNormalWithRecovery,true);
  assert.equal(JSON.parse(await readFile(catalogPath,'utf8')).revisions.length,8);
  const normalCatalog=JSON.parse(await readFile(join(project,'public/assets/.ferrum-normals/catalog.json'),'utf8'));assert.equal(normalCatalog.entries.length,1);
  await restart();page=getPage();await showPlacementBottom(page,'assets');
  await editAsset(pixelNormals.id);await workspace().waitFor({state:'visible'});
  await assertReopenedSource(pixelNormals.source);await reuseSavedPixelNormal(page);
  const restoredNormalGame=await freshGame();assert(restoredNormalGame.normalMapping?.lightingChanged);
  await close();
  return {mode,realRustStorageAndProtocol:true,newToolsSourceExact:true,sourceAndPngVerified:true,malformedReplyBlocksScene:true,recoveryFailedSaveKept:true,recoverySavedSessionCleared:true,
    frameCard,tags,atlas,pixelNormals,restoredNormalGame,imageLayers,imageFrames,catalogConflictPreserved:true,sceneConflictPreserved:true,immutableRevisions:8,lateSaveDoesNotSaveScene:true,
    nativePngAndFormattedSourceCompatible:true,immutableSourceBytesPreserved:true,resizedCanvasAndPaletteSaved:true,resizedGame,
    freshRustAndBrowserSessions:true,restoredSourceExact:true,preservedPoseSizeColliderBody:true,
    savedManifestGame:game,released:{urls:0,textures:0}};
}
