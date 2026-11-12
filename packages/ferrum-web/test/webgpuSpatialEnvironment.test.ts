import { WebGpuSpatialBloom } from "../src/webgpuSpatialBloom.js";
import { WebGpuSpatialLightShafts } from "../src/webgpuSpatialLightShafts.js";
import { spatialLightShaftPlan } from "../src/spatialLightShaftKernel.js";
import { spatialBloomPlan } from "../src/spatialBloomKernel.js";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { WebGpuSpatialEnvironment } from "../src/webgpuSpatialEnvironment.js";
import {
  compileSpatialEnvironment,
  type SpatialEnvironmentSpec,
} from "../src/spatialEnvironment.js";
import type { SpatialRenderBufferView } from "../src/dataSceneSpatial.js";
import { validateSpatialExtensions } from "../src/spatialRenderPacket.js";
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
  failBuffer = false;
  failTextureAt = Infinity;
  textureAttempts = 0;
  uniforms: Float32Array[] = [];
  queue = {
    writeBuffer: (_b: unknown, _o: number, v: Float32Array) => this.uniforms.push(v.slice()),
  };
  createBuffer(d: GPUBufferDescriptor) {
    if (this.failBuffer) throw Error("buffer allocation failed");
    const r = new Resource(d);
    this.buffers.push(r);
    return r;
  }
  createTexture(d: GPUTextureDescriptor) {
    if (++this.textureAttempts === this.failTextureAt) throw Error("texture allocation failed");
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
            version: values.length === 700 ? 15 : values.length === 632 ? 14 : values.length === 616 ? 13 : values.length === 608 ? 12 : values.length === 600 ? 11 : values.length === 592 ? 10 : values.length === 584 ? 9 : values.length === 580 ? 8 : values.length === 576 ? 7 : values.length === 544 ? 6 : values.length === 528 ? 5 : values.length === 512 ? 4 : values.length === 128 ? 3 : values.length === 112 ? 2 : 1,
            values,
            shadowMatrices: new Float32Array((values[2] >= 0 ? 96 : 0) + (values.length >= 592 && values[589] === 1 && values[588] >= 0 ? 96 : 0) + (values[92] > 0 ? 16 : 0)),
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
test("sun PCSS packs both camera records without new targets and clears on legacy frames", () => {
  const { device, pass } = setup();
  const sun = { direction: { x: 0, y: 0, elevation: 1 }, shadows: { resolution: 512 as const, extent: 100, distance: 300 } };
  pass.prepare(frame({ lighting: { lights: [], directional: sun } }), 160, 90);
  const resources = [device.buffers.length, device.textures.length];
  const f = frame({ lighting: { lights: [], directional: { ...sun, shadows: { ...sun.shadows, pcss: {} } } } });
  validateSpatialExtensions(f); pass.prepare(f, 160, 90);
  deepEqual([device.buffers.length, device.textures.length], resources);
  const packed = device.uniforms[device.uniforms.length - 1];
  equal(packed[656], 1); equal(packed[658], 16);
  ok(Math.abs(packed[657] - Math.tan(.5 * Math.PI / 180) * 300 * 512 / 100) < 1e-5);
  deepEqual(packed.subarray(656, 660), packed.subarray(3072 / 4 + 656, 3072 / 4 + 660));
  pass.prepare(frame({ lighting: { lights: [], directional: sun } }), 160, 90);
  deepEqual([...device.uniforms[device.uniforms.length - 1].subarray(656, 660)], [0, 0, 0, 0]);
  pass.destroy(); equal(device.textures.filter(r => !r.destroyed).length, 0);
});
test("height fog uniforms reuse targets, pack both camera records and clear on legacy", () => {
  const { device, pass } = setup();
  const fog = { color: [.2, .3, .4] as const, start: 10, end: 400 };
  const base = frame({ fog }); pass.prepare(base, 160, 90);
  const resources = [device.buffers.length, device.textures.length];
  const height = frame({ fog: { ...fog, height: { baseHeight: -20, density: .5, falloff: 2 } } });
  validateSpatialExtensions(height); pass.prepare(height, 160, 90);
  deepEqual([device.buffers.length, device.textures.length], resources);
  const packed = device.uniforms[device.uniforms.length - 1];
  deepEqual([...packed.subarray(668, 672)], [1, -20, .5, 2]);
  deepEqual(packed.subarray(668, 676), packed.subarray(3072 / 4 + 668, 3072 / 4 + 676));
  pass.prepare(base, 160, 90);
  deepEqual([...device.uniforms[device.uniforms.length - 1].subarray(668, 672)], [0, 0, 0, 0]);
  pass.destroy(); equal(device.textures.filter(r => !r.destroyed).length, 0);
});

test("point PCSS uniforms preserve both owners, duplicate camera records and clear on legacy", () => {
  const { device, pass } = setup();
  const lights = [0, 1].map(x => ({ position: { x, y: 0, elevation: 64 }, radius: 200 }));
  const hard = frame({ lighting: { lights, pointShadows: [{ lightIndex: 0 }, { lightIndex: 1 }] } });
  pass.prepare(hard, 160, 90); const resources = [device.buffers.length, device.textures.length];
  const soft = frame({ lighting: { lights, pointShadows: [{ lightIndex: 0, pcss: {} }, { lightIndex: 1, pcss: { sourceRadius: 0, maxRadiusTexels: 32 } }] } });
  validateSpatialExtensions(soft); pass.prepare(soft, 160, 90);
  deepEqual([device.buffers.length, device.textures.length], resources);
  const packed = device.uniforms[device.uniforms.length - 1];
  deepEqual([...packed.subarray(660, 668)], [1, 1, 16, 0, 1, 0, 32, 0]);
  deepEqual(packed.subarray(660, 668), packed.subarray(3072 / 4 + 660, 3072 / 4 + 668));
  pass.prepare(hard, 160, 90);
  deepEqual([...device.uniforms[device.uniforms.length - 1].subarray(660, 668)], Array(8).fill(0));
  pass.destroy(); equal(device.textures.filter(r => !r.destroyed).length, 0);
});
test("two point cubes use independent resolution/camera slots, warm reuse and OFF release", () => {
  const { device, pass } = setup();
  const spec: SpatialEnvironmentSpec = { lighting: { lights: [-40, 40].map(x => ({ position: { x, y: 0, elevation: 64 }, radius: 200 })),
    pointShadows: [{ lightIndex: 1, resolution: 128 }, { lightIndex: 0, resolution: 256, bias: 0.25, normalBias: 0.5 }] } };
  const f = frame(spec); validateSpatialExtensions(f); pass.prepare(f, 160, 90);
  const cubes = () => device.textures.filter(r => r.destroyed === 0 && ["Spatial point shadow", "Spatial point2 shadow"].includes(r.d.label ?? ""));
  deepEqual(cubes().map(r => (r.d as GPUTextureDescriptor).size), [[128, 128, 6], [256, 256, 6]]);
  deepEqual(Array.from(device.uniforms[device.uniforms.length - 1].subarray(652, 656)), [1, 0.25, 0.5, 0]);
  const faces: number[] = [];
  const encoder = { beginRenderPass: () => ({ end() {} }) } as unknown as GPUCommandEncoder;
  equal(pass.shadows.draw(encoder, (_pass, face) => { faces.push(face); }), 12);
  deepEqual(faces, [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]);
  pass.shadows.commitSubmission(); equal(pass.shadows.ready(f), true);
  equal(pass.shadows.textureBytes(), (128 ** 2 + 256 ** 2) * 24);
  const warm = [device.textures.length, device.groups]; pass.prepare(f, 160, 90);
  deepEqual([device.textures.length, device.groups], warm);
  pass.prepare(frame({ lighting: { ...spec.lighting!, enabled: false } }), 160, 90);
  equal(cubes().length, 0); equal(pass.shadows.textureBytes(), 0);
  pass.prepare(frame({ lighting: { lights: spec.lighting!.lights, shadows: { lightIndex: 0, resolution: 128 } } }), 160, 90);
  equal(cubes().length, 1);
  pass.destroy(); equal(device.textures.filter(r => r.destroyed === 0).length, 0);
});
test("second cube allocation failure rejects prepare and permits a complete retry", () => {
  const { device, pass } = setup();
  const f = frame({ lighting: { lights: [0, 32].map(x => ({ position: { x, y: 0, elevation: 64 }, radius: 200 })),
    pointShadows: [{ lightIndex: 0 }, { lightIndex: 1 }] } });
  device.failTextureAt = device.textureAttempts + 2;
  throws(() => pass.prepare(f, 160, 90), /allocation/);
  equal(pass.shadows.ready(f), false);
  device.failTextureAt = Infinity; pass.prepare(f, 160, 90);
  const encoder = { beginRenderPass: () => ({ end() {} }) } as unknown as GPUCommandEncoder;
  equal(pass.shadows.draw(encoder, () => {}), 12); pass.shadows.commitSubmission();
  equal(pass.shadows.ready(f), true); pass.destroy();
  equal(device.textures.filter(r => r.destroyed === 0).length, 0);
});
test("separated composition allocates only active indirect/DOF stages and reuses views and groups", () => {
  const { device, pass } = setup();
  const base: SpatialEnvironmentSpec = { composition: "separated", lighting: { lights: [{ position: { x: 0, y: 0, elevation: 100 }, radius: 200, lightMask: 1 }] } };
  const plain = frame(base); validateSpatialExtensions(plain);
  throws(() => validateSpatialExtensions({ ...plain, environment: { ...plain.environment!, version: 5 } }), /environment buffer/);
  pass.prepare(plain, 160, 90);
  const live = () => device.textures.filter(texture => texture.destroyed === 0).length;
  const baseline = live();
  const ao = frame({ ...base, ambientOcclusion: { strength: 1 } });
  pass.prepare(ao, 160, 90); equal(live(), baseline + 2); equal(!!pass.scene()!.indirect, true);
  const warm = [device.textures.length, device.groups]; pass.prepare(ao, 160, 90); pass.scene(); pass.scene();
  deepEqual([device.textures.length, device.groups], warm);
  const combined = frame({ ...base, ambientOcclusion: {}, bloom: {}, depthOfField: { focusDistance: 100 } });
  pass.prepare(combined, 160, 90); equal(live(), baseline + 3);
  equal(device.uniforms[device.uniforms.length - 1][519], 7);
  pass.prepare(frame({ ...base, ambientOcclusion: { strength: 0 }, bloom: { strength: 0 } }), 160, 90);
  equal(live(), baseline); equal(!!pass.scene()!.indirect, false);
  pass.destroy(); equal(live(), 0);
});
test("v7 channels occupy private tail words and receiver tables are lazy, reused, disabled and released", () => {
  const { device, pass } = setup();
  const f = frame({ lighting: { ambient: [0, 0, 0], lights: [{ position: { x: 0, y: 0, elevation: 100 }, radius: 200, lightMask: 1, shadowMask: 2 }], directional: { direction: { x: 1, y: 0, elevation: 1 }, lightMask: 4, shadowMask: 8 } } });
  const before = device.buffers.length;
  pass.prepare(f, 160, 90);
  equal(device.buffers.length, before);
  f.terrainVertexCount = 72;
  f.receiverMasks = { version: 1, stride: 2, terrain: new Uint32Array([1, 2, 4, 8]), billboards: new Uint32Array(), models: new Uint32Array() };
  pass.prepare(f, 160, 90);
  equal(device.buffers.length, before + 1);
  const u = device.uniforms[device.uniforms.length - 1];
  deepEqual(Array.from(u.subarray(640, 646)), [2052, 513, 0, 0, 0, 1]);
  deepEqual(u.subarray(640, 648), u.subarray(1408, 1416));
  equal(pass.receivers.offset(65535), 0); equal(pass.receivers.offset(513), 256); equal(pass.receivers.offset(2052), 512);
  const writes = device.uniforms.length, groups = device.groups;
  pass.prepare(f, 160, 90);
  equal(device.uniforms.length, writes + 1); equal(device.groups, groups); equal(device.buffers.length, before + 1);
  pass.prepare(frame(), 160, 90);
  equal(pass.receivers.offset(513), 0); equal(device.uniforms[device.uniforms.length - 1][645], 0);
  pass.prepare(f, 160, 90);
  equal(device.buffers.length, before + 1); equal(device.groups, groups + 1); // Only the released HDR image group is recreated.
  pass.destroy(); equal(device.buffers.every(buffer => buffer.destroyed === 1), true);
});
test("receiver table failures preserve prior mappings, enforce device limits and surface asynchronous errors", async () => {
  const { device, pass } = setup(), f = frame({ lighting: { lights: [] } });
  f.terrainVertexCount = 36;
  f.receiverMasks = { version: 1, stride: 2, terrain: new Uint32Array([1, 2]), billboards: new Uint32Array(), models: new Uint32Array() };
  pass.prepare(f, 160, 90);
  const live = device.buffers.filter(buffer => !buffer.destroyed).length;
  f.terrainVertexCount = 144; f.receiverMasks.terrain = new Uint32Array([1, 2, 2, 2, 3, 2, 4, 2]);
  device.limits.maxBufferSize = 512;
  throws(() => pass.prepare(f, 160, 90), /receiver uniform table/);
  equal(pass.receivers.offset(513), 256);
  device.limits.maxBufferSize = 268435456; device.failBuffer = true;
  throws(() => pass.prepare(f, 160, 90), /buffer allocation failed/);
  equal(pass.receivers.offset(513), 256); equal(device.buffers.filter(buffer => !buffer.destroyed).length, live);
  device.failBuffer = false; device.gpuError = "receiver memory exhausted";
  pass.prepare(f, 160, 90);
  for (let i = 0; i < 4; i++) await Promise.resolve();
  throws(() => pass.prepare(f, 160, 90), /receiver GPU allocation failed/);
  equal(device.scopes, 0);
  pass.destroy(); equal(device.buffers.every(buffer => buffer.destroyed === 1), true);
});
test("failed optional indirect allocation preserves the previous target and releases partial scratch", () => {
  const { device, pass } = setup();
  const base: SpatialEnvironmentSpec = { lighting: { lights: [] } };
  pass.prepare(frame(base), 160, 90);
  const prior = pass.scene()!.color;
  const live = () => device.textures.filter(texture => texture.destroyed === 0).length;
  const count = live();
  device.failTextureAt = device.textureAttempts + 4;
  const separated = frame({ ...base, composition: "separated", ambientOcclusion: {} });
  throws(() => pass.prepare(separated, 160, 90), /texture allocation failed/);
  equal(pass.scene()!.color, prior); equal(live(), count);
  device.failTextureAt = Infinity;
  pass.prepare(separated, 160, 90); equal(live(), count + 2);
  pass.destroy(); equal(live(), 0);
});
test("v5 center stays separate from the private v7 channel/camera uniform", () => {
  const { device, pass } = setup();
  const f = frame({ lighting: { lights: [], directional: { direction: { x: -1, y: -1, elevation: 1 }, shadows: { center: { x: 100, y: 200, elevation: 300 } } } } });
  equal(f.environment!.version, 5);
  validateSpatialExtensions(f);
  const wrongVersion = { ...f, environment: { ...f.environment!, version: 4 as const } };
  throws(() => validateSpatialExtensions(wrongVersion), /environment buffer/);
  pass.prepare(f, 320, 240);
  const u = device.uniforms[device.uniforms.length - 1];
  equal(u.length, 1536);
  deepEqual(Array.from(u.subarray(512, 515)), [120, 240, 160]);
  deepEqual(u.subarray(0, 527), u.subarray(768, 1295));
  const count = [device.textures.length, device.buffers.length];
  pass.prepare(f, 320, 240);
  deepEqual([device.textures.length, device.buffers.length], count);
  pass.destroy();
  equal(device.textures.every(t => t.destroyed === 1), true);
  equal(device.buffers.every(b => b.destroyed === 1), true);
});
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
  equal(u.length, 1536);
  equal(u[1295], 0);
  deepEqual(u.subarray(0, 527), u.subarray(768, 1295));
  deepEqual(Array.from(u.subarray(512, 515)), [120, 240, 160]);
  deepEqual(Array.from(u.subarray(520, 528)), [Math.fround(0.1), 2000, 1, 333, 160, 90, 240, 1]);
  equal(u[96], 1);
  const legacy = frame({ fog: { color: [0, 0, 1], start: 10, end: 100 } });
  pass.prepare(legacy, 320, 240);
  equal(device.uniforms[device.uniforms.length - 1][96], 0);
  equal(device.uniforms[device.uniforms.length - 1][99], 0);
  pass.destroy();
});
test("v3 lighting fits the existing uniform allocation and clears when switching to legacy",()=>{
  const {device,pass}=setup(),advanced=frame({lighting:{lights:[],hemisphere:{skyColor:[0,0,1],groundColor:[1,0,0]}}});
  pass.prepare(advanced,320,240);const a=device.uniforms[device.uniforms.length-1];
  equal(a[112],1);equal(a[114],1);equal(a[118],1);equal(a[120],1);
  deepEqual(Array.from(a.subarray(512,515)),[120,240,160]);
  equal(a[1295],0);deepEqual(a.subarray(0,527),a.subarray(768,1295));
  const allocated=device.buffers.length;
  pass.prepare(frame({lighting:{lights:[]}}),320,240);const b=device.uniforms[device.uniforms.length-1];
  equal(device.buffers.length,allocated);deepEqual(Array.from(b.subarray(112,128)),Array(16).fill(0));
  pass.destroy();equal(device.buffers.every(buffer=>buffer.destroyed===1),true);
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


test("wide Bloom target allocation failures preserve old targets, retry, release on OFF and destroy", async () => {
  const { device, pass } = setup();
  const base = frame({ composition: "separated", lighting: { lights: [] } });
  pass.prepare(base, 128, 128); await Promise.resolve();
  const live = () => device.textures.filter(t => t.destroyed === 0).length;
  const baseline = live();
  const wide = frame({ composition: "separated", bloom: { mode: "wide", radius: 64 } });
  device.failTextureAt = device.textureAttempts + 2;
  throws(() => pass.prepare(wide, 128, 128), /allocation failed/);
  equal(live(), baseline);
  device.failTextureAt = Infinity; pass.prepare(wide, 128, 128);
  const warm = device.textures.length; ok(live() > baseline);
  pass.prepare(wide, 128, 128); equal(device.textures.length, warm);
  pass.prepare(base, 128, 128); equal(live(), baseline);
  pass.destroy(); equal(live(), 0); equal(device.scopes, 0);
});

test("wide Bloom uses immutable stage parameters, retries writes and latches async binding failures until recovery", async () => {
  const { device, pass: unrelated } = setup(); unrelated.destroy();
  const pass = new WebGpuSpatialBloom(device as unknown as GPUDevice);
  const values = compileSpatialEnvironment({ composition: "separated", bloom: { mode: "wide", radius: 64 } });
  const plan = spatialBloomPlan(values, 128, 128, 128)!;
  pass.prepare(plan); await Promise.resolve(); await Promise.resolve();
  let draws = 0;
  const encoder = { beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() { draws++; }, end() {} }) } as unknown as GPUCommandEncoder;
  const source = {} as GPUTextureView;
  const write = device.queue.writeBuffer;
  device.queue.writeBuffer = () => { throw Error("injected Bloom upload"); };
  throws(() => pass.draw(encoder, source, plan, 1), /injected/);
  device.queue.writeBuffer = write;
  pass.draw(encoder, source, plan, 1); equal(draws, plan.drawCalls);
  const uploaded = device.uniforms[device.uniforms.length - 1];
  equal(uploaded[2], 0); equal(uploaded[64 + 2], 3);
  equal(uploaded[(plan.drawCalls - 2) * 64 + 2], 1); equal(uploaded[(plan.drawCalls - 1) * 64 + 2], 2);
  const groups = device.groups; pass.draw(encoder, source, plan, 1); equal(device.groups, groups);
  device.bindingError = true; pass.draw(encoder, {} as GPUTextureView, plan, 1);
  await Promise.resolve(); await Promise.resolve();
  throws(() => pass.prepare(plan), /binding allocation/);
  pass.destroy(); equal(device.scopes, 0);
  equal(device.textures.filter(t => t.destroyed === 0).length, 0);
  equal(device.buffers.filter(b => b.destroyed === 0).length, 0);
});

