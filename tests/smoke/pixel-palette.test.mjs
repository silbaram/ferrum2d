import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../../apps/placement-viewer/package.json',import.meta.url))('typescript');
async function url(name,imports={}){let code=ts.transpileModule(await readFile(new URL('../../apps/placement-viewer/src/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;for(const [from,to]of Object.entries(imports))code=code.replaceAll(JSON.stringify(from),JSON.stringify(to));return'data:text/javascript;base64,'+Buffer.from(code).toString('base64');}
async function load(url){try{return await import(url);}catch(error){process.exitCode=1;throw error;}}
const docUrl=await url('placementPixelDocument',{'./placementPixelAtlas':await url('placementPixelAtlas')});
const {newPixelDocument:blank,createPixelEditor:create,pixelColor}=await load(docUrl);
const {readPixelPalette,exportPixelPalette}=await load(await url('placementPixelPalette',{'./placementPixelDocument':docUrl}));
const blue=[0,0,255,128],red=[255,0,0,128],transparent=[17,34,51,0];
test('palette metadata shares Undo/dirty and preserves pixels and v1-v5 source contracts',()=>{
  const layered=create(blank(4,4));layered.addLayer();const framed=create(blank(4,4));framed.addFrame();const tagged=create(blank(4,4));tagged.addTag('idle',[tagged.frames()[0].id]);
  const atlas={...blank(4,4),version:4,atlas:{texture:'sheet',frames:[{id:'left',frame:{u0:0,v0:0,u1:.5,v1:1}},{id:'right',frame:{u0:.5,v0:0,u1:1,v1:1}}]}};
  for(const source of [blank(4,4),layered.document(),framed.document(),atlas,tagged.document()]){
    const editor=create(source),palette=['#11223300','#AABBCC80'];assert(editor.setPalette(palette));palette[0]='#ffffffff';
    assert.deepEqual(editor.document(),{...source,palette:['#11223300','#AABBCC80']});assert(editor.dirty());assert.equal(editor.history().undo,1);
    const value=editor.palette;value.length=0;assert.equal(editor.palette.length,2);
    editor.undo();assert.deepEqual(editor.document(),source);assert(!editor.dirty());editor.redo();assert.deepEqual(editor.palette,['#11223300','#AABBCC80']);
  }
});
test('palette no-op and invalid input preserve revision, redo and exact source atomically',()=>{
  const editor=create(blank(4,4));editor.setPalette([]);editor.undo();const source=editor.document(),history=editor.history(),revision=editor.revision();
  assert.equal(editor.setPalette(source.palette),false);
  for(const bad of [Array(257).fill('#000000ff'),Array(2),['#123'],['#gg000000'],[null]])assert.throws(()=>editor.setPalette(bad));
  assert.deepEqual(editor.document(),source);assert.deepEqual(editor.history(),history);assert.equal(editor.revision(),revision);
});
test('palette import/export is bounded, versioned and preserves order/duplicates/alpha',()=>{
  const colors=['#11223300','#AABBCC80','#11223300'];assert.deepEqual(readPixelPalette(exportPixelPalette(colors)),colors);
  assert.deepEqual(readPixelPalette(exportPixelPalette([])),[]);
  for(const input of ['{',JSON.stringify({colors}),JSON.stringify({format:'ferrum2d.pixel-palette',version:2,colors}),' '.repeat(16385)])assert.throws(()=>readPixelPalette(input));
});
test('color replacement scopes keep other cels/hidden/locked layers and metadata intact',()=>{
  const editor=create(blank(4,4));editor.begin();editor.fill(0,0,blue);editor.commit();const body=editor.selectedLayer();
  const locked=editor.addLayer();editor.begin();editor.fill(0,0,blue);editor.commit();editor.setLayerLocked(locked,true);
  const hidden=editor.addLayer();editor.begin();editor.fill(0,0,blue);editor.commit();editor.setLayerVisible(hidden,false);editor.selectLayer(body);editor.duplicateFrame();
  const before=editor.document();assert.equal(editor.countColor(blue,'document'),32);
  assert(editor.replaceColor(blue,red,'document'));const after=editor.document();
  for(let f=0;f<2;f++){
    assert.deepEqual(after.frames[f].cels.slice(1),before.frames[f].cels.slice(1));
    assert.equal(Buffer.from(after.frames[f].cels[0].rgba,'base64')[0],255);
  }
  assert.deepEqual(after.layers,before.layers);assert.deepEqual(after.frames.map(({id,durationMs})=>({id,durationMs})),before.frames.map(({id,durationMs})=>({id,durationMs})));
  editor.undo();assert.deepEqual(editor.document(),before);
  const clip={x:1,y:1,width:2,height:1};assert.equal(editor.countColor(blue,'selection',clip),2);editor.replaceColor(blue,red,'selection',clip);
  assert.equal(editor.countColor(red,'cel'),2);assert.equal(editor.countColor(blue,'document'),30);
});
test('replacement matches transparent RGB exactly and preserves other fully transparent colors',()=>{
  const source={...blank(2,1),rgba:Buffer.from([...transparent,0,0,0,0]).toString('base64')},editor=create(source);
  assert.equal(editor.countColor(transparent,'cel'),1);editor.replaceColor(transparent,red,'cel');
  assert.deepEqual([...editor.layerBytes(editor.selectedLayer())],[...red,0,0,0,0]);editor.undo();assert.deepEqual(editor.document(),source);
});
test('atlas recoloring stays in active rect; locked/invalid/no-op replacement fails without consuming history',()=>{
  const source={...blank(4,2),rgba:Buffer.from(Array(8).fill(blue).flat()).toString('base64'),version:4,atlas:{texture:'sheet',frames:[{id:'left',frame:{u0:0,v0:0,u1:.5,v1:1}},{id:'right',frame:{u0:.5,v0:0,u1:1,v1:1}}]}};
  const editor=create(source);editor.selectAtlasFrame('right');assert.equal(editor.countColor(blue,'cel'),4);editor.replaceColor(blue,red,'cel');
  const bytes=editor.layerBytes(editor.selectedLayer());assert.deepEqual([...bytes.subarray(0,8)],[...blue,...blue]);
  editor.undo();const revision=editor.revision(),history=editor.history();assert.equal(editor.replaceColor(blue,blue,'cel'),false);
  assert.throws(()=>editor.replaceColor(blue,red,'document'));assert.throws(()=>editor.replaceColor(blue,red,'selection'));assert.throws(()=>editor.replaceColor(blue,pixelColor('#ff000080'),'selection',{x:0,y:0,width:1,height:1}));
  assert.deepEqual(editor.document(),source);assert.equal(editor.revision(),revision);assert.deepEqual(editor.history(),history);
  const locked=create(blank(2,2));locked.setLayerLocked(locked.selectedLayer(),true);assert.throws(()=>locked.replaceColor([0,0,0,0],red,'cel'));assert.equal(locked.replaceColor([0,0,0,0],red,'document'),false);
});
