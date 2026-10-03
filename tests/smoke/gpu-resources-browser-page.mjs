import { createFerrumRuntime } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";
import { evaluateRuntimeDiagnosticsSample } from "@ferrum2d/ferrum-web/quality";

function assert(value, message) { if (!value) throw new Error(message); }
function equal(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

// Independent test instrumentation: compare public accounting against actual allocation calls.
function observeAllocations(gl) {
  const live = {};
  const textureBytes = new Map();
  const bufferBytes = new Map();
  let allocations = 0;
  for (const kind of ["Texture", "Buffer", "Program", "Framebuffer"]) {
    const objects = live[kind] = new Set();
    const create = gl[`create${kind}`].bind(gl);
    const destroy = gl[`delete${kind}`].bind(gl);
    gl[`create${kind}`] = (...args) => {
      const value = create(...args);
      if (value) { objects.add(value); allocations++; }
      return value;
    };
    gl[`delete${kind}`] = (value) => {
      objects.delete(value);
      if (kind === "Texture") textureBytes.delete(value);
      if (kind === "Buffer") bufferBytes.delete(value);
      destroy(value);
    };
  }
  const texImage2D = gl.texImage2D.bind(gl);
  gl.texImage2D = (...args) => {
    texImage2D(...args);
    const source = args[5];
    const width = args.length === 9 ? args[3] : source.width;
    const height = args.length === 9 ? args[4] : source.height;
    textureBytes.set(gl.getParameter(gl.TEXTURE_BINDING_2D), width * height * 4);
  };
  const bufferData = gl.bufferData.bind(gl);
  gl.bufferData = (...args) => {
    bufferData(...args);
    const binding = args[0] === gl.ARRAY_BUFFER ? gl.ARRAY_BUFFER_BINDING : gl.ELEMENT_ARRAY_BUFFER_BINDING;
    bufferBytes.set(gl.getParameter(binding), typeof args[1] === "number" ? args[1] : args[1].byteLength);
  };
  const sum = (map) => [...map.values()].reduce((a, b) => a + b, 0);
  return {
    get allocations() { return allocations; },
    verify(renderer) {
      const stats = renderer.resourceStats();
      const textures = sum(textureBytes);
      const buffers = sum(bufferBytes);
      equal(stats, { textureCount: live.Texture.size, bufferCount: live.Buffer.size,
        programCount: live.Program.size, renderTargetCount: live.Framebuffer.size,
        unmeasuredTextureCount: 0, textureBytes: textures, bufferBytes: buffers,
        estimatedBytes: textures + buffers }, "public resource accounting");
      return stats;
    },
  };
}

function scene(engine, texture, count) {
  engine.useDataScene();
  const originX = engine.cameraX() - 64;
  const originY = engine.cameraY() - 64;
  applyDataSceneAuthoringDocument(engine, {
    format: "ferrum2d.consumer.scene-authoring", version: 1,
    sceneComposition: {
      initialFragment: "main", prefabs: { sprite: {} },
      fragments: { main: { instances: Array.from({ length: count }, (_, i) => ({
        id: `sprite-${i}`, prefab: "sprite", x: originX + (i % 32) * 4 + 2,
        y: originY + Math.floor(i / 32) * 4 + 2,
        props: { components: { sprite: { texture, width: 4, height: 4 }, collider: "none", layer: "wall" } },
      })) } },
    },
    behaviorRecipes: { entities: {} },
  }, { activateDataScene: false });
}

async function runMode(colorManagement) {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
  assert(gl, "WebGL2 unavailable");
  const observed = observeAllocations(gl);
  const budget = { maxDrawCalls: 3, maxRenderCommandCount: 1024, maxTextureSwitchCount: 0,
    maxGpuTextureCount: 8, maxGpuBufferCount: 5, maxGpuProgramCount: 5,
    maxGpuRenderTargetCount: 5, maxGpuEstimatedBytes: 2 * 1024 * 1024 };
  let completeFrame;
  const debugRoot = document.createElement("div");
  document.body.appendChild(debugRoot);
  const runtime = await createFerrumRuntime({ canvas, debug: true, debugParent: debugRoot,
    colorManagement, profiler: { budget }, webgl2: { preserveDrawingBuffer: true, clearColor: [0, 0, 0, 1] },
    postProcess: [{ kind: "fade", color: [0, 0, 0], opacity: 0.1 },
      { kind: "fade", color: [0, 0, 0], opacity: 0.1 }],
    onFrame(frame) { runtime.stop(); completeFrame(frame); },
  });
  const renderer = runtime.renderer;
  const frame = () => new Promise((resolve) => { completeFrame = resolve; runtime.start(); });
  const verifyFrame = (result, count) => {
    assert(runtime.engine.dataSceneState() === "playing", "Data Scene not playing");
    equal(result.frame.renderCommandBuffer.floatsPerCommand, 15, "Rust command ABI");
    equal(result.rendererStats.renderCommandCount, count, "scene command count");
    equal(result.frame.entityCount, count, "scene transition must clear old entities");
    equal(result.rendererStats.drawCalls, count === 0 ? 2 : 3, "sprite + two post-process draws");
    const stats = observed.verify(renderer);
    equal(result.debugMetrics.gpuTextureCount, stats.textureCount, "debug resource sample");
    equal(runtime.profiler.snapshot().latestFrame.gpuEstimatedBytes, stats.estimatedBytes, "profiler resource sample");
    assert(runtime.profiler.snapshot().budgetReport.passed, JSON.stringify(runtime.profiler.snapshot().budgetReport));
    return stats;
  };
  try {
    scene(runtime.engine, 0, 1024);
    const warmup = await frame();
    verifyFrame(warmup, 1024);
    // Exercise the otherwise cold debug buffer growth, without changing the scene or ABI.
    renderer.renderPhysicsDebugLines({ buffer: new Float32Array([0, 0, 1, 1, 1, 1, 1, 1]), lineCount: 1, floatsPerLine: 8 }, { x: 0, y: 0 });
    const baseline = observed.verify(renderer);
    equal(baseline.renderTargetCount, 3, "retained post-process targets");
    equal(baseline.textureCount, 4, "placeholder plus targets");
    const savedBaseline = JSON.stringify(baseline);
    const image = document.createElement("canvas");
    image.width = image.height = 8;
    const context = image.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 8, 8);
    const url = image.toDataURL();
    for (let cycle = 0; cycle < 12; cycle++) {
      await renderer.loadTexture(1, url);
      observed.verify(renderer);
      await renderer.loadTexture(1, url); // replacement must release the previous image
      const capture = renderer.createRenderTexture(100, { width: 16, height: 8 });
      const second = renderer.createRenderTexture(101, { width: 8, height: 8 });
      renderer.resizeRenderTexture(capture, 64, 32);
      scene(runtime.engine, 1, 1024);
      const result = await frame();
      verifyFrame(result, 1024);
      renderer.renderToTexture(capture, result.frame.renderCommandBuffer);
      equal(renderer.stats().drawCalls, 4, "offscreen cost included");
      observed.verify(renderer);
      // Read back actual content, not just allocation counters.
      const pixel = new Uint8Array(4);
      gl.readPixels(8, 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      assert(pixel[0] > 150 && pixel[3] === 255, `scene output missing: ${pixel}`);
      scene(runtime.engine, 0, 0);
      renderer.evictTexture(1);
      renderer.destroyRenderTexture(capture);
      renderer.destroyRenderTexture(capture);
      renderer.destroyRenderTexture(second);
      renderer.evictTexture(1);
      verifyFrame(await frame(), 0);
      equal(observed.verify(renderer), baseline, `cycle ${cycle} must return to warm baseline`);
    }
    equal(JSON.stringify(baseline), savedBaseline, "resource snapshots must be detached");
    const afterCycles = observed.allocations;
    scene(runtime.engine, 0, 1024);
    for (let i = 0; i < 12; i++) verifyFrame(await frame(), 1024);
    equal(observed.allocations, afterCycles, "steady frames must not allocate GPU resources");
    assert(debugRoot.textContent.includes("GPU textures") && debugRoot.textContent.includes("GPU storage estimate"), "overlay must display resources");
    const latest = runtime.profiler.snapshot().latestFrame;
    const denied = evaluateRuntimeDiagnosticsSample(latest, { maxGpuTextureCount: baseline.textureCount - 1 });
    assert(!denied.passed && denied.violations[0].actual === baseline.textureCount, "resource budget must fail on actual usage");
    // Resize retained targets; DPR-aware estimates must reflect the real backing pixels.
    canvas.style.width = "96px";
    canvas.style.height = "64px";
    renderer.resize();
    const resized = observed.verify(renderer);
    equal(resized.textureBytes, 64 * 64 * 4 + 3 * canvas.width * canvas.height * 4, "resized target bytes");
    const snapshot = runtime.profiler.snapshot();
    runtime.destroy();
    runtime.destroy();
    const final = observed.verify(renderer);
    equal(final.estimatedBytes, 0, "destroy bytes");
    equal(final.textureCount + final.bufferCount + final.programCount + final.renderTargetCount, 0, "destroy live objects");
    return { colorManagement, cycles: 12, commandCount: 1024, drawCalls: 3,
      dataSceneState: "playing", baseline, maxGpuEstimatedBytes: snapshot.maxGpuEstimatedBytes, final };
  } finally {
    runtime.destroy();
    canvas.remove();
    debugRoot.remove();
  }
}

try {
  const modes = [];
  for (const mode of ["legacy", "linear-srgb"]) modes.push(await runMode(mode));
  globalThis.gpuResourcesSmoke = { status: "passed", modes };
} catch (error) { globalThis.gpuResourcesSmoke = { error: error.stack ?? String(error) }; }