const shaftBase: SpatialEnvironmentSpec = {
  composition: "separated",
  lighting: { lights: [], directional: { direction: { x: 0, y: 0, elevation: 1 }, shadows: {} } },
};
test("light shafts reuse the sun map, allocate no indirect MRT, share AO resolve and release inactive targets", () => {
  const { device, pass } = setup();
  pass.prepare(frame(shaftBase), 160, 90);
  const live = () => device.textures.filter(t => !t.destroyed);
  const baseline = live().length, shafts = frame({ ...shaftBase, lightShafts: {} });
  validateSpatialExtensions(shafts); pass.prepare(shafts, 160, 90);
  equal(live().length, baseline + 2); equal(!!pass.scene()!.indirect, false);
  const packed = device.uniforms[device.uniforms.length - 1];
  equal(packed[676], 1);
  deepEqual(packed.subarray(676, 680), packed.subarray(3072 / 4 + 676, 3072 / 4 + 680));
  const warm = [device.textures.length, device.groups]; pass.prepare(shafts, 160, 90);
  deepEqual([device.textures.length, device.groups], warm);
  pass.prepare(frame({ ...shaftBase, lightShafts: {}, ambientOcclusion: {} }), 160, 90);
  equal(live().length, baseline + 3); equal(!!pass.scene()!.indirect, true);
  pass.prepare(frame({ ...shaftBase, lightShafts: { intensity: 0 } }), 160, 90);
  equal(live().length, baseline);
  deepEqual([...device.uniforms[device.uniforms.length - 1].subarray(676, 680)], [0, 0, 0, 0]);
  pass.prepare(shafts, 321, 181);
  deepEqual((live().find(t => t.d.label === "Spatial light shafts HDR")!.d as GPUTextureDescriptor).size, [161, 91, 1]);
  pass.prepare(frame(shaftBase), 321, 181); equal(live().length, baseline);
  pass.destroy(); equal(live().length, 0); equal(device.scopes, 0);
});
test("light shafts preserve the previous target on allocation failure and latch asynchronous GPU errors", async () => {
  const { device, pass: unrelated } = setup(); unrelated.destroy();
  const pass = new WebGpuSpatialLightShafts(device as unknown as GPUDevice);
  const f = frame({ ...shaftBase, lightShafts: {} }), v = f.environment!.values;
  const plan = spatialLightShaftPlan(v, 160, 90)!;
  pass.prepare(plan); const bytes = pass.textureBytes();
  device.failView = true;
  throws(() => pass.prepare(spatialLightShaftPlan(v, 320, 180)), /view failed/);
  equal(pass.textureBytes(), bytes); equal(device.textures.filter(t => !t.destroyed).length, 1);
  device.failView = false; pass.prepare(plan);
  let draws = 0;
  const encoder = { beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() { draws++; }, end() {} }) } as unknown as GPUCommandEncoder;
  const depth = {} as GPUTextureView, shadow = {} as GPUTextureView;
  const write = device.queue.writeBuffer;
  device.queue.writeBuffer = () => { throw Error("injected shaft upload"); };
  throws(() => pass.draw(encoder, f, plan, depth, shadow, 160, 90), /injected/);
  device.queue.writeBuffer = write;
  pass.draw(encoder, f, plan, depth, shadow, 160, 90); equal(draws, 1);
  const groups = device.groups;
  pass.draw(encoder, f, plan, depth, shadow, 160, 90); equal(device.groups, groups);
  const uniform = device.uniforms[device.uniforms.length - 1];
  equal(uniform.length, 52); deepEqual([...uniform.subarray(44, 48)], [160, 90, 80, 45]);
  device.bindingError = true; pass.draw(encoder, f, plan, {} as GPUTextureView, shadow, 160, 90);
  await Promise.resolve(); await Promise.resolve();
  throws(() => pass.prepare(plan), /Light shafts GPU allocation failed/);
  pass.destroy(); pass.destroy(); equal(device.scopes, 0);
  equal(device.textures.filter(t => !t.destroyed).length, 0);
  equal(device.buffers.filter(t => !t.destroyed).length, 0);
});

