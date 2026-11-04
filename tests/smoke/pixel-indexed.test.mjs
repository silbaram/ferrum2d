import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pixelDocument as d,pixelSelection as s,documentUrl,pixelModuleUrl,checkedPixelImport} from './pixel-editing-modules.mjs';
import {decodePng} from '../../scripts/tools/pack-textures.mjs';
const {pixelPng}=await checkedPixelImport(await pixelModuleUrl('placementPixelPng',{'./placementPixelDocument':documentUrl}));
const {pixelAnimationInput,pixelAnimation}=await checkedPixelImport(await pixelModuleUrl('placementPixelAnimation',{'./placementPixelDocument':documentUrl,'@ferrum2d/ferrum-web/authoring':new URL('../../packages/ferrum-web/dist/authoring.js',import.meta.url).href}));
const rgba=values=>Buffer.from(values.flat()).toString('base64'),red=[255,0,0,255],blue=[0,0,255,128],empty=[12,34,56,0];
function source(){return {format:'ferrum2d.pixel-document',version:9,name:'Indexed',width:2,height:2,colorSpace:'srgb',palette:[],
  layers:[{id:'base',name:'Body',visible:true,locked:false,opacity:255,blendMode:'normal'},{id:'hidden',name:'Hidden',visible:false,locked:true,opacity:128,blendMode:'screen'}],
  frames:['a','b'].map((id,i)=>({id,durationMs:i?177:93,cels:[{layerId:'base',rgba:rgba([red,blue,empty,[0,0,0,0]])},{layerId:'hidden',rgba:rgba([blue,red,empty,red])}]})),
  tags:[{id:'idle',name:'Idle',clipId:7,frameIds:['b','a'],loop:true,direction:'pingpong'}],initialTag:'idle',nextClipId:8};}
