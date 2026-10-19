import {
  createEngine,
  WebGL2Renderer,
  captureGameStateSnapshot,
  restoreGameStateSnapshot,
  parseGameStateSnapshot,
  stringifyGameStateSnapshot,
} from "@ferrum2d/ferrum-web/core";
import {
  applyDataSceneAuthoringDocument,
  createSceneInstanceHandleRegistry,
} from "@ferrum2d/ferrum-web/authoring";

const check = (ok, message, evidence) => {
  if (!ok) throw new Error(`${message}: ${JSON.stringify(evidence)}`);
};
const frame = () => new Promise(requestAnimationFrame);

export async function probeCombatNavigation(canvas, crowd = false) {
  const renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true });
  const registry = createSceneInstanceHandleRegistry();
  const errors = [],
    rows = [],
    motion = [];
  let engine,
    handles,
    latest,
    armed = false,
    checkpoint,
    visualHeightFrames = 0;
  const components = (layer, floorId = 0, elevation = 0) => ({
    visual: {
      kind: "sprite",
      texture: 1,
      width: 8,
      height: 16,
      originY: 1,
      color: layer === "player" ? "#30ccff" : "#ff8040",
    },
    collider: { type: "aabb", halfWidth: 2, halfHeight: 2, isTrigger: layer === "enemy" },
    layer,
    body: { type: "kinematic", heightSpan: { floorId, elevation, height: 8 } },
  });
  const scene = {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    gameplay: {
      primaryActor: "actor",
      combat: true,
      combatNavigation: {
        maxAgents: 8,
        arrivalRadius: 0,
        ...(crowd ? { crowdAvoidance: { padding: 0.25 } } : {}),
      },
    },
    sceneComposition: {
      initialFragment: "route",
      prefabs: {
        actor: { props: { components: components("player", 1, 32) } },
        enemy: { props: { components: components("enemy"), behaviorRecipes: ["chase"] } },
        ...(crowd
          ? { far: { props: { components: components("enemy"), behaviorRecipes: ["far"] } } }
          : {}),
      },
      fragments: {
        route: {
          instances: [
            { id: "actor", prefab: "actor", x: 0, y: 80 },
            ...Array.from({ length: 8 }, (_, i) => ({
              id: `enemy${i}`,
              prefab: crowd && i >= 4 ? "far" : "enemy",
              x: crowd ? i * 5 - 17.5 : i * 2 - 8,
              y: 16,
            })),
          ],
        },
      },
    },
    behaviorRecipes: {
      entities: {
        chase: { recipes: [{ kind: "chase", speed: 192, stopDistance: crowd ? 8 : 0 }] },
        ...(crowd ? { far: { recipes: [{ kind: "chase", speed: 192, stopDistance: 16 }] } } : {}),
      },
    },
    spatial: {
      camera: {
        projection: "orthographic",
        position: { x: 100, y: -120, elevation: 200 },
        target: { x: 0, y: 56, elevation: 16 },
        height: 160,
        near: 0.1,
        far: 1500,
      },
      terrain: [
        { id: "ground", x: -32, y: 0, width: 64, depth: 32, elevation: 0 },
        {
          id: "ramp",
          x: -32,
          y: 32,
          width: 64,
          depth: 32,
          elevation: 0,
          endElevation: 32,
          kind: "ramp",
        },
        {
          id: "bridge",
          x: -32,
          y: 64,
          width: 64,
          depth: 48,
          elevation: 32,
          baseElevation: 24,
          floorId: 1,
          kind: "bridge",
        },
        { id: "below", x: -32, y: 64, width: 64, depth: 48, elevation: 0 },
        { id: "side", x: 32, y: 32, width: 32, depth: 80, elevation: 0 },
      ],
      connections: [{ from: "ramp", to: "bridge" }],
      billboards: Object.fromEntries(
        ["actor", ...Array.from({ length: 8 }, (_, i) => `enemy${i}`)].map((id) => [id, {}]),
      ),
    },
  };
  const applyOptions = { instanceHandleRegistry: registry };
  const captureOptions = {
    includeDataSceneState: true,
    includeDataSceneProgress: true,
    dataSceneAuthoringDocument: scene,
  };
  const pose = (id) => {
    const p = engine.getPhysicsEntity(handles[id]);
    return { x: p.x, y: p.y, ...p.heightSpan };
  };
  const reached = (floor) =>
    (!crowd || engine.dataSceneCombatCrowdStats().stoppedAgents === 8) &&
    Array.from({ length: 8 }, (_, i) => ({
      pose: pose(`enemy${i}`),
      stop: crowd ? (i < 4 ? 8 : 16) : 0,
    })).every(
      ({ pose: p, stop }) =>
        p.floorId === floor &&
        p.elevation === (floor === 1 ? 32 : 0) &&
        (crowd ? Math.hypot(p.x, p.y - 80) <= stop + 0.01 : Math.hypot(p.x, p.y - 80) < 0.01),
    );
  const until = async (predicate) => {
    const deadline = performance.now() + 30000;
    while (!predicate()) {
      check(errors.length === 0 && performance.now() < deadline, "combat navigation stalled", {
        errors,
        latest,
        frames: rows.length,
        motion,
        poses: Array.from({ length: 8 }, (_, i) => pose(`enemy${i}`)),
        crowd: crowd ? engine.dataSceneCombatCrowdStats() : undefined,
      });
      await frame();
    }
  };
  try {
    const image = document.createElement("canvas");
    image.width = image.height = 16;
    image.getContext("2d").fillRect(1, 1, 14, 15);
    await renderer.loadTexture(1, image.toDataURL());
    engine = await createEngine(
      (state) => {
        try {
          renderer.render();
          const stats = renderer.renderCommands(state.renderCommandBuffer);
          renderer.renderPostProcess();
          const navigation = engine.dataSceneCombatNavigationStats();
          if (crowd) {
            const peers = Array.from({ length: 8 }, (_, i) => pose(`enemy${i}`));
            for (let i = 0; i < peers.length; i++)
              for (let j = i + 1; j < peers.length; j++) {
                const a = peers[i],
                  b = peers[j];
                if (
                  a.floorId === b.floorId &&
                  a.elevation <= b.elevation + b.height &&
                  b.elevation <= a.elevation + a.height
                )
                  check(
                    Math.abs(a.x - b.x) >= 4.249 || Math.abs(a.y - b.y) >= 4.249,
                    "crowd introduced body overlap",
                    { i, j, a, b },
                  );
              }
            const stats = engine.dataSceneCombatCrowdStats();
            check(
              stats.enabled && stats.frameNeighborTests <= 125000,
              "crowd neighbor budget exceeded",
              stats,
            );
          }
          latest = {
            navigation,
            rustMs: state.rustUpdateTimeMs,
            drawCalls: stats.drawCalls,
            billboards: stats.spatial?.billboardCount ?? 0,
          };
          const spatial = state.renderCommandBuffer.spatial;
          if (latest.billboards === 9 && spatial) {
            const feet = [];
            for (
              let offset = 0;
              offset < spatial.billboards.length;
              offset += spatial.vertexStride * 6
            ) {
              let foot = Infinity;
              for (let vertex = 0; vertex < 6; vertex++)
                foot = Math.min(
                  foot,
                  spatial.billboards[offset + vertex * spatial.vertexStride + 1],
                );
              feet.push(foot);
            }
            const heights = Object.keys(handles)
              .map((id) => pose(id).elevation)
              .sort((a, b) => a - b);
            feet.sort((a, b) => a - b);
            check(
              feet.length === 9 && feet.every((value, i) => Math.abs(value - heights[i]) < 0.001),
              "billboard foot height diverged from native body height",
              { feet, heights },
            );
            visualHeightFrames++;
          }
          check(
            navigation.frameSearches <= 1 && navigation.frameWorkUnits <= 1_000_000,
            "combat navigation work exceeded shared frame budget",
            navigation,
          );
          if (crowd && rows.length % 30 === 0) {
            motion.push({
              frame: rows.length,
              pose: pose("enemy0"),
              crowd: engine.dataSceneCombatCrowdStats(),
            });
            if (motion.length > 12) motion.shift();
          }
          rows.push(latest);
          check(rows.length < 4000, "probe frame capacity exceeded");
          if (armed && pose("enemy0").y > 36) {
            checkpoint = captureGameStateSnapshot(engine, captureOptions);
            armed = false;
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
    check(engine.supportsDataSceneCombatNavigation(), "packed Wasm lacks native combat navigation");
    renderer.resize();
    const size = renderer.viewportSize();
    engine.setViewportSize(size.width, size.height);
    handles = applyDataSceneAuthoringDocument(engine, scene, applyOptions).entityHandles;
    const before = pose("enemy0");
    armed = true;
    engine.start();
    await until(() => checkpoint !== undefined);
    const savedPose = pose("enemy0"),
      old = handles.enemy0;
    check(
      savedPose.y > before.y && savedPose.elevation > 0,
      "chaser did not climb actual ramp",
      savedPose,
    );
    const saved = parseGameStateSnapshot(stringifyGameStateSnapshot(checkpoint));
    check(
      saved.dataScene.version === 9 &&
        saved.dataScene.authoringDocument.gameplay.combatNavigation.maxAgents === 8,
      "checkpoint omitted combat navigation authoring",
    );
    restoreGameStateSnapshot(engine, saved, { dataSceneAuthoringApplyOptions: applyOptions });
    handles = Object.fromEntries(
      registry.entries().map((entry) => [entry.instanceId, entry.handle]),
    );
    check(
      old.entityId !== handles.enemy0.entityId ||
        old.entityGeneration !== handles.enemy0.entityGeneration,
      "restore reused old chaser generation",
    );
    check(
      JSON.stringify(pose("enemy0")) === JSON.stringify(savedPose),
      "restore changed chaser simulation pose",
    );
    check(
      engine.dataSceneCombatNavigationStats().searches === 0,
      "restore retained stale route caches",
    );
    engine.start();
    await until(() => reached(1));
    const upper = pose("enemy0");
    check(
      latest.billboards === 9 && latest.drawCalls > 0,
      "native chasers did not reach billboard rendering",
      latest,
    );
    check(
      engine.dataSceneSpatialMoveStatus() === "idle",
      "combat routes replaced player navigation",
    );
    check(engine.pauseDataScene(), "pause rejected");
    const paused = pose("enemy0");
    for (let i = 0; i < 5; i++) await frame();
    check(JSON.stringify(pose("enemy0")) === JSON.stringify(paused), "pause changed AI pose");
    check(
      engine.setPhysicsBodyHeightSpan(handles.actor, { floorId: 0, elevation: 0, height: 8 }),
      "lower-floor target rejected",
    );
    check(engine.resumeDataScene(), "resume rejected");
    await until(() => reached(0));
    const lower = pose("enemy0"),
      final = engine.dataSceneCombatNavigationStats();
    const crowdStats = crowd ? engine.dataSceneCombatCrowdStats() : undefined;
    check(
      (crowd || final.failed === 0) &&
        final.searches + engine.dataSceneCombatNavigationSchedulerStats().cacheHits >= 16 &&
        final.agents === 8,
      "combat paths failed or did not replan floor change",
      final,
    );
    check(
      rows.every((row) => row.rustMs < 250),
      "combat navigation CPU exceeded CI budget",
    );
    check(engine.pauseDataScene(), "final pause rejected");
    check(visualHeightFrames > 10, "insufficient rendered body-height checks", visualHeightFrames);
    return {
      before,
      savedPose,
      upper,
      lower,
      final,
      ...(crowd ? { crowd: crowdStats } : {}),
      restored: true,
      paused: true,
      visualHeightFrames,
      frames: rows.length,
      maxRustMs: Math.max(...rows.map((row) => row.rustMs)),
      maxWorkUnits: Math.max(...rows.map((row) => row.navigation.frameWorkUnits)),
      maxFrameSearches: Math.max(...rows.map((row) => row.navigation.frameSearches)),
      errors,
    };
  } finally {
    engine?.destroy();
    renderer.destroy();
  }
}
