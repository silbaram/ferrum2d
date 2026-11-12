import { WebGL2SpatialBloom } from "../src/webgl2SpatialBloom.js";
import { WebGL2SpatialLightShafts } from "../src/webgl2SpatialLightShafts.js";
import { spatialLightShaftPlan } from "../src/spatialLightShaftKernel.js";
import { spatialBloomPlan } from "../src/spatialBloomKernel.js";
import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { WebGL2SpatialEnvironmentPass } from "../src/webgl2SpatialEnvironmentPass.js";
import { compileSpatialEnvironment } from "../src/spatialEnvironment.js";
import type { SpatialRenderBufferView } from "../src/dataSceneSpatial.js";

test("optional indirect MRT releases partial allocations, retries, and frees scratch when disabled", () => {
  const textures = new Set<object>(), targets = new Set<object>();
  let attempts = 0, failAt = Infinity;
  const constants = new Map<string, number>();
  const methods: Record<string, unknown> = {
    getExtension: () => ({}), createProgram: () => ({}), createShader: () => ({}), createVertexArray: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: () => ({}),
    createTexture: () => { if (++attempts === failAt) return null; const texture = {}; textures.add(texture); return texture; },
    createFramebuffer: () => { const target = {}; targets.add(target); return target; },
    deleteTexture: (texture: object) => textures.delete(texture), deleteFramebuffer: (target: object) => targets.delete(target),
    checkFramebufferStatus: () => constants.get("FRAMEBUFFER_COMPLETE"),
  };
  const gl = new Proxy(methods, { get: (object, key: string) => {
    if (key in object) return object[key];
    if (/^[A-Z_0-9]+$/.test(key)) { if (!constants.has(key)) constants.set(key, constants.size + 1); return constants.get(key); }
    return () => {};
  } }) as unknown as WebGL2RenderingContext;
  // Install the completion constant before the recorder is queried.
  void gl.FRAMEBUFFER_COMPLETE;
  const pass = new WebGL2SpatialEnvironmentPass(gl, false);
  const values = compileSpatialEnvironment({ composition: "separated", lighting: { lights: [] }, ambientOcclusion: {} });
  const frame = { environment: { values } } as SpatialRenderBufferView;
  try {
    failAt = 4;
    throws(() => pass.prepare(frame, 160, 90), /texture allocation failed/);
    equal(textures.size, 2); equal(targets.size, 1);
    failAt = Infinity; pass.prepare(frame, 160, 90);
    equal(textures.size, 4); equal(targets.size, 2);
    const warmAttempts = attempts; pass.prepare(frame, 160, 90); equal(attempts, warmAttempts);
    const disabled = { environment: { values: compileSpatialEnvironment({ lighting: { lights: [] } }) } } as SpatialRenderBufferView;
    pass.prepare(disabled, 160, 90); equal(textures.size, 2); equal(targets.size, 1);
  } finally { pass.destroy(); }
  equal(textures.size, 0); equal(targets.size, 0);
});

