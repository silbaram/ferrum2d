import { deepEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";
import { WebGPURenderer, WebGpuCanvasCommitError } from "../src/webgpuRenderer.js";
import { assertWebGpuSpatialSpecSupported } from "../src/webgpuSpatialSupport.js";
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
  destroyed = false;
  events: string[] = [];
  error = false;
  queue = { writeBuffer() {}, writeTexture() {} };
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
    return {};
  }
}
function install(device: Device) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    windowOriginal = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      gpu: {
        requestAdapter: async () => ({ requestDevice: async () => device }),
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
test("unsupported postprocessing rejects before WebGPU context or GPU allocation", async () => {
  const device = new Device(),
    restore = install(device);
  try {
    await rejects(
      WebGPURenderer.create(canvas(device), { postProcess: [{ kind: "bloom" }] }),
      /only fade/,
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
