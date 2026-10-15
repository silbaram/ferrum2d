import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  createEngine,
  createDataSceneSpatialView,
  captureGameStateSnapshot,
  restoreGameStateSnapshot,
  hashGameStateSnapshot,
  parseGameStateSnapshot,
  stringifyGameStateSnapshot,
  type FerrumEngine,
} from "../src/core.js";
import {
  applyDataSceneAuthoringDocument,
  applyBuiltInSceneAuthoringDocument,
  resolveSceneAuthoringDocument,
  resolveDataSceneSpatialSpec,
} from "../src/authoring.js";
import type { FrameState } from "../src/engineTypes.js";
import { createSpatialApi } from "../src/dataSceneSpatial.js";
import type { Engine } from "../pkg/ferrum_core.js";

test("spatial physics debug options validate flags and preserve old Wasm rejection", () => {
  const flags: number[] = [];
  const native = {
    configure_spatial_debug: (value: number) => {
      flags.push(value);
      return true;
    },
  };
  const api = createSpatialApi(
    native as unknown as Engine,
    () => {},
    () => ({ width: 1, height: 1 }),
  );
  ok(
    api.setDataSceneSpatialDebug({
      colliders: true,
      contacts: true,
      floorIds: true,
    }),
  );
  deepEqual(flags, [120]);
  ok(api.setDataSceneSpatialDebug({ colliders: true, depthTest: false }));
  equal(flags[1], 16);
  for (const key of ["colliders", "contacts", "floorIds"] as const)
    throws(
      () => api.setDataSceneSpatialDebug({ [key]: "yes" } as never),
      new RegExp(`spatial.debug.${key}`),
    );
  equal(flags.length, 2);
  const old = createSpatialApi(
    { configure_spatial_debug: (value: number) => value <= 15 } as Engine,
    () => {},
    () => ({ width: 1, height: 1 }),
  );
  equal(old.setDataSceneSpatialDebug({ colliders: true }), false);
  equal(old.setDataSceneSpatialDebug({ heightSpans: true }), true);
});