test("obsolete light shafts allocation errors cannot poison replacement or disabled targets", async () => {
  for (const action of ["resize", "disable", "destroy"]) {
    const { device, pass: unrelated } = setup(); unrelated.destroy();
    const pass = new WebGpuSpatialLightShafts(device as unknown as GPUDevice);
    const values = compileSpatialEnvironment({ ...shaftBase, lightShafts: {} });
    const plan = spatialLightShaftPlan(values, 160, 90)!;
    for (let i = 0; i < 4; i++) await Promise.resolve();
    device.gpuError = "obsolete shaft allocation"; pass.prepare(plan);
    const next = spatialLightShaftPlan(values, 320, 180)!;
    if (action === "resize") pass.prepare(next);
    else if (action === "disable") pass.prepare();
    else pass.destroy();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    if (action !== "destroy") pass.prepare(action === "resize" ? next : plan);
    pass.destroy(); equal(device.scopes, 0);
    equal(device.textures.every(t => t.destroyed === 1), true);
    equal(device.buffers.every(t => t.destroyed === 1), true);
  }
});
test("current asynchronous shaft target errors release unusable textures before rejecting reuse", async () => {
  const { device, pass: unrelated } = setup(); unrelated.destroy();
  const pass = new WebGpuSpatialLightShafts(device as unknown as GPUDevice);
  for (let i = 0; i < 4; i++) await Promise.resolve();
  device.gpuError = "current shaft allocation";
  const plan = spatialLightShaftPlan(compileSpatialEnvironment({ ...shaftBase, lightShafts: {} }), 160, 90)!;
  pass.prepare(plan);for (let i = 0; i < 4; i++) await Promise.resolve();
  equal(pass.textureBytes(), 0);equal(device.textures.filter(t => !t.destroyed).length, 0);
  throws(() => pass.prepare(plan), /current shaft allocation/);pass.destroy();
});
test("obsolete shaft binding errors do not invalidate a replacement group", async () => {
  const { device, pass: unrelated } = setup(); unrelated.destroy();
  const pass = new WebGpuSpatialLightShafts(device as unknown as GPUDevice);
  const f = frame({ ...shaftBase, lightShafts: {} }), plan = spatialLightShaftPlan(f.environment!.values, 160, 90)!;
  pass.prepare(plan); for (let i = 0; i < 4; i++) await Promise.resolve();
  const encoder = { beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }) } as unknown as GPUCommandEncoder;
  const shadow = {} as GPUTextureView;
  device.bindingError = true; pass.draw(encoder, f, plan, {} as GPUTextureView, shadow, 160, 90);
  device.bindingError = false; const depth = {} as GPUTextureView;
  pass.draw(encoder, f, plan, depth, shadow, 160, 90);
  for (let i = 0; i < 4; i++) await Promise.resolve();
  pass.prepare(plan); pass.draw(encoder, f, plan, depth, shadow, 160, 90);
  pass.destroy(); equal(device.scopes, 0); equal(device.textures.filter(t => !t.destroyed).length, 0);
});

