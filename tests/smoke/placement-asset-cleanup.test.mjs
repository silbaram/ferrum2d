import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../../apps/placement-viewer/package.json',import.meta.url))('typescript');
const code=ts.transpileModule(await readFile(new URL('../../apps/placement-viewer/src/placementAssetCleanup.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {readCleanupReport:read,readCleanupBackups:readBackups,readCleanupResult:result,protectCleanupDocuments:protect,cleanupSelection:selection}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const hash='a'.repeat(64),id='pixel.'+'a'.repeat(24),key='.ferrum-pixels:'+id;
function fixture(){return {format:'ferrum2d.asset-cleanup',version:1,snapshot:hash,deletionAllowed:false,jsonFiles:1,jsonBytes:100,revisions:[{key,kind:'pixel',id,assets:[id],files:[{name:id+'.json',bytes:10,sha256:hash},{name:id+'.png',bytes:20,sha256:hash}],references:[]}],catalogs:[{kind:'pixel',revisions:1,backupBytes:100}],backups:[]};}
test('native plans stay bounded, read-only and detached from the original reply',()=>{
 const source=fixture(),copy=read(source);assert.deepEqual(copy,source);copy.revisions[0].references.push('test');assert.deepEqual(source.revisions[0].references,[]);
 for(const edit of [v=>v.deletionAllowed=true,v=>v.snapshot='../path',v=>v.revisions[0].files[0].name='../source.json',v=>v.revisions[0].files[0].bytes=-1,v=>v.catalogs[0].revisions=2,v=>v.revisions.push(v.revisions[0]),v=>v.jsonFiles=257]){const value=fixture();edit(value);assert.throws(()=>read(value));}
});
test('open saved and draft documents add protection without allowing disk references to be removed',()=>{
 const value=read(fixture());value.revisions[0].references.push('public/closed.json');
 const keys=protect(value,[{scene:'opened.json',document:{nested:{asset:id}}},{scene:'draft.json',document:{file:id+'.png'}}]);
 assert.deepEqual(keys,[key]);assert.deepEqual(value.revisions[0].references,['public/closed.json','Open: opened.json','Open: draft.json']);
 assert.throws(()=>selection(value,new Set([key]),keys));
});
test('protection does not instantiate scenes or execute arbitrary authored strings',()=>{
 const value=read(fixture());const before=globalThis.__cleanupMustNotRun;
 assert.deepEqual(protect(value,[{scene:'other',document:{expression:'globalThis.__cleanupMustNotRun = 1',asset:'unrelated'}}]),[]);
 assert.equal(globalThis.__cleanupMustNotRun,before);
});
test('open document and byte limits stop a partial plan',()=>{
 assert.throws(()=>protect(read(fixture()),Array.from({length:65},()=>({scene:'a',document:{}}))),/extra scene/);
 assert.throws(()=>protect(read(fixture()),[{scene:'large',document:{value:'a'.repeat(16*1024*1024)}}]),/budget/);
 const cycle={};cycle.self=cycle;assert.throws(()=>protect(read(fixture()),[{scene:'cycle',document:cycle}]));
});
test('one-catalog selections retain snapshot and all protected keys',()=>{
 const value=read(fixture());assert.deepEqual(selection(value,new Set([key]),[]),{expectedSnapshot:hash,selected:[key],protectedKeys:[]});
 assert.throws(()=>selection(value,new Set(),[]));assert.throws(()=>selection(value,new Set([key,'unknown']),[]));assert.throws(()=>selection(value,new Set([key]),[key]));
 value.revisions.push({...value.revisions[0],key:'.ferrum-tiles:tile.id',id:'tile.id',kind:'tile'});
 assert.throws(()=>selection(value,new Set([key,'.ferrum-tiles:tile.id']),[]));
});
test('recovery records cannot be confused with a success that permits stale editing',()=>{
 const valid={backupId:hash,backupPath:'/project/.ferrum-asset-backups/'+hash,removedFiles:2,removedBytes:30,requiresReload:true};assert.deepEqual(result(valid),valid);
 for(const edit of [v=>v.requiresReload=false,v=>v.backupId='invalid',v=>v.removedBytes=65*1024*1024]){const value={...valid};edit(value);assert.throws(()=>result(value));}
});
test('incomplete backups can be reported without enabling a restore',()=>{
 const value=fixture();value.backups=[{id:'a'.repeat(64),kind:null,selected:[],createdAt:0,restored:false,problem:'Incomplete backup'}];assert.equal(read(value).backups[0].problem,'Incomplete backup');
 value.backups[0].problem=null;assert.throws(()=>read(value));
});
test('unresolved numeric texture references protect open snapshots',()=>{
 const value=read(fixture());
 assert.deepEqual(protect(value,[{scene:'numeric.json',document:{visual:{texture:7}}}]),[key]);
 assert(value.revisions[0].references.some(reference=>reference.includes('unresolved numeric texture')));
 const unrelated=read(fixture());assert.deepEqual(protect(unrelated,[{scene:'data',document:{score:7}}]),[]);
});
test('backup-only recovery replies are detached and reject duplicate operation IDs',()=>{
 const values=[{id:hash,kind:'pixel',selected:[id],createdAt:0,restored:false,problem:null}];
 const copy=readBackups(values);copy[0].selected.push('other');assert.deepEqual(values[0].selected,[id]);
 assert.throws(()=>readBackups([...values,...values]),/Duplicate/);
 assert.throws(()=>readBackups({backups:values}));
});
