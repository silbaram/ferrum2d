import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {encodePngRgba} from '../../scripts/tools/pack-textures.mjs';
const ts=createRequire(new URL('../../apps/studio/package.json',import.meta.url))('typescript');
const code=ts.transpileModule(await readFile(new URL('../../apps/studio/src/placementPixelImport.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {convertPixelImport:convert,inspectPixelImportPng:inspect,fitPixelImportSize:fit,PIXEL_IMPORT_LIMITS:limits}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const transferCode=ts.transpileModule(await readFile(new URL('../../apps/studio/src/placementPixelImportTransfer.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {pixelImportTransferFile:transferFile}=await import('data:text/javascript;base64,'+Buffer.from(transferCode).toString('base64'));
test('paste/drop accepts exactly one PNG and preserves its bytes for importer validation',()=>{
  for(const file of [new File(['image bytes'],'clipboard',{type:'image/png'}),new File(['image bytes'],'art.PNG')]) assert.equal(transferFile([file]),file);
  assert.throws(()=>transferFile([]),/image itself/);
  assert.throws(()=>transferFile([new File(['url'],'link.html',{type:'text/html'})]),/Only PNG/);
  assert.throws(()=>transferFile([new File([],'a.png'),new File([],'b.png')]),/one PNG/);
});
const image=(width,height,colors)=>({width,height,pixels:Uint8Array.from(colors.flat())});
const settings=(source,extra={})=>({crop:{x:0,y:0,width:source.width,height:source.height},width:source.width,height:source.height,sampling:'nearest',colors:{mode:'original'},...extra});
test('nearest crop and enlargement use pixel centers and do not mutate the source',()=>{
  const source=image(3,2,Array.from({length:6},(_,i)=>[i*20,0,0,255])),before=source.pixels.slice();
  const out=convert(source,settings(source,{crop:{x:1,y:0,width:2,height:2},width:4,height:2}));
  assert.deepEqual([...out.pixels].filter((_,i)=>i%4===0),[20,20,40,40,80,80,100,100]);
  assert.deepEqual(source.pixels,before);assert.equal(out.colorCount,4);
});
test('area resampling weights fractional coverage and premultiplied alpha without transparent color bleed',()=>{
  const source=image(3,1,[[255,0,0,255],[0,255,0,0],[0,0,255,255]]);
  const out=convert(source,settings(source,{width:2,sampling:'area'}));
  assert.deepEqual([...out.pixels],[255,0,0,170,0,0,255,170]);
  const all=convert(source,settings(source,{width:1,sampling:'area'}));
  assert.deepEqual([...all.pixels],[128,0,128,170]);
});
test('area crop at the lower-right boundary ignores outside pixels and preserves weighted alpha',()=>{
  const source=image(4,3,Array(12).fill([255,255,0,255]));
  source.pixels.set([255,0,0,255,0,255,0,128],(1*4+2)*4);
  source.pixels.set([0,0,255,0,255,255,255,255],(2*4+2)*4);
  const out=convert(source,settings(source,{crop:{x:2,y:1,width:2,height:2},width:1,height:1,sampling:'area'}));
  assert.deepEqual([...out.pixels],[204,153,102,160]);
});
test('identity conversion preserves exact RGBA; transparent images quantize without invented pixels',()=>{
  const source=image(2,1,[[123,45,67,0],[200,50,100,128]]);
  assert.deepEqual(convert(source,settings(source)).pixels,source.pixels);
  const empty=image(2,1,[[1,2,3,0],[4,5,6,0]]);
  const out=convert(empty,settings(empty,{colors:{mode:'auto',count:2}}));
  assert.equal(out.colorCount,0);assert.deepEqual(out.palette,[]);assert.deepEqual(out.pixels,empty.pixels);
});
test('automatic palettes bound RGB colors deterministically and preserve every alpha value',()=>{
  const source=image(128,1,Array.from({length:128},(_,i)=>[i*2,255-i,255-i*2,i*2]));
  for(const count of [2,8,16,64,256]) {
    const config=settings(source,{colors:{mode:'auto',count}}),out=convert(source,config);
    assert(out.colorCount<=count);assert(out.palette.length<=count);assert.deepEqual(out,convert(source,config));
    for(let i=3;i<source.pixels.length;i+=4)assert.equal(out.pixels[i],source.pixels[i]);
  }
  assert.deepEqual(convert(source,settings(source,{colors:{mode:'auto',count:256}})).pixels,source.pixels);
});
test('document palette maps RGB while preserving alpha and excludes fully transparent swatches',()=>{
  const source=image(3,1,[[240,10,5,128],[1,2,3,255],[10,20,30,0]]);
  const out=convert(source,settings(source,{colors:{mode:'palette',palette:['#ff000080','#0000FFFF','#00000000']}}));
  assert.deepEqual([...out.pixels],[255,0,0,128,0,0,255,255,10,20,30,0]);
  assert.throws(()=>convert(source,settings(source,{colors:{mode:'palette',palette:['#00000000']}})));
  assert.throws(()=>convert(source,settings(source,{colors:{mode:'palette',palette:['red']}})));
});
test('invalid crops, output dimensions and settings fail before changing source data',()=>{
  const source=image(2,2,Array(4).fill([1,2,3,255])),before=source.pixels.slice();
  for(const crop of [{x:-1,y:0,width:1,height:1},{x:1,y:0,width:2,height:1},{x:0,y:.5,width:1,height:1},{x:0,y:0,width:NaN,height:1}])assert.throws(()=>convert(source,settings(source,{crop})));
  for(const width of [0,257,Infinity,NaN,1.5])assert.throws(()=>convert(source,settings(source,{width})));
  for(const count of [1,257,NaN,2.5])assert.throws(()=>convert(source,settings(source,{colors:{mode:'auto',count}})));
  assert.throws(()=>convert(source,settings(source,{sampling:'bogus'})));
  assert.throws(()=>convert({...source,pixels:new Uint8Array(4)},settings(source)));
  assert.deepEqual(source.pixels,before);
});
test('aspect presets fit a longest side and keep at least one pixel on thin sources',()=>{
  assert.deepEqual(fit(1024,512,64),{width:64,height:32});
  assert.deepEqual(fit(1,4096,32),{width:1,height:32});
  assert.throws(()=>fit(1,1,257));assert.throws(()=>fit(4096,4096,64));
});
test('PNG header inspection accepts bounded static PNG and checks dimensions before browser decode',()=>{
  const png=new Uint8Array(encodePngRgba(2,1,new Uint8Array(8)));assert.deepEqual(inspect(png),{width:2,height:1});
  const oversized=png.slice();new DataView(oversized.buffer).setUint32(16,4097);assert.throws(()=>inspect(oversized),/4096/);
  const huge=png.slice();const view=new DataView(huge.buffer);view.setUint32(16,4096);view.setUint32(20,4096);assert.throws(()=>inspect(huge),/megapixels/);
  assert.throws(()=>inspect(new Uint8Array(limits.bytes+1)),/16 MiB/);
  assert.throws(()=>inspect(png.subarray(0,png.length-1)));
  const animated=Uint8Array.from([...png.subarray(0,33),0,0,0,0,97,99,84,76,0,0,0,0,...png.subarray(33)]);
  assert.throws(()=>inspect(animated),/Animated/);
  const wrapped=new Uint8Array(png.length+10);wrapped.set(png,5);assert.deepEqual(inspect(wrapped.subarray(5,-5)),{width:2,height:1});
});
test('maximum area input produces bounded editable output without changing source',()=>{
  const source={width:2048,height:2048,pixels:new Uint8Array(2048*2048*4)};source.pixels.fill(255);
  const out=convert(source,settings(source,{width:256,height:256,sampling:'area',colors:{mode:'auto',count:16}}));
  assert.equal(out.pixels.length,256*256*4);assert(out.pixels.every(n=>n===255));assert.equal(out.colorCount,1);
});
