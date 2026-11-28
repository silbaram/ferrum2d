import "./nativeRuntimeTestHelper.js";
import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createEngine } from "../src/createEngine.js";
import type { FerrumEngine, FrameState } from "../src/engineTypes.js";
import { ParticleVfxEmitter, particleVfxPreset } from "../src/particleVfx.js";

// Logic half of smoke:breakout-effects, smoke:platformer-effects and smoke:particle-vfx: native
// effects spawn real particles that reach the render commands. Particle pixels and frame budgets
// stay in the browser smokes.

async function playUntilBurst(name: string, use: (engine: FerrumEngine) => void, seed: number) {
  let last: FrameState | undefined;
  const engine = await createEngine(frame => { last = frame; }, undefined, undefined, () => ({ width: 800, height: 480 }));
  const request = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  let tick: FrameRequestCallback | undefined;
  globalThis.requestAnimationFrame = callback => { tick = callback; return 1; };
  globalThis.cancelAnimationFrame = () => { tick = undefined; };
  try {
    engine.setViewportSize(800, 480);
    use(engine);
    engine.clearParticles();
    engine.setParticleSeed(seed);
    engine.resetGame();
    engine.start();
    let clock = 0;
    // The loop's first callback only records its start time.
    tick?.(clock);
    for (let frame = 0; frame < 600; frame += 1) {
      const callback = tick;
      if (!callback) throw new Error(`${name}: missing scheduled frame`);
      tick = undefined;
      callback(clock += 1000 / 60);
      if (!last) throw new Error(`${name}: missing frame state`);
      if (last.gameState === 1 && engine.particleCount() > 0
        && last.renderCommandBuffer.commandCount >= last.entityCount + 1) {
        return { frame, particles: engine.particleCount(), commands: last.renderCommandBuffer.commandCount, entities: last.entityCount };
      }
    }
    throw new Error(`${name}: no particle burst within 600 frames (state ${last?.gameState}, particles ${engine.particleCount()})`);
  } finally {
    engine.destroy();
    globalThis.requestAnimationFrame = request;
    globalThis.cancelAnimationFrame = cancel;
  }
}

test("Breakout bursts brick-hit particles and Platformer bursts landing dust after a seeded reset", async () => {
  const breakout = await playUntilBurst("Breakout", engine => engine.useBreakoutGame(), 23);
  const platformer = await playUntilBurst("Platformer", engine => engine.usePlatformerGame(), 31);
  for (const result of [breakout, platformer]) {
    ok(result.particles > 0);
    ok(result.commands > result.entities, "particles reach the render commands");
  }
  // The same seed reaches the same burst on the same frame.
  const repeated = await playUntilBurst("Breakout", engine => engine.useBreakoutGame(), 23);
  equal(repeated.frame, breakout.frame);
  equal(repeated.particles, breakout.particles);
});

test("a motion-trail emitter on the native engine bursts by distance like the minimal game example", async () => {
  let last: FrameState | undefined;
  let frames = 0;
  // The example shell presses Enter to leave the title screen.
  const input = () => ({ w: false, a: false, s: false, d: false, space: false, enter: frames < 3, mouseLeft: false, mouseX: 0, mouseY: 0 });
  const engine = await createEngine(frame => { last = frame; frames += 1; }, input, undefined, () => ({ width: 640, height: 400 }));
  const request = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  let tick: FrameRequestCallback | undefined;
  globalThis.requestAnimationFrame = callback => { tick = callback; return 1; };
  globalThis.cancelAnimationFrame = () => { tick = undefined; };
  try {
    engine.setTextureIds({ player: 0, enemy: 0, bullet: 0 });
    const emitter = ParticleVfxEmitter.create({ target: engine, presetId: 5, preset: particleVfxPreset("motion-trail", 0) });
    engine.start();
    let clock = 0;
    tick?.(clock);
    let observed = false;
    let started = false;
    for (let frame = 0; frame < 240 && !observed; frame += 1) {
      const callback = tick;
      if (!callback) throw new Error("missing scheduled frame");
      tick = undefined;
      callback(clock += 1000 / 60);
      if (!last) throw new Error("missing frame state");
      if (!started) { emitter.start(last.cameraX, last.cameraY); started = true; }
      // The example's curve around its view center; off-screen particles emit no commands.
      emitter.update(last.frameTimeMs / 1000, last.cameraX + Math.sin(last.timeSeconds * 8) * 80, last.cameraY + Math.cos(last.timeSeconds * 5) * 24);
      const snapshot = emitter.snapshot();
      observed = last.gameState === 1 && snapshot.mode === "trail" && snapshot.emittedBurstCount >= 2 && snapshot.spawnedParticleCount >= 4
        && engine.particleCount() > 0 && last.renderCommandBuffer.commandCount > 1;
    }
    ok(observed, `trail emitter did not spawn visible particles: ${JSON.stringify(emitter.snapshot())}`);
  } finally {
    engine.destroy();
    globalThis.requestAnimationFrame = request;
    globalThis.cancelAnimationFrame = cancel;
  }
});
