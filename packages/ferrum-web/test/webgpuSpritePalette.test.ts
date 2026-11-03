import { equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { WebGpuSpritePalette } from "../src/webgpuSpritePalette.js";
import { resolveSpritePalettes } from "../src/spritePalette.js";
import { webGpuResources } from "../src/webgpuResources.js";

test("WebGPU palette buffers are distinct, reused for equivalent providers, and replaced atomically",()=>{
  Object.assign(globalThis,{GPUBufferUsage:{UNIFORM:64,COPY_DST:8},GPUShaderStage:{FRAGMENT:2}});
  const writes:{buffer:unknown;bytes:Uint8Array}[]=[], buffers:{destroyed:boolean;destroy():void}[]=[];
  let fail=false;
  const device={
    createBindGroupLayout:()=>({}),
    createBindGroup:(descriptor:unknown)=>{if(fail)throw Error("allocation failed");return descriptor;},
    createBuffer:()=>{const buffer={destroyed:false,destroy(){this.destroyed=true;}};buffers.push(buffer);return buffer;},
    queue:{writeBuffer:(buffer:unknown,_offset:number,bytes:ArrayBuffer)=>{writes.push({buffer,bytes:new Uint8Array(bytes.slice(0))});}},
  } as unknown as GPUDevice;
  const input=(to="#00ff00")=>[{textureId:1,colors:[{from:"#ff0000",to}]},{textureId:2,colors:[{from:"#ff0000",to:"#0000ff"}]}];
  const palette=new WebGpuSpritePalette(device);
  palette.configure(resolveSpritePalettes(input())!);
  equal(writes.length,2);equal(writes[0].buffer===writes[1].buffer,false);
  equal(new Float32Array(writes[0].bytes.buffer)[129],1);equal(new Float32Array(writes[1].bytes.buffer)[130],1);
  equal(new Uint32Array(writes[0].bytes.buffer)[256],1);
  const original=palette.group(1);
  palette.configure(resolveSpritePalettes(input())!);equal(writes.length,2);equal(palette.group(1),original);
  fail=true;throws(()=>palette.configure(resolveSpritePalettes(input("#ffffff"))!),/allocation/);
  equal(palette.group(1),original);equal(buffers[2].destroyed,true);equal(buffers[0].destroyed,false);
  equal(webGpuResources(device).stats().bufferCount,2);
  fail=false;palette.configure(resolveSpritePalettes(input("#ffff00"))!);
  equal(buffers[0].destroyed,true);equal(buffers[1].destroyed,true);equal(palette.group(1)===original,false);
  equal(webGpuResources(device).stats().bufferCount,2);
  palette.destroy();palette.destroy();equal(palette.group(1),undefined);equal(webGpuResources(device).stats().bufferCount,0);
});
