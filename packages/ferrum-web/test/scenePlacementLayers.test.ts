import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { createScenePlacementViewer, mergeScenePlacementPatch, resolveSceneAuthoringDocument } from "../src/authoring.js";
import type { SceneAuthoringDocumentSpec } from "../src/authoring.js";

function document(): SceneAuthoringDocumentSpec {
  return { format: "ferrum2d.consumer.scene-authoring", version: 1, behaviorRecipes: { entities: {} }, sceneComposition: {
    initialFragment: "main", prefabs: {
      sprite: { props: { components: { visual: { kind: "sprite", texture: 1, width: 32, height: 32 }, collider: { type: "aabb", halfWidth: 8, halfHeight: 8 }, layer: "wall" } } },
      override: { props: { components: { visual: { kind: "sprite", texture: 2, width: 32, height: 32, layer: 5, originY: 1,
        shadow: { shape: "ellipse", width: 20, height: 8 }, animationSet: { initialClip: 0, clips: [{ id: 0, fps: 2, loop: true, frames: [{ u0: 0, v0: 0, u1: 1, v1: 1 }] }] } }, collider: { type: "aabb", halfWidth: 8, halfHeight: 8 }, layer: "pickup", body: { type: "kinematic" } } } },
    }, fragments: { main: { instances: [{ id: "front", prefab: "override", x: 80, y: 80, layer: -10 }, { id: "back", prefab: "sprite", x: 80, y: 80, layer: 0 }] } },
  } };
}
const create = () => createScenePlacementViewer({ document: document(), viewport: { cssWidth: 320, cssHeight: 180 } });

test("picking follows effective render layer and excludes hidden or layer-locked instances", () => {
  const viewer = create();
  equal(viewer.pickInstanceAtScreen({ x: 80, y: 76 })?.instanceId, "front");
  viewer.selectInstance("front");
  viewer.setLayerEditing({ hiddenLayers: [5], lockedLayers: [] });
  equal(viewer.state().selected, undefined);
  equal(viewer.pickInstanceAtScreen({ x: 80, y: 76 })?.instanceId, "back");
  deepEqual(viewer.selectInstances(["front", "back"]).selectedInstanceIds, ["back"]);
  viewer.setLayerEditing({ hiddenLayers: [], lockedLayers: [5] });
  equal(viewer.pickInstanceAtScreen({ x: 80, y: 76 })?.instanceId, "back");
  deepEqual(viewer.state().lockedInstanceIds, ["front"]);
  equal(viewer.exportPatch(), undefined); equal(viewer.historyState().undoCount, 0);
  // The explicit override is on layer 5; a new hidden object must never become selected.
  viewer.setLayerEditing({ hiddenLayers: [5], lockedLayers: [] });
  const next = viewer.addInstance("main", { id: "hidden_second", prefab: "override", x: 100, y: 80 });
  equal(next.selected, undefined); equal(viewer.state().selected, undefined);
});

test("layer unlock preserves individual locks and newly added objects inherit layer locks", () => {
  const viewer = create(); viewer.setInstancesLocked(["back"], true);
  viewer.setLayerEditing({ hiddenLayers: [], lockedLayers: [0] });
  viewer.addInstance("main", { id: "new", prefab: "sprite", x: 100, y: 80, layer: 0 });
  deepEqual(viewer.state().lockedInstanceIds, ["back", "new"]);
  throws(() => viewer.updateInstanceTransform("new", { x: 110 }), /locked/);
  viewer.setLayerEditing({ hiddenLayers: [], lockedLayers: [] });
  deepEqual(viewer.state().lockedInstanceIds, ["back"]);
  deepEqual(viewer.state().individuallyLockedInstanceIds, ["back"]);
  viewer.updateInstanceTransform("new", { x: 110 });
});

