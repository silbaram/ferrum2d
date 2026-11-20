import type { FerrumEngine } from "./engineTypes.js";
import type { NativeGameFileBudget, NativeGameFileErrorCode, NativeGameFilePhase, NativeGameFilePlatformContext, NativeGameFileReady, NativeGameFileSession, NativeGameFileSessionOptions } from "./nativeGameFileTypes.js";
import { NativeGameFileError } from "./nativeGameFileTypes.js";
import { nativeGameFileLimitWords, freezeNativeGameFileResourceLimits } from "./nativeGameFileLimits.js";

type InternalBudget = import("./nativeFileResourceBudget.js").ResourceBudget;
function normalize(error: unknown, phase: NativeGameFilePhase): NativeGameFileError {
  if(error instanceof NativeGameFileError && error.phase===phase)return error;
  const descriptor=error!==null&&typeof error==="object"?Object.getOwnPropertyDescriptor(error,"code"):undefined;
  const code:unknown=error instanceof NativeGameFileError?error.code:descriptor&&"value"in descriptor?descriptor.value:undefined;
  const messageDescriptor=error!==null&&typeof error==="object"?Object.getOwnPropertyDescriptor(error,"message"):undefined;
  const message=messageDescriptor&&"value"in messageDescriptor&&typeof messageDescriptor.value==="string"?messageDescriptor.value:"";
  const known:readonly string[]=["LIMITS","LIMIT","DATA","STALE","BUSY","CAPABILITY","ALLOCATION","GPU","IO","NATIVE"];
  let mapped:NativeGameFileErrorCode=typeof code==="string"&&known.includes(code)?code as NativeGameFileErrorCode:code==="OWNER"?"CAPABILITY":code==="TOKEN"?"STALE":"DATA";
  const nameDescriptor=error!==null&&typeof error==="object"?Object.getOwnPropertyDescriptor(error,"name"):undefined;
  if(nameDescriptor&&"value"in nameDescriptor&&nameDescriptor.value==="NativeFileHostBindingError")mapped=code==="STALE"||code==="TOKEN"?"STALE":code==="LIMIT"?"LIMIT":"CAPABILITY";
  if(message.startsWith("Stop the engine"))mapped="BUSY";
  else if(message.includes("FerrumEngine has been destroyed"))mapped="STALE";
  else if(message.includes("actual Ferrum2D SDK facade"))mapped="CAPABILITY";
  if(error instanceof RangeError)mapped="ALLOCATION";
  if(typeof WebAssembly!=="undefined"&&error instanceof WebAssembly.RuntimeError)mapped="NATIVE";
  if(typeof error==="string"){
    const native=/^native-file\.prepare:(\d+)$/.exec(error);
    if(native){const n=Number(native[1]);mapped=n===1?"LIMITS":[2,4,5,6,16].includes(n)?"LIMIT":n===7?"ALLOCATION":[9,10,11].includes(n)?"STALE":n===12?"BUSY":"DATA";}
  }
  return new NativeGameFileError(mapped,phase,error);
}
function budgetView(b:InternalBudget):NativeGameFileBudget {
  return Object.freeze({work:(n:number)=>b.work(n),metadata:(v:string)=>b.metadata(v),charge:(kind:Parameters<InternalBudget["charge"]>[0],n:number)=>b.charge(kind,n),
    bytes:(v:Uint8Array,k:"sourceBytes"|"decodedBytes",n?:number)=>b.bytes(v,k,n),floats:(v:Float32Array,n?:number)=>b.floats(v,n),
    usage:()=>b.usage(),remaining:()=>b.remaining(),fail:(code:Parameters<InternalBudget["fail"]>[0],field:string)=>b.fail(code,field)});
}
function dataField(value:unknown,key:string):unknown {
  if(!value||typeof value!=="object")return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor)return undefined;
  if(!("value"in descriptor))throw new NativeGameFileError("CAPABILITY","create","runtime callback accessors are not evaluated");
  return descriptor.value;
}
function arrayByteLength(value:Uint8Array):number {
  const p=Object.getPrototypeOf(Uint8Array.prototype),tag=Object.getOwnPropertyDescriptor(p,Symbol.toStringTag)!.get!,length=Object.getOwnPropertyDescriptor(p,"byteLength")!.get!,backing=Object.getOwnPropertyDescriptor(p,"buffer")!.get!,offset=Object.getOwnPropertyDescriptor(p,"byteOffset")!.get!;
  if(tag.call(value)!=="Uint8Array")throw new NativeGameFileError("DATA","prepare","ordinary Uint8Array required");
  const bytes=length.call(value) as number,buffer=backing.call(value) as ArrayBuffer;
  Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,"byteLength")!.get!.call(buffer);
  new Uint8Array(buffer,offset.call(value),bytes);return bytes;
}
async function deployedWasm(value:Uint8Array|URL|undefined,b:InternalBudget):Promise<Uint8Array>{
  if(value!==undefined&&!(value instanceof URL))return b.bytes(value,"sourceBytes");
  const url=value??new URL("../pkg/ferrum_core_bg.wasm",import.meta.url),href=Object.getOwnPropertyDescriptor(URL.prototype,"href")!.get!.call(url) as string;
  b.metadata(href);let response:Response;
  try{response=await fetch(href);}catch(error){throw new NativeGameFileError("IO","create",error);}
  if(!response.ok)throw new NativeGameFileError("IO","create",Object.freeze({url:href,status:response.status}));
  const expected=response.headers.get("content-length");
  if(expected!==null&&(!/^\d+$/.test(expected)||Number(expected)>b.remaining().maxSourceBytes))b.fail("LIMIT","deployed Wasm content length");
  if(!response.body)throw new NativeGameFileError("IO","create","deployed Wasm stream unavailable");
  const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;const bytes=b.bytes(part.value,"sourceBytes");b.charge("decodedBytes",24);chunks.push(bytes);size+=bytes.length;}
    b.work(size);b.charge("decodedBytes",size);const result=new Uint8Array(size);let at=0;for(const bytes of chunks){result.set(bytes,at);at+=bytes.length;}return result;
  }catch(error){try{await reader.cancel();}catch{/* preserve original */}throw error;}finally{reader.releaseLock();}
}

