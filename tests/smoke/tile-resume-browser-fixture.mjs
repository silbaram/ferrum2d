import {
  createEngine,
  AssetLoader,
  WebGL2Renderer,
} from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";
import {
  importTiledTilemap,
  importLDtkTilemap,
} from "@ferrum2d/ferrum-web/starter-scenes";
const check = (v, m) => {
    if (!v) throw Error(m);
  },
  hash = async (bytes) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
export async function probeTileResume() {
  const { bundle } = await (await fetch("/resume.json")).json(),
    textures = {};
  for (const revision of bundle.revisions) {
    const raw = await (
        await fetch("/resume/" + revision.assetId + ".json")
      ).arrayBuffer(),
      png = await (
        await fetch("/resume/" + revision.assetId + ".png")
      ).arrayBuffer();
    check(
      (await hash(raw)) === revision.jsonSha256 &&
        (await hash(png)) === revision.pngSha256,
      "Tile raw source hash differs",
    );
    const input = JSON.parse(new TextDecoder().decode(raw)),
      map =
        revision.kind === "tiled"
          ? importTiledTilemap(input, { texture: revision.assetId })
          : importLDtkTilemap(input, {
              texture: revision.assetId,
              levelIndex: revision.levelIndex,
            });
    check(
      JSON.stringify(map) === JSON.stringify(revision.imported),
      "Exported map conversion differs from original source",
    );
    const image = await createImageBitmap(new Blob([png]));
    try {
      check(
        image.width === revision.width && image.height === revision.height,
        "Tile PNG dimensions differ",
      );
    } finally {
      image.close();
    }
    textures[revision.assetId] = "/resume/" + revision.assetId + ".png";
    check(
      bundle.manifest.textureOptions[revision.assetId].colorSpace === "srgb",
      "Tile color space differs",
    );
  }
  const canvas = document.querySelector("canvas"),
    renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true }),
    loader = new AssetLoader(renderer),
    raf = requestAnimationFrame,
    cancel = cancelAnimationFrame,
    pending = new Map();
  let engine,
    serial = 0;
  globalThis.requestAnimationFrame = (callback) => {
    pending.set(++serial, callback);
    return serial;
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
    const scene = bundle.sceneDocument;
    applyDataSceneAuthoringDocument(engine, scene);
    engine.pauseDataScene();
    if (!scene.spatial) {
      const first = scene.sceneComposition.fragments.main.instances[0];
      engine.setDataSceneCamera({ x: first.x, y: first.y - 32 });
    }
    engine.start();
    for (let i = 0; i < 2; i++) {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(0);
    }
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
    check(gl.getError() === 0, "Tile fresh runtime GL failed");
    let blue = 0,
      green = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = pixels.subarray(i, i + 3);
      if (b > r * 2 && b > g * 1.5) blue++;
      if (g > r * 2 && g > b * 1.5) green++;
    }
    check(
      blue > 100 && green > 100,
      "Fresh tile runtime did not render both migrated frame colors",
    );
    return {
      freshSession: true,
      sourceHashes: true,
      conversionReproduced: true,
      colorSpace: "srgb",
      bluePixels: blue,
      greenPixels: green,
    };
  } finally {
    engine?.destroy();
    renderer.destroy();
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = cancel;
  }
}