test("spatial destination API validates requests and forwards only cold numeric calls", () => {
  const requests: unknown[][] = [];
  let status = 1,
    alive = true;
  const native = {
    move_data_scene_spatial_actor_to: (...args: unknown[]) => {
      requests.push(args);
      return true;
    },
    cancel_data_scene_spatial_move: () => true,
    data_scene_spatial_move_status: () => status,
    data_scene_spatial_move_stats: () =>
      Uint32Array.from([25, 52, 11, 4, 3, 60000]),
  };
  const requireAlive = () => {
    if (!alive) throw Error("disposed");
  };
  const api = createSpatialApi(
    native as unknown as Engine,
    requireAlive,
    () => ({ width: 400, height: 300 }),
  );
  const request = { x: 12, y: 80, floorId: 1, speed: 96 };
  equal(api.moveDataSceneSpatialActorTo(request), true);
  deepEqual(requests, [[12, 80, 1, 96, 8, 0.5, true]]);
  equal(
    api.moveDataSceneSpatialActorTo({
      ...request,
      cellSize: 4,
      arrivalRadius: 0,
      cancelOnInput: false,
    }),
    true,
  );
  deepEqual(requests[1], [12, 80, 1, 96, 4, 0, false]);
  for (const patch of [
    { x: Infinity },
    { y: NaN },
    { floorId: -1 },
    { floorId: 0.5 },
    { floorId: 65536 },
    { speed: 0 },
    { speed: 1e-100 },
    { cellSize: 0 },
    { cellSize: 1e-100 },
    { arrivalRadius: -1 },
    { cellSize: null },
    { arrivalRadius: null },
    { cancelOnInput: null },
    { cancelOnInput: 1 },
    { extra: true },
  ])
    throws(
      () => api.moveDataSceneSpatialActorTo({ ...request, ...patch } as never),
      /spatial.move/,
    );
  equal(requests.length, 2);
  for (const [index, name] of [
    "idle",
    "moving",
    "arrived",
    "blocked",
    "cancelled",
  ].entries()) {
    status = index;
    equal(api.dataSceneSpatialMoveStatus(), name);
  }
  status = 0xffffffff;
  equal(api.dataSceneSpatialMoveStatus(), undefined);
  deepEqual(api.dataSceneSpatialMoveStats(), {
    searchNodeCount: 25,
    edgeProbeCount: 52,
    waypointCount: 11,
    remainingWaypointCount: 4,
    searchCount: 3,
    probeWorkUnits: 60000,
  });
  equal(api.cancelDataSceneSpatialMove(), true);
  alive = false;
  for (const call of [
    () => api.moveDataSceneSpatialActorTo(request),
    () => api.cancelDataSceneSpatialMove(),
    () => api.dataSceneSpatialMoveStatus(),
    () => api.dataSceneSpatialMoveStats(),
  ])
    throws(call, /disposed/);
  const old = createSpatialApi(
    {} as Engine,
    () => {},
    () => ({ width: 1, height: 1 }),
  );
  equal(old.moveDataSceneSpatialActorTo(request), false);
  equal(old.cancelDataSceneSpatialMove(), false);
  equal(old.dataSceneSpatialMoveStatus(), undefined);
  equal(old.dataSceneSpatialMoveStats(), undefined);
});
const camera = {
  projection: "orthographic" as const,
  position: { x: 48, y: -160, elevation: 160 },
  target: { x: 48, y: 32, elevation: 16 },
  height: 240,
  near: 0.1,
  far: 1000,
};
function document() {
  return {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    sceneComposition: {
      initialFragment: "lab",
      prefabs: {
        actor: {
          props: {
            components: {
              visual: {
                kind: "sprite",
                texture: 0,
                width: 12,
                height: 24,
                originY: 1,
              },
              collider: {
                type: "aabb",
                halfWidth: 2,
                halfHeight: 2,
                isTrigger: false,
              },
              layer: "player",
              body: {
                type: "kinematic",
                heightSpan: { floorId: 0, elevation: 0, height: 8 },
              },
            },
          },
        },
      },
      fragments: {
        lab: { instances: [{ id: "actor", prefab: "actor", x: 16, y: 16 }] },
      },
    },
    behaviorRecipes: { entities: {} },
    spatial: {
      camera,
      terrain: [
        { id: "low", x: 0, y: 0, width: 32, depth: 64, elevation: 0 },
        {
          id: "step",
          x: 32,
          y: 0,
          width: 32,
          depth: 64,
          elevation: 16,
          kind: "stair",
        },
        {
          id: "upper",
          x: 64,
          y: 0,
          width: 32,
          depth: 64,
          elevation: 32,
          kind: "stair",
        },
      ],
      billboards: { actor: {} },
      actor: {
        instanceId: "actor",
        speed: 64,
        maxStepHeight: 16,
        maxDropHeight: 32,
      },
    },
  };
}

test("spatial authoring rejects malformed surfaces/cameras/actors before scene activation", () => {
  const spec = document().spatial;
  for (const bad of [
    { ...spec, camera: { ...camera, near: 0 } },
    { ...spec, camera: { ...camera, target: camera.position } },
    { ...spec, terrain: [...spec.terrain, spec.terrain[0]] },
    { ...spec, terrain: [{ ...spec.terrain[0], width: 1e-100 }] },
    {
      ...spec,
      terrain: [{ ...spec.terrain[0], elevation: 32, endElevation: 64 }],
    },
    { ...spec, billboards: { actor: { alphaCutoff: 0 } } },
    { ...spec, typo: true },
  ])
    throws(() => resolveDataSceneSpatialSpec(bad), /spatial/);
  throws(
    () =>
      resolveSceneAuthoringDocument({
        ...document(),
        spatial: { ...spec, billboards: { missing: {} }, actor: undefined },
      }),
    /applied fragment/,
  );
  const noBody = document();
  noBody.sceneComposition.prefabs.actor.props.components.body.type = "static";
  throws(() => resolveSceneAuthoringDocument(noBody), /spatial.actor/);
  const sparse = new Array(4);
  throws(
    () =>
      resolveDataSceneSpatialSpec({
        ...spec,
        terrain: [{ ...spec.terrain[0], color: sparse }],
      }),
    /color/,
  );
});

