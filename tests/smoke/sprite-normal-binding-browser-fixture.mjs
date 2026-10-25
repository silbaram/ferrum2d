import {
  createEngine,
  WebGL2Renderer,
  AssetLoader,
} from "@ferrum2d/ferrum-web/core";
import {
  createSpriteNormalAssetBinding,
  resolveSpriteNormalAssetBinding,
  diagnoseSpriteNormalAssetBinding,
  createSceneSpriteNormalPatch,
  mergeScenePlacementPatch,
  createScenePlacementViewer,
  createScenePlacementAgentHandoff,
  applyDataSceneAuthoringDocument,
} from "@ferrum2d/ferrum-web/authoring";

function assert(value, message) {
  if (!value) throw new Error(message);
}
const sha256 = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
function difference(a, b) {
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
}
export function normalBindingDocument() {
  return {
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
                    texture: 0,
                    width: 64,
                    height: 64,
                    originX: 0.5,
                    originY: 1,
                  },
                  collider: { type: "aabb", halfWidth: 32, halfHeight: 32 },
                  body: { type: "static" },
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
      billboards: { sprite: {} },
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
}

export async function probeNormalBinding() {
  const report = await (await fetch("/report.json")).json(),
    context = await (await fetch("/context.json")).json();
  const descriptorBytes = context.animated
    ? await (await fetch("/animation.json")).arrayBuffer()
    : undefined;
  const binding = createSpriteNormalAssetBinding({
    report,
    resultIndex: context.resultIndex,
    ...(descriptorBytes
      ? {
          descriptor: JSON.parse(new TextDecoder().decode(descriptorBytes)),
          descriptorSha256: await sha256(descriptorBytes),
        }
      : {}),
    colorAsset: "generated.hero.color",
    normalAsset: "generated.hero.normal",
  });
  const measured = [];
  for (const kind of ["color", "normal"]) {
    const bytes = await (await fetch(`/${kind}.png`)).arrayBuffer(),
      bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
    measured.push({
      id: binding.textures[kind].asset,
      width: bitmap.width,
      height: bitmap.height,
      colorSpace: binding.textures[kind].colorSpace,
      sha256: await sha256(bytes),
      frames: binding.frames,
    });
    bitmap.close();
  }
  assert(
    diagnoseSpriteNormalAssetBinding(binding, measured).length === 0,
    "Measured generated textures failed binding validation",
  );
  const source = normalBindingDocument(),
    original = JSON.stringify(source);
  const generated = createSceneSpriteNormalPatch(source, binding, {
    instanceId: "sprite",
    assets: measured,
  });
  assert(
    JSON.stringify(
      createSceneSpriteNormalPatch(source, binding, {
        instanceId: "sprite",
        assets: measured,
      }),
    ) === JSON.stringify(generated),
    "Non-deterministic normal patch",
  );
  assert(
    JSON.stringify(source) === original,
    "Normal patch mutated source authoring",
  );
  const merged = mergeScenePlacementPatch(source, generated.patch).document;
  const state = createScenePlacementViewer({
    document: source,
    viewport: { cssWidth: 480, cssHeight: 360 },
  }).state();
  const handoff = createScenePlacementAgentHandoff({
    document: source,
    state,
    patch: generated.patch,
    normalBindings: [generated.evidence],
  });
  assert(
    handoff.normalBindings[0].binding.generation.configSha256 ===
      report.config.sha256,
    "Handoff lost config provenance",
  );
  assert(
    handoff.normalBindings[0].binding.textures.normal.sha256 ===
      measured[1].sha256,
    "Handoff lost output provenance",
  );
  const reopened = JSON.parse(JSON.stringify(merged)),
    restoredBinding = resolveSpriteNormalAssetBinding(
      JSON.parse(JSON.stringify(binding)),
    );
  assert(
    reopened.spatial.billboards.sprite.normalTexture ===
      binding.textures.normal.asset &&
      !Object.hasOwn(reopened.spatial.billboards.sprite, "normalTextureId"),
    "Document persisted a session texture ID",
  );
  const diagnostics = [];
  for (const [name, metadata, code] of [
    ["missing", [measured[0]], "missingTexture"],
    [
      "srgb",
      [measured[0], { ...measured[1], colorSpace: "srgb" }],
      "colorSpaceMismatch",
    ],
    [
      "dimensions",
      [measured[0], { ...measured[1], width: 1 }],
      "dimensionsMismatch",
    ],
    [
      "uv",
      [
        measured[0],
        { ...measured[1], frames: [{ u0: 0, v0: 0, u1: 0.5, v1: 1 }] },
      ],
      "frameLayoutMismatch",
    ],
  ]) {
    assert(
      diagnoseSpriteNormalAssetBinding(binding, metadata).some(
        (d) => d.code === code,
      ),
      `Missing ${name} diagnostic`,
    );
    let rejected = false;
    try {
      createSceneSpriteNormalPatch(source, binding, {
        instanceId: "sprite",
        assets: metadata,
      });
    } catch {
      rejected = true;
    }
    assert(
      rejected && JSON.stringify(source) === original,
      `${name} validation changed the source`,
    );
    diagnostics.push(code);
  }
  const originalRaf = globalThis.requestAnimationFrame,
    originalCancel = globalThis.cancelAnimationFrame;
  const pending = new Map();
  let nextId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    pending.set(++nextId, callback);
    return nextId;
  };
  globalThis.cancelAnimationFrame = (id) => pending.delete(id);
  const pump = () => {
    const callbacks = [...pending.values()];
    pending.clear();
    assert(callbacks.length > 0, "Preview RAF not running");
    for (const callback of callbacks) callback(0);
  };
  const captures = [],
    sessions = [];
  let engine, renderer;
  try {
    for (let pass = 0; pass < 2; pass++) {
      const canvas = documentCanvas();
      renderer = new WebGL2Renderer(canvas, {
        preserveDrawingBuffer: true,
        clearColor: [0.02, 0.02, 0.02, 1],
      });
      const loader = new AssetLoader(renderer),
        urls = {};
      if (pass) {
        urls[binding.textures.normal.asset] = "/normal.png";
        urls.filler = "/color.png";
        urls[binding.textures.color.asset] = "/color.png";
      } else {
        urls[binding.textures.color.asset] = "/color.png";
        urls[binding.textures.normal.asset] = "/normal.png";
      }
      await loader.loadAssets({
        textures: urls,
        textureOptions: {
          [binding.textures.normal.asset]: { colorSpace: "none" },
        },
      });
      let materialId;
      engine = await createEngine(
        (frame) => {
          renderer.render();
          renderer.renderCommands(frame.renderCommandBuffer);
          renderer.renderPostProcess();
          materialId =
            frame.renderCommandBuffer.spatial?.materials?.billboards[0];
        },
        () => ({}),
        loader,
        () => renderer.viewportSize(),
        { fixedTimestep: false },
      );
      const size = renderer.viewportSize();
      engine.setViewportSize(size.width, size.height);
      let handle = applyDataSceneAuthoringDocument(engine, reopened)
        .entityHandles.sprite;
      engine.pauseDataScene();
      engine.start();
      pump();
      pump();
      assert(
        materialId === loader.textureId(binding.textures.normal.asset),
        "Native material did not use the current normal registry ID",
      );
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
        assert(gl.getError() === gl.NO_ERROR, "Binding WebGL error");
        return data;
      };
      const select = (frame) => {
        if (restoredBinding.animationSet)
          assert(
            engine.updateDataSceneSpriteAnimations([
              { entity: handle, frame, paused: true },
            ]),
            "Native frame update rejected",
          );
        pump();
      };
      const clip = restoredBinding.animationSet?.clips[0],
        unique = clip ? [] : [0];
      for (let frame = 0; clip && frame < clip.frames.length; frame++)
        if (
          !unique.some(
            (i) =>
              JSON.stringify(clip.frames[i]) ===
              JSON.stringify(clip.frames[frame]),
          )
        )
          unique.push(frame);
      const litFrames = [],
        lighting = [];
      for (const [index, frame] of unique.entries()) {
        select(frame);
        const lit = pixels();
        litFrames.push(lit);
        if (pass === 0)
          await globalThis.saveAnimationScreenshot(
            `binding-frame-${index}`,
            canvas.toDataURL(),
          );
        const flatPatch = {
          format: "ferrum2d.scene-placement.patch",
          version: 3,
          operations: [],
          spatial: {
            format: "ferrum2d.scene-spatial.patch",
            version: 4,
            operations: [
              {
                kind: "setBillboardNormalTexture",
                id: "sprite",
                changes: { normalTexture: null },
              },
            ],
          },
        };
        const flatDocument = mergeScenePlacementPatch(
          reopened,
          flatPatch,
        ).document;
        handle = applyDataSceneAuthoringDocument(engine, flatDocument)
          .entityHandles.sprite;
        engine.pauseDataScene();
        select(frame);
        const flat = pixels();
        const changed = difference(lit, flat);
        assert(changed > 50, "Named generated normal did not affect lighting");
        lighting.push(changed);
        handle = applyDataSceneAuthoringDocument(engine, reopened).entityHandles
          .sprite;
        engine.pauseDataScene();
        select(frame);
      }
      // A missing name must reject before destructive activation, preserving the current native handle and image.
      const before = pixels(),
        missing = structuredClone(reopened);
      missing.spatial.billboards.sprite.normalTexture = "missing.normal";
      let rejected = false;
      try {
        applyDataSceneAuthoringDocument(engine, missing);
      } catch (error) {
        rejected = /not registered/.test(String(error));
      }
      assert(
        rejected &&
          (clip
            ? engine.dataSceneSpriteAnimationState(handle)
            : engine.getPhysicsEntity(handle)),
        "Missing normal replaced the live scene",
      );
      pump();
      assert(
        difference(before, pixels()) === 0,
        "Missing normal changed the current render",
      );
      // Reimport candidate bytes differ but are validated before replacing the current GPU asset.
      const candidate = documentCanvas();
      candidate.width = binding.width;
      candidate.height = binding.height;
      const ctx = candidate.getContext("2d");
      ctx.fillStyle = "#8080ff";
      ctx.fillRect(0, 0, candidate.width, candidate.height);
      const blob = await new Promise((resolve) => candidate.toBlob(resolve)),
        replacementHash = await sha256(await blob.arrayBuffer());
      candidate.remove();
      const candidateMetadata = [
        measured[0],
        { ...measured[1], sha256: replacementHash },
      ];
      assert(
        diagnoseSpriteNormalAssetBinding(binding, candidateMetadata).some(
          (d) => d.code === "contentHashMismatch",
        ),
        "Changed reimport bytes were accepted as the previous generation",
      );
      let staleRejected = false;
      try {
        createSceneSpriteNormalPatch(reopened, binding, {
          instanceId: "sprite",
          assets: candidateMetadata,
        });
      } catch {
        staleRejected = true;
      }
      assert(
        staleRejected && difference(before, pixels()) === 0,
        "Rejected reimport modified the GPU scene",
      );
      captures.push(litFrames);
      sessions.push({
        colorId: loader.textureId(binding.textures.color.asset),
        normalId: loader.textureId(binding.textures.normal.asset),
        normalMaterialId: materialId,
        lighting,
        missingPreserved: true,
        reimportPreserved: true,
      });
      engine.destroy();
      engine = undefined;
      renderer.destroy();
      renderer = undefined;
      canvas.remove();
    }
    assert(
      sessions[0].normalId !== sessions[1].normalId &&
        sessions[0].colorId !== sessions[1].colorId,
      "Reload test did not change runtime texture IDs",
    );
    for (let frame = 0; frame < captures[0].length; frame++)
      assert(
        difference(captures[0][frame], captures[1][frame]) === 0,
        "Restored named atlas rendered differently with new runtime IDs",
      );
    await globalThis.saveNormalBindingArtifacts({
      binding,
      patch: generated.patch,
      document: reopened,
      handoff,
    });
    return {
      renderer: "webgl2",
      stableReferences: true,
      deterministicPatch: true,
      handoffProvenance: true,
      documentRoundTrip: true,
      sourceUnchanged: true,
      diagnostics: [...diagnostics, "contentHashMismatch"],
      sessions,
      pixelsStableAcrossRegistryChange: true,
    };
  } finally {
    engine?.destroy();
    renderer?.destroy();
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  }
}
function documentCanvas() {
  const canvas = globalThis.document.createElement("canvas");
  globalThis.document.body.append(canvas);
  return canvas;
}
