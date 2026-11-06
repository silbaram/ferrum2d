import "./nativeRuntimeTestHelper.js";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { createEngine } from "../src/createEngine.js";
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
  // Runtime owns its collider bindings, while the caller owns the supplied mask.
  equal(terrain.setPixel(0, 0, 0), true);
  terrain.destroy();
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
  runtime.destroy();
  terrain.destroy();
});

test("PixelMaskTerrainRuntime reads native solidity once for all chunks and never classifies alpha in TS", () => {
  const terrain = createPixelMaskTerrain({ width: 4, height: 4, solidThreshold: 128, fill: "solid" });
  let reads = 0;
  const solidData = terrain.solidData.bind(terrain);
  terrain.solidData = () => { reads += 1; return solidData(); };
  Object.defineProperty(terrain, "data", { get() { throw new Error("unexpected alpha snapshot"); } });
  terrain.isSolid = () => { throw new Error("unexpected per-pixel native call"); };
  terrain.alphaAt = () => { throw new Error("unexpected per-pixel native call"); };
  const engine = new FakeTerrainEngine();
  const runtime = createPixelMaskTerrainRuntime({
    terrain,
    physics: { engine: engine as unknown as FerrumEngine, chunkWidth: 1, chunkHeight: 1 },
  });
  try {
    equal(reads, 1);
    equal(engine.bodies.length, 16);
    // 127 is occupied in an alpha>0 implementation, but empty at native threshold 128.
    const result = runtime.carveRect(0, 0, 4, 4, 127);
    equal(reads, 2);
    equal(result.colliderChunksRebuilt, 16);
    equal(result.colliderBodies, 0);
    equal(engine.despawnedBodies.length, 16);
    runtime.sync();
    equal(reads, 2);
  } finally {
    runtime.destroy();
    terrain.destroy();
  }
});

test("PixelMaskTerrainRuntime retains edits made by a texture target for the next texture and collider sync", () => {
  const terrain = createPixelMaskTerrain({ width: 2, height: 1, fill: "solid" });
  const engine = new FakeTerrainEngine();
  const patches: PixelMaskTerrainAlphaPatch[] = [];
  let editDuringUpload = true;
  const runtime = createPixelMaskTerrainRuntime({
    terrain,
    texture: {
      textureId: 1,
      target: {
        createPixelMaskTerrainTexture() {},
        updatePixelMaskTerrainTexture(_textureId, patch) {
          patches.push(patch);
          if (editDuringUpload) {
            editDuringUpload = false;
            terrain.setPixel(1, 0, 0);
          }
        },
      },
    },
    physics: { engine: engine as unknown as FerrumEngine, chunkWidth: 1, chunkHeight: 1 },
  });
  try {
    const first = runtime.setPixel(0, 0, 0);
    equal(first.colliderChunksRebuilt, 1);
    equal(first.colliderBodies, 1);
    equal(first.terrainVersion, 2);
    deepEqual(patches[0]?.rect, { x: 0, y: 0, width: 1, height: 1 });
    deepEqual(terrain.dirtyRect(), { x: 0, y: 0, width: 2, height: 1 });
    const second = runtime.sync();
    equal(second.colliderChunksRebuilt, 2);
    equal(second.colliderBodies, 0);
    deepEqual(patches[1]?.rect, { x: 0, y: 0, width: 2, height: 1 });
    deepEqual(Array.from(patches[1]!.alpha), [0, 0]);
    equal(terrain.dirtyRect(), undefined);
  } finally {
    runtime.destroy();
    terrain.destroy();
  }
});

async function nativeTerrain(width = 1, fill: "solid" | "empty" = "empty") {
  const engine = await createEngine();
  engine.useDataScene();
  const terrain = createPixelMaskTerrain({ width, height: 1, fill });
  return { engine, terrain, physics: { engine, chunkWidth: 1, chunkHeight: 1 } };
}

test("terrain runtime rejects nested edits before mutation and retains raw native edits for a later sync", async () => {
  const { engine, terrain, physics } = await nativeTerrain();
  let once = true;
  const uploaded: number[] = [];
  const runtime = createPixelMaskTerrainRuntime({ terrain, physics, texture: { textureId: 1, target: {
    createPixelMaskTerrainTexture() {},
    updatePixelMaskTerrainTexture(_id, patch) {
      uploaded.push(patch.alpha[0]);
      if (!once) return;
      once = false;
      const version = terrain.version;
      for (const edit of [
        () => runtime.setPixel(0, 0, 0), () => runtime.carveRect(0, 0, 1, 1),
        () => runtime.carveCircle(0.5, 0.5, 1), () => runtime.sync(),
      ]) throws(edit, /reentrantly/);
      equal(terrain.version, version);
      equal(terrain.alphaAt(0, 0), 255);
      terrain.setPixel(0, 0, 0);
      throws(() => runtime.sync(), /reentrantly/);
    },
  } } });
  try {
    runtime.setPixel(0, 0, 255);
    ok(terrain.dirtyRect());
    const retry = runtime.sync();
    deepEqual(uploaded, [255, 0]);
    equal(retry.colliderBodies, 0);
    equal(engine.entityCount(), 0);
    equal(terrain.dirtyRect(), undefined);
  } finally { runtime.destroy(); terrain.destroy(); engine.destroy(); }
});

