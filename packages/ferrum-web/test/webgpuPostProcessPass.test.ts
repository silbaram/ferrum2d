import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { webGpuResources } from "../src/webgpuResources.js";
import {
  WebGpuPostProcessPass,
  resolveWebGpuPostProcessPasses,
} from "../src/webgpuPostProcessPass.js";

class FakeGpuBuffer {
  destroyed = false;

  destroy(): void {
    this.destroyed = true;
  }
}

class FakeGpuTexture {
  destroyed = false;
  constructor(readonly width = 16, readonly height = 8) {}
  destroy(): void { this.destroyed = true; }
  createView(): GPUTextureView {
    return { texture: this } as unknown as GPUTextureView;
  }
}

class FakeGpuQueue {
  writeBufferCount = 0;
  submitCount = 0;

  writeBuffer(): void {
    this.writeBufferCount += 1;
  }

  submit(): void {
    this.submitCount += 1;
  }
}

class FakeRenderPass {
  drawCount = 0;
  ended = false;

  setPipeline(): void {}

  setBindGroup(): void {}

  draw(): void {
    this.drawCount += 1;
  }

  end(): void {
    this.ended = true;
  }
}

class FakeCommandEncoder {
  readonly passes: FakeRenderPass[] = [];
  copies = 0;
  copyTextureToTexture(): void { this.copies++; }

  beginRenderPass(): GPURenderPassEncoder {
    const pass = new FakeRenderPass();
    this.passes.push(pass);
    return pass as unknown as GPURenderPassEncoder;
  }

  finish(): GPUCommandBuffer {
    return {} as GPUCommandBuffer;
  }
}

class FakeGpuDevice {
  readonly queue = new FakeGpuQueue();
  readonly buffers: FakeGpuBuffer[] = [];
  readonly encoders: FakeCommandEncoder[] = [];
  readonly textures: FakeGpuTexture[] = [];
  failGroup = false;
  failBuffer = false;
  createTexture(descriptor: GPUTextureDescriptor): GPUTexture {
    const size = descriptor.size as GPUExtent3DDict;
    const texture = new FakeGpuTexture(size.width, size.height);
    this.textures.push(texture);
    return texture as unknown as GPUTexture;
  }

  createBindGroupLayout(): GPUBindGroupLayout {
    return {} as GPUBindGroupLayout;
  }

  createPipelineLayout(): GPUPipelineLayout {
    return {} as GPUPipelineLayout;
  }

  createBuffer(): GPUBuffer {
    if (this.failBuffer) throw Error("buffer failure");
    const buffer = new FakeGpuBuffer();
    this.buffers.push(buffer);
    return buffer as unknown as GPUBuffer;
  }

  createBindGroup(): GPUBindGroup {
    if (this.failGroup) throw Error("group failure");
    return {} as GPUBindGroup;
  }

  createSampler(): GPUSampler { return {} as GPUSampler; }

  createShaderModule(): GPUShaderModule {
    return {} as GPUShaderModule;
  }

  createRenderPipeline(): GPURenderPipeline {
    return { getBindGroupLayout: () => ({}) } as GPURenderPipeline;
  }

  createCommandEncoder(): GPUCommandEncoder {
    const encoder = new FakeCommandEncoder();
    this.encoders.push(encoder);
    return encoder as unknown as GPUCommandEncoder;
  }
}

class FakeGpuCanvasContext {
  getCurrentTexture(): GPUTexture {
    return new FakeGpuTexture() as unknown as GPUTexture;
  }
}

test("resolveWebGpuPostProcessPasses accepts every validated effect and preserves order", () => {
  const fade = resolveWebGpuPostProcessPasses({ opacity: 0.5 });
  equal(fade.length, 1);
  equal(fade[0]?.kind, "fade");

  deepEqual(resolveWebGpuPostProcessPasses({bloom:{},crt:{},vignette:{},glitch:{},pixelArt:{}}).map(pass=>pass.kind),["bloom","crt","vignette","glitch","pixelArt"]);
  throwsWithMessage(()=>resolveWebGpuPostProcessPasses({bloom:{threshold:2}}),/threshold/);
});

