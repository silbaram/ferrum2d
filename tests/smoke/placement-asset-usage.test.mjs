import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
const ts=createRequire(new URL("../../apps/studio/package.json",import.meta.url))("typescript");
const sdkRoot=new URL("../../apps/studio/node_modules/@ferrum2d/ferrum-web/",import.meta.url);
const sdk=JSON.parse(await readFile(new URL("package.json",sdkRoot),"utf8"));
const catalogCode=ts.transpileModule(await readFile(new URL("../../apps/studio/src/placementSceneCatalog.ts",import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const catalogUrl="data:text/javascript;base64,"+Buffer.from(catalogCode).toString("base64");
const {PlacementSceneReadLimitError,fetchSceneRead,isPlacementSceneReadLimit,hostedSceneCatalog}=await import(catalogUrl);
const code=ts.transpileModule(await readFile(new URL("../../apps/studio/src/placementAssetUsage.ts",import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll(JSON.stringify("@ferrum2d/ferrum-web/authoring"),JSON.stringify(new URL(sdk.exports["./authoring"].import,sdkRoot).href)).replaceAll(JSON.stringify("./placementSceneCatalog"),JSON.stringify(catalogUrl));
const {collectPlacementAssetUsage:collect,capturePlacementUsageDocuments:capture,awaitPlacementAssetRead:awaitRead}=await import("data:text/javascript;base64,"+Buffer.from(code).toString("base64"));
const doc=(prefabs={},extra={})=>({format:"ferrum2d.consumer.scene-authoring",version:1,sceneComposition:{prefabs},...extra});
const visual=id=>({props:{components:{visual:{kind:"sprite",asset:id,width:16,height:16},collider:"none",layer:"wall"}}});
const camera={projection:"orthographic",position:{x:160,y:-240,elevation:220},target:{x:0,y:0,elevation:0},height:240};
const modelSpec=asset=>({asset,contentId:"a".repeat(64)});
const entry=(path,document)=>({id:path,source:path,relativePath:path,mode:"2d",read:async()=>document,inspect:async(maxBytes=2*1024*1024)=>{const bytes=new TextEncoder().encode(JSON.stringify(document)).length;if(bytes>maxBytes)throw new PlacementSceneReadLimitError();return{document,bytes};}});
const run=(scenes,extra={})=>collect({catalog:{label:"project",scenes,truncated:false},assets:[],open:[],current:()=>true,...extra});
test("OFF cookie references protect named assets and expose unresolved numeric IDs with exact pointers", async () => {
 const lighting = { profile: "lit", enabled: false, pointLights: [{ x: 0, y: 0, radius: 1, cookie: { texture: "pattern" } }, { x: 1, y: 1, radius: 1, cookie: { textureId: 7 } }] };
 const result = await run([entry("cookies.json", doc({}, { lighting }))]);
 const asset = result.assets.find(asset => asset.id === "pattern"); assert(asset); assert.equal(asset.kind, "sprite");
 assert.equal(asset.references[0].pointer, "/lighting/pointLights/0/cookie/texture");
 assert(result.issues.some(issue => issue.code === "unresolved" && issue.pointer === "/lighting/pointLights/1/cookie/textureId"));
});
test("surface maps in inactive prefabs and variants remain explicit asset references",async()=>{
 const surface={emissionTexture:"emission",specularTexture:"specular",roughnessTexture:"roughness"};
 const definition=visual("base");definition.props.components.visual.lighting={mode:"opaque"};definition.props.components.visual.surface=surface;
 const result=await run([entry("surface.json",doc({hero:definition}))]);
 for(const [map,id]of Object.entries(surface)){
  const asset=result.assets.find(asset=>asset.id===id);assert(asset);assert.equal(asset.kind,"sprite");
  assert.equal(asset.references[0].pointer,`/sceneComposition/prefabs/hero/props/components/visual/surface/${map}`);
 }
});
test("closed scenes include definitions, variants, includes, explicit instances and HD models/LODs with exact pointers",async()=>{
 const a=doc({"tree/~":{...visual("shared"),variants:{night:visual("normal")}}},{sceneComposition:{prefabs:{"tree/~":{...visual("shared"),variants:{night:visual("normal")}}},fragments:{room:{include:[{fragment:"other",...visual("include")}],instances:[{id:"hero",prefab:"tree/~",...visual("shared")}]},other:{}}},spatial:{camera,terrain:[],billboards:{},models:{tree:{...modelSpec("shared"),lods:[{...modelSpec("low"),minDistance:100}]}}}});
 const before=JSON.stringify(a),result=await run([entry("closed.json",a),entry("other.json",doc({wall:visual("shared")}))]);
 const sprite=result.assets.find(a=>a.id==="shared"&&a.kind==="sprite"),model=result.assets.find(a=>a.id==="shared"&&a.kind==="model");
 assert.equal(sprite.references.length,3);assert.equal(model.references.length,1);assert.equal(sprite.registered,false);
 assert(sprite.references.some(r=>r.pointer==="/sceneComposition/prefabs/tree~1~0/props/components/visual/asset"));
 assert(sprite.references.some(r=>r.owner==="hero"));assert(result.assets.some(a=>a.id==="low"&&a.kind==="model"));
 assert(result.assets.some(a=>a.id==="normal"));assert(result.assets.some(a=>a.id==="include"));assert.equal(JSON.stringify(a),before);assert.equal(result.scanned,2);
});
test("saved and draft evidence remain separate without erasing disk references or mutating inputs",async()=>{
 const saved=doc({hero:visual("old")}),draft=doc({hero:visual("new")}),before=JSON.stringify([saved,draft]);
 const result=await run([entry("room.json",saved)],{open:[{scene:"room.json",source:"saved",document:saved},{scene:"room.json",source:"draft",document:draft}]});
 assert.deepEqual(result.assets.find(a=>a.id==="old").references.map(r=>r.source),["disk","saved"]);
 assert.deepEqual(result.assets.find(a=>a.id==="new").references.map(r=>r.source),["draft"]);assert.equal(JSON.stringify([saved,draft]),before);
});
test("numeric texture IDs, normals and external component templates are unresolved rather than guessed",async()=>{
 const value=doc({one:{props:{components:{sprite:{texture:3,normalTexture:"normal",width:16,height:16},collider:"none",layer:"wall"}}},two:{props:{components:{template:"external"}}}},{spatial:{camera,billboards:{hero:{normalTexture:"hd-normal"},other:{normalTextureId:4}},terrain:[{id:"ground",x:0,y:0,width:10,depth:10,elevation:0,textureId:5}]}});
 const result=await run([entry("room.json",value)]);assert.equal(result.issues.filter(i=>i.code==="unresolved").length,4);
 assert(result.assets.some(a=>a.id==="normal"));assert(result.assets.some(a=>a.id==="hd-normal"));assert(!result.assets.some(a=>a.id==="3"));
});
test("unrelated strings do not count as asset use and zero matches are scoped evidence only",async()=>{
 const result=await run([entry("room.json",doc({}, {note:"tree",gameplay:{script:"tree"}}))],{assets:[{kind:"sprite",id:"tree"},{kind:"model",id:"tree"}]});
 assert.equal(result.assets.length,2);assert(result.assets.every(a=>a.registered&&a.references.length===0));assert.equal(result.limited,false);
});
test("invalid and unreadable scenes retain other evidence and report discovery gaps",async()=>{
 const result=await run([{...entry("bad.json",null),mode:"invalid"},{...entry("read.json",null),inspect:async()=>{throw Error("denied");}},entry("wrong.json",{}),entry("good.json",doc({tree:visual("tree")}))],{catalog:{label:"x",scenes:[{...entry("bad.json",null),mode:"invalid"},{...entry("read.json",null),inspect:async()=>{throw Error("denied");}},entry("wrong.json",{}),entry("good.json",doc({tree:visual("tree")}))],truncated:true,diagnostics:[{relativePath:"closed",code:"EACCES"}]}});
 assert.equal(result.limited,true);assert.equal(result.issues.length,5);assert(result.assets.some(a=>a.id==="tree"));assert.equal(result.total,4);
});
test("native inspect is preferred over a document-opening read and stale results stop further reads",async()=>{
 let current=true,opened=0,inspected=0,next=0;
 const scene={...entry("room.json",null),read:async()=>{opened++;throw Error("must not open");},inspect:async()=>{inspected++;current=false;return{document:doc(),bytes:128};}};
 await assert.rejects(run([scene,{...entry("next.json",doc()),inspect:async()=>{next++;return{document:doc(),bytes:128};}}],{current:()=>current}),/context changed/);
 assert.equal(opened,0);assert.equal(inspected,1);assert.equal(next,0);
});
test("cycles and oversized authored paths terminate with explicit scan limits",async()=>{
 const value=doc({["x".repeat(4100)]:visual("tree")});value.loop=value;
 const result=await run([],{open:[{scene:"open",source:"draft",document:value}]});assert.equal(result.limited,true);assert(result.issues.some(i=>i.code==="limit"));
});
test("reference, scene and open snapshot budgets are bounded and visible",async()=>{
 const prefabs=Object.fromEntries(Array.from({length:8300},(_,i)=>["p"+i,visual("tree")]));
 const result=await run([entry("big.json",doc(prefabs))]);assert.equal(result.limited,true);assert(result.assets[0].references.length<=8192);
 let reads=0;const scenes=Array.from({length:257},(_,i)=>({...entry(i+".json",null),inspect:async()=>{reads++;return{document:doc(),bytes:128};}}));
 const limited=await run(scenes,{open:Array.from({length:65},()=>({scene:"open",source:"saved",document:doc()}))});assert.equal(reads,256);assert.equal(limited.limited,true);
});
test("aggregate reread bytes cannot exceed the project scan budget silently",async()=>{
 const value=doc({}, {text:"x".repeat(2*1024*1024-256)});
 const result=await run(Array.from({length:18},(_,i)=>entry(i+".json",value)));assert.equal(result.limited,true);assert(result.scanned<=16);assert(result.issues.some(i=>i.code==="limit"));
});
test("malformed reference containers cannot report an issue-free scan",async()=>{
 const result=await run([entry("malformed.json",doc(null,{sceneComposition:{prefabs:[]}}))]);
 assert(result.issues.some(issue=>issue.code==="document"));
});
test("catalog truncation has visible issue evidence even without IO diagnostics",async()=>{
 const result=await run([],{catalog:{label:"project",scenes:[],truncated:true}});
 assert.equal(result.limited,true);assert(result.issues.some(issue=>issue.code==="limit"));
});

test("open snapshot capture stops before cloning or consuming all tabs",async()=>{
 let consumed=0;const value=doc({hero:visual("tree")});
 function* inputs(){for(let i=0;i<10000;i++){consumed++;yield{scene:i+".json",source:"saved",document:value};}}
 const snapshot=capture(inputs());assert.equal(consumed,65);assert.equal(snapshot.open.length,64);assert.equal(snapshot.omittedScene,"64.json");
 value.sceneComposition.prefabs.hero.props.components.visual.asset="changed";
 assert.equal(snapshot.open[0].document.sceneComposition.prefabs.hero.props.components.visual.asset,"tree");
 const result=await run([],{...snapshot});assert.equal(result.limited,true);assert(result.issues.some(issue=>issue.code==="limit"&&issue.scene==="64.json"));
});
test("reference schema errors preserve raw evidence and never instantiate an include graph",async()=>{
 const value=doc({hero:visual("tree")},{sceneComposition:{prefabs:{hero:visual("tree")},fragments:{main:{include:[{fragment:"main"}]}}}});
 // Raw reference inspection has no include expansion, even for a cyclic include graph.
 const result=await run([entry("cyclic-includes.json",value)]);assert(result.assets.some(asset=>asset.id==="tree"));
 const malformed=doc({hero:{props:{components:{visual:{kind:"sprite",asset:"bad",width:-1,height:16},collider:"none",layer:"wall"}}}});
 const bad=await run([entry("bad-components.json",malformed)]);assert(bad.issues.some(issue=>issue.code==="document"&&issue.pointer.endsWith("/components")));assert(bad.assets.some(asset=>asset.id==="bad"));
});

test("raw whitespace bytes and remaining budget are enforced before JSON cost can be undercounted",async()=>{
 const original=globalThis.fetch;const source=" ".repeat(2*1024*1024-512)+JSON.stringify(doc());let reads=0;
 try{globalThis.fetch=async()=>{reads++;return new Response(source);};
  const scenes=Array.from({length:18},(_,i)=>({...entry(i+".json",doc()),inspect:limit=>fetchSceneRead(new URL("https://example.test/"+i),limit)}));
  const result=await run(scenes);assert.equal(result.scanned,16);assert.equal(reads,17);assert.equal(result.limited,true);assert(result.issues.some(issue=>issue.code==="limit"));
 }finally{globalThis.fetch=original;}
});
test("inspection cannot fall back to an authority-granting document open",async()=>{
 let opens=0;const scene=entry("legacy.json",doc());delete scene.inspect;scene.read=async()=>{opens++;return doc();};
 const result=await run([scene]);assert.equal(opens,0);assert(result.issues.some(issue=>issue.code==="read"));
});
test("failed stream cancellation cannot hide quota errors or retain the reader lock",async()=>{
 const original=globalThis.fetch;let released=false;
 try{
  globalThis.fetch=async()=>({ok:true,headers:new Headers(),body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(128)}),cancel:async()=>{throw Error("cleanup failed");},releaseLock:()=>{released=true;}})}});
  await assert.rejects(fetchSceneRead(new URL("https://example.test/"),32),isPlacementSceneReadLimit);assert.equal(released,true);
  globalThis.fetch=async()=>({ok:true,headers:new Headers({"content-length":"128"}),body:{cancel:async()=>{throw Error("cleanup failed");}}});
  await assert.rejects(fetchSceneRead(new URL("https://example.test/"),32),isPlacementSceneReadLimit);
 }finally{globalThis.fetch=original;}
});
test("aborting inspection releases a stalled caller without waiting for the host",{timeout:1000},async()=>{
 const controller=new AbortController();let received;
 const scene={...entry("slow.json",doc()),inspect:(_limit,signal)=>{received=signal;return new Promise(()=>{});}};
 const pending=run([scene],{signal:controller.signal});await Promise.resolve();controller.abort(new Error("inspection cancelled"));
 await assert.rejects(pending,/inspection cancelled/);assert.equal(received,controller.signal);
});

test("catalog requests receive abort and release their caller when fetch never settles",{timeout:1000},async()=>{
 const controller=new AbortController(),original=globalThis.fetch;let received;
 try{globalThis.fetch=(_url,options)=>{received=options.signal;return new Promise(()=>{});};
  const pending=awaitRead(hostedSceneCatalog(new URL("https://example.test/"),controller.signal),controller.signal);controller.abort(new Error("catalog cancelled"));
  await assert.rejects(pending,/catalog cancelled/);assert.equal(received,controller.signal);
 }finally{globalThis.fetch=original;}
});
test("compressed transfer length does not reject a decoded JSON body within its raw-byte budget",async()=>{
 const original=globalThis.fetch,source=JSON.stringify(doc()),bytes=new TextEncoder().encode(source).length;
 try{globalThis.fetch=async()=>new Response(source,{headers:{"content-encoding":"gzip","content-length":String(bytes+32)}});
  const snapshot=await fetchSceneRead(new URL("https://example.test/"),bytes);assert.equal(snapshot.bytes,bytes);assert.deepEqual(snapshot.document,doc());
 }finally{globalThis.fetch=original;}
});
test("gameplay props.id cannot replace the authored instance or definition owner",async()=>{
 const definition=visual("prefab-texture");definition.props.id="gameplay-definition-id";
 const instance={id:"scene-hero",prefab:"hero",...visual("instance-texture")};instance.props.id="gameplay-instance-id";
 const value=doc({}, {sceneComposition:{prefabs:{hero:definition},fragments:{main:{instances:[instance]}}},spatial:{camera,terrain:[],billboards:{"scene-hero":{normalTexture:"hero-normal"}}}});
 const result=await run([entry("scene.json",value)]);
 for(const [id,owner]of [["prefab-texture","hero"],["instance-texture","scene-hero"],["hero-normal","scene-hero"]])assert.equal(result.assets.find(asset=>asset.id===id).references[0].owner,owner);
});
test("empty dictionary keys preserve their raw reference pointers",async()=>{
 const definition={...visual("empty-prefab"),variants:{"":visual("empty-variant")}};
 const result=await run([entry("scene.json",doc({"":definition}))]);
 assert.equal(result.assets.find(asset=>asset.id==="empty-prefab").references[0].pointer,"/sceneComposition/prefabs//props/components/visual/asset");
 assert.equal(result.assets.find(asset=>asset.id==="empty-variant").references[0].pointer,"/sceneComposition/prefabs//variants//props/components/visual/asset");
});
test("oversized asset and owner IDs are explicit limits, never silently truncated identities",async()=>{
 const long="x".repeat(1100),value=doc({}, {sceneComposition:{
  prefabs:{hero:visual("short"),[long]:visual("long-definition-owner"),unused:visual(long)},
  fragments:{main:{instances:[{id:long,prefab:"hero",...visual("long-instance-owner")}]}}
 }});
 const result=await run([entry("scene.json",value)]);assert.equal(result.limited,true);assert(result.issues.some(issue=>issue.code==="limit"));
 for(const id of ["long-definition-owner","long-instance-owner"])assert.equal(result.assets.find(asset=>asset.id===id).references[0].owner,undefined);
 assert(!result.assets.some(asset=>asset.id===long));
});
