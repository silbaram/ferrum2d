import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodePng } from '../../scripts/tools/pack-textures.mjs';
import { asTrimmed } from './aseprite-trim-fixture.mjs';
import { clickPlacementToolAction } from './placement-panel-navigation.mjs';

/** Actual normal Worker receives restored source canvases, never packed rectangles. */
export async function smokeTrimNormals({page,fixture,stage,tool,action,snapshot,undo,wait}) {
  const before=await snapshot();
  await stage(asTrimmed(fixture()));
  await tool.getByRole('tab',{name:'Preview',exact:true}).click();
  await tool.getByLabel('Aseprite frame',{exact:true}).selectOption('hero-idle.png');
  await page.evaluate(()=>{
    const Original=window.Worker;window.trimNormalInputs=[];window.trimNormalWorkers=new Set();window.restoreTrimWorkers=()=>{window.Worker=Original;};
    window.Worker=class extends Original {
      constructor(...args){super(...args);window.trimNormalWorkers.add(this);}
      postMessage(message,...args){if(message.buffer)window.trimNormalInputs.push(Array.from(new Uint8Array(message.buffer)));return super.postMessage(message,...args);}
      terminate(){window.trimNormalWorkers.delete(this);return super.terminate();}
    };
  });
  try {
    await clickPlacementToolAction(action('normals'));
    await wait(()=>document.querySelector('[data-placement-aseprite-tool]').dataset.asepriteBusy==='false');
    assert.match(await tool.locator('[data-aseprite-status]').textContent(),/^Applied normals/);
    const downloading=page.waitForEvent('download');await clickPlacementToolAction(action('export'));
    const bundle=JSON.parse(await readFile(await(await downloading).path(),'utf8'));
    const rev=bundle.revisions.find(r=>r.sourcePng),color=decodePng(Buffer.from(bundle.files.find(f=>f.path===rev.assetId+'.png').base64,'base64'));
    const captured=await page.evaluate(()=>({inputs:window.trimNormalInputs,workers:window.trimNormalWorkers.size}));
    assert.equal(captured.inputs.length,2);assert.equal(captured.workers,0);
    for(const [i,bytes] of captured.inputs.entries()) {
      const job=decodePng(Buffer.from(bytes)),frame=rev.frames[i];assert.equal(job.width,24);assert.equal(job.height,24);
      const expected=new Uint8Array(24*24*4);
      for(let y=0;y<24;y++)expected.set(color.pixels.subarray(((frame.y+y)*color.width+frame.x)*4,((frame.y+y)*color.width+frame.x+24)*4),y*24*4);
      assert.deepEqual(job.pixels,expected);
    }
    await undo();await wait(()=>document.querySelector('[data-placement-aseprite-tool]').dataset.asepriteBusy==='false');
    assert.deepEqual((await snapshot()).state.draftPatch,before.state.draftPatch);
    return {actualWorker:true,restoredFrameInputs:2,width:24,height:24,rgbaAndPaddingExact:true,normalUndoPreservesScene:true,workersReleased:true};
  } finally { await page.evaluate(()=>window.restoreTrimWorkers?.()); }
}
