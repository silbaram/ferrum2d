import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pixelModuleUrl,checkedPixelImport,documentUrl,pixelDocument,pixelDrawing} from './pixel-editing-modules.mjs';
const {ditherPixelPaint,gradientPixelPaint,pixelInkSettings,PIXEL_INK_DEFAULTS}=await checkedPixelImport(await pixelModuleUrl('placementPixelInk',{'./placementPixelDocument':documentUrl}));
const {createPixelEditor:create,newPixelDocument:blank}=pixelDocument;
const a=[17,34,51,0],b=[210,110,10,128],region={x:0,y:0,width:8,height:8},mirror={mirrorX:false,mirrorY:false};
const ink={...PIXEL_INK_DEFAULTS,secondary:b},at=(result,x,y)=>[...result.pixels.subarray(((y-result.region.y)*result.region.width+x-result.region.x)*4,((y-result.region.y)*result.region.width+x-result.region.x)*4+4)];
test('dither uses exact source colors and all seventeen ordered coverage levels',()=>{
  const mask={region,pixels:new Uint8Array(64).fill(1)};
  for(let density=0;density<=16;density++) {
    const result=ditherPixelPaint(mask,a,{...ink,density},mirror);let count=0;
    for(let y=0;y<8;y++)for(let x=0;x<8;x++){const pixel=at(result,x,y);assert(pixel.every((v,c)=>v===a[c])||pixel.every((v,c)=>v===b[c]));if(pixel.every((v,c)=>v===b[c]))count++;}
    assert.equal(count,density*4);assert.deepEqual(result.region.mask,mask.pixels);
  }
});
test('dither brush shares selection clipping and mirrored footprint, with one reversible transaction',()=>{
  const editor=create(blank(8,8)),before=editor.document();
  const clip={x:1,y:1,width:6,height:6,mask:Uint8Array.from({length:36},(_,i)=>i===14?0:1)};
  const settings={size:3,mirrorX:true,mirrorY:true,filled:false};
  const mask=pixelDrawing.rasterPixelDrawing('line',region,{x:1,y:2},{x:2,y:3},settings,clip);
  const paint=ditherPixelPaint(mask,a,ink,settings);editor.begin();editor.paintRegion(paint.region,paint.pixels);editor.paintRegion(paint.region,paint.pixels);editor.commit();
  assert.equal(editor.history().undo,1);
  assert.deepEqual([...editor.layerBytes(editor.selectedLayer()).subarray((3*8+3)*4,(3*8+3)*4+4)],[0,0,0,0]);
  editor.undo();assert.deepEqual(editor.document(),before);editor.redo();const after=editor.document();
  const standalone=ditherPixelPaint({region,pixels:new Uint8Array(64).fill(1)},a,ink,settings);
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){assert.deepEqual(at(standalone,x,y),at(standalone,7-x,y));assert.deepEqual(at(standalone,x,y),at(standalone,x,7-y));}
  editor.undo();const history=editor.history();editor.begin();editor.paintRegion(paint.region,paint.pixels);assert.notDeepEqual(editor.document(),before);editor.cancel();assert.deepEqual(editor.document(),before);assert.deepEqual(editor.history(),history);editor.redo();assert.deepEqual(editor.document(),after);
});
test('gradient preserves straight RGBA endpoints, produces bounded color steps and previews without changing source',()=>{
  const editor=create(blank(8,8)),before=editor.document();
  const result=gradientPixelPaint(region,{x:0,y:0},{x:7,y:0},a,{...ink,gradient:'colors'},[]);
  assert.deepEqual(at(result,0,0),a);assert.deepEqual(at(result,7,7),b);
  assert.deepEqual(at(result,3,0),a.map((v,c)=>Math.round(v+(b[c]-v)*3/7)));
  const preview=editor.previewRegion(result.region,result.pixels);assert.equal(preview.length,256);assert.deepEqual(editor.document(),before);assert.equal(editor.history().undo,0);
  editor.editRegion(result.region,result.pixels);assert.equal(editor.history().undo,1);editor.undo();assert.deepEqual(editor.document(),before);
  const palette=[a,[80,90,100,255],b];
  const stepped=gradientPixelPaint(region,{x:0,y:0},{x:7,y:0},a,{...ink,gradient:'palette'},palette);
  for(let x=0;x<8;x++)assert.deepEqual(at(stepped,x,0),palette[Math.round(x/7*2)]);
});
test('dither gradient clips mask holes and fixed atlas regions; mirror is symmetric and does not mutate inputs',()=>{
  const r={x:8,y:4,width:8,height:8},clip={x:10,y:6,width:2,height:2,mask:new Uint8Array([1,0,1,1])};
  const result=gradientPixelPaint(r,{x:8,y:4},{x:15,y:4},a,ink,[],clip);
  assert.equal(result.region.mask.reduce((n,v)=>n+v,0),3);assert.equal(result.region.mask[(6-4)*8+11-8],0);
  const sym=gradientPixelPaint(region,{x:0,y:0},{x:3,y:0},a,ink,[],undefined,{mirrorX:true,mirrorY:true});
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){assert.deepEqual(at(sym,x,y),at(sym,7-x,y));assert.deepEqual(at(sym,x,y),at(sym,x,7-y));}
  assert.deepEqual(clip.mask,new Uint8Array([1,0,1,1]));
  const same=gradientPixelPaint(region,{x:3,y:3},{x:3,y:3},a,ink,[]);assert.deepEqual(at(same,7,7),a);
});
test('invalid color settings, coordinates and palettes reject before document mutation',()=>{
  for(const changes of [{density:-1},{density:17},{density:.5},{secondary:[1,2,3,256]},{gradient:'unknown'}])assert.throws(()=>pixelInkSettings({...ink,...changes}));
  assert.throws(()=>gradientPixelPaint(region,{x:NaN,y:0},{x:3,y:0},a,ink,[]));
  assert.throws(()=>gradientPixelPaint({...region,width:100000},{x:0,y:0},{x:3,y:0},a,ink,[]));
  assert.throws(()=>gradientPixelPaint(region,{x:0,y:0},{x:3,y:0},a,{...ink,gradient:'palette'},[a]));
  assert.throws(()=>gradientPixelPaint(region,{x:0,y:0},{x:3,y:0},a,{...ink,gradient:'palette'},Array(257).fill(a)));
  assert.throws(()=>ditherPixelPaint({region,pixels:new Uint8Array(63)},a,ink,mirror));
});

