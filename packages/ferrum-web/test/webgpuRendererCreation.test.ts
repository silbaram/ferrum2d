import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { test } from "node:test";
import { WebGPURenderer, WebGpuCanvasCommitError } from "../src/webgpuRenderer.js";
import { assertWebGpuSpatialSpecSupported } from "../src/webgpuSpatialSupport.js";
import { createSpatialModelAsset } from "../src/spatialModel.js";
import { emptyRendererStats } from "../src/renderer.js";
import type { RenderCommandBufferView } from "../src/wasmBridge.js";
import { WebGpuRendererBackend } from "../src/webgpuRendererBackend.js";
import type { TextureLoadOptions } from "../src/colorManagement.js";
class Buffer {
  destroy() {}
}
class Texture {
  destroy() {}
  createView() {
    return {};
  }
}
class Device {
  readonly limits = { maxBufferSize: 268435456, maxTextureDimension2D: 8192 };
  destroyed = false;
  resolveLost!: (info: {reason:string;message:string}) => void;
  lost = new Promise<{reason:string;message:string}>(resolve => { this.resolveLost=resolve; });
  events: string[] = [];
  error = false;
  queue = { writeBuffer() {}, writeTexture() {}, copyExternalImageToTexture() {}, onSubmittedWorkDone: async () => {} };
  pushErrorScope() {
    this.events.push("push");
  }
  async popErrorScope() {
    this.events.push("pop");
    if (this.error) {
      this.error = false;
      return { message: "pipeline validation failed" };
    }
    return null;
  }
  destroy() {
    this.destroyed = true;
    this.resolveLost({reason:"destroyed",message:"test destruction"});
  }
  createBuffer() {
    return new Buffer();
  }
  createTexture() {
    return new Texture();
  }
  createBindGroupLayout() {
    return {};
  }
  createPipelineLayout() {
    return {};
  }
  createBindGroup() {
    return {};
  }
  createSampler() {
    return {};
  }
  createShaderModule() {
    return {};
  }
  createRenderPipeline() {
    this.events.push("pipeline");
    return {getBindGroupLayout:()=>({})};
  }
}
function install(device: Device | (()=>Device | Promise<Device>)) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    windowOriginal = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      gpu: {
        requestAdapter: async () => ({ requestDevice: async () => typeof device === "function" ? device() : device }),
        getPreferredCanvasFormat: () => "rgba8unorm",
      },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { devicePixelRatio: 1 },
  });
  Object.assign(globalThis, {
    GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2, VERTEX: 4 },
    GPUTextureUsage: { RENDER_ATTACHMENT: 1, COPY_SRC: 2, COPY_DST: 4, TEXTURE_BINDING: 8 },
    GPUShaderStage: { VERTEX: 1, FRAGMENT: 2 },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (windowOriginal) Object.defineProperty(globalThis, "window", windowOriginal);
    else Reflect.deleteProperty(globalThis, "window");
  };
}
function canvas(device: Device, fails = false) {
  return {
    clientWidth: 320,
    clientHeight: 240,
    width: 320,
    height: 240,
    getContext(kind: string) {
      device.events.push(kind);
      return {
        configure() {
          device.events.push("configure");
          if (fails) throw Error("configuration failed");
        },
      };
    },
  } as unknown as HTMLCanvasElement;
}
test("invalid postprocessing rejects before WebGPU context or GPU allocation", async () => {
  const device = new Device(),
    restore = install(device);
  try {
    await rejects(
      WebGPURenderer.create(canvas(device), { postProcess: [{ kind: "bloom", threshold: 2 }] }),
      /threshold/,
    );
    deepEqual(device.events, []);
  } finally {
    restore();
  }
});
test("GPU validation failure destroys the private device while leaving canvas available to WebGL2", async () => {
  const device = new Device(),
    restore = install(device);
  device.error = true;
  try {
    await rejects(WebGPURenderer.create(canvas(device)), /pipeline validation failed/);
    equal(device.destroyed, true);
    equal(device.events.includes("webgpu"), false);
    equal(device.events.filter((x) => x === "pop").length, 2);
  } finally {
    restore();
  }
});
test("all pipelines validate before canvas commit and post-commit failure has a terminal error type", async () => {
  const device = new Device(),
    restore = install(device);
  try {
    let failure: unknown;
    try {
      await WebGPURenderer.create(canvas(device, true));
    } catch (error) {
      failure = error;
    }
    equal(failure instanceof WebGpuCanvasCommitError, true);
    equal(device.destroyed, true);
    equal(device.events.indexOf("webgpu") > device.events.lastIndexOf("pop"), true);
  } finally {
    restore();
  }
});
test("spatial environment, normal and shadow requirements are accepted before context selection", () => {
  const spec = {
    camera: {
      projection: "orthographic" as const,
      position: { x: 0, y: -100, elevation: 100 },
      target: { x: 0, y: 0, elevation: 0 },
      height: 160,
    },
    terrain: [],
    billboards: {},
  };
  assertWebGpuSpatialSpecSupported(spec);
  assertWebGpuSpatialSpecSupported({
    ...spec,
    environment: { fog: { color: [0, 0, 0], start: 100, end: 500 } },
  });
  assertWebGpuSpatialSpecSupported({
    ...spec,
    environment: {
      lighting: {
        lights: [{ position: { x: 0, y: 0, elevation: 50 }, radius: 200 }],
        shadows: { lightIndex: 0 },
      },
    },
  });
});

