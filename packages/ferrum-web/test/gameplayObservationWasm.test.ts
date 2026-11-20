import { deepEqual, equal, ok } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createEngine, initializeFerrumWasm } from "../src/core.js";

test("actual Wasm gameplay observations distinguish native XYZ from projected transforms and stale generations", async () => {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
  const e = await createEngine();
  try {
    e.useDataScene();
    e.configureUnifiedPhysics({ space: "spatial", gravity: [0, 0, 0], lengthUnit: 1 });
    const a = e.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [2, 3, 4] }, renderOffset: [100, 200, 300], collider: { shape: { type: "sphere", radius: 0.5 } } });
    const b = e.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [6, 7, 8] }, collider: { shape: { type: "sphere", radius: 0.5 } } });
    const time = e.time();
    e.removeUnifiedPhysicsBody(b);
    const observed = e.queryGameplayPositions([a, b, a]);
    deepEqual(observed, [{ x: 2, y: 3, z: 4 }, undefined, { x: 2, y: 3, z: 4 }]);
    equal(e.time(), time);
    equal(e.builtInShooterProgress(), undefined);
    e.setUnifiedPhysicsPoses(new Uint32Array([a.entityId, a.entityGeneration]), new Float32Array([9, 8, 7, 0, 0, 0, 1]));
    deepEqual(e.queryGameplayPositions([a]), [{ x: 9, y: 8, z: 7 }]);
    deepEqual(observed[0], { x: 2, y: 3, z: 4 });
  } finally { e.destroy(); }
});

test("actual Wasm legacy observations and native Shooter progress use the same read-only public API", async () => {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
  for (const physicsBackend of ["legacy", "unified"] as const) {
    const e = await createEngine(undefined, undefined, undefined, undefined, { physicsBackend });
    try {
      const player = e.builtInShooterPlayerHandle();
      if (!player) throw new Error("Built-in Shooter must have a current player handle.");
      e.applyGameplayBehaviorCommands([{
        entity: "player", recipe: "primary", tags: [], type: "configureProjectileAction",
        action: "primary", actionId: 1, cooldownSeconds: 0.5, speed: 720, damage: 12, lifetimeSeconds: 3,
      }], { player });
      if (physicsBackend === "unified") {
        e.queryUnifiedPhysicsBodyStates(new Uint32Array([player.entityId, player.entityGeneration]));
      }
      const before = e.time();
      deepEqual(e.builtInShooterProgress(), { activeWaveIndex: 0, waveElapsedSeconds: 0, waveSpawnedCount: 0 });
      equal(e.builtInShooterPlayerActions()?.primaryAction?.actionId, 1);
      if (physicsBackend === "legacy") {
        ok(e.setBuiltInSceneEntityPosition(player, 123, 234));
      } else {
        // A pure observation reads the actual body. Authored World edits are
        // pending until native preparation; use the immediate native teleport.
        e.setUnifiedPhysicsPoses(new Uint32Array([player.entityId, player.entityGeneration]),
          new Float32Array([123, 234, 0, 0, 0, 0, 1]));
      }
      deepEqual(e.queryGameplayPositions([player]), [{ x: 123, y: 234, z: 0 }]);
      equal(e.time(), before);
      deepEqual(e.queryGameplayPositions([]), []);
    } finally { e.destroy(); }
  }
});
