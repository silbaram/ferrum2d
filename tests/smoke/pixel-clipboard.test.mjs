import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../../apps/placement-viewer/package.json',import.meta.url))('typescript');
const code=ts.transpileModule(await readFile(new URL('../../apps/placement-viewer/src/placementPixelClipboard.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {copyPixelPng:copy,pixelClipboardUnavailable:unavailable}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
function environment(run,{secure=true,item=true,support=true,write}={}) {
  const saved=new Map(['isSecureContext','ClipboardItem','navigator'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const platform={isSecureContext:secure,ClipboardItem:item?class{static supports(){return support;}constructor(data){this.data=data;}}:undefined,navigator:{clipboard:{write}}};
  for(const [key,value]of Object.entries(platform))Object.defineProperty(globalThis,key,{configurable:true,value});
  return Promise.resolve().then(run).finally(()=>{for(const [key,descriptor]of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
}
const tick=()=>new Promise(setImmediate),signal=()=>new AbortController().signal;
test('clipboard write starts synchronously and receives exact PNG blob bytes',async()=>{
  const events=[],bytes=Uint8Array.from([137,80,78,71]).buffer;
  await environment(async()=>{
    assert.equal(unavailable(),undefined);
    const operation=copy(async()=>{events.push('encode');return bytes;},signal());
    assert.deepEqual(events,['write']);await operation;assert.deepEqual(events,['write','encode','blob']);
  },{write:async items=>{events.push('write');assert.equal(items.length,1);const blob=await items[0].data['image/png'];assert.equal(blob.type,'image/png');assert.deepEqual(await blob.arrayBuffer(),bytes);events.push('blob');}});
});
test('unsupported APIs do not encode or attempt clipboard access',async()=>{
  for(const options of [{secure:false},{item:false},{support:false},{write:undefined}]) {
    let encoded=0,writes=0;
    await environment(async()=>{assert.match(unavailable(),/unavailable/);await assert.rejects(copy(async()=>{encoded++;return new ArrayBuffer(1);},signal()),/Export PNG/);}, {write:async()=>{writes++;},...options});
    assert.equal(encoded,0);assert.equal(writes,0);
  }
});
test('permission denial gives an actionable error even when the PNG promise also rejects',async()=>{
  await environment(async()=>{await assert.rejects(copy(async()=>{throw Error('encode failed');},signal()),/Allow clipboard/);await tick();},
    {write:async()=>{throw new DOMException('Denied','NotAllowedError');}});
});
test('synchronous platform errors and encoding rejection are handled without detached rejections',async()=>{
  for(const write of [()=>{throw Error('Platform failed');},async items=>{await items[0].data['image/png'];}])
    await environment(async()=>{await assert.rejects(copy(async()=>{throw Error('PNG failed');},signal()),/copy failed/);await tick();},{write});
});
test('an already aborted action never starts encoding or clipboard write',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  await environment(async()=>{await assert.rejects(copy(async()=>{calls++;return new ArrayBuffer(1);},controller.signal),{name:'AbortError'});assert.equal(calls,0);},{write:async()=>{calls++;}});
});
test('abort during encoding releases the action and never delivers stale PNG data',async()=>{
  const controller=new AbortController();let release,written=0;
  await environment(async()=>{
    const operation=copy(()=>new Promise(resolve=>{release=resolve;}),controller.signal);await tick();
    controller.abort();await assert.rejects(operation,{name:'AbortError'});release(new ArrayBuffer(4));await tick();assert.equal(written,0);
  },{write:async items=>{await items[0].data['image/png'];written++;}});
});
test('abort releases a pending OS write; a late rejection is consumed',async()=>{
  const controller=new AbortController();let rejectWrite;
  await environment(async()=>{
    const operation=copy(async()=>new ArrayBuffer(4),controller.signal);await tick();controller.abort();
    await assert.rejects(operation,{name:'AbortError'});rejectWrite(Error('Late failure'));await tick();
  },{write:async items=>{await items[0].data['image/png'];await new Promise((_,reject)=>{rejectWrite=reject;});}});
});
