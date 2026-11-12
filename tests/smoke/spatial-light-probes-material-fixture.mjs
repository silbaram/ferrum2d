import { createEngine, createRenderer, loadSpatialGlb, GAME_STATE_CODE } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";
import { check, pixels, difference } from "/fixture.mjs";

// A front-facing two-triangle model with known linear albedo and independently authored materials.
async function model(kind) {
  const positions = [-40,0,0, 40,0,0, 40,80,0, -40,0,0, 40,80,0, -40,80,0];
  const normal = kind === "tilted" ? [0,1,0] : [0,0,1];
  const data = new Float32Array([...positions, ...Array(6).fill(normal).flat()]);
  const material = { pbrMetallicRoughness: { baseColorFactor: [.3,.3,.3,1], metallicFactor: 0, roughnessFactor: .7 } };
  if(kind==="unlit")material.extensions={KHR_materials_unlit:{}};
  if(kind==="emission")material.emissiveFactor=[.2,.1,.05];
  if(kind==="specular")material.extensions={KHR_materials_specular:{specularFactor:1}};
  const doc={asset:{version:"2.0"},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},material:0}]}],materials:[material],
    buffers:[{byteLength:data.byteLength}],bufferViews:[{buffer:0,byteOffset:0,byteLength:72},{buffer:0,byteOffset:72,byteLength:72}],
    accessors:[{bufferView:0,componentType:5126,count:6,type:"VEC3",min:[-40,0,0],max:[40,80,0]},{bufferView:1,componentType:5126,count:6,type:"VEC3"}],
    ...(material.extensions?{extensionsUsed:Object.keys(material.extensions),extensionsRequired:Object.keys(material.extensions)}:{})};
  const json=new TextEncoder().encode(JSON.stringify(doc)),size=(json.length+3)&~3,buffer=new ArrayBuffer(28+size+data.byteLength),view=new DataView(buffer);
  [0x46546c67,2,buffer.byteLength,size,0x4e4f534a].forEach((v,i)=>view.setUint32(i*4,v,true));
  new Uint8Array(buffer,20,size).fill(32);new Uint8Array(buffer,20,json.length).set(json);
  view.setUint32(20+size,data.byteLength,true);view.setUint32(24+size,0x004e4942,true);new Uint8Array(buffer,28+size).set(new Uint8Array(data.buffer));
  return loadSpatialGlb(buffer,{materialProfile:kind==="specular"?"specular":"diffuse"});
}
export async function probeLightProbeMaterials(backend,colorManagement) {
  const canvas=document.createElement("canvas");canvas.style.cssText="width:96px;height:96px";canvas.dataset.spatialGpuTarget="true";document.body.replaceChildren(canvas);
  let renderer,engine,pending;const errors=[],rows=[];
  try{
    renderer=await createRenderer(canvas,{preferred:backend,colorManagement,fallbackBehavior:"silent",webgl2:{preserveDrawingBuffer:true}});
    check((typeof renderer.gpuDevice==="function")===(backend==="webgpu"),"Probe material fallback");
    renderer.gpuDevice?.().addEventListener("uncapturederror",e=>errors.push(e.error.message));
    engine=await createEngine(frame=>{
      if(!pending)return;const request=pending;pending=undefined;
      try{check(frame.gameState===GAME_STATE_CODE.playing&&frame.entityCount===1,"Probe material runtime state");renderer.render();const stats={...renderer.renderCommands(frame.renderCommandBuffer).spatial};renderer.renderPostProcess();engine.stop();pixels(renderer,canvas).then(data=>request.resolve({data,stats}),request.reject);}catch(e){engine.stop();request.reject(e);}
    },undefined,undefined,()=>renderer.viewportSize());
    const assets=new Map();for(const kind of ["diffuse","tilted","unlit","emission","specular"]){const asset=await model(kind);assets.set(kind,asset);check(engine.registerDataSceneSpatialModel(kind,asset),"Probe material register");}
    if(backend==="webgpu")await renderer.preloadSpatialModels([...assets.values()]);
    const camera={projection:"orthographic",position:{x:0,y:-160,elevation:40},target:{x:0,y:0,elevation:40},height:120,near:.1,far:400};
    const doc={format:"ferrum2d.consumer.scene-authoring",version:1,sceneComposition:{initialFragment:"lab",prefabs:{body:{}},fragments:{lab:{instances:[{id:"body",prefab:"body",x:0,y:0,props:{components:{visual:{kind:"sprite",texture:0,width:1,height:1,color:"#ffffff00"},collider:"none",layer:"wall"}}}]}}},behaviorRecipes:{entities:{}},spatial:{camera,terrain:[],billboards:{},models:{}}};
    const probes=[{position:{x:0,y:0,elevation:40},radius:10000,color:[.8,.4,.2],intensity:1}];
    const environment={composition:"separated",lighting:{ambient:[.1,.1,.1],lights:[]}};
    const read=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Probe material timeout")),15000);pending={resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}};engine.start();});
    const draw=async(kind,withProbes,direct=false)=>{
      const scene=structuredClone(doc);scene.spatial.models.body={asset:kind,contentId:assets.get(kind).contentId};
      scene.spatial.environment={...environment,lighting:{...environment.lighting,...(withProbes?{probes}:{}),...(direct?{directional:{direction:{x:0,y:-1,elevation:0},intensity:.5}}:{})}};
      applyDataSceneAuthoringDocument(engine,scene,{spatialModelPreparer:renderer,colorManagement});const r=await read();check(r.stats.modelCount===1&&r.stats.modelTriangleCount===2,"Probe material missing geometry",r.stats);return r;
    };
    const linear=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
    const sample=data=>{const at=(Math.floor(canvas.height/2)*canvas.width+Math.floor(canvas.width/2))*4;return [...data.slice(at,at+3)].map(x=>linear(x/255));};
    const cache=new Map();for(const kind of assets.keys())for(const direct of [false,true])for(const on of [false,true]){
      const r=await draw(kind,on,direct);cache.set(`${kind}/${direct}/${on}`,r);
      rows.push({kind,direct,probes:on,sample:sample(r.data),stats:r.stats});
    }
    const near=(a,b,label)=>a.forEach((x,i)=>check(Math.abs(x-b[i])<.008,label,{actual:a,expected:b}));
    const get=(kind,direct,on)=>sample(cache.get(`${kind}/${direct}/${on}`).data);
    near(get("unlit",false,false),[.3,.3,.3],"Unlit reference must be visible");
    near(get("diffuse",false,true),[.24,.12,.06],"Probe diffuse material reference");
    near(get("tilted",false,true),get("diffuse",false,true),"Isotropic probe changed with normal");
    for(const direct of [false,true]){
      check(difference(cache.get(`unlit/${direct}/false`).data,cache.get(`unlit/${direct}/true`).data)===0,"Probes changed unlit material");
      near(get("emission",direct,true).map((x,i)=>x-get("diffuse",direct,true)[i]),[.2,.1,.05],"Probes changed emission");
      const before=get("specular",direct,false).map((x,i)=>x-get("diffuse",direct,false)[i]);
      const after=get("specular",direct,true).map((x,i)=>x-get("diffuse",direct,true)[i]);near(after,before,"Probes changed direct specular");
    }
    near(get("diffuse",true,true).map((x,i)=>x-get("diffuse",false,true)[i]),[.15,.15,.15],"Probes changed direct diffuse");
    check(errors.length===0,"Probe material GPU errors",errors);return{backend,colorManagement,rows,errors};
  }finally{engine?.destroy();renderer?.destroy();window.disposeSpatialGpuTarget?.(canvas);canvas.remove();}
}
