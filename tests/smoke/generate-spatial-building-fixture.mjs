// Self-authored, deterministic open building; not a Blender-export acceptance asset.
import { writeFile } from "node:fs/promises";
const binary = [], bufferViews = [], accessors = [];
let offset = 0;
function attribute(values, type, width, indexed = false) {
  const typed = indexed ? Uint16Array.from(values) : Float32Array.from(values);
  const bytes = Buffer.from(typed.buffer), padded = Buffer.alloc((bytes.length + 3) & ~3);
  bytes.copy(padded);
  const bufferView = bufferViews.length;
  bufferViews.push({ buffer:0, byteOffset:offset, byteLength:bytes.length });
  binary.push(padded); offset += padded.length;
  const a = { bufferView, componentType:indexed?5123:5126, count:values.length/width, type };
  if(type === "VEC3") {
    a.min = [0,1,2].map(k=>Math.min(...values.filter((_,i)=>i%3===k)));
    a.max = [0,1,2].map(k=>Math.max(...values.filter((_,i)=>i%3===k)));
  }
  accessors.push(a); return accessors.length-1;
}
function mesh(quads, material) {
  const position=[], normal=[], indices=[];
  for(const q of quads) {
    const a=q[1].map((v,i)=>v-q[0][i]), b=q[2].map((v,i)=>v-q[0][i]);
    const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]], length=Math.hypot(...n);
    const start=position.length/3;position.push(...q.flat());normal.push(...Array.from({length:4},()=>n.map(v=>v/length)).flat());
    indices.push(start,start+1,start+2,start,start+2,start+3);
  }
  return {primitives:[{attributes:{POSITION:attribute(position,"VEC3",3),NORMAL:attribute(normal,"VEC3",3)},indices:attribute(indices,"SCALAR",1,true),material}]};
}
const cube=mesh([
  [[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]],
  [[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]],
  [[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]],
  [[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]],
  [[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5]],
  [[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]],
],0);
const ramp=mesh([
  [[-16,0,-32],[16,0,-32],[16,32,-64],[-16,32,-64]],
  [[-16,-4,-64],[16,-4,-64],[16,-4,-32],[-16,-4,-32]],
  [[-16,-4,-32],[16,-4,-32],[16,0,-32],[-16,0,-32]],
  [[16,-4,-64],[-16,-4,-64],[-16,32,-64],[16,32,-64]],
  [[-16,-4,-64],[-16,-4,-32],[-16,0,-32],[-16,32,-64]],
  [[16,-4,-32],[16,-4,-64],[16,32,-64],[16,0,-32]],
],1);
const doc={asset:{version:"2.0",generator:"Ferrum2D deterministic building integration fixture"},scene:0,scenes:[{nodes:[0]}],
  nodes:[
    {name:"building",children:[1,2]},
    {name:"floors",children:[3,4,5]},
    {name:"upper-walls",translation:[0,32,-64],children:[6,7,8,9,10]},
    {name:"lower-floor",mesh:0,translation:[0,-2,-48],scale:[128,4,192]},
    {name:"ramp",mesh:1},
    {name:"upper-floor",mesh:0,translation:[0,28,-96],scale:[96,8,64]},
    {name:"wall-left",mesh:0,translation:[-46,24,-32],scale:[4,48,64]},
    {name:"wall-right",mesh:0,translation:[46,24,-32],scale:[4,48,64]},
    {name:"wall-back",mesh:0,translation:[0,24,-62],scale:[96,48,4]},
    {name:"wall-front-left",mesh:0,translation:[-30,24,-2],scale:[36,48,4]},
    {name:"wall-front-right",mesh:0,translation:[30,24,-2],scale:[36,48,4]},
  ],meshes:[cube,ramp],materials:[{pbrMetallicRoughness:{baseColorFactor:[.18,.3,.46,1]}},{pbrMetallicRoughness:{baseColorFactor:[.5,.32,.16,1]}}],
  accessors,bufferViews,buffers:[{byteLength:offset}]};
const text=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc((text.length+3)&~3,32);text.copy(json);
const bin=Buffer.concat(binary),glb=Buffer.alloc(28+json.length+bin.length);
[0x46546c67,2,glb.length,json.length,0x4e4f534a].forEach((v,i)=>glb.writeUInt32LE(v,i*4));json.copy(glb,20);
glb.writeUInt32LE(bin.length,20+json.length);glb.writeUInt32LE(0x004e4942,24+json.length);bin.copy(glb,28+json.length);
await writeFile(new URL("../../examples/data-scene-native/assets/building.glb",import.meta.url),glb);
