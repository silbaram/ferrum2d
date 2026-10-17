import { loadSpatialGlb, createEngine, captureGameStateSnapshot, restoreGameStateSnapshot } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry } from "@ferrum2d/ferrum-web/authoring";

// Repack only fixture material JSON. Every variant still goes through the public GLB loader.
export function materialVariant(bytes, edit) {
  const v = new DataView(bytes), size = v.getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, size)));
  edit(doc.materials[1], doc);
  const text = new TextEncoder().encode(JSON.stringify(doc)), padded = (text.length + 3) & ~3;
  const bin = new Uint8Array(bytes, 28 + size), out = new ArrayBuffer(28 + padded + bin.length), header = new DataView(out);
  [0x46546c67,2,out.byteLength,padded,0x4e4f534a].forEach((n,i)=>header.setUint32(i*4,n,true));
  new Uint8Array(out,20,padded).fill(32); new Uint8Array(out,20,text.length).set(text);
  header.setUint32(20+padded,bin.length,true);header.setUint32(24+padded,0x004e4942,true);new Uint8Array(out,28+padded).set(bin);
  return out;
}
export async function auditedLoad(bytes, options, afterDecode, afterCleanup) {
  const evidence={contexts:0,bitmaps:0,closed:0,released:0,peakContexts:0}, tracked=[];
  const originalBitmap=globalThis.createImageBitmap;
  const prototypes=[globalThis.OffscreenCanvas?.prototype,HTMLCanvasElement.prototype].filter(Boolean);
  const originals=prototypes.map(p=>p.getContext);
  globalThis.createImageBitmap=async(...args)=>{
    const bitmap=await originalBitmap(...args),close=bitmap.close;evidence.bitmaps++;
    bitmap.close=()=>{evidence.closed++;close.call(bitmap);};afterDecode?.();return bitmap;
  };
  prototypes.forEach((p,i)=>{p.getContext=function(...args){
    const context=originals[i].apply(this,args);
    if(args[0]==="webgl2" && context){
      const owned=new Set(),canLose=!!context.getExtension("WEBGL_lose_context");
      for(const kind of ["Texture","Framebuffer"]){
        const create=context[`create${kind}`].bind(context),remove=context[`delete${kind}`].bind(context);
        context[`create${kind}`]=()=>{const value=create();if(value)owned.add(value);return value;};
        context[`delete${kind}`]=value=>{owned.delete(value);remove(value);};
      }
      tracked.push({context,owned,canLose});
      evidence.peakContexts=Math.max(evidence.peakContexts,tracked.filter(t=>!t.context.isContextLost()).length);
    }
    return context;
  };});
  try{return {asset:await (Array.isArray(bytes)?Promise.all(bytes.map(b=>loadSpatialGlb(b,options))):loadSpatialGlb(bytes,options)),evidence};}
  finally{
    globalThis.createImageBitmap=originalBitmap;prototypes.forEach((p,i)=>p.getContext=originals[i]);
    evidence.contexts=tracked.length;evidence.released=tracked.filter(t=>t.owned.size===0&&(!t.canLose||t.context.isContextLost())).length;
    if(evidence.closed!==evidence.bitmaps||evidence.released!==evidence.contexts)throw Error(`Model decode resources leaked: ${JSON.stringify(evidence)}`);
    afterCleanup?.(evidence);
  }
}
export async function probeSpatialTree(scene, canvas) {
  const { engine, renderer, view } = scene, gl = canvas.getContext("webgl2");
  const check = (ok, message, evidence) => { if (!ok) throw Error(`${message}: ${JSON.stringify(evidence)}`); };
  const wait = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };
  const image = () => { const data = new Uint8Array(canvas.width*canvas.height*4); gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);return data; };
  const sample = (data, point) => {
    const p = view.project(point,scene.frame.spatial);
    const x = Math.round(p.x*canvas.width/canvas.clientWidth), y = canvas.height-1-Math.round(p.y*canvas.height/canvas.clientHeight);
    check(x>=0 && y>=0 && x<canvas.width && y<canvas.height,"tree sample outside canvas",{point,p});
    return [...data.subarray((y*canvas.width+x)*4,(y*canvas.width+x)*4+3)];
  };
  const delta = (a,b) => Math.max(...a.map((x,i)=>Math.abs(x-b[i])));
  const red = p => p[0]>p[1]+70;
  const green = p => p[1]>p[0]+45;
  const bytes = await (await fetch("/tree.glb")).arrayBuffer();
  const variants = [
    ["tree",bytes],
    ["single",materialVariant(bytes,m=>m.doubleSided=false)],
    ["factor",materialVariant(bytes,m=>m.pbrMetallicRoughness.baseColorFactor=[1,1,1,.5])],
    ["equal",materialVariant(bytes,m=>{m.pbrMetallicRoughness.baseColorFactor=[.1,.7,.2,.5];delete m.pbrMetallicRoughness.baseColorTexture;})],
    ["zero",materialVariant(bytes,m=>m.alphaCutoff=0)],
    ["beyond",materialVariant(bytes,m=>m.alphaCutoff=1+1e-8)],
    ["linear",materialVariant(bytes,(m,j)=>{j.samplers[0].magFilter=9729;j.samplers[0].minFilter=9987;})],
  ];
  const assets = new Map(), decodeEvidence=[];
  for (const [id,input] of variants) {
    const {asset,evidence} = await auditedLoad(input,{materialProfile:"diffuse"});decodeEvidence.push(evidence);
    check(engine.registerDataSceneSpatialModel(id,asset),"tree variant registration rejected",id);assets.set(id,asset);
  }
  const multiImage=materialVariant(bytes,(_m,j)=>j.images.push({...j.images[0]}));
  const {evidence:parallelDecode}=await auditedLoad(Array(4).fill(multiImage),{materialProfile:"diffuse"});
  check(parallelDecode.contexts===8&&parallelDecode.peakContexts===1&&!gl.isContextLost(),"parallel image preparation retained scratch contexts across awaits",parallelDecode);
  const camera = {projection:"orthographic",position:{x:0,y:-180,elevation:48},target:{x:0,y:0,elevation:48},height:160,near:.1,far:1200};
  const components = tree => ({visual:{kind:"sprite",texture:1,width:64,height:96,originY:1},
    collider:{type:"aabb",halfWidth:tree?4:2,halfHeight:tree?4:2,isTrigger:false},
    body:{type:tree?"static":"kinematic",heightSpan:{floorId:0,elevation:0,height:tree?40:8}},layer:tree?"wall":"player"});
  const document = {format:"ferrum2d.consumer.scene-authoring",version:1,gameplay:{primaryActor:"actor"},
    sceneComposition:{initialFragment:"tree",prefabs:{object:{}},fragments:{tree:{instances:[
      {id:"actor",prefab:"object",x:-48,y:0,props:{components:components(false)}},
      {id:"tree",prefab:"object",x:0,y:0,props:{components:components(true)}},
    ]}}},behaviorRecipes:{entities:{}},spatial:{camera,terrain:[{id:"ground",x:-200,y:-200,width:400,depth:400,elevation:0,color:[.7,.7,.7,1],castShadow:false}],
      billboards:{actor:{castShadow:false}},models:{tree:{asset:"tree",contentId:assets.get("tree").contentId}},
      actor:{instanceId:"actor",speed:100,maxStepHeight:8,maxDropHeight:8},
      environment:{lighting:{ambient:[.1,.1,.1],lights:[],directional:{direction:{x:0,y:-1,elevation:0},intensity:.8}}}}};
  let handles = applyDataSceneAuthoringDocument(engine,document).entityHandles;
  engine.pauseDataScene(); await wait();
  check(engine.moveDataSceneSpatialBody(handles.actor,96,0),"tree trunk sweep rejected");
  const blockedX = engine.getPhysicsEntity(handles.actor).x;
  check(blockedX===-6,"tree trunk native proxy did not block actor",blockedX);
  engine.setPhysicsBodyPosition(handles.actor,0,8);await wait();
  const points = {hole:{x:4,y:0,elevation:60},solid:{x:20,y:0,elevation:60},partial:{x:-12,y:0,elevation:60}};
  const front = image(), frontPixels = Object.fromEntries(Object.entries(points).map(([id,p])=>[id,sample(front,p)]));
  check(red(frontPixels.hole) && green(frontPixels.solid) && green(frontPixels.partial),"MASK color/depth coverage differs",frontPixels);
  const warm = {...scene.frame.stats.spatial};
  check(warm.modelCount===1 && warm.modelDrawCalls===2 && warm.modelTriangleCount===14 && warm.modelUploadBytes===0,"tree GPU sharing/submission failed",warm);
  await window.spatialDebugScreenshot("model-tree-front",canvas.toDataURL());
  const configure = async (id="tree", side=1, environment=document.spatial.environment, cast=true) => {
    const spec=structuredClone(document.spatial);
    spec.models.tree={asset:id,contentId:assets.get(id).contentId,castShadow:cast};
    spec.camera={...camera,position:{x:0,y:-180*side,elevation:48}};
    if(environment===null)delete spec.environment;else spec.environment=environment;
    check(engine.configureDataSceneSpatial(spec,handles),"tree spatial variant rejected",id);
    engine.setPhysicsBodyPosition(handles.actor,0,8*side);await wait();
  };
  await configure("factor");
  const factor=image(), factorPixels={partial:sample(factor,points.partial),solid:sample(factor,points.solid)};
  check(red(factorPixels.partial) && green(factorPixels.solid),"MASK ignored factor alpha or equality",factorPixels);
  await configure("equal");
  check(green(sample(image(),points.hole)),"MASK discarded alpha equal to cutoff");
  await configure("zero",1,null);
  const zero=image(), zeroPixel=sample(zero,points.hole), top=sample(zero,{x:-28,y:0,elevation:92}),bottom=sample(zero,{x:28,y:0,elevation:36});
  check(delta(zeroPixel,[32,180,48])<=2 && delta(top,[200,40,20])<=2 && delta(bottom,[20,40,200])<=2,"straight RGBA lost hidden color or row orientation",{zeroPixel,top,bottom});
  await configure("linear",1,null);
  const edgePixel=sample(image(),{x:9,y:0,elevation:60});
  check(delta(edgePixel,[32,180,48])<=2,"linear MASK edge darkened after premultiplied image decode",edgePixel);
  await configure("beyond");
  check(red(sample(image(),points.solid)),"cutoff above 1 rounded down to opaque");
  const backEnvironment={lighting:{ambient:[.1,.1,.1],lights:[],directional:{direction:{x:0,y:1,elevation:0},intensity:.8}}};
  await configure("tree",-1,backEnvironment);
  const back=image(), backPixels={hole:sample(back,points.hole),solid:sample(back,points.solid)};
  check(red(backPixels.hole) && green(backPixels.solid) && delta(frontPixels.solid,backPixels.solid)<5,"double-sided back normal/coverage failed",{frontPixels,backPixels});
  await window.spatialDebugScreenshot("model-tree-back",canvas.toDataURL());
  await configure("single",-1,backEnvironment);
  check(red(sample(image(),points.solid)),"single-sided back face was rendered");
  const shadowChecks=[];
  for(const kind of ["point","sun"])for(const side of [1,-1]) {
    const environment={lighting:{ambient:[.15,.15,.15],lights:[],...(kind==="sun"?{directional:{direction:{x:0,y:-side,elevation:1},intensity:.8,shadows:{resolution:512,bias:.05}}}:{lights:[{position:{x:0,y:-80*side,elevation:160},radius:400,intensity:1}],shadows:{lightIndex:0,resolution:512,bias:.05}})}};
    const spec=structuredClone(document.spatial);spec.environment=environment;
    // View the receiver from the shadow side so the canopy cannot hide the sampled ground.
    spec.camera={...camera,position:{x:0,y:220*side,elevation:260},target:{x:0,y:0,elevation:0},height:240};
    engine.setPhysicsBodyPosition(handles.actor,100,100);
    const render = async cast => {spec.models.tree.castShadow=cast;check(engine.configureDataSceneSpatial(spec,handles),"tree shadow variant rejected");await wait();return image();};
    const lit=await render(false), shadow=await render(true);
    const ratio=kind==="point"?1.6:1, groundY=(kind==="point"?48:60)*side;
    const hole={x:4*ratio,y:groundY,elevation:0},solid={x:20*ratio,y:groundY,elevation:0};
    const holeDelta=delta(sample(lit,hole),sample(shadow,hole)),solidDelta=delta(sample(lit,solid),sample(shadow,solid));
    check(holeDelta<8 && solidDelta>20,"leaf alpha/culling disagrees with shadow depth",{kind,side,holeDelta,solidDelta,hole,solid});
    shadowChecks.push({kind,side,holeDelta,solidDelta});
  }
  handles=applyDataSceneAuthoringDocument(engine,document).entityHandles;engine.pauseDataScene();
  engine.setPhysicsBodyPosition(handles.actor,0,8);engine.setPhysicsBodyHeightSpan(handles.tree,{floorId:1,elevation:16,height:40});await wait();
  const saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:document}))),before=image();
  const registry=createSceneInstanceHandleRegistry();let frame;
  const fresh=await createEngine(state=>{frame=state;},undefined,undefined,()=>renderer.viewportSize());
  try {
    fresh.setViewportSize(renderer.viewportSize().width,renderer.viewportSize().height);
    check(fresh.registerDataSceneSpatialModel("tree",assets.get("tree")),"fresh tree registration failed");
    check(restoreGameStateSnapshot(fresh,saved,{dataSceneAuthoringApplyOptions:{instanceHandleRegistry:registry}}).dataSceneStateApplied,"fresh tree restore failed");
    fresh.start();await wait();renderer.render();renderer.renderCommands(frame.renderCommandBuffer);renderer.renderPostProcess();
    const after=image(),differences=before.reduce((n,v,i)=>n+Number(v!==after[i]),0);
    check(differences===0 && fresh.getPhysicsEntity(registry.get("tree")).heightSpan.elevation===16,"fresh tree material/pose pixels changed",differences);
  } finally {fresh.destroy();}
  const malformed = [m=>m.alphaCutoff=-.1,m=>m.alphaCutoff=1e-50,m=>m.alphaCutoff=null,m=>m.alphaMode="BLEND",m=>m.alphaMode=["MASK"],m=>m.doubleSided="yes"];
  for(const edit of malformed){let rejected=false;try{await loadSpatialGlb(materialVariant(bytes,edit),{materialProfile:"diffuse"});}catch{rejected=true;}check(rejected && engine.gameplayEntityExists(handles.tree),"invalid tree material changed active scene");}
  const abort=new AbortController();let aborted=false,abortEvidence;
  try{await auditedLoad(bytes,{materialProfile:"diffuse",signal:abort.signal},()=>abort.abort(),e=>abortEvidence=e);}catch(error){aborted=error.name==="AbortError";}
  check(aborted&&abortEvidence.contexts===0&&abortEvidence.closed===1&&engine.gameplayEntityExists(handles.tree),"aborted image decode leaked or changed the scene",abortEvidence);
  const resources=renderer.resourceStats();
  const empty=structuredClone(document);empty.spatial.models={};empty.sceneComposition.fragments.tree.instances.pop();
  applyDataSceneAuthoringDocument(engine,empty);engine.pauseDataScene();await wait();const released=renderer.resourceStats();
  check(released.bufferCount===resources.bufferCount-4 && released.textureCount===resources.textureCount-1,"tree GPU resources leaked",{resources,released});
  for(const id of assets.keys())check(engine.releaseDataSceneSpatialModel(id),"tree CPU resource release failed",id);
  check(gl.getError()===gl.NO_ERROR,"tree WebGL error");
  return {contentId:assets.get("tree").contentId,triangles:14,blockedX,frontPixels,backPixels,factorPixels,zeroPixel,top,bottom,edgePixel,decodeEvidence,parallelDecode,abortEvidence,aborted,shadowChecks,warm,freshRestore:true,resourceRelease:true};
}
