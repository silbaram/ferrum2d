import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { normalizeLightingScene } from "../src/lighting.js";
import { WebGpuLightingPass } from "../src/webgpuLightingPass.js";

interface CapturedWriteBufferCall {
  buffer: GPUBuffer;
  bufferOffset: number;
  dataWasView: boolean;
  values: number[];
  dataOffset: number;
  size: number | undefined;
}

class FakeGpuBuffer {
  destroyed = false;

  constructor(readonly size: number) {}

  destroy(): void {
    this.destroyed = true;
  }
}

class FakeGpuQueue {
  readonly writeBufferCalls: CapturedWriteBufferCall[] = [];
  failBuffer?: GPUBuffer;
  failAtLeastBytes?: number;
  submitCount = 0;

  writeBuffer(
    buffer: GPUBuffer,
    bufferOffset: number,
    data: ArrayBufferLike | ArrayBufferView<ArrayBufferLike>,
    dataOffset = 0,
    size?: number,
  ): void {
    if (buffer === this.failBuffer) throw Error("injected shadow write failure");
    if (this.failAtLeastBytes !== undefined && (size ?? 0) >= this.failAtLeastBytes) throw Error("injected grown shadow write failure");
    const sourceBuffer = ArrayBuffer.isView(data) ? data.buffer : data;
    const sourceByteOffset = ArrayBuffer.isView(data) ? data.byteOffset + dataOffset : dataOffset;
    const byteLength = size ?? sourceBuffer.byteLength - sourceByteOffset;
    this.writeBufferCalls.push({
      buffer,
      bufferOffset,
      dataWasView: ArrayBuffer.isView(data),
      dataOffset,
      size,
      values: Array.from(new Float32Array(sourceBuffer as ArrayBuffer, sourceByteOffset, byteLength / 4)),
    });
  }

  submit(): void {
    this.submitCount += 1;
  }
}

class FakeGpuDevice {
  readonly queue = new FakeGpuQueue();
  readonly buffers: FakeGpuBuffer[] = [];
  readonly renderPipelines: GPURenderPipeline[] = [];
  commandEncoderCreated = false;
  readonly limits={maxTextureDimension2D:8192};
  readonly textures:FakeGpuBuffer[]=[];
  readonly descriptors:GPURenderPipelineDescriptor[]=[];
  failGroup=false;
  createTexture():GPUTexture {const t=new FakeGpuBuffer(0);this.textures.push(t);return Object.assign(t,{createView(){return {} as GPUTextureView;}}) as unknown as GPUTexture;}
  createBindGroupLayout():GPUBindGroupLayout{return {} as GPUBindGroupLayout;}
  createPipelineLayout():GPUPipelineLayout{return {} as GPUPipelineLayout;}
  createBindGroup():GPUBindGroup{if(this.failGroup)throw Error("injected bind group failure");return {} as GPUBindGroup;}

  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer {
    const buffer = new FakeGpuBuffer(descriptor.size);
    this.buffers.push(buffer);
    return buffer as unknown as GPUBuffer;
  }

  createShaderModule(): GPUShaderModule {
    return {} as GPUShaderModule;
  }

  createRenderPipeline(descriptor:GPURenderPipelineDescriptor): GPURenderPipeline {
    this.descriptors.push(descriptor);
    const pipeline = { id: this.renderPipelines.length,getBindGroupLayout(){return {} as GPUBindGroupLayout;} };
    this.renderPipelines.push(pipeline as unknown as GPURenderPipeline);
    return pipeline as unknown as GPURenderPipeline;
  }

  createCommandEncoder(): GPUCommandEncoder {
    this.commandEncoderCreated = true;
    throw new Error("WebGpuLightingPass must draw into the caller-owned render pass.");
  }
}

class FakeRenderPass {
  readonly drawCalls: Array<{
    vertexCount: number;
    instanceCount: number;
    firstVertex: number;
    firstInstance: number;
  }> = [];
  readonly vertexBuffers: GPUBuffer[] = [];

  ended=false;
  end():void {equal(this.ended,false);this.ended=true;}
  setPipeline(): void {}

  setBindGroup(): void {}

  setVertexBuffer(_slot: number, buffer: GPUBuffer): void {
    this.vertexBuffers.push(buffer);
  }

  draw(vertexCount: number, instanceCount: number, firstVertex = 0, firstInstance = 0): void {
    this.drawCalls.push({ vertexCount, instanceCount, firstVertex, firstInstance });
  }
}

