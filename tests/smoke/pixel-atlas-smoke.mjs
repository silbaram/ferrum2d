import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mergeScenePlacementPatch } from '../../packages/ferrum-web/dist/authoring.js';
import { decodePng, encodePngRgba } from '../../scripts/tools/pack-textures.mjs';

/** Real editor input, immutable atlas revision, UV patch and restored editing source. */
export async function smokePixelAtlas(page, mode, run, base, verify) {
  const workspace=page.locator('#placement-pixel-workspace'),canvas=workspace.locator('canvas');
  const action=name=>workspace.locator('[data-pixel-action="'+name+'"]');
  async function exported(kind,name) {
    const menu=workspace.locator('.placement-pixel-export-menu');
    if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();
    const waiting=page.waitForEvent('download');await action(kind).click();const download=await waiting,path=join(run,mode+'-atlas-'+name);
    await download.saveAs(path);if(await menu.evaluate(e=>e.open))await menu.locator('summary').click();return {path,bytes:await readFile(path)};
  }
  const restore=await exported('export-source','restore.pixel.json');
  const patch=await page.evaluate(()=>window.ferrumPlacementViewerState.draftPatch);
  const original=patch?mergeScenePlacementPatch(base,patch).document:structuredClone(base);
  const instance=original.sceneComposition.fragments.main.instances[0],components=instance.props.components;
  const pixels=Buffer.alloc(8*4*4);
  for(let i=0;i<pixels.length;i+=4){pixels[i]=12;pixels[i+1]=34;pixels[i+2]=56;pixels[i+3]=i%16===0?0:255;}
  const source={format:'ferrum2d.pixel-document',version:4,name:'fixed-atlas',width:8,height:4,colorSpace:'srgb',
    layer:{id:'layer-1',name:'Layer 1'},frame:{id:'frame-1',durationMs:100},palette:['#0000ffff'],rgba:pixels.toString('base64'),
    atlas:{texture:components.visual.texture,frames:[
      {id:'left',frame:{u0:0,v0:0,u1:0.5,v1:1}},
      {id:'right',frame:{u0:0.5,v0:0,u1:1,v1:1}},
    ]}};
  await action('back').click();
  const importer=page.locator('[data-placement-aseprite-tool]');
  if(!await importer.evaluate(e=>e.open))await importer.locator(':scope > summary').click();
  await importer.getByRole('tab',{name:'Source',exact:true}).click();
  await importer.getByLabel('Aseprite asset name',{exact:true}).fill('external-atlas');
  const entry=x=>({frame:{x,y:0,w:4,h:4},rotated:false,trimmed:false,spriteSourceSize:{x:0,y:0,w:4,h:4},sourceSize:{w:4,h:4},duration:100});
  await importer.getByLabel('Aseprite JSON',{exact:true}).setInputFiles({name:'external.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({
    frames:{left:entry(0),right:entry(4)},meta:{image:'external.png',size:{w:8,h:4}},
  }))});
  await importer.getByLabel('Aseprite PNG',{exact:true}).setInputFiles({name:'external.png',mimeType:'image/png',buffer:encodePngRgba(8,4,pixels)});
  await importer.locator('[data-aseprite-action="inspect"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-placement-aseprite-tool]').dataset.asepriteBusy==='false');
  assert.equal(await importer.getAttribute('data-aseprite-ready'),'true');await importer.locator('[data-aseprite-action="register"]').click();
  const external=page.locator('[data-placement-edit-pixel-frame="right"]');await external.waitFor();
  source.atlas.texture=await external.getAttribute('data-placement-edit-pixels');
  const target=structuredClone(components);target.visual.texture=source.atlas.texture;target.visual.asset=source.atlas.texture;delete target.visual.animationSet;delete target.visual.animation;
  target.visual.frame=source.atlas.frames[1].frame;
  await page.evaluate(({id,components})=>window.ferrumPlacementViewerUpdateComponents(id,components),{id:instance.id,components:target});
  // Hold only the cold atlas decode, then reactivate and edit the previous document.
  await page.evaluate(()=>{
    const Native=globalThis.DecompressionStream;window.atlasDecodeFinished=false;
    window.restoreAtlasDecoder=()=>{globalThis.DecompressionStream=Native;};
    globalThis.DecompressionStream=class {
      constructor(format){const native=new Native(format),reader=native.readable.getReader();let held=false;
        this.writable=native.writable;this.readable=new ReadableStream({
          async pull(controller){if(!held){held=true;window.atlasDecodeHeld=true;await new Promise(resolve=>window.releaseAtlasDecoder=resolve);}
            const value=await reader.read();if(value.done){window.atlasDecodeFinished=true;controller.close();}else controller.enqueue(value.value);},
          cancel(){window.atlasDecodeFinished=true;return reader.cancel();},
        });
      }
    };
  });
  await external.click();await page.waitForFunction(()=>window.atlasDecodeHeld);
  await page.locator('[data-placement-document-key="ferrum:pixel-document"]').click();await workspace.waitFor({state:'visible'});
  await action('tool-pencil').click();await workspace.locator('[data-pixel-color]').fill('#ff00ff');
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  const mark=await canvas.evaluate(e=>{const r=e.getBoundingClientRect(),z=Number(e.dataset.pixelZoom);return {x:r.x+Number(e.dataset.pixelOriginX)+1.5*z,y:r.y+Number(e.dataset.pixelOriginY)+1.5*z};});
  await page.mouse.click(mark.x,mark.y);assert.equal(await workspace.getAttribute('data-pixel-dirty'),'true');
  await page.evaluate(()=>{window.restoreAtlasDecoder();window.releaseAtlasDecoder();});
  await page.waitForFunction(()=>window.atlasDecodeFinished);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('dialog[open]').count(),0,'stale atlas decode must not ask to discard the newly edited source');
  assert.equal(await workspace.getAttribute('data-pixel-atlas'),'false');assert.equal(await workspace.getAttribute('data-pixel-dirty'),'true');
  await action('undo').click();await action('back').click();
  await external.click();await workspace.waitFor({state:'visible'});
  const initial=JSON.parse((await exported('export-source','imported.pixel.json')).bytes);
  assert.equal(initial.version,4);assert.equal(initial.rgba,source.rgba);assert.deepEqual(initial.atlas,source.atlas);
  const select=workspace.locator('[data-pixel-atlas-frame]');assert.equal(await select.inputValue(),'right');
  await select.selectOption('left');await select.selectOption('right');
  assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false');
  assert(await workspace.locator('.placement-pixel-frames').isHidden());assert(await workspace.locator('.placement-pixel-layers').isHidden());
  await workspace.locator('[data-pixel-color]').fill('#0000ff');await action('tool-pencil').click();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-pixel-canvas]').dataset.pixelRegion).x===4);
  async function point(x,y) {
    return canvas.evaluate((e,p)=>{const r=e.getBoundingClientRect(),z=Number(e.dataset.pixelZoom);return {
      x:r.x+Number(e.dataset.pixelOriginX)+(p.x+0.5)*z,y:r.y+Number(e.dataset.pixelOriginY)+(p.y+0.5)*z};},{x,y});
  }
  const start=await point(0,1),end=await point(8,1);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y);await page.mouse.up();
  const edited=JSON.parse((await exported('export-source','edited.pixel.json')).bytes),output=Buffer.from(edited.rgba,'base64');
  assert.deepEqual(edited.atlas,source.atlas);
  for(let y=0;y<4;y++)for(let x=0;x<8;x++) {
    const i=(y*8+x)*4;
    assert.deepEqual(output.subarray(i,i+4),x>=4&&y===1?Buffer.from([0,0,255,255]):pixels.subarray(i,i+4));
  }
  await action('undo').click();assert.equal(JSON.parse((await exported('export-source','undo.pixel.json')).bytes).rgba,source.rgba);
  await action('redo').click();
  assert.deepEqual(JSON.parse((await exported('export-source','redo.pixel.json')).bytes),edited);
  await select.selectOption('left');assert.equal(await workspace.getAttribute('data-pixel-dirty'),'false');
  assert(await action('apply').isDisabled(),'UV mismatch cannot apply to a different frame');
  await select.selectOption('right');
  const png=decodePng((await exported('export-png','sheet.png')).bytes);
  assert.deepEqual(new Uint8Array(png.pixels),new Uint8Array(output));assert.equal(png.width,8);assert.equal(png.height,4);
  await action('apply').click();
  await page.waitForFunction(()=>document.querySelector('#placement-pixel-workspace').dataset.pixelBusy==='false');
  assert.match(await workspace.locator('[data-pixel-status]').textContent(),/applied/);
  const bundle=JSON.parse((await exported('export-assets','assets.json')).bytes),visual=bundle.sceneDocument.sceneComposition.fragments.main.instances[0].props.components.visual;
  const asset=bundle.assets.find(a=>a.id===visual.texture);
  assert.deepEqual(asset.source,edited);assert.deepEqual(visual,{...target.visual,texture:asset.id,asset:asset.id});
  const game = await verify?.(bundle);
  for(const key of ['collider','body','layer'])assert.deepEqual(bundle.sceneDocument.sceneComposition.fragments.main.instances[0].props.components[key],components[key]);
  await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:840});
  assert.equal(await select.getAttribute('aria-label'),'시트 프레임');
  assert(await workspace.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:join(run,mode+'-atlas-ko.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-placement-language]').selectOption('en');
  await action('back').click();
  await page.locator('[data-placement-edit-pixels="'+asset.id+'"][data-placement-edit-pixel-frame="right"]').click();
  await workspace.waitFor({state:'visible'});assert.equal(await select.inputValue(),'right');
  assert.deepEqual(JSON.parse((await exported('export-source','reopened.pixel.json')).bytes),edited);
  // Rejected rects keep the live document and its history intact.
  const invalid=structuredClone(source);invalid.atlas.frames[1].frame.u0=0.25;
  await page.locator('[data-pixel-file]').setInputFiles({name:'overlap.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});
  await page.waitForFunction(()=>document.querySelector('[data-pixel-status]').textContent.includes('Overlapping'));
  assert.deepEqual(JSON.parse((await exported('export-source','rejected.pixel.json')).bytes),edited);
  await action('back').click();
  await page.evaluate(({id,components})=>window.ferrumPlacementViewerUpdateComponents(id,components),{id:instance.id,components});
  await page.locator('[data-pixel-file]').setInputFiles(restore.path);await workspace.waitFor({state:'visible'});
  assert.equal(await workspace.getAttribute('data-pixel-atlas'),'false');assert(await workspace.locator('.placement-pixel-frames').isVisible());
  return {id:asset.id,source:edited,...(game?{game}:{}),uvPreserved:true,otherPixelsPreserved:true,transparentRgbPreserved:true,
    externalPngFrameOpened:true,staleAtlasDecodeDiscardGuard:true,strokeClipped:true,undoRedo:true,viewOnlySelection:true,uvMismatchBlocked:true,sourcePngRoundtrip:true,
    registeredRevisionReopened:true,overlapRejected:true,localeAndNarrowLayout:true};
}
