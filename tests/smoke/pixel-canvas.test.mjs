import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../../apps/studio/package.json',import.meta.url))('typescript');
async function url(name,imports={}){let code=ts.transpileModule(await readFile(new URL('../../apps/studio/src/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;for(const [from,to]of Object.entries(imports))code=code.replaceAll(JSON.stringify(from),JSON.stringify(to));return'data:text/javascript;base64,'+Buffer.from(code).toString('base64');}
async function load(url){try{return await import(url);}catch(error){process.exitCode=1;throw error;}}
const docUrl=await url('placementPixelDocument',{'./placementPixelIndexed':await url('placementPixelIndexed'),'./placementPixelHistory':await url('placementPixelHistory'),'./placementPixelAtlas':await url('placementPixelAtlas')});
const {newPixelDocument:blank,createPixelEditor:create,readPixelDocument,PIXEL_CANVAS_ANCHORS:anchors}=await load(docUrl);
const raw=(width,height,offset=0)=>Buffer.from(Array.from({length:width*height},(_,i)=>[i+offset,20,30,i%2?128:0]).flat());
test('all nine anchors pad with zeros and preserve every straight-alpha byte without interpolation',()=>{
  const source={...blank(2,2),rgba:raw(2,2,1).toString('base64')};
  for(let index=0;index<anchors.length;index++){
    const editor=create(source),before=editor.document(),revision=editor.revision(),preview=editor.previewResize(4,4,anchors[index]);
    assert.deepEqual(editor.document(),before);assert.equal(editor.revision(),revision);assert.equal(editor.history().undo,0);
    editor.resizeCanvas(4,4,anchors[index]);assert.deepEqual(editor.region(),{x:0,y:0,width:4,height:4});assert.equal(editor.width,4);assert.equal(editor.height,4);
    const bytes=Buffer.from(editor.layerBytes(editor.selectedLayer())),original=raw(2,2,1),dx=index%3,dy=Math.floor(index/3);
    for(let y=0;y<4;y++)for(let x=0;x<4;x++){const offset=(y*4+x)*4;assert.deepEqual(bytes.subarray(offset,offset+4),x>=dx&&x<dx+2&&y>=dy&&y<dy+2?original.subarray(((y-dy)*2+x-dx)*4,((y-dy)*2+x-dx+1)*4):Buffer.alloc(4));}
    assert.equal(preview.width,4);assert.equal(editor.history().undo,1);const resized=editor.document();assert.deepEqual(readPixelDocument(JSON.stringify(resized)),resized);
    editor.undo();assert.equal(editor.width,2);assert.deepEqual(editor.document(),source);editor.redo();assert.deepEqual(editor.document(),resized);
  }
});
test('odd center cropping uses floor offsets and removes the correct rows and columns',()=>{
  const source={...blank(5,3),rgba:raw(5,3,1).toString('base64')},editor=create(source),preview=editor.previewResize(4,2);
  assert.equal(preview.offsetX,-1);assert.equal(preview.offsetY,-1);assert(preview.cropped);editor.resizeCanvas(4,2);
  const bytes=Buffer.from(editor.layerBytes(editor.selectedLayer())),original=raw(5,3,1);
  for(let y=0;y<2;y++)for(let x=0;x<4;x++)assert.deepEqual(bytes.subarray((y*4+x)*4,(y*4+x+1)*4),original.subarray(((y+1)*5+x+1)*4,((y+1)*5+x+2)*4));
  editor.undo();assert.deepEqual(editor.document(),source);
});
test('resize applies to all cels including locked and hidden layers while keeping tags and stable IDs',()=>{
  const layers=[{id:'body',name:'Body',visible:true,locked:false},{id:'hidden',name:'Hidden',visible:false,locked:false},{id:'locked',name:'Locked',visible:true,locked:true}];
  const source={...blank(2,2),version:5,layers,frames:['a','b'].map((id,f)=>({id,durationMs:100,cels:layers.map((layer,l)=>({layerId:layer.id,rgba:raw(2,2,10*f+20*l).toString('base64')}))})),tags:[{id:'tag',name:'Idle',clipId:7,frameIds:['a','b'],loop:false}],initialTag:'tag',nextClipId:8};delete source.layer;delete source.frame;delete source.rgba;
  const editor=create(source);editor.selectLayer('locked');editor.resizeCanvas(3,3,'bottom-right');const resized=editor.document();
  assert.deepEqual(resized.layers,source.layers);assert.deepEqual(resized.tags,source.tags);assert.equal(resized.nextClipId,8);assert.equal(editor.selectedLayer(),'locked');
  for(let f=0;f<2;f++)for(let l=0;l<3;l++){const pixels=Buffer.from(resized.frames[f].cels[l].rgba,'base64');for(let y=0;y<2;y++)for(let x=0;x<2;x++)assert.deepEqual(pixels.subarray(((y+1)*3+x+1)*4,((y+1)*3+x+2)*4),raw(2,2,10*f+20*l).subarray((y*2+x)*4,(y*2+x+1)*4));}
  editor.undo();assert.deepEqual(editor.document(),source);
});
test('invalid resize, cel-budget overflow and no-op retain dimensions, source, history and Redo',()=>{
  const editor=create(blank(4,4));editor.resizeCanvas(5,5);editor.undo();const before=editor.document(),history=editor.history(),revision=editor.revision();
  for(const [w,h,a]of [[0,4,'center'],[4,257,'center'],[1.5,4,'center'],[4,4,'bad']])assert.throws(()=>editor.resizeCanvas(w,h,a));
  assert.equal(editor.resizeCanvas(4,4),false);assert.deepEqual(editor.document(),before);assert.deepEqual(editor.history(),history);assert.equal(editor.revision(),revision);
  const layers=Array.from({length:8},(_,i)=>({id:'layer'+i,name:'Layer',visible:true,locked:false})),source={...blank(2,2),version:3,layers,frames:Array.from({length:16},(_,i)=>({id:'frame'+i,durationMs:100,cels:layers.map(l=>({layerId:l.id,rgba:raw(2,2).toString('base64')}))}))};delete source.layer;delete source.frame;delete source.rgba;
  const large=create(source);assert.throws(()=>large.resizeCanvas(256,256),/budget/);assert.deepEqual(large.document(),source);assert.equal(large.history().undo,0);assert.equal(large.previewResize(128,128).pixels.length,128*128*4);
});
test('painting, color replacement, fill and cache use resized strides and Undo restores active bounds',()=>{
  const blue=[0,0,255,128],red=[255,0,0,128],editor=create({...blank(2,2),rgba:Buffer.from(Array(4).fill(blue).flat()).toString('base64')});
  editor.bytes();editor.resizeCanvas(4,4,'top-left');assert.equal(editor.countColor(blue,'cel'),4);editor.replaceColor(blue,red,'cel');
  editor.begin();editor.fill(3,3,[10,20,30,255]);editor.commit();assert.equal(editor.countColor([10,20,30,255],'cel'),12);
  editor.begin();editor.line(3,3,3,3,blue);editor.commit();assert.deepEqual(editor.sample(3,3),blue);
  for(let i=0;i<4;i++)editor.undo();assert.deepEqual(editor.region(),{x:0,y:0,width:2,height:2});assert.equal(editor.sample(3,3),undefined);assert.equal(editor.width,2);
});
test('fixed atlases reject size changes and previews but continue to allow palette metadata',()=>{
  const source={...blank(4,4),version:4,atlas:{texture:'sheet',frames:[{id:'left',frame:{u0:0,v0:0,u1:.5,v1:1}},{id:'right',frame:{u0:.5,v0:0,u1:1,v1:1}}]}},editor=create(source);
  assert.throws(()=>editor.resizeCanvas(8,8));assert.throws(()=>editor.previewResize(8,8));assert.deepEqual(editor.document(),source);assert.equal(editor.history().undo,0);
  editor.setPalette(['#11223300']);assert.deepEqual(editor.document().atlas,source.atlas);assert.equal(editor.width,4);
});
