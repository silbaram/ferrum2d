import {
  applyDataSceneAuthoringDocument,
  createSceneInstanceHandleRegistry,
} from "@ferrum2d/ferrum-web/authoring";
import {
  createEngine,
  captureGameStateSnapshot,
  restoreGameStateSnapshot,
} from "@ferrum2d/ferrum-web/core";

export async function probeSpatialNavigation(scene) {
  const { engine, renderer, view } = scene;
  const check = (ok, message, evidence) => {
    if (!ok) throw Error(`${message}: ${JSON.stringify(evidence)}`);
  };
  const wait = () => new Promise(requestAnimationFrame);
  const components = (type = "kinematic", layer = "player") => ({
    visual: { kind: "sprite", texture: 1, width: 16, height: 24, originY: 1 },
    collider: { type: "aabb", halfWidth: 2, halfHeight: 2, isTrigger: false },
    body: { type, heightSpan: { floorId: 0, elevation: 0, height: 8 } },
    layer,
  });
  const document = {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    gameplay: { primaryActor: "actor" },
    sceneComposition: {
      initialFragment: "navigation",
      prefabs: { actor: { props: { components: components() } } },
      fragments: {
        navigation: {
          instances: [{ id: "actor", prefab: "actor", x: 0, y: 16 }],
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
        { id: "side", x: 32, y: 32, width: 32, depth: 80, elevation: 0 },
      ],
      connections: [{ from: "ramp", to: "bridge" }],
      billboards: { actor: {} },
      actor: {
        instanceId: "actor",
        speed: 192,
        maxStepHeight: 8,
        maxDropHeight: 40,
      },
    },
  };
  let handles = applyDataSceneAuthoringDocument(engine, document).entityHandles;
  engine.pauseDataScene();
  await wait();
  await wait();
  const pose = (e = engine, h = handles.actor) => {
    const p = e.getPhysicsEntity(h);
    return {
      x: p.x,
      y: p.y,
      floorId: p.heightSpan.floorId,
      elevation: p.heightSpan.elevation,
    };
  };
  const move = (x, y, floorId, extra = {}) =>
    engine.moveDataSceneSpatialActorTo({
      x,
      y,
      floorId,
      speed: 192,
      arrivalRadius: 0,
      ...extra,
    });
  const follow = async (e = engine, h = handles.actor, maxFrames = 600) => {
    const searches = e.dataSceneSpatialMoveStats().searchCount;
    let frames = 0;
    for (
      ;
      frames < maxFrames && e.dataSceneSpatialMoveStatus() === "moving";
      frames++
    )
      await wait();
    check(
      e.dataSceneSpatialMoveStatus() === "arrived",
      "navigation failed to arrive",
      {
        status: e.dataSceneSpatialMoveStatus(),
        pose: pose(e, h),
        stats: e.dataSceneSpatialMoveStats(),
        frames,
      },
    );
    const stats = e.dataSceneSpatialMoveStats();
    check(
      stats.searchCount === searches && stats.remainingWaypointCount === 0,
      "follower replanned or retained waypoints",
      stats,
    );
    check(
      stats.searchNodeCount <= 4098 &&
        stats.edgeProbeCount <= 32768 &&
        stats.probeWorkUnits <= 8_000_000,
      "navigation search budget exceeded",
      stats,
    );
    return { frames, pose: pose(e, h), stats };
  };
  const before = pose();
  const revision = scene.frame.spatial.terrainRevision;
  check(
    move(0, 80, 1),
    "bridge destination rejected",
    engine.dataSceneSpatialMoveStats(),
  );
  const plannedSearch = engine.dataSceneSpatialMoveStats();
  check(plannedSearch.lastRequest?.status === "accepted", "request diagnostics missing", plannedSearch);
  check(
    plannedSearch.searchNodeCount > 1 &&
      plannedSearch.searchNodeCount <= 4098 &&
      plannedSearch.edgeProbeCount > 0 &&
      plannedSearch.edgeProbeCount <= 32768 &&
      plannedSearch.probeWorkUnits > 0 &&
      plannedSearch.probeWorkUnits <= 8_000_000,
    "initial bridge search did not obey its budget",
    plannedSearch,
  );
  check(
    JSON.stringify(pose()) === JSON.stringify(before),
    "search mutated actor pose",
  );
  check(
    !move(0, 80, 99) && engine.dataSceneSpatialMoveStatus() === "moving",
    "failed replacement discarded active route",
  );
  const rejectedSearch = engine.dataSceneSpatialMoveStats();
  check(
    rejectedSearch.lastRequest?.status === "noPath" &&
      rejectedSearch.lastRequest.count === plannedSearch.lastRequest.count + 1 &&
      rejectedSearch.waypointCount === plannedSearch.waypointCount,
    "failed request diagnostic confused with active waypoints",
    rejectedSearch,
  );
  engine.resumeDataScene();
  const bridge = await follow();
  engine.pauseDataScene();
  await wait();
  check(
    bridge.pose.floorId === 1 &&
      bridge.pose.elevation === 32 &&
      bridge.pose.y === 80,
    "bridge floor/elevation mismatch",
    bridge,
  );
  const foot = view.project(
    { x: 0, y: 80, elevation: 32 },
    scene.frame.spatial,
  );
  const hit = view.pick(foot, scene.frame.spatial);
  check(
    hit?.surfaceId === "bridge" && hit.floorId === 1,
    "navigation render/picking mismatch",
    hit,
  );
  check(
    scene.frame.spatial.terrainRevision === revision &&
      scene.frame.stats.spatial.terrainUploadBytes === 0,
    "navigation rebuilt terrain",
  );
  check(
    move(0, 80, 0),
    "same XY lower-floor route rejected",
    engine.dataSceneSpatialMoveStats(),
  );
  check(
    engine.dataSceneSpatialMoveStats().waypointCount > 1,
    "lower floor became same-XY arrival",
  );
  engine.resumeDataScene();
  const under = await follow();
  check(
    under.pose.floorId === 0 &&
      under.pose.elevation === 0 &&
      under.pose.x === 0 &&
      under.pose.y === 80,
    "underpass route mismatch",
    under,
  );
  check(move(0, 16, 0), "input cancellation route rejected");
  const beforeInput = pose();
  scene.keys.add("d");
  try {
    await wait();
    await wait();
  } finally {
    scene.keys.clear();
    engine.pauseDataScene();
  }
  check(
    engine.dataSceneSpatialMoveStatus() === "cancelled" &&
      pose().x > beforeInput.x,
    "WASD did not take control",
    pose(),
  );

  // Save a paused in-progress route; fresh restore preserves pose and returns to idle.
  check(move(0, 80, 1), "save route rejected");
  const savedPose = pose();
  const saved = captureGameStateSnapshot(engine, {
    includeDataSceneState: true,
    includeDataSceneProgress: true,
    dataSceneAuthoringDocument: document,
  });
  let fresh, restored, freshResult;
  try {
    fresh = await createEngine(
      () => {},
      undefined,
      undefined,
      () => renderer.viewportSize(),
    );
    const registry = createSceneInstanceHandleRegistry();
    restored = restoreGameStateSnapshot(
      fresh,
      JSON.parse(JSON.stringify(saved)),
      { dataSceneAuthoringApplyOptions: { instanceHandleRegistry: registry } },
    );
    const h = registry.get("actor");
    check(
      restored.dataSceneStateApplied &&
        fresh.dataSceneState() === "paused" &&
        fresh.dataSceneSpatialMoveStatus() === "idle",
      "route restore lifecycle mismatch",
    );
    check(
      JSON.stringify(pose(fresh, h)) === JSON.stringify(savedPose),
      "route restore changed saved pose",
      pose(fresh, h),
    );
    check(
      fresh.moveDataSceneSpatialActorTo({
        x: 0,
        y: 80,
        floorId: 1,
        speed: 192,
        arrivalRadius: 0,
      }),
      "fresh restored route request rejected",
    );
    fresh.start();
    fresh.resumeDataScene();
    freshResult = await follow(fresh, h);
    check(
      freshResult.pose.floorId === 1,
      "fresh restored navigation lost connections",
      freshResult,
    );
  } finally {
    fresh?.destroy();
  }

  // A moved solid blocks an already planned direct route, then a new request finds a detour.
  const flat = JSON.parse(JSON.stringify(document));
  flat.spatial.terrain = [
    { id: "ground", x: -32, y: 0, width: 96, depth: 112, elevation: 0 },
  ];
  flat.spatial.connections = [];
  const wallComponents = components("static", "wall");
  wallComponents.collider.halfWidth = 12;
  wallComponents.collider.halfHeight = 8;
  flat.sceneComposition.prefabs.wall = {
    props: { components: wallComponents },
  };
  flat.sceneComposition.fragments.navigation.instances.push({
    id: "wall",
    prefab: "wall",
    x: 48,
    y: 56,
  });
  handles = applyDataSceneAuthoringDocument(engine, flat).entityHandles;
  engine.pauseDataScene();
  check(move(0, 96, 0), "clear direct route rejected");
  const searchCount = engine.dataSceneSpatialMoveStats().searchCount;
  check(
    engine.setPhysicsBodyPosition(handles.wall, 0, 56),
    "moving blocker failed",
  );
  engine.resumeDataScene();
  for (
    let i = 0;
    i < 180 && engine.dataSceneSpatialMoveStatus() === "moving";
    i++
  )
    await wait();
  const blocked = {
    status: engine.dataSceneSpatialMoveStatus(),
    pose: pose(),
    stats: engine.dataSceneSpatialMoveStats(),
  };
  check(
    blocked.status === "blocked" &&
      blocked.pose.y <= 46 &&
      blocked.stats.searchCount === searchCount,
    "dynamic obstacle was ignored or replanned",
    blocked,
  );
  check(
    move(0, 96, 0),
    "explicit detour request rejected",
    engine.dataSceneSpatialMoveStats(),
  );
  const detour = await follow();
  engine.pauseDataScene();

  // Seven-support cove regression: the previous installed engine exhausted 8M units at cellSize 32.
  const cove = JSON.parse(JSON.stringify(document));
  const actor = cove.sceneComposition.prefabs.actor.props.components;
  actor.collider.halfWidth = actor.collider.halfHeight = 9;
  actor.body.heightSpan.height = 24;
  cove.spatial.actor.maxStepHeight = 12;
  cove.spatial.actor.maxDropHeight = 16;
  cove.spatial.terrain = [
    { id: "sea", x: -6000, y: -6000, width: 12000, depth: 12000, elevation: -48, floorId: 9, walkable: false },
    { id: "coast", x: 100, y: 200, width: 1000, depth: 470, elevation: 0, baseElevation: -36 },
    { id: "beach", x: 100, y: 670, width: 1000, depth: 150, elevation: 0, baseElevation: -36 },
    { id: "ramp", x: 260, y: 470, width: 120, depth: 200, elevation: 96, endElevation: 0, floorId: 2, kind: "ramp" },
    { id: "bridge", x: 260, y: 350, width: 700, depth: 120, elevation: 96, baseElevation: 80, floorId: 1, kind: "bridge" },
    { id: "lookout", x: 960, y: 350, width: 140, depth: 120, elevation: 96, floorId: 3 },
    { id: "islet", x: 800, y: -100, width: 300, depth: 160, elevation: 40, baseElevation: -48, floorId: 8, walkable: false },
  ];
  cove.spatial.connections = [
    { from: "beach", to: "ramp" }, { from: "ramp", to: "bridge" }, { from: "bridge", to: "lookout" },
  ];
  const pillar = components("static", "wall");
  pillar.collider.halfWidth = 12;
  pillar.collider.halfHeight = 10;
  pillar.body.heightSpan.height = 80;
  cove.sceneComposition.prefabs.pillar = { props: { components: pillar } };
  const trigger = components("static", "enemy");
  trigger.collider = { type: "circle", radius: 1, isTrigger: true };
  cove.sceneComposition.prefabs.trigger = { props: { components: trigger } };
  cove.sceneComposition.prefabs.decoration = { props: { components: {
    visual: { kind: "sprite", texture: 1, width: 1, height: 1 }, collider: "none", layer: "wall",
  } } };
  const instances = cove.sceneComposition.fragments.navigation.instances = [
    { id: "actor", prefab: "actor", x: 648.5919189453125, y: 440.9655456542969 },
    { id: "pillar-west", prefab: "pillar", x: 495, y: 430 },
    { id: "pillar-east", prefab: "pillar", x: 820, y: 430 },
    { id: "exit", prefab: "trigger", x: 290, y: 755 },
    { id: "under", prefab: "trigger", x: 650, y: 440 },
    { id: "view", prefab: "trigger", x: 1030, y: 410 },
  ];
  for (let i = 0; i < 9; i++) instances.push({ id: `decoration-${i}`, prefab: "decoration", x: -5000, y: -5000 });
  handles = applyDataSceneAuthoringDocument(engine, cove).entityHandles;
  engine.pauseDataScene();
  const coveStart = pose();
  check(move(1030, 410, 3, { cellSize: 32, speed: 640 }), "cove 32 grid rejected", engine.dataSceneSpatialMoveStats());
  const coveBaseline = engine.dataSceneSpatialMoveStats();
  // Broadphase records two pillars and three triggers; narrow-phase excludes triggers.
  check(coveBaseline.lastRequest?.collisionProxyCount === 5, "cove collider count", coveBaseline);
  for (let i = 9; i < 1509; i++) instances.push({ id: `decoration-${i}`, prefab: "decoration", x: -5000, y: -5000 });
  handles = applyDataSceneAuthoringDocument(engine, cove).entityHandles;
  engine.pauseDataScene();
  check(move(1030, 410, 3, { cellSize: 32, speed: 640 }), "decorations exhausted cove search", engine.dataSceneSpatialMoveStats());
  const coveDecorated = engine.dataSceneSpatialMoveStats();
  check(
    coveDecorated.lastRequest?.status === "accepted" &&
      coveDecorated.lastRequest.collisionProxyCount === 5 &&
      coveDecorated.searchNodeCount === coveBaseline.searchNodeCount &&
      coveDecorated.edgeProbeCount === coveBaseline.edgeProbeCount &&
      coveDecorated.lastRequest.preparationWorkUnits - coveBaseline.lastRequest.preparationWorkUnits === 1500 &&
      coveDecorated.probeWorkUnits - coveBaseline.probeWorkUnits === 1500 &&
      coveDecorated.probeWorkUnits <= 8_000_000 &&
      JSON.stringify(pose()) === JSON.stringify(coveStart),
    "decoration scan was multiplied by probes or mutated pose",
    { coveBaseline, coveDecorated, pose: pose() },
  );
  engine.resumeDataScene();
  const coveArrival = await follow(engine, handles.actor, 1500);
  engine.pauseDataScene();
  check(coveArrival.pose.floorId === 3 && coveArrival.pose.elevation === 96 && coveArrival.pose.x === 1030 && coveArrival.pose.y === 410,
    "cove did not arrive on lookout", coveArrival);

  // Scaled model-cove crate: manual sweep stops at equal rounded AABB edges.
  const contactDocument = structuredClone(flat);
  const contactActor = contactDocument.sceneComposition.prefabs.actor.props.components;
  contactActor.collider.halfWidth = contactActor.collider.halfHeight = 9;
  const contactWall = contactDocument.sceneComposition.prefabs.wall.props.components;
  contactWall.collider.halfWidth = 24;
  contactWall.collider.halfHeight = 26.175;
  contactDocument.spatial.terrain = [
    { id: "beach", x: 100, y: 200, width: 1000, depth: 620, elevation: 0 },
  ];
  contactDocument.sceneComposition.fragments.navigation.instances = [
    { id: "actor", prefab: "actor", x: 582, y: 810 },
    { id: "wall", prefab: "wall", x: 560, y: 710 },
  ];
  handles = applyDataSceneAuthoringDocument(engine, contactDocument).entityHandles;
  engine.pauseDataScene();
  check(engine.moveDataSceneSpatialBody(handles.actor, 0, -200), "crate contact sweep rejected");
  const contactStart = pose();
  check(contactStart.y === Math.fround(710 + Math.fround(26.175) + 9), "crate contact pose mismatch", contactStart);
  check(engine.moveDataSceneSpatialBody(handles.actor, 0, -100), "crate inward sweep rejected");
  check(JSON.stringify(pose()) === JSON.stringify(contactStart), "contact moved through crate", pose());
  check(move(650, 780, 0, { cellSize: 64 }), "route from crate contact rejected", engine.dataSceneSpatialMoveStats());
  check(JSON.stringify(pose()) === JSON.stringify(contactStart), "contact planning nudged actor", pose());
  check(!move(560, 710, 0, { cellSize: 64 }) && engine.dataSceneSpatialMoveStatus() === "moving",
    "crate interior accepted or failed replacement lost route", engine.dataSceneSpatialMoveStats());
  engine.resumeDataScene();
  const contactArrival = await follow();
  check(contactArrival.pose.x === 650 && contactArrival.pose.y === 780 && contactArrival.pose.floorId === 0,
    "route from crate contact did not arrive", contactArrival);
  engine.pauseDataScene();
  return {
    plannedSearch,
    bridge,
    under,
    inputCancelled: true,
    savedVersion: saved.dataScene.version,
    freshResult,
    blocked,
    detour,
    rejectedSearch,
    coveBaseline,
    coveDecorated,
    coveArrival,
    contactStart,
    contactArrival,
  };
}
