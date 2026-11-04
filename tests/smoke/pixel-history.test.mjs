import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pixelDocument as d} from './pixel-editing-modules.mjs';
import {pixelCapacitySource} from './pixel-capacity-fixture.mjs';

function source(side=4,count=3,layers=2){
  const value=pixelCapacitySource({side,count,layers,tagged:false});
  value.layers.forEach(layer=>layer.visible=true);
  const rgba=Buffer.alloc(side*side*4).toString('base64');value.frames.forEach(frame=>frame.cels.forEach(cel=>cel.rgba=rgba));
  return value;
}
function paint(editor,color,x=0,y=0){editor.begin();editor.line(x,y,x,y,color);return editor.commit();}

test('maximum source retains 64 one-pixel steps and restores all original cels',()=>{
  const original=source(64,64,8),e=d.createPixelEditor(original);e.selectLayer('layer-0');e.selectFrame('frame-63');
  for(let i=0;i<64;i++)assert(paint(e,[i+1,9,17,0],i,0));
  const history=e.history();assert.equal(history.undo,64);assert(history.bytes<4096);assert(e.dirty());
  for(let i=63;i>=0;i--){e.undo();assert.deepEqual([...e.layerBytes('layer-0').slice(i*4,i*4+4)],[0,0,0,0]);}
  assert.deepEqual(e.document(),original);assert.equal(e.dirty(),false);assert.equal(e.history().redo,64);assert.equal(e.history().bytes,history.bytes);
  for(let i=0;i<64;i++){e.redo();assert.deepEqual([...e.layerBytes('layer-0').slice(i*4,i*4+4)],[i+1,9,17,0]);}
  const expected=Buffer.alloc(64*64*4);for(let i=0;i<64;i++)expected.set([i+1,9,17,0],i*4);
  const after=structuredClone(original);after.frames[63].cels[0].rgba=expected.toString('base64');assert.deepEqual(e.document(),after);
});

test('mixed pixel and metadata/shape snapshots restore exact sources, selections, checkpoint and revision',()=>{
  const e=d.createPixelEditor(source());e.selectLayer('layer-0');
  let checkpoint=JSON.stringify(e.document());
  const capture=()=>({document:e.document(),layer:e.selectedLayer(),frame:e.selectedFrame()});
  const steps=[];
  function edit(run){const before=capture();assert.notEqual(run(),false);steps.push({before,after:capture()});}
  edit(()=>paint(e,[7,9,13,0]));
  edit(()=>e.renameLayer('layer-1','Overlay'));
  edit(()=>e.replaceColor([0,0,0,0],[11,22,33,128],'document'));
  edit(()=>e.batchTransform(['frame-0','frame-2'],'layer-0',undefined,{kind:'flip-x'}));
  edit(()=>e.setLayerAppearance('layer-1',{blendMode:'screen',opacity:128}));
  e.markExported();checkpoint=JSON.stringify(e.document());assert.equal(e.dirty(),false);
  edit(()=>e.duplicateFrame());
  edit(()=>e.resizeCanvas(5,3,'top-left'));
  edit(()=>e.setPalette(['#123456ff']));
  edit(()=>e.importImageLayer('Imported',{x:0,y:0,width:1,height:1},new Uint8Array([99,88,77,0])));
  edit(()=>e.removeFrame('frame-1'));
  edit(()=>e.mergeLayers('visible'));
  edit(()=>paint(e,[4,5,6,255],2,1));
  for(let round=0;round<2;round++){
    for(let i=steps.length-1;i>=0;i--){const rev=e.revision();e.undo();assert.deepEqual(capture(),steps[i].before);assert.equal(e.revision(),rev+1);assert.equal(e.dirty(),JSON.stringify(e.document())!==checkpoint);}
    for(const step of steps){const rev=e.revision();e.redo();assert.deepEqual(capture(),step.after);assert.equal(e.revision(),rev+1);assert.equal(e.dirty(),JSON.stringify(e.document())!==checkpoint);}
  }
});

