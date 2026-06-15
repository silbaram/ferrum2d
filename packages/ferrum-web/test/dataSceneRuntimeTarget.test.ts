import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";

import {
  applySceneBehaviorRecipes,
  createDataSceneRuntimeTarget,
} from "../src/authoring.js";
import { createEngine } from "../src/core.js";
import {
  attachDataSceneRuntimeEngineAdapter,
  type DataSceneRuntimeSpawnRequest,
} from "../src/dataSceneRuntimeTarget.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import type { GameplayEntityHandle } from "../src/gameplayAuthoring.js";

test("createDataSceneRuntimeTarget spawns resolved inline components through the engine adapter", () => {
  const adapter = new MockDataSceneRuntimeAdapter();
  const engine = attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, adapter);
  const target = createDataSceneRuntimeTarget(engine);
  const result = applySceneBehaviorRecipes(
    {} as Parameters<typeof applySceneBehaviorRecipes>[0],
    target,
    sampleComposition(),
    { entities: {} },
  );

  equal(adapter.useDataSceneCalls, 1);
  deepEqual(adapter.textureNames, ["agent", "agent"]);
  deepEqual(result.spawnResults, [
    { entityId: 101, entityGeneration: 1 },
    { entityId: 102, entityGeneration: 1 },
  ]);
  equal(adapter.requests.length, 2);
  deepEqual(requestSummary(adapter.requests[0]), {
    x: 64,
    y: 96,
    textureId: 77,
    spriteWidth: 48,
    spriteHeight: 32,
    frame: [0.25, 0, 0.75, 1],
    animation: [4, 8],
    layer: 1,
    colliderType: 1,
    colliderOffset: [2, -4],
    colliderSize: [20, 12],
    radius: 0,
    vertices: [],
  });
  deepEqual(requestSummary(adapter.requests[1]), {
    x: 160,
    y: 96,
    textureId: 77,
    spriteWidth: 24,
    spriteHeight: 16,
    frame: [0.25, 0, 0.75, 1],
    animation: [4, 8],
    layer: 1,
    colliderType: 1,
    colliderOffset: [1, -2],
    colliderSize: [10, 6],
    radius: 0,
    vertices: [],
  });
});

test("createDataSceneRuntimeTarget supports activation opt-out and numeric textures", () => {
  const adapter = new MockDataSceneRuntimeAdapter();
  const engine = attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, adapter);
  const target = createDataSceneRuntimeTarget(engine, { activateDataScene: false });

  const handle = target.spawnSceneInstance({
    id: "coin",
    sourceId: "coin",
    prefab: "pickup",
    x: 5,
    y: 7,
    rotationRadians: 0,
    scale: 1,
    layer: 0,
    props: {
      components: {
        sprite: { texture: 9, width: 8, height: 8 },
        collider: "none",
        layer: "pickup",
      },
    },
  });

  deepEqual(handle, { entityId: 101, entityGeneration: 1 });
  equal(adapter.useDataSceneCalls, 0);
  deepEqual(adapter.textureNames, []);
  deepEqual(requestSummary(adapter.requests[0]), {
    x: 5,
    y: 7,
    textureId: 9,
    spriteWidth: 8,
    spriteHeight: 8,
    frame: [0, 0, 1, 1],
    animation: [0, 0],
    layer: 4,
    colliderType: 0,
    colliderOffset: [0, 0],
    colliderSize: [0, 0],
    radius: 0,
    vertices: [],
  });
});

test("createDataSceneRuntimeTarget spawns through createEngine's Wasm adapter", async () => {
  await withNodeWasmFileFetch(async () => {
    const engine = await createEngine(
      undefined,
      undefined,
      undefined,
      () => ({ width: 320, height: 180 }),
    );
    try {
      const target = createDataSceneRuntimeTarget(engine, {
        textureId: () => 3,
      });
      const handle = target.spawnSceneInstance({
        id: "crate",
        sourceId: "crate",
        prefab: "prop",
        x: 12,
        y: 18,
        rotationRadians: 0,
        scale: 1,
        layer: 0,
        props: {
          components: {
            sprite: { texture: "crate", width: 16, height: 16 },
            collider: { type: "aabb", halfWidth: 8, halfHeight: 8 },
            layer: "wall",
          },
        },
      });

      ok(Number.isSafeInteger(handle.entityId));
      ok(handle.entityId < 0xffffffff);
      ok(Number.isSafeInteger(handle.entityGeneration));
      equal(engine.entityCount(), 1);
    } finally {
      engine.destroy();
    }
  });
});

