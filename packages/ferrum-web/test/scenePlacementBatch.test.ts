import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { createScenePlacementViewer, type SceneAuthoringDocumentSpec } from "../src/authoring.js";

function document(): SceneAuthoringDocumentSpec {
  return {
    format: "ferrum2d.consumer.scene-authoring", version: 1,
    behaviorRecipes: { entities: {} },
    sceneComposition: {
      initialFragment: "main",
      prefabs: { tile: { props: { components: {
        visual: { kind: "primitive", shape: "rect", width: 16, height: 16, color: "#ffffff" },
        collider: "none", layer: "wall",
      } } } },
      fragments: { main: { instances: [] } },
    },
  };
}
const viewport = { cssWidth: 1000, cssHeight: 800 };
const tiles = (count: number) => Array.from({ length: count }, (_, i) => ({ id: "tile_" + i, prefab: "tile", x: i * 16, y: 0 }));

test("flat batch validates one complete candidate and preserves one Undo/Redo for 2048 tiles", () => {
  let validations = 0;
  const viewer = createScenePlacementViewer({ document: document(), viewport, validateDraft: () => { validations++; } });
  const batch = tiles(2048), result = viewer.addInstances("main", batch);
  equal(validations, 1); equal(result.instances.length, 2048); equal(result.selectedInstanceId, "tile_2047");
  equal(viewer.historyState().undoCount, 1);
  batch[0].x = -100;
  equal(viewer.state().instances[0].transform.x, 0);
  equal(viewer.pickInstanceAtScreen({ x: 0, y: 0 })?.instanceId, "tile_0");
  const patch = viewer.exportPatch(); viewer.undo(); equal(viewer.exportPatch(), undefined);
  viewer.redo(); deepEqual(viewer.exportPatch(), patch);
});

test("batch output matches individual additions inside a transaction", () => {
  const bulk = createScenePlacementViewer({ document: document(), viewport });
  const single = createScenePlacementViewer({ document: document(), viewport });
  bulk.addInstances("main", tiles(4));
  single.beginEdit("Map"); for (const tile of tiles(4)) single.addInstance("main", tile); single.commitEdit();
  deepEqual(bulk.exportPatch(), single.exportPatch()); deepEqual(bulk.state(), single.state());
});

test("invalid batch rolls back all additions and keeps accepted history and locks", () => {
  const viewer = createScenePlacementViewer({ document: document(), viewport });
  viewer.addInstance("main", { id: "existing", prefab: "tile" });
  viewer.setInstancesLocked(["existing"], true);
  const state = viewer.state(), history = viewer.historyState();
  for (const batch of [
    [...tiles(2), { id: "tile_0", prefab: "tile" }],
    [...tiles(2), { id: "existing", prefab: "tile" }],
    [...tiles(2), { id: "bad", prefab: "missing" }],
  ]) {
    throws(() => viewer.addInstances("main", batch)); deepEqual(viewer.state(), state); deepEqual(viewer.historyState(), history);
  }
  throws(() => viewer.addInstances("missing", tiles(1)));
  throws(() => viewer.addInstances("main", tiles(2049)), /2048/);
  deepEqual(viewer.state(), state); deepEqual(viewer.historyState(), history);
});

test("host rejection of a complete batch rolls back its surrounding edit", () => {
  const viewer = createScenePlacementViewer({ document: document(), viewport, validateDraft: state => {
    if (state.instances.length > 3) throw Error("host rejected batch");
  } });
  viewer.addInstance("main", { id: "existing", prefab: "tile" });
  const before = viewer.exportPatch();
  viewer.beginEdit("Import"); viewer.addInstance("main", { id: "extra", prefab: "tile" });
  throws(() => viewer.addInstances("main", tiles(3)), /host rejected/);
  deepEqual(viewer.exportPatch(), before); equal(viewer.historyState().transactionLabel, undefined);
  equal(viewer.historyState().undoCount, 1);
});

test("empty batches do not change history", () => {
  const viewer = createScenePlacementViewer({ document: document(), viewport });
  viewer.addInstances("main", []); equal(viewer.historyState().undoCount, 0); equal(viewer.exportPatch(), undefined);
});

test("batch preflight errors cancel the surrounding edit just like invalid entries", () => {
  for (const input of [tiles(2049), null]) {
    const viewer = createScenePlacementViewer({ document: document(), viewport });
    viewer.addInstance("main", { id: "existing", prefab: "tile" });
    const before = viewer.exportPatch();
    viewer.beginEdit("Import"); viewer.updateInstanceTransform("existing", { x: 90 });
    throws(() => viewer.addInstances("main", input as never), /2048/);
    deepEqual(viewer.exportPatch(), before);
    equal(viewer.historyState().transactionLabel, undefined);
    equal(viewer.historyState().undoCount, 1);
  }
});
