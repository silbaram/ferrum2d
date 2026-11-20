import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as ts from "typescript";
import { createNativeGameFileSession, NativeGameFileError } from "../src/core.js";
import type { NativeGameFileReady, NativeGameFilePlatformContext, NativeGameFileRenderFrame } from "../src/nativeGameFileTypes.js";
import type { RenderCommandBufferView, PhysicsDebugLineBufferView } from "../src/wasmBridge.js";
import { createEngine } from "../src/createEngine.js";
import { initializeFerrumWasm } from "../src/initializeFerrumWasm.js";
import { nativeFileEngineOwner } from "../src/nativeFileEngineOwner.js";
import { SceneInstanceHandleRegistry } from "../src/sceneInstanceHandles.js";
import { QuestLog, DialogueSession } from "../src/dialogueQuest.js";
import { nativeGameFileLimitWords } from "../src/nativeGameFileLimits.js";
const wasm=()=>readFile(new URL("../pkg/ferrum_core_bg.wasm",import.meta.url));
async function source(){await initializeFerrumWasm(await wasm());const engine=await createEngine();engine.useDataScene();engine.configureUnifiedPhysics({space:"planar-xy",gravity:[0,0,0],lengthUnit:1,stepSeconds:.01});engine.spawnUnifiedPhysicsBody({linearVelocity:[.25,.5,0],canSleep:false,collider:{shape:{type:"sphere",radius:.25}}});return engine;}
async function rejected(promise:Promise<unknown>,code:string,phase:string){let failure:unknown;try{await promise;}catch(e){failure=e;}if(!(failure instanceof NativeGameFileError))throw Error("expected NativeGameFileError");equal(failure.code,code);equal(failure.phase,phase);ok(failure.cause!==undefined);return failure;}
const renderType=(value:NativeGameFileRenderFrame):[RenderCommandBufferView,PhysicsDebugLineBufferView|undefined]=>[value.renderCommandBuffer,value.physicsDebugLineBuffer];void renderType;

test("public game-file session roundtrips Blob, complete native/SDK state and six accepted ticks without changing the borrowed source",async()=>{
 const binary=await wasm(),initial=await source(),session=await createNativeGameFileSession(initial,{wasm:binary});
 try{const before=initial.time(),file=await session.capture(),copy=file.slice(),ready=await session.prepare(new Blob([file as Uint8Array<ArrayBuffer>]));equal(session.current(),initial);equal(session.epoch(),0);deepEqual(file,copy);
 const result=await session.commit(ready);equal(result.epoch,1);ok(session.current()!==initial);equal(initial.time(),before);equal(session.current().time(),before);
 const a=nativeFileEngineOwner(initial).native,b=nativeFileEngineOwner(session.current()).native;for(let i=0;i<6;i++){a.update(.01);b.update(.01);}deepEqual(structuredClone(initial.queryUnifiedPhysicsObservations()),structuredClone(session.current().queryUnifiedPhysicsObservations()));
 const next=await session.capture();ok(next.length>288);await rejected(session.commit(ready),"STALE","commit");
 }finally{await session.dispose();initial.destroy();}
});

test("public opaque Ready tokens reject forgery/cross-session/reuse and failure preserves current source",async()=>{
 const binary=await wasm(),initial=await source(),session=await createNativeGameFileSession(initial,{wasm:binary}),other=await createNativeGameFileSession(initial,{wasm:binary});
 try{await rejected(session.commit({}as NativeGameFileReady),"STALE","commit");const file=await session.capture(),ready=await session.prepare(file);await rejected(other.commit(ready),"STALE","commit");await session.discard(ready);await rejected(session.discard(ready),"STALE","discard");
 const damaged=file.slice();damaged[damaged.length-1]^=1;await rejected(session.prepare(damaged),"DATA","prepare");equal(session.current(),initial);equal(session.epoch(),0);nativeFileEngineOwner(initial).native.update(.01);equal(initial.time(),.01);
 }finally{await session.dispose();await session.dispose();await other.dispose();initial.destroy();}
});

test("public factory automatically registers actual runtime callback identities and exposes only data to target factory",async()=>{
 const binary=await wasm();await initializeFerrumWasm(binary);let callbacks=0;const stateless=()=>{callbacks++;},initial=await createEngine(stateless),contexts:NativeGameFilePlatformContext[]=[];
 const session=await createNativeGameFileSession(initial,{wasm:binary,preparePlatform(context){contexts.push(context);return{callbacks:{"frame.onFrame":stateless},dispose(){}};}});
 try{const file=await session.capture(),ready=await session.prepare(file);equal(callbacks,0);const ctx=contexts[0];deepEqual(ctx.requiredRoles,["frame.onFrame"]);deepEqual(Object.keys(ctx),["requiredRoles","metadata","creationData","frameData","budget"]);equal(ctx.frameData.onFrame,null);equal(Object.isFrozen(ctx),true);equal(Object.isFrozen(ctx.budget),true);
 await session.commit(ready);equal(callbacks,0);ok((await session.capture()).length>288);
 }finally{await session.dispose();initial.destroy();}
});