test("createDataSceneRuntimeTarget compiles rotated AABB and convex polygon colliders", () => {
  const adapter = new MockDataSceneRuntimeAdapter();
  const engine = attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, adapter);
  const target = createDataSceneRuntimeTarget(engine, { activateDataScene: false });

  target.spawnSceneInstance({
    id: "rotated",
    sourceId: "rotated",
    prefab: "block",
    x: 0,
    y: 0,
    rotationRadians: Math.PI / 2,
    scale: 2,
    layer: 0,
    props: {
      components: {
        sprite: { texture: 1, width: 10, height: 10 },
        collider: { type: "aabb", halfWidth: 3, halfHeight: 4, offsetX: 1, offsetY: 2 },
        layer: "wall",
      },
    },
  });
  target.spawnSceneInstance({
    id: "polygon",
    sourceId: "polygon",
    prefab: "block",
    x: 0,
    y: 0,
    rotationRadians: 0.5,
    scale: 2,
    layer: 0,
    props: {
      components: {
        sprite: { texture: 1, width: 10, height: 10 },
        collider: {
          type: "convexPolygon",
          vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }],
          rotationRadians: 0.25,
        },
        layer: "wall",
      },
    },
  });

  equal(adapter.requests[0].colliderType, 4);
  equal(adapter.requests[0].colliderHalfWidth, 6);
  equal(adapter.requests[0].colliderHalfHeight, 8);
  equal(adapter.requests[0].colliderRotationRadians, Math.PI / 2);
  deepEqual([round(adapter.requests[0].colliderOffsetX), round(adapter.requests[0].colliderOffsetY)], [-4, 2]);
  equal(adapter.requests[1].colliderType, 5);
  equal(adapter.requests[1].colliderRotationRadians, 0.75);
  deepEqual(Array.from(adapter.requests[1].colliderVertices), [0, 0, 4, 0, 0, 2]);
});

test("createDataSceneRuntimeTarget reports missing adapters, template mode, and failed spawns", () => {
  expectThrows(
    () => createDataSceneRuntimeTarget({} as FerrumEngine),
    /dataSceneRuntimeTarget\.engine/,
  );

  const templateAdapter = new MockDataSceneRuntimeAdapter();
  const templateTarget = createDataSceneRuntimeTarget(
    attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, templateAdapter),
    { activateDataScene: false },
  );
  expectThrows(
    () => templateTarget.spawnSceneInstance({
      id: "templated",
      sourceId: "templated",
      prefab: "agent",
      x: 0,
      y: 0,
      rotationRadians: 0,
      scale: 1,
      layer: 0,
      props: { components: { template: "agent.base" } },
    }),
    /dataSceneRuntimeTarget\.instances\.templated\.props\.components\.template/,
  );

  const failingAdapter = new MockDataSceneRuntimeAdapter();
  failingAdapter.failNext = true;
  const failingTarget = createDataSceneRuntimeTarget(
    attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, failingAdapter),
    { activateDataScene: false },
  );
  expectThrows(
    () => failingTarget.spawnSceneInstance({
      id: "bad",
      sourceId: "bad",
      prefab: "agent",
      x: 0,
      y: 0,
      rotationRadians: 0,
      scale: 1,
      layer: 0,
      props: {
        components: {
          sprite: { texture: 1, width: 8, height: 8 },
          collider: "none",
          layer: "enemy",
        },
      },
    }),
    /dataSceneRuntimeTarget\.instances\.bad/,
  );
});

