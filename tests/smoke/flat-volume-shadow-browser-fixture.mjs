import { createEngine,createRenderer,createDataSceneView } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";
import { check,pixels,difference,png } from "/fixture.mjs";

// Independent oracle: clip a 3D ray against the walls and the two roof planes.
// It does not reproduce Rust's projected-vertex convex hull algorithm.
function rayHitsVolume(world,pose,sun) {
  const c=Math.cos(pose.rotation),s=Math.sin(pose.rotation),dx=world.x-pose.x,dy=world.y-pose.y;
  const p=[(c*dx+s*dy)/pose.scale,(-s*dx+c*dy)/pose.scale,0];
  const d=[-(c*sun.directionX+s*sun.directionY)*sun.shadowLengthScale,
    -(-s*sun.directionX+c*sun.directionY)*sun.shadowLengthScale,1];
  const slope=24/25,planes=[[1,0,0,25],[-1,0,0,25],[0,1,0,0],[0,-1,0,22],[0,0,-1,0],[slope,0,1,52],[-slope,0,1,52]];
  let low=0,high=Infinity;
  for(const [x,y,z,b] of planes){
    const gap=b-x*p[0]-y*p[1]-z*p[2],den=x*d[0]+y*d[1]+z*d[2];
    if(Math.abs(den)<1e-10){if(gap<0)return false;continue;}
    const t=gap/den;if(den>0)high=Math.min(high,t);else low=Math.max(low,t);
    if(low>high)return false;
  }
  return high>=0;
}

