// Self-authored, zero-thickness GLBs. Sample heights are evaluated independently
// from the renderer's transforms and shadow projection.
export function receiverSurface(kind) {
  const nx=kind==="curve"?16:1,nz=kind==="curve"?8:1;
  const nodeHeight=(x,z)=>kind==="curve"?64+.0015*x*x+.001*z*z:
    kind==="slope"?64+.2*x+.1*z:64+.01*x;
  const interpolateSquare=(v,min,step)=>{
    const a=min+Math.floor((v-min)/step)*step,b=a+step,t=(v-a)/step;
    return a*a*(1-t)+b*b*t;
  };
  const height=(x,z)=>kind==="curve"?64+.0015*interpolateSquare(x,-160,320/nx)+.001*interpolateSquare(z,-120,240/nz):nodeHeight(x,z);
  const positions=[],normals=[],uv=[];
  const triangle=(a,b,c)=>{
    const e=b.map((n,i)=>n-a[i]),f=c.map((n,i)=>n-a[i]),n=[e[1]*f[2]-e[2]*f[1],e[2]*f[0]-e[0]*f[2],e[0]*f[1]-e[1]*f[0]],length=Math.hypot(...n);
    for(const p of [a,b,c]){positions.push(...p);normals.push(...n.map(v=>v/length));uv.push((p[0]+160)/320,(p[2]+120)/240);}
  };
  for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){
    const x0=-160+ix*320/nx,x1=-160+(ix+1)*320/nx,z0=-120+iz*240/nz,z1=-120+(iz+1)*240/nz,
      point=(x,z)=>[x,nodeHeight(x,z),z],a=point(x0,z0),b=point(x0,z1),c=point(x1,z0),d=point(x1,z1);
    triangle(a,b,c);triangle(c,b,d);
  }
  const count=positions.length/3,arrays=[new Float32Array(positions),new Float32Array(normals),new Float32Array(uv),Uint32Array.from({length:count},(_,i)=>i)],
    binary=new Uint8Array(arrays.reduce((n,a)=>n+a.byteLength,0));
  let offset=0;const views=arrays.map((a,i)=>{const v={buffer:0,byteOffset:offset,byteLength:a.byteLength,target:i===3?34963:34962};binary.set(new Uint8Array(a.buffer),offset);offset+=a.byteLength;return v;});
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<positions.length;i++){min[i%3]=Math.min(min[i%3],positions[i]);max[i%3]=Math.max(max[i%3],positions[i]);}
  const json={asset:{version:"2.0",generator:"Ferrum2D shadow receiver regression"},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],
    materials:[{doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:0,roughnessFactor:1}}],
    buffers:[{byteLength:binary.byteLength}],bufferViews:views,
    accessors:[{bufferView:0,componentType:5126,count,type:"VEC3",min,max},{bufferView:1,componentType:5126,count,type:"VEC3"},{bufferView:2,componentType:5126,count,type:"VEC2"},{bufferView:3,componentType:5125,count,type:"SCALAR"}]},
    raw=new TextEncoder().encode(JSON.stringify(json)),padded=(raw.length+3)&~3,bytes=new ArrayBuffer(28+padded+binary.length),view=new DataView(bytes);
  [0x46546c67,2,bytes.byteLength,padded,0x4e4f534a].forEach((n,i)=>view.setUint32(i*4,n,true));
  new Uint8Array(bytes,20,padded).fill(32);new Uint8Array(bytes,20,raw.length).set(raw);
  view.setUint32(20+padded,binary.length,true);view.setUint32(24+padded,0x004e4942,true);new Uint8Array(bytes,28+padded).set(binary);
  return {bytes,height};
}