class MockDataSceneRuntimeAdapter {
  readonly requests: DataSceneRuntimeSpawnRequest[] = [];
  readonly textureNames: string[] = [];
  useDataSceneCalls = 0;
  failNext = false;

  useDataScene(): void {
    this.useDataSceneCalls += 1;
  }

  textureId(name: string): number {
    this.textureNames.push(name);
    return 77;
  }

  spawnDataSceneEntity(request: DataSceneRuntimeSpawnRequest): GameplayEntityHandle | undefined {
    this.requests.push(request);
    if (this.failNext) {
      this.failNext = false;
      return undefined;
    }
    return {
      entityId: 100 + this.requests.length,
      entityGeneration: 1,
    };
  }
}

function sampleComposition() {
  return {
    initialFragment: "main",
    prefabs: {
      agent: {
        props: {
          components: {
            sprite: {
              texture: "agent",
              width: 24,
              height: 16,
              frame: { u0: 0.25, v0: 0, u1: 0.75, v1: 1 },
              animation: { frameCount: 4, fps: 8 },
            },
            collider: {
              type: "aabb",
              halfWidth: 10,
              halfHeight: 6,
              offsetX: 1,
              offsetY: -2,
            },
            layer: "enemy",
          },
        },
      },
    },
    fragments: {
      main: {
        instances: [
          { id: "agent-1", prefab: "agent", x: 64, y: 96, scale: 2 },
          { id: "agent-2", prefab: "agent", x: 160, y: 96 },
        ],
      },
    },
  } as const;
}

function requestSummary(request: DataSceneRuntimeSpawnRequest) {
  return {
    x: request.x,
    y: request.y,
    textureId: request.textureId,
    spriteWidth: request.spriteWidth,
    spriteHeight: request.spriteHeight,
    frame: [request.frameU0, request.frameV0, request.frameU1, request.frameV1],
    animation: [request.animationFrameCount, request.animationFps],
    layer: request.layer,
    colliderType: request.colliderType,
    colliderOffset: [request.colliderOffsetX, request.colliderOffsetY],
    colliderSize: [request.colliderHalfWidth, request.colliderHalfHeight],
    radius: request.colliderRadius,
    vertices: Array.from(request.colliderVertices),
  };
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function expectThrows(action: () => void, messagePattern: RegExp): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof Error)) {
    throw new Error("expected action to throw");
  }
  ok(
    messagePattern.test(thrown.message),
    `expected error message to match ${messagePattern}, got '${thrown.message}'`,
  );
}

async function withNodeWasmFileFetch(action: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const fileUrl = fileUrlFromFetchInput(input);
    if (fileUrl !== undefined) {
      const wasmBytes = await readNodeFileUrl(fileUrl);
      const wasmBody = new ArrayBuffer(wasmBytes.byteLength);
      new Uint8Array(wasmBody).set(wasmBytes);
      return new Response(wasmBody, {
        headers: {
          "Content-Type": "application/wasm",
        },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

type NodeFsPromisesModule = {
  readFile(path: string): Promise<Uint8Array>;
};

type NodeUrlModule = {
  fileURLToPath(url: URL): string;
};

const importNodeModule = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<unknown>;

async function readNodeFileUrl(fileUrl: URL): Promise<Uint8Array> {
  const [fsPromisesModule, urlModule] = await Promise.all([
    importNodeModule("node:fs/promises") as Promise<NodeFsPromisesModule>,
    importNodeModule("node:url") as Promise<NodeUrlModule>,
  ]);
  return fsPromisesModule.readFile(urlModule.fileURLToPath(fileUrl));
}

function fileUrlFromFetchInput(input: Parameters<typeof fetch>[0]): URL | undefined {
  if (input instanceof URL) {
    return input.protocol === "file:" ? input : undefined;
  }
  if (typeof input === "string") {
    return fileUrlFromString(input);
  }
  if (typeof Request === "function" && input instanceof Request) {
    return fileUrlFromString(input.url);
  }
  return undefined;
}

function fileUrlFromString(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "file:" ? url : undefined;
  } catch {
    return undefined;
  }
}
