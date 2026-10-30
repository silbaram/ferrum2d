import { createEngine, AssetLoader, WebGL2Renderer } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

/** A fresh runtime consumes only exported PNGs, manifest and ordinary scene data. */
export async function probePixelResume() {
  window.pixelResumeStage = "source";
  const bundle = await (await fetch("/resume.json")).json();
  const canvas = document.querySelector("canvas");
  const textures = {};
  for (const asset of bundle.assets) {
    if (bundle.manifest.textures[asset.id] !== asset.path ||
      bundle.manifest.textureOptions[asset.id]?.colorSpace !== "srgb")
      throw Error("Pixel manifest differs");
    const bytes = Uint8Array.from(atob(asset.pngBase64), c => c.charCodeAt(0));
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map(n => n.toString(16).padStart(2, "0")).join("");
    if (hash !== asset.sha256) throw Error("Pixel PNG hash differs");
    textures[asset.id] = "data:image/png;base64," + asset.pngBase64;
  }
  const renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true });
  const loader = new AssetLoader(renderer);
  const raf = requestAnimationFrame, cancel = cancelAnimationFrame, pending = new Map();
  let id = 0, engine, sample;
  globalThis.requestAnimationFrame = callback => { pending.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = key => pending.delete(key);
  try {
    window.pixelResumeStage = "textures";
    await loader.loadAssets({ textures, textureOptions: bundle.manifest.textureOptions });
    window.pixelResumeStage = "engine";
    engine = await createEngine(frame => {
      renderer.render(); renderer.renderCommands(frame.renderCommandBuffer); renderer.renderPostProcess();
      sample = { state: frame.gameState, entities: frame.entityCount,
        sprites: frame.spriteCount, drawCalls: renderer.stats().drawCalls,
        textureSwitches: renderer.stats().textureSwitchCount };
    }, () => ({}), loader, () => renderer.viewportSize(), { fixedTimestep: false });
    const size = renderer.viewportSize(); engine.setViewportSize(size.width, size.height);
    window.pixelResumeStage = "scene";
    applyDataSceneAuthoringDocument(engine, bundle.sceneDocument);
    if (!engine.pauseDataScene()) throw Error("Pixel runtime did not enter the paused scene");
    if (!bundle.sceneDocument.spatial) {
      const pose = bundle.sceneDocument.sceneComposition.fragments.main.instances[0];
      engine.setDataSceneCamera({ x: pose.x, y: pose.y - 32 });
    }
    engine.start();
    window.pixelResumeStage = "frames";
    for (let frame = 0; frame < 3; frame++) {
      const callbacks = [...pending.values()]; pending.clear();
      for (const callback of callbacks) callback(frame * 16);
    }
    const gl = canvas.getContext("webgl2"), pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    if (gl.getError()) throw Error("Pixel runtime readback failed");
    if (sample?.state !== 3 || sample.entities !== 1 || sample.sprites < 1 ||
      sample.drawCalls < 1 || sample.drawCalls > 16 || sample.textureSwitches > 16)
      throw Error("Pixel runtime state or draw budget differs: " + JSON.stringify(sample));
    let blue = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 2] > pixels[i] * 2 && pixels[i + 2] > pixels[i + 1] * 1.5) blue++;
    return { freshSession: true, assets: bundle.assets.length, hashes: true, bluePixels: blue, ...sample };
  } finally {
    engine?.destroy(); renderer.destroy();
    globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = cancel;
  }
}