test("spatial connections validate f32 shared edges, floor identity, duplicates and ambiguous gateways", () => {
  const base = document().spatial;
  const terrain = base.terrain.map((s, i) => ({
    ...s,
    floorId: i === 0 ? 0 : 1,
  }));
  const good = { ...base, terrain, connections: [{ from: "low", to: "step" }] };
  deepEqual(resolveDataSceneSpatialSpec(good).connections, good.connections);
  equal(
    Object.prototype.hasOwnProperty.call(
      resolveDataSceneSpatialSpec(base),
      "connections",
    ),
    false,
  );
  equal(
    Object.prototype.hasOwnProperty.call(
      resolveDataSceneSpatialSpec({ ...base, connections: [] }),
      "connections",
    ),
    false,
  );
  for (const connections of [
    [{ from: "missing", to: "step" }],
    [{ from: "low", to: "low" }],
    [{ from: "step", to: "upper" }],
    [{ from: "low", to: "upper" }],
    [...good.connections, { from: "step", to: "low" }],
    [{ from: "low", to: "step", typo: true }],
    new Array(1),
    new Array(257),
  ])
    throws(
      () => resolveDataSceneSpatialSpec({ ...good, connections }),
      /connections/,
    );
  for (const replacement of [
    { ...terrain[1], x: 32.1 }, // gap
    { ...terrain[1], x: 31 }, // overlap
    { ...terrain[1], y: 64 }, // corner only
    { ...terrain[1], walkable: false },
    { ...terrain[1], floorId: 0 },
  ])
    throws(
      () =>
        resolveDataSceneSpatialSpec({
          ...good,
          terrain: [terrain[0], replacement],
        }),
      /connections/,
    );
  throws(
    () =>
      resolveDataSceneSpatialSpec({
        ...good,
        terrain: [...terrain, { ...terrain[1], id: "other-floor", floorId: 2 }],
        connections: [...good.connections, { from: "low", to: "other-floor" }],
      }),
    /ambiguous/,
  );
  // Native addition is f32: these decimal coordinates share the same compiled boundary.
  const decimal = {
    ...base,
    actor: undefined,
    terrain: [
      { id: "a", x: 0.1, y: 0, width: 0.2, depth: 1, floorId: 0, elevation: 0 },
      { id: "b", x: 0.3, y: 0, width: 0.2, depth: 1, floorId: 1, elevation: 0 },
    ],
    connections: [{ from: "a", to: "b" }],
  };
  equal(resolveDataSceneSpatialSpec(decimal).connections!.length, 1);
});