test("layer swaps and sprite sorting form one undoable patch and preserve unrelated components", () => {
  const source = document(), viewer = create();
  viewer.updateInstanceRenderLayers([{ instanceId: "front", layer: 0, sortOrder: 7, depthSort: "hd2d" }, { instanceId: "back", layer: 5 }]);
  equal(viewer.historyState().undoCount, 1);
  let front = viewer.state().instances.find(i => i.instanceId === "front")!;
  equal(front.transform.layer, 0); equal(front.visual?.kind === "sprite" && front.visual.layer, 0);
  equal(front.visual?.kind === "sprite" && front.visual.sortOrder, 7);
  equal(front.visual?.kind === "sprite" && front.visual.depthSort, "hd2d");
  equal(front.componentLayer?.name, "pickup"); equal(front.body?.type, "kinematic");
  const patch = viewer.exportPatch()!;
  const merged = mergeScenePlacementPatch(source, patch).document;
  resolveSceneAuthoringDocument(merged, { validateComponents: true });
  const props = merged.sceneComposition.fragments!.main.instances![0].props?.components as Record<string, unknown>;
  const visual = props.visual as Record<string, unknown>;
  deepEqual(visual.shadow, { shape: "ellipse", width: 20, height: 8 });
  equal((visual.animationSet as { clips: unknown[] }).clips.length, 1);
  viewer.undo(); equal(viewer.exportPatch(), undefined);
  viewer.redo(); deepEqual(viewer.exportPatch(), patch);
  front = viewer.state().instances.find(i => i.instanceId === "front")!;
  equal(front.transform.layer, 0);
});

test("invalid or locked layer batches roll back entirely and preserve history and policies", () => {
  const viewer = create(); viewer.setLayerEditing({ hiddenLayers: [], lockedLayers: [0] });
  throws(() => viewer.updateInstanceRenderLayers([{ instanceId: "front", layer: 1 }, { instanceId: "back", layer: 2 }]), /locked/);
  equal(viewer.exportPatch(), undefined); equal(viewer.historyState().undoCount, 0);
  viewer.setLayerEditing({ hiddenLayers: [0], lockedLayers: [] });
  throws(() => viewer.updateInstanceRenderLayers([{ instanceId: "front", layer: 0 }]), /hidden or locked/);
  throws(() => viewer.updateInstanceRenderLayers([{ instanceId: "front", layer: 1.5 }]), /integer/);
  throws(() => viewer.updateInstanceRenderLayers([{ instanceId: "front", layer: 1, sortOrder: Infinity }]), /sorting/);
  throws(() => viewer.setLayerEditing({ hiddenLayers: [5], lockedLayers: [Infinity] }), /integers/);
  deepEqual(viewer.state().layerEditing?.hiddenLayers, [0]);
  equal(viewer.exportPatch(), undefined);
});

test("sorting-only edits preserve the instance layer beneath an explicit visual override", () => {
  const viewer = create();
  viewer.updateInstanceRenderLayers([{ instanceId: "front", sortOrder: 9, depthSort: "hd2d" }]);
  const front = viewer.state().instances.find(i => i.instanceId === "front")!;
  equal(front.transform.layer, -10);
  equal(front.visual?.kind === "sprite" && front.visual.layer, 5);
  equal(viewer.exportPatch()!.operations.length, 1);
  equal(viewer.exportPatch()!.operations[0].kind, "updateComponents");
});

test("layer policies stay outside history and apply after undo, rename and draft clear", () => {
  const viewer = create(); viewer.updateInstanceRenderLayers([{ instanceId: "back", layer: 3 }]);
  viewer.setLayerEditing({ hiddenLayers: [3], lockedLayers: [] });
  viewer.undo(); equal(viewer.state().instances.find(i => i.instanceId === "back")!.transform.layer, 0);
  viewer.selectInstance("back"); viewer.redo(); equal(viewer.state().selected, undefined);
  viewer.setLayerEditing({ hiddenLayers: [], lockedLayers: [3] });
  throws(() => viewer.renameInstance("back", "renamed"), /locked/);
  viewer.clearDraftPatch(); deepEqual(viewer.state().lockedInstanceIds, []);
  deepEqual(viewer.state().layerEditing?.lockedLayers, [3]);
  viewer.beginEdit("Drag");
  throws(() => viewer.setLayerEditing({ hiddenLayers: [], lockedLayers: [] }), /Finish the current edit/);
  viewer.cancelEdit();
});