test("terrain runtime leaves an uncaught nested-sync failure retryable", async () => {
  const { engine, terrain, physics } = await nativeTerrain();
  let reenter = true;
  const runtime = createPixelMaskTerrainRuntime({ terrain, physics, texture: { textureId: 1, target: {
    createPixelMaskTerrainTexture() {},
    updatePixelMaskTerrainTexture() { if (reenter) runtime.sync(); },
  } } });
  try {
    throws(() => runtime.setPixel(0, 0, 255), /reentrantly/);
    equal(engine.entityCount(), 0);
    ok(terrain.dirtyRect());
    reenter = false;
    equal(runtime.sync().colliderBodies, 1);
    equal(engine.entityCount(), 1);
    equal(terrain.dirtyRect(), undefined);
  } finally { runtime.destroy(); terrain.destroy(); engine.destroy(); }
});

for (const callback of ["texture", "warning", "spawn"] as const) {
  test(`terrain runtime stops and cleans newly created native bodies after destroy from ${callback}`, async () => {
    const { engine, terrain, physics } = await nativeTerrain();
    const runtime = createPixelMaskTerrainRuntime({ terrain,
      physics: { ...physics, baseSpec: { gravity: [0, 10000] },
        onWarning() { if (callback === "warning") runtime.destroy(); } },
      texture: { textureId: 1, target: {
        createPixelMaskTerrainTexture() {},
        updatePixelMaskTerrainTexture() { if (callback === "texture") runtime.destroy(); },
      } },
    });
    const spawn = engine.spawnRigidBody;
    if (callback === "spawn") engine.spawnRigidBody = (options) => {
      const handle = spawn(options);
      runtime.destroy();
      return handle;
    };
    try {
      throws(() => runtime.setPixel(0, 0, 255), /destroyed/);
      equal(engine.entityCount(), 0);
      runtime.destroy();
      equal(engine.entityCount(), 0);
      equal(terrain.alphaAt(0, 0), 255); // Caller still owns the terrain.
      ok(terrain.dirtyRect());
    } finally { runtime.destroy(); terrain.destroy(); engine.destroy(); }
  });
}

test("terrain constructor failure rolls back completed native chunks and preserves caller terrain", async () => {
  const { engine, terrain, physics } = await nativeTerrain(2, "solid");
  const original = new Error("second chunk warning failed");
  let warnings = 0;
  try {
    let caught: unknown;
    try {
      createPixelMaskTerrainRuntime({ terrain, physics: {
        ...physics, baseSpec: { gravity: [0, 10000] },
        onWarning() { if (++warnings === 2) throw original; },
      } });
    } catch (error) { caught = error; }
    equal(caught, original);
    equal(engine.entityCount(), 0);
    deepEqual(Array.from(terrain.data), [255, 255]);
    const replacement = createPixelMaskTerrainRuntime({ terrain, physics });
    equal(engine.entityCount(), 2);
    replacement.destroy();
    equal(engine.entityCount(), 0);
  } finally { terrain.destroy(); engine.destroy(); }
});

test("failed forced collider replacement retains old native bodies and retries from a clean mask", async () => {
  const { engine, terrain, physics } = await nativeTerrain(2, "solid");
  let warnings = 0, fail = false;
  const runtime = createPixelMaskTerrainRuntime({ terrain, physics: {
    ...physics, baseSpec: { gravity: [0, 10000] },
    onWarning() { if (fail && ++warnings === 2) throw new Error("forced second chunk failed"); },
  } });
  try {
    fail = true;
    throws(() => runtime.sync({ force: true }), /forced second chunk failed/);
    equal(terrain.dirtyRect(), undefined);
    equal(engine.entityCount(), 2);
    fail = false;
    const retry = runtime.sync();
    equal(retry.colliderChunksRebuilt, 2);
    equal(retry.colliderBodies, 2);
    equal(engine.entityCount(), 2);
    equal(runtime.sync().colliderChunksRebuilt, 0);
  } finally { runtime.destroy(); terrain.destroy(); engine.destroy(); }
});

test("failed forced texture creation is retried even when native alpha has no dirty region", async () => {
  const { engine, terrain, physics } = await nativeTerrain(1, "solid");
  let creates = 0;
  const runtime = createPixelMaskTerrainRuntime({ terrain, physics, texture: { textureId: 1, target: {
    createPixelMaskTerrainTexture() { if (++creates === 2) throw new Error("forced upload failed"); },
    updatePixelMaskTerrainTexture() { throw new Error("expected a full upload"); },
  } } });
  try {
    throws(() => runtime.sync({ force: true }), /forced upload failed/);
    equal(terrain.dirtyRect(), undefined);
    const retry = runtime.sync();
    equal(creates, 3);
    equal(retry.textureUploaded, true);
    equal(retry.colliderChunksRebuilt, 1);
    equal(retry.colliderBodies, engine.entityCount());
  } finally { runtime.destroy(); terrain.destroy(); engine.destroy(); }
});

test("terrain destroy attempts remaining chunks if an engine cleanup callback throws", async () => {
  const { engine, terrain, physics } = await nativeTerrain(2, "solid");
  const runtime = createPixelMaskTerrainRuntime({ terrain, physics });
  const despawn = engine.despawnPhysicsEntity;
  let calls = 0;
  engine.despawnPhysicsEntity = (handle) => {
    const result = despawn(handle);
    if (++calls === 1) throw new Error("cleanup callback failed after despawn");
    return result;
  };
  try {
    throws(() => runtime.destroy(), /cleanup callback failed after despawn/);
    equal(calls, 2);
    equal(engine.entityCount(), 0);
    runtime.destroy();
    equal(calls, 2);
  } finally { runtime.destroy(); terrain.destroy(); engine.destroy(); }
});
