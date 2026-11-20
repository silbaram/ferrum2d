import assert from "node:assert/strict";

export async function probeNativePhysicsDebug(page) {
  const r = await page.evaluate(async () => {
    const { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT: B } = await import("@ferrum2d/ferrum-web/core");
    const originalRaf = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
    const pending = new Map(), live = new Set();
    let next = 0, timestamp = 0, checkpoint, stage = "planar setup";
    window.requestAnimationFrame = callback => { const id = ++next; pending.set(id, callback); return id; };
    window.cancelAnimationFrame = id => { pending.delete(id); };
    const pump = delta => {
      timestamp += delta;
      const callbacks = [...pending.values()]; pending.clear();
      if (callbacks.length !== 1) throw new Error(`Expected one native-debug RAF, got ${callbacks.length}`);
      callbacks[0](timestamp);
    };
    const create = async space => {
      let sample, borrowedLines, started = false, maxRustMs = 0;
      const e = await createEngine(frame => {
        borrowedLines = frame.physicsDebugLineBuffer.buffer;
        maxRustMs = Math.max(maxRustMs, frame.rustUpdateTimeMs);
        sample = { state: frame.gameState, entities: frame.entityCount, renders: frame.renderCommandBuffer.commandCount,
          nativeSteps: frame.unifiedPhysics?.frame.backendSteps, backend: frame.unifiedPhysics?.backend,
          debug: frame.unifiedPhysics?.debug && { ...frame.unifiedPhysics.debug },
          lineCount: frame.physicsDebugLineBuffer.lineCount, stride: frame.physicsDebugLineBuffer.floatsPerLine,
          lines: [...borrowedLines], decodedCount: frame.physicsDebugLines.length,
          spatial: frame.renderCommandBuffer.spatial !== undefined };
      }, undefined, undefined, () => ({ width: 1200, height: 640 }), {
        includePhysicsDebugLines: true, enablePhysicsDebugLines: { colliders: true },
      });
      live.add(e); e.useDataScene();
      e.configureUnifiedPhysics({ space, gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: 0.01, continuous: false });
      e.configureAutoRigidBodyStep(false); e.setPhysicsDebugOptions({ colliders: true });
      return { e, run: () => {
        sample = undefined;
        if (started) e.resume(); else { e.start(); started = true; }
        pump(100); pump(10); e.pause();
        if (!sample) throw new Error("Expected native-debug frame");
        const queried = e.queryUnifiedPhysicsDiagnostics();
        return { ...sample, queriedDebug: queried?.debug && { ...queried.debug } };
      }, borrowedLines: () => borrowedLines, maxRustMs: () => maxRustMs,
      destroy: () => { e.destroy(); live.delete(e); } };
    };
    const ids = h => new Uint32Array([h.entityId, h.entityGeneration]);
    const state = (e, h) => [...e.queryUnifiedPhysicsBodyStates(ids(h)).floats];
    const settings = enabled => ({ kind: "fixed", enabled, gravityScale: 1, linearDamping: 0,
      angularDamping: 0, canSleep: true, ccd: false, lockRotation: false });
    const q90 = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
    const compact = frame => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < frame.lines.length; i += frame.stride) {
        for (const j of [0, 2]) {
          minX = Math.min(minX, frame.lines[i + j]); maxX = Math.max(maxX, frame.lines[i + j]);
          minY = Math.min(minY, frame.lines[i + j + 1]); maxY = Math.max(maxY, frame.lines[i + j + 1]);
        }
      }
      const { lines, ...rest } = frame;
      return { ...rest, bounds: [minX, minY, maxX, maxY], finite: lines.every(Number.isFinite),
        first: lines.slice(0, 24), last: lines.slice(-8) };
    };
    try {
      const h = await create("planar-xy"), e = h.e;
      stage = "planar rotated box creation";
      const box = e.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [10, 20, 0], rotation: q90 },
        renderOffset: [100, 200, 0], collider: { shape: { type: "box", halfExtents: [2, 1, 0.5] },
          pose: { position: [3, 0, 0], rotation: q90 } } });
      const initial = h.run(), initialBody = state(e, box), fixture = e.queryUnifiedPhysicsColliders(box)[0];
      if (!fixture) throw new Error("Expected actual native box fixture");
      e.setUnifiedPhysicsPoses(ids(box), new Float32Array([30, 40, 0, 0, 0, 0, 1]));
      const teleported = h.run(), teleportedBody = state(e, box);
      stage = "planar collider replacement";
      e.updateUnifiedPhysicsCollider(box, fixture, { shape: { type: "sphere", radius: 0.75 },
        pose: { position: [1, 2, 0] }, sensor: true });
      const updated = h.run();
      e.setUnifiedPhysicsBodyOptions(box, settings(false)); const disabled = h.run();
      e.removeUnifiedPhysicsBody(box); const deleted = h.run();
      const replacement = e.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [-10, -20, 0] },
        collider: { shape: { type: "box", halfExtents: [1, 2, 0.5] } } });
      let staleError;
      try { e.removeUnifiedPhysicsBody(box); } catch (error) { staleError = String(error); }
      const replaced = h.run();
      e.removeUnifiedPhysicsBody(replacement);

      stage = "queued force and checkpoint replay";
      const dynamic = e.spawnUnifiedPhysicsBody({ pose: { position: [0, 0, 0] }, canSleep: false,
        collider: { shape: { type: "sphere", radius: 0.25 }, density: 0 } });
      e.setUnifiedPhysicsMassProperties(dynamic, { mass: 1, principalInertia: [1, 1, 1], center: [0, 0, 0], inertiaRotation: [0, 0, 0, 1] });
      e.addUnifiedPhysicsForces(ids(dynamic), new Float32Array([10, 0, 0, 0, 0, 0]));
      const forceBefore = state(e, dynamic), forceDebugA = h.run(), forceDebugB = h.run(), forceAfterDebug = state(e, dynamic);
      checkpoint = e.captureRuntimeCheckpoint();
      const future = () => { e.stepRigidBodies(Math.fround(0.01)); return { frame: h.run(), body: state(e, dynamic) }; };
      const expected = future(); e.restoreRuntimeCheckpoint(checkpoint); const replayed = future();
      checkpoint.dispose(); checkpoint = undefined;

      // Test-only memory fault injection into the same packed Wasm module used
      // by core.js. Scene setup, debug extraction and queries use public SDK APIs.
      const { wasm_memory } = await import("/package/pkg/ferrum_core.js");
      const memory = wasm_memory(), borrowed = h.borrowedLines();
      const bytesBefore = memory.buffer.byteLength, borrowedBefore = borrowed.byteLength;
      const ownedDebug = e.queryUnifiedPhysicsDiagnostics().debug, ownedDebugCopy = { ...ownedDebug };
      memory.grow(1);
      const growth = { bytesBefore, bytesAfter: memory.buffer.byteLength, borrowedBefore,
        borrowedAfter: borrowed.byteLength, ownedDebug, ownedDebugCopy, access: "test-only packed Wasm memory.grow" };
      const afterGrowth = h.run();
      e.setPhysicsDebugLinesEnabled(false);
      const immediateDisabled = e.queryUnifiedPhysicsDiagnostics().debug;
      const cleared = h.run();
      const planar = { initial, initialBody, teleported, teleportedBody, updated, disabled, deleted, replaced,
        oldHandle: box, replacement, staleError, oldLive: e.gameplayEntityExists(box), forceBefore, forceDebugA, forceDebugB,
        forceAfterDebug, expected, replayed, growth, afterGrowth, immediateDisabled, cleared, maxRustMs: h.maxRustMs() };
      h.destroy();

      const s = await create("spatial"), se = s.e;
      const shapes = [
        { type: "box", halfExtents: [1, 2, 3] },
        { type: "sphere", radius: 0.75 },
        { type: "capsule", halfHeight: 2, radius: 0.5 },
        { type: "convexHull", points: [[-1, 0, -2], [2, 0, -2], [0, 3, 4], [0, -2, 0]] },
        { type: "triangleMesh", vertices: [-2, 0, -3, 4, 0, -3, 0, 5, 6], triangles: [0, 1, 2] },
        { type: "heightfield", rows: 2, columns: 2, heights: [0, 1, 2, 3], size: [8, 10] },
        { type: "compound", parts: [
          { pose: { position: [3, 0, 2] }, shape: { type: "box", halfExtents: [1, 2, 3] } },
          { pose: { position: [-2, 0, -4] }, shape: { type: "sphere", radius: 0.5 } },
        ] },
      ];
      const shapeFrames = [];
      for (const shape of shapes) {
        stage = `spatial ${shape.type} creation and extraction`;
        const body = se.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [10, 200, 30] }, renderOffset: [100, 300, 1000], collider: { shape } });
        shapeFrames.push({ type: shape.type, frame: s.run() }); se.removeUnifiedPhysicsBody(body);
      }
      const triangleCount = 6000, vertices = new Float32Array(triangleCount * 9), triangles = new Uint32Array(triangleCount * 3);
      for (let i = 0; i < triangleCount; i++) {
        // Keep every vertex inside the native +/-10,000 geometry limit.
        // Distinct triangles still request 18,000 wire edges from the extractor.
        vertices.set([i * 1.5, 0, 0, i * 1.5 + 1, 0, 0, i * 1.5, 0, 1], i * 9);
        triangles.set([i * 3, i * 3 + 1, i * 3 + 2], i * 3);
      }
      stage = "spatial 6000-triangle cap fixture";
      const mesh = se.spawnUnifiedPhysicsBody({ kind: "fixed", collider: { shape: { type: "triangleMesh", vertices, triangles } } });
      const capped = compact(s.run()); se.removeUnifiedPhysicsBody(mesh);
      const afterCapRemoval = s.run();
      const spatial = { shapes: shapeFrames, triangleCount, capped, afterCapRemoval, maxRustMs: s.maxRustMs() }; s.destroy();

      const kinds = [
        { type: "fixed" }, { type: "spherical" }, { type: "revolute", limits: [-0.5, 0.5] },
        { type: "prismatic", limits: [-1, 2] }, { type: "distance", length: 2 }, { type: "rope", maxLength: 2 },
        { type: "frequencySpring", restLength: 2, frequencyHz: 2, dampingRatio: 1 },
        { type: "accelerationSpring", restLength: 2, stiffness: 10, damping: 2 },
        { type: "spring", restLength: 2, stiffness: 10, damping: 2 },
        { type: "elasticRope", maxLength: 2, spring: { stiffness: 10, damping: 2 } },
        { type: "pulley", groundA: [-8, 30, 4], groundB: [10, 30, 12], length: 30, ratio: 1 },
        { type: "gear", ratio: 2, referenceAngle: 0 }, { type: "continuousRevolute", limits: [-20, 20] },
      ];
      const joints = [];
      for (const space of ["spatial", "planar-xy"]) {
        const j = await create(space), je = j.e;
        je.setPhysicsDebugOptions({ joints: true });
        for (const kind of kinds.filter(k => (["gear", "continuousRevolute"].includes(k.type)) === (space === "planar-xy"))) {
          stage = `${space} ${kind.type} joint creation and extraction`;
          const planar = space === "planar-xy", sphere = { shape: { type: "sphere", radius: 0.1 } };
          const a = je.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [-4, 10, planar ? 0 : 2], rotation: q90 }, collider: sphere });
          const b = je.spawnUnifiedPhysicsBody({ pose: { position: [6, 20, planar ? 0 : 8] }, collider: sphere });
          const rotation = kind.type === "continuousRevolute" ? [0, -Math.SQRT1_2, 0, Math.SQRT1_2] : [0, 0, 0, 1];
          const options = { bodyA: a, bodyB: b, kind,
            localFrameA: { position: [1, 2, planar ? 0 : 3], rotation },
            localFrameB: { position: [-2, 1, planar ? 0 : -1], rotation } };
          const joint = je.createUnifiedPhysicsJoint(options), frame = j.run();
          let disabledFrame;
          if (kind.type === "fixed") {
            je.updateUnifiedPhysicsJoint(joint, { ...options, enabled: false }); disabledFrame = j.run();
          }
          je.removeUnifiedPhysicsJoint(joint);
          const removed = j.run();
          joints.push({ type: kind.type, space, frame, disabledFrame, removed });
          je.removeUnifiedPhysicsBody(a); je.removeUnifiedPhysicsBody(b);
        }
        joints.push({ space, maxRustMs: j.maxRustMs() }); j.destroy();
      }
      return { planar, spatial, joints, position: B.position, velocity: B.linearVelocity };
    } catch (error) {
      throw new Error(`Native debug probe at ${stage}: ${String(error)}`);
    } finally {
      checkpoint?.dispose(); for (const e of live) e.destroy(); pending.clear();
      window.requestAnimationFrame = originalRaf; window.cancelAnimationFrame = originalCancel;
    }
  });
  const p = r.planar, near = (a, b, label, tolerance = 0.002) => assert(Math.abs(a - b) < tolerance, `${label}: ${a} vs ${b}`);
  const geometry = frame => {
    assert.equal(frame.state, 1); assert.equal(frame.backend, "rapier3d"); assert.equal(frame.nativeSteps, 0);
    assert.equal(frame.renders, 0); assert.equal(frame.stride, 8); assert.equal(frame.lines.length, frame.lineCount * 8);
    assert.equal(frame.decodedCount, frame.lineCount); assert(frame.lines.every(Number.isFinite)); assert.equal(frame.spatial, false);
    assert(frame.debug); assert.deepEqual(frame.queriedDebug, frame.debug);
    assert.equal(frame.debug.lineCount, frame.lineCount); assert(frame.debug.workUnits >= frame.lineCount && frame.debug.workUnits <= 65536);
    assert.equal(frame.debug.unsupportedShapes, 0); assert.equal(frame.debug.rejected, false); assert.equal(frame.debug.truncated, false);
  };
  const bounds = (frame, expected, label) => {
    const x = [], y = [];
    for (let i = 0; i < frame.lines.length; i += 8) { x.push(frame.lines[i], frame.lines[i + 2]); y.push(frame.lines[i + 1], frame.lines[i + 3]); }
    const actual = [Math.min(...x), Math.min(...y), Math.max(...x), Math.max(...y)];
    actual.forEach((value, i) => near(value, expected[i], `${label}[${i}]`));
  };
  const color = (frame, expected) => {
    for (let i = 0; i < frame.lines.length; i += 8) expected.forEach((value, k) => near(frame.lines[i + 4 + k], value, "native style", 1e-5));
  };
  const hasLine = (frame, a, b) => {
    const close = (offset, from, to) => [from[0], from[1], to[0], to[1]].every((value, i) => Math.abs(frame.lines[offset + i] - value) < 0.002);
    for (let i = 0; i < frame.lines.length; i += 8) if (close(i, a, b) || close(i, b, a)) return true;
    return false;
  };
  for (const frame of [p.initial, p.teleported, p.updated, p.disabled, p.deleted, p.replaced, p.forceDebugA, p.forceDebugB, p.expected.frame, p.replayed.frame, p.afterGrowth]) geometry(frame);
  assert.equal(p.initial.entities, 1); assert.equal(p.initial.lineCount, 12); assert.equal(p.initial.debug.projection, "xy");
  bounds(p.initial, [8, 22, 12, 24], "parent times local rotated box, excluding render offset");
  near(p.initialBody[r.position], 10, "native initial body X"); near(p.initialBody[r.position + 1], 20, "native initial body Y");
  bounds(p.teleported, [32, 38, 34, 42], "teleport is visible without a native tick");
  near(p.teleportedBody[r.position], 30, "native teleported body X"); near(p.teleportedBody[r.position + 1], 40, "native teleported body Y");
  bounds(p.updated, [30.25, 41.25, 31.75, 42.75], "replacement sphere with local offset");
  color(p.updated, [1, 0.5, 0, 1]); color(p.disabled, [0.5, 0.5, 0.5, 0.7]);
  assert.equal(p.deleted.entities, 0); assert.equal(p.deleted.lineCount, 0); assert.equal(p.deleted.debug.workUnits, 0);
  assert(!p.oldLive); assert.notDeepEqual(p.oldHandle, p.replacement); assert.match(p.staleError ?? "", /StaleEntity/);
  bounds(p.replaced, [-11, -22, -9, -18], "generation replacement removes old geometry");
  assert.deepEqual(p.forceAfterDebug, p.forceBefore); assert.deepEqual(p.forceDebugB, p.forceDebugA);
  assert.deepEqual(p.replayed, p.expected); near(p.expected.body[r.velocity], 0.1, "debug preserves queued persistent force");
  assert(p.expected.body[r.position] > 0);
  assert(p.growth.borrowedBefore > 0); assert.equal(p.growth.borrowedAfter, 0); assert.equal(p.growth.bytesAfter - p.growth.bytesBefore, 65536);
  assert.deepEqual(p.growth.ownedDebug, p.growth.ownedDebugCopy); assert.deepEqual(p.afterGrowth, p.replayed.frame);
  assert.equal(p.immediateDisabled, undefined); assert.equal(p.cleared.lineCount, 0); assert.deepEqual(p.cleared.lines, []);
  assert.equal(p.cleared.debug, undefined); assert.equal(p.cleared.queriedDebug, undefined); assert.equal(p.cleared.nativeSteps, 0);
  assert(Number.isFinite(p.maxRustMs) && p.maxRustMs >= 0);

  const expectedBounds = {
    box: [9, -33, 11, -27], sphere: [9.25, -30.75, 10.75, -29.25], capsule: [9.5, -30.5, 10.5, -29.5],
    convexHull: [9, -34, 12, -28], triangleMesh: [8, -36, 14, -27], heightfield: [6, -35, 14, -25], compound: [7.5, -35, 14, -25.5],
  };
  assert.equal(r.spatial.shapes.length, 7);
  for (const { type, frame } of r.spatial.shapes) {
    geometry(frame); assert.equal(frame.entities, 1); assert.equal(frame.debug.projection, "xz"); assert(frame.lineCount > 0);
    bounds(frame, expectedBounds[type], `actual ${type} XZ footprint`);
  }
  const cap = r.spatial.capped;
  assert.equal(r.spatial.triangleCount, 6000); assert.equal(cap.state, 1); assert.equal(cap.entities, 1); assert.equal(cap.backend, "rapier3d");
  assert.equal(cap.renders, 0); assert.equal(cap.nativeSteps, 0); assert.equal(cap.stride, 8); assert(cap.finite);
  assert.equal(cap.lineCount, 16384); assert.equal(cap.decodedCount, 16384); assert.equal(cap.debug.lineCount, 16384);
  assert(cap.debug.truncated); assert(!cap.debug.rejected); assert.equal(cap.debug.unsupportedShapes, 0); assert.equal(cap.debug.projection, "xz");
  assert(cap.debug.workUnits <= 65536 && cap.debug.workUnits > cap.lineCount); assert.deepEqual(cap.queriedDebug, cap.debug);
  assert(cap.bounds[2] > 8000); near(cap.bounds[1], -1, "capped triangle geometry");
  cap.first.slice(0, 4).forEach((value, i) => near(value, [0, 0, 1, 0][i], "first native mesh edge"));
  geometry(r.spatial.afterCapRemoval); assert.equal(r.spatial.afterCapRemoval.lineCount, 0); assert.equal(r.spatial.afterCapRemoval.entities, 0);
  assert(Number.isFinite(r.spatial.maxRustMs) && r.spatial.maxRustMs >= 0);

  const jointFrames = r.joints.filter(row => row.type !== undefined); assert.equal(jointFrames.length, 13);
  for (const row of jointFrames) {
    geometry(row.frame); assert.equal(row.frame.entities, 2); assert(row.frame.lineCount > 0);
    const planar = row.space === "planar-xy";
    assert.equal(row.frame.debug.projection, planar ? "xy" : "xz");
    const anchorA = planar ? [-6, 11] : [-6, -5], anchorB = planar ? [4, 21] : [4, -7];
    if (row.type === "gear") {
      color(row.frame, [1, 0.2, 1, 1]);
      assert(hasLine(row.frame, [-4, 10], [-4 + 10 / 6, 10 + 10 / 6]));
      assert(!hasLine(row.frame, [-4, 10], [6, 20]));
    } else if (row.type === "pulley") {
      assert(hasLine(row.frame, anchorA, [-8, -4])); assert(hasLine(row.frame, [-8, -4], [10, -12]));
      assert(hasLine(row.frame, [10, -12], anchorB)); assert(!hasLine(row.frame, anchorA, anchorB));
    } else {
      assert(hasLine(row.frame, anchorA, anchorB), `${row.type} must use actual local native anchors`);
      assert(hasLine(row.frame, planar ? [-4, 10] : [-4, -2], anchorA));
    }
    if (row.disabledFrame) { geometry(row.disabledFrame); color(row.disabledFrame, [0.5, 0.5, 0.5, 0.7]); }
    geometry(row.removed); assert.equal(row.removed.entities, 2); assert.equal(row.removed.lineCount, 0);
  }
  for (const row of r.joints.filter(row => row.type === undefined)) assert(Number.isFinite(row.maxRustMs) && row.maxRustMs >= 0);
  p.exactDebugReplay = true;
  return r;
}
