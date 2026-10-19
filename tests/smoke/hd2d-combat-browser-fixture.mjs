import {
  createEngine,
  WebGL2Renderer,
  loadSpatialGlb,
  captureGameStateSnapshot,
  restoreGameStateSnapshot,
  stringifyGameStateSnapshot,
  parseGameStateSnapshot,
} from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const emptyInput = () => ({
  w: false,
  a: false,
  s: false,
  d: false,
  space: false,
  enter: false,
  mouseLeft: false,
  mouseX: 0,
  mouseY: 0,
});
const frame = () => new Promise(requestAnimationFrame);

// All simulation (including AI, repeat fire, damage, expiry and particles) runs in Rust.
// JS only authors the scene, submits rendering, and copies bounded numeric telemetry.
export async function startCombatProbe(canvas, enemyCount = 32) {
  check(
    Number.isInteger(enemyCount) && enemyCount >= 0 && enemyCount <= 128,
    "invalid enemy count",
  );
  const renderer = new WebGL2Renderer(canvas, { gpuTiming: true, preserveDrawingBuffer: true });
  let engine,
    document,
    stopped = false,
    latest,
    frames = 0,
    maxParticles = 0,
    maxBillboards = 0;
  const rows = [],
    gpuSamples = [],
    gpuIds = new Set(),
    errors = [];
  let collecting = false,
    resetting = false,
    lastFrameTime,
    actorHandle,
    actorHitEvents = 0;
  try {
    const image = globalThis.document.createElement("canvas");
    image.width = image.height = 16;
    const context = image.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(2, 0, 12, 16);
    await renderer.loadTexture(1, image.toDataURL());
    const rock = await loadSpatialGlb("/rock.glb", { materialProfile: "diffuse" });
    engine = await createEngine(
      (state) => {
        try {
          const begin = performance.now(),
            intervalMs = lastFrameTime === undefined ? 0 : begin - lastFrameTime;
          lastFrameTime = begin;
          renderer.beginGpuTiming();
          renderer.render();
          const stats = renderer.renderCommands(state.renderCommandBuffer);
          renderer.renderPostProcess();
          renderer.endGpuTiming();
          const renderMs = performance.now() - begin,
            gpu = renderer.gpuTimingStats();
          const spatial = stats.spatial;
          if (resetting) {
            check(
              !spatial && !state.renderCommandBuffer.spatial,
              "spatial combat packet leaked after reset",
            );
            return;
          }
          check(
            spatial && state.renderCommandBuffer.spatial,
            "combat lost native spatial rendering",
          );
          frames++;
          maxBillboards = Math.max(maxBillboards, spatial.billboardCount ?? 0);
          // Scalar diagnostic, constant calls per frame; never entity-by-entity Wasm queries.
          maxParticles = Math.max(maxParticles, engine.particleCount());
          latest = {
            rustMs: state.rustUpdateTimeMs,
            intervalMs,
            simulationDeltaMs: state.frameTimeMs,
            renderMs,
            simulationSeconds: state.timeSeconds,
            entities: state.entityCount,
            drawCalls: stats.drawCalls,
            models: spatial.modelCount,
            billboards: spatial.billboardCount,
            triangles: spatial.modelTriangleCount,
            physicsCollisionPairs: state.physics.collisionPairs,
            modelDrawCalls: spatial.modelDrawCalls,
            shadowDrawCalls: spatial.shadowDrawCalls,
            modelUploadBytes: spatial.modelUploadBytes,
            matrixUploadBytes: spatial.modelInstanceUploadBytes,
            rendererFrameId: gpu.currentFrameId,
          };
          if (collecting) {
            check(rows.length < 18000, "combat sample capacity exceeded");
            rows.push({ ...latest });
            for (const event of state.gameplayEvents) {
              if (
                event.kind === "collisionDamage" &&
                event.actorId === actorHandle?.entityId &&
                event.actorGeneration === actorHandle.entityGeneration
              )
                actorHitEvents++;
            }
            if (gpu.status === "ready" && !gpuIds.has(gpu.frameId)) {
              gpuIds.add(gpu.frameId);
              gpuSamples.push({ rendererFrameId: gpu.frameId, elapsedMs: gpu.elapsedMs });
            }
          }
        } catch (error) {
          errors.push(String(error));
          stopped = true;
          throw error;
        }
      },
      emptyInput,
      undefined,
      () => renderer.viewportSize(),
    );
    check(engine.registerDataSceneSpatialModel("combat-rock", rock), "model registration rejected");
    engine.setParticlePreset(3, {
      texture: 1,
      burstCount: 6,
      lifetime: [0.15, 0.3],
      speed: [8, 20],
      startSize: 3,
      endSize: 1,
      startColor: [1, 0.6, 0.15, 1],
      endColor: [1, 0.15, 0.05, 0],
    });
    engine.setParticleSeed(42);
    const components = (layer, color) => ({
      visual: { kind: "sprite", texture: 1, width: 12, height: 20, originY: 1, color },
      collider: { type: "aabb", halfWidth: 5, halfHeight: 5, isTrigger: layer !== "player" },
      layer,
      body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 12 } },
    });
    const instances = [{ id: "actor", prefab: "actor", x: 0, y: 0 }];
    const billboards = { actor: { castShadow: true } },
      models = {};
    for (let i = 0; i < enemyCount; i++) {
      const melee = i < 4,
        angle = i * 2.399963229728653,
        radius = melee ? 18 : 180 + (i % 8) * 6;
      const id = `enemy-${i}`;
      instances.push({
        id,
        prefab: melee ? "melee" : "ranged",
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
      billboards[id] = { castShadow: true };
    }
    for (let i = 0; i < 216; i++) {
      const id = `model-${i}`;
      instances.push({
        id,
        prefab: "marker",
        x: ((i % 18) - 8.5) * 38,
        y: (Math.floor(i / 18) - 5.5) * 38,
      });
      models[id] = {
        asset: "combat-rock",
        contentId: rock.contentId,
        scale: 0.3,
        castShadow: true,
      };
    }
    document = {
      format: "ferrum2d.consumer.scene-authoring",
      version: 1,
      gameplay: { primaryActor: "actor", combat: true },
      ids: { actions: { fire: 7 }, timers: { fire: 7 } },
      sceneComposition: {
        initialFragment: "combat",
        prefabs: {
          actor: {
            props: { components: components("player", "#30d0ff"), behaviorRecipes: ["actor"] },
          },
          ranged: {
            props: { components: components("enemy", "#ff4020"), behaviorRecipes: ["ranged"] },
          },
          melee: {
            props: { components: components("enemy", "#ffc020"), behaviorRecipes: ["melee"] },
          },
          marker: {
            props: {
              components: {
                visual: { kind: "sprite", texture: 0, width: 1, height: 1, color: "#ffffff00" },
                collider: "none",
                layer: "wall",
              },
            },
          },
        },
        fragments: { combat: { instances } },
      },
      behaviorRecipes: {
        entities: {
          actor: {
            recipes: [
              { kind: "health", max: 1000000 },
              { kind: "faction", faction: "player", damages: ["enemy"] },
              { kind: "damage", amount: 1, target: "other" },
              { kind: "collisionParticle", presetId: 3, target: "self", cooldownSeconds: 0.05 },
            ],
          },
          melee: {
            recipes: [
              { kind: "health", max: 1 },
              { kind: "faction", faction: "enemy", damages: ["player"] },
              { kind: "chase", target: "primaryActor", speed: 30, stopDistance: 0 },
            ],
          },
          ranged: {
            recipes: [
              { kind: "health", max: 1 },
              { kind: "faction", faction: "enemy", damages: ["player"] },
              { kind: "chase", target: "primaryActor", speed: 1, stopDistance: 0 },
              {
                kind: "projectileAction",
                action: "fire",
                aim: "targetPlayer",
                collisionTarget: "player",
                cooldownSeconds: 0.5,
                speed: 200,
                damage: 1,
                lifetimeSeconds: 3,
              },
              { kind: "timerTrigger", timer: "fire", action: "fire", seconds: 0.5 },
            ],
          },
        },
      },
      spatial: {
        camera: {
          projection: "orthographic",
          position: { x: 0, y: -650, elevation: 850 },
          target: { x: 0, y: 0, elevation: 0 },
          height: Math.max(620, (800 * canvas.clientHeight) / canvas.clientWidth),
          near: 0.1,
          far: 3000,
        },
        terrain: [
          {
            id: "ground",
            x: -500,
            y: -500,
            width: 1000,
            depth: 1000,
            elevation: 0,
            color: [0.18, 0.3, 0.22, 1],
          },
        ],
        billboards,
        models,
        actor: { instanceId: "actor", speed: 80, maxStepHeight: 16, maxDropHeight: 32 },
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
          fog: { color: [0.22, 0.3, 0.4], start: 900, end: 2500 },
        },
      },
    };
    const applied = applyDataSceneAuthoringDocument(engine, document, {
      spatialModelPreparer: renderer,
    });
    actorHandle = applied.entityHandles.actor;
    check(engine.dataSceneCombatEnabled(), "combat configuration not enabled");
    renderer.resize();
    const size = renderer.viewportSize();
    engine.setViewportSize(size.width, size.height);
    engine.start();
    await frame();
    await frame();
    return {
      engine,
      renderer,
      errors,
      document,
      handles: applied.entityHandles,
      get latest() {
        return latest;
      },
      async sample({ warmupMs = 2000, durationMs = 2500 } = {}) {
        check(
          warmupMs >= 0 && durationMs > 0 && durationMs <= 120000,
          "invalid measurement duration",
        );
        const wait = async (ms) => {
          const until = performance.now() + ms;
          while (performance.now() < until && !stopped) await frame();
          check(!stopped, errors.join("\n"));
        };
        const simulationStart = latest?.simulationSeconds ?? 0;
        await wait(warmupMs);
        const warmupDeadline = performance.now() + 30000;
        while (enemyCount > 0 && latest.simulationSeconds - simulationStart < 2.5) {
          check(
            performance.now() < warmupDeadline,
            "combat warmup did not advance native simulation",
          );
          await frame();
        }
        rows.length = gpuSamples.length = 0;
        gpuIds.clear();
        maxParticles = maxBillboards = actorHitEvents = 0;
        const resourceBaseline = renderer.resourceStats();
        const watched = applied.entityHandles["enemy-4"];
        const aiBefore = watched === undefined ? undefined : engine.getPhysicsEntity(watched);
        const before = engine.dataSceneCombatStats(),
          start = performance.now();
        collecting = true;
        await wait(durationMs);
        collecting = false;
        const elapsedMs = performance.now() - start,
          after = engine.dataSceneCombatStats();
        const aiAfter = watched === undefined ? undefined : engine.getPhysicsEntity(watched);
        // Delayed results are joined to issuing IDs and only measured frame IDs survive.
        const measuredIds = new Set(rows.map((row) => row.rendererFrameId));
        const samples = gpuSamples.filter((sample) => measuredIds.has(sample.rendererFrameId));
        return {
          enemyCount,
          modelCount: 216,
          frames: rows.length,
          elapsedMs,
          fps: (rows.length / elapsedMs) * 1000,
          before,
          after,
          aiBefore,
          aiAfter,
          actorHitEvents,
          maxParticles,
          maxBillboards,
          rows: rows.slice(),
          gpuSamples: samples,
          gpu: renderer.gpuTimingStats(),
          resourceBaseline,
          resources: renderer.resourceStats(),
          errors: errors.slice(),
        };
      },
      async pauseCheck() {
        check(engine.pauseDataScene(), "pause rejected");
        const before = engine.dataSceneCombatStats(),
          particles = engine.particleCount();
        for (let i = 0; i < 6; i++) await frame();
        check(
          JSON.stringify(engine.dataSceneCombatStats()) === JSON.stringify(before) &&
            engine.particleCount() === particles,
          "paused combat continued simulation",
        );
        check(engine.resumeDataScene(), "resume rejected");
        return true;
      },
      saveCheck() {
        const options = {
          includeDataSceneState: true,
          includeDataSceneProgress: true,
          dataSceneAuthoringDocument: document,
        };
        const snapshot = parseGameStateSnapshot(
          stringifyGameStateSnapshot(captureGameStateSnapshot(engine, options)),
        );
        check(
          snapshot.dataScene.version === 9 && snapshot.dataScene.progress.combat,
          "combat checkpoint format missing",
        );
        const restored = restoreGameStateSnapshot(engine, snapshot, {
          dataSceneAuthoringApplyOptions: { spatialModelPreparer: renderer },
        });
        check(
          restored.dataSceneStateApplied && engine.dataSceneCombatEnabled(),
          "combat checkpoint did not activate",
        );
        const after = captureGameStateSnapshot(engine, options);
        check(
          JSON.stringify(after.dataScene.progress) === JSON.stringify(snapshot.dataScene.progress),
          "combat checkpoint state changed across roundtrip",
        );
        check(
          engine.dataSceneCombatStats().spawned === 0 && engine.particleCount() === 0,
          "combat transient state was replayed",
        );
        return {
          version: snapshot.dataScene.version,
          actors: snapshot.dataScene.progress.combat.actors.length,
          projectiles: snapshot.dataScene.progress.combat.projectiles.length,
          contacts: snapshot.dataScene.progress.combat.contacts.length,
        };
      },
      async resetCheck() {
        resetting = true;
        engine.useDataScene();
        await frame();
        await frame();
        check(
          !engine.dataSceneCombatEnabled() && engine.entityCount() === 0,
          "combat leaked across scene reset",
        );
        check(engine.dataSceneCombatStats().projectiles === 0, "projectiles leaked across reset");
        return true;
      },
      destroy() {
        stopped = true;
        engine.destroy();
        renderer.destroy();
      },
    };
  } catch (error) {
    engine?.destroy();
    renderer.destroy();
    throw error;
  }
}
