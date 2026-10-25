import {
  createEngine,
  WebGL2Renderer,
  AssetLoader,
} from "@ferrum2d/ferrum-web/core";
import {
  resolveSpriteNormalAssetBinding,
  diagnoseSpriteNormalAssetBinding,
  applyDataSceneAuthoringDocument,
} from "@ferrum2d/ferrum-web/authoring";

const check = (value, message) => {
  if (!value) throw new Error(message);
};
const hash = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
/** A fresh page has no original Worker, Blob URL, GPU registry or app session cache. */
export async function probeNormalResume() {
  const {
      bundle,
      document: scene,
      animation,
    } = await (await fetch("/resume.json")).json(),
    binding = resolveSpriteNormalAssetBinding(bundle.binding),
    measured = [],
    textures = {};
  for (const kind of ["color", "normal"]) {
    const name = binding.textures[kind].asset,
      path = bundle.manifest.textures[name],
      file = bundle.files.find((f) => f.path === path),
      url = "/resume/" + encodeURIComponent(path),
      bytes = await (await fetch(url)).arrayBuffer(),
      bitmap = await createImageBitmap(new Blob([bytes]));
    try {
      check((await hash(bytes)) === file.sha256, "Export file hash differs");
      measured.push({
        id: name,
        sha256: file.sha256,
        width: bitmap.width,
        height: bitmap.height,
        colorSpace: bundle.manifest.textureOptions[name].colorSpace,
      });
      textures[name] = url;
    } finally {
      bitmap.close();
    }
  }
  check(
    diagnoseSpriteNormalAssetBinding(binding, measured).length === 0,
    "Resumed catalog does not match provenance",
  );
  check(
    binding.generation.configSha256 === bundle.report.config.sha256,
    "Resumed report differs",
  );
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "width:480px;height:360px";
  document.body.append(canvas);
  const renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true }),
    loader = new AssetLoader(renderer),
    originalRaf = globalThis.requestAnimationFrame,
    originalCancel = globalThis.cancelAnimationFrame,
    pending = new Map();
  let engine,
    nextId = 0;
  globalThis.requestAnimationFrame = (cb) => {
    pending.set(++nextId, cb);
    return nextId;
  };
  globalThis.cancelAnimationFrame = (id) => pending.delete(id);
  const pump = (time = 0) => {
    const callbacks = [...pending.values()];
    pending.clear();
    check(callbacks.length > 0, "Resumed native RAF stopped");
    for (const cb of callbacks) cb(time);
  };
  try {
    // Deliberately change registration order; persisted identities must be project names.
    await loader.loadAssets({
      textures: {
        filler: textures[binding.textures.color.asset],
        [binding.textures.normal.asset]:
          textures[binding.textures.normal.asset],
        [binding.textures.color.asset]: textures[binding.textures.color.asset],
      },
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
    engine.start();
    const render = (doc) => {
        applyDataSceneAuthoringDocument(engine, doc);
        engine.pauseDataScene();
        pump();
        pump();
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
        check(gl.getError() === 0, "Resumed renderer failed");
        return bytes;
      },
      lit = render(scene),
      flat = structuredClone(scene);
    delete flat.spatial.billboards.sprite.normalTexture;
    const flatPixels = render(flat);
    let lightingDifference = 0;
    for (let i = 0; i < lit.length; i += 4)
      if ([0, 1, 2].some((c) => Math.abs(lit[i + c] - flatPixels[i + c]) > 5))
        lightingDifference++;
    const playback = animation
      ? (
          await import("./aseprite-paired-runtime-fixture.mjs")
        ).verifyPairedPlayback(engine, scene, pump, () => {
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
          check(gl.getError() === 0, "Paired GL failed");
          return bytes;
        })
      : undefined;
    return {
      freshSession: true,
      hashesAndColorSpaces: true,
      stableReferences: true,
      reportProvenance: true,
      lightingDifference,
      ...(playback ? { animation: playback } : {}),
    };
  } finally {
    engine?.destroy();
    renderer.destroy();
    canvas.remove();
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  }
}