test("probes pack bounded source into both camera records with no additional GPU allocations", () => {
  const { device, pass } = setup();
  const base = frame({ lighting: { lights: [] } }); pass.prepare(base, 160, 90);
  const resources = [device.buffers.length, device.textures.length];
  const probes = Array.from({ length: 8 }, (_, i) => ({ position: { x: i, y: -i, elevation: 16 }, radius: 32, color: [.2, .4, .8] as const, intensity: i / 2 }));
  const f = frame({ lighting: { lights: [], probes } }); validateSpatialExtensions(f); pass.prepare(f, 160, 90);
  deepEqual([device.buffers.length, device.textures.length], resources);
  const packed = device.uniforms[device.uniforms.length - 1];
  equal(packed.length * 4, 6144); deepEqual(packed.subarray(680, 748), f.environment!.values.subarray(632, 700));
  deepEqual(packed.subarray(680, 748), packed.subarray(768 + 680, 768 + 748));
  for (const next of [frame({ lighting: { enabled: false, lights: [], probes } }), base]) {
    pass.prepare(next, 160, 90);
    deepEqual([...device.uniforms[device.uniforms.length - 1].subarray(680, 748)], Array(68).fill(0));
  }
  pass.destroy(); equal(device.buffers.every(b => b.destroyed === 1), true); equal(device.textures.every(t => t.destroyed === 1), true);
});
