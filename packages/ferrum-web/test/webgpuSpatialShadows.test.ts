import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { WebGpuSpatialShadows } from "../src/webgpuSpatialShadows.js";
import { compileSpatialEnvironment } from "../src/spatialEnvironment.js";
import type { SpatialRenderBufferView } from "../src/dataSceneSpatial.js";
class Texture {
  destroyed = 0;
  constructor(
    readonly descriptor: GPUTextureDescriptor,
    private readonly check: () => void,
  ) {}
  destroy() {
    this.destroyed++;
  }
  createView(d: GPUTextureViewDescriptor = {}) {
    this.check();
    return { texture: this, descriptor: d };
  }
}
class Device {
  limits = { maxTextureDimension2D: 8192 };
  textures: Texture[] = [];
  failView = false;
  error = "";
  scopes = 0;
  createTexture(d: GPUTextureDescriptor) {
    const t = new Texture(d, () => {
      if (this.failView) throw Error("view failed");
    });
    this.textures.push(t);
    return t;
  }
  pushErrorScope() {
    this.scopes++;
  }
  async popErrorScope() {
    this.scopes--;
    const message = this.error;
    this.error = "";
    return message ? { message } : null;
  }
}
function frame(point = 256, sun = 128): SpatialRenderBufferView {
  const values = compileSpatialEnvironment({
    lighting: {
      lights: point ? [{ position: { x: 0, y: 0, elevation: 100 }, radius: 300 }] : [],
      ...(point ? { shadows: { lightIndex: 0, resolution: point as 256 } } : {}),
      ...(sun
        ? {
            directional: {
              direction: { x: -1, y: -1, elevation: 2 },
              shadows: { resolution: sun as 128 },
            },
          }
        : {}),
    },
  });
  return {
    version: 2,
    vertexStride: 11,
    camera: new Float32Array(28),
    terrain: new Float32Array(),
    terrainVertexCount: 0,
    terrainRevision: 1,
    terrainDrawRanges: new Uint32Array(),
    billboards: new Float32Array(),
    billboardVertexCount: 0,
    environment: {
      version: values.length === 112 ? 2 : 1,
      values,
      shadowMatrices: new Float32Array((point ? 96 : 0) + (sun ? 16 : 0)),
      shadowCasters: new Float32Array(),
      shadowCasterVertexCount: 0,
    },
  };
}
function setup() {
  Object.assign(globalThis, { GPUTextureUsage: { TEXTURE_BINDING: 1, RENDER_ATTACHMENT: 2 } });
  const device = new Device(),
    shadows = new WebGpuSpatialShadows(device as unknown as GPUDevice);
  return { device, shadows };
}
test("point six faces and sun use distinct layers, reuse warm targets and release on resize/disable/destroy", () => {
  const { device, shadows } = setup(),
    f = frame();
  equal(shadows.ready(f), false);
  shadows.prepare(f);
  equal(shadows.ready(f), false);
  const views = shadows.views(),
    count = device.textures.length;
  shadows.prepare(f);
  equal(device.textures.length, count);
  deepEqual(shadows.views(), views);
  equal(shadows.textureBytes(), 256 * 256 * 24 + 128 * 128 * 4);
  const descriptors: GPURenderPassDescriptor[] = [],
    faces: number[] = [];
  const encoder = {
    beginRenderPass(d: GPURenderPassDescriptor) {
      descriptors.push(d);
      return { end() {} };
    },
  } as unknown as GPUCommandEncoder;
  equal(
    shadows.draw(encoder, (_p, face) => faces.push(face)),
    7,
  );
  equal(shadows.ready(f), false);
  shadows.commitSubmission();
  equal(shadows.ready(f), true);
  deepEqual(faces, [0, 1, 2, 3, 4, 5, 6]);
  deepEqual(
    descriptors.slice(0, 6).map(
      (d) =>
        (
          d.depthStencilAttachment!.view as {
            descriptor: GPUTextureViewDescriptor;
          }
        ).descriptor.baseArrayLayer,
    ),
    [0, 1, 2, 3, 4, 5],
  );
  equal(new Set(descriptors.map((d) => d.depthStencilAttachment!.view)).size, 7);
  shadows.prepare(frame(128, 128));
  equal(device.textures[2].destroyed, 1);
  equal(device.textures[3].destroyed, 0);
  shadows.prepare(frame(0, 0));
  equal(shadows.textureBytes(), 0);
  equal(
    device.textures.slice(2).every((t) => t.destroyed === 1),
    true,
  );
  shadows.destroy();
  shadows.destroy();
  equal(
    device.textures.every((t) => t.destroyed === 1),
    true,
  );
  throws(() => shadows.prepare(f), /destroyed/);
});
test("shadow resize sync failure keeps old target and current async GPU failure is explicit", async () => {
  const { device, shadows } = setup(),
    f = frame(256, 0);
  shadows.prepare(f);
  const before = shadows.views();
  device.failView = true;
  throws(() => shadows.prepare(frame(512, 0)), /view failed/);
  equal(shadows.views().point, before.point);
  equal(device.textures[2].destroyed, 0);
  equal(device.textures[3].destroyed, 1);
  device.failView = false;
  device.error = "out of memory";
  shadows.prepare(frame(512, 0));
  for (let i = 0; i < 4; i++) await Promise.resolve();
  equal(device.scopes, 0);
  throws(() => shadows.validate(f), /GPU allocation failed/);
  shadows.destroy();
  equal(
    device.textures.every((t) => t.destroyed === 1),
    true,
  );
});
test("stale shadow allocation errors cannot destroy a replacement or resurrect disabled/destroyed targets", async () => {
  for (const action of ["resize", "disable", "destroy"]) {
    const { device, shadows } = setup();
    device.error = "obsolete";
    shadows.prepare(frame(256, 0));
    if (action === "resize") shadows.prepare(frame(512, 0));
    else if (action === "disable") shadows.prepare(frame(0, 0));
    else shadows.destroy();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    equal(device.scopes, 0);
    if (action === "resize") {
      shadows.validate(frame(512, 0));
      equal(shadows.ready(frame(512, 0)), false);
    } else equal(shadows.textureBytes(), 0);
    shadows.destroy();
    equal(
      device.textures.every((t) => t.destroyed === 1),
      true,
    );
  }
});
