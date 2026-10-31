import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Add tags to the owned animation; exercise cancellation before the one scene edit. */
export async function smokePixelTags(page, mode, run, verify) {
  const workspace=page.locator('#placement-pixel-workspace'),panel=workspace.locator('.placement-pixel-tags');
  const action=name=>workspace.locator('[data-pixel-action="'+name+'"]');
  const tagAction=name=>panel.locator('[data-pixel-tag-action="'+name+'"]');
  const idle=()=>page.waitForFunction(()=>document.querySelector('#placement-pixel-workspace').dataset.pixelBusy==='false');
  const frames=await workspace.locator('[data-pixel-frame-select]').evaluateAll(nodes=>nodes.map(node=>node.dataset.pixelFrameSelect));
  await panel.locator('summary').click();
  await tagAction('add').click();const first=await panel.locator('[data-pixel-tag-select]').inputValue();
  await panel.locator('[data-pixel-tag-name]').fill('idle');await panel.locator('[data-pixel-tag-name]').press('Enter');
  await panel.locator('[data-pixel-tag-name]').fill('');await panel.locator('[data-pixel-tag-name]').press('Enter');
  assert.equal(await panel.locator('[data-pixel-tag-name]').inputValue(),'idle','rejected names restore the last valid value');
  await panel.locator('[data-pixel-tag-frame="'+frames[0]+'"]').click();
  assert(await panel.locator('[data-pixel-tag-frame="'+frames[0]+'"]').isChecked(),'an empty tag is rejected and the checkbox restored');
  await tagAction('add').click();const second=await panel.locator('[data-pixel-tag-select]').inputValue();
  await panel.locator('[data-pixel-tag-name]').fill('walk');await panel.locator('[data-pixel-tag-name]').press('Enter');
  await panel.locator('[data-pixel-tag-frame="'+frames[1]+'"]').check();
  await panel.locator('[data-pixel-tag-loop]').uncheck();
  assert(await tagAction('initial').isEnabled());
  await page.screenshot({path:join(run,mode+'-pixel-tags.png'),fullPage:true});
  await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:840});
  assert.equal(await tagAction('add').textContent(),'태그 추가');
  assert(await workspace.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  assert(await tagAction('add').evaluate(e=>e.getBoundingClientRect().height<=36),'tag action labels cannot collapse into vertical text');
  await page.screenshot({path:join(run,mode+'-pixel-tags-ko-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-placement-language]').selectOption('en');
  await panel.locator('summary').click();
  const before=await page.evaluate(()=>window.ferrumPlacementViewerState.draftPatch);
  await action('apply').click();const dialog=page.locator('dialog[open]');await dialog.waitFor();
  assert.match(await dialog.textContent(),/Clips 0 → 0, 1/);
  await dialog.locator('[data-pixel-action="confirm-cancel"]').click();
  assert.deepEqual(await page.evaluate(()=>window.ferrumPlacementViewerState.draftPatch),before,'cancelling cannot alter the scene');
  await action('apply').click();await dialog.locator('[data-pixel-action="confirm-migrate"]').click();await idle();
  assert.match(await workspace.locator('[data-pixel-status]').textContent(),/animation applied/);
  const migrated=await page.evaluate(()=>window.ferrumPlacementViewerState.draftPatch);
  const operations=migrated.operations.filter(op=>op.kind==='updateComponents');
  const visual=operations.at(-1).components.visual;
  assert.deepEqual(visual.animationSet.clips.map(clip=>clip.id),[0,1]);
  assert.equal(visual.animationSet.initialClip,0);assert.equal(visual.animationSet.clips[1].loop,false);
  // Changing a tag's name leaves runtime clip IDs and sequence intact.
  await panel.locator('summary').click();await panel.locator('[data-pixel-tag-select]').selectOption(second);
  await panel.locator('[data-pixel-tag-name]').fill('run');await panel.locator('[data-pixel-tag-name]').press('Enter');
  await action('undo').click();
  assert.equal(await panel.locator('[data-pixel-tag-name]').inputValue(),'walk');
  await panel.locator('[data-pixel-tag-select]').selectOption(first);
  assert(await tagAction('initial').isDisabled());await panel.locator('summary').click();
  async function exported(kind,name) {
    const menu=workspace.locator('.placement-pixel-export-menu');if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();
    const waiting=page.waitForEvent('download');await action(kind).click();const download=await waiting,path=join(run,mode+'-tags-'+name);
    await download.saveAs(path);await menu.locator('summary').click();return {path,value:JSON.parse(await readFile(path,'utf8'))};
  }
  const saved=await exported('export-source','source.pixel.json');assert.equal(saved.value.version,5);
  const bundle=await exported('export-assets','assets.json');
  assert.deepEqual(bundle.value.assets.find(asset=>asset.id===visual.texture).source,saved.value);
  const game=await verify(bundle.value);assert.equal(game.taggedPlayback.clips,2);assert.equal(game.taggedPlayback.allClipsPlayed,true);
  // Opening the source confirms tag metadata is durable; view selection stays clean.
  await page.locator('[data-pixel-file]').setInputFiles(saved.path);await idle();
  assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false');
  await panel.locator('summary').click();
  assert.equal(await panel.locator('[data-pixel-tag-select] option').count(),3);
  await panel.locator('[data-pixel-tag-select]').selectOption(second);
  assert.equal(await panel.locator('[data-pixel-tag-name]').inputValue(),'walk');
  assert.equal(await panel.locator('[data-pixel-tag-loop]').isChecked(),false);
  await panel.locator('summary').click();
  await workspace.locator('[data-pixel-frame-action="play"]').click();
  await page.waitForFunction(id=>document.querySelector('.placement-pixel-frames').dataset.pixelPreviewFrame===id,frames[1]);
  await page.waitForTimeout(350);
  assert.equal(await workspace.locator('.placement-pixel-frames').getAttribute('data-pixel-preview-frame'),frames[1],'non-loop preview holds the last tagged frame');
  await workspace.locator('[data-pixel-frame-action="play"]').click();
  assert.deepEqual((await exported('export-source','preview-unchanged.pixel.json')).value,saved.value);
  return {source:saved.value,id:visual.texture,migrationCancelled:true,clipIdsPreserved:true,sourceReopen:true,locale:true,previewUnchanged:true,invalidInputRestored:true,game};
}
