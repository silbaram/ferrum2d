import { createFerrumRuntime, WebGL2Renderer, LoadingOverlay } from "@ferrum2d/ferrum-web/core";
import { sceneCommands } from "./data-scene-render-fixture.mjs";

function assert(value, message) { if (!value) throw new Error(message); }
function observe(gl) {
  const live = {}, counts = {};
  for (const kind of ["Shader", "Program", "Texture", "Framebuffer", "Buffer", "VertexArray"]) {
    const values = live[kind] = new Set(); counts[kind] = 0;
    const create = gl[`create${kind}`].bind(gl), release = gl[`delete${kind}`].bind(gl);
    gl[`create${kind}`] = (...args) => { const value = create(...args); if (value) { values.add(value); counts[kind]++; } return value; };
    gl[`delete${kind}`] = (value) => { values.delete(value); release(value); };
  }
  return { counts, checkEmpty() { for (const [kind, values] of Object.entries(live)) assert(values.size === 0, `${kind} leaked: ${values.size}`); } };
}
function setup() {
  const canvas = document.createElement("canvas"); document.body.appendChild(canvas);
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
  assert(gl, "WebGL2 required");
  return { canvas, gl, observed: observe(gl) };
}
function finish(f) { f.observed.checkEmpty(); f.gl.getExtension("WEBGL_lose_context")?.loseContext(); f.canvas.remove(); }
const passes = [
  { kind: "fade", color: [0, 0, 0], opacity: 0.1 },
  { kind: "bloom", threshold: 0.7, intensity: 0.1, radius: 1 },
  { kind: "vignette", intensity: 0.1, radius: 0.7, softness: 0.3 },
];

async function run() {
  const dense = await sceneCommands(Array.from({ length: 1024 }, (_, i) => ({ rect: [(i % 32) * 4, Math.floor(i / 32) * 4, 4, 4] })), 0);
  const reports = [];
  for (const colorManagement of ["legacy", "linear-srgb"]) for (const postProcess of [false, true]) {
    let reference;
    for (const async of [false, true]) {
      const f = setup();
      const { canvas, gl, observed } = f;
      const progress = [];
      const nativeParallelCompile = Boolean(gl.getExtension("KHR_parallel_shader_compile"));
      const options = { colorManagement, preserveDrawingBuffer: true, postProcess: postProcess ? passes : undefined };
      let ticks = 0;
      const interval = setInterval(() => ticks++, 0);
      const start = performance.now();
      const renderer = async ? await WebGL2Renderer.create(canvas, options, { onProgress: (p) => progress.push(p) }) : new WebGL2Renderer(canvas, options);
      const initializationMs = performance.now() - start;
      clearInterval(interval);
      try {
        assert(initializationMs < 5000, "initialization smoke watchdog exceeded");
        assert(observed.counts.Program === 5 && observed.counts.Shader === 10, "programs must compile exactly once");
        if (async) {
          assert(ticks > 0, "async preparation must yield to loading UI");
          assert(progress[0].completedPrograms === 0 && progress.at(-1).phase === "ready" && progress.at(-1).completedPrograms === 5, "readiness progress");
          assert(progress.at(-1).parallelCompile === nativeParallelCompile, "native capability report");
        }
        const draw = () => { renderer.render(); renderer.renderCommands(dense); renderer.renderPostProcess(); };
        const first = performance.now(); draw(); const firstSubmissionMs = performance.now() - first;
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        if (reference) assert(pixels.every((value, index) => value === reference[index]), "async pixels changed");
        else reference = pixels;
        assert(pixels.some((value, index) => index % 4 !== 3 && value > 20), "empty rendered output");
        const allocations = JSON.stringify(observed.counts);
        const times = [];
        for (let i = 0; i < 30; i++) { const t = performance.now(); draw(); times.push(performance.now() - t); }
        assert(allocations === JSON.stringify(observed.counts), "steady frames allocate GPU resources");
        assert(renderer.stats().renderCommandCount === 1024 && renderer.stats().drawCalls === (postProcess ? 4 : colorManagement === "legacy" ? 1 : 2), "draw/command budget");
        assert(renderer.resourceStats().programCount === 5, "program accounting");
        assert(gl.getError() === gl.NO_ERROR, "render GL error");
        times.sort((a, b) => a - b);
        const p95SubmissionMs = times[Math.ceil(times.length * 0.95) - 1];
        assert(p95SubmissionMs < 100, "CPU submission smoke budget exceeded");
        reports.push({ colorManagement, postProcess, async, nativeParallelCompile, initializationMs, firstSubmissionMs,
          p95SubmissionMs, ticks, drawCalls: renderer.stats().drawCalls });
      } finally { renderer.destroy(); renderer.destroy(); finish(f); }
    }
  }

  // Exercise the support branch deterministically even on CI drivers lacking the extension.
  // This is a scheduling shim around real shaders, not a measurement of native parallel compilation.
  for (const failure of ["success", "abort", "link", "allocation", "late-uniform", "callback", "timeout"]) {
    const f = setup(), { gl, canvas } = f;
    const getExtension = gl.getExtension.bind(gl), parameter = gl.getProgramParameter.bind(gl);
    let polls = 0;
    gl.getExtension = (name) => name === "KHR_parallel_shader_compile" ? { COMPLETION_STATUS_KHR: 0x91b1 } : getExtension(name);
    gl.getProgramParameter = (program, name) => name === 0x91b1 ? ++polls > 5 && failure !== "timeout" : parameter(program, name);
    if (failure === "link") {
      const source = gl.shaderSource.bind(gl);
      gl.shaderSource = (shader, text) => source(shader, text + "\n deliberate_invalid_shader_token;");
    }
    if (failure === "allocation") gl.createBuffer = () => null;
    if (failure === "late-uniform") {
      const uniform = gl.getUniformLocation.bind(gl);
      gl.getUniformLocation = (program, name) => name === "u_scene" ? null : uniform(program, name);
    }
    const controller = new AbortController();
    let failed = false, renderer;
    const promise = WebGL2Renderer.create(canvas, {}, {
      signal: controller.signal, timeoutMs: failure === "timeout" ? 20 : 5000,
      onProgress(progress) { if (failure === "callback" && progress.phase === "ready") throw new Error("callback failure"); },
    });
    if (failure === "abort") setTimeout(() => controller.abort(), 1);
    try { renderer = await promise; } catch (error) { failed = true; if (failure === "abort") assert(error.name === "AbortError", "abort type"); }
    assert(failed === (failure !== "success"), `unexpected ${failure} outcome`);
    renderer?.destroy(); finish(f);
  }

  const f = setup();
  const overlay = new LoadingOverlay(document.body);
  let ready = false;
  const runtime = await createFerrumRuntime({ canvas: f.canvas, debug: false, ui: false,
    webgl2: { preserveDrawingBuffer: true }, shaderPreparation: { onProgress(progress) {
      overlay.updateShaderPreparation(progress); ready ||= progress.phase === "ready";
    } },
  });
  assert(ready && overlay.state().detail === "Renderer ready" && overlay.state().status === "loading", "runtime loading UI readiness");
  overlay.hide(); runtime.destroy(); overlay.destroy(); finish(f);
  return { status: "passed", dataSceneState: "playing", floatsPerCommand: dense.floatsPerCommand, commandCount: dense.commandCount,
    reports, simulatedSupportCases: 7, runtimeLoadingUi: true, finalLiveResources: 0 };
}
run().then((value) => { globalThis.shaderPreparationSmoke = value; }, (error) => { globalThis.shaderPreparationSmoke = { error: error.stack ?? String(error) }; });
