import { equal } from "node:assert/strict";
import { test } from "node:test";
import { WebGL2SpatialPass } from "../src/webgl2SpatialPass.js";
import type { SpatialRenderBufferView } from "../src/dataSceneSpatial.js";

function setup() {
  const constants = new Map<string, number>(), uploads: ArrayBufferView[] = [];
  const methods: Record<string, unknown> = {
    createProgram: () => ({}), createShader: () => ({}), createBuffer: () => ({}), createVertexArray: () => ({}),
    createSampler: () => ({}), createRenderbuffer: () => ({}), createTexture: () => ({}), createFramebuffer: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: () => ({}),
    getExtension: () => ({}), getError: () => gl.NO_ERROR, isContextLost: () => false, isEnabled: () => false,
    bufferData: (_target: number, data: unknown) => { if (ArrayBuffer.isView(data)) uploads.push(data); },
    getParameter: (name: number) => {
      if (name === gl.MAX_TEXTURE_SIZE || name === gl.MAX_RENDERBUFFER_SIZE) return 8192;
      if (name === gl.VIEWPORT || name === gl.SCISSOR_BOX) return new Int32Array([0, 0, 320, 240]);
      if (name === gl.COLOR_WRITEMASK) return [true, true, true, true];
      if (name === gl.COLOR_CLEAR_VALUE) return new Float32Array(4);
      return 0;
    },
    checkFramebufferStatus: () => gl.FRAMEBUFFER_COMPLETE,
  };
  const gl = new Proxy(methods, { get: (object, key: string) => {
    if (key in object) return object[key];
    if (/^[A-Z_0-9]+$/.test(key)) { if (!constants.has(key)) constants.set(key, constants.size + 1); return constants.get(key); }
    return () => {};
  } }) as unknown as WebGL2RenderingContext;
  const camera = new Float32Array(28); camera.set([0, 100, 100, 100, 0, 0, 0, 200, .1, 1000, 320, 240], 16);
  const frame: SpatialRenderBufferView = { version: 2, vertexStride: 11, camera,
    terrain: new Float32Array(), terrainVertexCount: 0, terrainRevision: 1, terrainDrawRanges: new Uint32Array(),
    billboards: new Float32Array(), billboardVertexCount: 0 };
  const pass = new WebGL2SpatialPass(gl);
  return { pass, frame, uploads, draw: () => pass.draw(frame, { texture: () => { throw Error("unexpected texture"); } }) };
}

test("terrain subviews with the same buffer/revision upload their own byte range", () => {
  const { pass, frame, draw, uploads } = setup(), data = new Float32Array(36 * 11 * 2);
  for (let i = 0; i < data.length; i += 11) data[i + 9] = 16777215;
  const first = data.subarray(0, 36 * 11), second = data.subarray(36 * 11);
  frame.terrain = first; frame.terrainVertexCount = 36; frame.terrainDrawRanges = new Uint32Array([0, 36]);
  try {
    equal(draw().terrainUploadBytes, first.byteLength); equal(draw().terrainUploadBytes, 0);
    frame.terrain = second;
    equal(draw().terrainUploadBytes, second.byteLength, "changing only byteOffset must refresh GPU vertices");
    equal(uploads[uploads.length - 1], second);
    equal(draw().terrainUploadBytes, 0, "unchanged subview remains warm");
    frame.terrain = data; frame.terrainVertexCount = 72; frame.terrainDrawRanges = new Uint32Array([0, 72]);
    equal(draw().terrainUploadBytes, data.byteLength, "length changes must update the stream too");
    frame.terrain = first; frame.terrainVertexCount = 36; frame.terrainDrawRanges = new Uint32Array([0, 36]);
    equal(draw().terrainUploadBytes, first.byteLength, "length-only changes also refresh GPU storage");
  } finally { pass.destroy(); }
});

test("effect-free Spatial frames reuse fixed shadow metadata instead of allocating it every frame", () => {
  const { pass, draw } = setup(), original = globalThis.Uint32Array;
  let snapshots = 0;
  globalThis.Uint32Array = new Proxy(original, { construct(target, args, newTarget) {
    if (args[0] === 1024 * 18) snapshots++;
    return Reflect.construct(target, args, newTarget);
  } });
  try {
    draw(); draw(); draw();
    equal(snapshots, 0, "steady frames cannot allocate model cache capacity");
  } finally { globalThis.Uint32Array = original; pass.destroy(); }
});
