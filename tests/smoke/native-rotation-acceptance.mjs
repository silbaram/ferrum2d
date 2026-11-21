import assert from "node:assert/strict";

/** Public swept queries have a fixed orientation. Test angular CCD on the live solver separately. */
export async function probeNativeRotationAcceptance(page) {
  const results = await page.evaluate(async () => {
    const {
      createEngine, createUnifiedPhysicsQueryBatch, UNIFIED_PHYSICS_QUERY_LAYOUT: Q,
      UNIFIED_PHYSICS_STATE_LAYOUT: S, UNIFIED_PHYSICS_OBSERVATION_LAYOUT: O,
    } = await import("@ferrum2d/ferrum-web/core");
    const dt = Math.fround(0.1);
    const rotationZ = angle => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
    const box = (x, y, z) => ({ type: "box", halfExtents: [x, y, z] });
    const sphere = radius => ({ type: "sphere", radius });
    const capsule = (halfHeight, radius) => ({ type: "capsule", halfHeight, radius });
    const hull = (x, y, z) => ({
      type: "convexHull",
      points: [-x, x].flatMap(a => [-y, y].flatMap(b => [-z, z].map(c => [a, b, c]))),
    });
    async function world(space) {
      const engine = await createEngine();
      engine.useDataScene();
      engine.configureUnifiedPhysics({ space, gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: dt, continuous: true });
      return engine;
    }

    // Every admissible query shape sweeps against each collider shape through the public batch.
    const probes = [box(0.09, 0.13, 0.08), sphere(0.1), capsule(0.09, 0.08), hull(0.09, 0.13, 0.08)];
    const targets = [box(1, 0.1, 1), sphere(0.5), capsule(0.35, 0.2), hull(1, 0.1, 1),
      { type: "triangleMesh", vertices: [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], triangles: [0, 2, 1, 0, 3, 2] },
      { type: "heightfield", rows: 2, columns: 2, heights: [0, 0, 0, 0], size: [2, 2] },
      { type: "compound", parts: [{ shape: box(1, 0.1, 1) }] },
    ];
    const sweeps = [];
    const queryEngine = await world("spatial");
    try {
      for (const target of targets) {
        const fixed = queryEngine.spawnUnifiedPhysicsBody({ kind: "fixed", collider: { shape: target } });
        const query = (shape, length) => ({
          type: "sweep", shape, pose: { position: [0, 2, 0], rotation: rotationZ(0.31) }, translation: [0, -length, 0],
        });
        const hits = request => {
          const v = queryEngine.queryUnifiedPhysics(createUnifiedPhysicsQueryBatch(request));
          return request.map((_, i) => {
            const s = i * Q.summaryStride;
            const row = v.summaries[s + Q.summaryOffset] * Q.hitStride;
            return {
              count: v.summaries[s + Q.summaryCount], truncated: v.summaries[s + Q.summaryFlags],
              fraction: v.floats[row + Q.value], entity: v.words[row + Q.entity],
              generation: v.words[row + Q.entity + 1],
            };
          });
        };
        const full = hits(probes.map(shape => query(shape, 4)));
        for (const [i, hit] of full.entries()) {
          if (hit.count !== 1 || hit.entity !== fixed.entityId || hit.generation !== fixed.entityGeneration || !(hit.fraction > 0 && hit.fraction < 1)) {
            throw new Error(`Missing sweep witness for ${probes[i].type}/${target.type}: ${JSON.stringify(hit)}`);
          }
          const distance = 4 * hit.fraction;
          const [short, past] = hits([query(probes[i], distance - 0.002), query(probes[i], distance + 0.002)]);
          if (hit.truncated || short.truncated || past.truncated || short.count || past.count !== 1 || past.entity !== fixed.entityId || past.generation !== fixed.entityGeneration) {
            throw new Error(`Sweep contact boundary differs for ${probes[i].type}/${target.type}: ${JSON.stringify({hit,short,past})}`);
          }
          sweeps.push({ origin: probes[i].type, target: target.type, fraction: hit.fraction, boundaryDistance: 0.002 });
        }
        queryEngine.removeUnifiedPhysicsBody(fixed);
      }
    } finally { queryEngine.destroy(); }

    const components = [
      { shape: box(2, 0.025, 0.1), target: sphere(0.015), axis: 0, extent: 2, targetExtent: 0.015 },
      { shape: capsule(1.85, 0.15), target: box(0.015, 0.015, 0.015), axis: 1, extent: 2, targetExtent: 0.015 },
      { shape: hull(2, 0.025, 0.1), target: capsule(0.012, 0.015), axis: 0, extent: 2, targetExtent: 0.015 },
      { shape: sphere(0.05), local: [2, 0, 0], target: sphere(0.015), axis: 0, extent: 2.05, targetExtent: 0.015 },
      { shape: { type: "compound", parts: [-1.95, 1.95].map(x => ({ shape: sphere(0.05), pose: { position: [x, 0, 0] } })) },
        target: sphere(0.015), axis: 0, extent: 2, targetExtent: 0.015 },
    ];
    const cases = [];
    const failures = [];
    async function spin(spec, space, sign, translate) {
      const engine = await world(space);
      const key = `${space}/${spec.shape.type}/${spec.target.type}/${sign}/${translate}`;
      let phase = "initialize";
      try {
        const tangent = 1 - spec.axis;
        const start = [0, 0, 0];
        const velocity = [0, 0, 0];
        if (translate) {
          start[tangent] = -0.05;
          velocity[tangent] = 1;
        }
        const moving = engine.spawnUnifiedPhysicsBody({
          kind: "dynamic", canSleep: false, ccd: true, pose: { position: start, rotation: rotationZ(-sign * Math.PI / 8) },
          angularVelocity: [0, 0, sign * Math.PI / (4 * dt)], linearVelocity: velocity,
          collider: { shape: spec.shape, pose: { position: spec.local ?? [0, 0, 0] } },
        });
        // An offset sphere sweeps an arc when the main mass is at the pivot.
        if (spec.local) engine.addUnifiedPhysicsCollider(moving, { shape: sphere(0.25), density: 1000 });
        const ids = new Uint32Array([moving.entityId, moving.entityGeneration]);
        function readState() {
          const view = engine.queryUnifiedPhysicsBodyStates(ids);
          if (view.count !== 1 || view.words[S.entityId] !== moving.entityId || view.words[S.entityGeneration] !== moving.entityGeneration) {
            throw new Error("Missing rotating body state");
          }
          return { bits: Array.from(view.words), pose: Array.from(view.floats.slice(S.position, S.rotation + 4)) };
        }
        const fresh = engine.captureRuntimeCheckpoint();
        try {
          phase = "free tick";
          engine.stepRigidBodies(dt);
          const { bits: free, pose: freePose } = readState();
          if (!(sign * freePose[5] > 0)) throw new Error("free rotation did not pass the center");
          for (const contact of [true, false]) {
            phase = contact ? "prepare hit" : "prepare miss";
            engine.restoreRuntimeCheckpoint(fresh);
            const startPose = readState().pose;
            const center = [0, 0, 0];
            center[spec.axis] = spec.extent + spec.targetExtent + (contact ? -0.025 : 0.006);
            const fixed = engine.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: center }, collider: { shape: spec.target } });
            const pointQuery = createUnifiedPhysicsQueryBatch([{
              type: "overlap", shape: spec.target, pose: { position: center }, filter: { excludeBody: fixed },
            }]);
            const checkpoint = engine.captureRuntimeCheckpoint();
            try {
              const intersections = [];
              for (const bodyPose of [startPose, [0, 0, 0, 0, 0, 0, 1], freePose]) {
                engine.setUnifiedPhysicsPoses(ids, new Float32Array(bodyPose));
                const v = engine.queryUnifiedPhysics(pointQuery);
                if (v.hitCount && (v.words[Q.entity] !== moving.entityId || v.words[Q.entity + 1] !== moving.entityGeneration)) {
                  throw new Error("Wrong overlap participant");
                }
                intersections.push(v.hitCount);
              }
              if (intersections[0] !== 0 || intersections[1] !== Number(contact) || intersections[2] !== 0) {
                throw new Error("Wrong start/middle/end geometry: " + intersections);
              }

              const step = () => {
                phase = contact ? "step hit" : "step miss";
                engine.restoreRuntimeCheckpoint(checkpoint);
                engine.stepRigidBodies(dt);
                const { bits } = readState();
                const { ccd, diagnostics } = engine.queryUnifiedPhysicsObservations();
                const words = Array.from(ccd.words);
                const frame = diagnostics.frame;
                if (frame.backendSteps !== 1 || frame.kinematicPathFailures || frame.characterPreviewObstacleFailures || frame.ccdClampsDropped) {
                  throw new Error("Step diagnostics: " + JSON.stringify(frame));
                }
                if (ccd.count !== Number(contact) || frame.ccdClamps !== ccd.count) {
                  throw new Error("Angular CCD clamps: " + JSON.stringify({ contact, frame }));
                }
                let fraction;
                if (contact) {
                  fraction = ccd.floats[O.fraction];
                  if (!(fraction > 0 && fraction < 1 && frame.ccdClampChecks > 0)) throw new Error("invalid CCD time: "+fraction);
                  for (const [offset, body] of [[O.first, moving], [O.second, fixed]]) {
                    if (words[offset + O.entity] !== body.entityId || words[offset + O.entity + 1] !== body.entityGeneration) {
                      throw new Error("Wrong clamp participant");
                    }
                  }
                }
                const matchesFree = bits.every((word, i) => word === free[i]);
                if (matchesFree === contact) throw new Error("unexpected final body state relative to free motion");
                return { bits, words, frame, fraction };
              };
              const first = step();
              const replay = step();
              if (JSON.stringify(first) !== JSON.stringify(replay)) throw new Error("checkpoint replay differs");
              cases.push({ space, moving: spec.shape.type, target: spec.target.type, sign, translate, contact,
                intersections, ccdClamps: first.frame.ccdClamps, clampChecks: first.frame.ccdClampChecks, fraction: first.fraction, exactReplay: true });
            } catch (error) {
              failures.push({ key, contact, phase, error: String(error) });
            } finally {
              checkpoint.dispose();
            }
          }
        } finally { fresh.dispose(); }
      } catch (error) {
        throw new Error(key + " " + phase + ": " + String(error));
      } finally {
        engine.destroy();
      }
    }
    for (const [space, specs] of [["spatial", components], ["planar-xy", [components[0]]]]) {
      for (const spec of specs) {
        for (const sign of [-1, 1]) {
          for (const translate of [false, true]) await spin(spec, space, sign, translate);
        }
      }
    }
    // Manual steps share a frame, so frame.backendSteps accumulates while step.backendSteps stays one.
    // Spawn all moving bodies first, as in the original one- and two-pair reproductions.
    const consecutive = [], consecutiveFailures = [];
    for (const pairs of [1, 2]) {
      const engine = await world("spatial");
      let checkpoint, phase = "setup", tick = 0;
      try {
        const moving = [], fixed = [];
        for (let i = 0; i < pairs; i++) {
          moving.push(engine.spawnUnifiedPhysicsBody({
            kind: "dynamic", canSleep: false, ccd: true,
            pose: { position: [0, 0, 5 * i], rotation: rotationZ(-Math.PI / 8) },
            angularVelocity: [0, 0, Math.PI / (4 * dt)], collider: { shape: box(2, .025, .1) },
          }));
        }
        for (let i = 0; i < pairs; i++) {
          fixed.push(engine.spawnUnifiedPhysicsBody({
            kind: "fixed", pose: { position: [1.99, 0, 5 * i] }, collider: { shape: sphere(.015) },
          }));
        }
        const entities = [...moving, ...fixed];
        const handles = new Uint32Array(entities.flatMap(body => [body.entityId, body.entityGeneration]));
        function readBodies() {
          const view = engine.queryUnifiedPhysicsBodyStates(handles);
          if (view.count !== entities.length) throw new Error("missing participants");
          for (const [i, handle] of entities.entries()) {
            const offset = i * S.stride;
            const pose = view.floats.subarray(offset + S.position, offset + S.rotation + 4);
            if (view.words[offset + S.entityId] !== handle.entityId ||
                view.words[offset + S.entityGeneration] !== handle.entityGeneration || !pose.every(Number.isFinite)) {
              throw new Error("invalid body identity or pose");
            }
          }
          return Array.from(view.words);
        }
        const initial = readBodies();
        const snapshots = [], ticks = [];
        checkpoint = engine.captureRuntimeCheckpoint();
        for (phase of ["original", "checkpoint replay"]) {
          if (phase === "checkpoint replay") {
            engine.restoreRuntimeCheckpoint(checkpoint);
            if (JSON.stringify(readBodies()) !== JSON.stringify(initial)) throw new Error("initial body words changed");
          }
          for (tick = 1; tick <= 32; tick++) {
            engine.stepRigidBodies(dt);
            const body = readBodies();
            const { ccd, impulses, diagnostics } = engine.queryUnifiedPhysicsObservations();
            if (diagnostics.fixedSteps !== tick || diagnostics.frame.backendSteps !== tick || diagnostics.step.backendSteps !== 1 ||
                diagnostics.ccdObservationsDropped || diagnostics.impulsesDropped) {
              throw new Error("tick did not complete cleanly " + JSON.stringify(diagnostics));
            }
            if (tick === 1) {
              const contacts = new Set();
              for (let row = 0; row < ccd.count; row++) {
                const offset = row * ccd.stride, first = offset + O.first + O.entity, second = offset + O.second + O.entity;
                const i = moving.findIndex(h => h.entityId === ccd.words[first] && h.entityGeneration === ccd.words[first + 1]);
                const fraction = ccd.floats[offset + O.fraction];
                if (i < 0 || fixed[i].entityId !== ccd.words[second] || fixed[i].entityGeneration !== ccd.words[second + 1] ||
                    !(fraction > 0 && fraction < 1)) throw new Error("unexpected first-tick angular CCD participant or time");
                contacts.add(i);
              }
              if (contacts.size !== pairs || ccd.count !== pairs) throw new Error("incomplete first-tick angular contacts");
            }
            const observation = JSON.stringify({ body, ccd: Array.from(ccd.words), impulses: Array.from(impulses.words), diagnostics });
            if (phase === "original") {
              snapshots.push(observation);
              ticks.push({ tick, fixedSteps: diagnostics.fixedSteps, frameSteps: diagnostics.frame.backendSteps,
                stepClamps: diagnostics.step.ccdClamps, ccdRows: ccd.count, impulseRows: impulses.count });
            } else if (observation !== snapshots[tick - 1]) {
              throw new Error("body words, CCD, impulses or diagnostics differ from original");
            }
          }
        }
        consecutive.push({ pairs, ticks, exactReplay: true });
      } catch (error) {
        consecutiveFailures.push({ pairs, phase, tick, error: String(error) });
      } finally {
        checkpoint?.dispose();
        engine.destroy();
      }
    }
    return { sweeps, cases, failures, consecutive, consecutiveFailures };
  });
  assert.equal(results.sweeps.length, 28);
  assert.deepEqual([...results.failures, ...results.consecutiveFailures], [], JSON.stringify({
    passed: results.cases.length, singleStepFailures: results.failures, consecutiveFailures: results.consecutiveFailures,
  }));
  assert.equal(results.consecutive.length, 2);
  assert.equal(results.cases.length, 48);
  return results;
}
