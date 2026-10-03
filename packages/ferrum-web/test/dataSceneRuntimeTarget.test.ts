import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";

import {
  applyDataSceneAuthoringDocument,
  applySceneBehaviorRecipes,
  classifySceneInstance,
  createDataSceneRuntimeTarget,
  DATA_SCENE_PRIMITIVE_TEXTURES,
  resolveSceneAuthoringDocument,
} from "../src/authoring.js";
import { createEngine, createDataSceneView } from "../src/core.js";
import {
  attachDataSceneRuntimeEngineAdapter,
  type DataSceneRuntimeSpawnRequest,
} from "../src/dataSceneRuntimeTarget.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import { attachMemoryDataSceneVariableRuntime } from "./dataSceneVariableRuntimeTestAdapter.js";
import {
  resolveDataSceneVariableDeclarations,
  synchronizeDataSceneVariableStore,
} from "../src/dataSceneVariables.js";
import type { GameplayEntityHandle } from "../src/gameplayAuthoring.js";

test("createDataSceneRuntimeTarget spawns resolved inline components through the engine adapter", () => {
  const adapter = new MockDataSceneRuntimeAdapter();
  const engine = attachMemoryDataSceneVariableRuntime(
    attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, adapter),
  );
  const target = createDataSceneRuntimeTarget(engine);
  equal(adapter.useDataSceneCalls, 0);
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
    rotationRadians: 0,
    renderLayer: 0,
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
    rotationRadians: 0,
    renderLayer: 0,
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

test("applyDataSceneAuthoringDocument resolves and spawns a scene-authoring document", () => {
  const adapter = new MockDataSceneRuntimeAdapter();
  const engine = attachMemoryDataSceneVariableRuntime(
    attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, adapter),
  );
  const result = applyDataSceneAuthoringDocument(
    engine,
    {
      format: "ferrum2d.consumer.scene-authoring",
      version: 1,
      variables: [
        { name: "campaign.coins", scope: "global", type: "integer", default: 0 },
      ],
      sceneComposition: sampleComposition(),
      behaviorRecipes: { entities: {} },
    },
    {
      path: "documentApply",
    },
  );

  equal(adapter.useDataSceneCalls, 1);
  equal(result.document.format, "ferrum2d.consumer.scene-authoring");
  equal(result.plan.instances.length, 2);
  equal(result.spawnResults.length, 2);
  equal(result.behaviorApplyResult.results.length, 0);
  equal(result.variables.get("campaign.coins"), 0);
  deepEqual(adapter.textureNames, ["agent", "agent"]);
});

test("applyDataSceneAuthoringDocument activates an empty document as a real scene transition", () => {
  const adapter = new MockDataSceneRuntimeAdapter();
  const engine = attachMemoryDataSceneVariableRuntime(
    attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, adapter),
  );
  const result = applyDataSceneAuthoringDocument(engine, {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    variables: [
      { name: "campaign.stage", scope: "global", type: "integer", default: 1 },
      { name: "wave.index", scope: "scene", type: "integer", default: 0 },
    ],
    sceneComposition: {
      initialFragment: "main",
      prefabs: {},
      fragments: { main: { instances: [] } },
    },
    behaviorRecipes: { entities: {} },
  });

  equal(adapter.useDataSceneCalls, 1);
  equal(result.spawnResults.length, 0);
  equal(result.variables.get("campaign.stage"), 1);
  equal(result.variables.get("wave.index"), 0);
});

test("applyDataSceneAuthoringDocument validates variable id overrides before runtime activation", () => {
  const adapter = new MockDataSceneRuntimeAdapter();
  const engine = attachMemoryDataSceneVariableRuntime(
    attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, adapter),
  );

  expectThrows(
    () => applyDataSceneAuthoringDocument(
      engine,
      {
        format: "ferrum2d.consumer.scene-authoring",
        version: 1,
        variables: [
          { name: "campaign.coins", scope: "global", type: "integer", default: 0 },
        ],
        sceneComposition: {
          initialFragment: "main",
          prefabs: {},
          fragments: { main: { instances: [] } },
        },
        behaviorRecipes: { entities: {} },
      },
      {
        path: "overrideApply",
        ids: { variables: { undeclared: 7 } },
      },
    ),
    /overrideApply\.ids\.variables\.undeclared.*references undeclared variable/,
  );
  equal(adapter.useDataSceneCalls, 0);
});

