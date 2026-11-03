import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { trimFixture, verifyTrimBundle } from './aseprite-trim-fixture.mjs';
import { clickPlacementToolAction } from './placement-panel-navigation.mjs';

export async function smokeNativeTrim({getPage,mode,project,scene,initial,run,stage,action,tool,restart,close,invoke,freshGame}) {
  const idle=()=>getPage().waitForFunction(()=>document.querySelector('[data-placement-aseprite-tool]').dataset.asepriteBusy==='false');
  const apply=async name=>{await clickPlacementToolAction(action(name));await idle();};
  const draft=()=>getPage().evaluate(()=>structuredClone(window.ferrumPlacementViewerState.draftPatch));
  const imports=()=>getPage().evaluate(()=>structuredClone(window.ferrumPlacementViewerAgentHandoff.asepriteImports));
  const history=()=>getPage().evaluate(()=>window.ferrumPlacementViewerHistory.undoCount);
  const root=join(project,'public/assets/.ferrum-aseprite');
  const first=trimFixture(),next=trimFixture(1);
  await stage(first);
  await tool().getByLabel('Aseprite loop new clips',{exact:true}).uncheck();
  await tool().getByLabel('Aseprite initial animation',{exact:true}).selectOption('run');
  await apply('animation');assert.match(await tool().locator('[data-aseprite-status]').textContent(),/^Applied/);
  const firstId=(await imports())[0].assetId;
  await apply('save');assert.match(await tool().locator('[data-aseprite-status]').textContent(),/^Project saved/);
  const firstDraft=await draft(),firstHistory=await history();
  await stage(next);await apply('reimport-animation');
  assert.match(await tool().locator('[data-aseprite-status]').textContent(),/^Applied/);
  const changed=await draft();assert.equal(await history(),firstHistory+1);
  await getPage().locator('[data-placement-action="undo"]:visible').first().click();assert.deepEqual(await draft(),firstDraft);
  await getPage().locator('[data-placement-action="redo"]:visible').first().click();assert.deepEqual(await draft(),changed);
  await apply('save');assert.match(await tool().locator('[data-aseprite-status]').textContent(),/^Project saved/);
  const saved=JSON.parse(await readFile(scene,'utf8')),before=initial.sceneComposition.fragments.main.instances[0],after=saved.sceneComposition.fragments.main.instances[0];
  for(const key of ['x','y','rotationRadians','scale'])assert.equal(after[key],before[key]);
  for(const key of ['body','collider','layer'])assert.deepEqual(after.props.components[key],before.props.components[key]);
  for(const key of ['width','height','originX','originY','tint'])assert.deepEqual(after.props.components.visual[key],before.props.components.visual[key]);
  assert.deepEqual(after.props.components.visual.animationSet.clips.map(c=>c.id),[0,1]);
  const catalog=JSON.parse(await readFile(join(root,'catalog.json'),'utf8'));
  const files=[];for(const rev of catalog.revisions)for(const suffix of ['.json','.png','.source.png'])files.push({path:rev.assetId+suffix,base64:(await readFile(join(root,rev.assetId+suffix))).toString('base64')});
  const proof=verifyTrimBundle({revisions:catalog.revisions,files});
  assert.deepEqual(await readFile(join(root,firstId+'.source.png')),first.png);
  assert.deepEqual(JSON.parse(await readFile(join(root,firstId+'.json'),'utf8')),first.json);
  await restart();
  const restored=await imports();assert.equal(restored.length,1);assert.equal(restored[0].assetId,after.props.components.visual.texture);assert(restored.every(a=>a.persisted&&a.sourcePng));
  const game=await freshGame();assert.equal(game.trimRuntime.playingState,1);assert(game.trimRuntime.renderedUVs);assert(game.animation.visibleFrames>=2);
  const path=join(root,firstId+'.source.png'),raw=await readFile(path);
  await writeFile(path,Buffer.from('tampered original PNG'));
  try{await assert.rejects(invoke('load_placement_aseprite_assets',{projectPath:project}));}finally{await writeFile(path,raw);}
  await getPage().screenshot({path:join(run,mode+'-trim-restored-project.png'),fullPage:true});
  await close();
  return {mode,trim:proof,realRustStorageAndProtocol:true,sourceReopened:true,tamperedSourceRejected:true,originalBytesPreserved:true,pivotAndSizePreserved:true,clipIdsPreserved:true,singleUndoRedo:true,freshSession:game,released:{urls:0,textures:0}};
}
