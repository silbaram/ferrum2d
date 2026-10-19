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

async function actionProbe(canvas, kind, projection) {
  const renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true });
  const input = new InputManager(canvas, { gamepad: false, pointerGestures: false });
  const registry = createSceneInstanceHandleRegistry(),
    applyOptions = { instanceHandleRegistry: registry };
  const errors = [],
    rows = [];
  let engine,
    handles,
    saved,
    armed = false,
    renderedHeight = false;
  const dash = kind === "dash";
  const components = (layer, floorId = 0, elevation = 0) => ({
    visual: { kind: "sprite", texture: 1, width: 8, height: 16, originY: 1 },
    collider: { type: "aabb", halfWidth: 2, halfHeight: 2, isTrigger: layer === "enemy" },
    layer,
    body: { type: "kinematic", heightSpan: { floorId, elevation, height: 8 } },
  });
  const scene = {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    gameplay: { primaryActor: "actor", combat: true, ...(dash ? { combatNavigation: {} } : {}) },
    ids: { actions: { act: 77 }, timers: { attack: 9 } },
    sceneComposition: {
      initialFragment: "arena",
      prefabs: {
        actor: { props: { components: components("player"), behaviorRecipes: ["actor"] } },
        enemy: { props: { components: components("enemy"), behaviorRecipes: ["enemy"] } },
        upper: { props: { components: components("enemy", 1, 32), behaviorRecipes: ["health"] } },
        blocked: { props: { components: components("enemy"), behaviorRecipes: ["health"] } },
        wall: {
          props: {
            components: {
              ...components("wall"),
              collider: { type: "aabb", halfWidth: 1, halfHeight: 8 },
            },
          },
        },
      },
      fragments: {
        arena: {
          instances: [
            { id: "actor", prefab: "actor", x: 0, y: 16 },
            { id: "enemy", prefab: "enemy", x: dash ? 0 : 8, y: 16 },
            ...(!dash
              ? [
                  { id: "upper", prefab: "upper", x: 8, y: 16 },
                  { id: "blocked", prefab: "blocked", x: -12, y: 16 },
                  { id: "wall", prefab: "wall", x: -6, y: 16 },
                ]
              : []),
          ],
        },
      },
    },
    behaviorRecipes: {
      entities: {
        actor: {
          recipes: [
            { kind: "health", max: 20 },
            dash
              ? { kind: "dashAction", action: "act", distance: 64, cooldownSeconds: 1 }
              : { kind: "meleeAction", action: "act", range: 24, damage: 2, cooldownSeconds: 1 },
          ],
        },
        enemy: {
          recipes: [
            { kind: "health", max: 5 },
            dash
              ? {
                  kind: "dashAction",
                  action: "act",
                  aim: "targetPlayer",
                  distance: 64,
                  cooldownSeconds: 1,
                }
              : {
                  kind: "meleeAction",
                  action: "act",
                  target: "player",
                  range: 24,
                  damage: 2,
                  cooldownSeconds: 1,
                },
            { kind: "timerTrigger", timer: "attack", action: "act", seconds: 0.25 },
          ],
        },
        health: { recipes: [{ kind: "health", max: 5 }] },
      },
    },
    spatial: {
      // Negligible normal walking prevents a no-op dash from passing by walking up the ramp.
      ...(dash
        ? { actor: { instanceId: "actor", speed: 0.001, maxStepHeight: 8, maxDropHeight: 40 } }
        : {}),
      camera: {
        projection,
        position: { x: 100, y: -120, elevation: 200 },
        target: { x: 0, y: 56, elevation: 16 },
        height: 160,
        near: 0.1,
        far: 1500,
      },
      terrain: [
        { id: "ground", x: -32, y: 0, width: 64, depth: 32, elevation: 0 },
        ...(dash
          ? [
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
            ]
          : []),
      ],
      ...(dash ? { connections: [{ from: "ramp", to: "bridge" }] } : {}),
      billboards: Object.fromEntries(
        (dash ? ["actor", "enemy"] : ["actor", "enemy", "upper", "blocked", "wall"]).map((id) => [
          id,
          {},
        ]),
      ),
    },
  };
  const captureOptions = {
    includeDataSceneState: true,
    includeDataSceneProgress: true,
    dataSceneAuthoringDocument: scene,
  };
  const capture = () => captureGameStateSnapshot(engine, captureOptions);
  const pose = (id) => {
    const p = engine.getPhysicsEntity(handles[id]);
    return { x: p.x, y: p.y, ...p.heightSpan };
  };
  const key = (code, down) =>
    window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code, bubbles: true }));
  const until = async (predicate) => {
    const deadline = performance.now() + 15000;
    while (!predicate()) {
      check(errors.length === 0 && performance.now() < deadline, "combat action stalled", {
        kind,
        projection,
        errors,
        poses: handles && [pose("actor"), pose("enemy")],
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
          const render = renderer.renderCommands(state.renderCommandBuffer);
          renderer.renderPostProcess();
          check(
            render.drawCalls > 0 && render.spatial?.billboardCount === (dash ? 2 : 5),
            "combat action lost spatial rendering",
            render,
          );
          rows.push({ rustMs: state.rustUpdateTimeMs, drawCalls: render.drawCalls });
          check(rows.length < 3000, "combat action frame capacity exceeded");
          if (dash && pose("actor").floorId === 1) {
            const spatial = state.renderCommandBuffer.spatial,
              feet = [];
            for (
              let offset = 0;
              offset < spatial.billboards.length;
              offset += spatial.vertexStride * 6
            ) {
              let low = Infinity;
              for (let v = 0; v < 6; v++)
                low = Math.min(low, spatial.billboards[offset + v * spatial.vertexStride + 1]);
              feet.push(low);
            }
            const heights = [pose("actor").elevation, pose("enemy").elevation].sort(
              (a, b) => a - b,
            );
            feet.sort((a, b) => a - b);
            check(
              feet.every((value, i) => Math.abs(value - heights[i]) < 0.001),
              "dash billboard height diverged",
              { feet, heights },
            );
            renderedHeight = true;
          }
          if (
            armed &&
            (dash ? pose("actor").floorId === 1 : engine.dataSceneCombatStats().hits > 0)
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
    check(engine.supportsDataSceneCombatActions(), "packed Wasm lacks melee/dash capability");
    renderer.resize();
    const size = renderer.viewportSize();
    engine.setViewportSize(size.width, size.height);
    handles = applyDataSceneAuthoringDocument(engine, scene, applyOptions).entityHandles;
    check(
      engine.setInputActionBinding(77, 0, { control: "space", activation: "pressed" }),
      "action binding rejected",
    );
    armed = true;
    key("Space", true);
    if (dash) key("KeyS", true);
    engine.start();
    await until(() => saved !== undefined);
    key("Space", false);
    key("KeyS", false);
    input.clear();
    const before = saved.dataScene.progress.combat,
      actor = before.actors.find((a) => a.id === "actor");
    check(
      actor.actionCooldowns[0].remainingSeconds > 0,
      "executed action did not commit cooldown",
      actor,
    );
    if (dash)
      check(
        Math.abs(actor.pose.x) < 0.001 &&
          Math.abs(actor.pose.y - 80) < 0.01 &&
          actor.pose.heightSpan.floorId === 1 &&
          actor.pose.heightSpan.elevation === 32 &&
          renderedHeight,
        "input dash did not move 64 units across the real gateway",
        actor,
      );
    else
      check(
        before.actors.find((a) => a.id === "enemy").health === 3 &&
          before.actors.find((a) => a.id === "upper").health === 5 &&
          before.actors.find((a) => a.id === "blocked").health === 5,
        "melee ignored height or wall",
        before,
      );
    const parsed = parseGameStateSnapshot(stringifyGameStateSnapshot(saved)),
      invalid = JSON.parse(JSON.stringify(parsed));
    invalid.dataScene.progress.combat.actors.find(
      (a) => a.id === "actor",
    ).actionCooldowns[0].remainingSeconds = 10;
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
      "invalid action checkpoint mutated the scene",
    );
    restoreGameStateSnapshot(engine, parsed, { dataSceneAuthoringApplyOptions: applyOptions });
    handles = Object.fromEntries(
      registry.entries().map((entry) => [entry.instanceId, entry.handle]),
    );
    check(
      old.entityId !== handles.actor.entityId ||
        old.entityGeneration !== handles.actor.entityGeneration,
      "action restore retained old handles",
    );
    check(
      JSON.stringify(capture().dataScene.progress) === JSON.stringify(parsed.dataScene.progress),
      "action checkpoint changed across fresh restore",
    );
    check(engine.pauseDataScene(), "action pause rejected");
    engine.start();
    key("Space", true);
    key("KeyS", true);
    for (let i = 0; i < 4; i++) await frame();
    key("Space", false);
    key("KeyS", false);
    for (let i = 0; i < 2; i++) await frame();
    check(
      JSON.stringify(capture().dataScene.progress) === JSON.stringify(parsed.dataScene.progress),
      "paused action changed pose/health/cooldown",
    );
    check(engine.resumeDataScene(), "action resume rejected");
    await until(() =>
      dash ? pose("enemy").floorId === 1 : engine.dataSceneCombatStats().hits > 0,
    );
    engine.stop();
    const after = capture().dataScene.progress.combat;
    if (dash) check(pose("enemy").elevation === 32, "timer dash did not reach upper floor", after);
    else
      check(
        after.actors.find((a) => a.id === "actor").health === 18 &&
          after.actors.find((a) => a.id === "enemy").health === 3,
        "timer melee or paused input dispatch was wrong",
        after,
      );
    check(
      rows.every((row) => row.rustMs < 250),
      "combat action exceeded CI CPU budget",
      rows,
    );
    check(engine.dataSceneCombatStats().capped === 0, "action capacity unexpectedly exceeded");
    return {
      kind,
      projection,
      before,
      after,
      restored: true,
      invalidPreserved: true,
      paused: true,
      renderedHeight,
      timerExecuted: true,
      frames: rows.length,
      maxRustMs: Math.max(...rows.map((row) => row.rustMs)),
      errors,
    };
  } finally {
    key("Space", false);
    key("KeyS", false);
    engine?.destroy();
    input.destroy();
    renderer.destroy();
  }
}

export async function probeCombatActions(canvas) {
  const results = [];
  for (const projection of ["orthographic", "perspective"])
    for (const kind of ["melee", "dash"]) results.push(await actionProbe(canvas, kind, projection));
  return results;
}
