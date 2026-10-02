import { createEngine } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

function assert(value, message) { if (!value) throw new Error(message); }

// Public authoring -> Rust scene -> bulk command buffer, including the output sprite's UV validation.
export async function sceneCommands(rectangles, textureId, defaultUv = [0, 0, 1, 1]) {
  let engine;
  let resolveFrame;
  let rejectFrame;
  const frameReady = new Promise((resolve, reject) => { resolveFrame = resolve; rejectFrame = reject; });
  try {
    engine = await createEngine((frame) => {
      engine.stop();
      try {
        assert(engine.dataSceneState() === "playing", "Data Scene must be playing");
        const commands = frame.renderCommandBuffer;
        assert(commands.commandCount === rectangles.length,
          `Rust command count: ${commands.commandCount}, entities: ${frame.entityCount}, camera: ${frame.cameraX},${frame.cameraY}`);
        // Snapshot before engine destruction invalidates the borrowed Wasm view.
        resolveFrame({ ...commands, buffer: commands.buffer.slice() });
      } catch (error) { rejectFrame(error); }
    });
    engine.useDataScene();
    engine.setViewportSize(128, 128);
    const originX = engine.cameraX() - 64;
    const originY = engine.cameraY() - 64;
    applyDataSceneAuthoringDocument(engine, {
      format: "ferrum2d.consumer.scene-authoring", version: 1,
      sceneComposition: {
        initialFragment: "main",
        prefabs: { sprite: {} },
        fragments: { main: { instances: rectangles.map(({ rect, uv = defaultUv, texture = textureId }, index) => ({
          id: `sprite-${index}`, prefab: "sprite",
          x: originX + rect[0] + rect[2] / 2, y: originY + rect[1] + rect[3] / 2,
          props: { components: {
            sprite: { texture, width: rect[2], height: rect[3],
              frame: { u0: uv[0], v0: uv[1], u1: uv[2], v1: uv[3] } },
            collider: "none", layer: "wall",
          } },
        })) } },
      },
      behaviorRecipes: { entities: {} },
    }, { activateDataScene: false });
    engine.start();
    return await frameReady;
  } finally { engine?.destroy(); }
}
