import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { createWebGL2Program, prepareWebGL2Renderer } from "../src/webgl2ShaderPrograms.js";
import { WEBGL2_SHADER_SOURCES } from "../src/webgl2ShaderSources.js";
import type { ShaderPreparationProgress } from "../src/shaderPreparation.js";

function fixture(parallel = true) {
  const programs = new Set<WebGLProgram>();
  const shaders = new Set<WebGLShader>();
  const submitted: WebGLProgram[] = [];
  const queried: string[] = [];
  let polls = 0;
  let complete = false;
  let lost = false;
  let linked = true;
  const gl = {
    LINK_STATUS: 1, VERTEX_SHADER: 2, FRAGMENT_SHADER: 3,
    createShader: () => { const shader = {}; shaders.add(shader); return shader; },
    createProgram: () => { const program = {}; programs.add(program); return program; },
    shaderSource() {}, compileShader() {}, attachShader() {},
    linkProgram(program: WebGLProgram) { submitted.push(program); },
    getExtension: () => parallel ? { COMPLETION_STATUS_KHR: 4 } : null,
    isContextLost: () => lost,
    getProgramParameter: (_: WebGLProgram, parameter: number) => {
      if (parameter === 4) { queried.push("completion"); if (++polls > 5) complete = true; return complete; }
      queried.push("link");
      if (parallel) equal(complete, true, "link status must not block before completion");
      return linked;
    },
    getProgramInfoLog: () => "link diagnostic", getShaderInfoLog: () => "compile diagnostic",
    deleteShader(shader: WebGLShader) { shaders.delete(shader); },
    deleteProgram(program: WebGLProgram) { programs.delete(program); },
  } as unknown as WebGL2RenderingContext;
  return { gl, programs, shaders, submitted, queried, setLost: () => { lost = true; }, failLink: () => { linked = false; } };
}

function construct(gl: WebGL2RenderingContext) {
  const programs = Object.keys(WEBGL2_SHADER_SOURCES).map((name) => createWebGL2Program(gl, name as keyof typeof WEBGL2_SHADER_SOURCES));
  return { destroy: () => { for (const program of programs) gl.deleteProgram(program); } };
}

test("parallel preparation submits all programs before polling, yields, and transfers without recompilation", async () => {
  const f = fixture();
  const progress: ShaderPreparationProgress[] = [];
  let yielded = false;
  setTimeout(() => { yielded = true; }, 0);
  const renderer = await prepareWebGL2Renderer(f.gl, { onProgress: (value) => progress.push(value) }, () => construct(f.gl));
  equal(yielded, true);
  equal(f.submitted.length, 5);
  equal(f.programs.size, 5);
  equal(f.shaders.size, 0);
  equal(f.queried.filter((v) => v === "link").length, 5);
  equal(progress[0].completedPrograms, 0);
  deepEqual(progress[progress.length - 1], { phase: "ready", completedPrograms: 5, totalPrograms: 5, parallelCompile: true, elapsedMs: progress[progress.length - 1].elapsedMs });
  renderer.destroy();
  equal(f.programs.size, 0);
});

test("unsupported extension yields between status checks and remains compatible with synchronous creation", async () => {
  const f = fixture(false);
  const counts: number[] = [];
  const renderer = await prepareWebGL2Renderer(f.gl, { onProgress: (value) => counts.push(value.completedPrograms) }, () => construct(f.gl));
  deepEqual(counts, [0, 1, 2, 3, 4, 5, 5]);
  equal(f.queried.includes("completion"), false);
  renderer.destroy();
  const sync = createWebGL2Program(f.gl, "sprite");
  equal(f.submitted.length, 6);
  f.gl.deleteProgram(sync);
  equal(f.programs.size + f.shaders.size, 0);
});

test("abort, timeout, context loss, bad shaders and progress failures release all preparation resources", async () => {
  for (const operation of ["abort", "timeout", "lost", "link", "callback", "ready-callback", "constructor"]) {
    const f = fixture();
    const abort = new AbortController();
    const result = prepareWebGL2Renderer(f.gl, {
      signal: abort.signal, timeoutMs: operation === "timeout" ? 1 : 1000,
      onProgress(value) {
        if (operation === "callback" && value.phase === "compiling") throw new Error("callback");
        if (operation === "ready-callback" && value.phase === "ready") throw new Error("callback");
      },
    }, () => { if (operation === "constructor") throw new Error("constructor"); return construct(f.gl); });
    // Scheduled after the initial yield so cancel/loss occurs with live shaders/programs.
    setTimeout(() => {
      if (operation === "abort") abort.abort();
      if (operation === "lost") f.setLost();
      if (operation === "link") f.failLink();
    }, 0);
    let failed = false;
    try { await result; } catch { failed = true; }
    equal(failed, true, operation);
    equal(f.programs.size + f.shaders.size, 0, operation);
  }
});

test("synchronous shader failure and partial allocation failure release intermediate objects", () => {
  const f = fixture(false);
  f.failLink();
  throws(() => createWebGL2Program(f.gl, "sprite"), /compile diagnostic/);
  equal(f.programs.size + f.shaders.size, 0);
  const create = f.gl.createShader.bind(f.gl);
  let allocated = 0;
  f.gl.createShader = (type) => ++allocated === 2 ? null : create(type);
  throws(() => createWebGL2Program(f.gl, "sprite"), /allocation/);
  equal(f.programs.size + f.shaders.size, 0);
});
