import {
  createEngine,
  WebGL2Renderer,
  InputManager,
  captureGameStateSnapshot,
  restoreGameStateSnapshot,
  parseGameStateSnapshot,
  stringifyGameStateSnapshot,
  hashGameStateSnapshot,
} from "@ferrum2d/ferrum-web/core";
import {
  applyDataSceneAuthoringDocument,
  createSceneInstanceHandleRegistry,
} from "@ferrum2d/ferrum-web/authoring";

const check = (ok, message, evidence) => {
  if (!ok) throw new Error(`${message}: ${JSON.stringify(evidence)}`);
};
const frame = () => new Promise(requestAnimationFrame);

async function probe(canvas, projection) {
  const renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true });
  const input = new InputManager(canvas, { gamepad: false, pointerGestures: false });
  const registry = createSceneInstanceHandleRegistry(),
    applyOptions = { instanceHandleRegistry: registry };
  const errors = [],
    rows = [],
    births = [];
  let engine,
    handles,
    saved,
    armed = false,
    heightFrames = 0,
    shadowFrames = 0,
    moved = false,
    firstX;
  const components = (layer, animated = false) => ({
    visual: {
      kind: "sprite",
      texture: 1,
      width: 8,
      height: 16,
      originY: 1,
      ...(animated
        ? {
            animationSet: {
              clips: [
                {
                  id: 3,
                  fps: 8,
                  frames: [
                    { u0: 0, v0: 0, u1: 0.5, v1: 1 },
                    { u0: 0.5, v0: 0, u1: 1, v1: 1 },
                  ],
                },
              ],
            },
          }
        : {}),
    },
    collider: { type: "aabb", halfWidth: 2, halfHeight: 2, isTrigger: layer === "enemy" },
    layer,
    body: { type: "kinematic", heightSpan: { floorId: 1, elevation: 32, height: 8 } },
  });
  const scene = {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    gameplay: {
      primaryActor: "actor",
      combat: true,
      spawnPrefabs: { minion: { prototypeInstanceId: "seed" } },
      combatNavigation: { maxAgents: 8 },
    },
    ids: {
      actions: { summon: 77, fire: 78 },
      timers: { summon: 9, fire: 10 },
      prefabs: { minion: 0xffffffff },
    },
    sceneComposition: {
      initialFragment: "arena",
      prefabs: {
        actor: { props: { components: components("player"), behaviorRecipes: ["actor"] } },
        seed: { props: { components: components("enemy", true), behaviorRecipes: ["seed"] } },
      },
      fragments: {
        arena: {
          instances: [
            { id: "actor", prefab: "actor", x: 0, y: 16 },
            { id: "seed", prefab: "seed", x: -64, y: 16 },
          ],
        },
      },
    },
    behaviorRecipes: {
      entities: {
        actor: {
          recipes: [
            { kind: "health", max: 20 },
            {
              kind: "spawnPrefabAction",
              action: "summon",
              prefab: "minion",
              cooldownSeconds: 0.4,
              offsetX: 32,
            },
            { kind: "timerTrigger", timer: "summon", action: "summon", seconds: 0.9 },
          ],
        },
        seed: {
          recipes: [
            { kind: "health", max: 4 },
            { kind: "chase", target: "player", speed: 16, stopDistance: 4 },
            {
              kind: "projectileAction",
              action: "fire",
              aim: "targetPlayer",
              collisionTarget: "player",
              cooldownSeconds: 0.4,
              speed: 40,
              lifetimeSeconds: 2,
            },
            { kind: "timerTrigger", timer: "fire", action: "fire", seconds: 0.15, repeat: true },
          ],
        },
      },
    },
    spatial: {
      camera: {
        projection,
        position: { x: 100, y: -120, elevation: 200 },
        target: { x: 0, y: 16, elevation: 32 },
        height: 160,
        near: 0.1,
        far: 1500,
      },
      terrain: [
        {
          id: "bridge",
          x: -128,
          y: -32,
          width: 256,
          depth: 128,
          elevation: 32,
          baseElevation: 24,
          floorId: 1,
          kind: "bridge",
        },
      ],
      billboards: { actor: {}, seed: {} },
      environment: {
        lighting: {
          ambient: [0.35, 0.35, 0.35],
          lights: [],
          directional: {
            direction: { x: -1, y: -1, elevation: 2 },
            intensity: 0.8,
            shadows: { resolution: 128, bias: 0.05 },
          },
        },
      },
    },
  };
  const capture = () =>
    captureGameStateSnapshot(engine, {
      includeDataSceneState: true,
      includeDataSceneProgress: true,
      dataSceneAuthoringDocument: scene,
    });
  const key = (down) =>
    window.dispatchEvent(
      new KeyboardEvent(down ? "keydown" : "keyup", { code: "Space", bubbles: true }),
    );
  const until = async (predicate) => {
    const deadline = performance.now() + 15000;
    while (!predicate()) {
      check(errors.length === 0 && performance.now() < deadline, "spawn probe stalled", {
        projection,
        errors,
      });
      await frame();
    }
  };
  try {
    const image = document.createElement("canvas");
    image.width = image.height = 16;
    const ctx = image.getContext("2d");
    ctx.fillStyle = "#ff9030";
    ctx.fillRect(0, 0, 8, 16);
    ctx.fillStyle = "#30c0ff";
    ctx.fillRect(8, 0, 8, 16);
    await renderer.loadTexture(1, image.toDataURL());
    engine = await createEngine(
      (state) => {
        try {
          renderer.render();
          const stats = renderer.renderCommands(state.renderCommandBuffer);
          renderer.renderPostProcess();
          rows.push({
            rustMs: state.rustUpdateTimeMs,
            drawCalls: stats.drawCalls,
            billboards: stats.spatial?.billboardCount ?? 0,
          });
          check(
            rows.length < 3000 && stats.drawCalls > 0 && state.renderCommandBuffer.spatial,
            "spawn lost spatial rendering",
            stats,
          );
          for (const event of state.gameplayEvents)
            if (event.kind === "prefabSpawned" && event.tokenId === 0xffffffff)
              births.push({ ...event });
          // Capture can grow Wasm memory; copy borrowed render views before invoking it.
          const spatial = state.renderCommandBuffer.spatial,
            vertices = spatial.billboards.slice(),
            shadows = spatial.environment?.shadowCasters.slice();
          const current = capture().dataScene.progress.combat;
          const live =
            current.version === 3 ? current.spawnedActors.filter((actor) => !actor.removed) : [];
          if (live.length) {
            const actor = live[0].state,
              span = actor.pose.heightSpan;
            check(
              span.floorId === 1 &&
                span.elevation === 32 &&
                span.height === 8 &&
                actor.health === 4 &&
                actor.animation.clip === 3,
              "spawn lost prototype state or source floor",
              actor,
            );
            if (firstX === undefined) firstX = actor.pose.x;
            else moved ||= actor.pose.x < firstX - 0.1;
            // Projectile quads use full UVs. The atlas actor has half-width UVs and feet at elevation32.
            for (let o = 0; o < vertices.length; o += spatial.vertexStride * 6) {
              const a = vertices[o + 3],
                b = vertices[o + spatial.vertexStride + 3];
              if (Math.abs(a - b) !== 0.5) continue;
              let foot = Infinity,
                top = -Infinity;
              for (let v = 0; v < 6; v++) {
                const y = vertices[o + v * spatial.vertexStride + 1];
                foot = Math.min(foot, y);
                top = Math.max(top, y);
              }
              if (Math.abs(top - foot - 16) > 0.001) continue;
              if (shadows)
                for (
                  let j = 0;
                  j + spatial.vertexStride < shadows.length;
                  j += spatial.vertexStride
                ) {
                  if (
                    Math.abs(shadows[j + 3] - shadows[j + spatial.vertexStride + 3]) === 0.5 &&
                    Math.abs(shadows[j + 1] - 32) < 0.001
                  ) {
                    shadowFrames++;
                    break;
                  }
                }
              check(Math.abs(foot - 32) < 0.001, "spawn billboard diverged from physics height", {
                foot,
                span,
              });
              heightFrames++;
            }
          }
          if (
            armed &&
            live.length === 1 &&
            current.projectiles.some((shot) => shot.source.spawnSerial === live[0].serial) &&
            moved &&
            heightFrames > 2
          ) {
            saved = capture();
            armed = false;
            engine.stop();
          }
        } catch (error) {
          errors.push(String(error));
          engine.stop();
        }
      },
      () => input.snapshot(),
      undefined,
      () => renderer.viewportSize(),
      { fixedTimestep: { stepSeconds: 1 / 120, maxStepsPerUpdate: 8 } },
    );
    check(engine.supportsDataSceneSpawnPrefabs(), "packed Wasm lacks actor spawn capability");
    renderer.resize();
    const size = renderer.viewportSize();
    engine.setViewportSize(size.width, size.height);
    handles = applyDataSceneAuthoringDocument(engine, scene, applyOptions).entityHandles;
    check(engine.despawnPhysicsEntity(handles.seed), "could not remove prototype seed");
    check(
      engine.setInputActionBinding(77, 0, { control: "space", activation: "pressed" }),
      "spawn input binding rejected",
    );
    armed = true;
    key(true);
    engine.start();
    await until(() => saved !== undefined);
    key(false);
    input.clear();
    const before = saved.dataScene.progress.combat;
    check(
      before.version === 3 &&
        before.spawnedActors.length === 1 &&
        before.lastSpawnSerial === 1 &&
        births.length === 1,
      "input spawn did not commit exactly once",
      { before, births },
    );
    const invalid = JSON.parse(stringifyGameStateSnapshot(saved));
    invalid.dataScene.progress.combat.spawnedActors[0].state.health = 100;
    invalid.snapshotHash = hashGameStateSnapshot(invalid);
    const old = handles.actor;
    let refused = false;
    try {
      restoreGameStateSnapshot(engine, invalid, { dataSceneAuthoringApplyOptions: applyOptions });
    } catch {
      refused = true;
    }
    check(
      refused &&
        engine.getPhysicsEntity(old) &&
        JSON.stringify(capture().dataScene.progress) === JSON.stringify(saved.dataScene.progress),
      "invalid spawn state replaced the scene",
    );
    // The JSON source serial must survive source removal and fresh World slot allocation.
    const birth = births[0];
    check(
      engine.despawnPhysicsEntity({
        entityId: birth.actorId,
        entityGeneration: birth.actorGeneration,
      }),
      "could not remove spawned projectile source",
    );
    const tombstone = capture();
    check(
      tombstone.dataScene.progress.combat.spawnedActors[0].removed &&
        tombstone.dataScene.progress.combat.projectiles[0].source.spawnSerial === 1,
      "removed spawn source lost its serial",
    );
    restoreGameStateSnapshot(
      engine,
      parseGameStateSnapshot(stringifyGameStateSnapshot(tombstone)),
      { dataSceneAuthoringApplyOptions: applyOptions },
    );
    check(
      JSON.stringify(capture().dataScene.progress) === JSON.stringify(tombstone.dataScene.progress),
      "removed spawn source changed across fresh JSON restore",
    );
    const parsed = parseGameStateSnapshot(stringifyGameStateSnapshot(saved));
    restoreGameStateSnapshot(engine, parsed, { dataSceneAuthoringApplyOptions: applyOptions });
    handles = Object.fromEntries(
      registry.entries().map((entry) => [entry.instanceId, entry.handle]),
    );
    check(
      old.entityId !== handles.actor.entityId ||
        old.entityGeneration !== handles.actor.entityGeneration,
      "spawn restore kept stale authored handles",
    );
    check(
      JSON.stringify(capture().dataScene.progress) === JSON.stringify(parsed.dataScene.progress),
      "spawn JSON changed across fresh restore",
    );
    check(engine.pauseDataScene(), "spawn pause rejected");
    engine.start();
    key(true);
    for (let i = 0; i < 4; i++) await frame();
    key(false);
    for (let i = 0; i < 2; i++) await frame();
    check(
      JSON.stringify(capture().dataScene.progress) === JSON.stringify(parsed.dataScene.progress),
      "paused spawn state changed",
    );
    check(engine.resumeDataScene(), "spawn resume rejected");
    await until(() => capture().dataScene.progress.combat.lastSpawnSerial === 2);
    engine.stop();
    const after = capture().dataScene.progress.combat;
    check(
      after.spawnedActors.filter((a) => !a.removed).length === 2 &&
        engine.dataSceneCombatStats().capped === 0,
      "timer spawn failed",
      after,
    );
    check(
      rows.every((row) => row.rustMs < 250) && moved && heightFrames > 2 && shadowFrames > 2,
      "spawn failed movement/render/cost checks",
      rows,
    );
    applyDataSceneAuthoringDocument(engine, scene, applyOptions);
    check(
      capture().dataScene.progress.combat.spawnedActors.length === 0 &&
        capture().dataScene.progress.combat.lastSpawnSerial === 0,
      "reapply leaked runtime actor ownership",
    );
    return {
      projection,
      restored: true,
      invalidPreserved: true,
      paused: true,
      timerExecuted: true,
      prototypeRemoved: true,
      deadSourceRestored: true,
      moved,
      heightFrames,
      shadowFrames,
      before,
      after,
      resetClean: true,
      frames: rows.length,
      maxRustMs: Math.max(...rows.map((r) => r.rustMs)),
      errors,
    };
  } finally {
    key(false);
    engine?.destroy();
    input.destroy();
    renderer.destroy();
  }
}

export async function probeCombatSpawn(canvas) {
  const results = [];
  for (const projection of ["orthographic", "perspective"])
    results.push(await probe(canvas, projection));
  return results;
}
