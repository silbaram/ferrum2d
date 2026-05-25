import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import type {
  FerrumEngine,
  PhysicsBodyColliderOptions,
  PhysicsEntityHandle,
  PhysicsJointHandle,
  PhysicsJointSpawnOptions,
  PhysicsRigidBodySpawnOptions,
} from "../src/createEngine.js";
import { createPixelMaskTerrain } from "../src/pixelMaskTerrain.js";
import type { PixelMaskTerrain, PixelMaskTerrainAlphaPatch } from "../src/pixelMaskTerrain.js";
import {
  createPixelMaskTerrainRuntime,
  type PixelMaskTerrainTextureTarget,
} from "../src/pixelMaskTerrainRuntime.js";

class FakeTerrainEngine {
  bodies: PhysicsRigidBodySpawnOptions[] = [];
  despawnedBodies: PhysicsEntityHandle[] = [];
  clearedJoints: PhysicsJointHandle[] = [];
  fixedTimestep: unknown;
  debugLines: unknown;

  configureFixedTimestep(options: unknown): void {
    this.fixedTimestep = options;
  }

  setPhysicsDebugLinesEnabled(options: unknown): void {
    this.debugLines = options;
  }

  spawnRigidBody(options: PhysicsRigidBodySpawnOptions): PhysicsEntityHandle {
    this.bodies.push(options);
    return { entityId: this.bodies.length, entityGeneration: 1 };
  }

  addPhysicsBodyCollider(_handle: PhysicsEntityHandle, _options: PhysicsBodyColliderOptions): boolean {
    return true;
  }

  setPhysicsBodyColliderMaterial(): boolean {
    return true;
  }

  setPhysicsBodyMassProperties(): boolean {
    return true;
  }

  spawnPhysicsJoint(options: PhysicsJointSpawnOptions): PhysicsJointHandle {
    return { jointType: options.type, jointIndex: 0, jointGeneration: 1 };
  }

  clearPhysicsJoint(handle: PhysicsJointHandle): boolean {
    this.clearedJoints.push(handle);
    return true;
  }

  despawnPhysicsEntity(handle: PhysicsEntityHandle): boolean {
    this.despawnedBodies.push(handle);
    return true;
  }
}

class FakeTextureTarget implements PixelMaskTerrainTextureTarget {
  created: Array<{ textureId: number; width: number; height: number }> = [];
  updated: Array<{ textureId: number; patch: PixelMaskTerrainAlphaPatch }> = [];

  createPixelMaskTerrainTexture(textureId: number, terrain: PixelMaskTerrain): void {
    this.created.push({ textureId, width: terrain.width, height: terrain.height });
  }

  updatePixelMaskTerrainTexture(textureId: number, patch: PixelMaskTerrainAlphaPatch): void {
    this.updated.push({
      textureId,
      patch: {
        rect: { ...patch.rect },
        alpha: new Uint8Array(patch.alpha),
      },
    });
  }
}

test("PixelMaskTerrainRuntime uploads dirty texture patches and rebuilds owned collider chunks", () => {
  const terrain = createPixelMaskTerrain({ width: 4, height: 4, fill: "solid" });
  const fakeEngine = new FakeTerrainEngine();
  const textureTarget = new FakeTextureTarget();
  const runtime = createPixelMaskTerrainRuntime({
    terrain,
    texture: { target: textureTarget, textureId: 9 },
    physics: {
      engine: fakeEngine as unknown as FerrumEngine,
      chunkWidth: 2,
      chunkHeight: 2,
      maxDirtyChunksPerSync: 4,
      baseSpec: {
        mode: "rigid",
        layers: { world: { mask: [] } },
        debug: { colliders: true },
      },
      boundary: {
        tileWidth: 4,
        tileHeight: 4,
        physicsLayer: "world",
      },
    },
  });

  equal(textureTarget.created.length, 1);
  deepEqual(textureTarget.created[0], { textureId: 9, width: 4, height: 4 });
  equal(fakeEngine.bodies.length, 4);
  equal(terrain.dirtyRect(), undefined);
  const initialBodyCount = fakeEngine.bodies.length;

  const result = runtime.carveRect(1, 1, 1, 1);

  equal(result.textureUploaded, true);
  deepEqual(result.texturePatch, { x: 1, y: 1, width: 1, height: 1 });
  equal(textureTarget.updated.length, 1);
  deepEqual(textureTarget.updated[0]?.patch.rect, { x: 1, y: 1, width: 1, height: 1 });
  deepEqual(Array.from(textureTarget.updated[0]?.patch.alpha ?? []), [0]);
  equal(result.colliderChunksRebuilt, 1);
  equal(fakeEngine.despawnedBodies.length, 1);
  ok(fakeEngine.bodies.length > initialBodyCount);
  equal(terrain.dirtyRect(), undefined);

  runtime.destroy();
  ok(fakeEngine.despawnedBodies.length >= 4);
});

test("PixelMaskTerrainRuntime enforces dirty chunk rebuild budget", () => {
  const terrain = createPixelMaskTerrain({ width: 4, height: 4, fill: "solid" });
  const fakeEngine = new FakeTerrainEngine();
  const runtime = createPixelMaskTerrainRuntime({
    terrain,
    physics: {
      engine: fakeEngine as unknown as FerrumEngine,
      applyOnCreate: false,
      chunkWidth: 1,
      chunkHeight: 1,
      maxDirtyChunksPerSync: 1,
    },
  });

  let rejected = false;
  try {
    runtime.carveRect(0, 0, 2, 2);
  } catch (error) {
    rejected = String(error).includes("exceeds maxDirtyChunksPerSync=1");
  }

  equal(rejected, true);
  deepEqual(terrain.dirtyRect(), { x: 0, y: 0, width: 2, height: 2 });
  equal(fakeEngine.bodies.length, 0);
});