function indexed(){const editor=d.createPixelEditor(source());editor.setColorMode('indexed');return editor.document();}
test('v10 stores real one-byte indices, exact transparency and unique global palette across cels',()=>{
  const original=source(),editor=d.createPixelEditor(original),before=d.pixelAtlas(original);editor.setColorMode('indexed');const saved=editor.document();
  assert.equal(saved.version,10);assert.equal(saved.colorMode,'indexed');assert.deepEqual(saved.palette,['#00000000','#ff0000ff','#0000ff80','#0c223800']);
  assert.deepEqual([...Buffer.from(saved.frames[0].cels[0].indices,'base64')],[1,2,3,0]);assert(!('rgba' in saved.frames[0].cels[0]));
  assert.deepEqual(d.readPixelDocument(JSON.stringify(saved)),saved);assert.deepEqual(d.createPixelEditor(saved).document(),saved);assert.deepEqual(d.pixelAtlas(saved),before);assert.deepEqual(saved.tags,original.tags);
  assert.equal(editor.history().undo,1);editor.undo();assert.deepEqual(editor.document(),original);editor.redo();assert.deepEqual(editor.document(),saved);assert.equal(editor.setColorMode('indexed'),false);
});
test('indexed entry edits recolor same indices in every frame including hidden locked layers',()=>{
  const editor=d.createPixelEditor(indexed()),before=editor.document();editor.setPaletteEntry(1,'#00FF00FF');const next=editor.document();
  assert.equal(next.palette[1],'#00ff00ff');assert.deepEqual(next.frames,before.frames,'all cel indices are unchanged');
  for(const frame of editor.frames()){editor.selectFrame(frame.id);assert.deepEqual([...editor.layerBytes('hidden').slice(4,8)],[0,255,0,255]);}
  editor.undo();assert.deepEqual(editor.document(),before);editor.redo();assert.deepEqual(editor.document(),next);
  editor.setColorMode('rgba');const restored=editor.document();assert.equal(restored.version,9);assert.equal(restored.frames[1].cels[1].rgba,rgba([blue,[0,255,0,255],empty,[0,255,0,255]]));assert.deepEqual(restored.tags,before.tags);
});
test('palette reorder remaps indices but preserves all RGBA; unused deletion is safe',()=>{
  const editor=d.createPixelEditor(indexed()),before=editor.document(),atlas=d.pixelAtlas(before),colors=editor.palette;[colors[1],colors[3]]=[colors[3],colors[1]];
  editor.setPalette(colors);assert.deepEqual([...Buffer.from(editor.document().frames[0].cels[0].indices,'base64')],[3,2,1,0]);assert.deepEqual(d.pixelAtlas(editor.document()),atlas);
  editor.setPalette([...editor.palette,'#ffffffff']);editor.setPalette(editor.palette.slice(0,-1));assert.deepEqual(d.pixelAtlas(editor.document()),atlas);
  const stable=editor.document(),history=editor.history();for(const palette of [editor.palette.slice(1),editor.palette.filter((_,i)=>i!==1),[...editor.palette,'#ff0000ff']])assert.throws(()=>editor.setPalette(palette));
  assert.throws(()=>editor.setPaletteEntry(0,'#ffffff00'));assert.throws(()=>editor.setPaletteEntry(1,editor.palette[2]));assert.deepEqual(editor.document(),stable);assert.deepEqual(editor.history(),history);
});
test('painting adds exact new colors, supports bounded delta history, eraser and frame/layer edits',()=>{
  const editor=d.createPixelEditor(indexed());editor.editRegion({x:0,y:0,width:1,height:1},new Uint8Array([5,6,7,200]));assert.equal(editor.palette.at(-1),'#050607c8');
  const painted=editor.document();assert.equal(Buffer.from(painted.frames[0].cels[0].indices,'base64')[0],4);editor.undo();editor.redo();assert.deepEqual(editor.document(),painted);
  editor.editRegion({x:0,y:0,width:1,height:1},new Uint8Array(4));assert.equal(Buffer.from(editor.document().frames[0].cels[0].indices,'base64')[0],0);
  const added=editor.addLayer();editor.setLayerBlendMode(added,'multiply');editor.addFrame();editor.setFrameDuration(editor.selectedFrame(),121);editor.addTag('New',[editor.selectedFrame()]);
  assert.equal(editor.version,10);assert.deepEqual(d.createPixelEditor(editor.document()).document(),editor.document());
});
test('color overflow rejects conversion and paint atomically without losing Redo or saved state',()=>{
  const bytes=Uint8Array.from(Array.from({length:256},(_,i)=>[i,1,2,255]).flat()),original=d.pixelDocumentFromRgba(16,16,'many',bytes),editor=d.createPixelEditor(original);
  assert.throws(()=>editor.setColorMode('indexed'),/limit/);assert.deepEqual(editor.document(),original);assert.equal(editor.history().undo,0);assert.equal(editor.dirty(),false);
  bytes.set([0,0,0,0]);const e=d.createPixelEditor(d.pixelDocumentFromRgba(16,16,'full',bytes));e.setColorMode('indexed');assert.equal(e.palette.length,256);
  e.setPaletteEntry(1,'#ff00ffff');e.undo();const before=e.document(),history=e.history();
  assert.throws(()=>e.editRegion({x:0,y:0,width:1,height:1},new Uint8Array([5,6,7,255])),/limit/);assert.deepEqual(e.document(),before);assert.deepEqual(e.history(),history);assert.equal(e.active(),false);e.redo();assert.equal(e.palette[1],'#ff00ffff');
  e.begin();e.line(0,0,0,0,[9,8,7,255]);assert.throws(()=>e.commit(),/limit/);assert.equal(e.active(),false);assert.equal(e.palette[1],'#ff00ffff');
});
test('malformed index bytes, palette, dual encodings and legacy indexed fields are rejected',()=>{
  const good=indexed();
  for(const mutate of [s=>s.colorMode='rgba',s=>delete s.colorMode,s=>s.palette=[],s=>s.palette[0]='#ffffff00',s=>s.palette.push(s.palette[1]),s=>s.frames[0].cels[0].indices=Buffer.from([9,2,3,0]).toString('base64'),s=>s.frames[0].cels[0].indices='AQ==',s=>s.frames[0].cels[0].rgba='AAAA',s=>s.frames[0].cels[0].layerId='bad',s=>delete s.layers[1].blendMode,s=>delete s.initialTag]){
    const bad=structuredClone(good);mutate(bad);assert.throws(()=>d.readPixelDocument(JSON.stringify(bad)));
  }
  const legacy=source();legacy.colorMode='indexed';assert.throws(()=>d.readPixelDocument(JSON.stringify(legacy)),/v10/);delete legacy.colorMode;legacy.frames[0].cels[0].indices='AAAAAA==';assert.throws(()=>d.readPixelDocument(JSON.stringify(legacy)),/v10/);
});
test('PNG, source-frame timing, fixed-atlas rejection and free transform retain their contracts',async()=>{
  const original=source(),saved=indexed();assert.deepEqual(decodePng(Buffer.from(await pixelPng(saved))),decodePng(Buffer.from(await pixelPng(original))));
  assert.deepEqual(pixelAnimation(pixelAnimationInput(saved)),pixelAnimation(pixelAnimationInput(original)));
  const editor=d.createPixelEditor(saved),selection=s.createPixelSelection({editor:()=>editor,canEdit:()=>true});selection.all();const session=selection.beginFreeTransform(),settings={angle:90,scaleX:1,scaleY:1,sampling:'nearest'};
  const expected=session.preview(settings).pixels;session.apply(settings);assert.deepEqual(editor.bytes(),expected);assert.equal(editor.version,10);editor.undo();assert.deepEqual(editor.document(),saved);
  const base=d.newPixelDocument(2,2),fixed={...base,version:4,atlas:{texture:'sheet',frames:[{id:'all',frame:{u0:0,v0:0,u1:1,v1:1}}]}};const atlas=d.createPixelEditor(fixed);assert.throws(()=>atlas.setColorMode('indexed'),/fixed/);assert.deepEqual(atlas.document(),fixed);
});
test('v1 through v9 keep their original serialization without a color-mode edit',()=>{
  const base=d.newPixelDocument(2,2),docs=[base,{...base,version:4,atlas:{texture:'sheet',frames:[{id:'all',frame:{u0:0,v0:0,u1:1,v1:1}}]}}];
  for(const version of [3,5,6,7,8,9]){const value=source();value.version=version;if(version<9)value.layers.forEach(l=>delete l.blendMode);if(version<8)value.layers.forEach(l=>delete l.opacity);if(version<7)value.tags.forEach(t=>delete t.direction);if(version===3)for(const key of ['tags','initialTag','nextClipId'])delete value[key];docs.push(value);}
  docs.push({format:base.format,version:2,name:base.name,width:2,height:2,colorSpace:'srgb',frame:base.frame,palette:base.palette,layers:[{...base.layer,visible:true,locked:false,rgba:base.rgba}]});
  for(const value of docs){assert.deepEqual(d.createPixelEditor(value).document(),value);const editor=d.createPixelEditor(value);assert.equal(editor.setColorMode('rgba'),false);assert.deepEqual(editor.document(),value);}
});
test('maximum 64-frame eight-layer indexed source preserves history, bounds and recovery',async()=>{
  const value=indexed();delete value.tags;delete value.initialTag;delete value.nextClipId;value.width=value.height=64;
  value.palette=['#00000000',...Array.from({length:64},(_,i)=>'#'+i.toString(16).padStart(2,'0')+'1020ff')];
  value.layers=Array.from({length:8},(_,i)=>({id:'l'+i,name:'Layer '+i,visible:true,locked:false,opacity:255,blendMode:'normal'}));
  value.frames=Array.from({length:64},(_,f)=>({id:'f'+f,durationMs:100+f,cels:value.layers.map((layer,l)=>({layerId:layer.id,indices:Buffer.alloc(4096,1+(f+l)%64).toString('base64')}))}));
  const editor=d.createPixelEditor(value);assert.deepEqual(editor.document(),value);editor.selectLayer('l0');
  for(let x=0;x<4;x++)editor.editRegion({x,y:0,width:1,height:1},new Uint8Array([63,16,32,255]));
  assert.equal(editor.history().undo,4);assert.equal(editor.history().bytes,32);for(let i=0;i<4;i++)editor.undo();assert.deepEqual(editor.document(),value);
  const recovery=await checkedPixelImport(await pixelModuleUrl('placementPixelRecovery',{'./placementPixelDocument':documentUrl}));
  const text=JSON.stringify(value),row={id:crypto.randomUUID(),scope:recovery.pixelRecoveryScope('/indexed','scene.json','http://localhost'),updatedAt:Date.now(),name:value.name,source:text,bytes:Buffer.byteLength(text)};
  assert.deepEqual(recovery.readPixelCheckpoint(row),row);
  const tooMany=structuredClone(value);tooMany.frames.push({...value.frames[0],id:'overflow'});assert.throws(()=>d.readPixelDocument(JSON.stringify(tooMany)),/budget/);
  const tooLarge={...value,width:256,height:256};assert.throws(()=>d.readPixelDocument(JSON.stringify(tooLarge)),/budget/);
});

test('indexed input byte limit is not reapplied to its larger decoded working document',()=>{
  const value=indexed(),base=JSON.stringify({...value,note:""});
  // Unknown source metadata is ignored by the established v1–v10 reader contract.
  const withMetadata={...value,note:'x'.repeat(d.PIXEL_LIMITS.sourceBytes-Buffer.byteLength(base)-1)};
  const text=JSON.stringify(withMetadata);assert(Buffer.byteLength(text)<d.PIXEL_LIMITS.sourceBytes);
  const expanded={...withMetadata,version:9,frames:value.frames.map(frame=>({...frame,cels:frame.cels.map(cel=>({layerId:cel.layerId,rgba:Buffer.concat([...Buffer.from(cel.indices,'base64')].map(index=>Buffer.from(value.palette[index].slice(1),'hex'))).toString('base64')}))}))};
  delete expanded.colorMode;assert(Buffer.byteLength(JSON.stringify(expanded))>d.PIXEL_LIMITS.sourceBytes,'regression fixture must exceed the limit only after decoding');
  assert.deepEqual(d.readPixelDocument(text),value);
  assert.throws(()=>d.readPixelDocument(text+' '.repeat(100)),/byte limit/);
});
