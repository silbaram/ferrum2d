import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../../apps/studio/package.json',import.meta.url))('typescript');
async function url(name,imports={}){let code=ts.transpileModule(await readFile(new URL('../../apps/studio/src/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;for(const [from,to]of Object.entries(imports))code=code.replaceAll(JSON.stringify(from),JSON.stringify(to));return'data:text/javascript;base64,'+Buffer.from(code).toString('base64');}
async function load(value){try{return await import(value);}catch(error){process.exitCode=1;throw error;}}
const documentUrl=await url('placementPixelDocument',{'./placementPixelIndexed':await url('placementPixelIndexed'),'./placementPixelHistory':await url('placementPixelHistory'),'./placementPixelAtlas':await url('placementPixelAtlas')}),drawingUrl=await url('placementPixelDrawing',{'./placementPixelDocument':documentUrl});
const {createPixelEditor:create,newPixelDocument:blank}=await load(documentUrl),{PIXEL_DRAW_DEFAULTS:defaults}=await load(drawingUrl);
const {createPixelPerfectStroke:stroke}=await load(await url('placementPixelPerfect',{'./placementPixelDrawing':drawingUrl}));
const color=[90,80,70,128],region={x:0,y:0,width:8,height:8};
const points=mask=>[...mask.pixels].flatMap((v,i)=>v?[[mask.region.x+i%mask.region.width,mask.region.y+Math.floor(i/mask.region.width)]]:[]);
test('all L-corner orientations restore exact underlying straight-alpha bytes and commit one Undo',()=>{
  const rgba=Buffer.from(Array.from({length:64},(_,i)=>[i,20,30,i%2?128:0]).flat()),source={...blank(8,8),rgba:rgba.toString('base64')};
  for(const [dx,dy]of [[1,1],[-1,1],[1,-1],[-1,-1]])for(const vertical of [false,true]){
    const e=create(source),a={x:3,y:3},b={x:3+(vertical?0:dx),y:3+(vertical?dy:0)},c={x:3+dx,y:3+dy},s=stroke(region,a,defaults);
    e.begin();e.paintStrokeMask(s.add(b.x,b.y),color);assert.deepEqual(e.sample(b.x,b.y),color);
    const mask=s.add(c.x,c.y);e.paintStrokeMask(mask,color);assert.equal(points(mask).length,2);
    const bytes=e.layerBytes(e.selectedLayer()),offset=(b.y*8+b.x)*4;assert.deepEqual(Buffer.from(bytes.subarray(offset,offset+4)),rgba.subarray(offset,offset+4));
    e.commit();assert.equal(e.history().undo,1);const saved=e.document();e.undo();assert.deepEqual(e.document(),source);e.redo();assert.deepEqual(e.document(),saved);
  }
});
test('repeated coordinates and reverse strokes retain earlier visits when a later corner is removed',()=>{
  const s=stroke(region,{x:0,y:0},defaults);s.add(1,0);s.add(0,0);const mask=s.add(0,1);assert.deepEqual(points(mask),[[0,0],[1,0],[0,1]]);assert.deepEqual(s.add(0,1),mask);
});
test('fast line interpolation is gap-free and extreme distances remain clipped to frame area',()=>{
  const s=stroke(region,{x:0,y:0},defaults);assert.equal(points(s.add(7,7)).length,8);assert.equal(s.add(1_048_576,1_048_576).pixels.length,64);
  assert(s.add(-1_048_576,-1_048_576).pixels.every(v=>v===0||v===1));
});
test('atlas origin, mirrored contributions and final selection clip protect other pixels',()=>{
  const r={x:4,y:0,width:4,height:8},clip={x:5,y:1,width:2,height:2};
  const source={...blank(8,8),version:4,atlas:{texture:'sheet',frames:[{id:'left',frame:{u0:0,v0:0,u1:.5,v1:1}},{id:'right',frame:{u0:.5,v0:0,u1:1,v1:1}}]}};
  const e=create(source);e.selectAtlasFrame('right');const s=stroke(r,{x:5,y:1},{...defaults,mirrorX:true,mirrorY:true},clip);s.add(6,1);const mask=s.add(6,2);
  assert.deepEqual(points(mask),[[5,1],[6,1],[5,2],[6,2]]);e.begin();e.paintStrokeMask(mask,color);e.commit();
  for(let y=0;y<8;y++)for(let x=0;x<4;x++)assert.deepEqual(e.sample(x,y),undefined);
  const raw=Buffer.from(e.document().rgba,'base64');for(let y=0;y<8;y++)assert.deepEqual(raw.subarray(y*32,y*32+16),Buffer.alloc(16));
});
test('cancellation and no-op preserve source and Redo; painting requires its active transaction',()=>{
  const e=create(blank(8,8)),s=stroke(region,{x:1,y:1},defaults),mask=s.add(2,2);e.begin();e.paintStrokeMask(mask,color);e.commit();e.undo();
  const source=e.document(),history=e.history();e.begin();e.paintStrokeMask(mask,color);e.cancel();assert.deepEqual(e.document(),source);assert.deepEqual(e.history(),history);
  e.begin();e.paintStrokeMask(mask,[0,0,0,0]);assert.equal(e.commit(),false);assert.deepEqual(e.history(),history);assert.throws(()=>e.paintStrokeMask(mask,color));
});
test('invalid inputs fail and gesture captures mutable settings independently',()=>{
  assert.throws(()=>stroke(region,{x:0,y:0},{...defaults,size:2}));const settings={...defaults},r={...region},clip={...region};const s=stroke(r,{x:1,y:1},settings,clip);
  settings.mirrorX=true;r.width=2;clip.width=1;assert.deepEqual(points(s.add(2,2)),[[1,1],[2,2]]);assert.throws(()=>s.add(NaN,0));
});
test('leaving and reentering a clipped frame must not form an artificial L across the gap',()=>{
  for(let rotation=0;rotation<4;rotation++) {
    const r={x:4,y:4,width:4,height:4},source={...blank(8,8),version:4,atlas:{texture:'sheet',frames:[{id:'bottom-right',frame:{u0:.5,v0:.5,u1:1,v1:1}}]},rgba:Buffer.from(Array(64).fill([7,8,9,128]).flat()).toString('base64')},e=create(source);
    const turn=(x,y)=>{for(let k=0;k<rotation;k++)[x,y]=[3-y,x];return{x:x+4,y:y+4};},s=stroke(r,turn(2,0),defaults);
    e.begin();for(const[x,y]of [[3,0],[4,0],[4,1],[3,1]]){const p=turn(x,y);e.paintStrokeMask(s.add(p.x,p.y),color);}e.commit();
    for(const[x,y]of [[2,0],[3,0],[3,1]]){const p=turn(x,y);assert.deepEqual(e.sample(p.x,p.y),color,'painted boundary endpoints survive clipped-out detours');}assert.equal(e.history().undo,1);e.undo();assert.deepEqual(e.document(),source);
  }
});
test('soft selection masks filter the corrected geometry after pixel-perfect L removal',()=>{
  const clip={x:0,y:0,width:2,height:1},s=stroke(region,{x:0,y:0},defaults,clip);s.add(1,0);
  assert.deepEqual(points(s.add(1,1)),[[0,0]],'the point outside selection completes the geometric L before the final write mask');
});
