import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import type { EncodedDataSceneCollisionTilemap } from "../src/dataSceneCollisionTilemap.js";
import { applyDataSceneAuthoringDocument, attachDataSceneRuntimeEngineAdapter } from "../src/dataSceneRuntimeTarget.js";
import { createTilemapSceneApi } from "../src/engineTilemapApi.js";
import type { WasmBridge } from "../src/wasmBridge.js";
import { attachMemoryDataSceneVariableRuntime } from "./dataSceneVariableRuntimeTestAdapter.js";

function document() {
  return {
    format: "ferrum2d.consumer.scene-authoring", version: 1,
    sceneComposition: { initialFragment: "main", prefabs: {}, fragments: { main: { instances: [] } } },
    behaviorRecipes: { entities: {} },
    physics: { space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1, collisionTilemap: {
      columns: 2, rows: 1, tileWidth: 8, tileHeight: 8, tiles: [1, 2],
      definitions: [1, 2].map(id => ({ id, visual: { texture: "tiles", tint: "#808080" } })),
    } },
  };
}

function runtime(options: { encoded?: boolean; rejectPreflight?: boolean } = {}) {
  const events: string[] = [];
  let admitted: EncodedDataSceneCollisionTilemap | undefined, published: EncodedDataSceneCollisionTilemap | undefined;
  const engine = attachMemoryDataSceneVariableRuntime(attachDataSceneRuntimeEngineAdapter({
    applyGameplayBehaviorCommands: (commands: readonly unknown[]) => ({ commands, results: commands.map(() => true) }),
    configureUnifiedPhysics: () => { events.push("world"); },
    configureDataSceneCollisionTilemap: () => { events.push("legacy-publish"); return true; },
  } as unknown as FerrumEngine, {
    useDataScene: () => { events.push("activate"); },
    textureId: name => { events.push(`texture:${name}`); return 23; },
    spawnDataSceneEntity: () => { throw new Error("empty document must not spawn entities"); },
    preflightPhysics: (_world, _bodies, _joints, _path, packet) => {
      events.push("preflight"); admitted = packet;
      if (options.rejectPreflight) throw new Error("old core rejects graphical tiles");
    },
    ...(options.encoded === false ? {} : {
      configureCollisionTilemap: (packet: EncodedDataSceneCollisionTilemap) => {
        events.push("publish"); published = packet; return true;
      },
    }),
  }));
  return { engine, events, packet: () => ({ admitted, published }) };
}

test("graphical tiles compile asset names once and publish the exact admitted working-space packet", () => {
  const r = runtime(), doc = document(), before = structuredClone(doc);
  const result = applyDataSceneAuthoringDocument(r.engine, doc, { colorManagement: "linear-srgb" });
  deepEqual(r.events, ["texture:tiles", "preflight", "activate", "world", "publish"]);
  const { admitted, published } = r.packet();
  if (!admitted) throw new Error("physics preflight did not receive the compiled tilemap");
  equal(admitted, published); equal(admitted.version, 2);
  deepEqual([...admitted.visualMetadata], [2, 2, 1, 23, 2, 23]);
  ok(Math.abs(admitted.visualValues[4] - 0.2158605) < 1e-6);
  equal(result.document.physics?.collisionTilemap?.definitions[0].visual?.texture, "tiles");
  deepEqual(doc, before);
});

test("asset, native capability and spatial camera failures happen before scene replacement", () => {
  const missing = runtime();
  throws(() => applyDataSceneAuthoringDocument(missing.engine, document(), {
    textureId: () => { throw new Error("texture is not loaded"); },
  }), /collisionTilemap.*texture is not loaded/);
  deepEqual(missing.events, []);
  const unsupported = runtime({ encoded: false });
  throws(() => applyDataSceneAuthoringDocument(unsupported.engine, document()), /graphical tilemap authoring/);
  deepEqual(unsupported.events, ["texture:tiles"]);
  const rejected = runtime({ rejectPreflight: true });
  throws(() => applyDataSceneAuthoringDocument(rejected.engine, document()), /old core/);
  deepEqual(rejected.events, ["texture:tiles", "preflight"]);
  const spatial = runtime();
  const doc = { ...document(), spatial: {
    camera: { position: { x: 0, y: -10, elevation: 10 }, target: { x: 0, y: 0, elevation: 0 },
      projection: "orthographic", height: 20, near: 0.1, far: 100 }, terrain: [], billboards: {},
  } };
  throws(() => applyDataSceneAuthoringDocument(spatial.engine, doc), /graphical tilemaps require the planar camera/);
  deepEqual(spatial.events, ["texture:tiles"]);
});

test("collision-only authoring retains the original custom adapter contract", () => {
  const r = runtime({ encoded: false });
  const doc = document();
  const collisionOnly = { ...doc, physics: { ...doc.physics, collisionTilemap: {
    ...doc.physics.collisionTilemap, definitions: [{ id: 1 }, { id: 2 }],
  } } };
  applyDataSceneAuthoringDocument(r.engine, collisionOnly);
  deepEqual(r.events, ["preflight", "activate", "world", "legacy-publish"]);
  equal(r.packet().admitted?.version, 1);
});

test("the public tilemap scene API resolves loaded texture names through its asset host", () => {
  const events: string[] = [], packets: number[][] = [];
  const native = {
    data_scene_collision_tilemap_version: () => 2,
    configure_data_scene_collision_tilemap_v2: (_m: Uint32Array, _v: Float32Array, _c: Uint32Array, visual: Uint32Array) => {
      packets.push([...visual]); return true;
    },
  } as unknown as Engine;
  const api = createTilemapSceneApi({ rustEngine: native, bridge: {} as WasmBridge,
    requireAlive: () => { events.push("alive"); }, textureId: name => { events.push(name); return 37; },
  });
  ok(api.configureDataSceneCollisionTilemap(document().physics.collisionTilemap));
  deepEqual(packets, [[2, 2, 1, 37, 2, 37]]);
  equal(events[0], "alive");
  ok(events.includes("tiles"));
});