test("v5 spotlight and v11 PCSS uniforms upload and clear when returning to legacy", () => {
  let cones: number[] = [];
  let pcss: number[] = [];
  let heightFog: number[] = [];
  const pointPcss = new Map<string, number[]>();
  const noop = () => {};
  // Only record data binding here; the browser fixture covers real shader compilation and pixels.
  const gl = {
    getExtension: () => ({}), createProgram: () => ({}), createShader: () => ({}), createVertexArray: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true,
    getUniformLocation: (_program: unknown, name: string) => name,
    shaderSource: noop, compileShader: noop, attachShader: noop, linkProgram: noop,
    deleteShader: noop, deleteProgram: noop, deleteVertexArray: noop,
    uniform1i: noop, uniform1f: noop, uniform2f: noop, uniform4f: (name: unknown, ...v: number[]) => { if (name === "heightFog") heightFog = v; },
    uniform3f: (name: unknown, ...values: number[]) => { if (name === "sunPcss") pcss = values; else if (name === "pointPcss" || name === "pointPcss2") pointPcss.set(name, values); },
    uniform3fv: noop, uniformMatrix4fv: noop, activeTexture: noop, bindSampler: noop, bindTexture: noop,
    uniform4fv: (name: unknown, value: Float32Array) => { if (name === "lightCone") cones = Array.from(value); },
  } as unknown as WebGL2RenderingContext;
  const pass = new WebGL2SpatialEnvironmentPass(gl, false);
  // String locations let the GL recorder identify the uploaded uniform.
  const uniforms = new Proxy({} as Record<string, WebGLUniformLocation>, { get: (_target, name) => name });
  const camera = new Float32Array(28);
  camera.set([0, 100, 100, 100, 0, 0, 0, 200, .1, 1000, 640, 480], 16);
  const frame = (values: Float32Array): SpatialRenderBufferView => ({
    version: 1, vertexStride: 11, camera, terrain: new Float32Array(), terrainVertexCount: 0,
    terrainRevision: 1, billboards: new Float32Array(), billboardVertexCount: 0,
    environment: { version: values.length === 616 ? 13 : values.length === 608 ? 12 : values.length === 600 ? 11 : values.length === 528 ? 5 : values.length === 512 ? 4 : 2, values,
      shadowMatrices: new Float32Array((values[2] >= 0 ? 96 : 0) + (values[92] > 0 ? 16 : 0)), shadowCasters: new Float32Array(), shadowCasterVertexCount: 0 },
  });
  const light = { position: { x: 80, y: -80, elevation: 100 }, radius: 400,
    spot: { direction: { x: -1, y: 1, elevation: -2 }, angle: 70, penumbra: .25 } };
  try {
    for (const center of [undefined, { x: 16, y: -12, elevation: 8 }]) {
      const values = compileSpatialEnvironment({ lighting: { lights: [light], directional: {
        direction: { x: -1, y: -1, elevation: 2 }, shadows: { ...(center ? { center } : {}) },
      } } });
      equal(values.length, center ? 528 : 512);
      pass.bindGeometry(frame(values), uniforms);
      equal(cones[5], 1, "a v5 center must not turn a spotlight into an omnidirectional light");
      deepEqual(cones, Array.from(values.subarray(144, 176)));
    }
    const soft = compileSpatialEnvironment({ lighting: { lights: [], directional: { direction: { x: 0, y: 0, elevation: 1 },
      shadows: { distance: 300, extent: 100, resolution: 512, pcss: {} } } } });
    pass.bindGeometry(frame(soft), uniforms);
    deepEqual(pcss, [1, Math.tan(.5 * Math.PI / 180) * 300 * 512 / 100, 16]);
    const points = compileSpatialEnvironment({ lighting: { lights: [light, light], pointShadows: [
      { lightIndex: 1, pcss: { sourceRadius: 0, maxRadiusTexels: 32 } }, { lightIndex: 0, pcss: {} },
    ] } });
    pass.bindGeometry(frame(points), uniforms);
    deepEqual(pointPcss.get("pointPcss"), [1, 0, 32]); deepEqual(pointPcss.get("pointPcss2"), [1, 1, 16]);
    const height = compileSpatialEnvironment({ fog: { color: [1, 1, 1], start: 0, end: 400, height: { baseHeight: 5, density: .25, falloff: 2 } } });
    pass.bindGeometry(frame(height), uniforms); deepEqual(heightFog, [1, 5, .25, 2]);
    const legacy = compileSpatialEnvironment({ lighting: { lights: [], directional: { direction: { x: 0, y: 0, elevation: 1 } } } });
    pass.bindGeometry(frame(legacy), uniforms);
    deepEqual(heightFog, [0, 0, 0, 0]);
    deepEqual(cones, Array(32).fill(0), "legacy frames must not inherit the previous spotlight");
    deepEqual(pointPcss.get("pointPcss"), [0, 0, 0]); deepEqual(pointPcss.get("pointPcss2"), [0, 0, 0]);
    deepEqual(pcss, [0, 0, 0], "legacy frames must not inherit the previous PCSS filter");
  } finally { pass.destroy(); }
});


test("wide GL chain preserves old targets on partial allocation failure, retries and releases on OFF", () => {
  const textures = new Set<object>(), targets = new Set<object>(), constants = new Map<string, number>();
  let attempts = 0, failAt = Infinity, draws = 0;
  const methods: Record<string, unknown> = {
    createProgram: () => ({}), createShader: () => ({}), createVertexArray: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: () => ({}),
    createTexture: () => { if (++attempts === failAt) return null; const texture = {}; textures.add(texture); return texture; },
    createFramebuffer: () => { const target = {}; targets.add(target); return target; },
    deleteTexture: (t: object) => textures.delete(t), deleteFramebuffer: (t: object) => targets.delete(t),
    drawArrays: () => { draws++; }, checkFramebufferStatus: () => constants.get("FRAMEBUFFER_COMPLETE"),
  };
  const gl = new Proxy(methods, { get: (o, key: string) => {
    if (key in o) return o[key];
    if (/^[A-Z_0-9]+$/.test(key)) { if (!constants.has(key)) constants.set(key, constants.size + 1); return constants.get(key); }
    return () => {};
  } }) as unknown as WebGL2RenderingContext;
  void gl.FRAMEBUFFER_COMPLETE;
  const pass = new WebGL2SpatialBloom(gl);
  const v = compileSpatialEnvironment({ composition: "separated", bloom: { mode: "wide", radius: 64 } });
  const plan = spatialBloomPlan(v, 128, 128, 128)!;
  pass.prepare(plan); equal(pass.targetCount(), plan.levels.length + 1); equal(pass.textureBytes(), plan.textureBytes);
  const warm = attempts; pass.prepare(plan); equal(attempts, warm);
  pass.draw({} as WebGLTexture, plan, 1); equal(draws, plan.drawCalls);
  const larger = spatialBloomPlan(v, 256, 192, 192)!; failAt = attempts + 2;
  throws(() => pass.prepare(larger), /allocation failed/);
  equal(textures.size, plan.levels.length + 1); equal(pass.textureBytes(), plan.textureBytes);
  failAt = Infinity; pass.prepare(larger); equal(pass.textureBytes(), larger.textureBytes);
  pass.prepare(); equal(textures.size, 0); equal(targets.size, 0); pass.destroy();
});

