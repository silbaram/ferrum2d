import {
  createEngine,
  AssetLoader,
  WebGL2Renderer,
} from "@ferrum2d/ferrum-web/core";
import {
  applyDataSceneAuthoringDocument,
  importAsepriteAtlas,
} from "@ferrum2d/ferrum-web/authoring";
const check = (v, m) => {
  if (!v) throw Error(m);
};
const hash = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
export async function probeAsepriteResume() {
  const {
      bundle,
      document: scene,
      instance,
      animation,
    } = await (await fetch("/resume.json")).json(),
    textures = {};
  for (const rev of bundle.revisions) {
    const json = await (
        await fetch("/resume/" + rev.assetId + ".json")
      ).arrayBuffer(),
      png = await (
        await fetch("/resume/" + rev.assetId + ".png")
      ).arrayBuffer();
    check(
      (await hash(json)) === rev.jsonSha256 &&
        (await hash(png)) === rev.pngSha256,
      "Resume source hash differs",
    );
    const imported = importAsepriteAtlas(
      JSON.parse(new TextDecoder().decode(json)),
      { texture: rev.assetId, stripFrameExtension: false },
    );
    check(
      JSON.stringify(imported.frameNames) ===
        JSON.stringify(rev.frames.map((f) => f.id)),
      "Resume frame identity differs",
    );
    const bitmap = await createImageBitmap(new Blob([png]));
    try {
      check(
        bitmap.width === rev.width && bitmap.height === rev.height,
        "Resume image size differs",
      );
    } finally {
      bitmap.close();
    }
    textures[rev.assetId] = "/resume/" + rev.assetId + ".png";
  }
  const canvas = document.querySelector("canvas"),
    renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true }),
    loader = new AssetLoader(renderer),
    raf = requestAnimationFrame,
    cancel = cancelAnimationFrame,
    pending = new Map();
  let next = 0,
    engine;
  globalThis.requestAnimationFrame = (callback) => {
    pending.set(++next, callback);
    return next;
  };
  globalThis.cancelAnimationFrame = (id) => pending.delete(id);
  try {
    await loader.loadAssets({
      textures: Object.fromEntries(Object.entries(textures).reverse()),
      textureOptions: bundle.manifest.textureOptions,
    });
    engine = await createEngine(
      (frame) => {
        renderer.render();
        renderer.renderCommands(frame.renderCommandBuffer);
        renderer.renderPostProcess();
      },
      () => ({}),
      loader,
      () => renderer.viewportSize(),
      { fixedTimestep: false },
    );
    const size = renderer.viewportSize();
    engine.setViewportSize(size.width, size.height);
    const handles = applyDataSceneAuthoringDocument(
      engine,
      scene,
    ).entityHandles;
    engine.pauseDataScene();
    if (!scene.spatial) {
      const pose = scene.sceneComposition.fragments.main.instances.find(
        (i) => i.id === instance,
      );
      engine.setDataSceneCamera({ x: pose.x, y: pose.y - 32 });
    }
    engine.start();
    for (let i = 0; i < 2; i++) {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(0);
    }
    let playback;
    if (animation) {
      const handle = handles[instance],
        visited = new Set(),
        visible = new Set(),
        visual = scene.sceneComposition.fragments.main.instances.find(
          (item) => item.id === instance,
        ).props.components.visual,
        clip = visual.animationSet.clips.find(
          (item) => item.id === visual.animationSet.initialClip,
        );
      check(engine.resumeDataScene(), "Resume animation failed");
      const duration = (clip.frames.length * 1000) / clip.fps;
      for (let elapsed = 10; elapsed <= duration + 50; elapsed += 10) {
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) callback(elapsed);
        const state = engine.dataSceneSpriteAnimationState(handle),
          phase = (elapsed / 1000) * Math.fround(clip.fps),
          expected = Math.min(Math.floor(phase + 1e-5), clip.frames.length - 1);
        check(state.clip === clip.id, "Initial native clip ID changed");
        if (Math.abs(phase - Math.round(phase)) > 1e-4)
          check(
            state.frame === expected,
            `Native duration mismatch at ${elapsed}ms: ${state.frame}/${expected}`,
          );
        visited.add(state.frame);
        const gl = canvas.getContext("webgl2"),
          pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(
          0,
          0,
          canvas.width,
          canvas.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        let red = 0,
          green = 0,
          blue = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const [r, g, b] = pixels.subarray(i, i + 3);
          if (r > g * 2 && r > b * 2) red++;
          if (g > r * 2 && g > b * 1.5) green++;
          if (b > r * 2 && b > g * 1.5) blue++;
        }
        if (red + green + blue > 100)
          visible.add(
            red > green && red > blue ? "red" : green > blue ? "green" : "blue",
          );
      }
      const state = engine.dataSceneSpriteAnimationState(handle);
      check(
        state.finished && state.frame === clip.frames.length - 1,
        "Non-looping native clip did not finish",
      );
      playback = {
        finished: state.finished,
        clip: state.clip,
        visitedFrames: visited.size,
        visibleFrames: visible.size,
        sourceCycleMs: duration,
      };
    }
    const gl = canvas.getContext("webgl2"),
      bytes = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bytes,
    );
    check(gl.getError() === 0, "Resume GL failed");
    let coloredPixels = 0;
    for (let i = 0; i < bytes.length; i += 4)
      if (bytes[i] > bytes[i + 1] * 2 && bytes[i + 2] > bytes[i + 1] * 2)
        coloredPixels++;
    return {
      freshSession: true,
      hashes: true,
      frameIdentity: true,
      colorSpace: "srgb",
      coloredPixels,
      ...(playback ? { animation: playback } : {}),
    };
  } finally {
    engine?.destroy();
    renderer.destroy();
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = cancel;
  }
}
