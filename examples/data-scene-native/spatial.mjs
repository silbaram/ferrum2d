// Opt-in public consumer recipe: native height surfaces + depth-tested cutout sprites.
import {
  createEngine,
  WebGL2Renderer,
  createDataSceneSpatialView,
  BITMAP_FONT_ATLAS_FORMAT,
  BITMAP_FONT_ATLAS_VERSION,
  captureGameStateSnapshot,
  restoreGameStateSnapshot,
} from "@ferrum2d/ferrum-web/core";
import {
  applyDataSceneAuthoringDocument,
  createSceneInstanceHandleRegistry,
} from "@ferrum2d/ferrum-web/authoring";
export async function startSpatialScene(canvas) {
  const renderer = new WebGL2Renderer(canvas, {
    preserveDrawingBuffer: true,
    clearColor: [0.04, 0.07, 0.12, 1],
  });
  const keys = new Set();
  let frame,
    engine,
    handles,
    errors = [];
  const camera = {
    projection: "orthographic",
    position: { x: 160, y: -200, elevation: 600 },
    target: { x: 32, y: 40, elevation: 24 },
    height: Math.max(360, (380 * canvas.clientHeight) / canvas.clientWidth),
    near: 0.1,
    far: 2000,
  };
  const components = (texture, body) => ({
    visual: { kind: "sprite", texture, width: 20, height: 32, originY: 1 },
    collider: body
      ? { type: "aabb", halfWidth: 3, halfHeight: 3, isTrigger: false }
      : "none",
    layer: "player",
    ...(body ? { body: { type: "kinematic", heightSpan: body } } : {}),
  });
  const document = {
    gameplay: { primaryActor: "actor" },
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    sceneComposition: {
      initialFragment: "lab",
      prefabs: { object: {} },
      fragments: {
        lab: {
          instances: [
            {
              id: "actor",
              prefab: "object",
              x: -64,
              y: 0,
              props: {
                components: components(1, {
                  floorId: 0,
                  elevation: 0,
                  height: 8,
                }),
              },
            },
            {
              id: "under",
              prefab: "object",
              x: 80,
              y: 108,
              props: {
                components: components(2, {
                  floorId: 0,
                  elevation: 0,
                  height: 8,
                }),
              },
            },
            {
              id: "above",
              prefab: "object",
              x: 80,
              y: 108,
              props: {
                components: components(1, {
                  floorId: 1,
                  elevation: 64,
                  height: 8,
                }),
              },
            },
            {
              id: "tree",
              prefab: "object",
              x: -64,
              y: 36,
              props: {
                components: {
                  ...components(3),
                  visual: {
                    kind: "sprite",
                    texture: 3,
                    width: 48,
                    height: 64,
                    originY: 1,
                  },
                },
              },
            },
          ],
        },
      },
    },
    behaviorRecipes: { entities: {} },
    spatial: {
      camera,
      terrain: [
        {
          id: "low",
          x: -96,
          y: -64,
          width: 64,
          depth: 128,
          elevation: 0,
          color: [0.15, 0.45, 0.25, 1],
        },
        {
          id: "step",
          x: -32,
          y: -64,
          width: 64,
          depth: 128,
          elevation: 16,
          kind: "stair",
          color: [0.5, 0.35, 0.18, 1],
        },
        {
          id: "upper",
          x: 32,
          y: -64,
          width: 64,
          depth: 128,
          elevation: 32,
          kind: "stair",
          color: [0.7, 0.55, 0.28, 1],
        },
        {
          id: "under-ground",
          x: 32,
          y: 80,
          width: 128,
          depth: 48,
          elevation: 0,
          color: [0.15, 0.2, 0.6, 1],
        },
        {
          id: "bridge",
          x: 32,
          y: 80,
          width: 128,
          depth: 48,
          elevation: 64,
          baseElevation: 56,
          floorId: 1,
          kind: "bridge",
          color: [0.5, 0.5, 0.55, 1],
        },
      ],
      billboards: { actor: {}, under: {}, above: {}, tree: {} },
      actor: {
        instanceId: "actor",
        speed: 80,
        maxStepHeight: 16,
        maxDropHeight: 32,
      },
    },
  };
  const texture = (color, hole = false) => {
    const c = globalThis.document.createElement("canvas");
    c.width = c.height = 32;
    const ctx = c.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 32, 32);
    if (hole) ctx.clearRect(10, 10, 12, 12);
    return c.toDataURL();
  };
  try {
    for (const [id, color, hole] of [
      [1, "#ff2020", false],
      [2, "#2020ff", false],
      [3, "#20ff20", true],
      [4, "#ffffff", false],
    ])
      await renderer.loadTexture(id, texture(color, hole));
    engine = await createEngine(
      (state) => {
        try {
          renderer.render();
          const stats = renderer.renderCommands(state.renderCommandBuffer);
          renderer.renderPostProcess();
          frame = {
            state,
            spatial: state.renderCommandBuffer.spatial,
            stats,
            resources: renderer.resourceStats(),
          };
        } catch (e) {
          errors.push(String(e));
          throw e;
        }
      },
      () => ({
        w: keys.has("w"),
        a: keys.has("a"),
        s: keys.has("s"),
        d: keys.has("d"),
        space: false,
        enter: false,
        mouseLeft: false,
        mouseX: 0,
        mouseY: 0,
      }),
      undefined,
      () => renderer.viewportSize(),
    );
    const registry = createSceneInstanceHandleRegistry({entityExists:handle=>engine.gameplayEntityExists(handle)});
    handles = applyDataSceneAuthoringDocument(engine, document, {
      instanceHandleRegistry: registry,
    }).entityHandles;
    engine.registerBitmapFont(1, 4, {
      format: BITMAP_FONT_ATLAS_FORMAT,
      version: BITMAP_FONT_ATLAS_VERSION,
      lineHeight: 6,
      glyphs: {
        A: {
          uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
          size: { width: 6, height: 6 },
          advance: 6,
        },
      },
    });
    const attachLabel = () =>
      engine.setWorldText(1, {
        fontId: 1,
        text: "A",
        x: -3,
        y: -40,
        anchor: handles.actor,
      });
    attachLabel();
    const view = createDataSceneSpatialView(engine, canvas);
    const hud = globalThis.document.createElement("div");
    hud.textContent = "WASD · native terrain";
    hud.style.cssText =
      "position:fixed;left:8px;top:8px;color:white;font:12px monospace;pointer-events:none";
    globalThis.document.body.append(hud);
    const down = (e) => keys.add(e.key.toLowerCase()),
      up = (e) => keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    const resize = () => {
      renderer.resize();
      const size = renderer.viewportSize();
      engine.setViewportSize(size.width, size.height);
    };
    window.addEventListener("resize", resize);
    resize();
    engine.start();
    return {
      engine,
      renderer,
      view,
      document,
      get handles() {
        return handles;
      },
      keys,
      errors,
      get frame() {
        return frame;
      },
      setCamera(next) {
        return engine.setDataSceneSpatialCamera(next, renderer.viewportSize());
      },
      reconfigure(spec) {
        return engine.configureDataSceneSpatial(spec, handles);
      },
      save() {
        return captureGameStateSnapshot(engine, {
          includeDataSceneState: true,
          includeDataSceneProgress: true,
          dataSceneAuthoringDocument: document,
        });
      },
      restore(snapshot) {
        const result = restoreGameStateSnapshot(engine, snapshot, {
          dataSceneAuthoringApplyOptions: { instanceHandleRegistry: registry },
        });
        handles = Object.fromEntries(registry.entries({validateLive:true}).map(entry=>[entry.instanceId,entry.handle]));
        if (registry.get("actor", { validateLive: true })) attachLabel();
        keys.clear();
        return result;
      },
      destroy() {
        window.removeEventListener("keydown", down);
        window.removeEventListener("keyup", up);
        window.removeEventListener("resize", resize);
        hud.remove();
        engine.destroy();
        renderer.destroy();
      },
    };
  } catch (e) {
    engine?.destroy();
    renderer.destroy();
    throw e;
  }
}