test("WebGpuLightingPass records lighting draws into the caller render pass with one lighting upload", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  const pass = new WebGpuLightingPass(
    device as unknown as GPUDevice,
    "rgba8unorm",
    {} as GPUPipelineLayout,
    {} as GPUBindGroup,
  );
  const renderPass = new FakeRenderPass();
  const scene = normalizeLightingScene({
    ambient: [0.1, 0.2, 0.3, 0.4],
    pointLights: [{
      x: 64,
      y: 64,
      radius: 80,
      color: [1, 0.5, 0.25, 1],
      intensity: 0.5,
      falloff: 2,
    }],
    tileOccluders: [{ x: 100, y: 60, width: 16, height: 16 }],
    shadows: { enabled: true, color: [0, 0, 0, 0.5], projectionLength: 128 },
    debug: { tileOccluders: true, color: [1, 0, 0, 0.25] },
  });

  const encoder=new FakeEncoder();
  const stats = pass.draw(renderPass as unknown as GPURenderPassEncoder, scene, 200, 120,undefined,target(encoder));

  deepEqual(stats, {
    drawCalls: 4,
    pointLightCount: 1,
    tileOccluderCount: 1,
    shadowDrawCalls: 1,
    shadowCasterCount: 1,
    shadowGeometryUploadBytes: 240,
    shadowGeometryVertexCount: 6,
    shadowGeometryCacheHit: false,
    passEnded:true,
  });
  equal(device.commandEncoderCreated, false);
  equal(device.queue.submitCount, 0);
  equal(renderPass.ended,true);equal(encoder.passes.length,2);
  const all=[renderPass,...encoder.passes];
  equal(all.flatMap(p=>p.drawCalls).length,4);
  deepEqual(all.flatMap(p=>p.drawCalls).map(({ instanceCount, firstInstance }) => ({ instanceCount, firstInstance })), [
    { instanceCount: 1, firstInstance: 0 },
    { instanceCount: 1, firstInstance: 0 },
    { instanceCount: 1, firstInstance: 1 },
    { instanceCount: 1, firstInstance: 2 },
  ]);
  equal(renderPass.vertexBuffers[0],encoder.passes[1]?.vertexBuffers[0]);
  equal(renderPass.vertexBuffers[0],encoder.passes[1]?.vertexBuffers[1]);
  equal(device.queue.writeBufferCalls.length, 3);
  equal(device.queue.writeBufferCalls.every((call) => !call.dataWasView), true);
  deepEqual(device.queue.writeBufferCalls[0]?.values, Array.from(new Float32Array([
    0, 0, 200, 120, 0.1, 0.2, 0.3, 0.4, 0, 0, 1, 1, 0, 65535,
    -16, -16, 160, 160, 0.5, 0.25, 0.125, 1, 64, 64, 80, 2, 1, 65535,
    100, 60, 16, 16, 1, 0, 0, 0.25, 0, 0, 1, 1, 0, 65535,
  ])));
});

test("WebGpuLightingPass skips disabled scenes without GPU writes", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  const pass = new WebGpuLightingPass(
    device as unknown as GPUDevice,
    "rgba8unorm",
    {} as GPUPipelineLayout,
    {} as GPUBindGroup,
  );
  const renderPass = new FakeRenderPass();

  const stats = pass.draw(renderPass as unknown as GPURenderPassEncoder, normalizeLightingScene(false), 200, 120);

  deepEqual(stats, {
    drawCalls: 0,
    pointLightCount: 0,
    tileOccluderCount: 0,
    shadowDrawCalls: 0,
    shadowCasterCount: 0,
  });
  equal(device.queue.writeBufferCalls.length, 0);
  equal(renderPass.drawCalls.length, 0);
});

test("WebGpuLightingPass grows owned buffers and destroys them idempotently", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  const pass = new WebGpuLightingPass(
    device as unknown as GPUDevice,
    "rgba8unorm",
    {} as GPUPipelineLayout,
    {} as GPUBindGroup,
  );
  const firstLightingBuffer = device.buffers[0];
  const firstShadowBuffer = device.buffers[1];
  const scene = normalizeLightingScene({
    ambient: [0, 0, 0, 0],
    pointLights: [
      { x: 0, y: 0, radius: 16 },
      { x: 32, y: 0, radius: 16 },
    ],
  });

  const stats = pass.draw(new FakeRenderPass() as unknown as GPURenderPassEncoder, scene, 200, 120);

  equal(stats.drawCalls, 1);
  equal(stats.pointLightCount, 2);
  equal(firstLightingBuffer?.destroyed, true);
  equal(firstShadowBuffer?.destroyed, false);
  equal(device.buffers.length, 3);
  pass.destroy();
  pass.destroy();
  equal(firstShadowBuffer?.destroyed, true);
  equal(device.buffers[2]?.destroyed, true);
});

