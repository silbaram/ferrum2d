import {deepEqual,equal,ok,rejects,throws} from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import {createFerrumWasmBindings, type FinalizerRegistryLike,type WasmBindingsFactory} from "../pkg/ferrum_core_factory.js";
import {limitWasmMemory} from "../src/wasmMemoryLimit.js";
import {WasmNamespace,initializeBridgeInWasmNamespace} from "../src/wasmNamespace.js";
import {WasmBridge} from "../src/wasmBridge.js";
import {initializeFerrumWasm} from "../src/initializeFerrumWasm.js";
import * as original from "../pkg/ferrum_core.js";
const bytes=()=>readFile(new URL("../pkg/ferrum_core_bg.wasm",import.meta.url));
function dispatcher() {
  const rows:{callback:(pointer:number)=>void; pointers:number[]}[]=[];
  return {rows,create(callback:(pointer:number)=>void):FinalizerRegistryLike {
    const row={callback,pointers:[] as number[]};rows.push(row);
    return {register(_target,pointer){row.pointers.push(pointer);},unregister(){return true;}};
  }};
}
const questPacket=new Uint8Array([1,0,0,0,0,0,0,0]);
const dialoguePacket=Uint8Array.from([1,0,0,0,0,0,0,0,1,0,0,0,5,0,0,0,101,110,116,114,121,1,0,0,0,0,0,0,0,0,0,0,0]);

test("isolated Bridge ABI initializes without the default singleton and keeps the public init signature",async()=>{
  throws(()=>original.wasm_memory());
  const data=await bytes(),a=new WasmNamespace(data,64),b=new WasmNamespace(data,64);
  const pa=a.initialize();equal(a.initialize(),pa);
  const [left,right]=await Promise.all([initializeBridgeInWasmNamespace(a,WasmBridge.init),initializeBridgeInWasmNamespace(b,WasmBridge.init)]);
  ok(a.memory()!==b.memory());equal(left.version(),right.version());equal(left.engine().time(),0);
  await initializeFerrumWasm(data);const source=await WasmBridge.init();
  ok(a.memory()!==original.wasm_memory());equal(left.version(),source.version());
  left.engine().free();right.engine().free();source.engine().free();a.dispose();b.dispose();
});

test("target constructor trap poisons only its namespace and preserves source bytes and six-tick checkpoints",async()=>{
  const data=await bytes();await initializeFerrumWasm(data);const source=new original.Engine();source.use_data_scene();
  ok(source.configure_gameplay_variable(1,0,0,3,7));const checkpoint=source.capture_runtime_checkpoint();ok(checkpoint);
  const memory=original.wasm_memory(),buffer=memory.buffer,copy=new Uint8Array(buffer).slice(),view=new Uint8Array(buffer,0,16);
  const target=new WasmNamespace(data,19);await target.initialize();
  equal(target.memory().buffer.byteLength,19*65536);
  throws(()=>target.call(bindings=>new bindings.Engine()),/unreachable/);
  equal(target.state().state,"poisoned");equal(target.state().retainsWasm,false);target.dispose();
  equal(memory.buffer,buffer);equal(view.length,16);deepEqual(new Uint8Array(memory.buffer),copy);
  const trace=()=>Array.from({length:6},(_,i)=>{source.increment_gameplay_variable_value(1,i+1);source.update(.01);return [source.time(),source.gameplay_variable_value(1)];});
  const first=trace();ok(source.restore_runtime_checkpoint(checkpoint!));deepEqual(trace(),first);
  const fresh=source.capture_runtime_checkpoint();ok(fresh&&source.restore_runtime_checkpoint(fresh));fresh?.free();checkpoint?.free();source.free();
  throws(()=>target.call(b=>new b.Engine()),/disposed/);await rejects(target.initialize(),/disposed/);
});

test("factory initializes once, joins identical async requests and rejects a different module without corrupting the first",async()=>{
  const data=await bytes(),module=new WebAssembly.Module(new Uint8Array(data).buffer),other=new WebAssembly.Module(new Uint8Array(data).buffer),f=createFerrumWasmBindings();
  const first=f.bindings.default({module_or_path:module});equal(f.bindings.default({module_or_path:module}),first);
  throws(()=>f.bindings.initSync({module}),/pending/);await rejects(f.bindings.default({module_or_path:other}),/different input/);
  const out=await first;equal(f.bindings.initSync({module}),out);equal(f.state().state,"ready");
  const engine=f.invoke(b=>new b.Engine());engine.free();f.dispose();
  throws(()=>f.bindings.initSync({module}),/disposed/);await rejects(f.bindings.default({module_or_path:module}),/disposed/);
});

