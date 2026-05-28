import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { resolveShooterGameSpec } from "../src/gameSpec.js";

test("resolveShooterGameSpec rejects invalid physics references with path context", () => {
  try {
    resolveShooterGameSpec({
      physics: {
        materials: { wood: {} },
        bodies: {
          crate: {
            material: "missing",
            collider: { shape: "box", size: [32, 32] },
          },
        },
      },
    });
  } catch (error) {
    equal((error as Error).message.includes("physics.bodies.crate.material"), true);
    return;
  }
  throw new Error("Expected resolveShooterGameSpec to reject missing physics material.");
});

test("resolveShooterGameSpec accepts non-AABB prefab colliders", () => {
  const spec = resolveShooterGameSpec({
    prefabs: {
      player: {
        collider: {
          type: "circle",
          radius: 14,
          offset: { x: 1, y: -2 },
        },
      },
      enemy: {
        collider: {
          type: "capsule",
          start: { x: -5, y: 0 },
          end: { x: 5, y: 0 },
          radius: 3,
          trigger: false,
        },
      },
      bullet: {
        collider: {
          type: "convexPolygon",
          vertices: [
            { x: -2, y: -1 },
            { x: 2, y: -1 },
            { x: 0, y: 2 },
          ],
          rotationRadians: 0.2,
          enabled: false,
        },
      },
    },
  });

  deepEqual(spec.playerCollider, {
    type: "circle",
    radius: 14,
    offsetX: 1,
    offsetY: -2,
    enabled: true,
    trigger: true,
  });
  deepEqual(spec.enemyCollider, {
    type: "capsule",
    startX: -5,
    startY: 0,
    endX: 5,
    endY: 0,
    radius: 3,
    offsetX: 0,
    offsetY: 0,
    enabled: true,
    trigger: false,
  });
  deepEqual(spec.bulletCollider, {
    type: "convexPolygon",
    vertices: [
      { x: -2, y: -1 },
      { x: 2, y: -1 },
      { x: 0, y: 2 },
    ],
    rotationRadians: 0.2,
    offsetX: 0,
    offsetY: 0,
    enabled: false,
    trigger: true,
  });
});

test("resolveShooterGameSpec rejects invalid numbers with path context", () => {
  try {
    resolveShooterGameSpec({ weapons: { cooldown: -1 } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='weapons.cooldown' detail='must be a positive finite number'.",
    );
    return;
  }
  throw new Error("Expected invalid spec to throw.");
});

test("resolveShooterGameSpec rejects invalid score reward with path context", () => {
  try {
    resolveShooterGameSpec({ enemies: { scoreReward: 1.5 } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='enemies.scoreReward' detail='must be a positive integer'.",
    );
    return;
  }
  throw new Error("Expected invalid score reward to throw.");
});

test("resolveShooterGameSpec rejects invalid orbit config with path context", () => {
  try {
    resolveShooterGameSpec({ enemies: { orbit: { radius: 0 } } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='enemies.orbit.radius' detail='must be a positive finite number'.",
    );
    return;
  }
  throw new Error("Expected invalid orbit spec to throw.");
});

test("resolveShooterGameSpec rejects invalid prefab dimensions with path context", () => {
  try {
    resolveShooterGameSpec({ prefabs: { enemy: { width: 0 } } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='prefabs.enemy.width' detail='must be a positive finite number'.",
    );
    return;
  }
  throw new Error("Expected invalid prefab spec to throw.");
});

test("resolveShooterGameSpec rejects invalid prefab collider metadata with path context", () => {
  try {
    resolveShooterGameSpec({ prefabs: { enemy: { collider: { halfWidth: 0 } } } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='prefabs.enemy.collider.halfWidth' detail='must be a positive finite number'.",
    );
    return;
  }
  throw new Error("Expected invalid prefab collider spec to throw.");
});

test("resolveShooterGameSpec rejects invalid prefab collider shape metadata with path context", () => {
  try {
    resolveShooterGameSpec({
      prefabs: { bullet: { collider: { type: "convexPolygon", vertices: [{ x: 0, y: 0 }] } } },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='prefabs.bullet.collider.vertices' detail='must contain 3 to 16 vertices'.",
    );
    return;
  }
  throw new Error("Expected invalid prefab collider shape spec to throw.");
});

test("resolveShooterGameSpec rejects invalid prefab collider material with path context", () => {
  try {
    resolveShooterGameSpec({
      prefabs: { bullet: { collider: { material: { density: 0 } } } },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='prefabs.bullet.collider.material.density' detail='must be a positive finite number'.",
    );
    return;
  }
  throw new Error("Expected invalid prefab collider material spec to throw.");
});

test("resolveShooterGameSpec rejects invalid sprite animation with path context", () => {
  try {
    resolveShooterGameSpec({ prefabs: { enemy: { animation: { frames: 1.5 } } } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='prefabs.enemy.animation.frames' detail='must be a positive integer'.",
    );
    return;
  }
  throw new Error("Expected invalid animation spec to throw.");
});

test("resolveShooterGameSpec rejects unknown enemy behavior with path context", () => {
  try {
    resolveShooterGameSpec({ enemies: { behavior: "circle" } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='enemies.behavior' detail='must be one of chase, drift, static, orbit'.",
    );
    return;
  }
  throw new Error("Expected invalid behavior spec to throw.");
});

test("resolveShooterGameSpec accepts orbit enemy behavior", () => {
  const spec = resolveShooterGameSpec({
    enemies: {
      behavior: "orbit",
      presets: {
        orbiter: { behavior: "orbit", speed: 84, health: 2, scoreReward: 3 },
      },
      waves: [{ enemy: "orbiter", duration: 12, spawnInterval: 1, enemyCount: 4 }],
    },
  });

  equal(spec.enemyBehavior, "orbit");
  equal(spec.enemyBehaviorCode, 3);
  equal(spec.orbitRadius, 180);
  equal(spec.orbitRadialBand, 24);
  deepEqual(spec.waves[0], {
    index: 0,
    enemy: "orbiter",
    duration: 12,
    spawnInterval: 1,
    enemyCount: 4,
    enemySpeed: 84,
    enemyBehavior: "orbit",
    enemyBehaviorCode: 3,
    enemySpawnPattern: "edge",
    enemySpawnPatternCode: 0,
    enemyHealth: 2,
    scoreReward: 3,
  });
});

test("resolveShooterGameSpec rejects unknown spawn pattern with path context", () => {
  try {
    resolveShooterGameSpec({ enemies: { spawnPattern: "spiral" } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='enemies.spawnPattern' detail='must be one of edge, corners, center'.",
    );
    return;
  }
  throw new Error("Expected invalid spawn pattern spec to throw.");
});

test("resolveShooterGameSpec rejects unknown camera preset with path context", () => {
  try {
    resolveShooterGameSpec({ camera: { preset: "orbit" } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='camera.preset' detail='must be one of follow, dead-zone, look-ahead, shake'.",
    );
    return;
  }
  throw new Error("Expected invalid camera preset spec to throw.");
});

test("resolveShooterGameSpec rejects invalid camera numbers with path context", () => {
  try {
    resolveShooterGameSpec({ camera: { deadZone: { width: -1 } } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='camera.deadZone.width' detail='must be a non-negative finite number'.",
    );
    return;
  }
  throw new Error("Expected invalid camera number spec to throw.");
});