test("WebGpuPostProcessPass draws only visible fade passes", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  const context = new FakeGpuCanvasContext();
  const pass = new WebGpuPostProcessPass(
    device as unknown as GPUDevice,
    () => (context as unknown as GPUCanvasContext).getCurrentTexture(),
    "rgba8unorm",
  );

  pass.setPostProcess([
    { kind: "fade", color: [0, 0, 0, 0] },
    { kind: "fade", color: [0.1, 0.2, 0.3, 0.4] },
  ]);
  const stats = pass.drawPasses();

  equal(stats.drawCalls, 1);
  equal(stats.passCount, 1);
  equal(device.queue.writeBufferCount, 1);
  equal(device.queue.submitCount, 1);
  equal(device.encoders.length, 1);
  equal(device.encoders[0]?.passes[0]?.drawCount, 1);
  equal(device.encoders[0]?.passes[0]?.ended, true);
  pass.destroy();
  equal(device.buffers[0]?.destroyed, true);
});

function installWebGpuGlobals(): void {
  const globals = globalThis as typeof globalThis & {
    GPUBufferUsage?: typeof GPUBufferUsage;
    GPUShaderStage?: typeof GPUShaderStage;
    GPUTextureUsage?: typeof GPUTextureUsage;
  };
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
  globals.GPUShaderStage = {
    VERTEX: 1,
    FRAGMENT: 2,
    COMPUTE: 4,
  };
  globals.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
}

test("WebGPU pixelArt preserves pass order, reuses copies, rejects invalid updates and releases on disable", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  let texture = new FakeGpuTexture();
  const pass = new WebGpuPostProcessPass(device as unknown as GPUDevice, () => texture as unknown as GPUTexture, "rgba8unorm");
  equal(device.textures.length, 0);
  pass.setPostProcess([{ opacity: 0.5 }, { kind: "pixelArt", levels: 4 }, { opacity: 0.2 }]);
  deepEqual(pass.drawPasses(), { drawCalls: 3, passCount: 3 });
  deepEqual(device.encoders.map(encoder => encoder.copies), [0, 1, 0]);
  for (let i = 0; i < 3; i++) {
    pass.setPostProcess({ kind: "pixelArt", levels: 4 });
    pass.drawPasses();
  }
  equal(device.textures.length, 1);
  equal(device.buffers.length, 2);
  throws(() => pass.setPostProcess([{ kind: "pixelArt" }, { kind: "bloom", threshold: 2 }]), /threshold/);
  deepEqual(pass.drawPasses(), { drawCalls: 1, passCount: 1 });
  texture = new FakeGpuTexture(32, 16);
  device.failGroup = true;
  throws(() => pass.drawPasses(), /group failure/);
  equal(device.textures[0]?.destroyed, false);
  equal(device.textures[1]?.destroyed, true);
  device.failGroup = false;
  pass.drawPasses();
  equal(device.textures[0]?.destroyed, true);
  pass.setPostProcess(false);
  deepEqual(pass.drawPasses(), { drawCalls: 0, passCount: 0 });
  ok(device.textures.every(target => target.destroyed));
  equal(device.buffers[1]?.destroyed, true);
  pass.destroy();
  pass.destroy();
  ok(device.buffers.every(buffer => buffer.destroyed));
});

test("failed pixelArt activation releases its pipeline and preserves the active fade", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice();
  const nativeDevice = device as unknown as GPUDevice;
  const texture = new FakeGpuTexture() as unknown as GPUTexture;
  const pass = new WebGpuPostProcessPass(nativeDevice, () => texture, "rgba8unorm", { opacity: 0.25 });
  const owner = webGpuResources(nativeDevice);
  const baseline = owner.stats();
  device.failBuffer = true;
  throws(() => pass.setPostProcess({ kind: "pixelArt" }), /buffer failure/);
  deepEqual(owner.stats(), baseline);
  deepEqual(pass.drawPasses(), { drawCalls: 1, passCount: 1 });
  equal(device.encoders[0]?.copies, 0);
  device.failBuffer = false;
  pass.setPostProcess({ kind: "pixelArt" });
  deepEqual(pass.drawPasses(), { drawCalls: 1, passCount: 1 });
  equal(device.encoders[1]?.copies, 1);
  pass.destroy();
  equal(owner.stats().bufferCount, 0);
  equal(owner.stats().textureCount, 0);
  equal(owner.stats().programCount, 0);
});