test("same-layer picking follows floor, elevation, foot, order and stable draw priority", () => {
  type Sort = { layer?: number; floorId?: number; elevation?: number; y?: number; sortOrder?: number; depthSort?: "layer" | "hd2d" };
  const cases: [string, Sort, Sort, string][] = [
    ["floor precedes elevation", { floorId: 1 }, { elevation: 100 }, "front"],
    ["elevation precedes foot", { elevation: 10 }, { y: 84 }, "front"],
    ["foot precedes order", { y: 84 }, { sortOrder: 100 }, "front"],
    ["order breaks equal feet", { sortOrder: 3 }, {}, "front"],
    ["render layer precedes height", { layer: 1 }, { floorId: 2 }, "front"],
    ["layer sorting ignores body height", { floorId: 2, depthSort: "layer" }, {}, "back"],
    ["equal keys preserve insertion order", {}, {}, "back"],
    ["sort orders tied at native f32 precision", { sortOrder: 1.00000002 }, { sortOrder: 1.00000001 }, "back"],
    ["elevations tied at native f32 precision", { elevation: 10.0000002 }, { elevation: 10.0000001 }, "back"],
    ["feet tied at native f32 precision", { y: 80.000002 }, { y: 80.000001 }, "back"],
    ["native total order distinguishes signed zero", { sortOrder: 0 }, { sortOrder: -0 }, "front"],
  ];
  for (const [name, front, back, expected] of cases) {
    const source = document();
    source.sceneComposition.fragments!.main.instances = [front, back].map((sort, index) => ({
      id: index === 0 ? "front" : "back", prefab: "sprite", x: 80, y: sort.y ?? 80,
      props: { components: {
        visual: { kind: "sprite", texture: 1, width: 64, height: 64, originY: 1, layer: sort.layer ?? 0, sortOrder: sort.sortOrder ?? 0, depthSort: sort.depthSort ?? "hd2d" },
        collider: { type: "aabb", halfWidth: 8, halfHeight: 8 }, layer: "wall",
        body: { type: "kinematic", heightSpan: { floorId: sort.floorId ?? 0, elevation: sort.elevation ?? 0, height: 10 } },
      } },
    }));
    const viewer = createScenePlacementViewer({ document: source, viewport: { cssWidth: 320, cssHeight: 180 } });
    equal(viewer.pickInstanceAtScreen({ x: 80, y: 76 })?.instanceId, expected, name);
  }
});

test("batch overrides rebuild pick bounds once and remain atomic", () => {
  const source = document();
  source.sceneComposition.fragments!.main.instances = Array.from({ length: 32 }, (_, index) => ({ id: `sprite_${index}`, prefab: "override", x: index * 2, y: 80 }));
  const viewer = createScenePlacementViewer({ document: source, viewport: { cssWidth: 320, cssHeight: 180 } });
  // Count the expensive whole-scene rebuild rather than relying on a timing threshold.
  const internal = viewer as unknown as { createPickBounds(path: string): unknown };
  const createBounds = internal.createPickBounds.bind(internal);
  let rebuilds = 0;
  internal.createPickBounds = path => { rebuilds++; return createBounds(path); };
  viewer.updateInstanceRenderLayers(source.sceneComposition.fragments!.main.instances!.map(instance => ({ instanceId: instance.id!, layer: 6 })));
  equal(rebuilds, 1);
  equal(viewer.historyState().undoCount, 1);
  equal(viewer.state().instances.every(instance => instance.visual?.kind === "sprite" && instance.visual.layer === 6), true);
  viewer.undo(); equal(viewer.exportPatch(), undefined);
  viewer.redo(); equal(viewer.state().instances.every(instance => instance.transform.layer === 6), true);
});