test("lost WebGPU stops submitting, coalesces recovery and preserves renderer identity", async () => {
  const first=new Device(),second=new Device();let requests=0;
  const restore=install(()=>++requests===1?first:second);
  try {
    const renderer=await WebGPURenderer.create(canvas(first));
    first.resolveLost({reason:"unknown",message:"driver reset"});await Promise.resolve();
    equal(renderer.deviceState().status,"lost");
    renderer.render();renderer.renderPostProcess();renderer.resize();
    throws(()=>renderer.gpuDevice(),/lost/);
    const a=renderer.recoverDevice(),b=renderer.recoverDevice();equal(a,b);
    equal(await a,true);equal(renderer.gpuDevice(),second);
    equal(renderer.deviceState().generation,2);equal(requests,2);
    renderer.destroy();renderer.destroy();equal(second.destroyed,true);
    throws(()=>renderer.recoverDevice(),/destroyed/);
  } finally {restore();}
});
test("replacement validation failure is retryable and never reports ready", async () => {
  const first=new Device(),bad=new Device(),good=new Device();bad.queue.onSubmittedWorkDone=async()=>{bad.error=true;};let requests=0;
  const restore=install(()=>[first,bad,good][requests++]);
  try {
    const renderer=await WebGPURenderer.create(canvas(first));first.resolveLost({reason:"unknown",message:"lost"});await Promise.resolve();
    await rejects(renderer.recoverDevice(),/pipeline validation/);equal(renderer.deviceState().status,"lost");equal(bad.destroyed,true);
    equal(await renderer.recoverDevice(),true);equal(renderer.gpuDevice(),good);renderer.destroy();
  } finally {restore();}
});

test("already lost devices reject before canvas selection and pending recovery cannot resurrect destroy",async()=>{
  const first=new Device();first.resolveLost({reason:'unknown',message:'already lost'});
  let restore=install(first);
  try{await rejects(WebGPURenderer.create(canvas(first)),/before canvas commit/);equal(first.events.includes('webgpu'),false);}finally{restore();}
  const old=new Device(),next=new Device();let release!:(d:Device)=>void,calls=0;
  restore=install(()=>++calls===1?old:new Promise<Device>(resolve=>{release=resolve;}));
  try{
    const renderer=await WebGPURenderer.create(canvas(old));old.resolveLost({reason:'unknown',message:'reset'});await Promise.resolve();
    const recovering=renderer.recoverDevice();renderer.destroy();await Promise.resolve();release(next);
    await rejects(recovering,/abort/i);equal(renderer.deviceState().status,'destroyed');equal(next.destroyed,true);
  }finally{restore();}
});

