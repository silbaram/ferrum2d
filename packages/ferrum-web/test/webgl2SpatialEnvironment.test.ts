import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { WebGL2SpatialEnvironmentPass } from "../src/webgl2SpatialEnvironmentPass.js";
import { compileSpatialEnvironment } from "../src/spatialEnvironment.js";
import type { SpatialRenderBufferView } from "../src/dataSceneSpatial.js";

test("v5 retains spotlight uniforms from v4 and clears them when returning to legacy", () => {
  let cones: number[] = [];
  const noop = () => {};
  // Only record data binding here; the browser fixture covers real shader compilation and pixels.
  const gl = {
    getExtension: () => ({}), createProgram: () => ({}), createShader: () => ({}), createVertexArray: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true,
    getUniformLocation: (_program: unknown, name: string) => name,
    shaderSource: noop, compileShader: noop, attachShader: noop, linkProgram: noop,
    deleteShader: noop, deleteProgram: noop, deleteVertexArray: noop,
    uniform1i: noop, uniform1f: noop, uniform2f: noop, uniform3f: noop, uniform4f: noop,
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
    environment: { version: values.length === 528 ? 5 : values.length === 512 ? 4 : 2, values,
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
    const legacy = compileSpatialEnvironment({ lighting: { lights: [], directional: { direction: { x: 0, y: 0, elevation: 1 } } } });
    pass.bindGeometry(frame(legacy), uniforms);
    deepEqual(cones, Array(32).fill(0), "legacy frames must not inherit the previous spotlight");
  } finally { pass.destroy(); }
});
