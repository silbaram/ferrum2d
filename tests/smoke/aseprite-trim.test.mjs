import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentUrl, pixelModuleUrl, checkedPixelImport } from './pixel-editing-modules.mjs';
import { trimFixture, trimHash, verifyTrimBundle } from './aseprite-trim-fixture.mjs';
import { decodePng, encodePngRgba } from '../../scripts/tools/pack-textures.mjs';
import { filteredPixelPng } from './pixel-png-fixture.mjs';
const sdk=new URL('../../packages/ferrum-web/dist/authoring.js',import.meta.url).href;
const scope=await pixelModuleUrl('placementAssetScope');
const normal=await pixelModuleUrl('placementNormalAssets',{'./placementAssetScope':scope,'@ferrum2d/ferrum-web/authoring':sdk});
const png=await pixelModuleUrl('placementPixelPng',{'./placementPixelDocument':documentUrl});
const trim=await pixelModuleUrl('placementAsepriteTrim',{'./placementPixelPng':png,'./placementAsepriteNormalPng':await pixelModuleUrl('placementAsepriteNormalPng')});
const revisions=await pixelModuleUrl('placementSpriteRevisions',{'./placementAssetScope':scope});
const assetUrl=await pixelModuleUrl('placementAsepriteAssets',{'./placementSpriteRevisions':revisions,'./placementNormalAssets':normal,'./placementAsepriteTrim':trim,'@ferrum2d/ferrum-web/authoring':sdk});
const assets=await checkedPixelImport(assetUrl), t=await checkedPixelImport(trim);
const project=await checkedPixelImport(await pixelModuleUrl('placementAsepriteProject',{'./placementAsepriteAssets':assetUrl,'./placementNormalAssets':normal,'./placementPixelPng':png}));
const plan=data=>t.asepriteTrimPlan(Object.entries(data.json.frames),data.json.meta.size.w,data.json.meta.size.h);
async function inspect(data=trimFixture()) {
  const original=globalThis.createImageBitmap;
  globalThis.createImageBitmap=async blob=>{const b=await blob.arrayBuffer(),v=new DataView(b);return {width:v.getUint32(16),height:v.getUint32(20),close(){}};};
  try{return await assets.inspectAseprite('scene','hero',new File([JSON.stringify(data.json)],'hero.json'),new File([data.png],'hero.png'),new AbortController().signal);}finally{globalThis.createImageBitmap=original;}
}
test('trim inspection preserves original identity/bytes and restores offset, alpha-zero RGB and transparent padding',async()=>{
  const data=trimFixture(),asset=await inspect(data),bundle=assets.asepriteBundle('scene',[asset]);
  assert.deepEqual(new Uint8Array(asset.sourcePng.png),new Uint8Array(data.png));
  assert.equal(asset.sourcePng.sha256,trimHash(data.png));assert.equal(asset.jsonText,JSON.stringify(data.json));
  assert.equal(asset.bytes,asset.png.byteLength+asset.json.byteLength+data.png.byteLength);
  assert.equal(verifyTrimBundle(bundle).restoredAtlases,1);
  const reordered={...data,json:{...data.json,frames:Object.fromEntries(Object.entries(data.json.frames).reverse())}};
  const next=await inspect(reordered);
  assert.deepEqual(next.frames.map(f=>f.id),['hero-walk.png','hero-idle.png']);
  assert.deepEqual(next.frames.map(f=>f.y),[24,0]);
  assert.deepEqual(assets.asepriteEvidence(next).frames.map(f=>f.id),['hero-idle.png','hero-walk.png']);
  assert.deepEqual(new Uint8Array(next.png),new Uint8Array(asset.png));
  const decoded=decodePng(data.png),interlaced=await inspect({...data,png:filteredPixelPng(decoded.width,decoded.height,decoded.pixels,true)});
  assert.notEqual(interlaced.id,asset.id);assert.deepEqual(new Uint8Array(interlaced.png),new Uint8Array(asset.png));
});
test('trim validation rejects incomplete, rotated, invalid offset/canvas and restoration overflow before decoding',()=>{
  for(const mutate of [f=>delete f.sourceSize,f=>delete f.spriteSourceSize,f=>f.rotated=true,f=>f.trimmed='true',f=>f.spriteSourceSize.x=-1,f=>f.spriteSourceSize.y=24,f=>f.spriteSourceSize.w=7,f=>f.sourceSize.w=1.5,f=>f.sourceSize.h=4097,f=>f.trimmed=false]){
    const data=trimFixture();mutate(data.json.frames['hero-idle.png']);assert.throws(()=>plan(data));
  }
  const different=trimFixture();different.json.frames['hero-idle.png'].sourceSize.w=25;assert.throws(()=>plan(different),/shared source/);
  const huge=trimFixture();for(const f of Object.values(huge.json.frames))f.sourceSize={w:4096,h:4096};assert.throws(()=>plan(huge),/4 megapixel/);
});
test('legacy untrimmed revisions keep original PNG bytes, geometry, identity and two-file bundle',async()=>{
  const data=trimFixture();for(const f of Object.values(data.json.frames)){f.trimmed=false;f.sourceSize={w:16,h:16};f.spriteSourceSize={x:0,y:0,w:16,h:16};}
  const asset=await inspect(data),bundle=assets.asepriteBundle('scene',[asset]);
  assert.equal(asset.sourcePng,undefined);assert.equal(bundle.files.length,2);
  assert.deepEqual(new Uint8Array(asset.png),new Uint8Array(data.png));assert.deepEqual(asset.frames.map(f=>[f.x,f.y,f.width,f.height]),[[0,0,16,16],[16,0,16,16]]);
  assert.equal(asset.id,`aseprite.hero.${trimHash(JSON.stringify(['scene','hero',trimHash(JSON.stringify(data.json)),trimHash(data.png)])).slice(0,24)}`);
});
test('trim layout supports shared full frames and UTF-8 canonical placement without changing source order',()=>{
  const data=trimFixture(),raw=Object.values(data.json.frames);
  raw[0].sourceSize={w:16,h:16};raw[0].spriteSourceSize={x:0,y:0,w:16,h:16};raw[0].trimmed=false;
  raw[1].sourceSize={w:16,h:16};raw[1].spriteSourceSize={x:0,y:0,w:16,h:16};
  const p=t.asepriteTrimPlan([['😀',raw[0]],['\ue000',raw[1]]],32,16);
  assert.deepEqual(p.restored.order,['\ue000','😀']);assert.deepEqual(p.frames.map(f=>f.id),['😀','\ue000']);
  assert.deepEqual(t.asepriteRestoredFrames(p).map(f=>f.y),[16,0]);
});
test('native project reload verifies source sidecar and restored pixels, reuses immutable PNG and rejects tamper',async()=>{
  const asset=await inspect(),bundle=assets.asepriteBundle('scene',[asset]);
  const originalFetch=globalThis.fetch,originalLocation=globalThis.location,originalBitmap=globalThis.createImageBitmap;
  const files=new Map(bundle.files.map(f=>['https://trim.test/'+f.path,Buffer.from(f.base64,'base64')]));
  globalThis.location={href:'https://trim.test/'};globalThis.fetch=async url=>new Response(files.get(String(url)),{status:200});
  globalThis.createImageBitmap=async blob=>{const v=new DataView(await blob.arrayBuffer());return {width:v.getUint32(16),height:v.getUint32(20),close(){}};};
  const catalog={format:'ferrum2d.aseprite.project',version:1,assets:[{metadata:bundle.revisions[0],pngUrl:asset.id+'.png',jsonUrl:asset.id+'.json',sourcePngUrl:asset.id+'.source.png'}]};
  try{
    const restored=await project.readPlacementAsepriteProject(catalog,'reopened','project',new AbortController().signal);
    assert.equal(restored[0].id,asset.id);assert(restored[0].persisted);assert.deepEqual(new Uint8Array(restored[0].png),new Uint8Array(asset.png));assert.deepEqual(new Uint8Array(restored[0].sourcePng.png),new Uint8Array(asset.sourcePng.png));
    const decoded=decodePng(Buffer.from(asset.png)),alternate=filteredPixelPng(decoded.width,decoded.height,decoded.pixels);
    assert.notDeepEqual(alternate,Buffer.from(asset.png));
    files.set('https://trim.test/'+asset.id+'.png',alternate);catalog.assets[0].metadata.pngSha256=trimHash(alternate);
    const kept=await project.readPlacementAsepriteProject(catalog,'reopened','project',new AbortController().signal);
    assert.equal(kept[0].id,asset.id);assert.deepEqual(new Uint8Array(kept[0].png),new Uint8Array(alternate));
    const changed=decoded.pixels.slice();changed[0]=99;const corrupt=encodePngRgba(decoded.width,decoded.height,changed);
    files.set('https://trim.test/'+asset.id+'.png',corrupt);catalog.assets[0].metadata.pngSha256=trimHash(corrupt);
    await assert.rejects(project.readPlacementAsepriteProject(catalog,'scene','project',new AbortController().signal),/differs from its trim source/);
    const huge=Buffer.from(alternate);huge.writeUInt32BE(4096,16);huge.writeUInt32BE(4096,20);
    files.set('https://trim.test/'+asset.id+'.png',huge);catalog.assets[0].metadata.pngSha256=trimHash(huge);
    await assert.rejects(project.readPlacementAsepriteProject(catalog,'scene','project',new AbortController().signal),/dimensions differ/);
    files.set('https://trim.test/'+asset.id+'.png',alternate);catalog.assets[0].metadata.pngSha256=trimHash(alternate);
    const bad=structuredClone(catalog);delete bad.assets[0].sourcePngUrl;await assert.rejects(project.readPlacementAsepriteProject(bad,'scene','project',new AbortController().signal),/metadata differs/);
    files.set('https://trim.test/'+asset.id+'.source.png',new Uint8Array([1,2,3]));await assert.rejects(project.readPlacementAsepriteProject(catalog,'scene','project',new AbortController().signal));
  }finally{globalThis.fetch=originalFetch;globalThis.location=originalLocation;globalThis.createImageBitmap=originalBitmap;}
});
