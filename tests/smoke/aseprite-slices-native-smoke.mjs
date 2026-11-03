import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { trimFixture } from './aseprite-trim-fixture.mjs';
import { withSlices } from './aseprite-slices-fixture.mjs';
import { clickPlacementToolAction } from './placement-panel-navigation.mjs';
import { mergeScenePlacementPatch } from '../../packages/ferrum-web/dist/authoring.js';

export async function smokeNativeSlices({getPage,mode,project,scene,run,stage,action,tool,restart,close,freshGame}) {
  const idle=()=>getPage().waitForFunction(()=>document.querySelector('[data-placement-aseprite-tool]').dataset.asepriteBusy==='false');
  const click=async name=>{
    if(name==='pivot'){
      await tool().getByRole('tab',{name:'Preview',exact:true}).click();
      const panel=tool().locator('[data-aseprite-slices]');if(!await panel.evaluate(el=>el.open))await panel.locator('summary').click();
    }
    await clickPlacementToolAction(action(name));await idle();
  };
  const visual=async()=>{
    const document=JSON.parse(await readFile(scene,'utf8'));
    const draft=await getPage().evaluate(()=>window.ferrumPlacementViewerState.draftPatch);
    return (draft?mergeScenePlacementPatch(document,draft).document:document).sceneComposition.fragments.main.instances[0].props.components.visual;
  };
  const history=()=>getPage().evaluate(()=>window.ferrumPlacementViewerHistory.undoCount);
  const first=withSlices(trimFixture());
  await stage(first);await tool().getByLabel('Aseprite loop new clips',{exact:true}).uncheck();await tool().getByLabel('Aseprite initial animation',{exact:true}).selectOption('run');
  await click('animation');assert.match(await tool().locator('[data-aseprite-status]').textContent(),/^Applied/);
  await tool().locator('[data-aseprite-slices] > summary').click();
  await click('pivot');assert.match(await tool().locator('[data-aseprite-status]').textContent(),/^Origin applied/);
  const original=await visual();assert.equal(original.originX,.5);assert.equal(original.originY,22/24);
  await click('save');assert.match(await tool().locator('[data-aseprite-status]').textContent(),/^Project saved/);
  const root=join(project,'public/assets/.ferrum-aseprite'),catalog=JSON.parse(await readFile(join(root,'catalog.json'),'utf8'));
  assert.deepEqual(JSON.parse(await readFile(join(root,catalog.revisions[0].assetId+'.json'),'utf8')).meta.slices,first.json.meta.slices);
  await restart();assert.deepEqual(await visual(),original);
  // Inspect must reuse the packed original, not the restored runtime PNG.
  await click('inspect');assert.match(await tool().locator('[data-aseprite-status]').textContent(),/^Ready/);
  const next=withSlices(trimFixture(1),1);await stage(next);await click('reimport-animation');
  assert.match(await tool().locator('[data-aseprite-status]').textContent(),/^Applied/);
  const before=await visual(),count=await history();assert.equal(before.originX,.5);assert.equal(before.originY,22/24);
  await click('pivot');const after=await visual();assert.equal(after.originX,13/24);assert.equal(after.originY,22/24);assert.equal(await history(),count+1);
  await getPage().locator('[data-placement-action="undo"]:visible').first().click();assert.deepEqual(await visual(),before);
  await getPage().locator('[data-placement-action="redo"]:visible').first().click();assert.deepEqual(await visual(),after);
  const expected={...before,originX:13/24,originY:22/24};assert.deepEqual(after,expected);
  await click('save');assert.match(await tool().locator('[data-aseprite-status]').textContent(),/^Project saved/);
  const saved=JSON.parse(await readFile(scene,'utf8'));assert.deepEqual(saved.sceneComposition.fragments.main.instances[0].props.components.visual,after);
  await restart();assert.deepEqual(await visual(),after);
  await tool().getByRole('tab',{name:'Preview',exact:true}).click();
  const panel=tool().locator('[data-aseprite-slices]');if(!await panel.evaluate(el=>el.open))await panel.locator('summary').click();
  await getPage().screenshot({path:join(run,mode+'-saved-slice-origin.png'),fullPage:true});
  const game=await freshGame();assert.equal(game.trimRuntime.playingState,1);assert(game.animation.visibleFrames>=2);assert(game.trimRuntime.renderedUVs);
  await close();
  return {mode,slices:{realRustStorageAndProtocol:true,originalMetadataPreserved:true,trimReinspect:true,reopenedOrigin:[after.originX,after.originY],singleUndoRedo:true,reimportPreservedOrigin:true},freshSession:game,released:{urls:0,textures:0}};
}