function installWebGpuGlobals(): void {
  const globals = globalThis as typeof globalThis & {
    GPUBufferUsage?: typeof GPUBufferUsage;
  };
  Object.assign(globals,{GPUShaderStage:{VERTEX:1,FRAGMENT:2,COMPUTE:4},GPUTextureUsage:{RENDER_ATTACHMENT:16,TEXTURE_BINDING:4}});
  globals.GPUBufferUsage = {
    MAP_READ: 1,
    MAP_WRITE: 2,
    COPY_SRC: 4,
    COPY_DST: 8,
    INDEX: 16,
    VERTEX: 32,
    UNIFORM: 64,
    STORAGE: 128,
    INDIRECT: 256,
    QUERY_RESOLVE: 512,
  };
}

class FakeEncoder {
  readonly passes:FakeRenderPass[]=[];
  beginRenderPass():GPURenderPassEncoder {const pass=new FakeRenderPass();this.passes.push(pass);return pass as unknown as GPURenderPassEncoder;}
}
function target(encoder=new FakeEncoder(),width=240,height=120){return {encoder:encoder as unknown as GPUCommandEncoder,view:{} as GPUTextureView,width,height};}

test("WebGPU retains packed shadow writes across lights, invalidates encoded inputs and retries a failed write", () => {
  installWebGpuGlobals(); const device = new FakeGpuDevice();
  const pass = new WebGpuLightingPass(device as unknown as GPUDevice, "rgba8unorm", {} as GPUPipelineLayout, {} as GPUBindGroup);
  const scene = normalizeLightingScene({ ambient: [0,0,0,0], pointLights: [{ x: 80, y: 48, radius: 120 }, { x: 160, y: 48, radius: 120 }],
    tileOccluders: [{ x: 112, y: 24, width: 16, height: 16 }], shadows: true });
  const draw = (s = scene) => pass.draw(new FakeRenderPass() as unknown as GPURenderPassEncoder, s, 240, 120, undefined, target());
  const first = draw(); equal(first.shadowDrawCalls, 2); equal(first.shadowGeometryCacheHit, false); equal(first.shadowGeometryVertexCount! > 0, true);
  let shadow = device.queue.writeBufferCalls[1].buffer;
  const warm = draw(); equal(warm.shadowGeometryUploadBytes, 0); equal(warm.shadowGeometryCacheHit, true);
  equal(device.queue.writeBufferCalls.filter(call => call.buffer === shadow).length, 1);
  const larger = normalizeLightingScene({ ...scene, pointLights: [...scene.pointLights, ...scene.pointLights] });
  device.queue.failAtLeastBytes = first.shadowGeometryUploadBytes! + 1;
  throws(() => draw(larger), /injected/); device.queue.failAtLeastBytes = undefined;
  equal(draw().shadowGeometryUploadBytes! > 0, true);
  shadow = device.queue.writeBufferCalls[device.queue.writeBufferCalls.length - 2].buffer;
  equal(draw().shadowGeometryUploadBytes, 0);
  const tint = normalizeLightingScene({ ...scene, shadows: { ...scene.shadows, color: [0, 0, 0, .25] } });
  device.queue.failBuffer = shadow; throws(() => draw(tint), /injected/); device.queue.failBuffer = undefined;
  equal(draw(tint).shadowGeometryUploadBytes! > 0, true); equal(draw(tint).shadowGeometryUploadBytes, 0);
  const moved = normalizeLightingScene({ ...scene, pointLights: scene.pointLights.map((light, i) => ({ ...light, x: light.x + i + 1 })) });
  equal(draw(moved).shadowGeometryUploadBytes! > 0, true); equal(draw(moved).shadowGeometryUploadBytes, 0);
  const edited = normalizeLightingScene({ ...moved, tileOccluders: [{ ...scene.tileOccluders[0], x: 110 }] });
  equal(draw(edited).shadowGeometryUploadBytes! > 0, true);
  equal(draw(normalizeLightingScene({ ...edited, pointLights: [...edited.pointLights].reverse() })).shadowGeometryUploadBytes! > 0, true);
  pass.destroy();
});

test("WebGPU leaves larger legacy light lists uncached and reuploads when returning to a bounded list", () => {
  installWebGpuGlobals(); const device = new FakeGpuDevice();
  const pass = new WebGpuLightingPass(device as unknown as GPUDevice, "rgba8unorm", {} as GPUPipelineLayout, {} as GPUBindGroup);
  const scene = normalizeLightingScene({ pointLights: Array.from({ length: 33 }, () => ({ x: 80, y: 48, radius: 120 })),
    tileOccluders: [{ x: 112, y: 24, width: 16, height: 16 }], shadows: true });
  const draw = (s = scene) => pass.draw(new FakeRenderPass() as unknown as GPURenderPassEncoder, s, 240, 120, undefined, target());
  draw(); const warm = draw(); equal(warm.shadowDrawCalls, 33); equal(warm.shadowGeometryCacheHit, false); equal(warm.shadowGeometryUploadBytes! > 0, true);
  const small = normalizeLightingScene({ ...scene, pointLights: scene.pointLights.slice(0, 1) });
  equal(draw(small).shadowGeometryUploadBytes! > 0, true); equal(draw(small).shadowGeometryUploadBytes, 0);
  pass.destroy();
});

