import { equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { WebGpuPixelPerfect } from "../src/webgpuPixelPerfect.js";
import { webGpuResources } from "../src/webgpuResources.js";

test("managed presentation target replacement rolls back failed bindings and reuses warm allocations", () => {
  Object.assign(globalThis, { GPUTextureUsage: { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4, COPY_SRC: 1 } });
  let fail = false, attempts = 0;
  const textures: { destroyed: boolean }[] = [];
  const device = {
    limits: { maxTextureDimension2D: 1024 }, createSampler: () => ({}), createShaderModule: () => ({}),
    createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createTexture: () => {
      attempts++;
      const texture = { destroyed: false, createView: () => ({}), destroy() { this.destroyed = true; } };
      textures.push(texture); return texture;
    },
    createBindGroup: () => { if (fail) throw Error("presentation binding failed"); return {}; },
  } as unknown as GPUDevice;
  const target = new WebGpuPixelPerfect(device, "rgba8unorm-srgb", "bgra8unorm", true, false);
  try {
    target.resize(64, 48); const previous = target.texture();
    equal(webGpuResources(device).stats().renderTargetCount, 1); equal(webGpuResources(device).stats().textureBytes, 64 * 48 * 4);
    target.resize(64, 48); equal(attempts, 1);
    fail = true; throws(() => target.resize(80, 60), /binding failed/);
    equal(target.texture(), previous); equal(textures[0].destroyed, false); equal(textures[1].destroyed, true);
    equal(webGpuResources(device).stats().textureBytes, 64 * 48 * 4);
    fail = false; target.resize(80, 60); equal(webGpuResources(device).stats().renderTargetCount, 1);
    throws(() => target.resize(2048, 1), /dimensions/); equal(attempts, 3);
    target.release(); equal(webGpuResources(device).stats().textureCount, 0);
  } finally { target.release(); webGpuResources(device).destroyAll(); }
  ok(textures.every(texture => texture.destroyed));
});
