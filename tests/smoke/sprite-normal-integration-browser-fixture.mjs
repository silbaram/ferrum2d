import {
  createEngine,
  createRenderer,
  AssetLoader,
} from "@ferrum2d/ferrum-web/core";
import {
  createSpriteNormalAssetBinding,
  createSceneSpriteNormalPatch,
  mergeScenePlacementPatch,
  applyDataSceneAuthoringDocument,
} from "@ferrum2d/ferrum-web/authoring";
import { normalBindingDocument } from "./sprite-normal-binding-browser-fixture.mjs";
import {
  check,
  pixels,
  difference,
  png,
} from "./spatial-webgpu-browser-fixture.mjs";

const hash = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");

/** Actual native packets and renderer readback. No simulation or shading substitutes. */
export async function probeNormalIntegration() {
  const report = await (await fetch("/report.json")).json(),
    context = await (await fetch("/context.json")).json(),
    descriptorBytes = await (await fetch("/animation.json")).arrayBuffer(),
    binding = createSpriteNormalAssetBinding({
      report,
      resultIndex: context.resultIndex,
      descriptor: JSON.parse(new TextDecoder().decode(descriptorBytes)),
      descriptorSha256: await hash(descriptorBytes),
      colorAsset: "matrix.color",
      normalAsset: "matrix.normal",
    }),
    measured = [];
  for (const kind of ["color", "normal"]) {
    const bytes = await (await fetch(`/${kind}.png`)).arrayBuffer(),
      bitmap = await createImageBitmap(new Blob([bytes]));
    measured.push({
      id: binding.textures[kind].asset,
      width: bitmap.width,
      height: bitmap.height,
      sha256: await hash(bytes),
      colorSpace: binding.textures[kind].colorSpace,
    });
    bitmap.close();
  }
  const source = normalBindingDocument(),
    patch = createSceneSpriteNormalPatch(source, binding, {
      instanceId: "sprite",
      assets: measured,
    }),
    doc = mergeScenePlacementPatch(source, patch.patch).document,
    clip = binding.animationSet.clips[0],
    unique = [];
  // Native repeated UV frames represent rational source delays; exercise every unique source frame.
  for (let frame = 0; frame < clip.frames.length; frame++)
    if (
      !unique.some(
        (i) =>
          JSON.stringify(clip.frames[i]) === JSON.stringify(clip.frames[frame]),
      )
    )
      unique.push(frame);
  let adapter;
  try {
    adapter = await navigator.gpu?.requestAdapter();
  } catch {
    /* Absence is recorded below. */
  }
  const webgpu = {
    available: !!adapter,
    capture: "real GPU offscreen target",
    adapter: adapter?.info?.description ?? null,
  };
  const originalRaf = globalThis.requestAnimationFrame,
    originalCancel = globalThis.cancelAnimationFrame,
    pending = new Map();
  let nextId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    pending.set(++nextId, callback);
    return nextId;
  };
  globalThis.cancelAnimationFrame = (id) => pending.delete(id);
  const pump = () => {
    const callbacks = [...pending.values()];
    pending.clear();
    check(callbacks.length > 0, "Native preview RAF stopped");
    for (const callback of callbacks) callback(0);
  };
  const results = [],
    references = new Map();
  try {
    for (const backend of [
      "webgl2",
      ...(adapter ? ["webgpu"] : []),
      "forced-fallback",
    ]) {
      const canvas = document.createElement("canvas");
      canvas.style.cssText = "width:320px;height:240px";
      canvas.dataset.spatialGpuTarget = String(backend === "webgpu");
      document.body.append(canvas);
      const fallbacks = [],
        gpu = navigator.gpu,
        ownRequest =
          gpu && Object.getOwnPropertyDescriptor(gpu, "requestAdapter");
      let renderer,
        engine,
        disposing = false;
      const gpuErrors = [];
      try {
        if (backend === "forced-fallback" && gpu)
          Object.defineProperty(gpu, "requestAdapter", {
            configurable: true,
            value: async () => null,
          });
        try {
          renderer = await createRenderer(canvas, {
            preferred: backend === "webgl2" ? "webgl2" : "webgpu",
            fallbackBehavior: "silent",
            onFallback: (info) => fallbacks.push(String(info.reason)),
            webgl2: {
              preserveDrawingBuffer: true,
              clearColor: [0.02, 0.02, 0.02, 1],
            },
            webgpu: { clearColor: [0.02, 0.02, 0.02, 1] },
          });
        } finally {
          if (backend === "forced-fallback" && gpu) {
            if (ownRequest)
              Object.defineProperty(gpu, "requestAdapter", ownRequest);
            else delete gpu.requestAdapter;
          }
        }
        check(
          (typeof renderer.gpuDevice === "function") === (backend === "webgpu"),
          "Wrong actual renderer",
          { backend, fallbacks },
        );
        check(
          fallbacks.length === (backend === "forced-fallback" ? 1 : 0),
          "Unexpected fallback",
          fallbacks,
        );
        if (backend === "webgpu") {
          renderer
            .gpuDevice()
            .addEventListener("uncapturederror", (event) =>
              gpuErrors.push(event.error.message),
            );
          renderer.gpuDevice().lost.then((info) => {
            if (!disposing) gpuErrors.push(info.message);
          });
        }
        const loader = new AssetLoader(renderer);
        await loader.loadAssets({
          textures: {
            "matrix.color": "/color.png",
            "matrix.normal": "/normal.png",
          },
          textureOptions: { "matrix.normal": { colorSpace: "none" } },
        });
        let normalId;
        engine = await createEngine(
          (frame) => {
            renderer.render();
            renderer.renderCommands(frame.renderCommandBuffer);
            renderer.renderPostProcess();
            normalId =
              frame.renderCommandBuffer.spatial?.materials?.billboards[0];
          },
          () => ({}),
          loader,
          () => renderer.viewportSize(),
          { fixedTimestep: false },
        );
        const size = renderer.viewportSize();
        engine.setViewportSize(size.width, size.height);
        check(
          canvas.width === 320 * devicePixelRatio &&
            canvas.height === 240 * devicePixelRatio,
          "DPR buffer mismatch",
          size,
        );
        engine.start();
        const rows = [];
        for (const mode of ["2d", "hd2d"]) {
          for (const rotation of [0, 0.7]) {
            const current = structuredClone(doc);
            current.sceneComposition.fragments.normal.instances[0].rotationRadians =
              rotation;
            if (mode === "2d") delete current.spatial;
            // Compare an identical native scene with only its normal reference removed.
            const flatDocument = structuredClone(current);
            if (mode === "hd2d")
              delete flatDocument.spatial.billboards.sprite.normalTexture;
            for (const flipX of [false, true])
              for (const flipY of [false, true])
                for (const frame of unique) {
                  const render = async (document) => {
                    const handle = applyDataSceneAuthoringDocument(
                      engine,
                      document,
                    ).entityHandles.sprite;
                    if (mode === "2d")
                      check(
                        engine.setDataSceneCamera({ x: 0, y: -32 }),
                        "2D camera rejected",
                      );
                    engine.pauseDataScene();
                    check(
                      engine.updateDataSceneSpriteAnimations([
                        { entity: handle, frame, paused: true, flipX, flipY },
                      ]),
                      "Native pose rejected",
                    );
                    pump();
                    pump();
                    if (mode === "hd2d" && document === current)
                      check(
                        normalId === loader.textureId("matrix.normal"),
                        "Native material lost the named normal",
                      );
                    return pixels(renderer, canvas);
                  };
                  const lit = await render(current),
                    flat = await render(flatDocument),
                    changed = difference(lit, flat, 5),
                    key = JSON.stringify([mode, rotation, flipX, flipY, frame]);
                  if (mode === "hd2d")
                    check(
                      changed > 20 * devicePixelRatio ** 2,
                      "Generated normal lost lighting in pose",
                      { mode, rotation, flipX, flipY, frame, changed },
                    );
                  else
                    check(
                      changed === 0,
                      "2D color rendering consumed a spatial normal",
                    );
                  let parity = 0;
                  if (backend === "webgl2") references.set(key, lit);
                  else {
                    parity = difference(references.get(key), lit, 8);
                    check(
                      backend === "forced-fallback"
                        ? parity === 0
                        : parity < canvas.width * canvas.height * 0.005,
                      "Backend normal atlas parity failed",
                      { backend, key, parity },
                    );
                  }
                  rows.push({
                    mode,
                    rotation,
                    flipX,
                    flipY,
                    frame,
                    changed,
                    parity,
                  });
                  if (!rotation && !flipX && !flipY && frame === unique[0])
                    await globalThis.saveAnimationScreenshot(
                      `${backend}-${mode}`,
                      png(lit, canvas.width, canvas.height),
                    );
                }
          }
        }
        // An asymmetric animated fixture must produce distinct frame, flip and rotation images.
        if (backend === "webgl2")
          for (const mode of ["2d", "hd2d"]) {
            const baseline = references.get(
              JSON.stringify([mode, 0, false, false, unique[0]]),
            );
            for (const pose of [
              [mode, 0.7, false, false, unique[0]],
              [mode, 0, true, false, unique[0]],
              [mode, 0, false, true, unique[0]],
              [mode, 0, false, false, unique[1]],
            ])
              check(
                difference(baseline, references.get(JSON.stringify(pose)), 5) >
                  5,
                "Pose/frame did not reach native renderer",
                pose,
              );
          }
        check(
          gpuErrors.length === 0,
          "WebGPU validation/device error",
          gpuErrors,
        );
        results.push({
          backend,
          width: canvas.width,
          height: canvas.height,
          fallbacks,
          gpuErrors,
          rows,
        });
      } finally {
        disposing = true;
        engine?.destroy();
        renderer?.destroy();
        globalThis.disposeSpatialGpuTarget?.(canvas);
        canvas.remove();
      }
    }
    return {
      webgpu,
      uniqueSourceFrames: unique.length,
      nativeFrames: clip.frames.length,
      results,
    };
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  }
}
