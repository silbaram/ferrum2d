import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { withSlices } from './aseprite-slices-fixture.mjs';
import { asTrimmed } from './aseprite-trim-fixture.mjs';
import { mergeScenePlacementPatch } from '../../packages/ferrum-web/dist/authoring.js';
import { clickPlacementToolAction } from './placement-panel-navigation.mjs';

/** Already queued UI events must remain safe after synchronous workspace disposal. */
export async function teardownSlicePreview(page) {
  assert(await page.locator('[data-aseprite-action="pivot"]').isEnabled(), 'Teardown must exercise the live origin action');
  return page.evaluate(async()=>{
    const errors=[],element=document.querySelector('[data-aseprite-slices]');
    const rejected=event=>errors.push(String(event.reason?.stack??event.reason));
    const failed=event=>errors.push(String(event.error?.stack??event.message));
    window.addEventListener('unhandledrejection',rejected);
    window.addEventListener('error',failed);
    try {
      const toggled=new Promise((done,reject)=>{
        const timer=setTimeout(()=>reject(Error('Slice toggle did not drain')),2000);
        element.addEventListener('toggle',()=>{clearTimeout(timer);setTimeout(done,0);},{once:true});
      });
      const changed=new Promise(done=>setTimeout(()=>{
        element.querySelector('select').dispatchEvent(new Event('change'));
        element.querySelector('button').click();
        done();
      },0));
      element.open=!element.open;
      window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));
      await Promise.all([toggled,changed]);
      await new Promise(done=>setTimeout(done,0));
      return errors;
    } finally {
      window.removeEventListener('unhandledrejection',rejected);
      window.removeEventListener('error',failed);
    }
  });
}

export async function smokeAsepriteSlices({page,active,fixture,stage,tool,action,snapshot,undo,redo,wait,run,mode}) {
  const idle=()=>wait(()=>document.querySelector('[data-placement-aseprite-tool]').dataset.asepriteBusy==='false');
  const click=async name=>{await clickPlacementToolAction(action(name));await idle();};
  const doc=async()=>{const p=(await snapshot()).state.draftPatch;return p?mergeScenePlacementPatch(active,p).document:structuredClone(active);};
  const instance=d=>d.sceneComposition.fragments.main.instances[0];
  const visual=d=>instance(d).props.components.visual;
  await stage(withSlices(asTrimmed(fixture())));await click('apply');
  const before=await doc(),history=(await snapshot()).history.undoCount;
  const panel=tool.locator('[data-aseprite-slices]');await panel.locator('summary').click();
  await tool.getByLabel('Sprite slice',{exact:true}).selectOption('feet');
  await tool.getByLabel('Slice key frame',{exact:true}).selectOption('12');
  assert.deepEqual(await doc(),before,'metadata selection must not edit the scene');
  await click('pivot');
  const changed=await doc(),expected=structuredClone(before);Object.assign(visual(expected),{originX:.25,originY:1});
  assert.deepEqual(changed,expected);assert.equal((await snapshot()).history.undoCount,history+1);
  await undo();assert.deepEqual(await doc(),before);await redo();assert.deepEqual(await doc(),changed);
  await tool.getByLabel('Sprite slice',{exact:true}).selectOption('panel');assert(await action('pivot').isDisabled());
  assert.match(await action('pivot').getAttribute('title'),/no pivot/);
  await tool.getByLabel('Sprite slice',{exact:true}).selectOption('feet');
  await tool.getByLabel('Slice key frame',{exact:true}).selectOption('0');
  await stage(withSlices(asTrimmed(fixture(1)),1));await click('reimport');
  const reimported=await doc();assert.equal(visual(reimported).originX,.25);assert.equal(visual(reimported).originY,1);
  await tool.getByLabel('Slice key frame',{exact:true}).selectOption('0');await click('pivot');
  const reapplied=await doc();assert.equal(visual(reapplied).originX,13/24);assert.equal(visual(reapplied).originY,22/24);
  assert.equal(visual(reapplied).width,visual(before).width);assert.equal(visual(reapplied).height,visual(before).height);
  const bad=withSlices(asTrimmed(fixture(2)));bad.json.meta.slices[0].keys[0].center.w=4096;
  await stage(bad);assert(await action('pivot').isDisabled());assert(!(await action('apply').isDisabled()),'bad optional slices must not block ordinary frame import');
  await stage(withSlices(asTrimmed(fixture(1)),1));await tool.getByLabel('Slice key frame',{exact:true}).selectOption('0');
  const language=page.locator('[data-placement-language]');
  assert.equal(await language.count(),1);
  await language.selectOption('ko');assert.equal(await action('pivot').textContent(),'기준점 적용');await language.selectOption('en');
  await wait(()=>{
    const ctx=document.querySelector('.placement-aseprite-preview').getContext('2d');
    const p=ctx.getImageData(86,146,1,1).data;
    return p[0]>150&&p[1]>70&&p[1]>p[2]*1.5;
  });
  const previewPng=await tool.getByLabel('Aseprite frame preview',{exact:true}).evaluate(canvas=>canvas.toDataURL('image/png'));
  await writeFile(join(run,mode+'-slice-preview.png'),Buffer.from(previewPng.split(',')[1],'base64'));
  await panel.scrollIntoViewIfNeeded();await page.screenshot({path:join(run,mode+'-slice-origin.png'),fullPage:true});
  return {slices:{explicitSourceKey:12,origin:[13/24,22/24],onlyOriginChanged:true,singleUndoRedo:true,reimportPreservedOrigin:true,invalidMetadataIsolated:true,noPivotReadOnly:true,localizedControls:true,pivotOverlayPixels:true}};
}