test('copy-on-write protects pending strokes, checkpoints, masks, fill and no-op redo branches',()=>{
  const original=source(),e=d.createPixelEditor(original);e.selectLayer('layer-0');
  const mask={region:{x:0,y:0,width:4,height:4},pixels:new Uint8Array(16).fill(1)};
  for(const run of [()=>e.line(0,0,3,3,[1,2,3,255]),()=>e.paintMask(mask,[1,2,3,255]),()=>{e.paintStrokeMask(mask,[1,2,3,255]);e.paintStrokeMask({...mask,pixels:new Uint8Array(16)},[1,2,3,255]);},()=>e.fill(0,0,[1,2,3,255]),()=>e.paintRegion({x:1,y:1,width:1,height:1},new Uint8Array([1,2,3,0]))]){
    e.begin();run();e.cancel();assert.deepEqual(e.document(),original);assert.equal(e.dirty(),false);assert.equal(e.history().undo,0);
  }
  paint(e,[5,6,7,255]);e.undo();const history=e.history();
  assert.equal(paint(e,[0,0,0,0]),false);assert.deepEqual(e.history(),history);
  e.begin();e.line(0,0,1,1,[8,9,10,255]);e.markExported();e.cancel();assert(e.dirty());assert.deepEqual(e.document(),original);assert.deepEqual(e.history(),history);
  e.redo();assert.deepEqual([...e.layerBytes('layer-0').slice(0,4)],[5,6,7,255]);e.undo();
  paint(e,[9,8,7,0]);assert.equal(e.history().redo,0);assert.equal(e.history().undo,1);e.undo();assert.deepEqual(e.document(),original);
});

test('dense document deltas and snapshot fallbacks evict within the existing 16MiB budget',()=>{
  const original=source(64,64,8),e=d.createPixelEditor(original);e.selectLayer('layer-0');
  paint(e,[1,2,3,255]);
  e.replaceColor([0,0,0,0],[4,5,6,255],'document');
  assert.equal(e.history().undo,1);assert.equal(e.history().bytes,d.PIXEL_LIMITS.historyBytes);
  e.undo();assert.deepEqual([...e.layerBytes('layer-0').slice(0,8)],[1,2,3,255,0,0,0,0]);e.redo();
  paint(e,[9,9,9,255]);assert.equal(e.history().undo,1);assert(e.history().bytes<1024);
  e.setLayerOpacity('layer-0',128);assert.equal(e.history().undo,1);assert.equal(e.history().bytes,d.PIXEL_LIMITS.historyBytes);
  e.undo();assert.equal(e.document().version,6);e.redo();assert.equal(e.document().version,8);
});

test('pixel deltas keep hidden/locked cels and old source versions unchanged',()=>{
  const originals=[d.newPixelDocument(4,4)];
  const layered=d.createPixelEditor(originals[0]);layered.addLayer();originals.push(layered.document());
  for(const version of [3,5,6,7,8,9]){
    const value=pixelCapacitySource({side:4,count:2,layers:2,version,tagged:[5,7].includes(version)});
    value.layers[1].locked=true;
    if(version>=8)value.layers.forEach(layer=>layer.opacity=255);
    if(version===9)value.layers.forEach(layer=>layer.blendMode='normal');
    originals.push(value);
  }
  const atlas={...d.newPixelDocument(4,4),version:4,atlas:{texture:'sheet',frames:[{id:'tile',name:'Tile',frame:{u0:0,v0:0,u1:1,v1:1}}]}};
  // The atlas metadata uses the same production parser as normal imports.
  originals.push(atlas);
  for(const original of originals){
    const e=d.createPixelEditor(original),before=e.document();paint(e,[13,17,19,0]);const after=e.document();
    assert.equal(after.version,before.version);e.undo();assert.deepEqual(e.document(),before);assert.equal(e.dirty(),false);e.redo();assert.deepEqual(e.document(),after);
    if(after.frames&&after.layers.length>1)assert.deepEqual(after.frames.map(f=>f.cels[1]),before.frames.map(f=>f.cels[1]));
  }
});
