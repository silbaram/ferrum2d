// Deterministic, self-authored test geometry and PNG bytes; no external art input.
import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, bytes) {
  const out = Buffer.alloc(12 + bytes.length);
  out.writeUInt32BE(bytes.length, 0);
  out.write(type, 4, 4, "ascii");
  bytes.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + bytes.length)), 8 + bytes.length);
  return out;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(8, 0); header.writeUInt32BE(8, 4); header[8] = 8; header[9] = 6;
const rgba = Buffer.alloc(8 * 33);
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
  const alpha = (y === 3 || y === 4) ? (x === 3 || x === 4 ? 0 : x === 1 || x === 2 ? 128 : 255) : 255;
  const color = x === 0 && y === 0 ? [200,40,20] : x === 7 && y === 7 ? [20,40,200] : [32,180,48];
  rgba.set([...color, alpha], y * 33 + 1 + x * 4);
}
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(rgba)), pngChunk("IEND", Buffer.alloc(0))]);
const binary = [], bufferViews = [], accessors = [];
let offset = 0;
function append(data) {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const padded = Buffer.alloc((bytes.length + 3) & ~3); bytes.copy(padded);
  const index = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
  binary.push(padded); offset += padded.length;
  return index;
}
function attribute(values, type, width, indices = false) {
  const data = indices ? Uint16Array.from(values) : Float32Array.from(values);
  const a = { bufferView: append(data), componentType: indices ? 5123 : 5126, count: values.length / width, type };
  if (type === "VEC3") {
    a.min = [0,1,2].map(k => Math.min(...values.filter((_, i) => i % 3 === k)));
    a.max = [0,1,2].map(k => Math.max(...values.filter((_, i) => i % 3 === k)));
  }
  accessors.push(a); return accessors.length - 1;
}
function primitive(quads, material) {
  const position = [], normal = [], uv = [], indices = [];
  for (const [vertices, n] of quads) {
    const start = position.length / 3;
    position.push(...vertices.flat()); normal.push(...Array.from({length:4},()=>n).flat());
    uv.push(0,1,1,1,1,0,0,0); indices.push(start,start+1,start+2,start,start+2,start+3);
  }
  return { attributes: { POSITION: attribute(position,"VEC3",3), NORMAL: attribute(normal,"VEC3",3), TEXCOORD_0: attribute(uv,"VEC2",2) }, indices: attribute(indices,"SCALAR",1,true), material };
}
const trunk = primitive([
  [[[-4,0,4],[4,0,4],[4,40,4],[-4,40,4]],[0,0,1]],
  [[[4,0,-4],[-4,0,-4],[-4,40,-4],[4,40,-4]],[0,0,-1]],
  [[[4,0,4],[4,0,-4],[4,40,-4],[4,40,4]],[1,0,0]],
  [[[-4,0,-4],[-4,0,4],[-4,40,4],[-4,40,-4]],[-1,0,0]],
  [[[-4,40,4],[4,40,4],[4,40,-4],[-4,40,-4]],[0,1,0]],
  [[[-4,0,-4],[4,0,-4],[4,0,4],[-4,0,4]],[0,-1,0]],
],0);
const leaves = primitive([[[[-32,0,0],[32,0,0],[32,64,0],[-32,64,0]],[0,0,1]]],1);
const image = append(png);
const gltf = { asset: { version: "2.0", generator: "Ferrum2D deterministic tree regression fixture" }, scene:0, scenes:[{nodes:[0]}],
  nodes:[{children:[1,2]},{mesh:0},{mesh:1,translation:[0,32,0]}], meshes:[{primitives:[trunk]},{primitives:[leaves]}],
  materials:[{pbrMetallicRoughness:{baseColorFactor:[.35,.16,.05,1]}},{alphaMode:"MASK",alphaCutoff:.5,doubleSided:true,pbrMetallicRoughness:{baseColorTexture:{index:0}}}],
  textures:[{source:0,sampler:0}], samplers:[{minFilter:9728,magFilter:9728,wrapS:33071,wrapT:33071}], images:[{bufferView:image,mimeType:"image/png"}],
  buffers:[{byteLength:offset}], bufferViews, accessors };
const json = Buffer.from(JSON.stringify(gltf)), padded = Buffer.alloc((json.length+3)&~3,32); json.copy(padded);
const bin = Buffer.concat(binary), glb = Buffer.alloc(28+padded.length+bin.length);
[0x46546c67,2,glb.length,padded.length,0x4e4f534a].forEach((n,i)=>glb.writeUInt32LE(n,i*4)); padded.copy(glb,20);
glb.writeUInt32LE(bin.length,20+padded.length); glb.writeUInt32LE(0x004e4942,24+padded.length); bin.copy(glb,28+padded.length);
await writeFile(new URL("../../examples/data-scene-native/assets/tree.glb",import.meta.url),glb);
