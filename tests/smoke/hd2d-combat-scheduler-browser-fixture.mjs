import {
  createEngine,
  WebGL2Renderer,
  captureGameStateSnapshot,
  restoreGameStateSnapshot,
} from "@ferrum2d/ferrum-web/core";
import {
  applyDataSceneAuthoringDocument,
  createSceneInstanceHandleRegistry,
} from "@ferrum2d/ferrum-web/authoring";
const check = (ok, message, evidence) => {
  if (!ok) throw new Error(`${message}: ${JSON.stringify(evidence)}`);
};
const frame = () => new Promise(requestAnimationFrame);
export async function probeCombatScheduler(canvas) {
  const results = [];
  for (const maze of [true, false]) {
    const count = maze ? 1 : 64,
      goal = maze ? 240 : 96;
    const components = (layer, body = "kinematic", halfWidth = 2, halfHeight = 2) => ({
      visual: { kind: "sprite", texture: 1, width: 8, height: 16 },
      collider: { type: "aabb", halfWidth, halfHeight, isTrigger: layer === "enemy" },
      layer,
      body: { type: body, heightSpan: { floorId: 0, elevation: 0, height: 8 } },
    });
    const walls = maze
      ? [
          [-40, 64, 80, 4],
          [40, 128, 80, 4],
          [-40, 192, 80, 4],
        ]
      : [];
    const scene = {
      format: "ferrum2d.consumer.scene-authoring",
      version: 1,
      gameplay: {
        primaryActor: "actor",
        combat: true,
        combatNavigation: { maxAgents: count, arrivalRadius: 0 },
      },
      sceneComposition: {
        initialFragment: "arena",
        prefabs: {
          actor: { props: { components: components("player") } },
          enemy: { props: { components: components("enemy"), behaviorRecipes: ["chase"] } },
          ...Object.fromEntries(
            walls.map((w, i) => [
              `wall${i}`,
              { props: { components: components("wall", "static", w[2], w[3]) } },
            ]),
          ),
        },
        fragments: {
          arena: {
            instances: [
              { id: "actor", prefab: "actor", x: 0, y: goal },
              ...Array.from({ length: count }, (_, i) => ({
                id: `enemy${i}`,
                prefab: "enemy",
                x: 0,
                y: 16,
              })),
              ...walls.map((w, i) => ({ id: `wall${i}`, prefab: `wall${i}`, x: w[0], y: w[1] })),
            ],
          },
        },
      },
      behaviorRecipes: {
        entities: { chase: { recipes: [{ kind: "chase", speed: 512, stopDistance: 0 }] } },
      },
      spatial: {
        camera: {
          projection: "orthographic",
          position: { x: 100, y: -120, elevation: 320 },
          target: { x: 0, y: 128, elevation: 0 },
          height: 320,
          near: 0.1,
          far: 1500,
        },
        terrain: [
          {
            id: "ground",
            x: maze ? -128 : -32,
            y: 0,
            width: maze ? 256 : 96,
            depth: maze ? 256 : 112,
            elevation: 0,
          },
        ],
        billboards: Object.fromEntries(
          ["actor", ...Array.from({ length: count }, (_, i) => `enemy${i}`)].map((id) => [id, {}]),
        ),
      },
    };
    const renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true }),
      registry = createSceneInstanceHandleRegistry();
    const rows = [],
      errors = [];
    let engine,
      handles,
      checkpoint,
      arm = maze;
    const pose = (id) => engine.getPhysicsEntity(handles[id]);
    const until = async (pred) => {
      const deadline = performance.now() + 45000;
      while (!pred()) {
        check(!errors.length && performance.now() < deadline, "scheduler stalled", {
          maze,
          errors,
          last: rows.at(-1),
          poses: Array.from({ length: count }, (_, i) => pose(`enemy${i}`)),
        });
        await frame();
      }
    };
    try {
      const image = document.createElement("canvas");
      image.width = image.height = 8;
      image.getContext("2d").fillRect(0, 0, 8, 8);
      await renderer.loadTexture(1, image.toDataURL());
      engine = await createEngine(
        (state) => {
          try {
            renderer.render();
            const render = renderer.renderCommands(state.renderCommandBuffer);
            renderer.renderPostProcess();
            const n = engine.dataSceneCombatNavigationStats(),
              s = engine.dataSceneCombatNavigationSchedulerStats();
            check(
              n.frameSearches <= 1 &&
                n.frameWorkUnits <= 1_000_000 &&
                s.frameSearchWorkUnits <= 262144 &&
                s.peakSearchWorkUnits <= 8_000_000,
              "scheduler exceeded native budget",
              { n, s },
            );
            rows.push({
              n,
              s,
              rustMs: state.rustUpdateTimeMs,
              drawCalls: render.drawCalls,
              billboards: render.spatial?.billboardCount ?? 0,
            });
            check(
              rows.length <= 6000 && state.rustUpdateTimeMs < 250,
              "scheduler CI runtime budget",
              rows.at(-1),
            );
            if (arm && s.pendingSearches === 1) {
              checkpoint = captureGameStateSnapshot(engine, {
                includeDataSceneState: true,
                includeDataSceneProgress: true,
                dataSceneAuthoringDocument: scene,
              });
              arm = false;
              engine.stop();
            }
          } catch (error) {
            errors.push(String(error));
            engine.stop();
          }
        },
        undefined,
        undefined,
        () => renderer.viewportSize(),
        { fixedTimestep: { stepSeconds: 1 / 120, maxStepsPerUpdate: 8 } },
      );
      check(
        engine.supportsDataSceneCombatNavigationScheduler(),
        "packed Wasm lacks incremental scheduler",
      );
      renderer.resize();
      const size = renderer.viewportSize();
      engine.setViewportSize(size.width, size.height);
      handles = applyDataSceneAuthoringDocument(engine, scene, {
        instanceHandleRegistry: registry,
      }).entityHandles;
      engine.start();
      if (maze) {
        await until(() => checkpoint !== undefined);
        const old = handles.enemy0,
          before = pose("enemy0");
        check(
          before.x === 0 && before.y === 16,
          "query yield leaked hypothetical source pose",
          before,
        );
        restoreGameStateSnapshot(engine, checkpoint, {
          dataSceneAuthoringApplyOptions: { instanceHandleRegistry: registry },
        });
        handles = Object.fromEntries(registry.entries().map((e) => [e.instanceId, e.handle]));
        const clean = engine.dataSceneCombatNavigationSchedulerStats();
        check(
          clean.pendingSearches === 0 && clean.cachedRoutes === 0 && clean.searchSlices === 0,
          "restore retained scheduler cache",
          clean,
        );
        check(
          old.entityId !== handles.enemy0.entityId ||
            old.entityGeneration !== handles.enemy0.entityGeneration,
          "scheduler restore reused handle",
        );
        engine.start();
      }
      await until(() =>
        Array.from({ length: count }, (_, i) => pose(`enemy${i}`)).every(
          (p) => Math.hypot(p.x, p.y - goal) < 0.01 && p.heightSpan.floorId === 0,
        ),
      );
      engine.stop();
      const final = engine.dataSceneCombatNavigationSchedulerStats();
      check(
        maze ? final.yieldedSlices > 0 && final.searchSlices > 1 : final.cacheHits >= 60,
        "optimized path did not execute",
        final,
      );
      check(
        rows.some((r) => r.drawCalls > 0 && r.billboards === count + 1),
        "native AI did not render",
        rows.at(-1),
      );
      check(rows.at(-1).n.failed === 0, "scheduler search failed", rows.at(-1));
      results.push({
        maze,
        agents: count,
        restored: maze,
        final,
        frames: rows.length,
        maxSearchWork: Math.max(...rows.map((r) => r.s.frameSearchWorkUnits)),
        maxFrameWork: Math.max(...rows.map((r) => r.n.frameWorkUnits)),
        maxRustMs: Math.max(...rows.map((r) => r.rustMs)),
        errors,
      });
    } finally {
      engine?.destroy();
      renderer.destroy();
    }
  }
  return results;
}