function recoveryModel(id: number) {
  return createSpatialModelAsset({
    contentId: id.toString(16).padStart(64, "0"),
    bounds: [0, 0, 0, 1, 1, 1], images: [], diagnostics: [],
    primitives: [{
      vertices: new Float32Array(24), indices: new Uint32Array([0, 1, 2]),
      color: [1, 1, 1, 1], sampler: [9728, 9728, 33071, 33071],
      alphaCutoff: 0, doubleSided: true, emissiveFactor: [0, 0, 0],
    }],
  });
}

for (const sameContent of [false, true]) test(`recovery retains both legal model batches (same-content handles: ${sameContent})`, async () => {
  const first = new Device(), bad = new Device(), second = new Device();
  let calls = 0;
  const restore = install(() => [first, bad, second][calls++]);
  try {
    const renderer = await WebGPURenderer.create(canvas(first));
    const current = recoveryModel(100), next = Array.from({ length: 16 }, (_, i) => recoveryModel(i + 1));
    if (sameContent) {
      // Equal content hashes do not make separately loaded opaque handles interchangeable.
      next[1] = recoveryModel(1);
      equal(next[0].contentId, next[1].contentId);
      equal(next[0] === next[1], false);
    }
    await renderer.preloadSpatialModels([current]);
    // Isolate the facade's successful-frame retention; actual WebGPU submissions
    // and pixels are covered by the browser recovery fixture.
    const backend = Reflect.get(renderer, "backend");
    const submit = backend.renderCommands;
    backend.renderCommands = () => emptyRendererStats();
    try {
      renderer.renderCommands({ spatial: { models: { assets: new Map([[1, current]]) } } } as unknown as RenderCommandBufferView);
    } finally { backend.renderCommands = submit; }
    await renderer.preloadSpatialModels(next);
    await rejects(renderer.preloadSpatialModels([current, ...next]), /asset budget exceeded/);
    first.resolveLost({ reason: "unknown", message: "transition loss" });
    await Promise.resolve();
    bad.queue.onSubmittedWorkDone = async () => { bad.error = true; };
    await rejects(renderer.recoverDevice(), /pipeline validation/);
    equal(renderer.deviceState().status, "lost");
    equal(bad.destroyed, true);
    equal(await renderer.recoverDevice(), true);
    equal(renderer.gpuDevice(), second);
    equal(renderer.deviceState().generation, 2);
    // Both scenes must remain resident: pinning one must not evict the other.
    const oldLease = renderer.prepareSpatialModels([current]);
    oldLease.commit(); oldLease.dispose();
    const newLease = renderer.prepareSpatialModels(next);
    newLease.commit(); newLease.dispose();
    equal(calls, 3);
    renderer.destroy();
  } finally { restore(); }
});

