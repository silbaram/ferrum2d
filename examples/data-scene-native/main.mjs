// Optional consumer recipe. Copy into a game only when gameplay is requested.
import { createEngine, createDataSceneView, WebGL2Renderer, BITMAP_FONT_ATLAS_FORMAT, BITMAP_FONT_ATLAS_VERSION } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

export async function startNativeScene(canvas) {
  const renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true, clearColor: [0, 0, 0, 1] });
  let engine, view, frame, lightingEnabled = false, debugEnabled = false;
  let actor, tree, unrelated;
  const light = { x: 800, y: 600, radius: 100, intensity: 0.8, color: [1, 1, 1] };
  const worldLighting = { ambient: [0, 0, 0, 0.8], pointLights: [light],
    tileOccluders: [{ x: 900, y: 500, width: 20, height: 80 }], shadows: true };
  const instance = (id, x, y, layer, visual, extra = {}) => ({ id, prefab: "object", x, y, layer,
    props: { components: { visual: { kind: "sprite", texture: 1, width: 32, height: 64, ...visual },
      collider: { type: "aabb", halfWidth: 8, halfHeight: 8 }, layer: "player", ...extra } } });
  const document = { format: "ferrum2d.consumer.scene-authoring", version: 1,
    sceneComposition: { initialFragment: "island", prefabs: { object: {} }, fragments: { island: { instances: [
      instance("ground", 800, 600, -10, { texture: 1, width: 2400, height: 1800, tint: "#008800" }, { collider: "none", layer: "wall" }),
      instance("actor", 800, 600, 0, { texture: 2, originY: 1, tint: "#ff0000", depthSort: "hd2d" },
        { body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 1 } } }),
      instance("tree", 800, 620, 0, { texture: 3, width: 64, height: 120, originY: 1, tint: "#0000ff", depthSort: "hd2d" }, { collider: "none", layer: "wall" }),
      instance("shell", 850, 650, 0, { texture: 4, width: 12, height: 12, tint: "#ffff00" },
        { collider: { type: "circle", radius: 6, isTrigger: true }, layer: "pickup" }),
      instance("offscreen", 10000, 10000, 0, { texture: 5 }),
    ] } } }, behaviorRecipes: { entities: {} } };
  try {
    // Synthetic white atlas keeps the public recipe self-contained; real games load their own assets.
    const texture = documentCanvas();
    for (const id of [1, 2, 3, 4, 5, 99]) await renderer.loadTexture(id, texture.toDataURL());
    engine = await createEngine((state) => {
      const camera = view.snapshot(state);
      renderer.setLighting(lightingEnabled ? view.lighting(worldLighting, camera) : false);
      renderer.render();
      renderer.renderCommands(state.renderCommandBuffer);
      if (debugEnabled) renderer.renderPhysicsDebugLines(state.physicsDebugLineBuffer, { x: state.cameraX, y: state.cameraY });
      const stats = renderer.renderPostProcess();
      // QA evidence is opt-in here; gameplay does not copy individual sprite transforms.
      frame = { camera, commands: structuredClone(state.renderCommands), entityCount: state.entityCount,
        lineCount: state.physicsDebugLineBuffer.lineCount, stats: { ...stats } };
    }, undefined, undefined, () => renderer.viewportSize(), { includeDeprecatedRenderCommands: true, includePhysicsDebugLines: true });
    function apply() {
      const applied = applyDataSceneAuthoringDocument(engine, document);
      actor = applied.entityHandles.actor; tree = applied.entityHandles.tree;
      engine.registerBitmapFont(1, 99, { format: BITMAP_FONT_ATLAS_FORMAT, version: BITMAP_FONT_ATLAS_VERSION,
        lineHeight: 8, glyphs: { A: { uv: { u0: 0, v0: 0, u1: 1, v1: 1 }, size: { width: 8, height: 8 }, advance: 8 } } });
      engine.setWorldText(1, { fontId: 1, text: "A", x: 40, y: -80, anchor: actor, renderLayer: 2000 });
      view = createDataSceneView(engine, renderer, canvas, { x: 800, y: 600, follow: actor, zoom: 1 });
      unrelated = undefined;
      light.x = 800; light.y = 600;
    }
    apply();
    const move = (dx, dy) => {
      const moved = engine.moveHd2dKinematicBodyWithTilemap(actor, { displacementX: dx, displacementY: dy, solidMaskBits: 8 });
      if (!moved) throw new Error("Expected a current kinematic actor with a height span");
      light.x = moved.body.x; light.y = moved.body.y;
      return moved.body;
    };
    const onPointer = (event) => {
      const target = view.pointerToWorld({ x: event.clientX, y: event.clientY }, frame?.camera);
      const body = engine.getPhysicsEntity(actor);
      move(target.x - body.x, target.y - body.y);
    };
    canvas.addEventListener("pointerdown", onPointer);
    const resize = () => renderer.resize();
    window.addEventListener("resize", resize);
    engine.start();
    return {
      engine, renderer, get view() { return view; }, get frame() { return frame; }, get actor() { return actor; }, get tree() { return tree; },
      move, apply,
      lighting: (enabled) => { lightingEnabled = enabled; }, debug: (enabled) => { debugEnabled = enabled; },
      unrelatedHeight(enabled) {
        unrelated ??= engine.spawnRigidBody({ x: 100, y: 100, bodyType: "kinematic", collider: { type: "aabb", halfWidth: 8, halfHeight: 8 } });
        return enabled ? engine.setPhysicsBodyHeightSpan(unrelated, { floorId: 1, elevation: 0, height: 1 }) : engine.clearPhysicsBodyHeightSpan(unrelated);
      },
      destroy() { canvas.removeEventListener("pointerdown", onPointer); window.removeEventListener("resize", resize); engine.destroy(); renderer.destroy(); },
    };
  } catch (error) { engine?.destroy(); renderer.destroy(); throw error; }
}
function documentCanvas() {
  const canvas = globalThis.document.createElement("canvas"); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1, 1); return canvas;
}
