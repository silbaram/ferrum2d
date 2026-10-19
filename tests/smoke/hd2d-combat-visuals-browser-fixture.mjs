import {
  createEngine,
  WebGL2Renderer,
  createDataSceneSpatialView,
  decodeRenderCommands,
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
  if (!ok) throw Error(`${message}: ${JSON.stringify(evidence)}`);
};
const frame = () => new Promise(requestAnimationFrame);
const average = (a, b) => a.map((value, i) => (value + b[i]) / 2);

// Timers/fire, clocks, projectile movement and projected rotation all run in Rust.
async function probe(canvas, projection, pixelArt) {
  const flat = projection === "flat",
    renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true });
  const registry = createSceneInstanceHandleRegistry(),
    errors = [],
    rows = [],
    uvFrames = new Set();
  let engine,
    view,
    handles,
    latest,
    saved,
    armed = true,
    activeTexture = 2,
    checkedQuads = 0;
  const applyOptions = () => ({
    instanceHandleRegistry: registry,
    textureId: (name) => {
      check(name === "bolt", "unexpected visual asset", name);
      return activeTexture;
    },
  });
  const components = (layer) => ({
    visual: { kind: "sprite", texture: 1, width: 8, height: 12 },
    collider: { type: "aabb", halfWidth: 2, halfHeight: 2, isTrigger: layer === "enemy" },
    layer,
    body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 8 } },
  });
  const scene = {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    gameplay: {
      primaryActor: "actor",
      combat: true,
      projectilePrefabs: {
        bolt: {
          sprite: {
            texture: "bolt",
            width: 24,
            height: 8,
            animation: {
              fps: 6,
              frames: [
                { u0: 0, v0: 0, u1: 0.5, v1: 1 },
                { u0: 1, v0: 0, u1: 0.5, v1: 1 },
              ],
            },
          },
          rotateToVelocity: true,
          collider: { halfWidth: 2, halfHeight: 1 },
          billboard: { alphaCutoff: 0.2, elevation: 12 },
        },
      },
    },
    ids: { actions: { fire: 78 }, timers: { fire: 10 } },
    sceneComposition: {
      initialFragment: "arena",
      prefabs: {
        actor: { props: { components: components("player") } },
        shooter: { props: { components: components("enemy"), behaviorRecipes: ["shooter"] } },
      },
      fragments: {
        arena: {
          instances: [
            { id: "actor", prefab: "actor", x: 48, y: 48 },
            { id: "shooter", prefab: "shooter", x: -32, y: 0 },
          ],
        },
      },
    },
    behaviorRecipes: {
      entities: {
        shooter: {
          recipes: [
            {
              kind: "projectileAction",
              action: "fire",
              projectilePrefab: "bolt",
              aim: "targetPlayer",
              collisionTarget: "player",
              cooldownSeconds: 0.1,
              speed: 160,
              lifetimeSeconds: 3,
            },
            { kind: "timerTrigger", timer: "fire", action: "fire", seconds: 0.18, repeat: true },
          ],
        },
      },
    },
    ...(!flat
      ? {
          spatial: {
            camera: {
              projection,
              position: { x: 90.37, y: -140.29, elevation: 200 },
              target: { x: 0.37, y: 20.29, elevation: 10 },
              height: 240,
              fovDegrees: 48,
              near: 0.1,
              far: 1500,
            },
            terrain: [
              {
                id: "ground",
                x: -200,
                y: -160,
                width: 400,
                depth: 400,
                elevation: 0,
                color: [0.1, 0.15, 0.12, 1],
              },
            ],
            billboards: { actor: {}, shooter: {} },
            ...(pixelArt
              ? { environment: { pixelArt: { width: 160, height: 90, snapCamera: true } } }
              : {}),
          },
        }
      : {}),
  };
  const capture = () =>
    captureGameStateSnapshot(engine, {
      includeDataSceneState: true,
      includeDataSceneProgress: true,
      dataSceneAuthoringDocument: scene,
    });
  const until = async (predicate) => {
    const deadline = performance.now() + 15000;
    while (!predicate()) {
      check(errors.length === 0 && performance.now() < deadline, "visual probe stalled", {
        projection,
        pixelArt,
        errors,
      });
      await frame();
    }
  };
  const image = () => {
    const gl = canvas.getContext("webgl2"),
      data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const error = gl.getError();
    check(error === gl.NO_ERROR, "visual WebGL error", error);
    return data;
  };
  try {
    const texture = document.createElement("canvas");
    texture.width = 64;
    texture.height = 16;
    const ctx = texture.getContext("2d");
    // Transparent borders exercise cutout; solid centers make atlas changes observable in pixels.
    ctx.fillStyle = "#ff3020";
    ctx.fillRect(1, 2, 30, 12);
    ctx.fillStyle = "#20a0ff";
    ctx.fillRect(33, 2, 30, 12);
    await renderer.loadTexture(2, texture.toDataURL());
    await renderer.loadTexture(3, texture.toDataURL());
    ctx.clearRect(0, 0, 64, 16);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 64, 16);
    await renderer.loadTexture(1, texture.toDataURL());
    engine = await createEngine(
      (state) => {
        try {
          const start = performance.now();
          renderer.render();
          const stats = renderer.renderCommands(state.renderCommandBuffer);
          renderer.renderPostProcess();
          if (!handles) return;
          rows.push({
            rustMs: state.rustUpdateTimeMs,
            renderMs: performance.now() - start,
            draws: stats.drawCalls,
          });
          check(
            rows.length < 3000 && stats.drawCalls > 0,
            "visual render budget/state failed",
            stats,
          );
          // Snapshot capture may grow Wasm memory. Copy all borrowed buffers first.
          const spatial = state.renderCommandBuffer.spatial;
          const copy = spatial
            ? {
                ...spatial,
                camera: spatial.camera.slice(),
                presentation: spatial.presentation?.slice(),
                billboards: spatial.billboards.slice(),
              }
            : undefined;
          const commands = flat ? decodeRenderCommands(state.renderCommandBuffer) : [];
          const progress = capture().dataScene.progress.combat;
          check(
            progress.version === 4,
            "visual scene did not select combat codec4",
            progress.version,
          );
          const shots = [...progress.projectiles].sort((a, b) => a.x - b.x),
            quads = [];
          if (copy)
            for (let o = 0; o < copy.billboards.length; o += copy.vertexStride * 6) {
              const v = Array.from({ length: 6 }, (_, i) =>
                Array.from(
                  copy.billboards.subarray(
                    o + i * copy.vertexStride,
                    o + (i + 1) * copy.vertexStride,
                  ),
                ),
              );
              if (v[0][9] === activeTexture) quads.push(v);
            }
          quads.sort((a, b) => average(a[0], a[2])[0] - average(b[0], b[2])[0]);
          const flatShots = commands
            .filter((command) => command.textureId === activeTexture)
            .sort((a, b) => a.x - b.x);
          check(
            (flat ? flatShots : quads).length === shots.length,
            "live shot/render count mismatch",
            { shots: shots.length, quads: quads.length, flatShots: flatShots.length },
          );
          const sampledPixels = image(),
            samples = [];
          shots.forEach((shot, index) => {
            check(shot.animation && shot.prefab === "bolt", "shot lost animation/prefab", shot);
            uvFrames.add(shot.sprite.u0);
            let center, axis, expected;
            if (copy) {
              const quad = quads[index],
                mid = average(quad[0], quad[2]);
              const project = (p) => view.project({ x: p[0], elevation: p[1], y: -p[2] }, copy);
              center = project(mid);
              const left = project(average(quad[0], quad[5])),
                right = project(average(quad[1], quad[2]));
              axis = [right.x - left.x, right.y - left.y];
              const next = project([
                mid[0] + shot.velocityX * 0.0001,
                mid[1],
                mid[2] - shot.velocityY * 0.0001,
              ]);
              expected = [next.x - center.x, next.y - center.y];
              check(
                quad[0][3] === shot.sprite.u0 &&
                  quad[1][3] === shot.sprite.u1 &&
                  quad[0][4] === shot.sprite.v0 &&
                  quad[2][4] === shot.sprite.v1,
                "render UV differs from native clock",
                { quad, shot },
              );
            } else {
              const command = flatShots[index],
                angle = Math.atan2(shot.velocityY * state.cameraGroundYScale, shot.velocityX);
              check(
                Math.abs(Math.sin(command.rotationRadians - angle)) < 0.00001 &&
                  Math.cos(command.rotationRadians - angle) > 0.99999,
                "flat visual rotation differs from velocity",
                { command, shot },
              );
              check(
                command.uv.every(
                  (value, i) =>
                    value === [shot.sprite.u0, shot.sprite.v0, shot.sprite.u1, shot.sprite.v1][i],
                ),
                "flat atlas mismatch",
              );
              center = {
                x:
                  ((command.x + command.width / 2) * canvas.clientWidth) /
                  renderer.viewportSize().width,
                y:
                  ((command.y + command.height / 2) * canvas.clientHeight) /
                  renderer.viewportSize().height,
              };
            }
            if (axis) {
              const cosine =
                (axis[0] * expected[0] + axis[1] * expected[1]) /
                (Math.hypot(...axis) * Math.hypot(...expected));
              check(cosine > 0.9999, "projected billboard roll is not aligned to motion", {
                cosine,
                projection,
                pixelArt,
                axis,
                expected,
              });
            }
            const x = Math.round((center.x * canvas.width) / canvas.clientWidth),
              y = canvas.height - 1 - Math.round((center.y * canvas.height) / canvas.clientHeight);
            const color = Array.from(
              sampledPixels.subarray((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4),
            );
            // Shot frame0 is red, reversed frame1 is blue. Verify the displayed framebuffer too.
            const red = shot.sprite.u0 === 0;
            check(
              color.length === 4 && (red ? color[0] > color[2] + 80 : color[2] > color[0] + 80),
              "atlas frame not visible in framebuffer",
              { color, shot, center, projection, pixelArt },
            );
            samples.push({ uv: [shot.sprite.u0, shot.sprite.u1], color });
            checkedQuads++;
          });
          latest = { progress, pixels: sampledPixels, samples };
          if (armed && shots.length === 2 && new Set(shots.map((s) => s.sprite.u0)).size === 2) {
            engine.pauseDataScene();
            saved = capture();
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
    view = createDataSceneSpatialView(engine, canvas);
    check(engine.supportsDataSceneProjectileVisuals(), "packed Wasm lacks C5 capability");
    renderer.resize();
    const size = renderer.viewportSize();
    engine.setViewportSize(size.width, size.height);
    handles = applyDataSceneAuthoringDocument(engine, scene, applyOptions()).entityHandles;
    if (flat) check(engine.setDataSceneCamera({ x: 0, y: 20 }), "flat camera setup rejected");
    engine.start();
    await until(() => saved !== undefined);
    const parsed = parseGameStateSnapshot(stringifyGameStateSnapshot(saved)),
      before = latest,
      old = handles.actor;
    const clocks = parsed.dataScene.progress.combat.projectiles.map(
      (shot) => shot.animation.elapsedSeconds,
    );
    check(
      Math.abs(clocks[0] - clocks[1]) > 0.1 && uvFrames.size === 2,
      "shots shared a playback clock",
      clocks,
    );
    for (const mutation of [
      (shot) => {
        shot.animation.elapsedSeconds = 100;
      },
      (shot) => {
        shot.animation = null;
      },
      (shot) => {
        shot.sprite.u0 = 0.25;
      },
    ]) {
      const invalid = structuredClone(parsed);
      mutation(invalid.dataScene.progress.combat.projectiles[0]);
      invalid.snapshotHash = hashGameStateSnapshot(invalid);
      let refused = false;
      try {
        restoreGameStateSnapshot(engine, invalid, {
          dataSceneAuthoringApplyOptions: applyOptions(),
        });
      } catch {
        refused = true;
      }
      check(
        refused &&
          engine.getPhysicsEntity(old) &&
          JSON.stringify(capture().dataScene.progress) ===
            JSON.stringify(parsed.dataScene.progress),
        "invalid visual save replaced active scene",
      );
    }
    activeTexture = 3;
    restoreGameStateSnapshot(engine, parsed, { dataSceneAuthoringApplyOptions: applyOptions() });
    handles = Object.fromEntries(
      registry.entries().map((entry) => [entry.instanceId, entry.handle]),
    );
    check(
      old.entityId !== handles.actor.entityId ||
        old.entityGeneration !== handles.actor.entityGeneration,
      "visual restore retained stale handle",
    );
    check(
      JSON.stringify(capture().dataScene.progress) === JSON.stringify(parsed.dataScene.progress),
      "visual save changed after fresh restore",
    );
    const startFrames = rows.length;
    engine.start();
    await until(() => rows.length >= startFrames + 4);
    engine.stop();
    check(
      JSON.stringify(capture().dataScene.progress) === JSON.stringify(parsed.dataScene.progress),
      "pause advanced projectile clock/position",
    );
    let pixelDifference = 0;
    for (let i = 0; i < before.pixels.length; i++)
      if (before.pixels[i] !== latest.pixels[i]) pixelDifference++;
    check(pixelDifference === 0, "fresh visual restore changed framebuffer", pixelDifference);
    const samples = latest.samples;
    let cameraChanged = false;
    if (!flat) {
      const changed = {
        ...scene.spatial.camera,
        position: { x: -110.37, y: -100.29, elevation: 170 },
      };
      check(
        engine.setDataSceneSpatialCamera(changed, renderer.viewportSize()),
        "visual camera change rejected",
      );
      const count = rows.length;
      engine.start();
      await until(() => rows.length >= count + 3);
      engine.stop();
      check(
        latest.progress.projectiles.every(
          (shot, i) =>
            shot.animation.elapsedSeconds ===
            parsed.dataScene.progress.combat.projectiles[i].animation.elapsedSeconds,
        ),
        "camera change advanced clock",
      );
      cameraChanged = true;
    }
    check(engine.resumeDataScene(), "visual resume failed");
    engine.start();
    await until(() =>
      capture().dataScene.progress.combat.projectiles.some(
        (shot) =>
          shot.animation.elapsedSeconds > Math.max(...clocks) ||
          shot.animation.elapsedSeconds < Math.min(...clocks),
      ),
    );
    engine.stop();
    // Cold reconfiguration must clean up owned shots and their presentation state.
    applyDataSceneAuthoringDocument(engine, scene, applyOptions());
    check(
      engine.dataSceneCombatStats().projectiles === 0 &&
        capture().dataScene.progress.combat.projectiles.length === 0,
      "visual reapply leaked projectiles",
    );
    check(
      rows.every((row) => row.rustMs < 250 && row.renderMs < 1000) &&
        engine.dataSceneCombatStats().capped === 0,
      "visual work exceeded CI budget",
      rows,
    );
    return {
      projection,
      pixelArt,
      frames: rows.length,
      checkedQuads,
      clocks,
      uvFrames: [...uvFrames],
      samples,
      pixelDifference,
      cameraChanged,
      restored: true,
      remappedTexture: activeTexture,
      invalidPreserved: true,
      paused: true,
      resetClean: true,
      maxRustMs: Math.max(...rows.map((row) => row.rustMs)),
      errors,
    };
  } finally {
    engine?.destroy();
    renderer.destroy();
  }
}

export async function probeCombatVisuals(canvas) {
  const results = [];
  for (const projection of ["flat", "orthographic", "perspective"])
    for (const pixelArt of projection === "flat" ? [false] : [false, true]) {
      const fresh = canvas.cloneNode();
      canvas.replaceWith(fresh);
      canvas = fresh;
      results.push(await probe(canvas, projection, pixelArt));
    }
  return results;
}