test("spatial progress persists native camera/height/floor into a fresh engine and rejects invalid state before activation", async () => {
  const original = {
    fetch: globalThis.fetch,
    raf: globalThis.requestAnimationFrame,
    cancel: globalThis.cancelAnimationFrame,
  };
  const fs = await (new Function(
    "return import('node:fs/promises')",
  )() as Promise<{ readFile(url: URL): Promise<Uint8Array> }>);
  globalThis.fetch = (async (input, options) =>
    String(input).startsWith("file:")
      ? new Response(
          Uint8Array.from(await fs.readFile(new URL(String(input)))).buffer,
          { headers: { "Content-Type": "application/wasm" } },
        )
      : original.fetch(input, options)) as typeof fetch;
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 1,
    time = 0;
  globalThis.requestAnimationFrame = (callback) => {
    const id = next++;
    callbacks.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    callbacks.delete(id);
  };
  const engines: FerrumEngine[] = [],
    frames = new Map<FerrumEngine, FrameState>();
  const create = async (width: number, height: number) => {
    const engine = await createEngine(
      (frame) => frames.set(engine, frame),
      undefined,
      undefined,
      () => ({ width, height }),
    );
    engines.push(engine);
    return engine;
  };
  const step = () => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    time += 17;
    for (const callback of pending) callback(time);
  };
  try {
    const base = document();
    const actorPrefab = JSON.parse(
      JSON.stringify(base.sceneComposition.prefabs.actor),
    );
    actorPrefab.props.components.visual.animationSet = {
      initialClip: 7,
      clips: [
        {
          id: 7,
          fps: 4,
          loop: true,
          frames: [
            { u0: 0, v0: 0, u1: 0.5, v1: 1 },
            { u0: 0.5, v0: 0, u1: 1, v1: 1 },
          ],
        },
      ],
    };
    const upperPrefab = JSON.parse(JSON.stringify(actorPrefab));
    upperPrefab.props.components.body.heightSpan = {
      floorId: 1,
      elevation: 64,
      height: 8,
    };
    const doc = {
      ...base,
      gameplay: { primaryActor: "actor" },
      sceneComposition: {
        ...base.sceneComposition,
        prefabs: {
          actor: actorPrefab,
          upper: upperPrefab,
          tree: {
            props: {
              components: {
                visual: {
                  kind: "sprite",
                  texture: 0,
                  width: 12,
                  height: 24,
                  originY: 1,
                },
                collider: "none",
                layer: "wall",
              },
            },
          },
        },
        fragments: {
          lab: {
            instances: [
              ...base.sceneComposition.fragments.lab.instances,
              { id: "above", prefab: "upper", x: 80, y: 108 },
              { id: "tree", prefab: "tree", x: 5, y: 32 },
            ],
          },
        },
      },
      spatial: {
        ...base.spatial,
        billboards: { actor: {}, above: {}, tree: { elevation: 12 } },
        terrain: [
          ...base.spatial.terrain,
          {
            id: "bridge",
            x: 0,
            y: 80,
            width: 128,
            depth: 64,
            elevation: 64,
            baseElevation: 56,
            floorId: 1,
            kind: "bridge",
          },
        ],
      },
    };
    const source = await create(800, 480),
      handles = applyDataSceneAuthoringDocument(source, doc).entityHandles;
    source.start();
    step();
    step();
    ok(source.pauseDataScene());
    ok(
      source.moveDataSceneSpatialBody(handles.actor, 64, 0, {
        maxStepHeight: 16,
      }),
    );
    ok(
      source.setPhysicsBodyHeightSpan(handles.above, {
        floorId: 1,
        elevation: 64,
        height: 12,
      }),
    );
    ok(source.setPhysicsBodyEnabled(handles.above, false));
    ok(source.setPhysicsColliderEnabled(handles.above, false));
    ok(
      source.updateDataSceneSpriteAnimations([
        {
          entity: handles.actor,
          clip: 7,
          paused: true,
          flipX: true,
          flipY: true,
        },
      ]),
    );
    // Do not render after this setter: the saved camera must come from native state, not stale frame_camera.
    const changedCamera = {
      ...camera,
      projection: "perspective" as const,
      fovDegrees: 60,
      position: { x: 100, y: -240, elevation: 300 },
      target: { x: 48, y: 32, elevation: 24 },
      far: 2000,
    };
    ok(
      source.setDataSceneSpatialCamera(changedCamera, {
        width: 800,
        height: 480,
      }),
    );
    const saved = captureGameStateSnapshot(source, {
      includeDataSceneState: true,
      includeDataSceneProgress: true,
      dataSceneAuthoringDocument: JSON.parse(JSON.stringify(doc)),
    });
    equal(saved.dataScene!.version, 6);
    equal(saved.dataScene!.progress!.spatial!.camera!.position.x, 100);
    const poses = saved.dataScene!.progress!.instances;
    deepEqual(poses.find((p) => p.id === "actor")!.spatialPose, {
      x: 80,
      y: 16,
      heightSpan: { floorId: 0, elevation: 32, height: 8 },
      surfaceId: "upper",
    });
    deepEqual(poses.find((p) => p.id === "above")!.spatialPose, {
      x: 80,
      y: 108,
      heightSpan: { floorId: 1, elevation: 64, height: 12 },
      surfaceId: "bridge",
    });
    deepEqual(poses.find((p) => p.id === "tree")!.spatialPose, {
      x: 5,
      y: 32,
      heightSpan: null,
    });
    const parsed = parseGameStateSnapshot(stringifyGameStateSnapshot(saved));
    equal(parsed.snapshotHash, saved.snapshotHash);
    const dest = await create(390, 844);
    const sentinel = applyDataSceneAuthoringDocument(dest, doc).entityHandles
      .actor;
    const tamper = (edit: (snapshot: typeof saved) => void) => {
      const value = JSON.parse(JSON.stringify(saved)) as typeof saved;
      edit(value);
      return { ...value, snapshotHash: hashGameStateSnapshot(value) };
    };
    const invalids = [
      tamper((s) => {
        Object.assign(
          s.dataScene!.progress!.instances.find((p) => p.id === "actor")!
            .spatialPose!,
          { surfaceId: "bridge" },
        );
      }),
      tamper((s) => {
        Object.assign(
          s.dataScene!.progress!.instances.find((p) => p.id === "above")!
            .spatialPose!.heightSpan!,
          { floorId: 0 },
        );
      }),
      tamper((s) => {
        Object.assign(s.dataScene!.progress!.spatial!.camera!, { near: 0 });
      }),
      tamper((s) => {
        Object.assign(
          s.dataScene!.progress!.instances.find((p) => p.id === "actor")!
            .spatialPose!,
          { x: 1e100 },
        );
      }),
      tamper((s) => {
        Object.assign(s.dataScene!, { version: 5 });
      }),
    ];
    for (const bad of invalids) {
      throws(
        () => restoreGameStateSnapshot(dest, bad),
        /spatial|camera|f32|version/,
      );
      ok(dest.getPhysicsEntity(sentinel));
      equal(dest.getPhysicsEntity(sentinel)!.x, 16);
    }
    const restored = restoreGameStateSnapshot(dest, parsed);
    ok(restored.dataSceneStateApplied);
    equal(dest.dataSceneState(), "paused");
    equal(dest.getPhysicsEntity(sentinel), undefined);
    dest.start();
    step();
    step();
    const fresh = captureGameStateSnapshot(dest, {
      includeDataSceneState: true,
      includeDataSceneProgress: true,
      dataSceneAuthoringDocument: JSON.parse(JSON.stringify(doc)),
    });
    deepEqual(fresh.dataScene!.progress, saved.dataScene!.progress);
    const frame = frames.get(dest)!.renderCommandBuffer.spatial!;
    equal(frame.camera[26], 390);
    equal(frame.camera[27], 844);
    equal(frame.camera[16], 1);
    equal(frame.camera[17], 100);
    equal(frame.billboardVertexCount, 18);
    // Legacy v5 retains its exact bytes/hash and restores authored pose/camera defaults.
    const legacy = tamper((s) => {
      const progress = s.dataScene!.progress!;
      Object.assign(s.dataScene!, { version: 5 });
      delete (progress as { spatial?: unknown }).spatial;
      for (const p of progress.instances)
        delete (p as { spatialPose?: unknown }).spatialPose;
    });
    const legacyJson = stringifyGameStateSnapshot(legacy);
    equal(parseGameStateSnapshot(legacyJson).snapshotHash, legacy.snapshotHash);
    restoreGameStateSnapshot(dest, parseGameStateSnapshot(legacyJson));
    step();
    const authored = captureGameStateSnapshot(dest, {
      includeDataSceneState: true,
      includeDataSceneProgress: true,
      dataSceneAuthoringDocument: JSON.parse(JSON.stringify(doc)),
    });
    equal(
      authored.dataScene!.progress!.instances.find((p) => p.id === "actor")!
        .spatialPose!.x,
      16,
    );
    equal(frames.get(dest)!.renderCommandBuffer.spatial!.camera[16], 0);
    source.clearDataSceneSpatial();
    const cleared = captureGameStateSnapshot(source, {
      includeDataSceneState: true,
      includeDataSceneProgress: true,
      dataSceneAuthoringDocument: JSON.parse(JSON.stringify(doc)),
    });
    equal(cleared.dataScene!.progress!.spatial!.camera, null);
    ok(
      cleared.dataScene!.progress!.instances.every(
        (p) => p.spatialPose === undefined,
      ),
    );
    restoreGameStateSnapshot(dest, cleared);
    step();
    equal(frames.get(dest)!.renderCommandBuffer.spatial, undefined);
    // Geometry reconfiguration invalidates the original-document capture context.
    const reapplied = applyDataSceneAuthoringDocument(source, doc);
    ok(
      source.configureDataSceneSpatial(
        resolveDataSceneSpatialSpec(doc.spatial),
        reapplied.entityHandles,
      ),
    );
    throws(
      () =>
        captureGameStateSnapshot(source, {
          includeDataSceneState: true,
          includeDataSceneProgress: true,
          dataSceneAuthoringDocument: JSON.parse(JSON.stringify(doc)),
        }),
      /original authored terrain/,
    );
    const flatDoc = { ...doc, spatial: undefined };
    const flat = applyDataSceneAuthoringDocument(source, flatDoc);
    ok(
      source.configureDataSceneSpatial(
        resolveDataSceneSpatialSpec(doc.spatial),
        flat.entityHandles,
      ),
    );
    throws(
      () =>
        captureGameStateSnapshot(source, {
          includeDataSceneState: true,
          includeDataSceneProgress: true,
          dataSceneAuthoringDocument: JSON.parse(JSON.stringify(flatDoc)),
        }),
      /absent from the authored document/,
    );
  } finally {
    for (const engine of engines) engine.destroy();
    globalThis.fetch = original.fetch;
    globalThis.requestAnimationFrame = original.raf;
    globalThis.cancelAnimationFrame = original.cancel;
  }
});

