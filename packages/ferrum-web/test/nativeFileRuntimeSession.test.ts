import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createEngine } from "../src/createEngine.js";
import { initializeFerrumWasm } from "../src/initializeFerrumWasm.js";
import { nativeFileEngineOwner } from "../src/nativeFileEngineOwner.js";
import { createNativeFileRuntimeSession } from "../src/nativeFileRuntimeSession.js";
import { ResourceBudget } from "../src/nativeFileResourceBudget.js";
import { NativeFileUnpublishedTarget } from "../src/nativeFileRuntimeNative.js";
import { encodeNativeFileMetadataGraph, decodeNativeFileMetadataGraph, encodeNativeFileResourceGraph, decodeNativeFileResourceGraph } from "../src/nativeFileResourceCodec.js";
import { registerNativeFileRuntimeHostBinding } from "../src/nativeFileRuntimeHost.js";
const wasm = () => readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url));
async function source() { await initializeFerrumWasm(await wasm()); const e = await createEngine(); e.useDataScene(); e.configureUnifiedPhysics({ space: "planar-xy", gravity: [0,0,0], lengthUnit: 1, stepSeconds: .01 });
  e.spawnUnifiedPhysicsBody({ linearVelocity: [.5,.25,0], canSleep: false, collider: { shape: { type: "sphere", radius: .25 } } }); return e; }

test("actual headless whole file capture/prepare/commit preserves source, epoch and normal six-tick replay", async () => {
  const binary = await wasm(), initial = await source(), session = createNativeFileRuntimeSession(initial, binary);
  try {
    const before = initial.time(), revision = initial.runtimeCheckpointRevision(), captureBudget = new ResourceBudget();
    const file = await session.capture(captureBudget); ok(file.length > 288); equal(initial.time(), before); equal(initial.runtimeCheckpointRevision(), revision);
    const bytes = file.slice(), prepareBudget = new ResourceBudget(), ready = await session.prepare(file, prepareBudget);
    equal(session.current(), initial); equal(session.epoch(), 0); deepEqual(file, bytes);
    const committed = await session.commit(ready); equal(committed.epoch, 1); ok(session.current() !== initial); equal(initial.time(), before);
    equal(session.current().time(), before); equal(session.current().runtimeCheckpointRevision(), revision);
    const target = nativeFileEngineOwner(session.current()).native, original = nativeFileEngineOwner(initial).native;
    for (let i=0;i<6;i++) { original.update(.01); target.update(.01); }
    equal(target.time(), original.time()); deepEqual(structuredClone(session.current().queryUnifiedPhysicsObservations()), structuredClone(initial.queryUnifiedPhysicsObservations()));
    await rejects(session.commit(ready), /STALE/); equal(session.epoch(), 1);
    const next = await session.capture(); ok(next.length > 288);
    const checkpoint = session.current().captureRuntimeCheckpoint(); target.update(.03); const expected = structuredClone(session.current().queryUnifiedPhysicsObservations());
    session.current().restoreRuntimeCheckpoint(checkpoint); target.update(.03); deepEqual(structuredClone(session.current().queryUnifiedPhysicsObservations()), expected); checkpoint.dispose();
    ok(captureBudget.usage().work > 0 && prepareBudget.usage().work > captureBudget.usage().work);
  } finally { await session.dispose(); initial.destroy(); }
});

test("damaged native frame, every SDK section and exhausted shared quota reject while old source remains current", async () => {
  const binary = await wasm(), initial = await source(), session = createNativeFileRuntimeSession(initial, binary);
  try {
    const file = await session.capture(), native = nativeFileEngineOwner(initial).native, time = initial.time(), epoch = session.epoch();
    const crcBad = file.slice(); crcBad[crcBad.length - 1] ^= 1; await rejects(session.prepare(crcBad), /.*/); equal(session.current(), initial);
    const raw = await NativeFileUnpublishedTarget.prepare(binary, file, new ResourceBudget());
    try {
      const good = raw.sdkSections();
      for (const kind of ["variables","authoring","resourceManifest","resourceData","dialogueQuest","hostBindings"] as const) {
        const bad = raw.repackSdkSections({ ...good, [kind]: new TextEncoder().encode("{}") });
        await rejects(session.prepare(bad), /.*/); equal(session.current(), initial); equal(session.epoch(), epoch); equal(initial.time(), time);
      }
    } finally { raw.dispose(); }
    await rejects(session.prepare(file, new ResourceBudget({ maxWork: 0 })), /LIMIT/); equal(session.current(), initial);
    native.update(.01); ok(initial.time() > time);
  } finally { await session.dispose(); initial.destroy(); }
});

