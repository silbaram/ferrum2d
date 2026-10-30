import {
  createEngine,
  AssetLoader,
  WebGL2Renderer,
} from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument, DATA_SCENE_PRIMITIVE_TEXTURES } from "@ferrum2d/ferrum-web/authoring";
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
export async function probeSavedProjectGame() {
  const base = "/game/assets/.ferrum-tiles/",
    bundle = await (await fetch(base + "catalog.json")).json(),
    textures = {};
  bundle.sceneDocument = await (
    await fetch("/game/scene-authoring.json")
  ).json();
  for (const revision of bundle.revisions) {
    const raw = await (
        await fetch(base + revision.assetId + ".json")
      ).arrayBuffer(),
      png = await (await fetch(base + revision.assetId + ".png")).arrayBuffer();
    check(
      (await hash(raw)) === revision.jsonSha256 &&
        (await hash(png)) === revision.pngSha256,
      "Tile raw source hash differs",
    );
    const externalTilesets = {};
    for (const [i, dep] of (revision.dependencies ?? []).entries()) {
      const bytes = await (
        await fetch(base + revision.assetId + `.dep.${i}.tsj`)
      ).arrayBuffer();
      check((await hash(bytes)) === dep.sha256, "Original TSJ hash differs");
      externalTilesets[dep.source] = JSON.parse(
        new TextDecoder().decode(bytes),
      );
    }
    const input = JSON.parse(new TextDecoder().decode(raw)),
      texture = (context) =>
        !revision.tilesetKey ||
        revision.tilesetKey ===
          (revision.kind === "tiled"
            ? `tiled:${context.tilesetName}`
            : `ldtk:${context.tilesetUid}`)
          ? revision.assetId
          : "unselected",
      map =
        revision.kind === "tiled"
          ? importTiledTilemap(input, { texture, externalTilesets })
          : importLDtkTilemap(input, {
              texture,
              levelIndex: revision.levelIndex,
            });
    check(
      Object.keys(map.atlas.frames).length > 0,
      "Saved tile source conversion is empty",
    );
    const selectedFrames = Object.values(map.atlas.frames).filter(
      (frame) => frame.texture === revision.assetId,
    );
    check(
      selectedFrames.length === 2,
      "Selected source frames were not reconstructed",
    );
    for (const fragment of Object.values(
      bundle.sceneDocument.sceneComposition.fragments,
    )) {
      for (const instance of fragment.instances) {
        const visual = instance.props?.components?.visual;
        if (visual?.texture === revision.assetId)
          check(
            selectedFrames.some((frame) =>
              ["u0", "v0", "u1", "v1"].every(
                (key) =>
                  Math.fround(frame.uv[key]) === Math.fround(visual.frame[key]),
              ),
            ),
            "Saved scene UV differs from selected original frames",
          );
      }
    }
    const image = await createImageBitmap(new Blob([png]));
    try {
      check(
        image.width === revision.width && image.height === revision.height,
        "Tile PNG dimensions differ",
      );
    } finally {
      image.close();
    }
    textures[revision.assetId] = base + revision.assetId + ".png";
    check(
      bundle.manifest.textureOptions[revision.assetId].colorSpace === "srgb",
      "Tile color space differs",
    );
  }
  // Fixture project asset for its explicitly mapped primitive prefab; independent of imported atlases.
  textures[DATA_SCENE_PRIMITIVE_TEXTURES.rect] = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNIWHbnPwAGLgLidJoamwAAAABJRU5ErkJggg==';
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
