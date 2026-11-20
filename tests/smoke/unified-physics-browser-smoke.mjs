#!/usr/bin/env node
import assert from "node:assert/strict";
import { probePhysicsSpecNative } from "./physics-spec-native-probe.mjs";
import { probePlanarActorNative } from "./planar-actor-native-probe.mjs";
import { probeHd2dNative } from "./hd2d-native-probe.mjs";
import { probeAutomaticMovementNative } from "./automatic-movement-native-probe.mjs";
import { probeControllerExtensionNative } from "./controller-extension-native-probe.mjs";
import { probeAggregateNativeAuthoring } from "./aggregate-native-authoring-probe.mjs";
import { probeGraphicalTilemapAuthoring } from "./graphical-tilemap-authoring-probe.mjs";
import { probeCharacterDynamicForces } from "./character-dynamic-forces-probe.mjs";
import { probeNativeLandingContinuity } from "./native-landing-continuity-probe.mjs";
import { probeNativeCheckedErrors } from "./native-checked-error-probe.mjs";
import { probeNativeShapeEdits } from "./native-shape-edit-probe.mjs";
import { probeNativePrefabControllers } from "./native-prefab-controllers-probe.mjs";
import { probeArcadeNative } from "./arcade-native-probe.mjs";
import { probeShooterNative } from "./shooter-native-probe.mjs";
import { probeBreakoutNative } from "./breakout-native-probe.mjs";
import { probePlatformerNative } from "./platformer-native-probe.mjs";
import { probeDefaultPhysicsPolicy } from "./default-physics-policy-probe.mjs";
import { probeNativeDefaultBackend } from "./native-default-backend-probe.mjs";
import { probeNativeVariableClock } from "./native-variable-clock-probe.mjs";
import { probeNativePhysicsDebug } from "./native-physics-debug-probe.mjs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import { runReleaseCommand } from "./github-release-command.mjs";
import { probeUnifiedSpatialActor } from "./unified-physics-spatial-actor-probe.mjs";
import { probeUnifiedMelee } from "./unified-physics-melee-probe.mjs";
import { probeUnifiedDash } from "./unified-physics-dash-probe.mjs";
import { probeUnifiedCombatMovement } from "./unified-physics-combat-movement-probe.mjs";
import { probeUnifiedCombatNavigation } from "./unified-physics-combat-navigation-probe.mjs";
import { probeUnifiedCombatCrowd } from "./unified-physics-combat-crowd-probe.mjs";
import { probeNativeGameplayNavigation } from "./native-gameplay-navigation-probe.mjs";
import { probeUnifiedCombatPatterns } from "./unified-physics-combat-patterns-probe.mjs";
import { probeRuntimeCheckpoint, probePendingRuntimeCheckpoint, probePendingJointRuntimeCheckpoint } from "./runtime-checkpoint-probe.mjs";

const artifacts = resolve("artifacts/physics-3d/web-bridge-browser");
await mkdir(artifacts, { recursive: true });
const output = await mkdtemp(resolve(artifacts, "consumer-"));
await runReleaseCommand("pnpm", ["pack", "--pack-destination", output], { cwd: resolve("packages/ferrum-web") });
const tarball = (await readdir(output)).find(name => name.endsWith(".tgz"));
assert(tarball);
await runReleaseCommand("tar", ["-xzf", resolve(output, tarball), "-C", output]);
const html = `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/package/dist/core.js","@ferrum2d/ferrum-web/authoring":"/package/dist/authoring.js","@ferrum2d/ferrum-web/quality":"/package/dist/quality.js"}}</script>
<script type="module">
import { createEngine, UNIFIED_PHYSICS_STATE_LAYOUT as layout } from '@ferrum2d/ferrum-web/core';
const sample = { frames: 0, consumed: 0, steps: 0, maxRustMs: 0, fixed: true, nativeFrames: 0, nativeSteps: 0, maxNativeDynamic: 0 };
const engine = await createEngine(frame => {
  sample.frames++;
  sample.consumed += frame.physics.fixedConsumedSeconds;
  sample.steps += frame.physics.fixedSteps;
  sample.fixed &&= frame.physics.fixedTimestepEnabled;
  sample.mode = frame.physics.mode;
  sample.stepSeconds = frame.physics.fixedStepSeconds;
  sample.gravity = [frame.physics.gravityX, frame.physics.gravityY];
  sample.maxRustMs = Math.max(sample.maxRustMs, frame.rustUpdateTimeMs);
  if (frame.unifiedPhysics) {
    sample.nativeFrames++;
    sample.nativeSteps += frame.unifiedPhysics.frame.backendSteps;
    sample.maxNativeDynamic = Math.max(sample.maxNativeDynamic, frame.unifiedPhysics.frame.dynamicBodies);
    if (frame.unifiedPhysics.legacySolverRowMetricsAvailable !== false) throw new Error('Unsupported legacy rows cannot be reported as measured');
  }
});
engine.useDataScene();
const count = 64;
const bodies = Array.from({length: count}, (_, i) => engine.spawnRigidBody({
  x: i * 2, y: 0, collider: {type:'circle', radius:0.1}, mass:1, canSleep:false
}));
engine.configureUnifiedPhysics({space:'planar-xy', gravity:[0,0,0], lengthUnit:1, stepSeconds:0.01});
const handles = new Uint32Array(bodies.flatMap(b => [b.entityId, b.entityGeneration]));
const velocities = new Float32Array(count * 6);
for (let i = 0; i < count; i++) velocities[i * 6] = 2;
engine.setUnifiedPhysicsVelocities(handles, velocities);
window.unifiedPhysicsSmoke = {engine, handles, sample, layout, count};
engine.start();
</script>`;
const server = createServer((request, response) => { void (async () => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end(html); return; }
  const file = resolve(output, `.${decodeURIComponent(url.pathname)}`);
  if (!file.startsWith(resolve(output, "package") + sep) || !/\.(js|wasm)$/.test(file)) {
    response.writeHead(403).end(); return;
  }
  response.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "application/javascript");
  response.end(await readFile(file));
})().catch(() => response.writeHead(404).end()); });

