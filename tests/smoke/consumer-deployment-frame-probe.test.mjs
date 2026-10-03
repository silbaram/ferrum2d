import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { installDeploymentFrameProbe } from "./consumer-deployment-frame-probe.mjs";
import { DEPLOYMENT_CANVAS_READBACK_MAX_ATTEMPTS, DEPLOYMENT_RUNTIME_SAMPLE_FRAMES } from "./runtime-budget-profiles.mjs";

function fixture() {
  const state = { visible: true, lost: false, error: 0, playing: true, drawCalls: 3, reads: 0, presented: false, renders: 0 };
  class WebGL2RenderingContext {
    NO_ERROR = 0;
    isContextLost() { return state.lost; }
    getError() { return state.error; }
    readPixels(_x, _y, _w, _h, _format, _type, bytes) {
      assert.equal(state.presented, false, "readback must happen before the completed frame is presented");
      state.reads += 1;
      if (state.visible) bytes.set([18, 23, 28, 255, 255, 0, 0, 255]);
    }
  }
  const gl = new WebGL2RenderingContext();
  class HTMLCanvasElement {
    width = 2;
    height = 1;
    getContext() { return gl; }
  }
  const canvas = new HTMLCanvasElement();
  const renderer = {
    renderPostProcess(argument) {
      assert.equal(this, renderer, "retain the renderer method receiver");
      state.renders += 1;
      state.presented = false;
      return argument;
    },
    stats: () => ({ drawCalls: state.drawCalls, renderCommandCount: 1 }),
  };
  const original = renderer.renderPostProcess;
  const context = createContext({
    ferrumRuntime: {
      renderer,
      engine: { gameState: () => state.playing ? 1 : 0, entityCount: () => 1, spriteCount: () => 1 },
    },
    HTMLCanvasElement, WebGL2RenderingContext,
    document: { querySelector: () => canvas },
    requestAnimationFrame: () => { throw new Error("Independent RAF must not count as a completed render"); },
  });
  // Exercise the same function serialization as Playwright page.evaluate.
  runInContext(`(${installDeploymentFrameProbe.toString()})(${JSON.stringify({
    canvasReadbackAttempts: DEPLOYMENT_CANVAS_READBACK_MAX_ATTEMPTS,
    sampleFrames: DEPLOYMENT_RUNTIME_SAMPLE_FRAMES,
  })})`, context);
  const frame = () => {
    const result = {};
    assert.equal(renderer.renderPostProcess(result), result);
    state.presented = true;
  };
  return { state, context, renderer, original, frame };
}

test("count actual final passes and read pixels synchronously before presentation", () => {
  const f = fixture();
  assert.equal(f.context.__ferrumDeploymentFrame, undefined);
  for (let i = 1; i < DEPLOYMENT_RUNTIME_SAMPLE_FRAMES; i++) f.frame();
  assert.equal(f.context.__ferrumDeploymentFrame, undefined);
  assert.equal(f.state.reads, 0);
  f.frame();
  assert.equal(f.context.__ferrumDeploymentFrame.sampledFrameCount, DEPLOYMENT_RUNTIME_SAMPLE_FRAMES);
  assert.equal(f.context.__ferrumDeploymentFrame.drawCalls, 3);
  assert.equal(f.context.__ferrumDeploymentCanvas.nonblank, true);
  assert.equal(f.context.__ferrumDeploymentCanvas.readbackAttempts, 1);
  assert.equal(f.renderer.renderPostProcess, f.original);
});

test("invalid runtime frames reset the consecutive completed-frame requirement", () => {
  const f = fixture();
  for (let i = 0; i < DEPLOYMENT_RUNTIME_SAMPLE_FRAMES - 1; i++) f.frame();
  f.state.playing = false;
  f.frame();
  f.state.playing = true;
  f.frame();
  assert.equal(f.context.__ferrumDeploymentFrame, undefined);
  for (let i = 1; i < DEPLOYMENT_RUNTIME_SAMPLE_FRAMES; i++) f.frame();
  assert.equal(f.context.__ferrumDeploymentCanvas.nonblank, true);
});

test("readback retries include their draw cost and preserve earlier draw-call peaks", () => {
  const f = fixture();
  f.state.visible = false;
  f.state.drawCalls = 20;
  f.frame();
  f.state.drawCalls = 1;
  for (let i = 1; i < DEPLOYMENT_RUNTIME_SAMPLE_FRAMES; i++) f.frame();
  assert.equal(f.context.__ferrumDeploymentFrame, undefined);
  f.state.visible = true;
  f.frame();
  assert.equal(f.context.__ferrumDeploymentFrame.drawCalls, 20);
  assert.equal(f.context.__ferrumDeploymentCanvas.readbackAttempts, 2);

  const retry = fixture();
  retry.state.visible = false;
  for (let i = 0; i < DEPLOYMENT_RUNTIME_SAMPLE_FRAMES; i++) retry.frame();
  retry.state.drawCalls = 30;
  retry.state.visible = true;
  retry.frame();
  assert.equal(retry.context.__ferrumDeploymentFrame.drawCalls, 30);
});

test("a genuinely blank frame still fails after the bounded retry budget", () => {
  const f = fixture();
  f.state.visible = false;
  for (let i = 0; i < DEPLOYMENT_RUNTIME_SAMPLE_FRAMES + DEPLOYMENT_CANVAS_READBACK_MAX_ATTEMPTS - 1; i++) f.frame();
  assert.equal(f.context.__ferrumDeploymentCanvas.nonblank, false);
  assert.equal(f.context.__ferrumDeploymentCanvas.readbackAttempts, DEPLOYMENT_CANVAS_READBACK_MAX_ATTEMPTS);
  assert.equal(f.state.reads, DEPLOYMENT_CANVAS_READBACK_MAX_ATTEMPTS);
  assert.equal(f.renderer.renderPostProcess, f.original);
});

for (const failure of ["lost context", "GL error"]) {
  test(`${failure} is reported distinctly and restores the renderer method`, () => {
    const f = fixture();
    for (let i = 1; i < DEPLOYMENT_RUNTIME_SAMPLE_FRAMES; i++) f.frame();
    if (failure === "lost context") f.state.lost = true;
    else f.state.error = 1282;
    const expected = failure === "lost context" ? /context lost/ : /WebGL error 1282/;
    assert.throws(f.frame, expected);
    assert.match(f.context.__ferrumDeploymentError, expected);
    assert.equal(f.context.__ferrumDeploymentFrame, undefined);
    assert.equal(f.renderer.renderPostProcess, f.original);
  });
}
