import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import { configureDataSceneCollisionTilemap, configureEncodedDataSceneCollisionTilemap,
  encodeDataSceneCollisionTilemap, validateDataSceneCollisionTilemap,
  type DataSceneCollisionTilemapOptions } from "../src/dataSceneCollisionTilemap.js";
import { resolveDataScenePhysics } from "../src/dataScenePhysics.js";
import { resolveSceneAuthoringDocument, type SceneAuthoringDocumentSpec } from "../src/sceneAuthoringDocument.js";
import { createScenePlacementViewer } from "../src/scenePlacementViewer.js";
import { mergeScenePlacementPatch } from "../src/scenePlacementPatch.js";
import { createScenePlacementAgentHandoff } from "../src/scenePlacementHandoff.js";

function grid(): DataSceneCollisionTilemapOptions {
  return { columns: 2, rows: 1, tileWidth: 10, tileHeight: 8, tiles: [1, 2],
    definitions: [{ id: 1, visual: { texture: "terrain", frame: { u0: 0.25, u1: 0.5 }, tint: "#80402080" } }, { id: 2 }] };
}

test("graphical tilemap adds versioned visuals while preserving exact collision buffers and invisible definitions", () => {
  const source = grid(), collisionOnly = { ...source, definitions: source.definitions.map(({ visual: _v, ...d }) => d) };
  const previous = encodeDataSceneCollisionTilemap(collisionOnly);
  const names: string[] = [];
  const packet = encodeDataSceneCollisionTilemap(source, { textureId: name => { names.push(name); return 17; } });
  equal(previous.version, 1); equal(packet.version, 2);
  deepEqual(packet.metadata, previous.metadata); deepEqual(packet.values, previous.values); deepEqual(packet.cells, previous.cells);
  deepEqual([...packet.visualMetadata], [2, 1, 1, 17]);
  deepEqual([...packet.visualValues.slice(0, 4)], [0.25, 0, 0.5, 1]);
  deepEqual([...packet.visualValues.slice(4)], [128, 64, 32, 128].map(n => Math.fround(n / 255)));
  deepEqual(names, ["terrain"]);
  deepEqual(source, grid(), "cold compilation never rewrites authored asset references");
});

test("graphical tilemap compiles the same sRGB tint into the selected working space", () => {
  const options = grid(), legacy = encodeDataSceneCollisionTilemap(options, { textureId: () => 3 });
  const linear = encodeDataSceneCollisionTilemap(options, { textureId: () => 3, colorManagement: "linear-srgb" });
  ok(linear.visualValues[4] < legacy.visualValues[4]);
  equal(linear.visualValues[7], legacy.visualValues[7]);
});

test("graphical tilemap requires explicit v2 capability and never falls back to invisible v1 graphics", () => {
  let calls = 0;
  const packet = encodeDataSceneCollisionTilemap(grid(), { textureId: () => 5 });
  for (const native of [
    { configure_data_scene_collision_tilemap() { calls++; return true; } },
    { configure_data_scene_collision_tilemap_v2() { calls++; return true; } },
    { data_scene_collision_tilemap_version: () => 1, configure_data_scene_collision_tilemap_v2() { calls++; return true; } },
  ]) throws(() => configureEncodedDataSceneCollisionTilemap(native as unknown as Engine, packet), /graphical tilemaps v2/);
  equal(calls, 0);
  const native = { data_scene_collision_tilemap_version: () => 2,
    configure_data_scene_collision_tilemap_v2(metadata: Uint32Array, values: Float32Array, cells: Uint32Array, vm: Uint32Array, vf: Float32Array) {
      calls++;
      equal(metadata, packet.metadata); equal(values, packet.values); equal(cells, packet.cells);
      equal(vm, packet.visualMetadata); equal(vf, packet.visualValues);
      return false;
    } } as unknown as Engine;
  equal(configureEncodedDataSceneCollisionTilemap(native, packet), false);
  equal(calls, 1);
  throws(() => configureEncodedDataSceneCollisionTilemap(native, { ...packet, version: 1 }), /require packet version 2/);
  equal(calls, 1, "visual buffers cannot be silently downgraded to v1");
});

