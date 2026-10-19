import {
  createEngine,
  WebGL2Renderer,
  InputManager,
  createDataSceneSpatialView,
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

const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const frame = () => new Promise(requestAnimationFrame);

// Browser input and public authoring only. Movement, firing, CCD and damage remain native.
export async function startInputProjectileProbe(canvas) {
  const renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true });
  const input = new InputManager(canvas, { gamepad: false, pointerGestures: false });
  let engine,
    displayed,
    latest,
    handles,
    view,
    resetFrames = 0,
    maxBillboards = 0;
  let currentDocument,
    armedCheckpoint = false,
    savedCheckpoint,
    activeProjectileTexture = 2;
  const prefabVertices = new Map();
  const applyOptions = () => ({
    instanceHandleRegistry: registry,
    ...(currentDocument?.gameplay.projectilePrefabs
      ? {
          textureId: (name) => {
            check(name === "spark", "unknown projectile texture");
            return activeProjectileTexture;
          },
        }
      : {}),
  });
  const registry = createSceneInstanceHandleRegistry();
  const captureOptions = () => ({
    includeDataSceneState: true,
    includeDataSceneProgress: true,
    dataSceneAuthoringDocument: currentDocument,
  });
  const errors = [],
    events = [],
    costs = [];
  try {
    const image = document.createElement("canvas");
    image.width = image.height = 16;
    const ctx = image.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(1, 1, 14, 15);
    await renderer.loadTexture(1, image.toDataURL());
    await renderer.loadTexture(2, image.toDataURL());
    await renderer.loadTexture(3, image.toDataURL());
    engine = await createEngine(
      (state) => {
        try {
          const begin = performance.now();
          renderer.render();
          const stats = renderer.renderCommands(state.renderCommandBuffer);
          renderer.renderPostProcess();
          const spatial = state.renderCommandBuffer.spatial;
          if (spatial)
            displayed = {
              camera: spatial.camera.slice(),
              presentation: spatial.presentation?.slice(),
            };
          latest = {
            time: state.timeSeconds,
            state: engine.dataSceneState(),
            billboards: stats.spatial?.billboardCount ?? 0,
            drawCalls: stats.drawCalls,
          };
          maxBillboards = Math.max(maxBillboards, latest.billboards);
          check(
            events.length + state.gameplayEvents.length <= 2048,
            "input event capacity exceeded",
          );
          events.push(...state.gameplayEvents.map((event) => ({ ...event })));
          if (resetFrames++ > 1) {
            check(
              spatial && stats.drawCalls > 0 && ["playing", "paused"].includes(latest.state),
              "input combat lost its active spatial scene",
            );
            costs.push({ rustMs: state.rustUpdateTimeMs, renderMs: performance.now() - begin });
            check(costs.length <= 10000, "input frame capacity exceeded");
          }
          if (currentDocument?.gameplay.projectilePrefabs && spatial) {
            const vertices = spatial.billboards,
              selected = [];
            for (let offset = 0; offset < vertices.length; offset += spatial.vertexStride)
              if (vertices[offset + 9] === activeProjectileTexture)
                selected.push(Array.from(vertices.subarray(offset, offset + spatial.vertexStride)));
            if (selected.length) {
              check(selected.length === 6, "projectile prefab must submit one quad");
              const [a, b, c] = selected;
              const width = Math.hypot(b[0] - a[0], b[2] - a[2]),
                height = Math.abs(c[1] - b[1]);
              check(
                Math.abs(width - 9) < 0.001 && Math.abs(height - 6) < 0.001,
                "projectile prefab world size mismatch",
              );
              check(
                a[3] === 0.5 && a[4] === 0 && b[3] === 0 && c[4] === 1,
                "projectile prefab atlas UV flip mismatch",
              );
              check(
                Math.abs(a[5] - 64 / 255) < 0.001 &&
                  Math.abs(a[6] - 192 / 255) < 0.001 &&
                  a[7] === 1 &&
                  a[8] === 1 &&
                  Math.abs(a[10] - 0.2) < 0.001,
                "projectile prefab color or cutoff mismatch",
              );
              prefabVertices.set(activeProjectileTexture, {
                texture: activeProjectileTexture,
                vertexCount: selected.length,
                width,
                height,
                uv: [a[3], a[4], b[3], c[4]],
                color: a.slice(5, 9),
                cutoff: a[10],
              });
            }
          }
          if (armedCheckpoint && engine.dataSceneCombatStats().projectiles > 0) {
            savedCheckpoint = captureGameStateSnapshot(engine, captureOptions());
            armedCheckpoint = false;
            engine.stop();
          }
        } catch (error) {
          errors.push(String(error));
          throw error;
        }
      },
      () => {
        const snapshot = input.snapshot(),
          size = renderer.viewportSize(),
          rect = canvas.getBoundingClientRect();
        // InputManager emits CSS coordinates. Convert to the logical viewport once, without DPR.
        return {
          ...snapshot,
          mouseX: (snapshot.mouseX * size.width) / rect.width,
          mouseY: (snapshot.mouseY * size.height) / rect.height,
        };
      },
      undefined,
      () => renderer.viewportSize(),
      { fixedTimestep: { stepSeconds: 1 / 120, maxStepsPerUpdate: 8 } },
    );
    view = createDataSceneSpatialView(engine, canvas);
    check(
      engine.supportsDataSceneInputProjectiles(),
      "packed Wasm does not execute input projectiles",
    );
    const components = (layer, floorId = 0, elevation = 24) => ({
      visual: {
        kind: "sprite",
        texture: 1,
        width: 12,
        height: 20,
        originY: 1,
        color: layer === "player" ? "#20d0ff" : "#ff4020",
      },
      collider: { type: "aabb", halfWidth: 8, halfHeight: 8, isTrigger: layer === "enemy" },
      layer,
      body: { type: "kinematic", heightSpan: { floorId, elevation, height: 12 } },
    });
    return {
      errors,
      async setup({
        projection = "orthographic",
        pixelArt = false,
        wall = false,
        zoom = 1,
        projectilePrefab = false,
      } = {}) {
        input.clear();
        renderer.setViewportZoom(zoom);
        renderer.resize();
        const size = renderer.viewportSize();
        engine.setViewportSize(size.width, size.height);
        const recipe = [
          {
            kind: "projectileAction",
            ...(projectilePrefab ? { projectilePrefab: "spark" } : {}),
            action: "fire",
            cooldownSeconds: 0.08,
            speed: 240,
            damage: 1,
            lifetimeSeconds: 1,
          },
        ];
        const document = {
          format: "ferrum2d.consumer.scene-authoring",
          version: 1,
          gameplay: {
            primaryActor: "actor",
            combat: true,
            ...(projectilePrefab
              ? {
                  projectilePrefabs: {
                    spark: {
                      sprite: {
                        texture: "spark",
                        width: 12,
                        height: 8,
                        frame: { u0: 0.5, v0: 0, u1: 0, v1: 1 },
                      },
                      collider: { halfWidth: 3, halfHeight: 2 },
                      billboard: { unitsPerPixel: 0.75, alphaCutoff: 0.2, elevation: 5 },
                      color: "#40c0ff",
                    },
                  },
                }
              : {}),
          },
          ids: { actions: { fire: 41 } },
          sceneComposition: {
            initialFragment: "combat",
            prefabs: {
              actor: { props: { components: components("player"), behaviorRecipes: ["actor"] } },
              target: { props: { components: components("enemy"), behaviorRecipes: ["target"] } },
              upper: { props: { components: components("enemy", 1, 80) } },
              wall: {
                props: {
                  components: {
                    ...components("wall"),
                    collider: { type: "aabb", halfWidth: 6, halfHeight: 12 },
                  },
                },
              },
            },
            fragments: {
              combat: {
                instances: [
                  { id: "actor", prefab: "actor", x: 0, y: 0 },
                  { id: "target", prefab: "target", x: 60, y: 36 },
                  { id: "upper", prefab: "upper", x: 30, y: 18 },
                  ...(wall ? [{ id: "wall", prefab: "wall", x: 30, y: 18 }] : []),
                ],
              },
            },
          },
          behaviorRecipes: {
            entities: {
              actor: {
                recipes: [
                  ...recipe,
                  { kind: "health", max: 5 },
                  { kind: "faction", faction: "player", damages: ["enemy"] },
                ],
              },
              target: {
                recipes: [
                  { kind: "health", max: 3 },
                  { kind: "faction", faction: "enemy", damages: ["player"] },
                ],
              },
            },
          },
          spatial: {
            camera: {
              projection,
              position: { x: 120.37, y: -240.29, elevation: 260 },
              target: { x: 30.37, y: 18.29, elevation: 24 },
              height: 240,
              fovDegrees: 42,
              near: 0.1,
              far: 2000,
            },
            terrain: [
              {
                id: "ground",
                x: -200,
                y: -200,
                width: 400,
                depth: 400,
                elevation: 0,
                color: [0.15, 0.25, 0.2, 1],
              },
            ],
            billboards: {
              actor: { elevation: 7 },
              target: {},
              upper: {},
              ...(wall ? { wall: {} } : {}),
            },
            ...(pixelArt
              ? { environment: { pixelArt: { width: 160, height: 90, snapCamera: true } } }
              : {}),
          },
        };
        resetFrames = maxBillboards = 0;
        displayed = undefined;
        events.length = costs.length = 0;
        armedCheckpoint = false;
        savedCheckpoint = undefined;
        currentDocument = document;
        activeProjectileTexture = 2;
        prefabVertices.clear();
        handles = applyDataSceneAuthoringDocument(engine, document, applyOptions()).entityHandles;
        check(
          engine.setInputActionBinding(41, 0, { control: "mouseLeft", activation: "pressed" }),
          "mouse action binding rejected",
        );
        check(
          engine.setInputActionBinding(41, 1, { control: "space", activation: "pressed" }),
          "keyboard action binding rejected",
        );
        engine.start();
        for (let i = 0; i < 4; i++) await frame();
        check(displayed, "no spatial input frame");
        return this.status();
      },
      aim() {
        const point = view.project(
          { x: 60, y: 36, elevation: 37 + (currentDocument.gameplay.projectilePrefabs ? 5 : 0) },
          displayed,
        );
        check(point?.visible, "input target not visible");
        return point;
      },
      bar() {
        const p = displayed.presentation,
          rect = canvas.getBoundingClientRect();
        if (!p || p[4] === 0) return undefined;
        if (p[1] > 0.001)
          return { x: rect.left + rect.width / 2, y: rect.top + (rect.height * p[1]) / 2 };
        if (p[0] > 0.001)
          return { x: rect.left + (rect.width * p[0]) / 2, y: rect.top + rect.height / 2 };
        return undefined;
      },
      async waitFrames(n) {
        for (let i = 0; i < n; i++) await frame();
        return this.status();
      },
      async waitSimulation(seconds) {
        const start = latest.time,
          until = performance.now() + 15000;
        while (latest.time - start < seconds) {
          check(performance.now() < until, "input simulation stalled");
          await frame();
        }
        return this.status();
      },
      pause() {
        return engine.pauseDataScene();
      },
      resume() {
        return engine.resumeDataScene();
      },
      armCheckpoint() {
        armedCheckpoint = true;
      },
      checkpointReady() {
        return savedCheckpoint !== undefined;
      },
      async restoreCheckpoint() {
        check(savedCheckpoint, "no in-flight checkpoint captured");
        const parsed = parseGameStateSnapshot(stringifyGameStateSnapshot(savedCheckpoint));
        const before = this.status(),
          oldTarget = handles.target;
        const malformed = JSON.parse(JSON.stringify(parsed));
        malformed.dataScene.progress.combat.actors.find((actor) => actor.id === "target").health =
          999;
        malformed.snapshotHash = hashGameStateSnapshot(malformed);
        let rejected = false;
        try {
          restoreGameStateSnapshot(engine, malformed, {
            dataSceneAuthoringApplyOptions: applyOptions(),
          });
        } catch (error) {
          rejected = /health/.test(String(error));
        }
        check(
          rejected &&
            engine.getPhysicsEntity(oldTarget) &&
            JSON.stringify(engine.dataSceneCombatStats()) === JSON.stringify(before.combat),
          "malformed checkpoint changed the running scene",
        );
        const customPrefab = currentDocument.gameplay.projectilePrefabs !== undefined;
        if (customPrefab) {
          check(
            parsed.dataScene.progress.combat.version === 2 &&
              parsed.dataScene.progress.combat.projectiles[0].prefab === "spark",
            "checkpoint lost its stable prefab identity",
          );
          check(prefabVertices.has(2), "source projectile prefab never rendered");
          activeProjectileTexture = 3;
        }
        const restored = restoreGameStateSnapshot(engine, parsed, {
          dataSceneAuthoringApplyOptions: applyOptions(),
        });
        handles = Object.fromEntries(
          registry.entries().map((entry) => [entry.instanceId, entry.handle]),
        );
        check(
          restored.dataSceneStateApplied &&
            (handles.target.entityId !== oldTarget.entityId ||
              handles.target.entityGeneration !== oldTarget.entityGeneration),
          "checkpoint retained stale handles",
        );
        const again = captureGameStateSnapshot(engine, captureOptions());
        check(
          JSON.stringify(parsed.dataScene.progress) === JSON.stringify(again.dataScene.progress),
          "in-flight state changed across checkpoint restore",
        );
        input.clear();
        events.length = 0;
        engine.start();
        const deadline = performance.now() + 15000;
        while (this.status().targetDamageEvents === 0) {
          check(performance.now() < deadline, "restored projectile did not hit");
          await frame();
        }
        const after = this.status(),
          checkpoint = captureGameStateSnapshot(engine, captureOptions()).dataScene.progress.combat;
        check(
          checkpoint.actors.find((actor) => actor.id === "target").health === 2 &&
            after.targetDamageEvents === 1,
          "restored projectile damage did not continue",
        );
        if (customPrefab)
          check(prefabVertices.has(3), "restored projectile did not use the new texture slot");
        check(after.combat.spawned === 0, "restore replayed a pressed input or spawn event");
        check(
          engine.configureDataSceneGameplay({ primaryActor: handles.actor, combat: true }),
          "runtime gameplay reconfiguration rejected",
        );
        let needsReapply = false;
        try {
          captureGameStateSnapshot(engine, captureOptions());
        } catch (error) {
          needsReapply = /fresh, complete authoring apply/.test(String(error));
        }
        check(needsReapply, "runtime gameplay reconfiguration retained stale save metadata");
        return {
          ...(customPrefab
            ? {
                prefab: {
                  version: parsed.dataScene.progress.combat.version,
                  name: parsed.dataScene.progress.combat.projectiles[0].prefab,
                  rendered: [...prefabVertices.values()],
                },
              }
            : {}),
          version: parsed.dataScene.version,
          projectiles: parsed.dataScene.progress.combat.projectiles.length,
          invalidPreserved: true,
          remappedHandles: true,
          continuedDamage: true,
          reconfigureInvalidated: true,
          after,
        };
      },
      status() {
        const target = handles?.target,
          upper = handles?.upper;
        return {
          ...latest,
          maxBillboards,
          combat: engine.dataSceneCombatStats(),
          targetExists: !!target && !!engine.getPhysicsEntity(target),
          upperExists: !!upper && !!engine.getPhysicsEntity(upper),
          targetDamageEvents: events.filter(
            (event) =>
              event.kind === "collisionDamage" &&
              event.actorId === target?.entityId &&
              event.actorGeneration === target.entityGeneration,
          ).length,
          errors: errors.slice(),
          frames: costs.length,
          maxRustMs: Math.max(0, ...costs.map((c) => c.rustMs)),
          maxRenderMs: Math.max(0, ...costs.map((c) => c.renderMs)),
          presentation: displayed?.presentation ? [...displayed.presentation] : undefined,
          resources: renderer.resourceStats(),
        };
      },
      destroy() {
        engine.destroy();
        input.destroy();
        renderer.destroy();
      },
    };
  } catch (error) {
    engine?.destroy();
    input.destroy();
    renderer.destroy();
    throw error;
  }
}