test("dispose prevents a pending async initialization from reviving native references",async()=>{
  const data=await bytes(),f=createFerrumWasmBindings();
  // A delayed Response exercises __wbg_load after initialization has actually begun.
  let release:((bytes:ArrayBuffer)=>void)|undefined;
  const response=new Response(new Uint8Array(data),{headers:{"content-type":"application/octet-stream"}});
  response.arrayBuffer=()=>new Promise<ArrayBuffer>(resolve=>{release=resolve;});
  const pending=f.bindings.default({module_or_path:response});
  for(let i=0;i<20&&!release;i++)await new Promise(resolve=>setTimeout(resolve,0));ok(release);
  f.dispose();release!(new Uint8Array(data).buffer);await rejects(pending,/cancelled/);
  deepEqual(f.state(),{state:"disposed",finalizersRun:0,finalizersSuppressed:0,finalizerFailures:0,retainsInstance:false,retainsModule:false,retainsWasm:false,retainedViewCaches:0});
});

test("late dispatcher executes all six actual finalizer callbacks after target trap/dispose without native reentry",async()=>{
  const data=await bytes(),queue=dispatcher(),f=createFerrumWasmBindings({finalizationRegistryFactory:queue.create});
  // Fit the Native Engine and owned file candidate before testing the real
  // 8 MiB allocation trap with all six owners already registered.
  const out=f.bindings.initSync({module:new WebAssembly.Module(limitWasmMemory(data,128))});
  const engine=f.invoke(b=>new b.Engine()),checkpoint=engine.capture_runtime_checkpoint();ok(checkpoint);
  const quest=f.invoke(b=>new b.NativeQuestLog(questPacket));
  const dialogue=f.invoke(b=>b.NativeDialogueSession.with_quests(dialoguePacket,quest));
  const mask=f.invoke(b=>new b.NativePixelMaskTerrain(1,1,1,false,new Uint8Array([0])));
  ok(dialogue.snapshot().length>0);equal(mask.alpha_data().length,1);
  const sdkBulk=new TextEncoder().encode("{}{}{}{}{}{}");
  const lengths=new Uint32Array([2,2,2,2,2,2]),nativeLimits=new Uint32Array();
  const file=f.invoke(()=>engine.capture_native_file(sdkBulk,lengths,0x55667788,0x11223344,nativeLimits));
  const prepared=f.invoke(b=>new b.NativeFilePrepare(engine,file,0x55667788,0x11223344,nativeLimits));
  equal(prepared.is_consumed(),false);
  equal(queue.rows.length,6);ok(queue.rows.every(row=>row.pointers.length===1));
  throws(()=>f.invoke(()=>out.__wbindgen_malloc(8*1024*1024,8)),/unreachable/);
  equal(f.state().state,"poisoned");
  f.dispose();for(const row of queue.rows)row.callback(row.pointers[0]);
  equal(f.state().finalizersSuppressed,6);equal(f.state().finalizerFailures,0);equal(f.state().finalizersRun,0);
  equal(out.memory instanceof WebAssembly.Memory,true);
});

test("dispatcher healthy control runs one actual native destructor before disposing",async()=>{
  const queue=dispatcher(),f=createFerrumWasmBindings({finalizationRegistryFactory:queue.create});
  f.bindings.initSync({module:new WebAssembly.Module(new Uint8Array(await bytes()).buffer)});
  f.invoke(b=>new b.Engine());const engineRow=queue.rows[0];equal(engineRow.pointers.length,1);
  engineRow.callback(engineRow.pointers[0]);equal(f.state().finalizersRun,1);equal(f.state().finalizerFailures,0);f.dispose();
});

// This owner-local projection stages the settlement listener without adding a
// production callback or exposing the backend through a package public API.
test("dispose between backend ready and namespace settlement cannot retain memory or resolve success",async()=>{
  const namespace=new WasmNamespace(await bytes(),64);
  const owner=namespace as unknown as {factory:WasmBindingsFactory;module:WebAssembly.Module;nativeMemory:WebAssembly.Memory|undefined};
  const nativeInitialization=owner.factory.bindings.default({module_or_path:owner.module});
  nativeInitialization.then(()=>{
    equal(namespace.state().state,"initializing");
    throws(()=>namespace.memory(),/not settled/);
    let entered=false;throws(()=>namespace.call(()=>{entered=true;}),/not settled/);equal(entered,false);
    namespace.dispose();
  });
  await rejects(namespace.initialize(),/cancelled/);
  equal(owner.nativeMemory,undefined);equal(namespace.state().retainsWasm,false);equal(namespace.state().state,"disposed");
});