test("WebGPU reuses a single MAX mask and skips targets and passes when no geometry exists",()=>{
  installWebGpuGlobals();const device=new FakeGpuDevice();
  const pass=new WebGpuLightingPass(device as unknown as GPUDevice,"rgba8unorm",{} as GPUPipelineLayout,{} as GPUBindGroup);
  const scene=normalizeLightingScene({pointLights:[{x:80,y:48,radius:120},{x:160,y:48,radius:120}],tileOccluders:[{x:112,y:24,width:16,height:16}],shadows:true});
  const encoder=new FakeEncoder();
  const draw=(s=scene,t=target(encoder))=>pass.draw(new FakeRenderPass() as unknown as GPURenderPassEncoder,s,240,120,undefined,t);
  const first=draw();equal(first.shadowDrawCalls,2);equal(first.shadowCasterCount,2);equal(device.textures.length,1);equal(encoder.passes.length,4);
  const mask=device.descriptors.find(d=>d.fragment?.targets?.[0]?.format==='r8unorm');equal(mask?.fragment?.targets?.[0]?.blend?.color.operation,'max');
  draw();equal(device.textures.length,1);
  draw(scene,target(encoder,480,240));equal(device.textures.length,2);equal(device.textures[0]?.destroyed,true);
  draw(normalizeLightingScene(false));equal(device.textures[1]?.destroyed,true);
  const before=encoder.passes.length;draw(normalizeLightingScene({pointLights:scene.pointLights}));equal(encoder.passes.length,before);equal(device.textures.length,2);
  pass.destroy();pass.destroy();equal(device.buffers.every(b=>b.destroyed),true);
});

test("WebGPU mask replacement failure preserves previous resources and cleans staged allocations",()=>{
  installWebGpuGlobals();const device=new FakeGpuDevice();
  const pass=new WebGpuLightingPass(device as unknown as GPUDevice,"rgba8unorm",{} as GPUPipelineLayout,{} as GPUBindGroup);
  const scene=normalizeLightingScene({pointLights:[{x:80,y:48,radius:120}],tileOccluders:[{x:112,y:24,width:16,height:16}],shadows:true});
  const draw=(width:number)=>pass.draw(new FakeRenderPass() as unknown as GPURenderPassEncoder,scene,240,120,undefined,target(new FakeEncoder(),width));
  draw(240);device.failGroup=true;throws(()=>draw(480),/injected/);
  equal(device.textures[0]?.destroyed,false);equal(device.textures[1]?.destroyed,true);equal(device.buffers[device.buffers.length-1]?.destroyed,true);
  device.failGroup=false;draw(240);equal(device.textures.length,2);pass.destroy();equal(device.textures.every(t=>t.destroyed),true);
});

test("WebGPU light channels remain per-instance and distinguish receiver texture presence",()=>{
 installWebGpuGlobals();const device=new FakeGpuDevice(),pass=new WebGpuLightingPass(device as unknown as GPUDevice,"rgba16float",{} as GPUPipelineLayout,{} as GPUBindGroup,true,false,false,true);
 const scene=normalizeLightingScene({profile:"lit",ambientIrradiance:[0,0,0],directionalLight:{directionX:1,directionY:0,intensity:1,lightMask:1,shadowMask:8},pointLights:[{x:0,y:0,radius:10,lightMask:0,shadowMask:0,spot:{directionX:1,directionY:0,angleDegrees:90}},{x:1,y:1,radius:10}]});
 pass.draw(new FakeRenderPass() as unknown as GPURenderPassEncoder,scene,100,100,{layout:{} as GPUBindGroupLayout,bindGroup:{} as GPUBindGroup,hasReceiverMasks:true});
 const values=device.queue.writeBufferCalls[0].values;equal(values.length,54);deepEqual([values[13],values[31],values[49]],[65536+1+(8<<8),65536,131071]);
 deepEqual(values.slice(14,18),[0,0,-2,-2]);deepEqual(values.slice(32,36),[1,0,Math.fround(Math.SQRT1_2),Math.fround(Math.SQRT1_2)]);deepEqual(values.slice(50,54),[0,0,-2,-2]);pass.destroy();
});
