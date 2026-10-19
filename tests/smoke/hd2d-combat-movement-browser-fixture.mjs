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

async function movementProbe(canvas, kind) {
  const seeking = kind === "seek",
    down = kind === "accelerate-down";
  const renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true });
  const registry = createSceneInstanceHandleRegistry(),
    ids = ["mover0", "mover1", "mover2", "mover3"];
  const errors = [],
    rows = [];
  let engine,
    handles,
    latest,
    checkpoint,
    savedPoses,
    visualHeightFrames = 0,
    armed = false;
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
        movementPatterns: "all",
        maxAgents: 4,
        arrivalRadius: 12,
        ...(seeking ? { crowdAvoidance: { padding: 0.25 } } : {}),
      },
    },
    sceneComposition: {
      initialFragment: "route",
      prefabs: {
        actor: { props: { components: components("player", down ? 0 : 1, down ? 0 : 32) } },
        mover: {
          props: {
            components: components("enemy", down ? 1 : 0, down ? 32 : 0),
            behaviorRecipes: ["move"],
          },
        },
      },
      fragments: {
        route: {
          instances: [
            { id: "actor", prefab: "actor", x: 0, y: down ? 16 : 80 },
            ...ids.map((id, i) => ({ id, prefab: "mover", x: i * 8 - 12, y: down ? 96 : 16 })),
          ],
        },
      },
    },
    behaviorRecipes: {
      entities: {
        move: {
          recipes: [
            seeking
              ? { kind: "seekTarget", speed: 96, turnRate: 0.2 }
              : {
                  kind: "accelerate",
                  accelerationX: 0,
                  accelerationY: down ? -2 : 2,
                  maxSpeed: 96,
                },
          ],
        },
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
      billboards: Object.fromEntries(["actor", ...ids].map((id) => [id, {}])),
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
    return { x: p.x, y: p.y, velocityX: p.velocityX, velocityY: p.velocityY, ...p.heightSpan };
  };
  const poses = () => ids.map(pose);
  const reached = (floor) =>
    poses().every(
      (p) =>
        p.floorId === floor &&
        p.elevation === (floor === 1 ? 32 : 0) &&
        (seeking
          ? Math.hypot(p.x, p.y - 80) <= 12.001 && p.velocityX === 0 && p.velocityY === 0
          : floor === 1
            ? p.y >= 80
            : p.y <= 16),
    );
  const until = async (predicate) => {
    const deadline = performance.now() + 30000;
    while (!predicate()) {
      check(errors.length === 0 && performance.now() < deadline, "combat movement stalled", {
        kind,
        errors,
        latest,
        frames: rows.length,
        poses: poses(),
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
          latest = {
            navigation,
            rustMs: state.rustUpdateTimeMs,
            drawCalls: stats.drawCalls,
            billboards: stats.spatial?.billboardCount ?? 0,
          };
          const spatial = state.renderCommandBuffer.spatial;
          if (latest.billboards === 5 && spatial) {
            const feet = [];
            for (
              let offset = 0;
              offset < spatial.billboards.length;
              offset += spatial.vertexStride * 6
            ) {
              let foot = Infinity;
              for (let v = 0; v < 6; v++)
                foot = Math.min(foot, spatial.billboards[offset + v * spatial.vertexStride + 1]);
              feet.push(foot);
            }
            const heights = ["actor", ...ids].map((id) => pose(id).elevation).sort((a, b) => a - b);
            feet.sort((a, b) => a - b);
            check(
              feet.length === 5 && feet.every((value, i) => Math.abs(value - heights[i]) < 0.001),
              "movement billboard height diverged from native body height",
              { feet, heights },
            );
            visualHeightFrames++;
          }
          if (seeking) {
            const peers = poses();
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
                    "seek crowd body overlap",
                    { i, j, a, b },
                  );
              }
          }
          check(
            navigation.frameSearches <= 1 && navigation.frameWorkUnits <= 1_000_000,
            "movement exceeded shared frame budget",
            navigation,
          );
          rows.push(latest);
          check(rows.length < 5000, "movement frame capacity exceeded");
          const p = pose("mover0");
          if (armed && p.y > 40 && p.y < 56 && p.elevation > 0 && p.elevation < 32) {
            savedPoses = poses();
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
    check(engine.supportsDataSceneCombatMovement(), "packed Wasm lacks native combat movement");
    renderer.resize();
    const size = renderer.viewportSize();
    engine.setViewportSize(size.width, size.height);
    handles = applyDataSceneAuthoringDocument(engine, scene, applyOptions).entityHandles;
    const before = poses();
    armed = true;
    engine.start();
    await until(() => checkpoint !== undefined);
    check(
      savedPoses.some((p) => p.velocityX !== 0 || p.velocityY !== 0),
      "checkpoint did not capture movement momentum",
      savedPoses,
    );
    const old = handles.mover0,
      saved = parseGameStateSnapshot(stringifyGameStateSnapshot(checkpoint));
    check(
      saved.dataScene.version === 9 &&
        saved.dataScene.authoringDocument.gameplay.combatNavigation.movementPatterns === "all",
      "checkpoint omitted movement mode",
    );
    restoreGameStateSnapshot(engine, saved, { dataSceneAuthoringApplyOptions: applyOptions });
    handles = Object.fromEntries(
      registry.entries().map((entry) => [entry.instanceId, entry.handle]),
    );
    check(
      old.entityId !== handles.mover0.entityId ||
        old.entityGeneration !== handles.mover0.entityGeneration,
      "movement restore reused old handle",
    );
    check(
      JSON.stringify(poses()) === JSON.stringify(savedPoses),
      "restore changed movement pose or velocity",
      { savedPoses, restored: poses() },
    );
    check(
      engine.dataSceneCombatNavigationStats().searches === 0 &&
        engine.dataSceneCombatNavigationSchedulerStats().cachedRoutes === 0,
      "restore retained route cache",
    );
    check(engine.pauseDataScene(), "movement pause rejected");
    engine.start();
    for (let i = 0; i < 5; i++) await frame();
    check(
      JSON.stringify(poses()) === JSON.stringify(savedPoses),
      "pause changed movement pose or velocity",
    );
    check(engine.resumeDataScene(), "movement resume rejected");
    await until(() => reached(down ? 0 : 1));
    const first = poses();
    if (seeking) {
      check(
        engine.setPhysicsBodyHeightSpan(handles.actor, { floorId: 0, elevation: 0, height: 8 }),
        "lower-floor seek target rejected",
      );
      await until(() => reached(0));
    }
    check(
      latest.billboards === 5 && latest.drawCalls > 0 && visualHeightFrames > 10,
      "movement lacked actual spatial rendering",
      { latest, visualHeightFrames },
    );
    check(engine.dataSceneSpatialMoveStatus() === "idle", "movement replaced primary actor route");
    check(
      rows.every((row) => row.rustMs < 250),
      "movement exceeded CI CPU budget",
    );
    const final = poses(),
      navigation = engine.dataSceneCombatNavigationStats();
    check(navigation.agents === 4, "native movement source count changed", navigation);
    check(engine.pauseDataScene(), "final movement pause rejected");
    return {
      kind,
      before,
      savedPoses,
      first,
      final,
      restored: true,
      velocityRestored: true,
      paused: true,
      visualHeightFrames,
      navigation,
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

export async function probeCombatMovement(canvas) {
  const results = [];
  for (const kind of ["seek", "accelerate-up", "accelerate-down"])
    results.push(await movementProbe(canvas, kind));
  return results;
}
