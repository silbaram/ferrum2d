import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../../apps/placement-viewer/package.json',import.meta.url))('typescript');
const source=await readFile(new URL('../../apps/placement-viewer/src/placementChangeLabels.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {describePlacementChange,comparePlacementValues}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const scene=instances=>({sceneComposition:{fragments:{'gar/den':{instances}}}});
const before=scene([{id:'tree'},{id:'garden_hero',x:800}]),after=scene([{id:'tree'},{id:'garden_hero',x:803},{id:'crate_2'}]);

test('instance changes are named by object id and field', () => {
 assert.deepEqual(describePlacementChange('/sceneComposition/fragments/gar~1den/instances/1/x',800,803,before,after),{object:'garden_hero',field:'x',kind:'changed'});
 assert.deepEqual(describePlacementChange('/sceneComposition/fragments/gar~1den/instances/1/props/components/visual/width',24,32,before,after),
  {object:'garden_hero',field:'visual.width',kind:'changed'},'component props drop their container prefix');
});

test('whole added and removed instances resolve from the side that has them', () => {
 assert.deepEqual(describePlacementChange('/sceneComposition/fragments/gar~1den/instances/2',undefined,{id:'crate_2'},before,after),{object:'crate_2',field:'',kind:'added'});
 assert.deepEqual(describePlacementChange('/sceneComposition/fragments/gar~1den/instances/1',{id:'garden_hero'},undefined,before,scene([{id:'tree'}])),{object:'garden_hero',field:'',kind:'removed'});
});

test('spatial entries use their key; document-level changes keep the path', () => {
 assert.deepEqual(describePlacementChange('/spatial/models/rock/position/y',0,48,{},{}),{object:'rock',field:'position.y',kind:'changed'});
 assert.deepEqual(describePlacementChange('/lighting/ambient/intensity',0.4,0.6,{},{}),{object:undefined,field:'lighting.ambient.intensity',kind:'changed'});
 assert.deepEqual(describePlacementChange('/sceneComposition/fragments/gar~1den/instances/9/x',1,2,before,after),{object:undefined,field:'sceneComposition.fragments.gar/den.instances.9.x',kind:'changed'},'an unresolvable index falls back to the path');
});

test('removing a middle instance is one removal, not shifted sibling edits', () => {
 const was=scene([{id:'a',x:1},{id:'b',x:2},{id:'c',x:3}]),now=scene([{id:'a',x:1},{id:'c',x:4}]),changes=[];
 comparePlacementValues(was,now,'',changes);
 assert.deepEqual(changes,[
  {path:'/sceneComposition/fragments/gar~1den/instances/1',before:{id:'b',x:2},after:undefined},
  {path:'/sceneComposition/fragments/gar~1den/instances/1/x',before:3,after:4},
 ],'removal keeps the before index; the surviving edit uses the after index');
 const [removed,edited]=changes.map(c=>describePlacementChange(c.path,c.before,c.after,was,now));
 assert.equal(removed.object,'b');assert.equal(edited.object,'c');
});

test('arrays without unique ids keep index comparison', () => {
 const changes=[];
 comparePlacementValues(scene([{id:'a'},{id:'a',x:1}]),scene([{id:'a'}]),'',changes);
 assert.deepEqual(changes.map(c=>c.path),['/sceneComposition/fragments/gar~1den/instances/1']);
 const other=[];comparePlacementValues({list:[1,2,3]},{list:[1,3]},'',other);
 assert.deepEqual(other.map(c=>c.path),['/list/1','/list/2'],'only scene instance arrays pair by id');
});