test("stale source after Ready and explicit discard affect only new target; borrowed initial cleanup runs only after success", async () => {
  const binary = await wasm(), initial = await source(); let cleaned = 0, platforms = 0;
  const session = createNativeFileRuntimeSession(initial, binary, { initialCleanup() { cleaned++; throw Error("post publication cleanup fault"); }, preparePlatform() { return { dispose() { platforms++; } }; } });
  try {
    const file = await session.capture(), ready = await session.prepare(file); nativeFileEngineOwner(initial).native.update(.01);
    await rejects(session.commit(ready), /STALE/); equal(session.current(), initial); equal(session.epoch(), 0); equal(cleaned, 0); equal(platforms, 1);
    const discarded = await session.prepare(file); await session.discard(discarded); equal(cleaned, 0); equal(platforms, 2);
    const next = await session.prepare(file), result = await session.commit(next); equal(cleaned, 1); equal(result.cleanupErrors.length, 1); equal(session.epoch(), 1); equal(initial.time(), .01);
  } finally { await session.dispose(); initial.destroy(); }
});

test("actual registered callback requires trusted NEW target adapter and never transplants the old renderer function", async () => {
  const binary = await wasm(); await initializeFerrumWasm(binary); let oldCalls = 0, newCalls = 0, disposed = 0;
  const old = () => { oldCalls++; }, engine = await createEngine(old); registerNativeFileRuntimeHostBinding(engine, "frame.onFrame", "frame", old);
  const rejected = createNativeFileRuntimeSession(engine, binary);
  try { const file = await rejected.capture(); await rejects(rejected.prepare(file), /CAPABILITY/); equal(oldCalls, 0); } finally { await rejected.dispose(); }
  const replacement = () => { newCalls++; }, session = createNativeFileRuntimeSession(engine, binary, { preparePlatform(view) {
    equal(view.resolvedReferences[0].value, old); return { callbacks: { "frame.onFrame": replacement }, dispose() { disposed++; } };
  } });
  try { const file = await session.capture(), ready = await session.prepare(file); equal(oldCalls,0); equal(newCalls,0); await session.commit(ready); equal(oldCalls,0); equal(newCalls,0);
    ok(nativeFileEngineOwner(session.current()).frame.onFrame === replacement); const next = await session.capture(); ok(next.length > 288);
  } finally { await session.dispose(); engine.destroy(); equal(disposed,1); }
});

test("fixed metadata profiles preserve Resource default usage and -0/undefined/alias while admitting authoring over4MiB", () => {
  const original = { zero: -0, absent: undefined, equal: { k: 1 } }, a = new ResourceBudget(), c = new ResourceBudget();
  const resource = encodeNativeFileResourceGraph(original, a), variable = encodeNativeFileMetadataGraph(original, c, "variables");
  deepEqual(resource, variable); deepEqual(a.usage(), c.usage());
  const da = new ResourceBudget(), dc = new ResourceBudget(); deepEqual(decodeNativeFileResourceGraph(resource.manifestBytes,resource.dataBytes,da),decodeNativeFileMetadataGraph(variable.manifestBytes,variable.dataBytes,dc,"variables")); deepEqual(da.usage(),dc.usage());
  const text = "x".repeat(2200000), large = [text,text]; throws(() => encodeNativeFileResourceGraph(large,new ResourceBudget()),/LIMIT/);
  const authored = encodeNativeFileMetadataGraph(large,new ResourceBudget(),"authoring"); ok(authored.manifestBytes.length > 4*1024*1024); equal((decodeNativeFileMetadataGraph(authored.manifestBytes,authored.dataBytes,new ResourceBudget(),"authoring") as string[])[0],text);
  throws(() => encodeNativeFileMetadataGraph(new Uint8Array(1),new ResourceBudget(),"authoring"),/LIMIT/);
});