/** Capture/admit complete SDK game files without exposing native installation or
 * changing the default import graph. The initial engine must be stopped. */
export async function createNativeGameFileSession(initialEngine:FerrumEngine,options:NativeGameFileSessionOptions={}):Promise<NativeGameFileSession>{
 try {
  const platformFactory=options.preparePlatform,initialCleanup=options.initialCleanup,initialRegistry=options.registry,maximumMemoryPages=options.maximumMemoryPages,wasmInput=options.wasm;
  const native=nativeGameFileLimitWords(options.nativeLimits),resourceLimits=freezeNativeGameFileResourceLimits(options.resourceLimits);
  if(maximumMemoryPages!==undefined&&(!Number.isInteger(maximumMemoryPages)||maximumMemoryPages<0||maximumMemoryPages>65536))throw new NativeGameFileError("LIMITS","create","maximumMemoryPages must be in 0..65536");
  const [coordinator,ledger,owners,host,quest,resolvers,bindings,fonts]=await Promise.all([
    import("./nativeFileRuntimeSession.js"),import("./nativeFileResourceBudget.js"),import("./nativeFileEngineOwner.js"),import("./nativeFileRuntimeHost.js"),
    import("./nativeFileDialogueQuest.js"),import("./nativeFileAuthoringResolvers.js"),import("./nativeFileHostBindings.js"),import("./nativeFileResourceFontBindings.js"),
  ]);
  const actual=owners.nativeFileEngineOwner(initialEngine),creationBudget=new ledger.ResourceBudget(resourceLimits),wasm=await deployedWasm(wasmInput,creationBudget),initialBindingOwner={};
  // Register only identities actually retained by the SDK owner. Descriptor
  // reads never execute a caller getter, callback or opaque authoring wrapper.
  creationBudget.work(45);creationBudget.charge("decodedBytes",15*128);
  for(const role of Object.keys(host.NATIVE_FILE_RUNTIME_HOST_TYPES) as (keyof typeof host.NATIVE_FILE_RUNTIME_HOST_TYPES)[]){
    const [root,parent,key]=role.split(".");
    const value=root==="frame"?dataField(actual.frame,parent):dataField(dataField(actual.options,parent),key);
    if(value!==undefined){creationBudget.metadata(role);creationBudget.metadata(`sdk.${role}`);host.registerNativeFileRuntimeHostBinding(initialBindingOwner,role,`sdk.${role}`,value as object);}
  }
  const runtime=coordinator.createNativeFileRuntimeSession(initialEngine,wasm,{bindingOwner:initialBindingOwner,registry:initialRegistry,limits:resourceLimits,creationBudget,
    native:{limits:native.words,maximumMemoryPages},initialCleanup,
    preparePlatform:platformFactory?async(saved,_target,b)=>{
      const context:NativeGameFilePlatformContext=Object.freeze({requiredRoles:Object.freeze(saved.resolvedReferences.map(r=>r.role)),metadata:saved.metadata,
        creationData:saved.optionsData as NativeGameFilePlatformContext["creationData"],frameData:saved.frameData as NativeGameFilePlatformContext["frameData"],budget:budgetView(b)});
      const platform=await platformFactory(context);
      // Every required callback is explicit. Stateless identity reuse is valid;
      // identity differences cannot prove what a closure captures.
      return {assetHost:platform.assetHost,callbacks:platform.callbacks as import("./nativeFileRuntimeSession.js").NativeFileRuntimePlatform["callbacks"],
        configure:platform.configure?e=>platform.configure!(e,budgetView(b)):undefined,
        validate:platform.validate?e=>{
          const outcome:unknown=platform.validate!(e,budgetView(b));
          if(outcome!==null&&(typeof outcome==="object"||typeof outcome==="function")&&"then"in outcome){
            // Refuse async validation before publication. Consume native Promise
            // rejection without invoking an arbitrary thenable's method.
            try{Promise.prototype.then.call(outcome,()=>undefined,()=>undefined);}catch{/* non-Promise thenable */}
            throw new NativeGameFileError("CAPABILITY","commit","platform.validate must be synchronous");
          }
        }:undefined,
        assertCurrent:platform.assertCurrent?()=>platform.assertCurrent!():undefined,dispose:()=>platform.dispose()};
    }:undefined,
  });
  let disposed=false,operating=false;
  const tokens=new WeakMap<NativeGameFileReady,{raw:Awaited<ReturnType<typeof runtime.prepare>>;budget:InternalBudget}>();
  const requireOpen=()=>{if(disposed)throw new NativeGameFileError("STALE","binding","session disposed");};
  const owner=()=>{requireOpen();return coordinator.nativeFileRuntimeSessionBindingOwner(runtime);};
  const sync=<T>(phase:NativeGameFilePhase,operation:()=>T):T=>{try{requireOpen();return operation();}catch(error){throw normalize(error,phase);}};
  const asyncOperation=async<T>(phase:NativeGameFilePhase,operation:()=>Promise<T>):Promise<T>=>{
    try{requireOpen();if(operating)throw new NativeGameFileError("BUSY",phase,"session operation");operating=true;}catch(error){throw normalize(error,phase);}
    try{return await operation();}catch(error){throw normalize(error,phase);}finally{operating=false;}
  };
  const result:NativeGameFileSession={
    current:()=>sync("binding",()=>runtime.current()),epoch:()=>sync("binding",()=>runtime.epoch()),registry:()=>sync("binding",()=>runtime.registry()),dialogueQuest:()=>sync("binding",()=>runtime.dialogueQuest()),
    capture:()=>asyncOperation("capture",()=>runtime.capture(new ledger.ResourceBudget(resourceLimits))),
    prepare:file=>asyncOperation("prepare",async()=>{
      const b=new ledger.ResourceBudget(resourceLimits);let bytes:Uint8Array;
      if(typeof Blob!=="undefined"&&file instanceof Blob){
        const size=Object.getOwnPropertyDescriptor(Blob.prototype,"size")!.get!.call(file) as number;
        if(size>native.values.maxFileBytes)b.fail("LIMIT","file Blob size");
        b.work(size);b.charge("sourceBytes",size);b.charge("decodedBytes",size);
        const buffer=await Blob.prototype.arrayBuffer.call(file);if(buffer.byteLength!==size)b.fail("DATA","file Blob size changed");bytes=new Uint8Array(buffer);
      }else{bytes=file as Uint8Array;if(arrayByteLength(bytes)>native.values.maxFileBytes)b.fail("LIMIT","file byte size");}
      const raw=await runtime.prepare(bytes,b),token=Object.freeze({}) as NativeGameFileReady;tokens.set(token,{raw,budget:b});return token;
    }),
    commit:token=>asyncOperation("commit",async()=>{const plan=tokens.get(token);if(!plan)throw new NativeGameFileError("STALE","commit","foreign or consumed ready");tokens.delete(token);return runtime.commit(plan.raw);}),
    discard:token=>asyncOperation("discard",async()=>{const plan=tokens.get(token);if(!plan)throw new NativeGameFileError("STALE","discard","foreign or consumed ready");tokens.delete(token);await runtime.discard(plan.raw);}),
    dispose:async()=>{if(disposed)return;await asyncOperation("dispose",async()=>{await runtime.dispose();disposed=true;});},
    registerQuest:(symbol,value)=>sync("binding",()=>{if(questKind(value)!=="quest")throw new NativeGameFileError("CAPABILITY","binding","actual QuestLog required");quest.registerNativeFileDialogueQuest(owner(),symbol,value);}),
    registerDialogue:(symbol,value)=>sync("binding",()=>{if(questKind(value)!=="dialogue")throw new NativeGameFileError("CAPABILITY","binding","actual DialogueSession required");quest.registerNativeFileDialogueQuest(owner(),symbol,value);}),
    bindTextureResolver:(symbol,identity,adapter=identity)=>sync("binding",()=>bindings.registerNativeFileHostBinding(owner(),resolvers.nativeFileTextureResolverType,symbol,adapter,identity)),
    bindEntityExists:(symbol,identity,adapter=identity)=>sync("binding",()=>bindings.registerNativeFileHostBinding(owner(),resolvers.nativeFileEntityExistsType,symbol,adapter,identity)),
    bindFontFace:(symbol,adapter,engine)=>sync("binding",()=>{const target=engine??runtime.current();owners.nativeFileEngineOwner(target);fonts.registerResourceFontFaceBinding(target,symbol,adapter);}),
    bindFontSet:(symbol,adapter,engine)=>sync("binding",()=>{const target=engine??runtime.current();owners.nativeFileEngineOwner(target);fonts.registerResourceFontSetBinding(target,symbol,adapter as import("./nativeFileResourceFontBindings.js").ResourceFontSetHostAdapter);}),
  };
  const dialogue=await import("./dialogueQuest.js");
  const questKind=(value:object)=>dialogue.nativeFileDialogueQuestOwner(value)?.kind;
  return Object.freeze(result);
 }catch(error){throw normalize(error,"create");}
}
