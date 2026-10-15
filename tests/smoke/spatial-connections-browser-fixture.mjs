import {
  applyDataSceneAuthoringDocument,
  createSceneInstanceHandleRegistry,
} from "@ferrum2d/ferrum-web/authoring";
import {
  createEngine,
  captureGameStateSnapshot,
  restoreGameStateSnapshot,
} from "@ferrum2d/ferrum-web/core";

export async function probeSpatialConnections(scene, canvas) {
  const { engine, renderer, view } = scene;
  const check = (ok, message, evidence) => {
    if (!ok) throw Error(`${message}: ${JSON.stringify(evidence)}`);
  };
  const wait = async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  };
  const image = () => {
    const bytes = new Uint8Array(canvas.width * canvas.height * 4),
      gl = canvas.getContext("webgl2");
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bytes,
    );
    return bytes;
  };
  const components = (floorId, elevation, type = "kinematic") => ({
    visual: { kind: "sprite", texture: 1, width: 16, height: 24, originY: 1 },
    collider: { type: "aabb", halfWidth: 2, halfHeight: 2, isTrigger: false },
    layer: "player",
    body: { type, heightSpan: { floorId, elevation, height: 8 } },
  });
  const document = {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    gameplay: { primaryActor: "actor" },
    sceneComposition: {
      initialFragment: "connections",
      prefabs: { actor: { props: { components: components(0, 0) } } },
      fragments: {
        connections: {
          instances: [
            { id: "actor", prefab: "actor", x: 0, y: 16 },
            { id: "under", prefab: "actor", x: 48, y: 80 },
          ],
        },
      },
    },
    behaviorRecipes: { entities: {} },
    spatial: {
      camera: {
        projection: "orthographic",
        position: { x: 100, y: -120, elevation: 200 },
        target: { x: 0, y: 56, elevation: 16 },
        height: 200,
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
        { id: "side", x: 32, y: 64, width: 32, depth: 48, elevation: 0 },
      ],
      connections: [{ from: "ramp", to: "bridge" }],
      billboards: { actor: {}, under: {} },
      actor: {
        instanceId: "actor",
        speed: 96,
        maxStepHeight: 8,
        maxDropHeight: 8,
      },
    },
  };
  let handles = applyDataSceneAuthoringDocument(engine, document).entityHandles;
  engine.pauseDataScene();
  await wait();
  const actor = handles.actor,
    trace = [];
  const revision = scene.frame.spatial.terrainRevision;
  const record = () => {
    const p = engine.getPhysicsEntity(actor);
    trace.push({
      x: p.x,
      y: p.y,
      floorId: p.heightSpan.floorId,
      elevation: p.heightSpan.elevation,
    });
    check(
      engine.gameplayEntityExists(actor),
      "floor transition replaced entity identity",
    );
    check(
      scene.frame.stats.spatial.terrainUploadBytes === 0 &&
        scene.frame.spatial.terrainRevision === revision,
      "floor transition invalidated static mesh",
      scene.frame.stats.spatial,
    );
  };
  record();
  for (let i = 0; i < 8; i++) {
    check(
      engine.moveDataSceneSpatialBody(actor, 0, 8, {
        maxStepHeight: 8,
        maxDropHeight: 8,
      }),
      "connected move rejected",
    );
    await wait();
    record();
  }
  check(
    trace.at(-1).floorId === 1 &&
      trace.at(-1).elevation === 32 &&
      trace.at(-1).y === 80,
    "ramp-to-bridge transition",
    trace,
  );
  const foot = view.project(
    { x: 0, y: 80, elevation: 32 },
    scene.frame.spatial,
  );
  check(foot.visible, "connected actor projection missing", foot);
  const hit = view.pick(foot, scene.frame.spatial);
  check(
    hit?.surfaceId === "bridge" &&
      hit.floorId === 1 &&
      Math.abs(hit.elevation - 32) < 0.01,
    "connected actor picking mismatch",
    hit,
  );
  check(
    engine.moveDataSceneSpatialBody(handles.under, -48, 0, {
      maxStepHeight: 8,
      maxDropHeight: 8,
    }),
    "underpass move rejected",
  );
  await wait();
  const under = engine.getPhysicsEntity(handles.under);
  check(
    under.x === 0 &&
      under.heightSpan.floorId === 0 &&
      under.heightSpan.elevation === 0,
    "overlapping bridge inferred floor transition",
    under,
  );
  for (let i = 0; i < 8; i++) {
    check(
      engine.moveDataSceneSpatialBody(actor, 0, -8, {
        maxStepHeight: 8,
        maxDropHeight: 8,
      }),
      "reverse connection rejected",
    );
    await wait();
  }
  check(
    engine.getPhysicsEntity(actor).y === 16 &&
      engine.getPhysicsEntity(actor).heightSpan.floorId === 0,
    "bidirectional return failed",
  );
  // Exercise the existing WASD actor path too, instead of only issuing setup-time direct movement calls.
  check(engine.resumeDataScene(), "resume connected actor");
  scene.keys.add("s");
  let inputFrames = 0;
  try {
    for (; inputFrames < 180; inputFrames++) {
      await new Promise(requestAnimationFrame);
      if (engine.getPhysicsEntity(actor).y >= 80) break;
    }
  } finally {
    scene.keys.clear();
    engine.pauseDataScene();
  }
  await wait();
  const driven = engine.getPhysicsEntity(actor);
  check(
    inputFrames < 180 &&
      driven.heightSpan.floorId === 1 &&
      Math.abs(driven.heightSpan.elevation - 32) < 0.01,
    "WASD did not traverse authored connection",
    driven,
  );
  const saved = captureGameStateSnapshot(engine, {
    includeDataSceneState: true,
    includeDataSceneProgress: true,
    dataSceneAuthoringDocument: document,
  });
  check(
    saved.dataScene.version === 6 &&
      saved.dataScene.authoringDocument.spatial.connections.length === 1,
    "connection missing from authored save",
  );
  const before = image();
  let fresh, freshFrame;
  const registry = createSceneInstanceHandleRegistry();
  let freshPose,
    restoredPixelDifferences = 0;
  try {
    fresh = await createEngine(
      (f) => {
        freshFrame = f;
      },
      undefined,
      undefined,
      () => renderer.viewportSize(),
    );
    const restored = restoreGameStateSnapshot(
      fresh,
      JSON.parse(JSON.stringify(saved)),
      { dataSceneAuthoringApplyOptions: { instanceHandleRegistry: registry } },
    );
    check(
      restored.dataSceneStateApplied && fresh.dataSceneState() === "paused",
      "connected progress restore state",
    );
    fresh.start();
    await wait();
    const h = registry.get("actor");
    freshPose = fresh.getPhysicsEntity(h);
    check(
      freshPose.heightSpan.floorId === 1 &&
        freshPose.heightSpan.elevation === 32 &&
        Math.abs(freshPose.y - driven.y) < 0.001,
      "fresh floor/height restore mismatch",
      freshPose,
    );
    renderer.render();
    renderer.renderCommands(freshFrame.renderCommandBuffer);
    renderer.renderPostProcess();
    const after = image();
    for (let i = 0; i < before.length; i++)
      if (Math.abs(before[i] - after[i]) > 3) restoredPixelDifferences++;
    check(
      restoredPixelDifferences === 0,
      "connected restore framebuffer changed",
      restoredPixelDifferences,
    );
    check(
      fresh.moveDataSceneSpatialBody(h, 0, 16 - driven.y, {
        maxStepHeight: 8,
        maxDropHeight: 8,
      }),
      "restored connection not usable",
    );
    check(
      fresh.getPhysicsEntity(h).heightSpan.floorId === 0,
      "restored gateway lost reverse traversal",
    );
  } finally {
    fresh?.destroy();
  }
  // Destination-floor wall overlaps the transition region; neither floor nor position may commit through it.
  const blocked = JSON.parse(JSON.stringify(document));
  blocked.sceneComposition.fragments.connections.instances.push({
    id: "wall",
    prefab: "actor",
    x: 0,
    y: 66,
    props: {
      components: {
        ...components(1, 32, "static"),
        collider: {
          type: "aabb",
          halfWidth: 12,
          halfHeight: 5,
          isTrigger: false,
        },
        layer: "wall",
      },
    },
  });
  handles = applyDataSceneAuthoringDocument(engine, blocked).entityHandles;
  engine.pauseDataScene();
  check(
    engine.moveDataSceneSpatialBody(handles.actor, 0, 64, {
      maxStepHeight: 8,
      maxDropHeight: 8,
    }),
    "blocked gateway request rejected",
  );
  await wait();
  const stopped = engine.getPhysicsEntity(handles.actor);
  check(
    stopped.y < 64 && stopped.heightSpan.floorId === 0,
    "destination wall bypassed during transition",
    stopped,
  );
  let invalidRejected = false;
  try {
    applyDataSceneAuthoringDocument(engine, {
      ...blocked,
      spatial: {
        ...blocked.spatial,
        connections: [{ from: "ramp", to: "missing" }],
      },
    });
  } catch (error) {
    invalidRejected = String(error).includes("connections");
  }
  check(
    invalidRejected && engine.getPhysicsEntity(handles.actor) !== undefined,
    "bad link destroyed live scene",
  );
  return {
    trace,
    hit,
    under: {
      x: under.x,
      y: under.y,
      floorId: under.heightSpan.floorId,
      elevation: under.heightSpan.elevation,
    },
    inputFrames,
    driven: {
      x: driven.x,
      y: driven.y,
      floorId: driven.heightSpan.floorId,
      elevation: driven.heightSpan.elevation,
    },
    saveVersion: saved.dataScene.version,
    freshPose: {
      x: freshPose.x,
      y: freshPose.y,
      floorId: freshPose.heightSpan.floorId,
      elevation: freshPose.heightSpan.elevation,
    },
    restoredPixelDifferences,
    stopped: {
      x: stopped.x,
      y: stopped.y,
      floorId: stopped.heightSpan.floorId,
      elevation: stopped.heightSpan.elevation,
    },
    invalidRejected,
  };
}
