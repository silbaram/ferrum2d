import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { WebGpuSpatialEnvironment } from "../src/webgpuSpatialEnvironment.js";
import {
  compileSpatialEnvironment,
  type SpatialEnvironmentSpec,
} from "../src/spatialEnvironment.js";
import type { SpatialRenderBufferView } from "../src/dataSceneSpatial.js";
class Resource {
  destroyed = 0;
  constructor(
    readonly d: GPUBufferDescriptor | GPUTextureDescriptor,
    private readonly view: () => void = () => {},
  ) {}
  destroy() {
    this.destroyed++;
  }
  createView() {
    this.view();
    return { owner: this };
  }
}
class Device {
  limits = { maxTextureDimension2D: 8192, maxBufferSize: 268435456 };
  buffers: Resource[] = [];
  textures: Resource[] = [];
  groups = 0;
  failView = false;
  uniforms: Float32Array[] = [];
  queue = {
    writeBuffer: (_b: unknown, _o: number, v: Float32Array) => this.uniforms.push(v.slice()),
  };
  createBuffer(d: GPUBufferDescriptor) {
    const r = new Resource(d);
    this.buffers.push(r);
    return r;
  }
  createTexture(d: GPUTextureDescriptor) {
    const r = new Resource(d, () => {
      if (this.failView) throw Error("view failed");
    });
    this.textures.push(r);
    return r;
  }
  createBindGroupLayout() {
    return {};
  }
  createPipelineLayout() {
    return {};
  }
  createShaderModule() {
    return {};
  }
  createRenderPipeline() {
    return {};
  }
  bindingError = false;
  createBindGroup() {
    this.groups++;
    if (this.bindingError) this.gpuError = "binding out of memory";
    return {};
  }
  gpuError = "";
  scopes = 0;
  pushErrorScope() {
    this.scopes++;
  }
  async popErrorScope() {
    this.scopes--;
    const message = this.gpuError;
    this.gpuError = "";
    return message ? { message } : null;
  }
}
function frame(spec?: SpatialEnvironmentSpec): SpatialRenderBufferView {
  const camera = new Float32Array(28);
  for (const i of [0, 5, 10, 15]) camera[i] = 1;
  camera.set([1, 120, 240, 160, 0, 24, -40, 0, 0.1, 2000, 320, 240], 16);
  const values = spec && compileSpatialEnvironment(spec);
  return {
    version: 2,
    vertexStride: 11,
    camera,
    terrain: new Float32Array(),
    terrainVertexCount: 0,
    terrainRevision: 1,
    terrainDrawRanges: new Uint32Array(),
    billboards: new Float32Array(),
    billboardVertexCount: 0,
    ...(values
      ? {
          environment: {
            version: values.length === 112 ? 2 : 1,
            values,
            shadowMatrices: new Float32Array((values[2] >= 0 ? 96 : 0) + (values[92] > 0 ? 16 : 0)),
            shadowCasters: new Float32Array(),
            shadowCasterVertexCount: 0,
          },
        }
      : {}),
  };
}
function setup() {
  Object.assign(globalThis, {
    GPUShaderStage: { FRAGMENT: 2 },
    GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2 },
    GPUTextureUsage: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 },
  });
  const device = new Device(),
    pass = new WebGpuSpatialEnvironment(device as unknown as GPUDevice, "rgba8unorm");
  return { device, pass };
}
test("spatial HDR targets reuse warm resources, retain old target on failed resize, and release on disable", () => {
  const { device, pass } = setup(),
    f = frame({ fog: { color: [0, 0, 1], start: 100, end: 500 } });
  deepEqual(pass.validate(f, 320, 240), [320, 240]);
  pass.prepare(f, 320, 240);
  const old = pass.scene(),
    count = [device.textures.length, device.groups];
  equal(pass.textureBytes(), 320 * 240 * 12);
  pass.prepare(f, 320, 240);
  deepEqual([device.textures.length, device.groups], count);
  device.failView = true;
  throws(() => pass.prepare(f, 640, 480), /view failed/);
  equal(pass.scene()!.color, old!.color);
  equal(
    device.textures.slice(2, 4).every((t) => t.destroyed === 0),
    true,
  );
  equal(
    device.textures.slice(4).every((t) => t.destroyed === 1),
    true,
  );
  device.failView = false;
  pass.prepare(f, 640, 480);
  equal(
    device.textures.slice(2, 4).every((t) => t.destroyed === 1),
    true,
  );
  pass.prepare(frame(), 320, 240);
  equal(pass.scene(), undefined);
  equal(pass.textureBytes(), 0);
  pass.destroy();
  pass.destroy();
  equal(
    device.buffers.every((t) => t.destroyed === 1),
    true,
  );
  equal(
    device.textures.every((t) => t.destroyed === 1),
    true,
  );
  throws(() => pass.prepare(f, 320, 240), /destroyed/);
});
test("native environment/camera packing preserves actor focus and resets v2 fields for v1", () => {
  const { device, pass } = setup(),
    f = frame({
      depthOfField: { focusDistance: 100, focusTarget: "actor", quality: "high", maxBlurRadius: 8 },
      pixelArt: { width: 160, height: 90 },
    });
  f.presentation = new Float32Array([0, 0.3125, 1, 0.375, 160, 90]);
  f.environment!.values[99] = 333;
  deepEqual(pass.validate(f, 320, 240), [160, 90]);
  pass.prepare(f, 160, 90);
  const u = device.uniforms[device.uniforms.length - 1];
  equal(u.length, 512);
  equal(u[383], 0);
  deepEqual(u.subarray(0, 127), u.subarray(256, 383));
  deepEqual(Array.from(u.subarray(112, 115)), [120, 240, 160]);
  deepEqual(Array.from(u.subarray(120, 128)), [Math.fround(0.1), 2000, 1, 333, 160, 90, 240, 1]);
  equal(u[96], 1);
  const legacy = frame({ fog: { color: [0, 0, 1], start: 10, end: 100 } });
  pass.prepare(legacy, 320, 240);
  equal(device.uniforms[device.uniforms.length - 1][96], 0);
  equal(device.uniforms[device.uniforms.length - 1][99], 0);
  pass.destroy();
});
test("asynchronous HDR allocation errors invalidate the target and surface instead of caching an invalid warm hit", async () => {
  const { device, pass } = setup(),
    f = frame({ fog: { color: [0, 0, 1], start: 10, end: 100 } });
  device.gpuError = "out of memory";
  pass.prepare(f, 320, 240);
  for (let i = 0; i < 4; i++) await Promise.resolve();
  equal(pass.scene(), undefined);
  equal(device.scopes, 0);
  equal(
    device.textures
      .filter((t) => t.d.label?.startsWith("Spatial HDR"))
      .every((t) => t.destroyed === 1),
    true,
  );
  throws(() => pass.validate(f, 320, 240), /GPU allocation failed/);
  throws(() => pass.prepare(f, 320, 240), /GPU allocation failed/);
  pass.destroy();
  equal(
    device.textures.every((t) => t.destroyed === 1),
    true,
  );
});
test("oversized shadow, invalid camera/pixel targets and oversized buffers fail before GPU allocation", () => {
  const { device, pass } = setup(),
    before = [device.buffers.length, device.textures.length, device.uniforms.length];
  const f = frame({ fog: { color: [0, 0, 1], start: 10, end: 100 } }),
    badCamera = { ...f, camera: f.camera.slice() };
  badCamera.camera[25] = 0.01;
  const shadow = frame({
    lighting: {
      lights: [{ position: { x: 0, y: 0, elevation: 100 }, radius: 300 }],
      shadows: { lightIndex: 0 },
    },
  });
  shadow.environment!.values[3] = 16384;
  throws(() => pass.validate(shadow, 320, 240), /shadow target/);
  throws(() => pass.validate(badCamera, 320, 240), /camera/);
  throws(
    () => pass.validate({ ...f, presentation: new Float32Array([0, 0, 1, 1, 0, 90]) }, 320, 240),
    /pixelArt/,
  );
  for (const [w, h] of [
    [8193, 1],
    [4096, 4096],
    [NaN, 100],
  ])
    throws(() => pass.validate(f, w, h), /depth target/);
  deepEqual([device.buffers.length, device.textures.length, device.uniforms.length], before);
  pass.destroy();
});
test("obsolete asynchronous HDR failures cannot invalidate replacement, disabled or destroyed targets", async () => {
  for (const action of ["resize", "disable", "destroy"]) {
    const { device, pass } = setup(),
      f = frame({ fog: { color: [0, 0, 1], start: 10, end: 100 } });
    device.gpuError = "obsolete allocation";
    pass.prepare(f, 320, 240);
    if (action === "resize") pass.prepare(f, 640, 480);
    else if (action === "disable") pass.prepare(frame(), 320, 240);
    else pass.destroy();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    equal(device.scopes, 0);
    if (action === "resize") {
      equal(pass.textureBytes(), 640 * 480 * 12);
      equal(!!pass.scene(), true);
      pass.validate(f, 640, 480);
    } else equal(pass.scene(), undefined);
    pass.destroy();
    equal(
      device.textures.every((t) => t.destroyed === 1),
      true,
    );
    equal(
      device.buffers.every((t) => t.destroyed === 1),
      true,
    );
  }
});
test("shadow view bind-group validation failure cannot remain an invalid warm environment group", async () => {
  const { device, pass } = setup(),
    f = frame({
      lighting: {
        lights: [{ position: { x: 0, y: 0, elevation: 100 }, radius: 300 }],
        shadows: { lightIndex: 0, resolution: 128 },
      },
    });
  device.bindingError = true;
  pass.prepare(f, 320, 240);
  for (let i = 0; i < 6; i++) await Promise.resolve();
  equal(pass.scene(), undefined);
  equal(device.scopes, 0);
  throws(() => pass.validate(f, 320, 240), /binding GPU allocation failed/);
  pass.destroy();
  equal(
    device.textures.every((t) => t.destroyed === 1),
    true,
  );
});
