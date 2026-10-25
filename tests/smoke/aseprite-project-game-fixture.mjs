import {
  createEngine,
  AssetLoader,
  WebGL2Renderer,
} from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

export async function probeSavedProjectGame() {
  const catalogUrl = new URL(
    "/game/assets/.ferrum-aseprite/catalog.json",
    location.href,
  );
  const catalog = await (await fetch(catalogUrl)).json();
  const scene = await (await fetch("/game/scene-authoring.json")).json();
  const hasNormals = Object.values(scene.spatial?.billboards ?? {}).some(
    (value) => value.normalTexture,
  );
  const normalUrl = new URL(
    "/game/assets/.ferrum-normals/catalog.json",
    location.href,
  );
  const normalCatalog = hasNormals
    ? await (await fetch(normalUrl)).json()
    : undefined;
  const textures = Object.fromEntries(
    Object.entries(catalog.manifest.textures).map(([id, path]) => [
      id,
      new URL(path, catalogUrl).href,
    ]),
  );
  const textureOptions = { ...catalog.manifest.textureOptions };
  if (normalCatalog) {
    for (const [id, path] of Object.entries(normalCatalog.manifest.textures)) {
      textures[id] = new URL(path, normalUrl).href;
      textureOptions[id] = normalCatalog.manifest.textureOptions[id];
    }
    for (const [id, path] of Object.entries(normalCatalog.manifest.textures)) {
      const raw = await (await fetch(textures[id])).arrayBuffer();
      const actual = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", raw)),
      ]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      if (path !== `normal-${actual}.png`)
        throw Error("Saved normal PNG hash differs");
    }
    for (const billboard of Object.values(scene.spatial?.billboards ?? {}))
      if (
        billboard.normalTexture &&
        textureOptions[billboard.normalTexture]?.colorSpace !== "none"
      )
        throw Error("Saved normal color space differs");
  }
  for (const revision of catalog.revisions) {
    if (catalog.manifest.textureOptions[revision.assetId].colorSpace !== "srgb")
      throw Error("Saved manifest color space differs");
    const raw = await (await fetch(textures[revision.assetId])).arrayBuffer();
    const actual = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", raw)),
    ]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    if (actual !== revision.pngSha256)
      throw Error("Saved manifest PNG hash differs");
  }
  const canvas = document.querySelector("canvas");
  const renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true });
  const loader = new AssetLoader(renderer),
    originalRaf = requestAnimationFrame,
    originalCancel = cancelAnimationFrame,
    pending = new Map();
  let serial = 0,
    engine;
  globalThis.requestAnimationFrame = (callback) => {
    pending.set(++serial, callback);
    return serial;
  };
  globalThis.cancelAnimationFrame = (id) => pending.delete(id);
  try {
    await loader.loadAssets({
      textures,
      textureOptions,
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
    applyDataSceneAuthoringDocument(engine, scene);
    engine.pauseDataScene();
    if (!scene.spatial) {
      const pose = scene.sceneComposition.fragments.main.instances[0];
      engine.setDataSceneCamera({ x: pose.x, y: pose.y - 32 });
    }
    engine.start();
    for (let i = 0; i < 2; i++) {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(0);
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
    if (gl.getError()) throw Error("Saved project game GL failed");
    let blue = 0;
    for (let i = 0; i < bytes.length; i += 4)
      if (bytes[i + 2] > bytes[i] * 2 && bytes[i + 2] > bytes[i + 1] * 1.5)
        blue++;
    if (blue < 100)
      throw Error("Saved project manifest did not render the reimported frame");
    let normalLighting;
    if (hasNormals) {
      const flat = structuredClone(scene);
      for (const billboard of Object.values(flat.spatial.billboards)) {
        delete billboard.normalTexture;
        delete billboard.normalTextureId;
      }
      applyDataSceneAuthoringDocument(engine, flat);
      engine.pauseDataScene();
      for (let i = 0; i < 2; i++) {
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) callback(0);
      }
      const other = new Uint8Array(bytes.length);
      gl.readPixels(
        0,
        0,
        canvas.width,
        canvas.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        other,
      );
      let changedPixels = 0;
      for (let i = 0; i < other.length; i += 4)
        if (
          Math.abs(other[i] - bytes[i]) +
            Math.abs(other[i + 1] - bytes[i + 1]) +
            Math.abs(other[i + 2] - bytes[i + 2]) >
          3
        )
          changedPixels++;
      if (gl.getError() || changedPixels < 100)
        throw Error("Saved normal map did not affect native lighting");
      normalLighting = { changedPixels, normalColorSpace: "none" };
    }
    let animation;
    if (
      hasNormals &&
      scene.sceneComposition.fragments.main.instances.some(
        (i) => i.props.components.visual.animationSet,
      )
    ) {
      animation = (
        await import("./aseprite-paired-runtime-fixture.mjs")
      ).verifyPairedPlayback(
        engine,
        scene,
        (time) => {
          const callbacks = [...pending.values()];
          pending.clear();
          if (!callbacks.length) throw Error("Saved paired RAF stopped");
          for (const callback of callbacks) callback(time);
        },
        () => {
          const image = new Uint8Array(bytes.length);
          gl.readPixels(
            0,
            0,
            canvas.width,
            canvas.height,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            image,
          );
          if (gl.getError()) throw Error("Saved paired GL failed");
          return image;
        },
      );
    }
    return {
      ...(animation ? { animation } : {}),
      freshRuntime: true,
      manifestLoaded: true,
      hashes: true,
      bluePixels: blue,
      ...(normalLighting ? { normalLighting } : {}),
    };
  } finally {
    engine?.destroy();
    renderer.destroy();
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  }
}
