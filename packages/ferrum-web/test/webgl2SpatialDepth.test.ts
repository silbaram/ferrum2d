import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { WebGL2SpatialPass } from "../src/webgl2SpatialPass.js";
import type { SpatialRenderBufferView } from "../src/dataSceneSpatial.js";

test("cached scene depth detaches after every draw and retries storage after a failed resize", () => {
  const constants = new Map<string, number>(), target = {}, priorBuffer = {};
  let width = 320, complete = true, attached: unknown, renderbuffer: unknown = priorBuffer, storage = 0;
  const methods: Record<string, unknown> = {
    createProgram: () => ({}), createShader: () => ({}), createBuffer: () => ({}), createVertexArray: () => ({}), createSampler: () => ({}), createRenderbuffer: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: () => ({}),
    getError: () => gl.NO_ERROR, isContextLost: () => false, isEnabled: () => false,
    getParameter: (name: number) => {
      if (name === gl.DRAW_FRAMEBUFFER_BINDING) return target;
      if (name === gl.READ_FRAMEBUFFER_BINDING) return null;
      if (name === gl.RENDERBUFFER_BINDING) return renderbuffer;
      if (name === gl.VIEWPORT || name === gl.SCISSOR_BOX) return new Int32Array([0, 0, width, 240]);
      if (name === gl.COLOR_WRITEMASK) return [true, true, true, true];
      if (name === gl.COLOR_CLEAR_VALUE) return new Float32Array(4);
      return 0;
    },
    bindRenderbuffer: (_target: number, value: unknown) => { renderbuffer = value; },
    renderbufferStorage: () => { storage++; },
    framebufferRenderbuffer: (_target: number, _attachment: number, _type: number, value: unknown) => { attached = value; },
    checkFramebufferStatus: () => complete ? gl.FRAMEBUFFER_COMPLETE : 0,
  };
  const gl = new Proxy(methods, { get: (object, key: string) => {
    if (key in object) return object[key];
    if (/^[A-Z_0-9]+$/.test(key)) { if (!constants.has(key)) constants.set(key, constants.size + 1); return constants.get(key); }
    return () => {};
  } }) as unknown as WebGL2RenderingContext;
  const pass = new WebGL2SpatialPass(gl), frame: SpatialRenderBufferView = {
    version: 2, vertexStride: 11, camera: new Float32Array(28), terrain: new Float32Array(), terrainVertexCount: 0,
    terrainRevision: 1, terrainDrawRanges: new Uint32Array(), billboards: new Float32Array(), billboardVertexCount: 0,
  };
  const draw = () => pass.draw(frame, { texture: () => { throw Error("empty frame cannot look up textures"); } });
  try {
    equal(draw().depthBufferBytes, 320 * 240 * 4);
    equal(attached, null); equal(renderbuffer, priorBuffer); equal(storage, 1);
    draw(); equal(storage, 1); equal(attached, null);
    width = 640; complete = false;
    throws(draw, /Spatial depth target incomplete/);
    equal(attached, null); equal(renderbuffer, priorBuffer); equal(storage, 2);
    complete = true;
    equal(draw().depthBufferBytes, 640 * 240 * 4);
    equal(storage, 3, "a failed storage resize must not be published as a warm allocation");
    deepEqual([attached, renderbuffer], [null, priorBuffer]);
  } finally { pass.destroy(); }
});