test("actual external shared Dialogue/Quest graph restores into target namespace and original registered owners remain borrowed", async () => {
  const { QuestLog, DialogueSession } = await import("../src/dialogueQuest.js"), { registerNativeFileDialogueQuest } = await import("../src/nativeFileDialogueQuest.js");
  const binary=await wasm(), initial=await source(), q=new QuestLog({quests:{quest:{title:"test",stages:{start:{title:"start",objectives:{talk:"talk"}}}}}}), graph={initialNode:"a",nodes:{a:{text:"hello",questUpdates:[{quest:"quest",action:"start" as const,stage:"start"}],choices:[{id:"again",label:"again",to:"a",questUpdates:[{quest:"quest",action:"completeObjective" as const,objective:"talk"}]}]}}};
  const a=new DialogueSession(graph,q),c=new DialogueSession(graph,q);registerNativeFileDialogueQuest(initial,"quest",q);registerNativeFileDialogueQuest(initial,"a",a);registerNativeFileDialogueQuest(initial,"alias",a);registerNativeFileDialogueQuest(initial,"c",c);
  const session=createNativeFileRuntimeSession(initial,binary);
  try {
    const before=q.snapshot(),file=await session.capture(),ready=await session.prepare(file);deepEqual(q.snapshot(),before);await session.commit(ready);
    const restored=session.dialogueQuest()!;equal(restored.quests.length,1);equal(restored.dialogues.length,2);equal(restored.bindings[1].value,restored.bindings[2].value);ok(restored.quests[0]!==q);deepEqual(restored.quests[0].snapshot(),before);
    for(let i=0;i<6;i++){a.choose("again");c.choose("again");restored.dialogues[0].choose("again");restored.dialogues[1].choose("again");deepEqual(restored.quests[0].snapshot(),q.snapshot());}
    ok((await session.capture()).length>file.length-512);await session.dispose();ok(q.snapshot());ok(a.currentNode());
  } finally {await session.dispose();a.destroy();c.destroy();q.destroy();initial.destroy();}
});

test("unpublished lifecycle callbacks remain silent on discard; foreign token rejects and owned cleanup happens after publication only", async()=>{
 const binary=await wasm();await initializeFerrumWasm(binary);let oldDestroyed=0,newDestroyed=0;
 const oldDestroy=()=>{oldDestroyed++;},nextDestroy=()=>{newDestroyed++;},initial=await createEngine(undefined,undefined,undefined,undefined,{lifecycle:{onDestroy:oldDestroy}});
 registerNativeFileRuntimeHostBinding(initial,"options.lifecycle.onDestroy","destroy",oldDestroy);
 const session=createNativeFileRuntimeSession(initial,binary,{preparePlatform(){return{callbacks:{"options.lifecycle.onDestroy":nextDestroy},dispose(){}};}}),other=createNativeFileRuntimeSession(initial,binary);
 try {const file=await session.capture(),discarded=await session.prepare(file);await rejects(other.commit(discarded),/STALE/);await session.discard(discarded);equal(oldDestroyed,0);equal(newDestroyed,0);
 const ready=await session.prepare(file);await session.commit(ready);equal(oldDestroyed,0);equal(newDestroyed,0);await session.dispose();equal(newDestroyed,1);equal(oldDestroyed,0);
 }finally{await session.dispose();await other.dispose();initial.destroy();equal(oldDestroyed,1);}
});

test("opaque authoring predicate is explicitly registered in the new scope and the published session captures again without evaluation",async()=>{
 const {SceneInstanceHandleRegistry}=await import("../src/sceneInstanceHandles.js"),{nativeFileEntityExistsType}=await import("../src/nativeFileAuthoringResolvers.js"),{registerNativeFileHostBinding}=await import("../src/nativeFileHostBindings.js");
 const binary=await wasm(),initial=await source();let calls=0;const predicate=()=>{calls++;return false;},registry=new SceneInstanceHandleRegistry({entityExists:predicate});
 registerNativeFileHostBinding(initial,nativeFileEntityExistsType,"opaque-predicate",predicate);const session=createNativeFileRuntimeSession(initial,binary,{registry});
 try{const file=await session.capture(),ready=await session.prepare(file);await session.commit(ready);equal(calls,0);ok(session.registry());const next=await session.capture();ok(next.length>288);equal(calls,0);}finally{await session.dispose();initial.destroy();}
});
