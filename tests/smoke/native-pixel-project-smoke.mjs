import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { showPlacementBottom } from './placement-panel-navigation.mjs';
import { createHash } from 'node:crypto';
import { filteredPixelPng } from './pixel-png-fixture.mjs';
import { smokePixelLayers } from './pixel-layers-smoke.mjs';

/** The browser calls actual Rust storage/protocol functions over the shared test transport. */
export async function smokeNativePixels({getPage,mode,project,scene,initial,run,invoke,setCorrupt,holdSave,waitHeld,releaseSave,restart,close,freshGame}) {
  let page=getPage();
  const workspace=()=>page.locator('#placement-pixel-workspace');
  const action=name=>workspace().locator('[data-pixel-action="'+name+'"]');
  const idle=()=>page.waitForFunction(()=>document.querySelector('#placement-pixel-workspace').dataset.pixelBusy==='false');
  const status=()=>workspace().locator('[data-pixel-status]').textContent();
  const save=async()=>{await action('save-project').click();await idle();};
  const root=join(project,'public/assets/.ferrum-pixels'),catalogPath=join(root,'catalog.json');
  await showPlacementBottom(page,'assets');
  await page.locator('[data-pixel-action="new"]').click();
  const dialog=page.locator('dialog[open]');
  await dialog.getByLabel('Pixel Name',{exact:true}).fill('native-pixel');
  await dialog.getByLabel('Pixel Width',{exact:true}).fill('8');
  await dialog.getByLabel('Pixel Height',{exact:true}).fill('8');
  await dialog.locator('[data-pixel-action="create"]').click();
  await workspace().waitFor({state:'visible'});
  await workspace().locator('[data-pixel-color]').fill('#0000ff');await action('tool-fill').click();
  async function point(x,y) {
    return workspace().locator('canvas').evaluate((e,p)=>{
      const r=e.getBoundingClientRect(),z=Number(e.dataset.pixelZoom);
      return {x:r.x+Number(e.dataset.pixelOriginX)+(p.x+0.5)*z,y:r.y+Number(e.dataset.pixelOriginY)+(p.y+0.5)*z};
    },{x,y});
  }
  await page.waitForFunction(()=>Number(document.querySelector('[data-pixel-canvas]').dataset.pixelZoom)>1);
  let p=await point(2,2);await page.mouse.click(p.x,p.y);
  await action('apply').click();await idle();
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
  assert.equal(source.layer.id,'layer-1');assert.equal(source.frame.id,'frame-1');assert.equal(source.palette.length,16);
  // A valid external catalog edit must conflict with the token captured when opened.
  const originalCatalog=await readFile(catalogPath);const externalCatalog=Buffer.concat([originalCatalog,Buffer.from('\n')]);
  await writeFile(catalogPath,externalCatalog);
  await workspace().locator('[data-pixel-color]').fill('#ff0000');await action('tool-pencil').click();
  p=await point(0,0);await page.mouse.click(p.x,p.y);await save();
  assert.match(await status(),/changed on disk/);assert.equal(await workspace().getAttribute('data-pixel-dirty'),'true');
  assert.deepEqual(await readFile(catalogPath),externalCatalog);assert.deepEqual(JSON.parse(await readFile(scene,'utf8')),saved);
  await writeFile(catalogPath,originalCatalog);await save();assert.match(await status(),/^Project saved/);
  assert.equal(JSON.parse(await readFile(catalogPath,'utf8')).revisions.length,2);
  // Source save and scene save have separate commit boundaries.
  await action('apply').click();await idle();
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
  holdSave();await action('save-project').click();await waitHeld();
  await action('back').click();releaseSave();
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
  const latest=lastCatalog.revisions.at(-1),target=page.locator('[data-placement-edit-pixels="'+latest.assetId+'"]');
  await target.click();await workspace().waitFor({state:'visible'});
  assert.equal(await workspace().getAttribute('data-pixel-dirty'),'false');
  const download=page.waitForEvent('download');
  await workspace().locator('.placement-pixel-export-menu > summary').click();
  await action('export-source').click();const file=await download;const exported=join(run,mode+'-restored.pixel.json');await file.saveAs(exported);
  const reopened=JSON.parse(await readFile(exported,'utf8'));
  assert.deepEqual(reopened,JSON.parse(await readFile(join(root,latest.assetId+'.json'),'utf8')));
  await workspace().locator('.placement-pixel-export-menu > summary').click();
  await save();assert.match(await status(),/^Project saved/);
  assert.equal((await readFile(join(root,assetId+'.json'))).toString(),raw,'resaving preserves the formatted immutable source bytes');
  assert.equal(JSON.parse(await readFile(catalogPath,'utf8')).revisions.length,4);
  const imageLayers=await smokePixelLayers(page,mode,run);
  await action('apply').click();await idle();await save();assert.match(await status(),/^Project saved/);
  const layeredCatalog=JSON.parse(await readFile(catalogPath,'utf8'));
  assert.equal(layeredCatalog.revisions.length,5);
  const layeredId=layeredCatalog.revisions.at(-1).assetId;
  assert.deepEqual(JSON.parse(await readFile(join(root,layeredId+'.json'),'utf8')),imageLayers.source);
  await restart();page=getPage();await showPlacementBottom(page,'assets');
  await page.locator('[data-placement-edit-pixels="'+layeredId+'"]').click();await workspace().waitFor({state:'visible'});
  assert.equal(await workspace().locator('[data-pixel-layer-select]').count(),2);
  assert.equal(await workspace().locator('[data-pixel-layer-name]').inputValue(),'Armor');
  const game=await freshGame();
  await close();
  return {mode,realRustStorageAndProtocol:true,sourceAndPngVerified:true,malformedReplyBlocksScene:true,
    imageLayers,catalogConflictPreserved:true,sceneConflictPreserved:true,immutableRevisions:5,lateSaveDoesNotSaveScene:true,
    nativePngAndFormattedSourceCompatible:true,immutableSourceBytesPreserved:true,
    freshRustAndBrowserSessions:true,restoredSourceExact:true,preservedPoseSizeColliderBody:true,
    savedManifestGame:game,released:{urls:0,textures:0}};
}