test('both inks preserve adjacent v4 atlas pixels, metadata and history at a nonzero frame origin',()=>{
  const source={...blank(8,8),version:4,atlas:{texture:'fixed',frames:[{id:'left',frame:{u0:0,v0:0,u1:.5,v1:1}},{id:'right',frame:{u0:.5,v0:0,u1:1,v1:1}}]}};
  source.rgba=Buffer.from(Array.from({length:64},(_,i)=>[i,20,30,128]).flat()).toString('base64');
  const editor=create(source);editor.selectAtlasFrame('right');const r=editor.region();
  const masks=pixelDrawing.rasterPixelDrawing('line',r,{x:4,y:0},{x:7,y:7},{size:8,mirrorX:true,mirrorY:false,filled:false});
  for(const paint of [ditherPixelPaint(masks,a,ink,mirror),gradientPixelPaint(r,{x:4,y:0},{x:7,y:7},a,ink,[])]) {
    editor.editRegion(paint.region,paint.pixels);const output=editor.document(),bytes=editor.bytes(),before=Buffer.from(source.rgba,'base64');
    assert.deepEqual(output.atlas,source.atlas);assert.equal(output.version,4);assert.notDeepEqual(output.rgba,source.rgba);
    for(let y=0;y<8;y++)assert.deepEqual([...bytes.subarray(y*32,y*32+16)],[...before.subarray(y*32,y*32+16)]);
    assert.equal(editor.history().undo,1);editor.undo();assert.deepEqual(editor.document(),source);
  }
});
