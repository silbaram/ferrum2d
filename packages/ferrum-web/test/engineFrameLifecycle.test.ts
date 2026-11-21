import "./nativeRuntimeTestHelper.js";
import { equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { createEngineWithFramePipeline } from "../src/createEngine.js";
import type { FerrumEngine, InputSnapshot, AssetHost } from "../src/core.js";
import { nativeFileEngineOwner } from "../src/nativeFileEngineOwner.js";

const input: InputSnapshot = {
  w: false, a: false, s: false, d: false, space: false, enter: false,
  mouseLeft: false, mouseX: 0, mouseY: 0,
};

for (const phase of ["input", "viewport", "audio-accessor", "render", "onFrame"] as const) {
  test(`native engine destruction during ${phase} stops the frame and cancels future RAF`, async () => {
    const request = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame;
    const jobs = new Map<number, FrameRequestCallback>();
    let id = 0, publicFrames = 0, renders = 0;
    globalThis.requestAnimationFrame = callback => { jobs.set(++id, callback); return id; };
    globalThis.cancelAnimationFrame = value => { jobs.delete(value); };
    const fire = (time: number) => {
      const pending = [...jobs.values()]; jobs.clear();
      for (const callback of pending) callback(time);
    };
    let engine: FerrumEngine | undefined;
    try {
      engine = await createEngineWithFramePipeline({
        onRenderFrame: () => { renders++; if (phase === "render") engine!.destroy(); },
        onFrame: () => { publicFrames++; if (phase === "onFrame") engine!.destroy(); },
      }, () => { if (phase === "input") engine!.destroy(); return input; }, {
        get playAudioEventBuffer() { if (phase === "audio-accessor") engine!.destroy(); return undefined; },
      } as AssetHost,
      () => { if (phase === "viewport") engine!.destroy(); return { width: 640, height: 360 }; });
      engine.start(); fire(0); fire(16);
      equal(publicFrames, phase === "onFrame" ? 1 : 0);
      equal(renders, phase === "render" || phase === "onFrame" ? 1 : 0);
      equal(jobs.size, 0);
      engine.destroy();
    } finally {
      engine?.destroy();
      globalThis.requestAnimationFrame = request;
      globalThis.cancelAnimationFrame = cancel;
    }
  });
}

test("native update failure stops before audio and public frames, clears busy state and permits restart", async () => {
  const request = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame;
  const jobs = new Map<number, FrameRequestCallback>();
  let id = 0, publicFrames = 0, renders = 0, audioAccesses = 0;
  globalThis.requestAnimationFrame = callback => { jobs.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = value => { jobs.delete(value); };
  const fire = (time: number) => {
    const pending = [...jobs.values()]; jobs.clear();
    for (const callback of pending) callback(time);
  };
  let engine: FerrumEngine | undefined;
  try {
    engine = await createEngineWithFramePipeline({
      onRenderFrame: () => { renders++; },
      onFrame: () => { publicFrames++; },
    }, () => input, {
      get playAudioEventBuffer() { audioAccesses++; return undefined; },
    } as AssetHost);
    const native = nativeFileEngineOwner(engine).native;
    const target = native as typeof native & { update_frame_checked?: typeof native.update_frame };
    const method = typeof target.update_frame_checked === "function" ? "update_frame_checked" : "update_frame";
    const update = target[method]!;
    const failure = new Error("native actual motion rejected");
    // Fault injection at the actual facade's Wasm update boundary. The Rust
    // motion regressions exercise the native rejection that throws here.
    target[method] = () => { throw failure; };
    audioAccesses = 0;
    engine.start(); fire(0);
    throws(() => fire(16), error => error === failure);
    equal(audioAccesses, 0);
    equal(renders, 0);
    equal(publicFrames, 0);
    equal(jobs.size, 0);
    const checkpoint = engine.captureRuntimeCheckpoint();
    checkpoint.dispose();
    target[method] = update;
    engine.start(); fire(1000); fire(1016);
    equal(renders, 1);
    equal(publicFrames, 1);
    equal(jobs.size, 1);
    engine.stop();
    equal(jobs.size, 0);
    engine.destroy();
    engine.destroy();
  } finally {
    engine?.destroy();
    globalThis.requestAnimationFrame = request;
    globalThis.cancelAnimationFrame = cancel;
  }
});