function throwsWithMessage(run: () => void, expected: RegExp): void {
  try {
    run();
  } catch (error) {
    ok(expected.test(error instanceof Error ? error.message : String(error)));
    return;
  }
  throw new Error(`Expected callback to throw ${expected}.`);
}

test("all sampled WebGPU effects share one target and retain their pass order/settings",()=>{
  installWebGpuGlobals();const device=new FakeGpuDevice(),writes:number[][]=[];
  const queue=device.queue as unknown as GPUQueue;
  queue.writeBuffer=(_buffer,_offset,data)=>{writes.push(Array.from(data as unknown as Float32Array));};
  const target=new FakeGpuTexture(31,23),pass=new WebGpuPostProcessPass(device as unknown as GPUDevice,()=>target as unknown as GPUTexture,"rgba8unorm");
  const settings=[{kind:"bloom",threshold:1,intensity:.5,radius:2},{kind:"crt",curvature:.1},{kind:"vignette",radius:0,color:[1,0,0,.5]},{kind:"glitch",seed:13},{kind:"pixelArt",levels:4}] as const;
  pass.setPostProcess(settings);deepEqual(pass.drawPasses(),{drawCalls:5,passCount:5});
  deepEqual(writes.map(v=>v[8]),[2,3,4,5,6]);deepEqual(writes[0]?.slice(0,3),[1,.5,2]);equal(writes[2]?.[4],1);equal(writes[2]?.[7],.5);equal(writes[3]?.[2],13);
  for(let i=0;i<5;i++){pass.setPostProcess(settings);pass.drawPasses();}
  equal(device.textures.length,1);equal(device.buffers.length,2);ok(device.encoders.every(e=>e.copies===1));
  equal(device.queue.submitCount,30);pass.setPostProcess(false);pass.destroy();
  ok(device.buffers.every(b=>b.destroyed));ok(device.textures.every(t=>t.destroyed));
});

test("constructor failure releases fade resources before ownership can escape",()=>{
  installWebGpuGlobals();const device=new FakeGpuDevice();device.failGroup=true;
  const native=device as unknown as GPUDevice,owner=webGpuResources(native),before=owner.stats();
  throws(()=>new WebGpuPostProcessPass(native,()=>new FakeGpuTexture() as unknown as GPUTexture,"rgba8unorm"),/group failure/);
  deepEqual(owner.stats(),before);
});

test("Float32 overflow updates preserve the active stack and its resource ownership", () => {
  installWebGpuGlobals();
  const device = new FakeGpuDevice(), native = device as unknown as GPUDevice;
  const pass = new WebGpuPostProcessPass(native, () => new FakeGpuTexture() as unknown as GPUTexture,
    "rgba8unorm", [{ kind: "pixelArt", levels: 4 }, { opacity: .25 }]);
  const owner = webGpuResources(native);
  const before = owner.stats();
  for (const invalid of [
    { kind: "crt", curvature: 1e100 },
    { kind: "glitch", seed: -1e100 },
    { enabled: false, bloom: { intensity: 0, radius: 1e100 } },
    { enabled: false, glitch: { intensity: 0, chromaticAberration: 0, seed: 1e100 } },
  ] as const) {
    throws(() => pass.setPostProcess(invalid), /Float32/);
    deepEqual(owner.stats(), before);
  }
  deepEqual(pass.drawPasses(), { drawCalls: 2, passCount: 2 });
  deepEqual(device.encoders.map(encoder => encoder.copies), [1, 0]);
  pass.destroy();
  equal(owner.stats().textureCount, 0);
  equal(owner.stats().bufferCount, 0);
  equal(owner.stats().programCount, 0);
});
