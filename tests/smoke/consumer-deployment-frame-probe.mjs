// Serialized by Playwright into the page: keep this function self-contained.
export function installDeploymentFrameProbe({ canvasReadbackAttempts, sampleFrames }) {
  const runtime = globalThis.ferrumRuntime;
  if (!runtime || typeof runtime.renderer.renderPostProcess !== "function") {
    throw new Error("Deployment smoke requires the runtime's final render pass.");
  }
  delete globalThis.__ferrumDeploymentFrame;
  delete globalThis.__ferrumDeploymentCanvas;
  delete globalThis.__ferrumDeploymentError;
  const renderer = runtime.renderer;
  const original = renderer.renderPostProcess;
  const samples = [];
  let readbackAttempts = 0;
  let maxDrawCalls = 0;
  const readCanvasEvidence = () => {
    const canvas = document.querySelector("canvas.game-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      return { width: 0, height: 0, webgl2: false, nonblank: false, coloredPixelSamples: 0, varyingPixelSamples: 0, readbackSource: "same-raf-after-render" };
    }
    const gl = canvas.getContext("webgl2");
    if (!(gl instanceof WebGL2RenderingContext)) {
      return { width: canvas.width, height: canvas.height, webgl2: false, nonblank: false, coloredPixelSamples: 0, varyingPixelSamples: 0, readbackSource: "same-raf-after-render" };
    }
    if (gl.isContextLost()) throw new Error("WebGL2 context lost before deployment pixel readback.");
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const readError = gl.getError();
    if (readError !== gl.NO_ERROR) throw new Error(`Deployment pixel readback failed with WebGL error ${readError}.`);
    let coloredPixelSamples = 0;
    let varyingPixelSamples = 0;
    let firstSample;
    const stride = Math.max(4, Math.floor(pixels.length / 4096 / 4) * 4);
    for (let index = 0; index < pixels.length; index += stride) {
      const sample = [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
      if (sample[0] !== 0 || sample[1] !== 0 || sample[2] !== 0 || sample[3] !== 0) {
        coloredPixelSamples += 1;
      }
      firstSample ??= sample;
      if (sample.some((value, channel) => value !== firstSample[channel])) varyingPixelSamples += 1;
    }
    return {
      width: canvas.width,
      height: canvas.height,
      webgl2: true,
      nonblank: varyingPixelSamples > 0,
      coloredPixelSamples,
      varyingPixelSamples,
      readbackSource: "same-raf-after-render",
    };
  };

  const sampleCompletedFrame = () => {
    const stats = renderer.stats();
    const sample = {
      gameState: runtime.engine.gameState(),
      entityCount: runtime.engine.entityCount(),
      spriteCount: runtime.engine.spriteCount(),
      renderCommandCount: stats.renderCommandCount,
      drawCalls: stats.drawCalls,
    };
    const valid = sample.gameState === 1 && sample.entityCount > 0
      && sample.spriteCount > 0 && sample.renderCommandCount > 0 && sample.drawCalls > 0;
    if (!valid) {
      samples.length = 0;
      readbackAttempts = 0;
      maxDrawCalls = 0;
      return;
    }
    maxDrawCalls = Math.max(maxDrawCalls, sample.drawCalls);
    if (samples.length < sampleFrames) samples.push(sample);
    if (samples.length < sampleFrames) return;
    const canvas = readCanvasEvidence();
    readbackAttempts += 1;
    if (!canvas.nonblank && readbackAttempts < canvasReadbackAttempts) return;
    globalThis.__ferrumDeploymentFrame = {
      gameState: sample.gameState,
      entityCount: Math.min(...samples.map((entry) => entry.entityCount)),
      spriteCount: Math.min(...samples.map((entry) => entry.spriteCount)),
      renderCommandCount: Math.min(...samples.map((entry) => entry.renderCommandCount)),
      drawCalls: maxDrawCalls,
      sampledFrameCount: samples.length,
      statsSource: "renderer.stats-after-frame",
    };
    globalThis.__ferrumDeploymentCanvas = { ...canvas, readbackAttempts };
    renderer.renderPostProcess = original;
  };
  // A separately registered RAF can run BEFORE the runtime after pause/resume.
  // Read synchronously after all passes, before the drawing buffer is presented
  // or discarded. Count actual renders, never repeated stats from a paused loop.
  renderer.renderPostProcess = function (...args) {
    try {
      const result = original.apply(this, args);
      sampleCompletedFrame();
      return result;
    } catch (error) {
      renderer.renderPostProcess = original;
      globalThis.__ferrumDeploymentError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  };
}
