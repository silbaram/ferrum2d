import "./nativeRuntimeTestHelper.js";
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { applyDataSceneAuthoringDocument, resolveSceneAuthoringDocument } from "../src/authoring.js";
import { createEngine } from "../src/createEngine.js";
import type { FrameState } from "../src/engineTypes.js";

// Logic half of smoke:pixel-showcase: the real garden scene on the native engine. The keeper walks
// to each seed, collects it and reset restores the garden. Lighting, palette and effect pixels,
// letterbox pointer mapping and layout stay in the browser smoke.

const seeds = [{ x: 72, y: 72 }, { x: 248, y: 120 }, { x: 168, y: 40 }];
const textures = ["keeper", "keeperNormal", "tiles", "star", "flower"];

test("the pixel garden keeper walks to and collects every seed, and reset restores the garden", async () => {
  const scene = resolveSceneAuthoringDocument(JSON.parse(new TextDecoder().decode(await readFile(
    new URL("../../../../examples/pixel-art/public/scene.json", import.meta.url)))));
  let last: FrameState | undefined;
  const engine = await createEngine(frame => { last = frame; });
  const request = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  let tick: FrameRequestCallback | undefined;
  globalThis.requestAnimationFrame = callback => { tick = callback; return 1; };
  globalThis.cancelAnimationFrame = () => { tick = undefined; };
  let clock = 0;
  const frame = () => {
    if (!tick) throw new Error("Missing scheduled garden frame");
    const callback = tick;
    tick = undefined;
    callback(clock += 16);
    if (!last) throw new Error("Missing garden frame state");
    return last;
  };
  try {
    const apply = () => {
      const applied = applyDataSceneAuthoringDocument(engine, scene, { textureId: name => textures.indexOf(String(name)) + 1 });
      const idle = { up: { clip: 0 }, down: { clip: 0 }, left: { clip: 0, flipX: true }, right: { clip: 0 } };
      const walk = { up: { clip: 1 }, down: { clip: 1 }, left: { clip: 1, flipX: true }, right: { clip: 1 } };
      equal(engine.configureDataSceneMovementAnimation({ idle, walk }), true);
      return applied;
    };
    let applied = apply();
    engine.start();
    // The loop's first callback only records its start time.
    tick?.(clock);
    const keeper = () => applied.entityHandles.keeper;
    const count = () => Number(applied.variables.get("seeds"));
    const initial = frame();
    equal(initial.gameState, 1, "the garden starts playing");
    equal(initial.entityCount, 250);
    equal(count(), 0);
    const start = engine.getPhysicsEntity(keeper());
    ok(start, "keeper physics entity");

    const walkTo = (index: number) => {
      ok(engine.moveDataSceneActorTo({ ...seeds[index], speed: 65, arrivalRadius: 0.5 }));
      let walked = false;
      for (let i = 0; i < 600 && count() <= index; i += 1) {
        frame();
        const animation = engine.dataSceneSpriteAnimationState(keeper());
        if (animation?.clip === 1 && animation.frame > 0) walked = true;
      }
      ok(walked, `seed ${index}: the keeper must play the walk clip while moving`);
      equal(count(), index + 1, `seed ${index} collected`);
    };
    walkTo(0);
    const afterFirst = engine.getPhysicsEntity(keeper());
    ok(afterFirst && start && afterFirst.x < start.x, "the west seed moves the keeper west");
    walkTo(1);
    walkTo(2);
    equal(frame().entityCount, 247, "collected seeds despawn");

    applied = apply();
    frame();
    equal(count(), 0, "reset restores the seed count");
    equal(frame().entityCount, 250, "reset restores every seed");
    const restarted = engine.getPhysicsEntity(keeper());
    deepEqual(restarted && [restarted.x, restarted.y], start && [start.x, start.y], "reset returns the keeper to its start");

    // Pausing stops the walk where it is.
    ok(engine.moveDataSceneActorTo({ ...seeds[0], speed: 65, arrivalRadius: 0.5 }));
    for (let i = 0; i < 10; i += 1) frame();
    engine.pauseDataScene();
    const paused = frame();
    ok(paused.gameState !== 1, "pause leaves the playing state");
    const held = engine.getPhysicsEntity(keeper());
    for (let i = 0; i < 10; i += 1) frame();
    deepEqual(engine.getPhysicsEntity(keeper()), held, "a paused garden keeps the keeper still");
  } finally {
    engine.destroy();
    globalThis.requestAnimationFrame = request;
    globalThis.cancelAnimationFrame = cancel;
  }
});