test("public Wasm spatial packet binds physical elevation, terrain picking, camera and JSON restore", async () => {
  const original = {
    fetch: globalThis.fetch,
    raf: globalThis.requestAnimationFrame,
    cancel: globalThis.cancelAnimationFrame,
  };
  const readFile = (
    await (new Function("return import('node:fs/promises')")() as Promise<{
      readFile(url: URL): Promise<Uint8Array>;
    }>)
  ).readFile;
  globalThis.fetch = (async (input, options) =>
    String(input).startsWith("file:")
      ? new Response(
          Uint8Array.from(await readFile(new URL(String(input)))).buffer,
          { headers: { "Content-Type": "application/wasm" } },
        )
      : original.fetch(input, options)) as typeof fetch;
  let tick: (time: number) => void = () => {},
    frame: FrameState | undefined,
    time = 0;
  globalThis.requestAnimationFrame = (fn) => ((tick = fn), 1);
  globalThis.cancelAnimationFrame = () => {};
  const engine = await createEngine((f) => {
    frame = f;
  });
  const step = () => {
    tick((time += 1000 / 60));
    if (!frame?.renderCommandBuffer.spatial)
      throw new Error("missing actual spatial frame");
    return frame.renderCommandBuffer.spatial;
  };
  try {
    throws(
      () =>
        applyBuiltInSceneAuthoringDocument(engine, "shooter", {
          ...document(),
          spatial: { ...document().spatial, billboards: {}, actor: undefined },
        }),
      /spatial configuration is supported only by Data Scene/,
    );
    const originalDocument = document();
    const doc = {
      ...originalDocument,
      spatial: {
        ...originalDocument.spatial,
        terrain: originalDocument.spatial.terrain.map((s, i) => ({
          ...s,
          floorId: i === 0 ? 0 : 1,
        })),
        connections: [{ from: "low", to: "step" }],
      },
    };
    const actor = applyDataSceneAuthoringDocument(engine, doc).entityHandles
      .actor;
    throws(
      () =>
        applyDataSceneAuthoringDocument(engine, {
          ...doc,
          spatial: {
            ...doc.spatial,
            connections: [{ from: "low", to: "missing" }],
          },
        }),
      /connections/,
    );
    ok(engine.getPhysicsEntity(actor)); // invalid connection must be rejected before scene activation
    engine.start();
    tick(0);
    const lower = step(),
      lowerY = lower.billboards[1];
    equal(lower.version, 2);
    if (lower.version !== 2) throw new Error("missing spatial ABI v2");
    equal(lower.vertexStride, 11);
    equal(lower.camera.length, 28);
    equal(lower.terrainVertexCount, 108);
    equal(lower.debug, undefined);
    ok(lower.terrainDrawRanges instanceof Uint32Array);
    deepEqual([...lower.terrainDrawRanges], [0, 108]);
    // Enabling diagnostics may grow Wasm memory; copy borrowed data before the setter.
    const savedRanges = lower.terrainDrawRanges.slice();
    const terrain = lower.terrain.slice();
    const revision = lower.terrainRevision;
    throws(
      () => engine.setDataSceneSpatialDebug({ terrain: "yes" } as never),
      /spatial.debug.terrain/,
    );
    throws(
      () => engine.setDataSceneSpatialDebug({ typo: true } as never),
      /spatial.debug.typo/,
    );
    ok(engine.pauseDataScene());
    const snapshot = () =>
      captureGameStateSnapshot(engine, {
        includeDataSceneState: true,
        includeDataSceneProgress: true,
        dataSceneAuthoringDocument: JSON.parse(JSON.stringify(doc)),
      });
    const beforeDebug = snapshot();
    ok(
      engine.setDataSceneSpatialDebug({
        terrain: true,
        billboards: true,
        heightSpans: true,
      }),
    );
    const diagnostic = step().debug!;
    equal(diagnostic.version, 1);
    equal(diagnostic.vertexStride, 11);
    equal(diagnostic.vertexCount, 3 * 24 + 12 + 10);
    equal(diagnostic.vertices.length, diagnostic.vertexCount * 11);
    equal(diagnostic.depthTest, true);
    equal(diagnostic.truncated, false);
    deepEqual(snapshot().dataScene!.progress, beforeDebug.dataScene!.progress);
    equal(JSON.stringify(snapshot()).includes("debug"), false);
    ok(
      engine.setDataSceneSpatialDebug({
        colliders: true,
        contacts: true,
        floorIds: true,
        depthTest: false,
      }),
    );
    const physicsDebug = step().debug!;
    ok(physicsDebug.vertexCount > 24 && physicsDebug.vertexCount <= 32768);
    equal(physicsDebug.depthTest, false);
    deepEqual(snapshot().dataScene!.progress, beforeDebug.dataScene!.progress);
    ok(engine.setDataSceneSpatialDebug({ terrain: true, depthTest: false }));
    equal(step().debug!.depthTest, false);
    equal(step().debug!.vertexCount, 72);
    ok(engine.setDataSceneSpatialDebug(null));
    equal(step().debug, undefined);
    ok(
      engine.setDataSceneSpatialCamera(
        {
          ...camera,
          position: { ...camera.position, x: 10000 },
          target: { ...camera.target, x: 10000 },
        },
        { width: 800, height: 480 },
      ),
    );
    const outside = step();
    equal(outside.version, 2);
    deepEqual([...(outside.terrainDrawRanges ?? [])], []);
    deepEqual(outside.terrain, terrain);
    equal(outside.terrainRevision, revision);
    equal(outside.terrainVertexCount, 108);
    deepEqual([...savedRanges], [0, 108]);
    ok(engine.setDataSceneSpatialCamera(camera, { width: 800, height: 480 }));
    const recovered = step();
    deepEqual([...(recovered.terrainDrawRanges ?? [])], [0, 108]);
    equal(recovered.terrainRevision, revision);
    equal(lower.billboardVertexCount, 6);
    equal(frame!.renderCommandBuffer.commandCount, 0);
    equal(frame!.spriteCount, 1);
    ok(engine.moveDataSceneSpatialBody(actor, 64, 0, { maxStepHeight: 16 }));
    const upper = step();
    equal(engine.getPhysicsEntity(actor)!.heightSpan!.elevation, 32);
    equal(engine.getPhysicsEntity(actor)!.heightSpan!.floorId, 1);
    equal(upper.billboards[1] - lowerY, 32);
    const canvas = {
      clientWidth: 800,
      clientHeight: 480,
      getBoundingClientRect: () => ({
        left: 23,
        top: 31,
        width: 640,
        height: 384,
      }),
    } as HTMLCanvasElement;
    const view = createDataSceneSpatialView(engine, canvas);
    for (const projection of ["orthographic", "perspective"] as const) {
      ok(
        engine.setDataSceneSpatialCamera(
          { ...camera, projection },
          { width: 800, height: 480 },
        ),
      );
      const f = step();
      const point = { x: 80, y: 32, elevation: 32 };
      const screen = view.project(point, f)!;
      const hit = view.pick(screen, f)!;
      equal(hit.surfaceId, "upper");
      ok(
        Math.abs(hit.x - point.x) < 0.01 &&
          Math.abs(hit.y - point.y) < 0.01 &&
          Math.abs(hit.elevation - point.elevation) < 0.01,
      );
      equal(hit.walkable, true);
    }
    const saved = captureGameStateSnapshot(engine, {
      includeDataSceneState: true,
      includeDataSceneProgress: true,
      dataSceneAuthoringDocument: JSON.parse(JSON.stringify(doc)),
    });
    equal(saved.dataScene!.version, 6);
    equal(
      saved.dataScene!.progress!.instances.find((p) => p.id === "actor")!
        .spatialPose!.heightSpan!.floorId,
      1,
    );
    ok(engine.setDataSceneSpatialDebug({ terrain: true }));
    ok(step().debug);
    equal(
      restoreGameStateSnapshot(engine, JSON.parse(JSON.stringify(saved)))
        .dataSceneStateApplied,
      true,
    );
    const restored = step();
    equal(restored.debug, undefined);
    equal(restored.billboardVertexCount, 6);
    equal(engine.getPhysicsEntity(actor), undefined);
    const stale = { ...restored, camera: restored.camera.slice() };
    engine.clearDataSceneSpatial();
    engine.setDataSceneCamera({ x: 16, y: 16 });
    equal(engine.pickDataSceneSpatialSurface(0, 0, stale), undefined);
    // Subsequent flat frame is verified without the spatial-only helper.
    tick((time += 17));
    equal(frame!.renderCommandBuffer.spatial, undefined);
    ok(frame!.renderCommandBuffer.commandCount > 0);
    const environmentDoc = {
      ...doc,
      spatial: {
        ...doc.spatial,
        environment: {
          lighting: {
            lights: [
              { position: { x: 24, y: 16, elevation: 64 }, radius: 200 },
            ],
            shadows: { lightIndex: 0 as const, resolution: 128 as const },
          },
          depthOfField: { focusDistance: 200, maxBlurRadius: 6 },
          colorGrading: { exposure: 1, toneMapping: "aces" as const },
          fog: { start: 100, end: 400, color: [0.2, 0.3, 0.4] as const },
        },
      },
    };
    let environmentHandles = applyDataSceneAuthoringDocument(
      engine,
      environmentDoc,
    ).entityHandles;
    engine.pauseDataScene();
    const authoredEnvironment = step().environment!;
    equal(authoredEnvironment.version, 1);
    equal(authoredEnvironment.values.length, 80);
    equal(authoredEnvironment.shadowMatrices.length, 96);
    equal(authoredEnvironment.shadowCasterVertexCount, 6);
    const changedEnvironment = {
      ...environmentDoc.spatial.environment,
      depthOfField: { focusDistance: 250, maxBlurRadius: 4 },
    };
    ok(engine.setDataSceneSpatialEnvironment(changedEnvironment));
    const currentValues = step().environment!.values.slice();
    const environmentSave = captureGameStateSnapshot(engine, {
      includeDataSceneState: true,
      includeDataSceneProgress: true,
      dataSceneAuthoringDocument: JSON.parse(JSON.stringify(environmentDoc)),
    });
    equal(environmentSave.dataScene!.version, 7);
    equal(
      environmentSave.dataScene!.progress!.spatial!.environment!.depthOfField!
        .focusDistance,
      250,
    );
    const invalidEnvironment = JSON.parse(JSON.stringify(environmentSave));
    invalidEnvironment.dataScene.progress.spatial.environment.depthOfField.maxBlurRadius = 13;
    invalidEnvironment.snapshotHash = hashGameStateSnapshot(invalidEnvironment);
    throws(
      () => restoreGameStateSnapshot(engine, invalidEnvironment),
      /maxBlurRadius/,
    );
    ok(engine.gameplayEntityExists(environmentHandles.actor));
    const downgrade = JSON.parse(JSON.stringify(environmentSave));
    downgrade.dataScene.version = 6;
    downgrade.snapshotHash = hashGameStateSnapshot(downgrade);
    throws(() => restoreGameStateSnapshot(engine, downgrade), /version 7/);
    ok(engine.setDataSceneSpatialEnvironment(null));
    equal(step().environment, undefined);
    ok(
      restoreGameStateSnapshot(
        engine,
        JSON.parse(JSON.stringify(environmentSave)),
      ).dataSceneStateApplied,
    );
    deepEqual(step().environment!.values, currentValues);
    environmentHandles = applyDataSceneAuthoringDocument(
      engine,
      environmentDoc,
    ).entityHandles;
    engine.pauseDataScene();
    ok(engine.setDataSceneSpatialEnvironment(null));
    step();
    const disabledEnvironment = captureGameStateSnapshot(engine, {
      includeDataSceneState: true,
      includeDataSceneProgress: true,
      dataSceneAuthoringDocument: JSON.parse(JSON.stringify(environmentDoc)),
    });
    equal(disabledEnvironment.dataScene!.version, 7);
    equal(disabledEnvironment.dataScene!.progress!.spatial!.environment, null);
    ok(
      restoreGameStateSnapshot(
        engine,
        JSON.parse(JSON.stringify(disabledEnvironment)),
      ).dataSceneStateApplied,
    );
    equal(step().environment, undefined);
  } finally {
    engine.destroy();
    globalThis.fetch = original.fetch;
    globalThis.requestAnimationFrame = original.raf;
    globalThis.cancelAnimationFrame = original.cancel;
  }
});