test("post-adopt synchronous app validation rejects before publication and preserves original cause",async()=>{
 const binary=await wasm(),initial=await source(),failure=Error("saved game JSON is not supported"),session=await createNativeGameFileSession(initial,{wasm:binary,preparePlatform(){return{validate(engine,budget){ok(engine!==initial);ok(budget.usage().work>0);throw failure;},dispose(){}};}});
 try{const file=await session.capture(),ready=await session.prepare(file),error=await rejected(session.commit(ready),"DATA","commit");equal(error.cause,failure);equal(session.current(),initial);equal(session.epoch(),0);nativeFileEngineOwner(initial).native.update(.01);equal(initial.time(),.01);
 }finally{await session.dispose();initial.destroy();}
});

test("Blob size and shared materialization quota reject before arrayBuffer and creation sums BOTH Wasm copies",async()=>{
 const binary=await wasm(),initial=await source(),limited=await createNativeGameFileSession(initial,{wasm:binary,nativeLimits:{maxFileBytes:32}}),bounded=await createNativeGameFileSession(initial,{wasm:binary,resourceLimits:{maxSourceBytes:17*1024*1024}});
 const real=Blob.prototype.arrayBuffer;let reads=0;Blob.prototype.arrayBuffer=function(){reads++;return real.call(this);};
 try{await rejected(limited.prepare(new Blob([new Uint8Array(33)])),"LIMIT","prepare");equal(reads,0);await rejected(bounded.prepare(new Blob([new Uint8Array(18*1024*1024)])),"LIMIT","prepare");equal(reads,0);
 ok(binary.length<10*1024*1024&&binary.length*2>10*1024*1024);await rejected(createNativeGameFileSession(initial,{wasm:binary,resourceLimits:{maxSourceBytes:10*1024*1024}}),"LIMIT","create");equal(initial.time(),0);
 }finally{Blob.prototype.arrayBuffer=real;await limited.dispose();await bounded.dispose();initial.destroy();}
});

test("named native/resource limits are lower-only and map the entire fixed27word schema without exposing it publicly",async()=>{
 const words=nativeGameFileLimitWords({maxFileBytes:1234,maxDecodeDepth:12,maxAliasRoots:333}).words;equal(words.length,27);equal(words[0],1);equal(words[1],1234);equal(words[13],12);equal(words[23],333);
 throws(()=>nativeGameFileLimitWords({maxFileBytes:65*1024*1024}),/LIMITS/);throws(()=>nativeGameFileLimitWords({schemaVersion:2}as never),/LIMITS/);
 const binary=await wasm(),initial=await source();try{await rejected(createNativeGameFileSession(initial,{wasm:binary,resourceLimits:{maxSourceBytes:257*1024*1024}}),"LIMITS","create");await rejected(createNativeGameFileSession(initial,{wasm:binary,maximumMemoryPages:-1}),"LIMITS","create");}finally{initial.destroy();}
});

test("public Quest/Dialogue and explicit opaque predicate bindings follow the private current owner through repeated loads",async()=>{
 const binary=await wasm(),initial=await source();let calls=0;const predicate=()=>{calls++;return false;},registry=new SceneInstanceHandleRegistry({entityExists:predicate}),q=new QuestLog({quests:{q:{title:"q"}}}),dialogue=new DialogueSession({initialNode:"start",nodes:{start:{text:"hello",choices:[{id:"again",label:"again",to:"start"}]}}},q);
 const session=await createNativeGameFileSession(initial,{wasm:binary,registry});session.bindEntityExists("exists",predicate);session.registerQuest("q",q);session.registerDialogue("dialogue",dialogue);
 try{const file=await session.capture(),ready=await session.prepare(file);await session.commit(ready);equal(calls,0);equal(session.dialogueQuest()!.quests.length,1);ok(session.dialogueQuest()!.quests[0]!==q);ok((await session.capture()).length>288);equal(calls,0);
 await session.dispose();ok(q.snapshot());ok(dialogue.currentNode());
 }finally{await session.dispose();dialogue.destroy();q.destroy();initial.destroy();}
});

test("default/core and public entry static graphs contain no private coordinator or Wasm factory import",async()=>{
 const parser=(ts as typeof ts&{default?:typeof ts}).default??ts,seen=new Set<string>();
 async function walk(url:URL):Promise<void>{if(seen.has(url.href))return;seen.add(url.href);const text=new TextDecoder().decode(await readFile(url)),file=parser.createSourceFile(url.href,text,parser.ScriptTarget.Latest,true);
  for(const node of file.statements)if(parser.isImportDeclaration(node)||parser.isExportDeclaration(node)){const spec=node.moduleSpecifier;if(spec&&parser.isStringLiteral(spec)&&spec.text.startsWith(".")&&spec.text.endsWith(".js"))await walk(new URL(spec.text,url));}
 }
 await walk(new URL("../src/nativeGameFile.js",import.meta.url));await walk(new URL("../src/core.js",import.meta.url));
 for(const value of seen){ok(!value.endsWith("/nativeFileRuntimeSession.js"));ok(!value.endsWith("/wasmNamespace.js"));ok(!value.endsWith("/ferrum_core_factory.js"));}
});
