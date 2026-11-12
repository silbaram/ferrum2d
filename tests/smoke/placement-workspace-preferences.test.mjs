import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../../apps/studio/package.json',import.meta.url))('typescript');
const source=await readFile(new URL('../../apps/studio/src/placementWorkspacePreferences.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
let api;
try{api=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));}
catch(error){process.exitCode=1;console.error('Workspace preferences bootstrap failed:',String(error.message).slice(0,200));throw error;}
const {readWorkspacePreferences:read,serializeWorkspacePresets:serialize,defaultWorkspaceLayout:defaults}=api;
const legacy=JSON.stringify({scene:280,inspector:352,runtime:152,hidden:['runtime']});
test('legacy custom layout survives new profiles and cannot be overwritten by their payload',()=>{
  const prefs=read(legacy,JSON.stringify({active:'assets',layouts:{custom:{scene:400,hidden:['scene']}}}));
  assert.equal(prefs.active,'assets');assert.deepEqual(prefs.layouts.custom,JSON.parse(legacy));
  assert.deepEqual(prefs.layouts.assets.hidden,['scene','inspector']);
});
test('malformed preferences and unknown profile IDs fall back without losing legacy settings',()=>{
  for(const text of [null,'{bad','null','42','[]','{"active":"__proto__"}','{"active":"constructor"}']){
    const prefs=read(legacy,text);assert.equal(prefs.active,'custom');assert.deepEqual(prefs.layouts.custom,JSON.parse(legacy));
  }
  assert.deepEqual(read('{bad',null).layouts.custom,defaults('custom'));
});
test('stored sizes and hidden docks are sanitized within each profile',()=>{
  const prefs=read(JSON.stringify({scene:0,inspector:999,runtime:'bad',hidden:['runtime','runtime','unknown']}),
    JSON.stringify({active:'review',layouts:{review:{scene:999,inspector:0,runtime:167.7,hidden:['scene','scene','invalid']},assets:false}}));
  assert.deepEqual(prefs.layouts.custom,{scene:160,inspector:480,runtime:168,hidden:['runtime']});
  assert.deepEqual(prefs.layouts.review,{scene:400,inspector:240,runtime:168,hidden:['scene'],runtimePinned:true});
  assert.deepEqual(prefs.layouts.assets,defaults('assets'));
});
test('named profile edits round-trip independently while custom remains in its legacy key',()=>{
  const prefs=read(legacy,null);prefs.active='scene';prefs.layouts.scene.scene=304;prefs.layouts.scene.hidden.push('inspector');
  prefs.layouts.assets.runtime=248;
  const encoded=serialize(prefs),restored=read(legacy,encoded);
  assert.equal(restored.active,'scene');assert.equal(restored.layouts.assets.runtime,248);
  assert.deepEqual(restored.layouts.scene,{scene:304,inspector:320,runtime:168,hidden:['inspector','runtime']});
  assert.equal(JSON.parse(encoded).layouts.custom,undefined);
  assert.equal(encoded.includes('focused'),false);assert.equal(encoded.includes('compactPanel'),false);
  assert.deepEqual(restored.layouts.custom,JSON.parse(legacy));
});
test('default and loaded layouts never share mutable dock visibility arrays',()=>{
  const a=read(legacy,null),b=read(legacy,null);a.layouts.assets.hidden.push('runtime');a.layouts.custom.hidden.length=0;
  assert.deepEqual(b.layouts.assets.hidden,['scene','inspector']);assert.deepEqual(b.layouts.custom.hidden,['runtime']);
  const value=defaults('scene');value.hidden.length=0;assert.deepEqual(defaults('scene').hidden,['runtime']);
  assert.deepEqual(a.layouts.review.hidden,['scene','inspector']);
});
test('bottom panels start as a drawer except in layouts built around them, and the choice round-trips',()=>{
  assert.equal(defaults('custom').runtimePinned,undefined);assert.equal(defaults('scene').runtimePinned,undefined);
  assert.equal(defaults('assets').runtimePinned,true);assert.equal(defaults('review').runtimePinned,true);
  const prefs=read(legacy,null);assert.equal(prefs.layouts.custom.runtimePinned,undefined);
  prefs.layouts.assets.runtimePinned=false;
  assert.equal(read(legacy,serialize(prefs)).layouts.assets.runtimePinned,false);
  assert.equal(read(JSON.stringify({...JSON.parse(legacy),runtimePinned:true}),null).layouts.custom.runtimePinned,true);
  assert.equal(read(JSON.stringify({...JSON.parse(legacy),runtimePinned:'yes'}),null).layouts.custom.runtimePinned,undefined);
});
