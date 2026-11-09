/** Original low-poly volumes, sized to the garden character and oak sprites. */
export function shadowComparisonModel(kind) {
  const positions=[],normals=[],uv=[];
  const box=(x,y,z,w,h,d)=>{
    const faces=[[[1,0,0],[[1,0,0],[1,1,0],[1,1,1],[1,0,1]]],
      [[-1,0,0],[[0,0,1],[0,1,1],[0,1,0],[0,0,0]]],
      [[0,1,0],[[0,1,1],[1,1,1],[1,1,0],[0,1,0]]],
      [[0,-1,0],[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]],
      [[0,0,1],[[1,0,1],[1,1,1],[0,1,1],[0,0,1]]],
      [[0,0,-1],[[0,0,0],[0,1,0],[1,1,0],[1,0,0]]]];
    for(const [normal,vertices]of faces)for(const i of [0,1,2,0,2,3]){
      const v=vertices[i];positions.push(x+(v[0]-.5)*w,y+v[1]*h,z+(v[2]-.5)*d);normals.push(...normal);uv.push(v[0],v[1]);
    }
  };
  if(kind==="actor"){
    box(-4,0,0,6,15,7);box(4,0,0,6,15,7);box(0,14,0,15,20,9);
    box(-10,16,0,5,17,7);box(10,16,0,5,17,7);box(0,34,0,17,14,13);
  }else if(kind==="tree"){
    box(0,0,0,9,58,9);box(0,42,0,40,34,34);box(0,64,0,50,22,42);box(0,82,0,28,14,26);
  }else throw Error(`Unknown shadow volume: ${kind}`);
  const arrays=[positions,normals,uv].map(values=>Buffer.from(new Float32Array(values).buffer));
  let offset=0;
  const bufferViews=arrays.map(bytes=>{const view={buffer:0,byteOffset:offset,byteLength:bytes.length};offset+=bytes.length;return view;});
  const min=[0,1,2].map(i=>Math.min(...positions.filter((_,n)=>n%3===i))),max=[0,1,2].map(i=>Math.max(...positions.filter((_,n)=>n%3===i)));
  const doc={asset:{version:"2.0",generator:"Ferrum2D garden shadow volumes"},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},material:0}]}],
    materials:[{name:`${kind} shadow volume`,pbrMetallicRoughness:{baseColorFactor:[.5,.58,.65,1],metallicFactor:0,roughnessFactor:1}}],
    buffers:[{byteLength:offset}],bufferViews,accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:"VEC3",min,max},
      {bufferView:1,componentType:5126,count:normals.length/3,type:"VEC3"},{bufferView:2,componentType:5126,count:uv.length/2,type:"VEC2"}]};
  const raw=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc((raw.length+3)&~3,32);raw.copy(json);
  const bin=Buffer.concat(arrays),glb=Buffer.alloc(28+json.length+bin.length);
  [0x46546c67,2,glb.length,json.length,0x4e4f534a].forEach((v,i)=>glb.writeUInt32LE(v,i*4));json.copy(glb,20);
  glb.writeUInt32LE(bin.length,20+json.length);glb.writeUInt32LE(0x004e4942,24+json.length);bin.copy(glb,28+json.length);return glb;
}