async function probe(canvas,backend,colorManagement){
  if(backend==="webgpu")canvas.dataset.spatialGpuTarget="true";
  const renderer=await createRenderer(canvas,{preferred:backend,colorManagement,fallbackBehavior:"silent",
    webgl2:{preserveDrawingBuffer:true,clearColor:[.06,.06,.06,1]},webgpu:{clearColor:[.06,.06,.06,1]}});
  check((typeof renderer.gpuDevice==="function")===(backend==="webgpu"),"volume renderer fell back");
  const rows=[],errors=[],allocations={textures:0,buffers:0,groups:0};let device=renderer.gpuDevice?.(),engine,view,pending;
  const watch=()=>{device?.addEventListener("uncapturederror",e=>errors.push(e.error.message));const owner=device??canvas.getContext("webgl2");
    for(const [method,key] of [["createTexture","textures"],["createBuffer","buffers"],...(device?[["createBindGroup","groups"]]:[])]){
      const original=owner[method].bind(owner);owner[method]=(...args)=>{allocations[key]++;return original(...args);};
    }};watch();
  let pose={x:160,y:95,rotation:0,scale:1},normal=false;
  let sun={directionX:1,directionY:0,intensity:.3,color:[0,1,0],shadowOpacity:.75,shadowLengthScale:.7,maxCasters:100};
  const lights=()=>({ambient:[.03,.03,.03,.4],directionalLight:sun,pointLights:[{x:160,y:90,radius:400,intensity:.15,color:[0,0,1]}],shadows:false});
  const documentFor=()=>({format:"ferrum2d.consumer.scene-authoring",version:1,sceneComposition:{initialFragment:"main",prefabs:{object:{}},fragments:{main:{instances:[
    {id:"ground",prefab:"object",x:160,y:90,layer:-100,props:{components:{visual:{kind:"sprite",texture:1,width:4000,height:4000,originY:.5,projection:"ground",tint:"#303030",...(normal?{normalTexture:2}:{})},collider:"none",layer:"wall"}}},
    {id:"house",prefab:"object",x:pose.x,y:pose.y,scale:pose.scale,rotationRadians:pose.rotation,props:{components:{visual:{kind:"sprite",texture:3,width:50,height:64,originY:1,depthSort:"hd2d",
      shadow:{shape:"volume",width:50,depth:22,height:28,roofHeight:24,opacity:.8}},collider:"none",layer:"wall"}}},
  ]}}},behaviorRecipes:{entities:{}}});
  const render=(name,options={})=>new Promise((resolve,reject)=>{pending={name,options,resolve,reject,before:{...allocations}};engine.start();});
  try{
    renderer.resize();const image=document.createElement("canvas");image.width=image.height=1;
    const ctx=image.getContext("2d");ctx.fillStyle="white";ctx.fillRect(0,0,1,1);await renderer.loadTexture(1,image.toDataURL());
    ctx.putImageData(new ImageData(new Uint8ClampedArray([128,128,255,255]),1,1),0,0);await renderer.loadTexture(2,image.toDataURL(),{colorSpace:"none"});
    ctx.clearRect(0,0,1,1);await renderer.loadTexture(3,image.toDataURL());
    engine=await createEngine(state=>{
      const request=pending;if(!request)return;pending=undefined;
      try{
        const camera=view.snapshot(state),original=state.renderCommandBuffer;
        let commands=original;
        if(request.options.control&&original.groundShadowVolumes){
          const volumes={...original.groundShadowVolumes,buffer:original.groundShadowVolumes.buffer.slice()};
          for(let i=2;i<volumes.buffer.length;i+=3)volumes.buffer[i]=0;
          commands={...original,groundShadowVolumes:volumes};
        }
        if(request.options.volumeOnly)commands={...commands,commandCount:0,buffer:new Float32Array(0),spriteNormalMaterials:undefined};
        renderer.setLighting(view.lighting(lights(),camera));renderer.render();
        const stats=renderer.renderCommands(commands);renderer.renderPostProcess();
        const allocated=Object.fromEntries(Object.entries(allocations).map(([key,n])=>[key,n-request.before[key]]));
        if(request.options.warm)check(Object.values(allocated).every(n=>n===0),"warm volume allocated GPU resources",allocated);
        const volumes=original.groundShadowVolumes,sidecar=volumes?{vertexCount:volumes.vertexCount,casterCount:volumes.casterCount,vertices:Array.from(volumes.buffer)}:undefined;
        // Native diagnostic calls follow GPU consumption and owned metadata copies.
        const native=engine.dataSceneGroundShadowStats();engine.stop();
        const capture=pixels(renderer,canvas);
        Promise.resolve(capture).then(data=>{
          const row={name:request.name,stats,sidecar,native,allocated,rustMs:state.rustUpdateTimeMs};
          if(/sweep-(0|90|135|180|270|360)$|volume-only|rotated|pixel-perfect|recover/.test(row.name))row.image=png(data,canvas.width,canvas.height);
          rows.push(row);check(!errors.length,"volume GPU validation error",errors);check(stats.drawCalls<=32,"volume draw budget",stats);
          request.resolve({data,row,camera});
        },request.reject).catch(request.reject);
      }catch(error){engine.stop();request.reject(error);}
    },undefined,undefined,()=>renderer.viewportSize());
    const apply=()=>{applyDataSceneAuthoringDocument(engine,documentFor(),{colorManagement});
      view=createDataSceneView(engine,renderer,canvas,{x:160,y:90,zoom:Math.min(canvas.clientWidth/320,canvas.clientHeight/180),groundYScale:1,sun});};
    apply();
    const assess=(blocked,control)=>{
      let shadowed=0,open=0,maxOtherDelta=0;
      for(let y=25;y<=155;y+=4)for(let x=85;x<=235;x+=4){
        const p=view.worldToScreen({x,y},blocked.camera),px=Math.floor(p.x*canvas.width/canvas.clientWidth),py=Math.floor(p.y*canvas.height/canvas.clientHeight);
        if(px<2||py<2||px>=canvas.width-2||py>=canvas.height-2)continue;
        const q=view.screenToWorld({x:(px+.5)*canvas.clientWidth/canvas.width,y:(py+.5)*canvas.clientHeight/canvas.height},blocked.camera);
        const expected=rayHitsVolume(q,pose,sun),margin=2.5/blocked.camera.zoom;
        if([[margin,0],[-margin,0],[0,margin],[0,-margin]].some(([dx,dy])=>rayHitsVolume({x:q.x+dx,y:q.y+dy},pose,sun)!==expected))continue;
        const i=(py*canvas.width+px)*4,delta=control.data[i+1]-blocked.data[i+1];
        check(expected?delta>12:Math.abs(delta)<=2,"native volume pixels disagree with independent 3D ray oracle",{pose,sun,q,expected,delta});
        maxOtherDelta=Math.max(maxOtherDelta,Math.abs(control.data[i]-blocked.data[i]),Math.abs(control.data[i+2]-blocked.data[i+2]));
        if(expected)shadowed++;else open++;
      }
      check(shadowed>=15&&open>=100&&maxOtherDelta<=2,"volume coverage or unrelated-light preservation",{shadowed,open,maxOtherDelta});
      blocked.row.oracle={shadowed,open,maxOtherDelta};
    };
    let first;
    for(let angle=0;angle<=360;angle+=15){
      const rad=angle*Math.PI/180;sun={...sun,directionX:Math.cos(rad),directionY:Math.sin(rad)};view.setSun(sun);
      const blocked=await render("sweep-"+angle),control=await render("control-"+angle,{control:true,warm:true});assess(blocked,control);
      check(blocked.row.sidecar?.casterCount===1&&blocked.row.sidecar.vertexCount<=24,"native volume sidecar missing",blocked.row);
      if(angle===0)first=blocked.data;
      if(angle===360)check(difference(first,blocked.data)===0,"full rotation did not return to identical pixels");
    }
    const only=await render("volume-only",{volumeOnly:true,warm:true});
    check(only.row.stats.renderCommandCount===0&&only.row.stats.shadowCasterCount===1&&only.row.stats.shadowDrawCalls===1,"volume-only frame omitted its mask",only.row);
    pose={x:160,y:95,rotation:.47,scale:1.4};apply();
    assess(await render("rotated-scaled"),await render("rotated-control",{control:true}));
    pose={x:160,y:95,rotation:0,scale:1};normal=true;apply();renderer.setPixelPerfect({width:320,height:180});view.setZoom(1);view.setGroundYScale(.6);
    const mapped=await render("pixel-perfect-normal"),mappedControl=await render("pixel-perfect-control",{control:true});
    check(mapped.row.stats.normalDrawCalls>0&&difference(mapped.data,mappedControl.data)>100,"normal/pixel-perfect path omitted volume shadow");
    normal=false;renderer.setPixelPerfect(false);canvas.style.width="317px";canvas.style.height="211px";renderer.resize();apply();
    const resized=await render("recovery-before");
    check(resized.row.sidecar?.casterCount===1,"resize lost native volume");
    if(device){const old=device;old.destroy();await old.lost;await new Promise(done=>setTimeout(done,0));await renderer.recoverDevice();device=renderer.gpuDevice();watch();
      const recovered=await render("recovered");check(difference(resized.data,recovered.data)===0,"device recovery changed volume shadow pixels");}
    view.setSun({...sun,shadowOpacity:0});
    const off=await render("off");check(!off.row.sidecar&&off.row.stats.shadowDrawCalls===0,"OFF retained volume triangles or target");
    engine.destroy();engine=undefined;renderer.destroy();const finalResources=renderer.resourceStats();
    check(finalResources.textureCount===0&&finalResources.bufferCount===0&&finalResources.renderTargetCount===0,"volume resources leaked",finalResources);
    return{backend,colorManagement,rows,errors,finalResources};
  }finally{engine?.destroy();renderer.destroy();window.disposeSpatialGpuTarget?.(canvas);device?.destroy();}
}

export async function probeFlatVolumeShadows(){
  const result=[];
  for(const [backend,color] of [["webgl2","legacy"],["webgpu","legacy"],["webgl2","linear-srgb"]]){
    const canvas=document.createElement("canvas");document.body.replaceChildren(canvas);result.push(await probe(canvas,backend,color));
  }
  for(const row of result[0].rows.filter(r=>r.image)){
    const other=result[1].rows.find(r=>r.name===row.name),images=[];
    for(const source of [row.image,other.image]){const b=await createImageBitmap(await(await fetch(source)).blob()),c=new OffscreenCanvas(b.width,b.height),ctx=c.getContext("2d");ctx.drawImage(b,0,0);b.close();images.push(ctx.getImageData(0,0,c.width,c.height).data);}
    let different=0,max=0;for(let i=0;i<images[0].length;i+=4){let d=0;for(let c=0;c<3;c++)d=Math.max(d,Math.abs(images[0][i+c]-images[1][i+c]));if(d>3)different++;max=Math.max(max,d);}
    row.parity={differentPixels:different,maxChannelDelta:max,pixels:images[0].length/4};
    check(different/row.parity.pixels<.01,"volume GL/GPU RGB parity",{name:row.name,...row.parity});
  }
  return result;
}
