import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { WebGpuLightingCookies } from "../src/webgpuLightingCookies.js";
import { normalizeLightingScene } from "../src/lightingNormalize.js";
import { webGpuResources } from "../src/webgpuResources.js";
import type { WebGpuTextureResource } from "../src/webgpuTextureStore.js";

class Device {
  limits = { maxBufferSize: 8192 };
  buffers: { destroyed: number; destroy(): void }[] = [];
  groups: GPUBindGroupDescriptor[] = [];
  writes: Float32Array[] = [];
  scopes = 0;
  error = "";
  rejectScope = false;
  failGroup = false;
  failWrite = false;
  queue = { writeBuffer: (_buffer: GPUBuffer, _offset: number, data: Float32Array) => {
    if (this.failWrite) throw Error("write failed");
    this.writes.push(data.slice());
  } };
  createBindGroupLayout() { return {}; }
  createBuffer() { const buffer = { destroyed: 0, destroy() { this.destroyed++; } }; this.buffers.push(buffer); return buffer; }
  createBindGroup(descriptor: GPUBindGroupDescriptor) {
    if (this.failGroup) throw Error("group failed");
    this.groups.push(descriptor); return { descriptor };
  }
  pushErrorScope() { this.scopes++; }
  async popErrorScope() {
    this.scopes--;
    if (this.rejectScope) { this.rejectScope = false; throw Error("scope failed"); }
    const message = this.error; this.error = "";
    return message ? { message } : null;
  }
}
const lights = (rotations = [0, Math.PI / 2]) => normalizeLightingScene({ profile: "lit", pointLights: rotations.map(rotationRadians => ({ x: 0, y: 0, radius: 100, cookie: { textureId: 7, rotationRadians } })) }).pointLights;
function setup() {
  Object.assign(globalThis, { GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2 }, GPUShaderStage: { FRAGMENT: 1 } });
  const device = new Device(), gpu = device as unknown as GPUDevice;
  const cookies = new WebGpuLightingCookies(gpu);
  let view: GPUTextureView = {};
  const source = { resource: (id: number) => { equal(id, 7); return { view } as WebGpuTextureResource; } };
  return { device, gpu, cookies, source, replace: () => { view = {}; } };
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test("cookie rows use independent aligned offsets, shared view bindings, one upload and bounded warm reuse", () => {
  const { device, gpu, cookies, source, replace } = setup(), pointLights = lights();
  cookies.prepare(pointLights, source);
  equal(device.writes.length, 1); equal(device.groups.length, 1);
  const a = cookies.binding(0), b = cookies.binding(1);
  equal(a.group, b.group); equal(a.offset, 0); equal(b.offset, 256);
  deepEqual([...device.writes[0].subarray(0, 6)], [0, 0, 1, 1, 1, 0]);
  equal(device.writes[0][68], Math.fround(Math.cos(Math.PI / 2))); equal(device.writes[0][69], 1);
  equal(webGpuResources(gpu).stats().bufferBytes, 8192);
  cookies.prepare(pointLights, source);
  equal(device.writes.length, 1); equal(device.groups.length, 1);
  replace(); cookies.prepare(pointLights, source);
  equal(cookies.binding(0).group === a.group, false); equal(device.groups.length, 2); equal(device.writes.length, 1);
  cookies.prepare([], source); throws(() => cookies.binding(0), /not prepared/);
  cookies.prepare(pointLights, source); equal(device.groups.length, 3);
  cookies.prepare(lights(Array(32).fill(0)), source); equal(cookies.binding(31).offset, 31 * 256);
  const groups = device.groups.length, writes = device.writes.length;
  throws(() => cookies.prepare([...pointLights, ...Array(31).fill(pointLights[0])], source), /at most 32/);
  equal(device.groups.length, groups); equal(device.writes.length, writes);
  cookies.destroy(); cookies.destroy(); equal(device.buffers[0].destroyed, 1);
  equal(webGpuResources(gpu).stats().bufferCount, 0); throws(() => cookies.binding(0), /destroyed/);
});

test("partial group and upload failures cannot leave a warm cache; synchronous retry prepares all rows", async () => {
  for (const kind of ["group", "write"] as const) {
    const { device, cookies, source } = setup();
    if (kind === "group") device.failGroup = true; else device.failWrite = true;
    throws(() => cookies.prepare(lights(), source), /failed/); throws(() => cookies.binding(0), /not prepared/);
    device.failGroup = device.failWrite = false;
    cookies.prepare(lights(), source); equal(cookies.binding(1).offset, 256); equal(device.writes.length, 1);
    await settle(); equal(device.scopes, 0); cookies.destroy(); equal(device.buffers[0].destroyed, 1);
  }
});

test("async cookie allocation/validation errors release the table and latch until renderer recovery", async () => {
  for (const phase of ["binding", "validation", "destroy"] as const) {
    const { device, gpu, cookies, source } = setup();
    if (phase === "validation") device.rejectScope = true;
    else device.error = "binding failed";
    // The constructor's scopes are already popped; these errors belong to preparation.
    cookies.prepare(lights(), source);
    if (phase === "destroy") cookies.destroy();
    await settle(); equal(device.scopes, 0); equal(device.buffers[0].destroyed, 1);
    equal(webGpuResources(gpu).stats().bufferCount, 0);
    throws(() => cookies.prepare(lights(), source), phase === "destroy" ? /destroyed/ : /Cookie GPU/);
    cookies.destroy(); equal(device.buffers[0].destroyed, 1);
  }
});

test("cookie constructor captures async invalid buffers and rejects a device budget before allocating", async () => {
  Object.assign(globalThis, { GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2 }, GPUShaderStage: { FRAGMENT: 1 } });
  const device = new Device(); device.error = "invalid buffer";
  const cookies = new WebGpuLightingCookies(device as unknown as GPUDevice);
  await settle(); equal(device.buffers[0].destroyed, 1); throws(() => cookies.binding(0), /Cookie GPU/); cookies.destroy();
  const tiny = new Device(); tiny.limits.maxBufferSize = 4096;
  throws(() => new WebGpuLightingCookies(tiny as unknown as GPUDevice), /buffer budget/);
  equal(tiny.buffers.length, 0); equal(tiny.scopes, 0);
});