test("light shafts GL target survives failed resize, reuses warm allocations and releases on OFF", () => {
  const textures = new Set<object>(), targets = new Set<object>(), constants = new Map<string, number>();
  let attempts = 0, complete = true, draws = 0;
  const methods: Record<string, unknown> = {
    createProgram: () => ({}), createShader: () => ({}), createVertexArray: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: () => ({}),
    createTexture: () => { attempts++; const texture = {}; textures.add(texture); return texture; },
    createFramebuffer: () => { const target = {}; targets.add(target); return target; },
    deleteTexture: (t: object) => textures.delete(t), deleteFramebuffer: (t: object) => targets.delete(t),
    drawArrays: () => { draws++; }, checkFramebufferStatus: () => complete ? constants.get("FRAMEBUFFER_COMPLETE") : -1,
  };
  const gl = new Proxy(methods, { get: (o, key: string) => {
    if (key in o) return o[key];
    if (/^[A-Z_0-9]+$/.test(key)) { if (!constants.has(key)) constants.set(key, constants.size + 1); return constants.get(key); }
    return () => {};
  } }) as unknown as WebGL2RenderingContext;
  void gl.FRAMEBUFFER_COMPLETE;
  const pass = new WebGL2SpatialLightShafts(gl);
  const v = compileSpatialEnvironment({ composition: "separated", lighting: { lights: [], directional: { direction: { x: 0, y: 0, elevation: 1 }, shadows: {} } }, lightShafts: {} });
  const plan = spatialLightShaftPlan(v, 160, 90)!;
  pass.prepare(plan); equal(pass.targetCount(), 1); equal(pass.textureBytes(), 80 * 45 * 8);
  const warm = attempts; pass.prepare(plan); equal(attempts, warm);
  complete = false;
  throws(() => pass.prepare(spatialLightShaftPlan(v, 321, 181)), /target incomplete/);
  equal(textures.size, 1); equal(targets.size, 1); equal(pass.textureBytes(), 80 * 45 * 8);
  complete = true;
  const camera = new Float32Array(28); camera.set([0, 0, 80, 100, 0, 0, 0, 150, .1, 800, 160, 90], 16);
  pass.draw({ camera, environment: { values: v, shadowMatrices: new Float32Array(16) } } as SpatialRenderBufferView, plan, {} as WebGLTexture, {} as WebGLTexture, 160, 90);
  equal(draws, 1);
  pass.prepare(spatialLightShaftPlan(v, 321, 181)); equal(pass.textureBytes(), 161 * 91 * 8);
  pass.prepare(); equal(textures.size, 0); equal(targets.size, 0); pass.destroy();
});

test("probe uniforms upload all eight rows and clear on OFF/legacy packets", () => {
  const values = new Map<string, number[]>(), constants = new Map<string, number>();
  const methods: Record<string, unknown> = {
    getExtension: () => ({}), createProgram: () => ({}), createShader: () => ({}), createVertexArray: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: (_p: unknown, key: string) => key,
    uniform1i: (key: string, v: number) => values.set(key, [v]), uniform4fv: (key: string, v: Float32Array) => values.set(key, [...v]),
  };
  const gl = new Proxy(methods, { get: (object, key: string) => {
    if (key in object) return object[key];
    if (/^[A-Z_0-9]+$/.test(key)) { if (!constants.has(key)) constants.set(key, constants.size + 1); return constants.get(key); }
    return () => {};
  } }) as unknown as WebGL2RenderingContext;
  const pass = new WebGL2SpatialEnvironmentPass(gl, false);
  const u = new Proxy({} as Record<string, WebGLUniformLocation>, { get: (_t, key) => key });
  const camera = new Float32Array(28); camera.set([0, 100, 100, 100, 0, 0, 0, 200, .1, 1000, 640, 480], 16);
  const probes = Array.from({ length: 8 }, (_, i) => ({ position: { x: i, y: -i, elevation: 16 }, radius: 32, intensity: i / 2 }));
  for (const active of [true, false, undefined]) {
    const v = compileSpatialEnvironment({ lighting: { lights: [], ...(active === undefined ? {} : { enabled: active, probes }) } });
    pass.bindGeometry({ camera, environment: { values: v } } as SpatialRenderBufferView, u);
    equal(values.get("probeCount")![0], active ? 8 : 0);
    deepEqual(values.get("probePosition")!.slice(-4), active ? [7, 16, 7, 32] : [0, 0, 0, 0]);
    deepEqual(values.get("probeColor")!.slice(-4), active ? [1, 1, 1, 3.5] : [0, 0, 0, 0]);
  }
  pass.destroy();
});