test("applyDataSceneAuthoringDocument preflights the variable runtime before scene activation", () => {
  const adapter = new MockDataSceneRuntimeAdapter();
  const engine = attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, adapter);

  expectThrows(
    () => applyDataSceneAuthoringDocument(engine, {
      format: "ferrum2d.consumer.scene-authoring",
      version: 1,
      variables: [
        { name: "wave.ready", scope: "scene", type: "bool", default: false },
      ],
      sceneComposition: {
        initialFragment: "main",
        prefabs: {},
        fragments: { main: { instances: [] } },
      },
      behaviorRecipes: { entities: {} },
    }),
    /variables\.engine.*must be a FerrumEngine created by createEngine/,
  );
  equal(adapter.useDataSceneCalls, 0);
});

test("applyDataSceneAuthoringDocument rolls back variables after a runtime apply failure", () => {
  const adapter = new MockDataSceneRuntimeAdapter();
  const engine = attachMemoryDataSceneVariableRuntime(
    attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, adapter),
  );
  const previous = synchronizeDataSceneVariableStore(
    engine,
    resolveDataSceneVariableDeclarations([
      { name: "campaign.coins", scope: "global", type: "integer", default: 1 },
    ]),
  );
  previous.set("campaign.coins", 9);
  adapter.failNext = true;

  expectThrows(
    () => applyDataSceneAuthoringDocument(engine, {
      format: "ferrum2d.consumer.scene-authoring",
      version: 1,
      variables: [
        { name: "wave.ready", scope: "scene", type: "bool", default: false },
      ],
      sceneComposition: sampleComposition(),
      behaviorRecipes: { entities: {} },
    }),
    /failed to spawn data-scene entity/,
  );

  equal(previous.get("campaign.coins"), 9);
  equal(previous.has("wave.ready"), false);
});

test("applyDataSceneAuthoringDocument validates components before runtime activation", () => {
  const adapter = new MockDataSceneRuntimeAdapter();
  const engine = attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, adapter);
  expectThrows(
    () => applyDataSceneAuthoringDocument(
      engine,
      {
        format: "ferrum2d.consumer.scene-authoring",
        version: 1,
        sceneComposition: {
          initialFragment: "main",
          prefabs: {
            bad: {
              props: {
                components: { template: "missing.template" },
              },
            },
          },
          fragments: {
            main: {
              instances: [{ id: "bad-1", prefab: "bad" }],
            },
          },
        },
        behaviorRecipes: { entities: {} },
      },
      { path: "badDocumentApply" },
    ),
    /badDocumentApply\.sceneComposition\.instances\.0\.props\.components/,
  );
  equal(adapter.useDataSceneCalls, 0);
  equal(adapter.requests.length, 0);
});