for (const inherited of [false, true]) test(`texture recovery preserves original settings and captured Blob (inherited options: ${inherited})`, async () => {
  const first = new Device(), second = new Device(); let devices = 0;
  const restore = install(() => ++devices === 1 ? first : second);
  const create = WebGpuRendererBackend.create, fetch = globalThis.fetch, bitmap = globalThis.createImageBitmap;
  const calls: { url: string; colorSpace?: string; ktx2Url?: string; signal?: AbortSignal }[] = [];
  const fetched: string[] = [], decoded: Uint8Array[] = [], decodeOptions: (ImageBitmapOptions | undefined)[] = [];
  const source = new Blob([new Uint8Array([7, 8, 9])], { type: "image/png" });
  let started!: () => void, finish!: () => void, closed = 0;
  const ready = new Promise<void>((resolve) => { started = resolve; }), gate = new Promise<void>((resolve) => { finish = resolve; });
  let renderer: WebGPURenderer | undefined;
  WebGpuRendererBackend.create = async (...args) => {
    const backend = await create(...args), load = backend.loadTexture.bind(backend);
    backend.loadTexture = async (id: number | string, url?: string | TextureLoadOptions, options?: TextureLoadOptions) => {
      if (typeof id !== "number") return load(id, typeof url === "object" ? url : undefined);
      if (typeof url !== "string") throw Error("Expected a registered texture URL");
      calls.push({ url, colorSpace: options?.colorSpace, ktx2Url: options?.ktx2Url, signal: options?.signal });
      return load(id, url, options);
    };
    return backend;
  };
  globalThis.fetch = async (url, options) => {
    fetched.push(String(url));
    if (String(url).startsWith("blob:")) return fetch(url, options);
    if (url === "original.png") return new Response(source);
    throw Error("Recovery must use the captured image Blob");
  };
  // Exercise the actual backend/store/facade pipeline; only browser image decoding
  // and GPU objects are fakes. Both decodes must receive the same encoded bytes.
  globalThis.createImageBitmap = (async (input: ImageBitmapSource, options?: ImageBitmapOptions) => {
    if (!(input instanceof Blob)) throw Error("Expected encoded image Blob");
    decoded.push(new Uint8Array(await input.arrayBuffer())); decodeOptions.push(options);
    if (decoded.length === 1) { started(); await gate; }
    return { width: 2, height: 2, close: () => { closed++; } } as ImageBitmap;
  }) as typeof createImageBitmap;
  try {
    renderer = await WebGPURenderer.create(canvas(first));
    const external = new AbortController(), replacement = new AbortController();
    const settings = { colorSpace: "none" as const, ktx2Url: "original.ktx2" };
    const options: TextureLoadOptions = inherited
      ? Object.assign(Object.create(settings), { signal: external.signal })
      : { ...settings, signal: external.signal };
    const loading = renderer.loadTexture(7, "original.png", options);
    await ready;
    options.colorSpace = "srgb"; options.ktx2Url = "mutated.ktx2"; options.signal = replacement.signal;
    finish(); await loading;
    external.abort(); replacement.abort();
    first.resolveLost({ reason: "unknown", message: "restore texture settings" }); await Promise.resolve();
    equal(renderer.deviceState().status, "lost");
    equal(await renderer.recoverDevice(), true);
    equal(renderer.deviceState().status, "ready"); equal(renderer.deviceState().generation, 2); equal(renderer.gpuDevice(), second);
    deepEqual(calls.map(({ colorSpace, ktx2Url }) => ({ colorSpace, ktx2Url })), [
      { colorSpace: "none", ktx2Url: "original.ktx2" }, { colorSpace: "none", ktx2Url: "original.ktx2" },
    ]);
    equal(calls[0].signal, external.signal); equal(calls[1].signal === external.signal, false); equal(calls[1].signal?.aborted, false);
    equal(calls[1].url.startsWith("blob:"), true);
    deepEqual(fetched, ["original.png", calls[1].url]);
    deepEqual(decoded.map((bytes) => Array.from(bytes)), [[7, 8, 9], [7, 8, 9]]);
    deepEqual(decodeOptions, [{ colorSpaceConversion: "none", premultiplyAlpha: "none" }, { colorSpaceConversion: "none", premultiplyAlpha: "none" }]);
    equal(closed, 2);
  } finally {
    finish(); renderer?.destroy(); WebGpuRendererBackend.create = create;
    globalThis.fetch = fetch; globalThis.createImageBitmap = bitmap; restore();
  }
});

test("texture wrapper rejects invalid options before recording a recovery request", async () => {
  const device = new Device(), restore = install(device);
  const renderer = await WebGPURenderer.create(canvas(device));
  try {
    for (const options of [null, []]) await rejects(renderer.loadTexture(7, "invalid.png", options as unknown as TextureLoadOptions), /options must be an object/);
  } finally { renderer.destroy(); restore(); }
});


test("managed WebGPU output initializes and recovers before a successful canvas commit", async () => {
  const first=new Device(),second=new Device();let requests=0;
  const restore=install(()=>++requests===1?first:second);
  try{
    const renderer=await WebGPURenderer.create(canvas(first),{colorManagement:"linear-srgb"});
    equal(renderer.deviceState().status,"ready");
    equal(first.events.indexOf("webgpu")>first.events.lastIndexOf("pop"),true);
    first.resolveLost({reason:"unknown",message:"managed reset"});await Promise.resolve();
    equal(await renderer.recoverDevice(),true);equal(renderer.deviceState().generation,2);
    renderer.destroy();equal(renderer.resourceStats().textureCount,0);
  }finally{restore();}
});
