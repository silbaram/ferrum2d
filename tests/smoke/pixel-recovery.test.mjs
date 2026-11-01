import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../apps/placement-viewer/package.json',import.meta.url)),ts=require('typescript');
async function checkedImport(url) {
  try {return await import(url);} catch(error){process.exitCode=1;console.error('Pixel recovery test bootstrap failed:',String(error?.message??error).slice(0,160));throw error;}
}
async function moduleUrl(name,imports={}) {
  let code=ts.transpileModule(await readFile(new URL('../../apps/placement-viewer/src/'+name+'.ts',import.meta.url),'utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
  }).outputText;
  for(const [from,to]of Object.entries(imports))code=code.replaceAll(JSON.stringify(from),JSON.stringify(to));
  return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
}
const atlas=await moduleUrl('placementPixelAtlas'),document=await moduleUrl('placementPixelDocument',{'./placementPixelAtlas':atlas});
const {newPixelDocument,createPixelEditor}=await checkedImport(document);
const recovery=await moduleUrl('placementPixelRecovery',{'./placementPixelDocument':document});
const {pixelRecoveryScope,readPixelCheckpoint,retainedPixelCheckpoints,PIXEL_RECOVERY_LIMITS,createPixelRecoveryStore}=await checkedImport(recovery);
const {createPixelRecoverySession}=await checkedImport(await moduleUrl('placementPixelRecoverySession',{'./placementPixelRecovery':recovery}));
const scope=pixelRecoveryScope('/project/A','scene.json','http://localhost/');
const row=(source=newPixelDocument(4,3),id=crypto.randomUUID(),updatedAt=Date.now())=>{
  const json=JSON.stringify(source);return {id,scope,updatedAt,name:source.name,source:json,bytes:Buffer.byteLength(json)};
};
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
function memoryStore() {
  const rows=new Map();let closed=false;
  return {rows,get closed(){return closed;},
    async list(scope){return [...rows.values()].filter(r=>r.scope===scope).map(({source,...r})=>r);},
    async read(scope,id){const r=rows.get(id);assert.equal(r?.scope,scope);return structuredClone(r);},
    async put(r){rows.set(r.id,structuredClone(r));},async remove(scope,id){if(rows.get(id)?.scope===scope)rows.delete(id);},close(){closed=true;},
  };
}
function session(store=memoryStore()) {
  let allowed=true;
  return {store,client:createPixelRecoverySession({store,changed(){},canCapture:()=>allowed,delay:10000}),block:()=>{allowed=false;},unblock:()=>{allowed=true;}};
}
test('recovery scope isolates project, browser origin/path, and scene source',()=>{
  assert.notEqual(scope,pixelRecoveryScope('/project/B','scene.json','http://localhost/'));
  assert.notEqual(scope,pixelRecoveryScope('/project/A','other.json','http://localhost/'));
  assert.notEqual(pixelRecoveryScope(undefined,'scene','http://localhost/'),pixelRecoveryScope('http://localhost/','scene','unused'));
  assert.notEqual(pixelRecoveryScope(undefined,'scene','http://localhost/a'),pixelRecoveryScope(undefined,'scene','http://localhost/b'));
});
test('checkpoint validation preserves exact source and rejects corrupt or mismatched data',()=>{
  const r=row();assert.deepEqual(readPixelCheckpoint(r),r);
  for(const change of [{source:'{'},{bytes:r.bytes+1},{name:'other'},{id:'bad'},{updatedAt:Infinity},{updatedAt:Number.MAX_SAFE_INTEGER}])
    assert.throws(()=>readPixelCheckpoint({...r,...change}));
  const bad={...newPixelDocument(2,2),version:6};assert.throws(()=>readPixelCheckpoint(row(bad)),/Invalid pixel recovery data/);
});
test('checkpoint roundtrip preserves all existing source versions and stable metadata',()=>{
  const layered=createPixelEditor(newPixelDocument(4,4));layered.addLayer();
  const framed=createPixelEditor(newPixelDocument(4,4));framed.addFrame();
  const tagged=createPixelEditor(newPixelDocument(4,4));tagged.addTag('idle',[tagged.frames()[0].id]);
  const fixed={...newPixelDocument(4,4),version:4,atlas:{texture:'sheet',frames:[{id:'left',frame:{u0:0,v0:0,u1:.5,v1:1}},{id:'right',frame:{u0:.5,v0:0,u1:1,v1:1}}]}};
  const sources=[newPixelDocument(4,4),layered.document(),framed.document(),fixed,tagged.document()];
  assert.deepEqual(sources.map(s=>s.version),[1,2,3,4,5]);
  for(const source of sources){const r=row(source);assert.equal(readPixelCheckpoint(r).source,r.source);assert.deepEqual(JSON.parse(readPixelCheckpoint(r).source),source);}
});
test('retention removes expired/malformed rows and keeps newest 8 independent sessions',()=>{
  const now=Date.now(),rows=Array.from({length:12},(_,i)=>row(undefined,undefined,now-i));
  const kept=retainedPixelCheckpoints([...rows,row(undefined,undefined,now-PIXEL_RECOVERY_LIMITS.age-1),{}],now);
  assert.deepEqual(kept.map(r=>r.id),rows.slice(0,8).map(r=>r.id));
  assert(!retainedPixelCheckpoints([{...rows[0],bytes:1}],now).length);
});
test('retention bounds total actual UTF8 bytes and reserves the incoming checkpoint across clock ties',()=>{
  const payload='x'.repeat(12*1024*1024),now=Date.now();
  const rows=Array.from({length:4},()=>({...row(),updatedAt:now,source:payload,bytes:payload.length}));
  const kept=retainedPixelCheckpoints(rows,now,rows[3].id);
  assert.equal(kept.length,2);assert.equal(kept[0].id,rows[3].id);
  assert(kept.reduce((sum,r)=>sum+r.bytes,0)<=PIXEL_RECOVERY_LIMITS.bytes);
});
test('saving a committed source is read-only to pixel history, metadata and dirty checkpoint',async()=>{
  const {client,store}=session(),editor=createPixelEditor(newPixelDocument(4,3));
  editor.begin();editor.line(0,0,2,0,[1,2,3,0]);editor.commit();
  const before={source:editor.document(),history:editor.history(),dirty:editor.dirty(),revision:editor.revision()};
  client.observe(editor,scope,true);await client.flush();
  assert.equal(store.rows.size,1);assert.deepEqual(JSON.parse([...store.rows.values()][0].source),before.source);
  assert.deepEqual({source:editor.document(),history:editor.history(),dirty:editor.dirty(),revision:editor.revision()},before);
  await client.forget();client.destroy();
});
test('an active stroke or floating preview cannot replace the last completed checkpoint',async()=>{
  const s=session(),editor=createPixelEditor(newPixelDocument(3,3));s.client.observe(editor,scope,true);await s.client.flush();
  const before=structuredClone([...s.store.rows.values()]);
  editor.begin();editor.line(0,0,1,1,[255,0,0,255]);await s.client.flush();assert.deepEqual([...s.store.rows.values()],before);
  editor.cancel();s.block();await s.client.flush();assert.deepEqual([...s.store.rows.values()],before);
  s.unblock();await s.client.forget();s.client.destroy();
});
test('independent tabs never overwrite each other and a clean source does not recreate a session',async()=>{
  const store=memoryStore(),a=session(store),b=session(store),editor=createPixelEditor(newPixelDocument(2,2));
  a.client.observe(editor,scope,true);b.client.observe(editor,scope,true);await Promise.all([a.client.flush(),b.client.flush()]);
  assert.equal(store.rows.size,2);
  a.client.observe(editor,scope,false);await a.client.forget();assert.equal(store.rows.size,1);
  for(let i=0;i<20;i++)a.client.observe(editor,scope,false);
  await a.client.flush();assert.equal(store.rows.size,1);
  await b.client.forget();a.client.destroy();b.client.destroy();
});
test('a first provisional stroke on a clean source cannot create a recovery session during teardown',async()=>{
  const s=session(),editor=createPixelEditor(newPixelDocument(2,2));editor.markExported();
  editor.begin();editor.line(0,0,1,1,[255,0,0,255]);s.client.observe(editor,scope,true);
  editor.cancel();s.client.destroy();await tick();assert.equal(s.store.rows.size,0);
});
test('queued deletion follows an in-flight write; discarded work cannot resurrect',async()=>{
  const store=memoryStore(),put=store.put;let release,started;
  const ready=new Promise(resolve=>started=resolve);
  store.put=async value=>{started();await new Promise(resolve=>release=resolve);await put(value);};
  const s=session(store),editor=createPixelEditor(newPixelDocument(2,2));s.client.observe(editor,scope,true);
  const writing=s.client.flush();await ready;const removing=s.client.forget();release();await Promise.all([writing,removing]);
  assert.equal(store.rows.size,0);s.client.destroy();
});
test('a stalled writer coalesces repeated edits into one latest snapshot', {timeout:2000}, async()=>{
  const s=session(),put=s.store.put;let release,started,finished,calls=0;
  const ready=new Promise(resolve=>started=resolve),latest=new Promise(resolve=>finished=resolve);
  s.store.put=async value=>{calls++;if(calls===1){started();await new Promise(resolve=>release=resolve);}await put(value);if(calls===2)finished();};
  const editor=createPixelEditor(newPixelDocument(2,2));s.client.observe(editor,scope,true);const pending=s.client.flush();await ready;
  for(let i=0;i<25;i++){editor.begin();editor.line(0,0,0,0,[i+1,20,30,255]);editor.commit();s.client.observe(editor,scope,true);void s.client.flush();}
  assert.equal(calls,1);release();await pending;await latest;assert.equal(calls,2);
  assert.deepEqual(JSON.parse([...s.store.rows.values()][0].source),editor.document());
  await s.client.forget();s.client.destroy();
});
test('quota failure preserves the completed checkpoint and manual retry can recover',async()=>{
  const s=session(),editor=createPixelEditor(newPixelDocument(2,2));s.client.observe(editor,scope,true);await s.client.flush();
  const before=structuredClone([...s.store.rows.values()]),put=s.store.put;
  s.store.put=async()=>{throw new DOMException('quota','QuotaExceededError');};
  editor.begin();editor.line(0,0,0,0,[255,0,0,255]);editor.commit();s.client.observe(editor,scope,true);await s.client.flush();
  assert.match(s.client.state().status,/storage is full/);assert.deepEqual([...s.store.rows.values()],before);
  s.store.put=put;await s.client.flush();assert.notEqual([...s.store.rows.values()][0].source,before[0].source);
  await s.client.forget();s.client.destroy();
});
test('late list results cannot replace a different project recovery list',async()=>{
  const store=memoryStore(),list=store.list;let release;
  store.list=async key=>key===scope?new Promise(resolve=>release=resolve):list(key);
  const s=session(store),old=s.client.refresh(scope),other=pixelRecoveryScope('/B','scene','unused');
  const r={...row(),scope:other};await store.put(r);await s.client.refresh(other);release([row()]);await old;
  assert.deepEqual(s.client.state().entries.map(r=>r.id),[r.id]);s.client.destroy();
});
test('switching recovery scope clears old metadata before the next asynchronous list arrives',async()=>{
  const s=session(),r=row();await s.store.put(r);await s.client.refresh(scope);assert.equal(s.client.state().entries.length,1);
  let release;s.store.list=()=>new Promise(resolve=>release=resolve);
  const pending=s.client.refresh('another-scene');assert.equal(s.client.state().entries.length,0);
  release([]);await pending;s.client.destroy();
});
test('dispose keeps the last completed checkpoint and releases storage after queued work',async()=>{
  const s=session(),editor=createPixelEditor(newPixelDocument(2,2));s.client.observe(editor,scope,true);await s.client.flush();
  s.client.destroy();await tick();assert.equal(s.store.rows.size,1);assert(s.store.closed);
});
test('dispose captures completed edits before the host releases its editor',async()=>{
  const s=session(),editor=createPixelEditor(newPixelDocument(2,2));
  const put=s.store.put,close=s.store.close;let writes=0,closes=0;
  s.store.put=async value=>{writes++;await put(value);};s.store.close=()=>{closes++;close();};
  editor.begin();editor.line(0,0,1,1,[13,17,23,0]);editor.commit();
  const expected=editor.document(),history=editor.history(),revision=editor.revision();
  s.client.observe(editor,scope,true);
  s.client.destroy();s.block();s.client.destroy(); // The host drops its editor synchronously after teardown.
  await tick();
  assert.equal(s.store.rows.size,1);
  assert.deepEqual(JSON.parse([...s.store.rows.values()][0].source),expected);
  assert.deepEqual(editor.history(),history);assert.equal(editor.revision(),revision);assert(s.store.closed);
  assert.equal(writes,1);assert.equal(closes,1);
});
test('dispose queues the final committed source after a stalled older write',async()=>{
  const s=session(),put=s.store.put;let release,started;
  const ready=new Promise(resolve=>started=resolve);
  s.store.put=async value=>{if(!release){started();await new Promise(resolve=>release=resolve);}await put(value);};
  const editor=createPixelEditor(newPixelDocument(2,2));s.client.observe(editor,scope,true);
  const writing=s.client.flush();await ready;
  editor.begin();editor.line(1,0,1,0,[51,61,71,255]);editor.commit();
  const expected=editor.document();s.client.observe(editor,scope,true);
  s.client.destroy();s.block();release();await writing;await tick();
  assert.equal(s.store.rows.size,1);
  assert.deepEqual(JSON.parse([...s.store.rows.values()][0].source),expected);assert(s.store.closed);
});
test('dispose keeps completed recovery when a stroke or floating preview blocks capture',async()=>{
  for(const blocked of ['stroke','floating']) {
    const s=session(),editor=createPixelEditor(newPixelDocument(2,2));
    s.client.observe(editor,scope,true);await s.client.flush();
    const before=structuredClone([...s.store.rows.values()]);
    if(blocked==='stroke'){editor.begin();editor.line(0,0,1,1,[255,0,0,255]);}
    else{s.block();}
    s.client.destroy();s.client.destroy();await tick();
    assert.deepEqual([...s.store.rows.values()],before);assert(s.store.closed);
    editor.cancel();
  }
});
test('unavailable IndexedDB fails explicitly without requiring a browser global',async()=>{
  const store=createPixelRecoveryStore(()=>{throw new DOMException('blocked','SecurityError');});
  await assert.rejects(store.list(scope),/blocked/);store.close();
});
