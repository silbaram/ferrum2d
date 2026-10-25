import { createEngine, WebGL2Renderer } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

/** Real generated atlas through the existing spatial material path. */
export async function probeGeneratedNormals() {
  const canvas = document.querySelector("canvas");
  const renderer = new WebGL2Renderer(canvas, {
    preserveDrawingBuffer: true,
    clearColor: [0.02, 0.02, 0.02, 1],
  });
  let frameCount = 0,
    lastStats,
    failure;
  const engine = await createEngine(
    (state) => {
      try {
        renderer.render();
        lastStats = renderer.renderCommands(state.renderCommandBuffer);
        renderer.renderPostProcess();
        frameCount++;
      } catch (error) {
        failure = error;
      }
    },
    () => ({}),
    undefined,
    () => renderer.viewportSize(),
  );
  try {
    await renderer.loadTexture(1, "/color.png");
    await renderer.loadTexture(2, "/normal.png", { colorSpace: "none" });
    await renderer.loadTexture(3, "/normal.png");
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
    engine.setViewportSize(
      ...[renderer.viewportSize().width, renderer.viewportSize().height],
    );
    const apply = async (normalTextureId) => {
      document.spatial.billboards.sprite =
        normalTextureId === undefined ? {} : { normalTextureId };
      applyDataSceneAuthoringDocument(engine, document);
      engine.pauseDataScene();
      const before = frameCount;
      for (
        let attempts = 0;
        frameCount < before + 2 && attempts < 120;
        attempts++
      ) {
        await new Promise(requestAnimationFrame);
        if (failure) throw failure;
      }
      if (frameCount < before + 2)
        throw new Error("Generated normal preview did not render");
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
      if (gl.getError() !== gl.NO_ERROR)
        throw new Error("Generated normal preview WebGL error");
      return pixels;
    };
    engine.start();
    const flat = await apply();
    await globalThis.saveNormalScreenshot("flat", canvas.toDataURL());
    const mapped = await apply(2);
    await globalThis.saveNormalScreenshot("normal-lit", canvas.toDataURL());
    let changedPixels = 0,
      visiblePixels = 0;
    for (let i = 0; i < flat.length; i += 4) {
      if (mapped[i] > 12 || mapped[i + 1] > 12 || mapped[i + 2] > 12)
        visiblePixels++;
      if (
        Math.abs(flat[i] - mapped[i]) +
          Math.abs(flat[i + 1] - mapped[i + 1]) +
          Math.abs(flat[i + 2] - mapped[i + 2]) >
        15
      )
        changedPixels++;
    }
    if (changedPixels < 100 || visiblePixels < 100)
      throw new Error(
        `Generated normal did not affect visible sprite lighting: ${changedPixels}/${visiblePixels}`,
      );
    failure = undefined;
    let srgbRejected = false;
    try {
      await apply(3);
    } catch (error) {
      srgbRejected = /normal atlas/.test(String(error));
    }
    if (!srgbRejected) throw new Error("sRGB generated normal was accepted");
    return {
      renderer: "webgl2",
      changedPixels,
      visiblePixels,
      srgbRejected,
      frames: frameCount,
      drawCalls: lastStats.drawCalls,
    };
  } finally {
    engine.stop();
    renderer.destroy();
  }
}
