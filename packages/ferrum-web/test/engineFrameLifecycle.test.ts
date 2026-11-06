import "./nativeRuntimeTestHelper.js";
import { equal } from "node:assert/strict";
import { test } from "node:test";
import { createEngineWithFramePipeline } from "../src/createEngine.js";
import type { FerrumEngine, InputSnapshot, AssetHost } from "../src/core.js";

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
