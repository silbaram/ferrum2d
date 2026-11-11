import { equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { WebGL2SpatialPass } from "../src/webgl2SpatialPass.js";
import { compileSpatialEnvironment } from "../src/spatialEnvironment.js";
import type { SpatialRenderBufferView } from "../src/dataSceneSpatial.js";

for (const target of ["primary", "secondary", "sun"] as const) {
  test(`failed ${target} shadow redraw after resize cannot reuse the old cache`, () => {
    const constants = new Map<string, number>(), textures = new Set<object>(), targets = new Set<object>();
    let viewportWidth = 320, fail = false;
    const methods: Record<string, unknown> = {
      createProgram: () => ({}), createShader: () => ({}), createBuffer: () => ({}), createVertexArray: () => ({}),
      createSampler: () => ({}), createRenderbuffer: () => ({}),
      createTexture: () => { const value = {}; textures.add(value); return value; },
      createFramebuffer: () => { const value = {}; targets.add(value); return value; },
      deleteTexture: (value: object) => textures.delete(value), deleteFramebuffer: (value: object) => targets.delete(value),
      getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: () => ({}),
      getExtension: () => ({}), getError: () => gl.NO_ERROR, isContextLost: () => false, isEnabled: () => false,
      getParameter: (name: number) => {
        if (name === gl.MAX_TEXTURE_SIZE || name === gl.MAX_RENDERBUFFER_SIZE) return 8192;
        if (name === gl.VIEWPORT || name === gl.SCISSOR_BOX) return new Int32Array([0, 0, 320, 240]);
        if (name === gl.COLOR_WRITEMASK) return [true, true, true, true];
        if (name === gl.COLOR_CLEAR_VALUE) return new Float32Array(4);
        return 0;
      },
      checkFramebufferStatus: () => gl.FRAMEBUFFER_COMPLETE,
      viewport: (_x: number, _y: number, width: number) => { viewportWidth = width; },
      clear: () => { if (fail && viewportWidth === 512) { fail = false; throw Error("injected shadow draw failure"); } },
    };
    const gl = new Proxy(methods, { get: (object, key: string) => {
      if (key in object) return object[key];
      if (/^[A-Z_0-9]+$/.test(key)) { if (!constants.has(key)) constants.set(key, constants.size + 1); return constants.get(key); }
      return () => {};
    } }) as unknown as WebGL2RenderingContext;
    const values = compileSpatialEnvironment({ lighting: {
      lights: [0, 1].map(x => ({ position: { x, y: 0, elevation: 20 }, radius: 100 })),
      pointShadows: [{ lightIndex: 0, resolution: 128 }, { lightIndex: 1, resolution: 256 }],
      ...(target === "sun" ? { directional: { direction: { x: 0, y: 0, elevation: 1 }, shadows: { resolution: 128 as const } } } : {}),
    } });
    const camera = new Float32Array(28); camera.set([0, 100, 100, 100, 0, 0, 0, 200, .1, 1000, 320, 240], 16);
    const frame: SpatialRenderBufferView = {
      version: 2, vertexStride: 11, camera, terrain: new Float32Array(), terrainVertexCount: 0,
      terrainRevision: 1, terrainDrawRanges: new Uint32Array(), billboards: new Float32Array(), billboardVertexCount: 0,
      environment: { version: 10, values, shadowMatrices: new Float32Array(target === "sun" ? 208 : 192),
        shadowCasters: new Float32Array(), shadowCasterVertexCount: 0, shadowSubmission: { version: 1, revision: 1, ranges: new Uint32Array() } },
    };
    const pass = new WebGL2SpatialPass(gl), count = target === "sun" ? 13 : 12;
    const draw = () => pass.draw(frame, { texture: () => { throw Error("empty geometry has no source textures"); } });
    try {
      equal(draw().shadowPassCount, count); equal(draw().shadowCacheHit, true);
      if (target === "primary") values[3] = values[139] = 512;
      else values[target === "secondary" ? 585 : 92] = 512;
      fail = true; throws(draw, /injected shadow draw failure/);
      equal(draw().shadowPassCount, target === "sun" ? 1 : 6, "the retry redraws the changed map and preserves other cached maps");
      equal(draw().shadowPassCount, 0, "a completed retry may be cached");
    } finally { pass.destroy(); }
    equal(textures.size, 0); equal(targets.size, 0);
  });
}
