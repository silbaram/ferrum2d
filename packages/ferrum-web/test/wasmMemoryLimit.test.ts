import {deepEqual,equal,throws} from "node:assert/strict";
import {test} from "node:test";
import {limitWasmMemory} from "../src/wasmMemoryLimit.js";
const header=[0,97,115,109,1,0,0,0];
const memory=(flags=0,minimum=1,maximum?:number)=>new Uint8Array([...header,5,maximum===undefined?3:4,1,flags,minimum,...(maximum===undefined?[]:[maximum])]);

test("memory maximum changes only the defined memory section and enforces exact growth boundary",()=>{
  const original=new Uint8Array([...memory(),0,3,1,120,9]);
  const output=limitWasmMemory(original,2);
  deepEqual(output,new Uint8Array([...memory(1,1,2),0,3,1,120,9]));
  const native=new WebAssembly.Instance(new WebAssembly.Module(output));
  equal(WebAssembly.Module.imports(new WebAssembly.Module(output)).length,0);
  // A tiny module with an exported memory makes the actual limit observable.
  const exported=new Uint8Array([...output,7,5,1,1,109,2,0]);
  const instance=new WebAssembly.Instance(new WebAssembly.Module(exported));
  const mem=instance.exports.m as WebAssembly.Memory;
  equal(mem.grow(1),1);equal(mem.buffer.byteLength,2*65536);
  throws(()=>mem.grow(1),/maximum|grow|Memory/);
  equal(Object.keys(native.exports).length,0);
  deepEqual(original,new Uint8Array([...memory(),0,3,1,120,9]));
});
test("memory limiter never raises an existing maximum and rejects unsupported or malformed forms",()=>{
  deepEqual(limitWasmMemory(memory(1,1,3),2),memory(1,1,2));
  for(const cap of [0,4,-1,1.5,NaN,Infinity,65537])throws(()=>limitWasmMemory(memory(1,1,3),cap),/maximum|limits/);
  for(const bytes of [new Uint8Array(),new Uint8Array(header),memory(2),memory(4),new Uint8Array([...memory(),...memory().subarray(8)]),new Uint8Array([...header,5,3,2,0,1]),new Uint8Array([...header,5,9,1]),new Uint8Array([...header,5,128,128,128,128,32])])throws(()=>limitWasmMemory(bytes,2),/Wasm|memory/);
});
