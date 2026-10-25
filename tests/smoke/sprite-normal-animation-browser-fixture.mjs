import {
  createEngine,
  WebGL2Renderer,
  resolveDataSceneSpriteAnimationSet,
} from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

export async function probeNormalAnimation() {
  const descriptor = await (await fetch("/animation.json")).json();
  const animationSet = resolveDataSceneSpriteAnimationSet(
    descriptor.animationSet,
  );
  const canvas = document.querySelector("canvas");
  const renderer = new WebGL2Renderer(canvas, {
    preserveDrawingBuffer: true,
    clearColor: [0.02, 0.02, 0.02, 1],
  });
  let renders = 0;
  const engine = await createEngine(
    (state) => {
      renderer.render();
      renderer.renderCommands(state.renderCommandBuffer);
      renderer.renderPostProcess();
      renders++;
    },
    () => ({}),
    undefined,
    () => renderer.viewportSize(),
    { fixedTimestep: false },
  );
  const originalRaf = globalThis.requestAnimationFrame,
    originalCancel = globalThis.cancelAnimationFrame;
  const pending = new Map();
  let id = 0,
    timestamp = 0;
  // Test-only clock drives the real GameLoop and Rust simulation; no native state is mocked.
  globalThis.requestAnimationFrame = (callback) => {
    pending.set(++id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (key) => pending.delete(key);
  const pump = (deltaMs = 0) => {
    timestamp += deltaMs;
    const callbacks = [...pending.values()];
    pending.clear();
    if (!callbacks.length)
      throw new Error("Native animation clock has no pending frame");
    for (const callback of callbacks) callback(timestamp);
  };
  const pixels = () => {
    const gl = canvas.getContext("webgl2"),
      data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
    if (gl.getError() !== gl.NO_ERROR) throw new Error("Animation WebGL error");
    return data;
  };
  const changed = (a, b) => {
    let count = 0;
    for (let i = 0; i < a.length; i += 4)
      if (
        Math.abs(a[i] - b[i]) +
          Math.abs(a[i + 1] - b[i + 1]) +
          Math.abs(a[i + 2] - b[i + 2]) >
        15
      )
        count++;
    return count;
  };
  try {
    await renderer.loadTexture(1, "/color.png");
    await renderer.loadTexture(2, "/normal.png", { colorSpace: "none" });
    const document = {
      format: "ferrum2d.consumer.scene-authoring",
      version: 1,
      sceneComposition: {
        initialFragment: "normal",
        prefabs: { object: {} },
        fragments: {
          normal: {
            instances: [
              {
                id: "sprite",
                prefab: "object",
                x: 0,
                y: 0,
                props: {
                  components: {
                    visual: {
                      kind: "sprite",
                      texture: 1,
                      width: 64,
                      height: 64,
                      originX: 0.5,
                      originY: 1,
                      animationSet,
                    },
                    collider: "none",
                    layer: "player",
                  },
                },
              },
            ],
          },
        },
      },
      behaviorRecipes: { entities: {} },
      spatial: {
        camera: {
          projection: "orthographic",
          position: { x: 0, y: -200, elevation: 80 },
          target: { x: 0, y: 0, elevation: 32 },
          height: 110,
          near: 0.1,
          far: 1200,
        },
        terrain: [],
        billboards: { sprite: { normalTextureId: 2 } },
        environment: {
          lighting: {
            ambient: [0.05, 0.05, 0.05],
            lights: [
              {
                position: { x: 65, y: -80, elevation: 70 },
                radius: 300,
                intensity: 2,
              },
            ],
          },
        },
      },
    };
    const viewport = renderer.viewportSize();
    engine.setViewportSize(viewport.width, viewport.height);
    let handle = applyDataSceneAuthoringDocument(engine, document).entityHandles
      .sprite;
    engine.start();
    pump();
    pump();
    const clip = animationSet.clips[0],
      sourceIndices = descriptor.timing.sourceFrameIndices;
    const set = (update) => {
      if (
        !engine.updateDataSceneSpriteAnimations([{ entity: handle, ...update }])
      )
        throw new Error("Native animation update rejected");
    };
    const autoSamples = new Map(),
      seen = new Set();
    const duration = descriptor.timing.nativeCycleMs,
      step = Math.min(2.5, 1000 / clip.fps / 4);
    for (let elapsed = step; elapsed <= duration + step * 3; elapsed += step) {
      pump(step);
      const state = engine.dataSceneSpriteAnimationState(handle);
      const expected = Math.min(
        Math.floor((elapsed / 1000) * clip.fps + 1e-5),
        clip.frames.length - 1,
      );
      // Accumulated native f32 deltas can straddle an exact tick; check off the boundary.
      const phase = (elapsed / 1000) * clip.fps;
      if (
        Math.abs(phase - Math.round(phase)) > 1e-4 &&
        state.frame !== expected
      )
        throw new Error(
          `Native timing frame ${state.frame} != ${expected} at ${elapsed}ms`,
        );
      const source = sourceIndices[state.frame];
      seen.add(source);
      if (!autoSamples.has(source))
        autoSamples.set(source, { frame: state.frame, pixels: pixels() });
    }
    const finished = engine.dataSceneSpriteAnimationState(handle);
    if (
      !finished.finished ||
      finished.frame !== clip.frames.length - 1 ||
      seen.size !== descriptor.timing.repeats.length
    )
      throw new Error(
        "Non-looping native playback did not finish or visit all sources",
      );
    const frameLighting = [];
    for (const [source, sample] of autoSamples) {
      set({ frame: sample.frame, paused: true, flipX: false, flipY: false });
      pump();
      if (changed(sample.pixels, pixels()) !== 0)
        throw new Error(
          `Automatic playback differs from selected atlas source ${source}: ${changed(sample.pixels, pixels())} pixels`,
        );
      await globalThis.saveAnimationScreenshot(
        `source-${source}-lit`,
        canvas.toDataURL(),
      );
      // Apply the same clip with flat normals, then restore the generated normal atlas.
      document.spatial.billboards.sprite = {};
      handle = applyDataSceneAuthoringDocument(engine, document).entityHandles
        .sprite;
      set({ frame: sample.frame, paused: true });
      pump();
      const flat = pixels();
      document.spatial.billboards.sprite = { normalTextureId: 2 };
      handle = applyDataSceneAuthoringDocument(engine, document).entityHandles
        .sprite;
      set({ frame: sample.frame, paused: true });
      pump();
      const lit = pixels();
      const difference = changed(flat, lit);
      if (difference < 50)
        throw new Error(
          `Source ${source} has no normal lighting: ${difference}`,
        );
      set({ flipX: true, flipY: true });
      pump();
      const flipped = pixels();
      if (changed(lit, flipped) < 20)
        throw new Error("Asymmetric animation flip was not rendered");
      frameLighting.push({
        source,
        changedPixels: difference,
        flipChangedPixels: changed(lit, flipped),
      });
    }
    const looping = {
      ...animationSet,
      clips: animationSet.clips.map((c) => ({ ...c, loop: true })),
    };
    if (!engine.configureDataSceneSpriteAnimation(handle, looping))
      throw new Error("Looping clip rejected");
    let elapsed = 0;
    while (elapsed < duration * 1.2) {
      pump(step);
      elapsed += step;
    }
    const loopState = engine.dataSceneSpriteAnimationState(handle);
    if (
      loopState.finished ||
      loopState.elapsedSeconds >= duration / 1000 ||
      loopState.elapsedSeconds <= 0
    )
      throw new Error("Looping native playback did not wrap");
    return {
      renderer: "webgl2",
      nativePlayback: true,
      finished: finished.finished,
      loopWrapped: true,
      sourceFramesSeen: seen.size,
      nativeFrames: clip.frames.length,
      fps: clip.fps,
      frameLighting,
      renders,
    };
  } finally {
    engine.destroy();
    renderer.destroy();
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  }
}
