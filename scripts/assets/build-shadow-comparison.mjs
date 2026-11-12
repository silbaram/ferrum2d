import {readFile,writeFile,copyFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {shadowComparisonModel} from "./shadow-comparison-models.mjs";

export async function buildShadowComparison(output){
  const source=new URL("../../apps/studio/public/assets/lantern-garden/",import.meta.url);
  const manifest=JSON.parse(await readFile(new URL("manifest.json",source),"utf8"));
  const atlas=await readFile(new URL("atlas.png",source)),sha=bytes=>createHash("sha256").update(bytes).digest("hex");
  if(sha(atlas)!==manifest.texture.sha256)throw Error("Garden atlas differs from its manifest");
  await copyFile(new URL("atlas.png",source),new URL("spatial/shadow-garden.png",output));
  const models={};
  for(const kind of ["actor","tree","lantern","crate"].flatMap(kind=>[kind,`${kind}-low`])){const name=`shadow-${kind}`,bytes=shadowComparisonModel(kind);models[name]=sha(bytes);await writeFile(new URL(`spatial/${name}.glb`,output),bytes);}
  const {width,height}=manifest.texture;
  const frame=name=>{const f=manifest.frames[name];return {u0:f.x/width,v0:f.y/height,u1:(f.x+f.width)/width,v1:(f.y+f.height)/height};};
  const frames=Array.from({length:4},(_,i)=>frame(`hero_0_${i}`));
  const actorVisual={kind:"sprite",texture:"shadow-garden",width:32,height:48,originX:.5,originY:1,
    animationSet:{initialClip:1,clips:[{id:0,frames,fps:6,loop:true},...frames.map((f,i)=>({id:i+1,frames:[f],fps:1,loop:true}))]}};
  const object=(id,x,y,visual,height)=>({id,prefab:"object",x,y,props:{components:{visual,layer:"wall",collider:height?{type:"aabb",halfWidth:4,halfHeight:4,isTrigger:false}:"none",
    ...(height?{body:{type:"static",heightSpan:{floorId:0,elevation:0,height}}}:{})}}});
  const hidden={kind:"sprite",texture:"wall",width:1,height:1,color:"#ffffff00"};
  const elevation=Math.PI/4,horizontal=-Math.SQRT1_2*Math.cos(elevation);
  const document={format:"ferrum2d.consumer.scene-authoring",version:1,behaviorRecipes:{entities:{}},
    sceneComposition:{initialFragment:"lab",prefabs:{object:{}},fragments:{lab:{instances:[
      object("actor",-48,-20,actorVisual,48),object("tree",52,10,{kind:"sprite",texture:"shadow-garden",width:64,height:96,originX:.5,originY:1,frame:frame("oak")},96),
      object("actor_shadow",0,0,hidden),object("tree_shadow",0,0,hidden)]}}},
    spatial:{camera:{projection:"orthographic",position:{x:220,y:-300,elevation:270},target:{x:0,y:10,elevation:12},height:260,near:.1,far:2000},
      terrain:[{id:"ground",x:-240,y:-200,width:480,depth:400,elevation:0,baseElevation:-3,color:[.55,.57,.55,1],castShadow:false},
        {id:"wall",x:-135,y:96,width:62,depth:8,elevation:54,baseElevation:0,floorId:1,walkable:false,color:[.65,.59,.48,1],castShadow:false},
        {id:"ramp",x:-140,y:45,width:48,depth:48,kind:"ramp",elevation:0,endElevation:20,floorId:1,color:[.48,.54,.6,1],castShadow:false}],
      billboards:{actor:{castShadow:false},tree:{castShadow:false}},
      models:Object.fromEntries(["actor","tree"].map(kind=>[`${kind}_shadow`,{asset:`shadow-${kind}`,contentId:models[`shadow-${kind}`],shadowOnly:true,castShadow:true}])),
      attachments:{actor_shadow:{parent:"actor"},tree_shadow:{parent:"tree"}},
      environment:{lighting:{ambient:[.14,.14,.14],lights:[],directional:{direction:{x:horizontal,y:horizontal,elevation:Math.sin(elevation)},intensity:1.6,color:[1,.95,.84],
        shadows:{resolution:512,extent:240,distance:1200,bias:.03,normalBias:.02}}}}}};
  await writeFile(new URL("hd2d-shadow-proxy.json",output),JSON.stringify(document,null,2)+"\n");
  // Measured alpha bounds, not automatic proxy generation. Preserve the original oak baseline.
  const subjects={tree:{label:"정원 나무",frame:frame("oak"),width:64,height:96,originY:1,volumeHeight:96},
    lantern:{label:"정원 가로등",frame:frame("lantern"),width:32,height:96,originY:1,volumeHeight:90},
    crate:{label:"정원 상자",frame:frame("crate"),width:64,height:64,originY:30/32,volumeHeight:56}};
  await writeFile(new URL("spatial/shadow-assets.json",output),JSON.stringify({source:"apps/studio/public/assets/lantern-garden",atlasSha256:sha(atlas),frames:manifest.frames,models,subjects},null,2)+"\n");
}