test("graphical tilemap rejects malformed authoring and missing references before any native mutation", () => {
  let calls = 0;
  const native = { configure_data_scene_collision_tilemap() { calls++; return true; },
    data_scene_collision_tilemap_version: () => 2, configure_data_scene_collision_tilemap_v2() { calls++; return true; } } as unknown as Engine;
  throws(() => configureDataSceneCollisionTilemap(native, grid()), /resolver/);
  throws(() => configureDataSceneCollisionTilemap(native, grid(), { textureId() { throw new Error("missing terrain asset"); } }), /missing terrain asset/);
  for (const visual of [
    { texture: "" }, { texture: -1 }, { texture: 0x1000000 }, { texture: 1.5 }, { texture: NaN },
    { texture: 1, frame: { u0: 0.5, u1: 0.5 } },
    { texture: 1, frame: { u0: 0.5, u1: 0.500000001 } },
    { texture: 1, frame: { v1: 1.1 } }, { texture: 1, frame: { u1: Infinity } },
    { texture: 1, tint: "red" }, { texture: 1, tint: 5 }, { texture: 1, unsupported: true },
  ]) {
    const input = { ...grid(), definitions: [{ id: 1, visual }, { id: 2 }] } as unknown as DataSceneCollisionTilemapOptions;
    throws(() => configureDataSceneCollisionTilemap(native, input));
  }
  for (const id of [0x1000000, -1, NaN, 1.5])
    throws(() => configureDataSceneCollisionTilemap(native, grid(), { textureId: () => id }), /texture/);
  equal(calls, 0);
});

test("graphical tilemap syntax validation preserves JSON asset refs and excludes spatial physics", () => {
  const input = { ...grid(), tiles: [1, 2] };
  validateDataSceneCollisionTilemap(input);
  const resolved = resolveDataScenePhysics({ space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1, collisionTilemap: input });
  deepEqual(resolved.collisionTilemap, input);
  throws(() => resolveDataScenePhysics({ space: "spatial", gravity: [0, 0, 0], lengthUnit: 1, collisionTilemap: input }), /planar-xy/);
  throws(() => validateDataSceneCollisionTilemap({ ...input, definitions: [{ id: 1, visual: { texture: "" } }, { id: 2 }] }), /non-empty/);
});

test("graphical tilemap bounds admit all 256 visual definitions and maximum grid without truncation", () => {
  const options: DataSceneCollisionTilemapOptions = { columns: 256, rows: 256, tileWidth: 1, tileHeight: 1,
    tiles: new Uint32Array(65536).fill(256), definitions: Array.from({ length: 256 }, (_, i) => ({ id: i + 1, visual: { texture: i === 255 ? 0xffffff : i } })) };
  const packet = encodeDataSceneCollisionTilemap(options);
  equal(packet.version, 2); equal(packet.visualMetadata.length, 514); equal(packet.visualValues.length, 2048);
  equal(packet.visualMetadata[513], 0xffffff); equal(packet.cells[65535], 256);
  options.definitions[0].visual!.texture = 99;
  equal(packet.visualMetadata[3], 0, "packet owns compiled values");
});

test("graphical tilemap JSON survives generic placement export and agent handoff paths", () => {
  const document: SceneAuthoringDocumentSpec = {
    format: "ferrum2d.consumer.scene-authoring", version: 1,
    physics: { space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1, collisionTilemap: { ...grid(), tiles: [1, 2] } },
    sceneComposition: { initialFragment: "main", prefabs: { marker: {} }, fragments: { main: { instances: [{
      id: "marker", prefab: "marker", x: 3, y: 4, props: { components: {
        visual: { kind: "primitive", shape: "rect", width: 2, height: 2 }, collider: "none", layer: "wall",
      } },
    }] } } }, behaviorRecipes: { entities: {} },
  };
  const viewer = createScenePlacementViewer({ document, viewport: { cssWidth: 320, cssHeight: 180 } });
  viewer.updateInstanceTransform("marker", { x: 11 });
  const patch = viewer.exportPatch()!;
  const merged = mergeScenePlacementPatch(document, patch).document;
  const roundtrip = resolveSceneAuthoringDocument(JSON.parse(JSON.stringify(merged)));
  deepEqual(roundtrip.physics, document.physics);
  equal(roundtrip.sceneComposition.fragments?.main.instances?.[0].x, 11);
  const handoff = createScenePlacementAgentHandoff({ document, state: viewer.state(), patch,
    sourceDocument: "scene-authoring.json", authoringEvidence: { selectedSourcePaths: ["physics.collisionTilemap"],
      changes: [{ path: "physics.collisionTilemap", after: merged.physics!.collisionTilemap }], changeCount: 1, truncated: false } });
  equal(handoff.sourceDocument, "scene-authoring.json");
  deepEqual(handoff.authoringEvidence?.changes[0].after, document.physics!.collisionTilemap);
  deepEqual(handoff.draftPatch, patch);
});
