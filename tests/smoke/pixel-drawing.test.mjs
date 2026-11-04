import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../../apps/placement-viewer/package.json',import.meta.url))('typescript');
async function moduleUrl(name,imports={}) {
  let code=ts.transpileModule(await readFile(new URL('../../apps/placement-viewer/src/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  for(const [from,to]of Object.entries(imports))code=code.replaceAll(JSON.stringify(from),JSON.stringify(to));
  return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
}
async function load(url){try{return await import(url);}catch(error){process.exitCode=1;throw error;}}
const atlas=await moduleUrl('placementPixelAtlas'),document=await moduleUrl('placementPixelDocument',{'./placementPixelIndexed':await moduleUrl('placementPixelIndexed'),'./placementPixelHistory':await moduleUrl('placementPixelHistory'),'./placementPixelAtlas':atlas});
const {createPixelEditor:create,newPixelDocument:blank}=await load(document);
const {rasterPixelDrawing:draw,PIXEL_DRAW_DEFAULTS:defaults}=await load(await moduleUrl('placementPixelDrawing',{'./placementPixelDocument':document}));
const red=[255,0,0,128],box={x:0,y:0,width:8,height:8};
const points=mask=>[...mask.pixels].flatMap((n,i)=>n?[[mask.region.x+i%mask.region.width,mask.region.y+Math.floor(i/mask.region.width)]]:[]);
function raster(kind,a,b,options={},region=box,clip,square=false){return draw(kind,region,{x:a[0],y:a[1]},{x:b[0],y:b[1]},{...defaults,...options},clip,square);}
test('default 1px line has identical bytes to the existing clipped stroke across octants',()=>{
  for(const [x,y]of [[0,0],[7,7],[7,0],[0,7],[3,7],[7,3],[-100,3],[100,-100]])for(const [a,b]of [[0,0],[7,7],[4,1]]){
    const old=create(blank(8,8)),next=create(blank(8,8));old.begin();old.line(a,b,x,y,red);old.commit();
    next.editPaint(raster('line',[a,b],[x,y]),red);assert.deepEqual(next.document(),old.document());
  }
});
test('square brush footprint covers fast segments and uses a stable even-size anchor',()=>{
  const mask=raster('line',[3,3],[4,3],{size:3});assert.equal(points(mask).length,12);
  assert(points(mask).every(([x,y])=>x>=2&&x<=5&&y>=2&&y<=4));
  assert.deepEqual(points(raster('line',[2,2],[2,2],{size:2})),[[2,2],[3,2],[2,3],[3,3]]);
});
test('odd/even frame mirrors reflect the complete footprint once, including nonzero atlas origins',()=>{
  for(const width of [7,8])for(const size of [1,2,3,32]){
    const region={x:8,y:5,width,height:7};
    const mask=raster('line',[9,6],[10,7],{size,mirrorX:true,mirrorY:true},region),set=new Set(points(mask).map(p=>p.join(',')));
    assert(mask.pixels.every(n=>n===0||n===1));
    for(const [x,y]of points(mask)){assert(set.has([2*region.x+width-1-x,y].join(',')));assert(set.has([x,2*region.y+6-y].join(',')));}
  }
  assert.equal(points(raster('line',[3,3],[3,3],{mirrorX:true,mirrorY:true},{x:0,y:0,width:7,height:7})).length,1);
});
test('rectangle outline, fill and Shift square have distinct exact footprints',()=>{
  assert.equal(points(raster('rectangle',[1,1],[5,4])).length,14);
  assert.equal(points(raster('rectangle',[1,1],[5,4],{filled:true})).length,20);
  assert.equal(points(raster('rectangle',[1,1],[3,2],{filled:true},box,undefined,true)).length,9);
  assert.deepEqual(points(raster('rectangle',[5,4],[1,1])),points(raster('rectangle',[1,1],[5,4])));
});
test('ellipse masks are symmetric and Shift produces a circle while a degenerate ellipse stays drawable',()=>{
  const circle=points(raster('ellipse',[1,1],[4,2],{filled:true},box,undefined,true));assert.equal(circle.length,12);
  for(const [x,y]of circle){assert(circle.some(p=>p[0]===5-x&&p[1]===y));assert(circle.some(p=>p[0]===x&&p[1]===5-y));}
  const fill=points(raster('ellipse',[1,1],[6,4],{filled:true})),outline=points(raster('ellipse',[1,1],[6,4]));
  assert(fill.length>outline.length);assert(outline.every(p=>fill.some(q=>q[0]===p[0]&&q[1]===p[1])));
  assert.equal(points(raster('ellipse',[2,2],[2,2])).length,1);
  assert.equal(points(raster('ellipse',[2,1],[2,5])).length,5);
});
test('selection is the final write mask, not a translated or mirrored selection',()=>{
  const clip={x:1,y:1,width:2,height:2};
  const mask=raster('rectangle',[0,0],[7,7],{filled:true,mirrorX:true,mirrorY:true},box,clip);
  assert.deepEqual(points(mask),[[1,1],[2,1],[1,2],[2,2]]);
  assert.equal(points(raster('line',[6,1],[6,1],{mirrorX:true},box,clip)).length,1);
});
test('shape preview leaves exact source, dirty, history, revision and Redo unchanged',()=>{
  const editor=create(blank(8,8));editor.editPaint(raster('rectangle',[1,1],[4,4]),red);editor.undo();editor.markExported();
  const before={source:editor.document(),history:editor.history(),revision:editor.revision(),dirty:editor.dirty()};
  const preview=editor.previewPaint(raster('ellipse',[0,0],[7,7],{filled:true}),red);assert(preview.some(n=>n));
  assert.deepEqual({source:editor.document(),history:editor.history(),revision:editor.revision(),dirty:editor.dirty()},before);
});
test('stroke, erase and shape commits preserve raw alpha, share one Undo, and no-op keeps Redo',()=>{
  const editor=create(blank(8,8)),mask=raster('rectangle',[1,1],[4,4],{filled:true,mirrorX:true});
  editor.begin();editor.paintMask(mask,red);editor.paintMask(mask,red);assert.equal(editor.commit(),true);assert.equal(editor.history().undo,1);
  for(const [x,y]of points(mask))assert.deepEqual([...editor.layerBytes(editor.selectedLayer()).subarray((y*8+x)*4,(y*8+x+1)*4)],red);
  editor.undo();const revision=editor.revision();assert.equal(editor.editPaint(mask,[0,0,0,0]),false);assert.equal(editor.revision(),revision);assert.equal(editor.history().redo,1);
  editor.redo();editor.editPaint(mask,[0,0,0,0]);assert(editor.bytes().every(n=>n===0));editor.undo();assert(editor.bytes().some(n=>n===128));
});
test('fill is contained by selection even when surrounding transparent pixels connect',()=>{
  const editor=create(blank(8,8)),clip={x:2,y:2,width:3,height:2};editor.begin();editor.fill(2,2,red,clip);editor.commit();
  assert.equal([...editor.bytes()].filter((n,i)=>i%4===3&&n).length,6);
  const source=editor.document();editor.begin();editor.fill(0,0,red,clip);assert.equal(editor.commit(),false);assert.deepEqual(editor.document(),source);
});
test('atlas writes protect neighbours and locked layers reject mask writes before mutation',()=>{
  const doc={...blank(8,8),version:4,atlas:{texture:'sheet',frames:[{id:'left',frame:{u0:0,v0:0,u1:.5,v1:1}},{id:'right',frame:{u0:.5,v0:0,u1:1,v1:1}}]}};
  const editor=create(doc);editor.selectAtlasFrame('right');editor.editPaint(raster('line',[4,0],[7,7],{size:32,mirrorX:true},editor.region()),red);
  const bytes=editor.bytes();for(let y=0;y<8;y++)for(let x=0;x<4;x++)assert(bytes.subarray((y*8+x)*4,(y*8+x+1)*4).every(n=>n===0));
  editor.undo();assert.deepEqual(editor.document(),doc);
  const normal=create(blank(8,8));normal.setLayerLocked(normal.selectedLayer(),true);const before=normal.document();
  assert.throws(()=>normal.editPaint(raster('line',[0,0],[1,1]),red));assert.deepEqual(normal.document(),before);
});
test('extreme pointer distances have bounded output and invalid data fails atomically',()=>{
  for(const kind of ['line','rectangle','ellipse']){
    const mask=raster(kind,[-1048576,-1048576],[1048576,1048576],{size:32,filled:kind!=='line'});assert.equal(mask.pixels.length,64);
  }
  const editor=create(blank(8,8)),source=editor.document();
  for(const mask of [{region:box,pixels:new Uint8Array(1)},{region:{...box,x:1},pixels:new Uint8Array(64)}])assert.throws(()=>editor.editPaint(mask,red));
  assert.deepEqual(editor.document(),source);assert.equal(editor.history().undo,0);
  assert.throws(()=>raster('line',[0,0],[2e6,0]));assert.throws(()=>raster('line',[0,0],[1,1],{size:33}));
});
