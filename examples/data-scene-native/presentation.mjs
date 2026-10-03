// Optional public-API recipe for #68–#70. Never generated during setup-only installation.
import { createEngine, createDataSceneView, WebGL2Renderer, BITMAP_FONT_ATLAS_FORMAT, BITMAP_FONT_ATLAS_VERSION } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

export async function startPresentationScene(canvas, { colorManagement = "legacy", groundYScale = 0.72, backend = "webgl2" } = {}) {
  const renderer = backend === "webgpu"
    ? await (await import("@ferrum2d/ferrum-web/labs")).WebGPURenderer.create(canvas, { colorManagement, clearColor: [0, 0, 0, 1] })
    : new WebGL2Renderer(canvas, { colorManagement, preserveDrawingBuffer: true, clearColor: [0, 0, 0, 1] });
  let engine, view, handles, frame, lastPointerMove, lightingScene = false, debugEnabled = false, uploads = 0;
  const defaultLighting = { ambient: [0, 0, 0, 0.2],
    pointLights: [{ x: 470, y: 300, radius: 80, intensity: 0.3, color: [1, 1, 1] }],
    tileOccluders: [{ x: 520, y: 270, width: 10, height: 60 }], shadows: true };
  const loadTexture = renderer.loadTexture.bind(renderer);
  renderer.loadTexture = (...args) => { uploads += 1; return loadTexture(...args); };
  const clipFrames = [0, 1, 2, 3].map((i) => ({ u0: i / 4, v0: 0, u1: (i + 1) / 4, v1: 1 }));
  const animationSet = { clips: [
    { id: 0, frames: [clipFrames[0]], fps: 8 },
    { id: 1, frames: clipFrames.slice(1), fps: 8 },
    { id: 2, frames: clipFrames.slice(1), fps: 8, loop: false },
  ], initialClip: 0 };
  const sun = { directionX: 1, directionY: 0.5, intensity: 0.05, shadowOpacity: 0.5, shadowLengthScale: 1, maxCasters: 2000 };
  const instance = (id, x, y, layer, visual, extra = {}) => ({ id, prefab: "object", x, y, layer,
    props: { components: { visual: { kind: "sprite", texture: 1, width: 32, height: 48, originY: 1, depthSort: "hd2d", ...visual },
      collider: "none", layer: "wall", ...extra } } });
  const actor = (id, x) => instance(id, x, 350, 0, { texture: 2, animationSet, shadow: { shape: "ellipse", width: 24, height: 36 } },
    { layer: "player", body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 1 } }, collider: { type: "aabb", halfWidth: 8, halfHeight: 8, isTrigger: false } });
  const baseInstances = [
    instance("ground", 400, 300, -10, { width: 1800, height: 1600, originY: 0.5, projection: "ground", tint: "#808080", depthSort: "layer" }),
    actor("actor", 330), actor("other", 450),
    instance("tree", 400, 330, 0, { texture: 3, width: 48, height: 100, shadow: { shape: "box", width: 40 } }),
    instance("far", 10000, 10000, 0, { texture: 3 }),
  ];
  const documentFor = (instances) => ({ format: "ferrum2d.consumer.scene-authoring", version: 1,
    sceneComposition: { initialFragment: "world", prefabs: { object: {} }, fragments: { world: { instances } } }, behaviorRecipes: { entities: {} } });
  try {
    const image = globalThis.document.createElement("canvas"); image.width = image.height = 1;
    image.getContext("2d").fillStyle = "white"; image.getContext("2d").fillRect(0, 0, 1, 1);
    await renderer.loadTexture(1, image.toDataURL());
    const atlas = globalThis.document.createElement("canvas"); atlas.width = 128; atlas.height = 48;
    const ctx = atlas.getContext("2d");
    for (let i = 0; i < 4; i += 1) {
      ctx.fillStyle = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"][i]; ctx.fillRect(i * 32, 0, 32, 48);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(i * 32, 8, 8, 32);
    }
    await renderer.loadTexture(2, atlas.toDataURL());
    image.getContext("2d").fillStyle = "#003366"; image.getContext("2d").fillRect(0, 0, 1, 1);
    await renderer.loadTexture(3, image.toDataURL());
    image.getContext("2d").fillStyle = "white"; image.getContext("2d").fillRect(0, 0, 1, 1);
    await renderer.loadTexture(99, image.toDataURL());
    engine = await createEngine((state) => {
      const start = performance.now(), camera = view.snapshot(state);
      renderer.setLighting(lightingScene === false ? false : view.lighting(lightingScene, camera));
      renderer.render(); renderer.renderCommands(state.renderCommandBuffer);
      if (debugEnabled) renderer.renderPhysicsDebugLines(state.physicsDebugLineBuffer, { x: state.cameraX, y: state.cameraY });
      const stats = renderer.renderPostProcess();
      frame = { camera, renderMs: performance.now() - start, commands: structuredClone(state.renderCommands),
        rustUpdateMs: state.rustUpdateTimeMs, entityCount: state.entityCount, lineCount: state.physicsDebugLineBuffer.lineCount, stats: { ...stats } };
    }, undefined, undefined, () => renderer.viewportSize(), { includeDeprecatedRenderCommands: true, includePhysicsDebugLines: true });
    engine.setPhysicsDebugOptions({ colliders: true });
    const apply = (instances = baseInstances) => {
      handles = applyDataSceneAuthoringDocument(engine, documentFor(instances), { colorManagement }).entityHandles;
      view = createDataSceneView(engine, renderer, canvas, { x: 400, y: 330, groundYScale, sun });
      engine.registerBitmapFont(1, 99, { format: BITMAP_FONT_ATLAS_FORMAT, version: BITMAP_FONT_ATLAS_VERSION,
        lineHeight: 8, glyphs: { A: { uv: { u0: 0, v0: 0, u1: 1, v1: 1 }, size: { width: 8, height: 8 }, advance: 8 } } });
      if (handles.actor) engine.setWorldText(1, { fontId: 1, text: "AA", x: 0, y: -80, anchor: handles.actor, renderLayer: 2000 });
    };
    apply();
    const move = (entity, x, y) => {
      const body = engine.getPhysicsEntity(entity);
      const result = engine.moveHd2dKinematicBodyWithTilemap(entity, { displacementX: x - body.x, displacementY: y - body.y, solidMaskBits: 8 });
      if (result === undefined) throw new Error("Expected a current actor with an AABB kinematic body");
      return result;
    };
    const pointer = (event) => {
      const point = view.pointerToWorld({ x: event.clientX, y: event.clientY }, frame?.camera);
      lastPointerMove = { point, result: move(handles.actor, point.x, point.y) };
    };
    const resize = () => renderer.resize();
    canvas.addEventListener("pointerdown", pointer); window.addEventListener("resize", resize); engine.start();
    return { engine, renderer, get view() { return view; }, get handles() { return handles; }, get frame() { return frame; }, get uploads() { return uploads; },
      apply, move, sun, get lastPointerMove() { return lastPointerMove; }, lighting: (scene) => { lightingScene = scene === true ? defaultLighting : scene; }, debug: (enabled) => { debugEnabled = enabled; },
      mass(count) {
        const instances = [baseInstances[0]];
        for (let i = 0; i < count; i += 1) instances.push(instance(`caster${i}`, 370 + (i % 32) * 2, 310 + Math.floor(i / 32) * 2, 0,
          { texture: 3, width: 2, height: 4, shadow: { shape: "ellipse", width: 2, height: 4 } }));
        apply(instances);
      },
      destroy() { canvas.removeEventListener("pointerdown", pointer); window.removeEventListener("resize", resize); engine.destroy(); renderer.destroy(); },
    };
  } catch (error) { engine?.destroy(); renderer.destroy(); throw error; }
}
