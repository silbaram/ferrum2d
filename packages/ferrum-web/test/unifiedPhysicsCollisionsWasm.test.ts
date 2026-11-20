import {deepEqual, equal, ok, throws} from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import {createEngine, initializeFerrumWasm, UNIFIED_PHYSICS_COLLISION_LAYOUT as C} from "../src/core.js";
import {wasm_memory} from "../pkg/ferrum_core.js";

test("public collision stream preserves generations on removal and snapshots do not consume transitions", async () => {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
  // Start unconfigured for the negative assertion, then explicitly enter native physics.
  const e = await createEngine(undefined, undefined, undefined, undefined, { physicsBackend: "legacy" });
  try {
    throws(() => e.drainUnifiedPhysicsCollisionEvents(), /not configured/);
    e.useDataScene(); e.configureUnifiedPhysics({space: "spatial", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: 0.01});
    const shape = {type: "sphere" as const, radius: 0.5};
    e.spawnUnifiedPhysicsBody({collider: {shape}});
    const sensor = e.spawnUnifiedPhysicsBody({kind: "fixed", pose: {position: [0.5, 0, 0]}, collider: {shape, sensor: true}});
    e.setUnifiedPhysicsCollisionEventsEnabled(true);
    e.stepRigidBodies(Math.fround(0.01));
    let pairs = e.queryUnifiedPhysicsCollisionPairs();
    equal(pairs.count, 1); equal(pairs.words[C.phase], C.active);
    const identities = pairs.words.slice(C.first);
    const borrowed = pairs.words;
    wasm_memory().grow(1); equal(borrowed.length, 0);
    pairs = e.queryUnifiedPhysicsCollisionPairs(); deepEqual(pairs.words.slice(C.first), identities);
    let events = e.drainUnifiedPhysicsCollisionEvents();
    equal(events.count, 1); equal(events.words[C.flags], C.sensorFlag); equal(events.words[C.phase], C.enter);
    equal(events.words[C.second + C.entity], sensor.entityId);
    equal(e.drainUnifiedPhysicsCollisionEvents().count, 0);
    e.stepRigidBodies(Math.fround(0.01)); equal(e.drainUnifiedPhysicsCollisionEvents().count, 0);
    e.removeUnifiedPhysicsBody(sensor);
    e.spawnUnifiedPhysicsBody({kind: "fixed", pose: {position: [10, 0, 0]}, collider: {shape, sensor: true}});
    equal(e.queryUnifiedPhysicsCollisionPairs().count, 0);
    events = e.drainUnifiedPhysicsCollisionEvents(); equal(events.count, 1);
    equal(events.words[C.phase], C.exit); equal(events.words[C.flags], C.sensorFlag | C.removedFlag);
    deepEqual(events.words.slice(C.first), identities);
    equal(events.words[C.second + C.entity + 1], sensor.entityGeneration);
  } finally { e.destroy(); }
  throws(() => e.drainUnifiedPhysicsCollisionEvents(), /destroyed/i);
  throws(() => e.queryUnifiedPhysicsCollisionPairs(), /destroyed/i);
  throws(() => e.setUnifiedPhysicsCollisionEventsEnabled(true), /destroyed/i);
});

test("public collision overflow exposes full active state and separate queue/native drops", async () => {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
  const e = await createEngine();
  try {
    e.useDataScene(); e.configureUnifiedPhysics({space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: 0.01, maxEvents: 1});
    const shape = {type: "sphere" as const, radius: 0.5};
    const sensors = [0, 4].map(x => {
      e.spawnUnifiedPhysicsBody({pose: {position: [x, 0, 0]}, collider: {shape}});
      return e.spawnUnifiedPhysicsBody({kind: "fixed", pose: {position: [x + 0.5, 0, 0]}, collider: {shape, sensor: true}});
    });
    e.setUnifiedPhysicsCollisionEventsEnabled(true);
    e.stepRigidBodies(Math.fround(0.01)); equal(e.queryUnifiedPhysicsCollisionPairs().count, 2);
    e.removeUnifiedPhysicsBody(sensors[0]);
    const events = e.drainUnifiedPhysicsCollisionEvents();
    equal(events.count, 1); equal(events.droppedTransitions, 1); equal(events.droppedEvents, 1);
    const pairs = e.queryUnifiedPhysicsCollisionPairs(); equal(pairs.count, 1);
    ok(pairs.words[C.flags] & C.sensorFlag);
    const empty = e.drainUnifiedPhysicsCollisionEvents();
    equal(empty.count, 0); equal(empty.droppedTransitions + empty.droppedEvents, 0);
    e.setUnifiedPhysicsCollisionEventsEnabled(false);
    e.removeUnifiedPhysicsBody(sensors[1]); equal(e.drainUnifiedPhysicsCollisionEvents().count, 0);
    equal(e.queryUnifiedPhysicsCollisionPairs().count, 0);
  } finally { e.destroy(); }
});
