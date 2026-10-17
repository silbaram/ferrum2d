import { readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
// A self-authored static fixture; the existing tree remains byte-for-byte unchanged.
const file=await readFile(new URL("../../examples/data-scene-native/assets/tree.glb",import.meta.url));
const size=file.readUInt32LE(12), doc=JSON.parse(file.subarray(20,20+size));
const chunks=[file.subarray(28+size)]; let offset=chunks[0].length;
function append(bytes) {
  const data=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength), padded=Buffer.alloc((data.length+3)&~3);data.copy(padded);
  doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:data.length});chunks.push(padded);offset+=padded.length;return doc.bufferViews.length-1;
}
function crc(bytes){let v=0xffffffff;for(const b of bytes){v^=b;for(let i=0;i<8;i++)v=(v>>>1)^(0xedb88320&-(v&1));}return(v^0xffffffff)>>>0;}
function chunk(name,data){const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(name,4);data.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,-4)),out.length-4);return out;}
function image(rgba, second=rgba) {
  const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;
  const row=Buffer.from([0,...rgba,...second]),png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(Buffer.concat([row,row]))),chunk("IEND",Buffer.alloc(0))]);
  doc.images.push({bufferView:append(png),mimeType:"image/png"});doc.textures.push({source:doc.images.length-1,sampler:0});return doc.textures.length-1;
}
const normal=image([180,180,231,0]),emission=image([200,80,20,0],[20,80,200,0]);
const tangent=Float32Array.from(Array.from({length:4},()=>[1,0,0,-1]).flat());
doc.accessors.push({bufferView:append(tangent),componentType:5126,count:4,type:"VEC4"});
doc.meshes[1].primitives[0].attributes.TANGENT=doc.accessors.length-1;
doc.materials[1].normalTexture={index:normal,scale:1};doc.materials[1].emissiveTexture={index:emission};doc.materials[1].emissiveFactor=[.4,.6,.8];
doc.asset.generator="Ferrum2D deterministic normal/emissive regression fixture";doc.buffers[0].byteLength=offset;
const text=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc((text.length+3)&~3,32);text.copy(json);
const bin=Buffer.concat(chunks),glb=Buffer.alloc(28+json.length+bin.length);
[0x46546c67,2,glb.length,json.length,0x4e4f534a].forEach((v,i)=>glb.writeUInt32LE(v,i*4));json.copy(glb,20);
glb.writeUInt32LE(bin.length,20+json.length);glb.writeUInt32LE(0x004e4942,24+json.length);bin.copy(glb,28+json.length);
await writeFile(new URL("../../examples/data-scene-native/assets/tree-material.glb",import.meta.url),glb);
