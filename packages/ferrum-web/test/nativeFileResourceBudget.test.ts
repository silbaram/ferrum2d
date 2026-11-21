import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { ResourceBudget, resourceKeys } from "../src/nativeFileResourceBudget.js";
test("resource ledger accumulates all byte categories and returns actual remainder", () => {
  const b = new ResourceBudget({maxResources:2,maxWork:9,maxMetadataBytes:4,maxSourceBytes:3,maxDecodedBytes:8,maxGpuBytes:16});
  b.charge("resources",2);b.metadata("ab");b.bytes(new Uint8Array(3),"sourceBytes");b.floats(new Float32Array([1,-0]));b.charge("gpuBytes",16);
  deepEqual(b.remaining(),{maxResources:0,maxWork:0,maxMetadataBytes:0,maxSourceBytes:0,maxDecodedBytes:0,maxGpuBytes:0});
  for(const key of ["resources","work","metadataBytes","sourceBytes","decodedBytes","gpuBytes"] as const) throws(()=>b.charge(key,1),/LIMIT/);
});
test("resource copy uses intrinsic bounds and ignores shadow getters/methods/species", () => {
  const bytes = new Uint8Array([1,2,3,4]);let calls=0;
  for(const key of ["length","byteLength","buffer","slice","constructor"])Object.defineProperty(bytes,key,{get:()=>{calls++;throw Error("getter ran");}});
  const b=new ResourceBudget();deepEqual([...b.bytes(bytes,"sourceBytes",4)],[1,2,3,4]);equal(calls,0);
  throws(()=>new ResourceBudget({maxSourceBytes:3}).bytes(bytes,"sourceBytes"),/LIMIT/);equal(calls,0);
  throws(()=>b.bytes(bytes,"sourceBytes",3),/DATA/);equal(calls,0);
});
test("resource float copy is finite, bit-preserving and bounded before scanning",()=>{
  const values=new Float32Array([-0,.125,-2]);const b=new ResourceBudget();const copy=b.floats(values,3);
  deepEqual([...new Uint32Array(copy.buffer)],[...new Uint32Array(values.buffer)]);
  throws(()=>b.floats(new Float32Array([NaN])),/DATA/);throws(()=>b.floats(values,2),/DATA/);
  throws(()=>new ResourceBudget({maxDecodedBytes:11}).floats(values),/LIMIT/);
});
test("resource record rejects getter and unknown field without calling code",()=>{
  let calls=0;const x={};Object.defineProperty(x,"a",{enumerable:true,get:()=>{calls++;return 1;}});
  throws(()=>resourceKeys(x,["a"],new ResourceBudget()),/DATA/);equal(calls,0);
  const hidden={};Object.defineProperty(hidden,"a",{get:()=>{calls++;return 1;}});
  throws(()=>resourceKeys(hidden,["a"],new ResourceBudget()),/DATA/);equal(calls,0);
  throws(()=>resourceKeys({b:1},["a"],new ResourceBudget()),/DATA/);
});
test("resource record rejects hidden unknown and Symbol fields without evaluating getters",()=>{
  let calls=0;
  for(const key of ["unknown", Symbol("unknown")]) {
    const record={a:1};
    Object.defineProperty(record,key,{get:()=>{calls++;throw Error("getter ran");}});
    throws(()=>resourceKeys(record,["a"],new ResourceBudget()),/DATA/);
  }
  equal(calls,0);
  const record=Object.assign(Object.create(null) as {a:number},{a:1});
  resourceKeys(record,["a"],new ResourceBudget());
});
test("resource copies reject shared, detached and proxy views without returning a buffer",()=>{
  const b=new ResourceBudget();
  throws(()=>b.bytes(new Uint8Array(new SharedArrayBuffer(4)),"sourceBytes"),/DATA/);
  throws(()=>b.floats(new Float32Array(new SharedArrayBuffer(4))),/DATA/);
  const detached=new Uint8Array([1,2]);
  structuredClone(detached.buffer,{transfer:[detached.buffer]});
  throws(()=>b.bytes(detached,"sourceBytes"),/ALLOCATION|DATA/);
  const proxy=new Proxy(new Uint8Array([1]),{get:()=>{throw Error("proxy getter ran");}});
  throws(()=>b.bytes(proxy,"sourceBytes"),/DATA/);
});
test("resource limits reject hidden accessors without reading them and reject larger defaults",()=>{
  let calls=0;
  const input={};Object.defineProperty(input,"maxWork",{get:()=>{calls++;return 0;}});
  throws(()=>new ResourceBudget(input),/LIMITS/);equal(calls,0);
  throws(()=>new ResourceBudget({maxResources:4097}),/LIMITS/);
});
