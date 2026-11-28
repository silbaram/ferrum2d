import "./nativeRuntimeTestHelper.js";
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { applyDataSceneAuthoringDocument, resolveSceneAuthoringDocument } from "../src/authoring.js";
import { createEngine } from "../src/createEngine.js";
import type { FrameState } from "../src/engineTypes.js";
import type { GameplayEntityHandle as EntityHandle } from "../src/gameplayAuthoring.js";

// Logic half of smoke:engine-playground: the real starter playground scene on the native engine,
// configured the way enginePlayground.ts configures it. Lighting, normal maps, post-processing,
// camera pixels and screen-to-world pointer mapping stay in the browser smoke.

const destinations = [{ x: 144, y: 96 }, { x: 304, y: 296 }, { x: 552, y: 88 }];
const textureNames = ["floor", "robot", "energy", "wall", "water", "panel", "ball", "robotNormal", "ballNormal"];

test("the engine playground walks, collects cells, bounces the ball by material, pauses and resets", async () => {
  const scene = resolveSceneAuthoringDocument(JSON.parse(new TextDecoder().decode(await readFile(
    new URL("../../../../examples/starter-runtime/public/playground/scene.json", import.meta.url)))),
  { validateBindings: true, validateComponents: true });
  let last: FrameState | undefined;
  let ballHits = 0;
  let handles: Record<string, EntityHandle> = {};
  const engine = await createEngine(frame => {
    last = frame;
    const ball = handles.ball;
    if (!ball) return;
    ballHits += frame.physics.ccdHits + frame.collisionEvents.filter(event => (event.kind === "enter" || event.kind === "hit")
      && ((event.aId === ball.entityId && event.aGeneration === ball.entityGeneration)
        || (event.bId === ball.entityId && event.bGeneration === ball.entityGeneration))).length;
  }, undefined, undefined, undefined, { includeCollisionEvents: true });
  const request = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  let tick: FrameRequestCallback | undefined;
  globalThis.requestAnimationFrame = callback => { tick = callback; return 1; };
  globalThis.cancelAnimationFrame = () => { tick = undefined; };
  let clock = 0;
  const frame = () => {
    if (!tick) throw new Error("Missing scheduled playground frame");
    const callback = tick;
    tick = undefined;
    callback(clock += 1000 / 60);
    if (!last) throw new Error("Missing playground frame state");
    return last;
  };
  const frames = (count: number) => { for (let i = 0; i < count; i += 1) frame(); };
  try {
    let applied = applyDataSceneAuthoringDocument(engine, scene, { textureId: name => textureNames.indexOf(String(name)) + 1 });
    handles = applied.entityHandles;
    const material = (rubber: boolean) => {
      for (const id of ["ball", "bay_north", "bay_south", "bay_west", "bay_east"])
        equal(engine.setPhysicsBodyMaterial(handles[id], { restitution: rubber ? 0.92 : 0.08, friction: rubber ? 0.02 : 0.6 }), true, id);
      equal(engine.setPhysicsBodyTuning(handles.ball, { gravityScale: 0, linearDamping: rubber ? 0.08 : 2.4, angularDamping: 0.2 }), true);
    };
    const configure = () => {
      engine.configureFixedTimestep({ enabled: true, stepSeconds: 1 / 60 });
      engine.configureAutoRigidBodyStep({ gravityX: 0, gravityY: 0, continuous: true, velocityIterations: 8, positionIterations: 6 });
      const idle = { up: { clip: 0 }, down: { clip: 0 }, left: { clip: 0, flipX: true }, right: { clip: 0 } };
      const walk = { up: { clip: 1 }, down: { clip: 1 }, left: { clip: 1, flipX: true }, right: { clip: 1 } };
      equal(engine.configureDataSceneMovementAnimation({ idle, walk }), true);
      material(true);
    };
    configure();
    engine.start();
    // The loop's first callback only records its start time.
    tick?.(clock);
    const cells = () => Number(applied.variables.get("cells"));
    const robot = () => {
      const state = engine.getPhysicsEntity(handles.robot);
      if (!state) throw new Error("Missing robot");
      return state;
    };
    const ball = () => {
      const state = engine.getPhysicsEntity(handles.ball);
      if (!state) throw new Error("Missing ball");
      return { x: state.x, y: state.y, velocityX: state.velocityX, velocityY: state.velocityY };
    };
    const move = (target: { x: number; y: number }) =>
      engine.moveDataSceneActorTo({ ...target, speed: 96, arrivalRadius: 1, cancelOnInput: false });

    const initial = frame();
    equal(initial.gameState, 1);
    equal(initial.entityCount, 258);
    equal(cells(), 0);
    const start = robot();

    // One arrow key issues one 32 px navigation command; the robot walks with the walk clip.
    ok(move({ x: start.x + 32, y: start.y }));
    let walked = false;
    for (let i = 0; i < 120 && robot().x <= start.x + 20; i += 1) {
      frame();
      if (engine.dataSceneSpriteAnimationState(handles.robot)?.clip === 1) walked = true;
    }
    ok(robot().x > start.x + 20, "the robot moved right");
    ok(walked, "the robot played its walk clip");

    engine.pauseDataScene();
    frame();
    const paused = robot();
    frames(15);
    deepEqual([robot().x, robot().y], [paused.x, paused.y], "pause keeps the robot still");
    engine.resumeDataScene();

    for (const [index, target] of destinations.entries()) {
      ok(move(target), `destination ${index} is reachable`);
      for (let i = 0; i < 900 && cells() <= index; i += 1) frame();
      equal(cells(), index + 1, `cell ${index} collected`);
    }

    const launch = (rubber: boolean) => {
      material(rubber);
      equal(engine.setPhysicsBodyPosition(handles.ball, 488, 280), true);
      equal(engine.setPhysicsBodyVelocity(handles.ball, 0, 0), true);
      equal(engine.applyPhysicsBodyImpulse(handles.ball, 180, -110), true);
      ballHits = 0;
    };
    launch(true);
    for (let i = 0; i < 300 && ballHits === 0; i += 1) frame();
    ok(ballHits > 0, "the rubber ball hits a wall");
    frames(15);
    const rubber = ball();
    ok(rubber.velocityX !== 0 || rubber.velocityY !== 0, "the rubber ball keeps moving after a bounce");

    engine.pauseDataScene();
    frame();
    const frozen = ball();
    frames(15);
    deepEqual(ball(), frozen, "pause freezes the ball position and velocity");
    engine.resumeDataScene();
    frames(5);
    ok(ball().x !== frozen.x || ball().y !== frozen.y, "resume moves the ball again");

    launch(false);
    frames(78);
    const clay = ball();
    ok(Math.hypot(clay.velocityX, clay.velocityY) < Math.hypot(rubber.velocityX, rubber.velocityY) * 0.5,
      "clay loses velocity much faster than rubber");

    applied = applyDataSceneAuthoringDocument(engine, scene, { textureId: name => textureNames.indexOf(String(name)) + 1 });
    handles = applied.entityHandles;
    configure();
    const reset = frame();
    equal(reset.entityCount, 258);
    equal(cells(), 0);
    deepEqual([robot().x, robot().y], [64, 296], "reset returns the robot to its start");
  } finally {
    engine.destroy();
    globalThis.requestAnimationFrame = request;
    globalThis.cancelAnimationFrame = cancel;
  }
});
