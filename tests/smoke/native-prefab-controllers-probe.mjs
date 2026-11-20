import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Packed public SDK authoring, actual generated native bodies and controller state. */
export async function probeNativePrefabControllers(page, packageEvidence = {}) {
  const directory = resolve("artifacts/physics-3d/goal-closure/prefab-controllers/browser");
  await mkdir(directory, { recursive: true });
  const report = { format: "ferrum2d.native-prefab-controllers.browser", version: 1, status: "running", packageEvidence };
  try {
    const result = await page.evaluate(async () => {
      const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: B, UNIFIED_PHYSICS_CHARACTER_LAYOUT: C } = await import("@ferrum2d/ferrum-web/core");
      const { applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry } = await import("@ferrum2d/ferrum-web/authoring");
      const originalRaf = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
      const pending = new Map(), engines = [], checkpoints = [];
      let serial = 0, timestamp = 0, stage = "initialization";
      window.requestAnimationFrame = callback => { pending.set(++serial, callback); return serial; };
      window.cancelAnimationFrame = id => { pending.delete(id); };
      const pump = ms => {
        timestamp += ms; const callbacks = [...pending.values()]; pending.clear();
        if (callbacks.length !== 1) throw new Error(`Expected one owned prefab RAF, received ${callbacks.length}`);
        callbacks[0](timestamp);
      };
      const tick = engine => { engine.start(); engine.resume(); pump(100); pump(10); engine.pause(); };
      const ids = handle => new Uint32Array([handle.entityId, handle.entityGeneration]);
      const body = (engine, handle) => {
        const row = engine.queryUnifiedPhysicsBodyStates(ids(handle));
        if (row.count !== 1 || row.words[B.entityId] !== handle.entityId || row.words[B.entityGeneration] !== handle.entityGeneration)
          throw new Error("Spawned prefab has no matching native body row");
        return { count: row.count, words: [...row.words], floats: [...row.floats], position: [...row.floats.slice(B.position, B.position + 3)] };
      };
      const character = (engine, handle) => {
        const row = engine.queryUnifiedPhysicsCharacterStates(ids(handle));
        if (row.count !== 1 || row.words[C.entityId] !== handle.entityId || row.words[C.entityGeneration] !== handle.entityGeneration)
          throw new Error("Spawned prefab has no matching native character row");
        return { count: row.count, words: [...row.words], floats: [...row.floats] };
      };
      const input = () => ({ w: false, a: false, s: false, d: false, space: false, enter: false, mouseLeft: false, mouseX: 0, mouseY: 0 });
      const create = async () => {
        const controls = input(), events = [], sample = { frames: 0, nativeFrames: 0, steps: 0, maxRustMs: 0 };
        const engine = await createEngine(frame => {
          events.push(...frame.gameplayEvents.map(event => ({ ...event })));
          sample.frames++; sample.nativeFrames += Number(Boolean(frame.unifiedPhysics));
          sample.steps += frame.unifiedPhysics?.frame.backendSteps ?? 0;
          sample.maxRustMs = Math.max(sample.maxRustMs, frame.rustUpdateTimeMs);
        }, () => controls, undefined, () => ({ width: 320, height: 180 }));
        engines.push(engine);
        if (!engine.supportsDataSceneSpawnPrefabPhysics()) throw new Error("Packed core lacks native prefab physics capability version 1");
        if (!engine.setInputActionBinding(77, 0, { control: "mouseLeft", activation: "pressed" })) throw new Error("Prefab input binding rejected");
        return { engine, controls, events, sample };
      };
      const spawn = owner => {
        owner.events.length = 0; owner.controls.mouseLeft = true; tick(owner.engine);
        const events = owner.events.filter(event => event.kind === "prefabSpawned");
        if (events.length !== 1) throw new Error(`Expected one prefab spawn: ${JSON.stringify(owner.events)}`);
        const event = events[0];
        if (event.tokenId !== 1 || event.payloadBits !== 77) throw new Error("Prefab action identity mismatch");
        return { entityId: event.actorId, entityGeneration: event.actorGeneration };
      };
      const visual = { kind: "primitive", shape: "circle", radius: 0.25 };
      // This physics probe consumes commands without a GPU renderer; bind the
      // authored primitive to a numeric texture through the public cold resolver.
      const textureId = () => 11;
      const document = (space, limits = {}) => ({
        format: "ferrum2d.consumer.scene-authoring", version: 1,
        physics: { space, gravity: [0, 0, 0], stepSeconds: 0.01, lengthUnit: 1, ...limits },
        ids: { actions: { summon: 77 }, prefabs: { actor: 1 } },
        gameplay: { combat: true, primaryActor: "source", spawnPrefabs: { actor: { prototypeInstanceId: "seed" } } },
        sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances: [
          { id: "source", prefab: "object", x: space === "planar-xy" ? 5 : 0, y: space === "planar-xy" ? 5 : 0,
            props: { behaviorRecipes: "spawner", components: { visual, collider: "none", layer: "player" } } },
          { id: "seed", prefab: "object", x: 100, y: space === "planar-xy" ? 5 : 0, props: { components: { template: "seed" } } },
        ] } } },
        behaviorRecipes: { entities: { spawner: { recipes: [{ kind: "spawnPrefabAction", action: "summon", prefab: "actor", offsetX: space === "planar-xy" ? 0 : 10 }] } } },
      });
      const planar = [], capacity = [];
      try {
        for (const mode of ["height", "mask"]) {
          stage = `planar ${mode} inherited controller`;
          const owner = await create(), e = owner.engine, doc = document("planar-xy"), registry = createSceneInstanceHandleRegistry();
          const overrides = { solidMaskBits: mode === "mask" ? 0 : 0xffffffff, maxIterations: 7, maxStepHeight: 4, maxDropHeight: 4, allowLedgeDrop: true };
          if (mode === "height") doc.physics.collisionTilemap = {
            columns: 3, rows: 1, tileWidth: 10, tileHeight: 10, tiles: [1, 2, 3],
            definitions: [{ id: 1, blocksMovement: false }, { id: 2, elevation: 3, blocksMovement: false }, { id: 3, elevation: 0, kind: "ledge", blocksMovement: false }],
          };
          let lookups = 0;
          const applied = applyDataSceneAuthoringDocument(e, doc, { textureId, instanceHandleRegistry: registry, componentTemplates: () => {
            lookups++; return { visual, collider: { type: "circle", radius: 0.25, isTrigger: false }, layer: "enemy",
              body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 1 }, kinematicController: overrides } };
          } });
          if (!e.setInputActionBinding(77, 0, { control: "mouseLeft", activation: "pressed" })) throw new Error("Planar prefab input rejected");
          const prototype = applied.entityHandles.seed;
          if (!e.configureDataSceneKinematicController(prototype, { solidMaskBits: 0xffffffff })) throw new Error("Prototype mutation rejected");
          if (!e.despawnPhysicsEntity(prototype)) throw new Error("Prototype removal rejected");
          if (mode === "mask") e.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [10, 5, 0] }, collider: { shape: { type: "box", halfExtents: [0.25, 2, 1] }, category: 8 } });
          const child = spawn(owner), initial = body(e, child);
          e.setPhysicsBodyVelocity(child, 1000, 0); e.stepRigidBodies(Math.fround(0.01));
          const moved = body(e, child), firstSpan = e.getPhysicsBodyHeightSpan(child);
          let dropped, dropSpan;
          if (mode === "height") { e.stepRigidBodies(Math.fround(0.01)); dropped = body(e, child); dropSpan = e.getPhysicsBodyHeightSpan(child); }
          planar.push({ mode, overrides, prototype, child, initial, moved, firstSpan, dropped, dropSpan, lookups,
            raw: applied.document.sceneComposition.fragments.main.instances[1].props.components, sample: owner.sample, backend: e.physicsBackend() });
          e.destroy(); engines.pop();
        }

        stage = "spatial native capsule prototype and checkpoint replay";
        const owner = await create(), e = owner.engine, doc = document("spatial"), registry = createSceneInstanceHandleRegistry();
        doc.spatial = { camera: { projection: "orthographic", position: { x: 0, y: -20, elevation: 20 }, target: { x: 0, y: 0, elevation: 0 }, height: 40 }, terrain: [], billboards: { seed: {} } };
        const seed = { visual, collider: "none", layer: "enemy", body: { kind: "kinematic-position", elevation: 2, renderOffset: [0.2, 0.3, 0.4],
          collider: { shape: { type: "capsule", halfHeight: 0.5, radius: 0.25 } }, character: { skinWidth: 0.02, stepHeight: 0.4, snapDistance: 0.15, pushMass: 2 } } };
        const applied = applyDataSceneAuthoringDocument(e, doc, { textureId, componentTemplates: { seed }, instanceHandleRegistry: registry });
        if (!e.setInputActionBinding(77, 0, { control: "mouseLeft", activation: "pressed" })) throw new Error("Spatial prefab input rejected");
        const prototype = applied.entityHandles.seed;
        e.removeUnifiedPhysicsBody(prototype);
        const checkpoint = e.captureRuntimeCheckpoint(); checkpoints.push(checkpoint);
        const run = () => {
          const child = spawn(owner), initial = body(e, child), fresh = character(e, child);
          e.setUnifiedPhysicsCharacterInputs(ids(child), new Float32Array([2, 0, 0, 0]));
          for (let index = 0; index < 20; index++) e.stepRigidBodies(Math.fround(0.01));
          const moved = body(e, child);
          e.setUnifiedPhysicsPoses(ids(child), new Float32Array([3, 5, -2, 0, 0, 0, 1]));
          const teleported = body(e, child);
          e.setUnifiedPhysicsCharacterInputs(ids(child), new Float32Array([1, 0, 0, 0])); e.stepRigidBodies(Math.fround(0.01));
          return { child, initial, fresh, moved, teleported, continued: body(e, child), controller: character(e, child), colliders: e.queryUnifiedPhysicsColliders(child), entities: e.entityCount() };
        };
        const expected = run(); e.restoreRuntimeCheckpoint(checkpoint); const replay = run(); checkpoint.dispose(); checkpoints.pop();
        const spatial = { prototype, expected, replay, registrySource: registry.get("source"), raw: applied.document.sceneComposition.fragments.main.instances[1].props.components, sample: owner.sample, backend: e.physicsBackend() };
        e.destroy(); engines.pop();

        for (const limits of [{ maxBodies: 1 }, { maxColliders: 1 }, { maxCharacters: 1 }]) {
          stage = `spatial prefab capacity ${Object.keys(limits)[0]}`;
          const owner = await create(), e = owner.engine, applied = applyDataSceneAuthoringDocument(e, document("spatial", limits), { textureId, componentTemplates: { seed } });
          if (!e.setInputActionBinding(77, 0, { control: "mouseLeft", activation: "pressed" })) throw new Error("Capacity prefab input rejected");
          const prototype = applied.entityHandles.seed, before = body(e, prototype), entities = e.entityCount();
          owner.controls.mouseLeft = true; tick(e);
          const events = [...owner.events], retained = body(e, prototype), entitiesAfterFailure = e.entityCount();
          e.removeUnifiedPhysicsBody(prototype); owner.controls.mouseLeft = false; tick(e);
          const child = spawn(owner), live = body(e, child), controlled = character(e, child);
          capacity.push({ limits, before, retained, events, entities, entitiesAfterFailure, child, live, controlled, entitiesAfterRetry: e.entityCount(), sample: owner.sample });
          e.destroy(); engines.pop();
        }
        return { planar, spatial, capacity };
      } catch (error) { throw new Error(`${stage}: ${error?.stack ?? error}`); }
      finally {
        for (const checkpoint of checkpoints.reverse()) checkpoint.dispose();
        for (const engine of engines.reverse()) engine.destroy();
        pending.clear(); window.requestAnimationFrame = originalRaf; window.cancelAnimationFrame = originalCancel;
      }
    });
    for (const row of result.planar) {
      assert.equal(row.backend, "unified-3d"); assert.equal(row.lookups, 1); assert.deepEqual(row.raw, { template: "seed" });
      assert.notDeepEqual(row.prototype, row.child); assert.equal(row.initial.count, 1);
      assert(Math.abs(row.initial.position[0] - 5) < 0.002); assert(Math.abs(row.moved.position[0] - 15) < 0.002, JSON.stringify(row));
      if (row.mode === "height") { assert.equal(row.firstSpan.elevation, 3); assert(Math.abs(row.dropped.position[0] - 25) < 0.002); assert.equal(row.dropSpan.elevation, 0); }
      assert(row.sample.frames > 0 && row.sample.nativeFrames === row.sample.frames && Number.isFinite(row.sample.maxRustMs));
    }
    const spatial = result.spatial, child = spatial.expected;
    assert.equal(spatial.backend, "unified-3d"); assert.deepEqual(spatial.raw, { template: "seed" }); assert.deepEqual(spatial.replay, child);
    assert.notDeepEqual(child.child, spatial.prototype); assert.equal(child.entities, 2); assert.equal(child.colliders.length, 1); assert.equal(child.fresh.count, 1);
    assert(Math.abs(child.initial.position[0] - 9.8) < 0.002 && Math.abs(child.initial.position[1] - 1.7) < 0.002 && Math.abs(child.initial.position[2] + 0.4) < 0.002);
    assert(Math.abs(child.moved.position[0] - child.initial.position[0] - 0.4) < 0.003, JSON.stringify(spatial));
    assert.deepEqual(child.teleported.position, [3, 5, -2]); assert(Math.abs(child.continued.position[0] - 3.01) < 0.002);
    for (const row of result.capacity) {
      assert.deepEqual(row.retained, row.before); assert.equal(row.entitiesAfterFailure, row.entities); assert.equal(row.entitiesAfterRetry, 2);
      assert(!row.events.some(event => event.kind === "prefabSpawned")); assert(row.events.some(event => event.kind === "actionFailed"), JSON.stringify(row));
      assert.equal(row.live.count, 1); assert.equal(row.controlled.count, 1);
    }
    Object.assign(report, { status: "passed", result });
    return report;
  } catch (error) { Object.assign(report, { status: "failed", error: error?.stack ?? String(error) }); throw error; }
  finally { await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n"); }
}