test("createDataSceneRuntimeTarget compiles primitive visual descriptors to debug runtime sprites", () => {
  const adapter = new MockDataSceneRuntimeAdapter();
  const engine = attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, adapter);
  const target = createDataSceneRuntimeTarget(engine, { activateDataScene: false });

  const handle = target.spawnSceneInstance({
    id: "rect_1",
    sourceId: "rect_1",
    prefab: "primitive",
    x: 32,
    y: 48,
    rotationRadians: 0,
    scale: 2,
    layer: 3,
    props: {
      components: {
        visual: { kind: "primitive", shape: "rect", width: 20, height: 10, color: "#7ddc9d" },
        collider: { type: "aabb", halfWidth: 10, halfHeight: 5 },
        layer: "wall",
      },
    },
  });

  deepEqual(handle, { entityId: 101, entityGeneration: 1 });
  deepEqual(adapter.textureNames, [DATA_SCENE_PRIMITIVE_TEXTURES.rect]);
  deepEqual(requestSummary(adapter.requests[0]), {
    x: 32,
    y: 48,
    rotationRadians: 0,
    renderLayer: 3,
    textureId: 77,
    spriteWidth: 40,
    spriteHeight: 20,
    frame: [0, 0, 1, 1],
    animation: [0, 0],
    layer: 3,
    colliderType: 1,
    colliderOffset: [0, 0],
    colliderSize: [20, 10],
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
    rotationRadians: 0,
    renderLayer: 0,
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

test("createDataSceneRuntimeTarget resolves catalog component templates", () => {
  const adapter = new MockDataSceneRuntimeAdapter();
  const engine = attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, adapter);
  const target = createDataSceneRuntimeTarget(engine, {
    activateDataScene: false,
    componentTemplates: {
      "crate.base": {
        sprite: { texture: "crate", width: 12, height: 8 },
        collider: { type: "aabb", halfWidth: 5, halfHeight: 3, offsetX: 1 },
        layer: "wall",
      },
    },
  });

  const handle = target.spawnSceneInstance({
    id: "crate",
    sourceId: "crate",
    prefab: "crate",
    x: 10,
    y: 20,
    rotationRadians: 0,
    scale: 2,
    layer: 0,
    props: { components: { template: "crate.base" } },
  });

  deepEqual(handle, { entityId: 101, entityGeneration: 1 });
  deepEqual(adapter.textureNames, ["crate"]);
  deepEqual(requestSummary(adapter.requests[0]), {
    x: 10,
    y: 20,
    rotationRadians: 0,
    renderLayer: 0,
    textureId: 77,
    spriteWidth: 24,
    spriteHeight: 16,
    frame: [0, 0, 1, 1],
    animation: [0, 0],
    layer: 3,
    colliderType: 1,
    colliderOffset: [2, 0],
    colliderSize: [10, 6],
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

test("applyDataSceneAuthoringDocument spawns the minimum data scene authoring sample", async () => {
  await withNodeWasmFileFetch(async () => {
    const document = await readJsonFileUrl(
      new URL("../../../../docs/engine/samples/data-scene-minimum.scene-authoring.json", import.meta.url),
    );
    const engine = await createEngine(
      undefined,
      undefined,
      undefined,
      () => ({ width: 320, height: 180 }),
    );
    try {
      const result = applyDataSceneAuthoringDocument(
        engine,
        document,
        {
          path: "dataSceneAuthoring",
          missingBehavior: "error",
          textureId: () => 3,
        },
      );

      equal(result.spawnResults.length, 2);
      equal(engine.entityCount(), 2);
      equal(result.plan.commands.length, 4);
      equal(result.behaviorApplyResult.results.length, result.plan.commands.length);
      ok(result.behaviorApplyResult.results.every(Boolean));
      for (const handle of result.spawnResults) {
        ok(Number.isSafeInteger(handle.entityId));
        ok(handle.entityId < 0xffffffff);
        ok(Number.isSafeInteger(handle.entityGeneration));
      }
    } finally {
      engine.destroy();
    }
  });
});

test("applyDataSceneAuthoringDocument configures Rust variables before guarded recipes", async () => {
  await withNodeWasmFileFetch(async () => {
    const engine = await createEngine(
      undefined,
      undefined,
      undefined,
      () => ({ width: 320, height: 180 }),
    );
    try {
      const result = applyDataSceneAuthoringDocument(engine, {
        format: "ferrum2d.consumer.scene-authoring",
        version: 1,
        variables: [
          { name: "combat.enabled", scope: "scene", type: "bool", default: false },
        ],
        sceneComposition: {
          initialFragment: "main",
          prefabs: {
            source: {
              props: {
                behaviorRecipes: "source.guarded",
                components: {
                  sprite: { texture: 1, width: 8, height: 8 },
                  collider: "none",
                  layer: "enemy",
                },
              },
            },
          },
          fragments: {
            main: {
              instances: [{ id: "source-1", prefab: "source" }],
            },
          },
        },
        behaviorRecipes: {
          entities: {
            "source.guarded": {
              recipes: [{
                kind: "damage",
                amount: 1,
                guard: { variable: "combat.enabled", op: "==", value: true },
              }],
            },
          },
        },
      });

      deepEqual(result.behaviorApplyResult.results, [true]);
      equal(result.variables.get("combat.enabled"), false);
    } finally {
      engine.destroy();
    }
  });
});

test("createDataSceneRuntimeTarget spawns passive world objects without behavior commands", async () => {
  await withNodeWasmFileFetch(async () => {
    const resolved = resolveSceneAuthoringDocument(
      {
        format: "ferrum2d.consumer.scene-authoring",
        version: 1,
        sceneComposition: {
          initialFragment: "main",
          prefabs: {
            crate: {
              props: {
                components: {
                  sprite: { texture: 1, width: 16, height: 16 },
                  collider: { type: "aabb", halfWidth: 8, halfHeight: 8 },
                  layer: "wall",
                },
              },
            },
            sentry: {
              props: {
                behaviorRecipes: "sentry.actor",
                components: {
                  sprite: { texture: 1, width: 16, height: 16 },
                  collider: "none",
                  layer: "enemy",
                },
              },
            },
          },
          fragments: {
            main: {
              instances: [
                { id: "crate-1", prefab: "crate", x: 24, y: 24 },
                { id: "sentry-1", prefab: "sentry", x: 64, y: 24 },
              ],
            },
          },
        },
        behaviorRecipes: {
          entities: {
            "sentry.actor": {
              recipes: [{ kind: "health", max: 2, start: 2 }],
            },
          },
        },
      },
      {
        path: "passiveObjectAuthoring",
        validateBindings: true,
        validateComponents: true,
        missingBehavior: "ignore",
      },
    );
    const instances = resolved.bindingPlan?.instances ?? [];
    deepEqual(instances.map((instance) => classifySceneInstance(instance).kind), [
      "worldObject",
      "actor",
    ]);

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
      const result = applySceneBehaviorRecipes(
        engine,
        target,
        resolved.sceneComposition,
        resolved.behaviorRecipes,
        { path: "passiveObjectAuthoring", missingBehavior: "ignore" },
      );

      equal(result.spawnResults.length, 2);
      equal(engine.entityCount(), 2);
      equal(result.plan.commands.length, 1);
      deepEqual(result.plan.commands.map((command) => `${command.entity}:${command.type}`), [
        "sentry-1:configureHealth",
      ]);
      deepEqual(result.behaviorApplyResult.results, [true]);
    } finally {
      engine.destroy();
    }
  });
});

test("createDataSceneRuntimeTarget compiles collider descriptor and instance rotations", () => {
  const adapter = new MockDataSceneRuntimeAdapter();
  const engine = attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, adapter);
  const target = createDataSceneRuntimeTarget(engine, { activateDataScene: false });

  target.spawnSceneInstance({
    id: "oriented-box",
    sourceId: "oriented-box",
    prefab: "block",
    x: 0,
    y: 0,
    rotationRadians: 0,
    scale: 2,
    layer: 0,
    props: {
      components: {
        sprite: { texture: 1, width: 10, height: 10 },
        collider: {
          type: "orientedBox",
          halfWidth: 3,
          halfHeight: 4,
          offsetX: 1,
          offsetY: 2,
          rotationRadians: Math.PI / 2,
        },
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
    rotationRadians: 0,
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
  target.spawnSceneInstance({
    id: "rotated-aabb",
    sourceId: "rotated-aabb",
    prefab: "block",
    x: 0,
    y: 0,
    rotationRadians: Math.PI / 2,
    scale: 2,
    layer: 0,
    props: {
      components: {
        sprite: { texture: 1, width: 10, height: 10 },
        collider: {
          type: "aabb",
          halfWidth: 3,
          halfHeight: 4,
          offsetX: 1,
          offsetY: 2,
        },
        layer: "wall",
      },
    },
  });

  equal(adapter.requests[0].colliderType, 4);
  equal(adapter.requests[0].colliderHalfWidth, 6);
  equal(adapter.requests[0].colliderHalfHeight, 8);
  equal(adapter.requests[0].colliderRotationRadians, Math.PI / 2);
  deepEqual([round(adapter.requests[0].colliderOffsetX), round(adapter.requests[0].colliderOffsetY)], [2, 4]);
  equal(adapter.requests[1].colliderType, 5);
  equal(adapter.requests[1].colliderRotationRadians, 0.25);
  deepEqual(Array.from(adapter.requests[1].colliderVertices), [0, 0, 4, 0, 0, 2]);
  equal(adapter.requests[2].colliderType, 4);
  equal(adapter.requests[2].colliderRotationRadians, Math.PI / 2);
  deepEqual([round(adapter.requests[2].colliderOffsetX), round(adapter.requests[2].colliderOffsetY)], [-4, 2]);
});

test("createDataSceneRuntimeTarget forwards SceneComposition instance layer as render layer", () => {
  const adapter = new MockDataSceneRuntimeAdapter();
  const engine = attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, adapter);
  const target = createDataSceneRuntimeTarget(engine, { activateDataScene: false });

  target.spawnSceneInstance({
    id: "layered",
    sourceId: "layered",
    prefab: "block",
    x: 0,
    y: 0,
    rotationRadians: 0.5,
    scale: 1,
    layer: 2,
    props: {
      components: {
        sprite: { texture: 1, width: 10, height: 10 },
        collider: "none",
        layer: "wall",
      },
    },
  });

  equal(adapter.requests.length, 1);
  equal(adapter.requests[0].renderLayer, 2);
  equal(adapter.requests[0].rotationRadians, 0.5);
  equal(adapter.requests[0].layer, 3);
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
  equal(templateAdapter.useDataSceneCalls, 0);

  const missingTemplateAdapter = new MockDataSceneRuntimeAdapter();
  const missingTemplateTarget = createDataSceneRuntimeTarget(
    attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, missingTemplateAdapter),
    { activateDataScene: false, componentTemplates: {} },
  );
  expectThrows(
    () => missingTemplateTarget.spawnSceneInstance({
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
  equal(missingTemplateAdapter.useDataSceneCalls, 0);

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
    rotationRadians: request.rotationRadians,
    renderLayer: request.renderLayer,
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

async function readJsonFileUrl(fileUrl: URL): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await readNodeFileUrl(fileUrl)));
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

test("visual authoring forwards pivot, tint, render layer precedence and explicit depth sort", () => {
  const adapter = new MockDataSceneRuntimeAdapter();
  const target = createDataSceneRuntimeTarget(attachDataSceneRuntimeEngineAdapter({} as FerrumEngine, adapter));
  target.spawnSceneInstance({ id: "actor", sourceId: "actor", prefab: "actor", x: 300, y: 300,
    scale: 2, rotationRadians: Math.PI / 2, layer: -10,
    props: { components: { visual: { kind: "sprite", texture: 71, width: 32, height: 64,
      originX: 0, originY: 1, layer: 10, sortOrder: 100, depthSort: "hd2d", tint: "#ff000080", color: "#00ff00" },
      collider: { type: "aabb", halfWidth: 8, halfHeight: 8 }, layer: "player" } } });
  const r = adapter.requests[0];
  deepEqual([r.originX, r.originY, r.renderLayer, r.sortOrder, r.depthSort], [0, 1, 10, 100, true]);
  deepEqual(r.color, [1, 0, 0, 128 / 255]);
  deepEqual([r.spriteWidth, r.spriteHeight, r.colliderOffsetX, r.colliderOffsetY], [64, 128, 0, 0]);
});

test("Data Scene body shares the sprite handle and stays generation safe through reapply", async () => {
  await withNodeWasmFileFetch(async () => {
    const engine = await createEngine();
    const document = {
      format: "ferrum2d.consumer.scene-authoring", version: 1,
      sceneComposition: { initialFragment: "main", prefabs: { actor: { props: { components: {
        visual: { kind: "sprite", texture: 71, width: 32, height: 64, originY: 1, depthSort: "hd2d" },
        collider: { type: "aabb", halfWidth: 8, halfHeight: 8 }, layer: "player",
        body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 1 } },
      } } } }, fragments: { main: { instances: [{ id: "actor", prefab: "actor", x: 300, y: 300 }] } } },
      behaviorRecipes: { entities: {} },
    };
    try {
      const actor = applyDataSceneAuthoringDocument(engine, document).entityHandles.actor;
      equal(engine.getPhysicsEntity(actor)?.bodyType, "kinematic");
      equal(engine.moveHd2dKinematicBodyWithTilemap(actor, { displacementX: 20, displacementY: 0, solidMaskBits: 8 })?.body.x, 320);
      ok(engine.queryCircleBodies({ x: 320, y: 300, radius: 1, queryMaskBits: 1 }).some((h) => h.entityId === actor.entityId));
      ok(!engine.queryCircleBodies({ x: 300, y: 300, radius: 1, queryMaskBits: 1 }).some((h) => h.entityId === actor.entityId));
      const next = applyDataSceneAuthoringDocument(engine, document).entityHandles.actor;
      equal(engine.getPhysicsEntity(actor), undefined);
      equal(engine.setPhysicsBodyPosition(actor, 999, 999), false);
      equal(engine.getPhysicsEntity(next)?.x, 300);
      equal(engine.despawnPhysicsEntity(next), true);
      equal(engine.getPhysicsEntity(next), undefined);
    } finally { engine.destroy(); }
  });
});


test("Data Scene view clamps its initial bounded camera using the zoomed viewport", async () => {
  await withNodeWasmFileFetch(async () => {
    const engine = await createEngine();
    try {
      engine.useDataScene();
      engine.setViewportSize(1280, 720);
      let zoom = 1;
      const renderer = {
        setViewportZoom: (value: number) => { zoom = value; },
        viewportSize: () => ({ width: 1280 / zoom, height: 720 / zoom }),
      };
      const canvas = { clientWidth: 1280, clientHeight: 720, width: 2560, height: 1440 } as HTMLCanvasElement;
      const view = createDataSceneView(engine, renderer, canvas, {
        x: 400, y: 300, zoom: 2, bounds: { minX: 0, minY: 0, maxX: 1600, maxY: 1200 },
      });
      // x=400 is valid at zoom 2, but would incorrectly clamp to 640 at zoom 1.
      equal(engine.cameraX(), 400);
      equal(engine.cameraY(), 300);
      equal(view.snapshot().worldMinX, 80);
    } finally {
      engine.destroy();
    }
  });
});