let browser;
const report = {
  format: "ferrum2d.unified-physics.web-smoke", version: 1, status: "running", tarball,
  tarballPath: resolve(output, tarball),
  tarballSha256: createHash("sha256").update(await readFile(resolve(output, tarball))).digest("hex"),
  wasmSha256: createHash("sha256").update(await readFile(resolve(output, "package/pkg/ferrum_core_bg.wasm"))).digest("hex"),
};
try {
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const options = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  if (process.env.FERRUM_BROWSER_EXECUTABLE) {
    browser = await chromium.launch({ ...options, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE });
  } else {
    try { browser = await chromium.launch({ ...options, channel: process.env.FERRUM_BROWSER_CHANNEL ?? "chrome" }); }
    catch (error) {
      if (process.env.FERRUM_BROWSER_CHANNEL) throw error;
      browser = await chromium.launch({ ...options, channel: "chromium" });
    }
  }
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.unifiedPhysicsSmoke?.sample.consumed >= 0.1, undefined, { timeout: 45000 });
  const result = await page.evaluate(() => {
    const {engine, handles, sample, layout: L, count} = window.unifiedPhysicsSmoke;
    const stateBeforePause = engine.dataSceneState();
    engine.pause();
    const state = engine.queryUnifiedPhysicsBodyStates(handles);
    let maxPositionError = 0, maxOutOfPlane = 0;
    for (let i = 0; i < count; i++) {
      const offset = i * L.stride;
      if (state.words[offset] !== handles[i * 2] || state.words[offset + 1] !== handles[i * 2 + 1]) throw new Error("Identity mismatch");
      maxPositionError = Math.max(maxPositionError, Math.abs(state.floats[offset + L.position] - (i * 2 + 2 * sample.consumed)));
      maxOutOfPlane = Math.max(maxOutOfPlane, Math.abs(state.floats[offset + L.position + 2]));
    }
    const invalid = new Float32Array(count * 6);
    invalid[0] = 9; invalid[(count - 1) * 6 + 2] = 1;
    let rejected = false;
    try { engine.setUnifiedPhysicsVelocities(handles, invalid); } catch { rejected = true; }
    const after = engine.queryUnifiedPhysicsBodyStates(handles);
    const firstVelocity = after.floats[L.linearVelocity];
    const lastVelocity = after.floats[(count - 1) * L.stride + L.linearVelocity];
    const bodyCount = after.count;
    const memory = engine.memoryStats();
    engine.destroy();
    return { ...sample, count, bodyCount, stateBeforePause, maxPositionError, maxOutOfPlane,
      rejected, firstVelocity, lastVelocity, memory };
  });
  assert.deepEqual(errors, []);
  assert.equal(result.bodyCount, 64);
  assert.equal(result.stateBeforePause, "playing");
  assert.equal(result.fixed, true);
  assert.equal(result.mode, "rigid");
  assert.equal(result.stepSeconds, Math.fround(0.01));
  assert.deepEqual(result.gravity, [0, 0]);
  assert(result.frames > 0 && result.steps >= 10 && result.consumed >= 0.1);
  assert.equal(result.nativeFrames,result.frames);assert.equal(result.nativeSteps,result.steps);assert.equal(result.maxNativeDynamic,64);
  assert(result.maxPositionError < 0.002, JSON.stringify(result));
  assert.equal(result.maxOutOfPlane, 0);
  assert(result.rejected && result.firstVelocity === 2 && result.lastVelocity === 2);
  assert(Number.isFinite(result.maxRustMs) && result.memory.wasmLinearMemoryBytes > 0);
  const spatial = await page.evaluate(async () => {
    const {createEngine, UNIFIED_PHYSICS_STATE_LAYOUT:L, UNIFIED_PHYSICS_CHARACTER_LAYOUT:C} = await import('@ferrum2d/ferrum-web/core');
    let consumed=0, frames=0, maxRustMs=0, finish, timeout;
    const completed=new Promise(resolve=>{finish=resolve;});
    const e=await createEngine(frame=>{
      frames++;consumed+=frame.physics.fixedConsumedSeconds;maxRustMs=Math.max(maxRustMs,frame.rustUpdateTimeMs);
      if(consumed>=0.1){e.pause();finish();}
    });
    try {
      e.useDataScene();e.configureUnifiedPhysics({space:'spatial',gravity:[0,-9.81,0],lengthUnit:1,stepSeconds:0.01});
      const floor=e.spawnUnifiedPhysicsBody({kind:'fixed',pose:{position:[0,-0.25,0]},collider:{shape:{type:'box',halfExtents:[5,0.25,5]}}});
      const actor=e.spawnUnifiedPhysicsBody({kind:'kinematic-position',pose:{position:[0,0.76,0]},collider:{shape:{type:'capsule',halfHeight:0.5,radius:0.25}}});
      e.configureUnifiedPhysicsCharacter(actor,{});
      const h=new Uint32Array([actor.entityId,actor.entityGeneration]);
      e.setUnifiedPhysicsCharacterInputs(h,new Float32Array([0.4,0,0.3,0]));
      e.start();
      await Promise.race([completed, new Promise((_,reject)=>{
        timeout=setTimeout(()=>reject(new Error('Spatial physics RAF did not advance within 45 seconds.')),45000);
      })]);
      const playing=e.dataSceneState();
      const bodyCount=e.queryUnifiedPhysicsBodyStates(new Uint32Array([floor.entityId,floor.entityGeneration,...h])).count;
      const body=e.queryUnifiedPhysicsBodyStates(h);
      const x=body.floats[L.position], y=body.floats[L.position+1], z=body.floats[L.position+2];
      const state=e.queryUnifiedPhysicsCharacterStates(h);
      const grounded=Boolean(state.words[C.flags]&C.groundedFlag), support=Boolean(state.words[C.flags]&C.groundPresentFlag);
      const failures=state.words[C.failedPairCasts]+state.words[C.failedObstacleCasts]+state.words[C.failedObstacleContacts];
      e.setUnifiedPhysicsCharacterInputs(h,new Float32Array([0,0,0,4]));
      let rejected=false;
      try { e.setUnifiedPhysicsCharacterInputs(new Uint32Array([...h,floor.entityId,floor.entityGeneration]),new Float32Array(8)); } catch { rejected=true; }
      e.stepRigidBodies(Math.fround(0.01));
      const jumping=e.queryUnifiedPhysicsCharacterStates(h).floats[C.verticalSpeed]>3;
      e.removeUnifiedPhysicsBody(actor);
      let staleRejected=false;try {e.queryUnifiedPhysicsCharacterStates(h);} catch {staleRejected=true;}
      return {playing,bodyCount,consumed,frames,maxRustMs,x,y,z,grounded,support,failures,rejected,jumping,staleRejected};
    } finally {clearTimeout(timeout);e.destroy();}
  });
  assert.equal(spatial.playing,"playing");
  assert.equal(spatial.bodyCount,2);
  assert(spatial.frames>0 && spatial.consumed>=0.1);
  assert(Number.isFinite(spatial.maxRustMs));
  assert(Math.abs(spatial.x-0.4*spatial.consumed)<0.001 && Math.abs(spatial.z-0.3*spatial.consumed)<0.001,JSON.stringify(spatial));
  assert(Math.abs(spatial.y-0.76)<0.02 && spatial.grounded && spatial.support);
  assert.equal(spatial.failures,0);
  assert(spatial.rejected && spatial.jumping && spatial.staleRejected);
  const commands = await page.evaluate(async () => {
    const {createEngine,decodeRenderCommands,UNIFIED_PHYSICS_STATE_LAYOUT:L}=await import('@ferrum2d/ferrum-web/core');
    let consumed=0,frames=0,maxRustMs=0,finish,timeout;
    const completed=new Promise(resolve=>{finish=resolve;});
    const e=await createEngine(frame=>{
      frames++;consumed+=frame.physics.fixedConsumedSeconds;maxRustMs=Math.max(maxRustMs,frame.rustUpdateTimeMs);
      if(consumed>=0.1){e.pause();finish();}
    });
    try {
      e.useDataScene();e.configureUnifiedPhysics({space:'spatial',gravity:[0,0,0],lengthUnit:1,stepSeconds:0.01});
      const collider={shape:{type:'box',halfExtents:[0.5,0.5,0.5]}};
      const a=e.spawnUnifiedPhysicsBody({collider});
      const k=e.spawnUnifiedPhysicsBody({kind:'kinematic-position',pose:{position:[20,2,0]},collider});
      const h=new Uint32Array([a.entityId,a.entityGeneration]),kh=new Uint32Array([k.entityId,k.entityGeneration]);
      e.setUnifiedPhysicsPoses(h,new Float32Array([0,2,0,0,0,0,1]));
      const teleported=e.queryUnifiedPhysicsBodyStates(h).floats[L.position+1];
      e.setUnifiedPhysicsKinematicTargets(kh,new Float32Array([21,2,1,0,0,0,1]));
      e.addUnifiedPhysicsForces(h,new Float32Array([2,0,0,0,0,0]));
      e.start();
      await Promise.race([completed,new Promise((_,reject)=>{
        timeout=setTimeout(()=>reject(new Error('Body command RAF did not advance within 45 seconds.')),45000);
      })]);
      const playing=e.dataSceneState();
      const bodyCount=e.queryUnifiedPhysicsBodyStates(new Uint32Array([...h,...kh])).count;
      const velocity=e.queryUnifiedPhysicsBodyStates(h).floats[L.linearVelocity];
      const target=e.queryUnifiedPhysicsBodyStates(kh).floats.slice(L.position,L.position+3);
      e.clearUnifiedPhysicsForces(h);e.stepRigidBodies(Math.fround(0.01));
      const clearedVelocity=e.queryUnifiedPhysicsBodyStates(h).floats[L.linearVelocity];
      e.applyUnifiedPhysicsImpulses(h,new Float32Array([3,0,0,0,0,1]));
      const state=e.queryUnifiedPhysicsBodyStates(h);
      const impulseVelocity=state.floats[L.linearVelocity], angularVelocity=state.floats[L.angularVelocity+2];
      e.setUnifiedPhysicsSleeping(h,true);
      let rejected=false;
      try {e.applyUnifiedPhysicsImpulses(new Uint32Array([...h,...kh]),new Float32Array(12).fill(1));} catch {rejected=true;}
      const asleep=e.queryUnifiedPhysicsBodyStates(h);
      const unchangedSleep=Boolean(asleep.words[L.flags]&L.sleepingFlag)&&asleep.floats[L.linearVelocity]===0;
      e.setUnifiedPhysicsSleeping(h,false);
      const awake=(e.queryUnifiedPhysicsBodyStates(h).words[L.flags]&L.sleepingFlag)===0;
      return {playing,bodyCount,consumed,frames,maxRustMs,teleported,velocity,clearedVelocity,
        target:Array.from(target),impulseVelocity,angularVelocity,rejected,unchangedSleep,awake};
    } finally {clearTimeout(timeout);e.destroy();}
  });
  assert.equal(commands.playing,'playing');assert.equal(commands.bodyCount,2);
  assert(commands.frames>0 && commands.consumed>=0.1 && Number.isFinite(commands.maxRustMs));
  assert.equal(commands.teleported,2);
  assert(Math.abs(commands.velocity-2*commands.consumed)<0.0001,JSON.stringify(commands));
  assert(Math.abs(commands.clearedVelocity-commands.velocity)<0.0001);
  assert(Math.abs(commands.impulseVelocity-commands.velocity-3)<0.0001);
  assert(Math.abs(commands.angularVelocity-6)<0.0001);
  assert.deepEqual(commands.target,[21,2,1]);
  assert(commands.rejected && commands.unchangedSleep && commands.awake);
  const queries=await page.evaluate(async()=>{
    const {createEngine,createUnifiedPhysicsQueryBatch,UNIFIED_PHYSICS_QUERY_LAYOUT:Q,UNIFIED_PHYSICS_STATE_LAYOUT:S}=await import('@ferrum2d/ferrum-web/core');
    const e=await createEngine();
    try{
      e.useDataScene();e.configureUnifiedPhysics({space:'spatial',gravity:[0,0,0],lengthUnit:1,stepSeconds:0.01});
      const collider={shape:{type:'sphere',radius:0.5}};
      const a=e.spawnUnifiedPhysicsBody({kind:'fixed',collider,renderOffset:[0,100,0]});
      e.spawnUnifiedPhysicsBody({kind:'fixed',pose:{position:[0,-3,0]},collider});
      const k=e.spawnUnifiedPhysicsBody({kind:'kinematic-position',pose:{position:[100,0,0]},collider});
      const kh=new Uint32Array([k.entityId,k.entityGeneration]);
      e.setUnifiedPhysicsKinematicTargets(kh,new Float32Array([110,0,0,0,0,0,1]));
      const batch=createUnifiedPhysicsQueryBatch([
        ...Array.from({length:60},()=>({type:'ray',origin:[0,10,0],direction:[0,-7,0],maxDistance:20,limit:1})),
        {type:'point',point:[0,0,0]},
        {type:'overlap',shape:{type:'box',halfExtents:[0.25,0.25,0.25]}},
        {type:'sweep',shape:{type:'sphere',radius:0.25},pose:{position:[0,2,0]},translation:[0,-4,0]},
        {type:'nearest',point:[0,2,0],maxDistance:5},
      ]);
      const start=performance.now();const state=e.queryUnifiedPhysics(batch);const durationMs=performance.now()-start;
      let raysCorrect=true;
      for(let i=0;i<60;i++){
        const offset=state.summaries[i*3]*Q.hitStride;
        raysCorrect&&=state.summaries[i*3+1]===1 && state.summaries[i*3+2]===1
          && state.words[offset+Q.queryIndex]===i && state.words[offset+Q.entity]===a.entityId
          && Math.abs(state.floats[offset+Q.value]-9.5)<0.0001;
      }
      const queryCount=state.queryCount,hitCount=state.hitCount;
      const sweep=state.floats[state.summaries[62*3]*Q.hitStride+Q.value];
      const nearest=state.floats[state.summaries[63*3]*Q.hitStride+Q.value];
      const pointHits=state.summaries[60*3+1],overlapHits=state.summaries[61*3+1];
      const beforeStep=e.queryUnifiedPhysicsBodyStates(kh).floats[S.position];
      e.stepRigidBodies(Math.fround(0.01));const afterStep=e.queryUnifiedPhysicsBodyStates(kh).floats[S.position];
      batch.values[63*Q.inputStride+Q.inputDistance]=-1;
      let rejected=false;try{e.queryUnifiedPhysics(batch);}catch{rejected=true;}
      batch.values[63*Q.inputStride+Q.inputDistance]=5;
      e.removeUnifiedPhysicsBody(a);const removed=e.queryUnifiedPhysics(batch);
      return {queryCount,hitCount,durationMs,raysCorrect,sweep,nearest,pointHits,overlapHits,beforeStep,afterStep,rejected,
        afterRemovalCount:removed.hitCount,afterRemovalRay:removed.floats[Q.value],afterRemovalTruncated:removed.summaries[2]};
    }finally{e.destroy();}
  });
  assert.equal(queries.queryCount,64);assert.equal(queries.hitCount,65);assert(queries.raysCorrect);
  assert(Number.isFinite(queries.durationMs)&&queries.durationMs>=0);
  assert.equal(queries.pointHits,1);assert.equal(queries.overlapHits,1);
  assert(Math.abs(queries.sweep-0.3125)<0.0001);assert.equal(queries.nearest,1.5);
  assert.equal(queries.beforeStep,100);assert.equal(queries.afterStep,110);assert(queries.rejected);
  assert.equal(queries.afterRemovalCount,61);assert.equal(queries.afterRemovalRay,12.5);assert.equal(queries.afterRemovalTruncated,0);
  const collisions = await page.evaluate(async () => {
    const {createEngine, UNIFIED_PHYSICS_COLLISION_LAYOUT:C} = await import('@ferrum2d/ferrum-web/core');
    const e = await createEngine();
    try {
      e.useDataScene();
      e.configureUnifiedPhysics({space:'spatial',gravity:[0,0,0],lengthUnit:1,stepSeconds:0.01,maxEvents:16});
      const shape = {type:'sphere',radius:0.5};
      const sensors = Array.from({length:64}, (_, i) => {
        e.spawnUnifiedPhysicsBody({pose:{position:[i*4,0,0]},collider:{shape}});
        return e.spawnUnifiedPhysicsBody({kind:'fixed',pose:{position:[i*4+0.5,0,0]},collider:{shape,sensor:true}});
      });
      e.setUnifiedPhysicsCollisionEventsEnabled(true);
      const start = performance.now();
      e.stepRigidBodies(Math.fround(0.01));
      const stepMs = performance.now() - start;
      const active = e.queryUnifiedPhysicsCollisionPairs();
      const activeCount = active.count;
      const activeIdentities = active.words.slice();
      e.removeUnifiedPhysicsBody(sensors[0]);
      const events = e.drainUnifiedPhysicsCollisionEvents();
      const count = events.count, droppedTransitions = events.droppedTransitions, droppedEvents = events.droppedEvents;
      let validEnters = true;
      for (let i=0; i<count; i++) {
        validEnters &&= events.words[i*C.stride+C.phase] === C.enter
          && events.words[i*C.stride+C.flags] === C.sensorFlag;
      }
      const recoveredCount = e.queryUnifiedPhysicsCollisionPairs().count;
      e.removeUnifiedPhysicsBody(sensors[1]);
      const exit = e.drainUnifiedPhysicsCollisionEvents();
      const exitCorrect = exit.count === 1 && exit.words[C.phase] === C.exit
        && exit.words[C.flags] === (C.sensorFlag|C.removedFlag)
        && exit.words[C.second+C.entity] === sensors[1].entityId
        && exit.words[C.second+C.entity+1] === sensors[1].entityGeneration
        && Array.from(exit.words.slice(C.first)).every((word,j) => word === activeIdentities[C.stride+C.first+j]);
      const empty = e.drainUnifiedPhysicsCollisionEvents();
      return {playing:e.dataSceneState(),stepMs,activeCount,count,droppedTransitions,droppedEvents,validEnters,
        recoveredCount,exitCorrect,emptyCount:empty.count,emptyDrops:empty.droppedTransitions+empty.droppedEvents};
    } finally { e.destroy(); }
  });
  assert.equal(collisions.playing,'playing');assert.equal(collisions.activeCount,64);
  assert.equal(collisions.count,16);assert.equal(collisions.droppedTransitions,48);assert.equal(collisions.droppedEvents,1);
  assert.equal(collisions.recoveredCount,63);assert(collisions.validEnters && collisions.exitCorrect);
  assert.equal(collisions.emptyCount,0);assert.equal(collisions.emptyDrops,0);
  assert(Number.isFinite(collisions.stepMs) && collisions.stepMs>=0);
  const observations = await page.evaluate(async () => {
    const {createEngine, UNIFIED_PHYSICS_CONTACT_LAYOUT:M, UNIFIED_PHYSICS_OBSERVATION_LAYOUT:O} = await import('@ferrum2d/ferrum-web/core');
    const e = await createEngine();
    try {
      e.useDataScene();e.configureUnifiedPhysics({space:'spatial',gravity:[0,0,0],lengthUnit:1,stepSeconds:0.01});
      const shape={type:'box',halfExtents:[0.5,0.5,0.5]};
      e.spawnUnifiedPhysicsBody({kind:'fixed',collider:{shape,category:2},renderOffset:[0,100,0]});
      const b=e.spawnUnifiedPhysicsBody({pose:{position:[0,1,0]},linearVelocity:[1,-6,2],collider:{shape,category:4}});
      const geometry=e.queryUnifiedPhysicsContactManifolds({categoryA:2,categoryB:4});
      const manifolds=geometry.manifolds.count,points=geometry.points.count;
      const normal=geometry.manifolds.floats[M.normal+1],surfaceY=geometry.points.floats[M.firstPoint+1];
      const truncated=e.queryUnifiedPhysicsContactManifolds({maxPoints:1}).truncated;
      e.stepRigidBodies(Math.fround(0.01));
      const result=e.queryUnifiedPhysicsObservations(),saved=result.impulses.words.slice();
      const firstImpulse=result.impulses.floats[O.normalImpulse],speed=result.impulses.floats[O.approachSpeed];
      const count=result.impulses.count,stats=result.diagnostics;
      e.removeUnifiedPhysicsBody(b);e.queryUnifiedPhysicsContactManifolds();
      const after=e.queryUnifiedPhysicsObservations();
      const retained=after.impulses.words.length===saved.length && saved.every((word,i)=>word===after.impulses.words[i]);
      return {manifolds,points,normal,surfaceY,truncated,count,firstImpulse,speed,retained,stats};
    } finally {e.destroy();}
  });
  assert.equal(observations.manifolds,1);assert(observations.points>=4);assert(observations.truncated);
  assert(observations.normal>0.99);assert(Math.abs(observations.surfaceY-0.5)<0.0001);
  assert(observations.count>0 && observations.firstImpulse>0);assert(Math.abs(observations.speed-6)<0.0001);
  assert(observations.retained);assert.equal(observations.stats.solvedContacts,observations.count);
  assert.equal(observations.stats.backend,'rapier3d');assert.equal(observations.stats.frame.backendSteps,1);
  assert(observations.stats.frame.solverContacts>0);assert.equal(observations.stats.legacySolverRowMetricsAvailable,false);
  const controls = await page.evaluate(async () => {
    const {createEngine,createUnifiedPhysicsQueryBatch,UNIFIED_PHYSICS_COLLISION_LAYOUT:C}=await import('@ferrum2d/ferrum-web/core');
    const e=await createEngine();
    try {
      e.useDataScene();e.configureUnifiedPhysics({space:'spatial',gravity:[0,0,0],lengthUnit:1,stepSeconds:0.01});
      const sphere={shape:{type:'sphere',radius:0.5}},settings={kind:'dynamic',enabled:true,gravityScale:1,linearDamping:0,angularDamping:0,canSleep:true,ccd:false,lockRotation:false};
      const a=e.spawnUnifiedPhysicsBody({collider:{...sphere,density:0}}),handles=new Uint32Array([a.entityId,a.entityGeneration]);
      e.setUnifiedPhysicsMassProperties(a,{mass:2,principalInertia:[4,4,4],center:[0,0,0],inertiaRotation:[0,0,0,1]});
      e.applyUnifiedPhysicsImpulses(handles,new Float32Array([4,0,0,0,0,8]));
      const initial=e.queryUnifiedPhysicsBodyStates(handles),linear=initial.floats[10],angular=initial.floats[15];
      e.setUnifiedPhysicsBodyOptions(a,{...settings,lockRotation:true});const locked=e.queryUnifiedPhysicsBodyStates(handles).floats[15];
      e.setUnifiedPhysicsVelocities(handles,new Float32Array(6));
      const point=createUnifiedPhysicsQueryBatch([{type:'point',point:[0,0,0]}]);
      e.setUnifiedPhysicsBodyOptions(a,{...settings,enabled:false});const disabledHits=e.queryUnifiedPhysics(point).hitCount;
      e.setUnifiedPhysicsBodyOptions(a,settings);const enabledHits=e.queryUnifiedPhysics(point).hitCount;
      const [c]=e.queryUnifiedPhysicsColliders(a);
      e.updateUnifiedPhysicsCollider(a,c,{shape:{type:'box',halfExtents:[0.5,2,0.5]},density:0});
      const editedHits=e.queryUnifiedPhysics(createUnifiedPhysicsQueryBatch([{type:'point',point:[0,1.5,0]}])).hitCount;
      const preserved=JSON.stringify(e.queryUnifiedPhysicsColliders(a)[0])===JSON.stringify(c);
      const b=e.spawnUnifiedPhysicsBody({kind:'fixed',pose:{position:[0.75,0,0]},collider:{...sphere,sensor:true}});
      let foreignRejected=false;try{e.removeUnifiedPhysicsCollider(b,c);}catch{foreignRejected=true;}
      e.setUnifiedPhysicsCollisionEventsEnabled(true);e.stepRigidBodies(Math.fround(0.01));e.drainUnifiedPhysicsCollisionEvents();
      e.removeUnifiedPhysicsCollider(a,c);const replacement=e.addUnifiedPhysicsCollider(a,sphere);
      const events=e.drainUnifiedPhysicsCollisionEvents();
      const exit=events.count===1&&events.words[C.phase]===1&&events.words[C.first+C.collider]===c.slot&&events.words[C.first+C.collider+1]===c.generation;
      let staleRejected=false;try{e.updateUnifiedPhysicsCollider(a,c,sphere);}catch{staleRejected=true;}
      return {linear,angular,locked,disabledHits,enabledHits,editedHits,preserved,foreignRejected,staleRejected,exit,
        generationChanged:replacement.slot!==c.slot||replacement.generation!==c.generation};
    } finally {e.destroy();}
  });
  assert.equal(controls.linear,2);assert.equal(controls.angular,2);assert.equal(controls.locked,0);
  assert.equal(controls.disabledHits,0);assert.equal(controls.enabledHits,1);assert.equal(controls.editedHits,1);
  assert(controls.preserved&&controls.foreignRejected&&controls.staleRejected&&controls.exit&&controls.generationChanged);
  const joints=await page.evaluate(async()=>{
    const {createEngine,UNIFIED_PHYSICS_JOINT_LAYOUT:L}=await import('@ferrum2d/ferrum-web/core');const e=await createEngine();
    try {
      e.useDataScene();e.configureUnifiedPhysics({space:'spatial',gravity:[0,0,0],lengthUnit:1,stepSeconds:0.01,maxEvents:1});
      const shape={type:'sphere',radius:0.1};const a=e.spawnUnifiedPhysicsBody({kind:'fixed',collider:{shape}});
      const b=e.spawnUnifiedPhysicsBody({pose:{position:[2,0,0]},collider:{shape,density:0}}),h=new Uint32Array([b.entityId,b.entityGeneration]);
      e.setUnifiedPhysicsMassProperties(b,{mass:1,principalInertia:[1,1,1],center:[0,0,0],inertiaRotation:[0,0,0,1]});
      const settings={bodyA:a,bodyB:b,kind:{type:'prismatic',motor:{targetPosition:0,targetVelocity:2,stiffness:0,damping:10,maxForce:100}}};
      const motor=e.createUnifiedPhysicsJoint(settings),mh=new Uint32Array([motor.slot,motor.generation]);
      for(let i=0;i<20;i++)e.stepRigidBodies(Math.fround(0.01));
      const ms=e.queryUnifiedPhysicsJointStates(mh),force=ms.floats[L.force];const bs=e.queryUnifiedPhysicsBodyStates(h),position=bs.floats[3],velocity=bs.floats[10];
      let invalidRejected=false;try{e.updateUnifiedPhysicsJoint(motor,{...settings,kind:{type:'distance',length:-1}});}catch{invalidRejected=true;}
      const preserved=e.queryUnifiedPhysicsJointStates(mh).floats[L.force]===force;
      e.updateUnifiedPhysicsJoint(motor,{...settings,enabled:false});const resetReaction=e.queryUnifiedPhysicsJointStates(mh).floats[L.force];e.removeUnifiedPhysicsJoint(motor);
      e.setUnifiedPhysicsPoses(h,new Float32Array([0,0,0,0,0,0,1]));e.setUnifiedPhysicsVelocities(h,new Float32Array(6));e.setUnifiedPhysicsJointEventsEnabled(true);
      const broken=e.createUnifiedPhysicsJoint({bodyA:a,bodyB:b,kind:{type:'fixed'},breakForce:1,breakTorque:1});
      e.addUnifiedPhysicsForces(h,new Float32Array([10,0,0,0,10,0]));e.stepRigidBodies(Math.fround(0.01));
      const event=e.drainUnifiedPhysicsJointEvents();const breakResult={count:event.count,reason:event.words[L.code],force:event.floats[L.force],torque:event.floats[L.torque],identity:event.words[L.joint]===broken.slot&&event.words[L.entityB]===b.entityId};
      const c=e.spawnUnifiedPhysicsBody({pose:{position:[3,0,0]},collider:{shape}});
      for(let i=0;i<3;i++)e.createUnifiedPhysicsJoint({bodyA:a,bodyB:c,kind:{type:'distance',length:3}});
      e.removeUnifiedPhysicsBody(c);
      const extra=e.createUnifiedPhysicsJoint({bodyA:a,bodyB:b,kind:{type:'distance',length:0}});e.removeUnifiedPhysicsJoint(extra);
      const events=e.drainUnifiedPhysicsJointEvents();const overflow={count:events.count,native:events.droppedNative,public:events.droppedEvents,identity:events.words[L.entityB]===c.entityId&&events.words[L.entityB+1]===c.entityGeneration,reason:events.words[L.code]};
      const live=e.queryUnifiedPhysicsJointStates().count;
      let staleRejected=false;try{e.removeUnifiedPhysicsJoint(broken);}catch{staleRejected=true;}
      return {force,position,velocity,invalidRejected,preserved,resetReaction,breakResult,overflow,live,staleRejected};
    } finally {e.destroy();}
  });
  assert(joints.force>0&&joints.position>2.1&&joints.velocity>1);assert(joints.invalidRejected&&joints.preserved&&joints.staleRejected);assert.equal(joints.resetReaction,0);
  assert.equal(joints.breakResult.count,1);assert.equal(joints.breakResult.reason,2);assert(joints.breakResult.force>1&&joints.breakResult.torque>1&&joints.breakResult.identity);
  assert.equal(joints.overflow.count,1);assert.equal(joints.overflow.native,2);assert.equal(joints.overflow.public,1);assert.equal(joints.overflow.reason,4);assert(joints.overflow.identity);assert.equal(joints.live,0);
  const authoring = await page.evaluate(async document => {
    const {createEngine,captureGameStateSnapshot,UNIFIED_PHYSICS_STATE_LAYOUT:L}=await import('@ferrum2d/ferrum-web/core');
    const {applyDataSceneAuthoringDocument}=await import('@ferrum2d/ferrum-web/authoring');
    const e=await createEngine();
    try {
      const applied=applyDataSceneAuthoringDocument(e,document,{textureId:()=>11});
      const body=applied.entityHandles.ball,h=new Uint32Array([body.entityId,body.entityGeneration]);
      for(let i=0;i<240;i++)e.stepRigidBodies(Math.fround(1/60));
      const s=e.queryUnifiedPhysicsBodyStates(h),position=[...s.floats.slice(L.position,L.position+3)],velocity=[...s.floats.slice(L.linearVelocity,L.linearVelocity+3)];
      const bad=structuredClone(document);bad.sceneComposition.prefabs.ball.props.components.body.collider.shape.radius=-1;
      let invalidRejected=false;try{applyDataSceneAuthoringDocument(e,bad,{textureId:()=>11});}catch{invalidRejected=true;}
      let snapshotRejected=false;try{captureGameStateSnapshot(e,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:document});}catch(error){snapshotRejected=String(error).includes('native physics snapshots');}
      return {position,velocity,invalidRejected,snapshotRejected,retained:e.queryUnifiedPhysicsBodyStates(h).count,entities:e.entityCount()};
    }finally{e.destroy();}
  },JSON.parse(await readFile('docs/engine/samples/data-scene-physics.scene-authoring.json','utf8')));
  report.authoring=authoring;
  assert(authoring.invalidRejected&&authoring.snapshotRejected);assert.equal(authoring.retained,1);assert.equal(authoring.entities,1);
  assert(Math.abs(authoring.position[1]-8)<0.2);assert(Math.abs(authoring.velocity[1])<0.2);
  const authoredConstraints = await page.evaluate(async document => {
    const {createEngine,UNIFIED_PHYSICS_STATE_LAYOUT:B,UNIFIED_PHYSICS_CHARACTER_LAYOUT:C,UNIFIED_PHYSICS_JOINT_LAYOUT:J}=await import('@ferrum2d/ferrum-web/core');
    const {applyDataSceneAuthoringDocument}=await import('@ferrum2d/ferrum-web/authoring');
    const e=await createEngine();
    try {
      const applied=applyDataSceneAuthoringDocument(e,document,{textureId:()=>11});
      const actor=applied.entityHandles.actor,slider=applied.entityHandles.slider;
      const ids=new Uint32Array([actor.entityId,actor.entityGeneration]);
      const joint=applied.physicsJoints.rail,jids=new Uint32Array([joint.slot,joint.generation]);
      for(let i=0;i<300;i++)e.stepRigidBodies(Math.fround(0.01));
      const grounded=Boolean(e.queryUnifiedPhysicsCharacterStates(ids).words[C.flags]&C.groundedFlag);
      const before=Array.from(e.queryUnifiedPhysicsBodyStates(ids).floats.slice(B.position,B.position+3));
      const sliderPosition=Array.from(e.queryUnifiedPhysicsBodyStates(new Uint32Array([slider.entityId,slider.entityGeneration])).floats.slice(B.position,B.position+3));
      const jointKind=e.queryUnifiedPhysicsJointStates(jids).words[J.code];
      e.setUnifiedPhysicsCharacterInputs(ids,new Float32Array([1,0,0,4]));
      for(let i=0;i<20;i++)e.stepRigidBodies(Math.fround(0.01));
      const after=Array.from(e.queryUnifiedPhysicsBodyStates(ids).floats.slice(B.position,B.position+3));
      const bad=structuredClone(document);bad.physics.joints.rail.bodyB='missing';
      let rejected=false;try{applyDataSceneAuthoringDocument(e,bad,{textureId:()=>11});}catch{rejected=true;}
      return {grounded,before,after,sliderPosition,jointKind,rejected,retained:e.queryUnifiedPhysicsJointStates(jids).count,entities:e.entityCount()};
    }finally{e.destroy();}
  },JSON.parse(await readFile('docs/engine/samples/data-scene-constraints.scene-authoring.json','utf8')));
  report.authoredConstraints=authoredConstraints;
  report.melee = await probeUnifiedMelee(page);
  report.dash = await probeUnifiedDash(page);
  report.combatMovement = await probeUnifiedCombatMovement(page);
  report.combatNavigation = await probeUnifiedCombatNavigation(page);
  report.combatCrowd = await probeUnifiedCombatCrowd(page);
  report.nativeGameplayNavigation = await probeNativeGameplayNavigation(page);
  report.combatPatterns = await probeUnifiedCombatPatterns(page);
  report.spatialActor = await probeUnifiedSpatialActor(page, JSON.parse(await readFile('docs/engine/samples/data-scene-constraints.scene-authoring.json','utf8')));
  assert(authoredConstraints.grounded&&authoredConstraints.rejected);assert.equal(authoredConstraints.retained,1);assert.equal(authoredConstraints.entities,3);
  assert(Math.abs(authoredConstraints.before[1]-0.76)<0.05);assert(authoredConstraints.after[0]>authoredConstraints.before[0]+0.15);
  assert(authoredConstraints.after[1]>authoredConstraints.before[1]+0.4);assert.equal(authoredConstraints.jointKind,3);
  assert(Math.abs(authoredConstraints.sliderPosition[0]-4)<0.2);assert(Math.abs(authoredConstraints.sliderPosition[1]-2)<0.05);
  const bindings = await page.evaluate(async () => {
    const {createEngine,decodeRenderCommands,UNIFIED_PHYSICS_STATE_LAYOUT:L}=await import('@ferrum2d/ferrum-web/core');
    const {createDataSceneRuntimeTarget}=await import('@ferrum2d/ferrum-web/authoring');
    const rows=[];
    for(const space of ['planar-xy','spatial']) {
      let consumed=0, firstConsumed=0, samples=[], finish, failure, timer;
      const e=await createEngine(frame=>{
        consumed+=frame.physics.fixedConsumedSeconds;
        const commands=decodeRenderCommands(frame.renderCommandBuffer).filter(c=>c.textureId===11);
        if(commands.length!==1){e.pause();failure(new Error('Bound visual must appear exactly once'));return;}
        if(samples.length===0)firstConsumed=consumed;
        const c=commands[0];samples.push({x:c.x,y:c.y,width:c.width,height:c.height,texture:c.textureId});
        if(consumed>=0.1){e.pause();finish();}
      },undefined,undefined,()=>({width:320,height:180}));
      const run=async(start)=>{
        consumed=0;samples=[];
        const done=new Promise((resolve,reject)=>{finish=resolve;failure=reject;timer=setTimeout(()=>reject(new Error('Binding RAF timeout')),10000);});
        try{if(start)e.start();else e.resume();await done;}finally{clearTimeout(timer);e.pause();}
        return {consumed,firstConsumed,first:samples[0],last:samples.at(-1),frames:samples.length};
      };
      try {
        const target=createDataSceneRuntimeTarget(e,{textureId:()=>11});
        const h=target.spawnSceneInstance({id:'sprite',sourceId:'sprite',prefab:'prop',x:17,y:23,rotationRadians:0,scale:1,layer:0,
          props:{components:{sprite:{texture:'sprite',width:2,height:3},collider:'none',layer:'wall'}}});
        e.setDataSceneCamera({x:0,y:0});
        e.configureUnifiedPhysics({space,gravity:[0,0,0],lengthUnit:1,stepSeconds:0.01});
        const spatial=space==='spatial';
        e.bindUnifiedPhysicsBody(h,{pose:{position:[2,3,spatial?4:0]},linearVelocity:[2,1,spatial?3:0],collider:{shape:{type:'sphere',radius:0.5}}});
        const active=await run(true),handles=new Uint32Array([h.entityId,h.entityGeneration]);
        const state=e.queryUnifiedPhysicsBodyStates(handles);
        const identity=state.words[0]===h.entityId&&state.words[1]===h.entityGeneration;
        const position=[...state.floats.slice(L.position,L.position+3)];
        e.unbindUnifiedPhysicsBody(h);
        let staleRejected=false;try{e.queryUnifiedPhysicsBodyStates(handles);}catch{staleRejected=true;}
        const detached=await run(false),retainedCount=e.entityCount();
        e.bindUnifiedPhysicsBody(h,{collider:{shape:{type:'sphere',radius:0.5}}});
        const reboundCount=e.entityCount();e.removeUnifiedPhysicsBody(h);
        rows.push({space,identity,position,active,detached,staleRejected,retainedCount,reboundCount,removedCount:e.entityCount()});
      } finally {clearTimeout(timer);e.destroy();}
    }
    return rows;
  });
  report.bindings=bindings;
  assert.equal(bindings.length,2);
  for(const b of bindings){
    assert(b.identity&&b.staleRejected);assert.equal(b.retainedCount,1);assert.equal(b.reboundCount,1);assert.equal(b.removedCount,0);
    assert(b.active.frames>1&&b.detached.frames>1);
    assert.equal(b.active.first.texture,11);assert.equal(b.active.last.width,2);assert.equal(b.active.last.height,3);
    assert(Math.abs(b.position[0]-(2+2*b.active.consumed))<0.001);
    assert(Math.abs(b.active.last.x-b.active.first.x-2*(b.active.consumed-b.active.firstConsumed))<0.001);
    const dy=(b.space==='spatial'?-3:1)*(b.active.consumed-b.active.firstConsumed);
    assert(Math.abs(b.active.last.y-b.active.first.y-dy)<0.001);
    assert.deepEqual(b.detached.first,b.active.last);assert.deepEqual(b.detached.last,b.detached.first);
  }
  assert.deepEqual(errors,[]);
  report.physicsSpecNative = await probePhysicsSpecNative(page);
  report.planarActorNative = await probePlanarActorNative(page);
  report.hd2dNative = await probeHd2dNative(page);
  report.automaticMovementNative = await probeAutomaticMovementNative(page);
  report.controllerExtensionNative = await probeControllerExtensionNative(page);
  report.aggregateNativeAuthoring = await probeAggregateNativeAuthoring(page, {
    tarballPath: report.tarballPath, tarballSha256: report.tarballSha256, wasmSha256: report.wasmSha256,
  });
  report.graphicalTilemapAuthoring = await probeGraphicalTilemapAuthoring(page, {
    tarballPath: report.tarballPath, tarballSha256: report.tarballSha256, wasmSha256: report.wasmSha256,
  });
  report.characterDynamicForces = await probeCharacterDynamicForces(page, {
    tarballPath: report.tarballPath, tarballSha256: report.tarballSha256, wasmSha256: report.wasmSha256,
  });
  report.nativeLandingContinuity = await probeNativeLandingContinuity(page, {
    tarballPath: report.tarballPath, tarballSha256: report.tarballSha256, wasmSha256: report.wasmSha256,
  });
  report.nativeCheckedErrors = await probeNativeCheckedErrors(page, {
    tarballPath: report.tarballPath, tarballSha256: report.tarballSha256, wasmSha256: report.wasmSha256,
  });
  report.nativeShapeEdits = await probeNativeShapeEdits(page, {
    tarballPath: report.tarballPath, tarballSha256: report.tarballSha256, wasmSha256: report.wasmSha256,
  });
  report.nativePrefabControllers = await probeNativePrefabControllers(page, {
    tarballPath: report.tarballPath, tarballSha256: report.tarballSha256, wasmSha256: report.wasmSha256,
  });
  report.arcadeNative = await probeArcadeNative(page);
  report.shooterNative = await probeShooterNative(page);
  report.breakoutNative = await probeBreakoutNative(page);
  report.platformerNative = await probePlatformerNative(page);
  report.defaultPhysicsPolicy = await probeDefaultPhysicsPolicy(page);
  report.nativeDefaultBackend = await probeNativeDefaultBackend(page);
  report.nativeVariableClock = await probeNativeVariableClock(page, {
    tarballSha256: report.tarballSha256, wasmSha256: report.wasmSha256,
  });
  report.nativeDebug = await probeNativePhysicsDebug(page);
  report.runtimeCheckpoint = await probeRuntimeCheckpoint(page);
  report.pendingRuntimeCheckpoint = await probePendingRuntimeCheckpoint(page);
  report.pendingJointRuntimeCheckpoint = await probePendingJointRuntimeCheckpoint(page);
  assert.deepEqual(errors, []);
  Object.assign(report, {status: "passed", browser: browser.version(), result, spatial, commands, queries, collisions, observations, controls, joints, bindings,
    scope: "Packed public Web API, bodies/characters/commands, mutable body/mass/collider and joint controls/lifecycle, mixed XYZ queries, collider events, contact/impulse observations and automatic native frame diagnostics in actual Wasm/RAF. Existing authored sprite bind/unbind identity and render-command motion in planar/XYZ RAF. Same-Engine memory checkpoint exact replay/owner/frame/disposal guards in both spaces with controlled browser RAF. Functional check; not a density/performance acceptance gate."});
} catch (error) {
  Object.assign(report, {status: "failed", error: String(error)});
  throw error;
} finally {
  await writeFile(resolve(artifacts, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await browser?.close();
  await new Promise(done => server.close(done));
}
console.log(JSON.stringify(report));
