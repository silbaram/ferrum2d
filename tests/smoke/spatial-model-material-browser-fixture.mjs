import { loadSpatialGlb, createEngine, WebGL2Renderer, captureGameStateSnapshot, restoreGameStateSnapshot } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry } from "@ferrum2d/ferrum-web/authoring";
import { materialVariant, auditedLoad } from "/spatial-model-tree-probe.mjs";

export async function probeSpatialModelMaterials(scene,canvas) {
  const {engine,renderer,view}=scene,gl=canvas.getContext("webgl2");
  const check=(ok,message,evidence)=>{if(!ok)throw Error(`${message}: ${JSON.stringify(evidence)}`);};
  const wait=async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
  const image=(g=gl,c=canvas)=>{const p=new Uint8Array(c.width*c.height*4);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,p);return p;};
  const sample=(p,point={x:20,y:0,elevation:60})=>{const screen=view.project(point,scene.frame.spatial),x=Math.round(screen.x*canvas.width/canvas.clientWidth),y=canvas.height-1-Math.round(screen.y*canvas.height/canvas.clientHeight);return [...p.subarray((y*canvas.width+x)*4,(y*canvas.width+x)*4+3)];};
  const delta=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
  const bytes=await(await fetch("/tree-material.glb")).arrayBuffer();
  const edit=(fn)=>materialVariant(bytes,fn), black=m=>{delete m.normalTexture;m.pbrMetallicRoughness.baseColorFactor=[0,0,0,1];};
  const extension=(m,j,name,value)=>{m.extensions={...m.extensions,[name]:value};j.extensionsUsed=[...new Set([...(j.extensionsUsed??[]),name])];j.extensionsRequired=[...new Set([...(j.extensionsRequired??[]),name])];};
  const mirrored=edit(m=>m.emissiveFactor=[0,0,0]);
  {const header=new DataView(mirrored),size=header.getUint32(12,true),j=JSON.parse(new TextDecoder().decode(new Uint8Array(mirrored,20,size))),a=j.accessors[j.meshes[1].primitives[0].attributes.TANGENT],offset=28+size+j.bufferViews[a.bufferView].byteOffset;for(let i=0;i<4;i++)header.setFloat32(offset+i*16+12,1,true);}
  const variants=[
    ["mapped",edit(m=>m.emissiveFactor=[0,0,0])],
    ["flat",edit(m=>{delete m.normalTexture;m.emissiveFactor=[0,0,0];})],
    ["zero",edit(m=>{m.normalTexture.scale=0;m.emissiveFactor=[0,0,0];})],
    ["emit",edit(black)],
    ["scalar",edit(m=>{black(m);delete m.emissiveTexture;m.emissiveFactor=[.2,.1,.05];})],
    ["shared",edit(m=>{m.pbrMetallicRoughness.baseColorFactor=[0,0,0,1];m.emissiveTexture.index=m.normalTexture.index;m.emissiveFactor=[1,1,1];})],
    ["mirror",mirrored],
    ["filtered",edit((m,j)=>{black(m);j.samplers[0].magFilter=9729;j.samplers[0].minFilter=9729;})],
    ["filtered-base",edit((m,j)=>{delete m.normalTexture;m.emissiveFactor=[0,0,0];m.alphaCutoff=0;m.pbrMetallicRoughness={baseColorTexture:{index:2}};j.samplers[0].magFilter=9729;j.samplers[0].minFilter=9729;})],
    ["unlit",edit((m,j)=>{m.pbrMetallicRoughness={baseColorFactor:[.2,.1,.05,1]};m.emissiveFactor=[1,1,1];extension(m,j,"KHR_materials_unlit",{});})],
    ["strength-zero",edit((m,j)=>{black(m);delete m.emissiveTexture;m.emissiveFactor=[.2,.1,.05];extension(m,j,"KHR_materials_emissive_strength",{emissiveStrength:0});})],
    ["strength-four",edit((m,j)=>{black(m);delete m.emissiveTexture;m.emissiveFactor=[.2,.1,.05];extension(m,j,"KHR_materials_emissive_strength",{emissiveStrength:4});})],
  ];
  const assets=new Map(),decodeEvidence=[];
  for(const[id,input]of variants){const{asset,evidence}=await auditedLoad(input,{materialProfile:"diffuse"});check(engine.registerDataSceneSpatialModel(id,asset),"material registration failed",id);assets.set(id,asset);decodeEvidence.push(evidence);}
  const camera={projection:"orthographic",position:{x:0,y:-180,elevation:48},target:{x:0,y:0,elevation:48},height:160,near:.1,far:1200};
  const light=(direction={x:1,y:-1,elevation:-1})=>({lighting:{ambient:[0,0,0],lights:[],directional:{direction,intensity:1}}});
  const dark={lighting:{ambient:[0,0,0],lights:[]}},components=tree=>({visual:{kind:"sprite",texture:1,width:64,height:96,originY:1},collider:{type:"aabb",halfWidth:2,halfHeight:2,isTrigger:false},body:{type:tree?"static":"kinematic",heightSpan:{floorId:0,elevation:0,height:8}},layer:tree?"wall":"player"});
  const document={format:"ferrum2d.consumer.scene-authoring",version:1,gameplay:{primaryActor:"actor"},sceneComposition:{initialFragment:"materials",prefabs:{object:{}},fragments:{materials:{instances:[
    {id:"actor",prefab:"object",x:0,y:8,props:{components:components(false)}},{id:"tree",prefab:"object",x:0,y:0,props:{components:components(true)}}
  ]}}},behaviorRecipes:{entities:{}},spatial:{camera,terrain:[{id:"ground",x:-200,y:-200,width:400,depth:400,elevation:0,color:[.7,.7,.7,1],castShadow:false}],billboards:{actor:{castShadow:false}},models:{tree:{asset:"mapped",contentId:assets.get("mapped").contentId,receiveShadow:false}},environment:light()}};
  const handles=applyDataSceneAuthoringDocument(engine,document).entityHandles;engine.pauseDataScene();await wait();
  const configure=async(id,environment=light(),side=1)=>{const spec=structuredClone(document.spatial);spec.models.tree={asset:id,contentId:assets.get(id).contentId,receiveShadow:false};spec.camera.position.y=-180*side;if(environment===null)delete spec.environment;else spec.environment=environment;check(engine.configureDataSceneSpatial(spec,handles),"material scene rejected",id);engine.setPhysicsBodyPosition(handles.actor,0,8*side);await wait();return image();};
  const mapped=sample(await configure("mapped")),flat=sample(await configure("flat")),zero=sample(await configure("zero"));
  check(mapped[1]>flat[1]+15 && delta(flat,zero)<=2,"normal texture or normal scale did not affect lighting",{mapped,flat,zero});
  const direction={x:1,y:-1,elevation:1};
  const negative=sample(await configure("mapped",light(direction))),positive=sample(await configure("mirror",light(direction)));
  check(positive[1]>negative[1]+25,"glTF tangent handedness/green axis ignored",{negative,positive});
  const front=sample(await configure("mapped",light())),back=sample(await configure("mapped",light({x:-1,y:1,elevation:1}),-1));
  check(delta(front,back)<=3,"double-sided normal map did not reverse final normal",{front,back});
  const emit=sample(await configure("emit",dark)),bright=sample(await configure("emit",light())),scalar=sample(await configure("scalar",dark));
  const linear=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4,encode=x=>Math.round(255*(x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055));
  const expected=[20,80,200].map((v,i)=>encode(linear(v/255)*[.4,.6,.8][i])),scalarExpected=[.2,.1,.05].map(encode);
  check(delta(emit,expected)<=3 && delta(emit,bright)<=2 && delta(scalar,scalarExpected)<=3,"emission was lit, double-decoded, or multiplied by texture alpha",{emit,bright,scalar,expected,scalarExpected});
  const unlitDark=sample(await configure("unlit",dark)),unlitLit=sample(await configure("unlit",light()));
  check(delta(unlitDark,unlitLit)<=2&&delta(unlitDark,scalarExpected)<=3&&delta(unlitDark,scalar)<=3,
    "KHR_materials_unlit was lit or included emission",{unlitDark,unlitLit,scalar,expected:scalarExpected});
  const strengthEnvironment={...dark,colorGrading:{exposure:1,toneMapping:"reinhard"}};
  const strengthZero=sample(await configure("strength-zero",strengthEnvironment)),strengthScalar=sample(await configure("scalar",strengthEnvironment)),strengthFour=sample(await configure("strength-four",strengthEnvironment));
  const strengthExpected=scale=>[.2,.1,.05].map(v=>{const x=v*scale*2;return encode(x/(1+x));});
  check(delta(strengthZero,[0,0,0])<=2&&delta(strengthScalar,strengthExpected(1))<=3&&delta(strengthFour,strengthExpected(4))<=3&&strengthFour.every((v,i)=>v>strengthScalar[i]+20),
    "KHR_materials_emissive_strength ignored zero, multiplier, or HDR tone mapping",{strengthZero,strengthScalar,strengthFour,scalarExpected:strengthExpected(1),fourExpected:strengthExpected(4)});
  const unlitExtension={dark:unlitDark,lit:unlitLit,expected:scalarExpected,emissionIgnored:true};
  const emissiveStrength={zero:strengthZero,scalar:strengthScalar,four:strengthFour,scalarExpected:strengthExpected(1),fourExpected:strengthExpected(4),exposure:1,toneMapping:"reinhard"};
  const unlit=sample(await configure("emit",null));check(delta(unlit,expected)<=3,"environment-free emission path failed",{unlit,expected});
  const shared=sample(await configure("shared",dark));check(delta(shared,[180,180,231])<=3,"shared normal/emissive image used wrong color space",shared);
  const fog=sample(await configure("emit",{...dark,fog:{color:[0,0,1],start:0,end:1}}));check(fog[2]>245&&fog[0]<3,"emission bypassed distance fog",fog);
  const exposed=sample(await configure("emit",{...dark,colorGrading:{exposure:1,toneMapping:"reinhard"}}));
  const exposedExpected=[20,80,200].map((v,i)=>{const x=2*linear(v/255)*[.4,.6,.8][i];return encode(x/(1+x));});
  check(delta(exposed,exposedExpected)<=3,"emission bypassed HDR exposure/tone mapping",{exposed,exposedExpected});
  await configure("shared",dark);
  const linearCanvas=globalThis.document.createElement("canvas");linearCanvas.style.cssText=`width:${canvas.clientWidth}px;height:${canvas.clientHeight}px;position:absolute;left:-10000px`;globalThis.document.body.append(linearCanvas);
  const linearRenderer=new WebGL2Renderer(linearCanvas,{colorManagement:"linear-srgb",preserveDrawingBuffer:true});const linearPixels={};
  try {
    const sprite=globalThis.document.createElement("canvas");sprite.width=sprite.height=2;const context=sprite.getContext("2d");context.fillStyle="#ff0000";context.fillRect(0,0,2,2);await linearRenderer.loadTexture(1,sprite.toDataURL());
    for(const[id,environment]of [["mapped",light()],["emit",dark],["shared",dark],["filtered",dark],["filtered-base",null],["unlit",light()],["strength-zero",strengthEnvironment],["strength-four",strengthEnvironment]]){
      const point=id.startsWith("filtered")?{x:0,y:0,elevation:84}:undefined;
      const legacy=sample(await configure(id,environment),point);
      linearRenderer.render();linearRenderer.renderCommands({...scene.frame.state.renderCommandBuffer,buffer:new Float32Array(),commandCount:0});linearRenderer.renderPostProcess();
      const g=linearCanvas.getContext("webgl2"),pixel=sample(image(g,linearCanvas),point);
      check(delta(pixel,legacy)<=3&&g.getError()===g.NO_ERROR,"linear-sRGB model material diverged",{id,pixel,legacy});
      if (id.startsWith("filtered")) {
        const midpoint=[200,80,20].map((v,i)=>(linear(v/255)+linear([20,80,200][i]/255))/2);
        const expected=midpoint.map((v,i)=>encode(v*(id==="filtered"?[.4,.6,.8][i]:1)));
        check(delta(pixel,expected)<=3&&delta(legacy,expected)<=3,"model filtered before sRGB decode",{id,pixel,legacy,expected});
      }
      linearPixels[id]=pixel;
    }
  } finally {linearRenderer.destroy();linearCanvas.remove();}
  // Own texture/sampler unit 4 must survive a complete spatial submission.
  const sentinelTexture=gl.createTexture(),sentinelSampler=gl.createSampler(),previousActive=gl.getParameter(gl.ACTIVE_TEXTURE);
  gl.activeTexture(gl.TEXTURE4);const previousTexture=gl.getParameter(gl.TEXTURE_BINDING_2D),previousSampler=gl.getParameter(gl.SAMPLER_BINDING);gl.bindTexture(gl.TEXTURE_2D,sentinelTexture);gl.bindSampler(4,sentinelSampler);
  try{renderer.render();renderer.renderCommands(scene.frame.state.renderCommandBuffer);check(gl.getParameter(gl.ACTIVE_TEXTURE)===gl.TEXTURE4&&gl.getParameter(gl.TEXTURE_BINDING_2D)===sentinelTexture&&gl.getParameter(gl.SAMPLER_BINDING)===sentinelSampler,"material unit 4 state leaked");}
  finally{gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,previousTexture);gl.bindSampler(4,previousSampler);gl.activeTexture(previousActive);gl.deleteTexture(sentinelTexture);gl.deleteSampler(sentinelSampler);}
  const shadowChecks=[];
  for (const kind of ["point","sun"]) {
    const environment={lighting:{ambient:[.15,.15,.15],lights:[],...(kind==="sun"?{directional:{direction:{x:0,y:-1,elevation:1},intensity:.8,shadows:{resolution:512,bias:.05}}}:{lights:[{position:{x:0,y:-80,elevation:160},radius:400,intensity:1}],shadows:{lightIndex:0,resolution:512,bias:.05}})}};
    const spec=structuredClone(document.spatial);spec.environment=environment;spec.models.tree={asset:"mapped",contentId:assets.get("mapped").contentId};
    spec.camera={...camera,position:{x:0,y:220,elevation:260},target:{x:0,y:0,elevation:0},height:240};engine.setPhysicsBodyPosition(handles.actor,100,100);
    const render=async cast=>{spec.models.tree.castShadow=cast;check(engine.configureDataSceneSpatial(spec,handles),"mapped shadow rejected");await wait();return image();};
    const lit=await render(false),shadow=await render(true),ratio=kind==="point"?1.6:1,y=kind==="point"?48:60;
    const holeDelta=delta(sample(lit,{x:4*ratio,y,elevation:0}),sample(shadow,{x:4*ratio,y,elevation:0})),solidDelta=delta(sample(lit,{x:20*ratio,y,elevation:0}),sample(shadow,{x:20*ratio,y,elevation:0}));
    check(holeDelta<8&&solidDelta>20,"normal/emissive model changed alpha shadow coverage",{kind,holeDelta,solidDelta});shadowChecks.push({kind,holeDelta,solidDelta});
  }
  await configure("mapped");
  const warm={...scene.frame.stats.spatial};check(warm.modelDrawCalls===2&&warm.modelTriangleCount===14&&warm.modelUploadBytes===0,"material warm submission/upload regression",warm);
  await window.spatialDebugScreenshot("model-material-normal",canvas.toDataURL());
  await configure("emit",dark);await window.spatialDebugScreenshot("model-material-emissive",canvas.toDataURL());
  const saveDoc=structuredClone(document);saveDoc.spatial.models.tree={asset:"emit",contentId:assets.get("emit").contentId,receiveShadow:false};saveDoc.spatial.environment=dark;
  applyDataSceneAuthoringDocument(engine,saveDoc);engine.pauseDataScene();await wait();
  const saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:saveDoc}))),before=image(),registry=createSceneInstanceHandleRegistry();let frame;
  const fresh=await createEngine(state=>{frame=state;},undefined,undefined,()=>renderer.viewportSize());
  try{fresh.setViewportSize(renderer.viewportSize().width,renderer.viewportSize().height);check(fresh.registerDataSceneSpatialModel("emit",assets.get("emit")),"fresh material registration failed");check(restoreGameStateSnapshot(fresh,saved,{dataSceneAuthoringApplyOptions:{instanceHandleRegistry:registry}}).dataSceneStateApplied,"material restore failed");fresh.start();await wait();renderer.render();renderer.renderCommands(frame.renderCommandBuffer);renderer.renderPostProcess();const after=image(),differences=before.reduce((n,v,i)=>n+Number(v!==after[i]),0);check(differences===0,"fresh material pixels changed",differences);}finally{fresh.destroy();}
  const resources=renderer.resourceStats(),empty=structuredClone(document);empty.spatial.models={};empty.sceneComposition.fragments.materials.instances.pop();applyDataSceneAuthoringDocument(engine,empty);engine.pauseDataScene();await wait();const released=renderer.resourceStats();
  check(resources.bufferCount-released.bufferCount===4&&resources.textureCount-released.textureCount===2,"material GPU resources leaked",{resources,released});
  for(const id of assets.keys())check(engine.releaseDataSceneSpatialModel(id),"material CPU release failed",id);
  check(gl.getError()===gl.NO_ERROR,"material WebGL error");
  return {mapped,flat,zero,negative,positive,front,back,emit,expected,scalar,unlitExtension,emissiveStrength,shared,fog,exposed,linearPixels,decodeEvidence,shadowChecks,warm,freshRestore:true,resourceRelease:true,stateRestored:true};
}
