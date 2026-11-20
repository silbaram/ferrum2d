import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Everything inside the browser uses the packed package's public SDK. In
// particular, the native authoring transaction is not replaced or faulted here.
export async function probeAggregateNativeAuthoring(page, packageEvidence = {}) {
  const directory = resolve("artifacts/physics-3d/aggregate-authoring/browser");
  await mkdir(directory, { recursive: true });
  const report = { format: "ferrum2d.aggregate-native-authoring.browser", version: 1, status: "running", packageEvidence };
  try {
    const result = await page.evaluate(async () => {
      const { createEngine, resolvePhysicsSpec, loadSpatialGlb, UNIFIED_PHYSICS_STATE_LAYOUT: L } = await import("@ferrum2d/ferrum-web/core");
      const { applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry, applyPhysicsSceneProfile } = await import("@ferrum2d/ferrum-web/authoring");
      const originalRaf = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
      const pending = new Map(); let next = 0, timestamp = 0, stage = "initialization";
      window.requestAnimationFrame = callback => { const id = ++next; pending.set(id, callback); return id; };
      window.cancelAnimationFrame = id => { pending.delete(id); };
      const pump = milliseconds => {
        timestamp += milliseconds; const callbacks = [...pending.values()]; pending.clear();
        if (callbacks.length !== 1) throw new Error(`Expected one owned browser RAF, received ${callbacks.length}`);
        callbacks[0](timestamp);
      };
      const tick = engine => { engine.start(); engine.resume(); pump(100); pump(10); engine.pause(); };
      const ids = handles => new Uint32Array(handles.flatMap(handle => [handle.entityId, handle.entityGeneration]));
      const states = (engine, handles) => {
        const state = engine.queryUnifiedPhysicsBodyStates(ids(handles));
        return { count: state.count, words: [...state.words], floats: [...state.floats] };
      };
      const grid = { columns: 5, rows: 1, tileWidth: 10, tileHeight: 10, tiles: [1, 2, 1, 1, 1],
        definitions: [{ id: 1, blocksMovement: false }, { id: 2, elevation: 3, blocksMovement: false }] };
      const visual = { kind: "primitive", shape: "circle", radius: 0.25 };
      const object = (id, x, y, components) => ({ id, prefab: "object", x, y, props: { components: { visual, layer: "wall", ...components } } });
      const document = instances => ({ format: "ferrum2d.consumer.scene-authoring", version: 1,
        sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances } } }, behaviorRecipes: { entities: {} } });
      const native = (kind, category = 8) => ({ collider: "none", body: { kind, collider: { shape: { type: "sphere", radius: 0.25 }, category } } });
      const cost = () => ({ frames: 0, nativeFrames: 0, maxRustMs: 0, fixed: true });
      const recordCost = (sample, frame) => {
        sample.frames++; sample.nativeFrames += Number(Boolean(frame.unifiedPhysics));
        sample.maxRustMs = Math.max(sample.maxRustMs, frame.rustUpdateTimeMs); sample.fixed &&= frame.physics.fixedTimestepEnabled;
      };
      const legacy = { collider: { type: "circle", radius: 0.25, isTrigger: false }, layer: "player",
        body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 1 },
          kinematicController: { solidMaskBits: 8, maxIterations: 8, maxStepHeight: 4, maxDropHeight: 4 } } };
      const engines = [];
      let specCheckpoint, sceneCheckpoint, modelCheckpoint;
      try {
        stage = "Physics Spec controller authoring";
        const specCost = cost(), e = await createEngine(frame => recordCost(specCost, frame)); engines.push(e); e.useDataScene();
        const physics = { mode: "rigid", gravity: [0, 0], solver: { stepSeconds: 0.01 }, hd2d: { enabled: true, defaultHeight: 1 },
          bodies: { actor: { type: "kinematic", position: [5, 5], velocity: [1000, 0],
            collider: { shape: "circle", radius: 0.25 }, kinematicController: { maxStepHeight: 4, maxDropHeight: 4 } } } };
        const profile = applyPhysicsSceneProfile(e, { profile: "manual", physics });
        const actor = profile.world.bodies.actor;
        if (!e.configureDataSceneCollisionTilemap(grid)) throw new Error("Physics Spec terrain configuration failed");
        tick(e); specCheckpoint = e.captureRuntimeCheckpoint();
        const specTrace = () => {
          const trace = [];
          for (let step = 0; step < 2; step++) { e.stepRigidBodies(profile.stepSeconds); trace.push({ ...states(e, [actor]), span: e.getPhysicsBodyHeightSpan(actor) }); }
          return trace;
        };
        const expected = specTrace(); e.restoreRuntimeCheckpoint(specCheckpoint); const replayed = specTrace();
        specCheckpoint.dispose(); specCheckpoint = undefined;
        e.pauseDataScene();
        const before = { ...states(e, [actor]), time: e.time(), state: e.dataSceneState(), entities: e.entityCount() };
        // The JSON resolver accepts this batch. The real component/native fixture
        // limit rejects the 65th collider after an earlier body has been staged.
        const invalid = { ...physics, bodies: {
          staged: { type: "static", position: [100, 0], collider: { shape: "circle", radius: 0.25 } },
          invalid: { type: "static", position: [200, 0], colliders: Array.from({ length: 65 }, () => ({ shape: "circle", radius: 0.25 })) },
        } };
        resolvePhysicsSpec(invalid);
        let invalidMessage;
        try { applyPhysicsSceneProfile(e, { profile: "manual", physics: invalid }, { replace: profile }); }
        catch (error) { invalidMessage = String(error); }
        const retained = { ...states(e, [actor]), time: e.time(), state: e.dataSceneState(), entities: e.entityCount() };
        stage = "Physics Spec cross-Engine replacement ownership";
        const foreign = await createEngine(); engines.push(foreign); foreign.useDataScene();
        const foreignProfile = applyPhysicsSceneProfile(foreign, { profile: "manual", physics });
        const foreignActor = foreignProfile.world.bodies.actor; tick(foreign); foreign.pauseDataScene();
        const observeOwner = (engine, handle) => ({ ...states(engine, [handle]), time: engine.time(), state: engine.dataSceneState(), entities: engine.entityCount() });
        const ownerBefore = { a: observeOwner(e, actor), b: observeOwner(foreign, foreignActor) };
        let ownerMessage;
        try { applyPhysicsSceneProfile(foreign, { profile: "manual", physics }, { replace: profile.world }); }
        catch (error) { ownerMessage = String(error); }
        const ownerRetained = { a: observeOwner(e, actor), b: observeOwner(foreign, foreignActor) };
        foreignProfile.clear(); foreign.destroy(); engines.pop();
        profile.clear(); profile.clear();
        let clearedHandleRejected = false;
        try { states(e, [actor]); } catch { clearedHandleRejected = true; }
        const spec = { expected, replayed, before, retained, invalidMessage, clearedHandleRejected, entitiesAfterClear: e.entityCount(), cost: specCost,
          crossEngine: { before: ownerBefore, retained: ownerRetained, message: ownerMessage } };
        e.destroy(); engines.pop();

        stage = "mixed planar Scene JSON aggregate admission";
        const registry = createSceneInstanceHandleRegistry();
        const mixed = document([
          object("actor", 5, 5, legacy),
          object("ignored", 25, 5, native("fixed", 16)),
          object("wall", 45, 5, { collider: { type: "aabb", halfWidth: 0.25, halfHeight: 2, isTrigger: false } }),
          object("anchor", 100, 0, native("fixed")), object("slider", 102, 0, native("dynamic")),
        ]);
        mixed.physics = { space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: 0.01, collisionTilemap: grid,
          joints: { tether: { bodyA: "anchor", bodyB: "slider", kind: { type: "distance", length: 2 } } } };
        mixed.variables = [{ name: "retained", scope: "scene", type: "integer", default: 0 }];
        const sceneCost = cost(), s = await createEngine(frame => recordCost(sceneCost, frame)); engines.push(s);
        const applied = applyDataSceneAuthoringDocument(s, mixed, { textureId: () => 11, instanceHandleRegistry: registry });
        const handles = Object.values(applied.entityHandles), runner = applied.entityHandles.actor;
        applied.variables.set("retained", 37);
        s.configureAutoRigidBodyStep(false); tick(s); s.setPhysicsBodyVelocity(runner, 1000, 0);
        const trace = () => {
          const rows = [];
          for (let step = 0; step < 4; step++) {
            s.stepRigidBodies(Math.fround(0.01));
            rows.push({ ...states(s, [runner]), span: s.getPhysicsBodyHeightSpan(runner) });
          }
          return rows;
        };
        sceneCheckpoint = s.captureRuntimeCheckpoint();
        const sceneExpected = trace(); s.restoreRuntimeCheckpoint(sceneCheckpoint); const sceneReplay = trace();
        sceneCheckpoint.dispose(); sceneCheckpoint = undefined;
        s.pauseDataScene();
        const observeScene = () => ({ ...states(s, handles), time: s.time(), state: s.dataSceneState(), entities: s.entityCount(),
          retainedVariable: applied.variables.get("retained"), actorRegistry: registry.get("actor"), wallRegistry: registry.get("wall"),
          joints: s.queryUnifiedPhysicsJointStates().count, actorSpan: s.getPhysicsBodyHeightSpan(runner) });
        const sceneBefore = observeScene();
        stage = "Scene JSON real aggregate capacity rejection and rollback";
        const capacity = document([object("candidate", 300, 0, native("fixed")), object("legacyCandidate", 400, 0, legacy)]);
        capacity.physics = { space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: 0.01, maxBodies: 1 };
        capacity.variables = [{ name: "retained", scope: "scene", type: "integer", default: 99 }];
        let capacityMessage;
        try { applyDataSceneAuthoringDocument(s, capacity, { textureId: () => 11, instanceHandleRegistry: registry }); }
        catch (error) { capacityMessage = String(error); }
        const sceneRetained = observeScene(), candidateRegistered = registry.has("candidate");
        stage = "rolled-back terrain and controller remain functional";
        sceneCheckpoint = s.captureRuntimeCheckpoint();
        s.setPhysicsBodyPosition(runner, 5, 5); s.setPhysicsBodyHeightSpan(runner, { floorId: 0, elevation: 0, height: 1 });
        s.setPhysicsBodyVelocity(runner, 1000, 0); s.stepRigidBodies(Math.fround(0.01));
        const continuation = { ...states(s, [runner]), span: s.getPhysicsBodyHeightSpan(runner) };
        s.restoreRuntimeCheckpoint(sceneCheckpoint); sceneCheckpoint.dispose(); sceneCheckpoint = undefined;
        stage = "spatial Scene JSON rejects collider-only legacy geometry";
        const spatialLegacyMessages = [];
        for (const body of [undefined, { type: "static" }, legacy.body]) {
          const spatialLegacy = document([object("legacy", 0, 0, { collider: { type: "circle", radius: 1, isTrigger: false }, ...(body ? { body } : {}) })]);
          spatialLegacy.physics = { space: "spatial", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: 0.01 };
          let message;
          try { applyDataSceneAuthoringDocument(s, spatialLegacy, { textureId: () => 11, instanceHandleRegistry: registry }); }
          catch (error) { message = String(error); }
          spatialLegacyMessages.push(message);
        }
        const afterSpatialRejection = observeScene();
        const scene = { expected: sceneExpected, replayed: sceneReplay, before: sceneBefore, retained: sceneRetained, afterSpatialRejection,
          capacityMessage, spatialLegacyMessages, candidateRegistered, continuation, cost: sceneCost };
        s.destroy(); engines.pop();

        stage = "native built-in to ordinary default Data Scene";
        const builtin = await createEngine(undefined, undefined, undefined, undefined, { physicsBackend: "legacy" }); engines.push(builtin); builtin.useBreakoutGame();
        builtin.configureUnifiedPhysics({ space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 100, stepSeconds: 0.01 });
        tick(builtin);
        const oldPaddle = builtin.builtInBreakoutPaddleHandle(), backendBefore = builtin.physicsBackend();
        if (!oldPaddle) throw new Error("Native Breakout paddle handle is missing");
        const paddleBefore = states(builtin, [oldPaddle]);
        const ordinary = document([object("ordinary", 3, 4, { collider: { type: "circle", radius: 0.25 }, body: { type: "dynamic", mass: 1 } })]);
        const ordinaryHandle = applyDataSceneAuthoringDocument(builtin, ordinary, { textureId: () => 11 }).entityHandles.ordinary;
        const ordinaryBefore = builtin.getPhysicsEntity(ordinaryHandle);
        builtin.setPhysicsBodyVelocity(ordinaryHandle, 1, 0); builtin.stepRigidBodies(Math.fround(0.01), { gravityX: 0, gravityY: 0 });
        const builtInSwitch = { backendBefore, paddleBefore, backendAfter: builtin.physicsBackend(), entities: builtin.entityCount(),
          oldPaddleRetained: builtin.gameplayEntityExists(oldPaddle), before: ordinaryBefore, after: builtin.getPhysicsEntity(ordinaryHandle) };
        builtin.destroy(); engines.pop();

        stage = "public GLB resource creation";
        // A tiny self-contained GLB exercises the public validated asset loader;
        // no internal resource constructors or package implementation imports.
        const geometry = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
        const json = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
          materials: [{ pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 } }],
          buffers: [{ byteLength: geometry.byteLength }], bufferViews: [{ buffer: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 }],
          accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
            { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" }] };
        const encoded = new TextEncoder().encode(JSON.stringify(json)), jsonLength = (encoded.length + 3) & ~3;
        const glb = new ArrayBuffer(12 + 8 + jsonLength + 8 + geometry.byteLength), header = new DataView(glb);
        [0x46546c67, 2, glb.byteLength, jsonLength, 0x4e4f534a].forEach((value, index) => header.setUint32(index * 4, value, true));
        new Uint8Array(glb, 20, jsonLength).fill(32); new Uint8Array(glb, 20, encoded.length).set(encoded);
        header.setUint32(20 + jsonLength, geometry.byteLength, true); header.setUint32(24 + jsonLength, 0x004e4942, true);
        new Float32Array(glb, 28 + jsonLength).set(geometry);
        const asset = await loadSpatialGlb(glb, { materialProfile: "diffuse" });
        stage = "dynamic spatial box model full pose matrix";
        let latest, modelHandle; const modelCost = cost();
        const m = await createEngine(frame => {
          recordCost(modelCost, frame);
          // Render views are borrowed: copy before querying native state.
          const model = frame.renderCommandBuffer.spatial?.models;
          if (model) latest = { matrix: [...model.values.slice(4, 20)], stride: model.stride,
            body: states(m, [modelHandle]), time: m.time(), steps: frame.physics.fixedSteps };
        }, undefined, undefined, () => ({ width: 320, height: 180 })); engines.push(m);
        if (!m.registerDataSceneSpatialModel("triangle", asset)) throw new Error("Model resource registration failed");
        const rotation = [Math.sin(0.31), 0, 0, Math.cos(0.31)];
        const modelDoc = document([object("box", 3, -4, { collider: "none", body: { kind: "dynamic", elevation: 5,
          rotation, renderOffset: [0.5, -0.25, 0.75], linearVelocity: [1, 0.2, -0.3], angularVelocity: [0.3, 0.4, 0.2], canSleep: false,
          collider: { shape: { type: "box", halfExtents: [0.5, 0.75, 1] } } } })]);
        modelDoc.sceneComposition.fragments.main.instances[0].scale = 1.25;
        modelDoc.physics = { space: "spatial", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: 0.01 };
        modelDoc.spatial = { camera: { projection: "orthographic", position: { x: 12, y: -20, elevation: 18 },
          target: { x: 3, y: -4, elevation: 5 }, height: 30 }, terrain: [], billboards: {},
          models: { box: { asset: "triangle", contentId: asset.contentId, elevation: 1.5, yawDegrees: 37, scale: 1.4 } } };
        modelHandle = applyDataSceneAuthoringDocument(m, modelDoc, { textureId: () => 11 }).entityHandles.box;
        m.configureAutoRigidBodyStep(false); tick(m); const initialModel = latest;
        for (let step = 0; step < 12; step++) m.stepRigidBodies(Math.fround(0.01));
        tick(m); const advancedModel = latest;
        modelCheckpoint = m.captureRuntimeCheckpoint();
        const teleport = new Float32Array([8, 9, -6, 0, Math.sin(0.19), Math.sin(0.27) * Math.cos(0.19), Math.cos(0.27) * Math.cos(0.19)]);
        // Normalize a quaternion with both pitch/roll and yaw, independently of
        // the simulation's current quaternion and authored local model yaw.
        const norm = Math.hypot(...teleport.slice(3)); for (let i = 3; i < 7; i++) teleport[i] /= norm;
        m.setUnifiedPhysicsPoses(ids([modelHandle]), teleport); tick(m); const teleportedModel = latest;
        m.restoreRuntimeCheckpoint(modelCheckpoint); tick(m); const restoredModel = latest;
        modelCheckpoint.dispose(); modelCheckpoint = undefined;
        const models = { initial: initialModel, advanced: advancedModel, teleported: teleportedModel, restored: restoredModel,
          renderOffset: [0.5 * 1.25, -0.25 * 1.25, 0.75 * 1.25], elevation: 1.5, yawRadians: 37 * Math.PI / 180,
          scale: 1.4, triangles: asset.triangleCount, contentId: asset.contentId, cost: modelCost };
        return { spec, scene, builtInSwitch, models, layout: { position: L.position, rotation: L.rotation, stride: L.stride } };
      } catch (error) { throw new Error(`Aggregate native authoring [${stage}]: ${error instanceof Error ? error.message : String(error)}`); }
      finally {
        specCheckpoint?.dispose(); sceneCheckpoint?.dispose(); modelCheckpoint?.dispose();
        for (const engine of engines) engine.destroy(); pending.clear();
        window.requestAnimationFrame = originalRaf; window.cancelAnimationFrame = originalCancel;
      }
    });
    report.result = result;
    const { spec, scene, builtInSwitch, models, layout: L } = result;
    for (const group of [spec, scene, models]) {
      assert(group.cost.frames > 0 && group.cost.nativeFrames === group.cost.frames && group.cost.fixed);
      assert(Number.isFinite(group.cost.maxRustMs) && group.cost.maxRustMs >= 0);
    }
    for (const [name, group] of [["Physics Spec", spec], ["Scene JSON", scene]]) {
      assert.deepEqual(group.replayed, group.expected, `${name}: same-engine checkpoint replay must match body words/floats and height span`);
      assert.deepEqual(group.retained, group.before, `${name}: failed replacement must retain actual bodies, time and scene state`);
      assert(group.before.time > 0, `${name}: rollback must preserve an advanced clock`);
      assert.equal(group.before.state, "paused", `${name}: rejection must retain the previous paused Data Scene`);
      assert.equal(group.expected[0].floats[L.position], 15, `${name}: authored controller must climb the stair`);
      assert.equal(group.expected[0].span.elevation, 3);
      assert.equal(group.expected[1].floats[L.position], 25, `${name}: authored controller must permit the drop`);
      assert.equal(group.expected[1].span.elevation, 0);
    }
    assert.match(spec.invalidMessage ?? "", /physics capacity exceeded/i, "Physics Spec: real invalid fixture batch must reject at collider admission");
    assert(spec.clearedHandleRejected && spec.entitiesAfterClear === 0, "Physics Spec: the retained old clear() must remain effective and idempotent");
    assert.match(spec.crossEngine.message ?? "", /same Engine/i);
    assert.deepEqual(spec.crossEngine.retained, spec.crossEngine.before, "Cross-Engine replacement must preserve both owners' actual bodies and clocks");
    assert(spec.crossEngine.before.a.time > 0 && spec.crossEngine.before.b.time > 0);
    assert.match(scene.capacityMessage ?? "", /physics capacity exceeded/i, "Scene JSON: aggregate native capacity must reject the mixed batch");
    assert.equal(scene.spatialLegacyMessages.length, 3);
    assert(scene.spatialLegacyMessages.every(Boolean), "Scene JSON: spatial worlds must reject collider-only, static and kinematic legacy geometry");
    assert.deepEqual(scene.afterSpatialRejection, scene.before);
    assert.equal(scene.candidateRegistered, false); assert.equal(scene.before.count, 5); assert.equal(scene.before.joints, 1);
    assert.equal(scene.before.retainedVariable, 37);
    assert.equal(scene.continuation.floats[L.position], 15); assert.equal(scene.continuation.span.elevation, 3);
    assert(scene.expected[3].floats[L.position] > 43 && scene.expected[3].floats[L.position] < 45,
      "Scene JSON: wall mask must stop the controller after the category-16 obstacle was ignored");
    assert.equal(builtInSwitch.backendBefore, "unified-3d"); assert.equal(builtInSwitch.paddleBefore.count, 1);
    assert.equal(builtInSwitch.backendAfter, "legacy"); assert.equal(builtInSwitch.entities, 1); assert.equal(builtInSwitch.oldPaddleRetained, false);
    assert.equal(builtInSwitch.before.x, 3); assert.equal(builtInSwitch.before.y, 4);
    assert(Math.abs(builtInSwitch.after.x - 3.01) < 0.00001 && builtInSwitch.after.y === 4,
      "Ordinary Data Scene must remain usable after the previous native built-in world is discarded");
    assert.equal(models.triangles, 1);
    for (const [name, sample] of Object.entries({ initial: models.initial, advanced: models.advanced, teleported: models.teleported, restored: models.restored })) {
      assert(sample, `${name}: native model must submit its existing command matrix`); assert.equal(sample.stride, 20);
      const body = sample.body.floats, p = body.slice(L.position, L.position + 3), q = body.slice(L.rotation, L.rotation + 4);
      const [x, y, z, w] = q, sn = Math.sin(models.yawRadians / 2), cs = Math.cos(models.yawRadians / 2);
      const a = x * cs - z * sn, b = w * sn + y * cs, c = x * sn + z * cs, d = w * cs - y * sn;
      const scale = models.scale;
      const expected = [(1 - 2 * (b * b + c * c)) * scale, 2 * (a * b + c * d) * scale, 2 * (a * c - b * d) * scale, 0,
        2 * (a * b - c * d) * scale, (1 - 2 * (a * a + c * c)) * scale, 2 * (b * c + a * d) * scale, 0,
        2 * (a * c + b * d) * scale, 2 * (b * c - a * d) * scale, (1 - 2 * (a * a + b * b)) * scale, 0,
        p[0] + models.renderOffset[0], p[1] + models.renderOffset[1] + models.elevation, p[2] + models.renderOffset[2], 1];
      const maxError = Math.max(...expected.map((value, index) => Math.abs(value - sample.matrix[index])));
      assert(maxError < 0.00002, `${name}: full quaternion × local yaw, world offset, elevation and uniform scale mismatch (${maxError})`);
      sample.maxAnalyticMatrixError = maxError;
    }
    assert(models.advanced.body.floats[L.position] > models.initial.body.floats[L.position] + 0.1);
    assert.deepEqual(models.restored.body, models.advanced.body); assert.deepEqual(models.restored.matrix, models.advanced.matrix);
    assert(Math.abs(models.teleported.body.floats[L.position] - 8) < 0.00001);
    report.status = "passed";
    return result;
  } catch (error) { report.status = "failed"; report.error = String(error); throw error; }
  finally { await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n"); }
}
