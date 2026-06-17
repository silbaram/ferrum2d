import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";

import {
  SCENE_AUTHORING_DOCUMENT_FORMAT,
  SCENE_AUTHORING_DOCUMENT_VERSION,
  createSceneInstanceHandleRegistry,
  createScenePlacementPatchStore,
  createScenePlacementViewer,
} from "../src/authoring.js";
import type { SceneAuthoringDocumentSpec, SceneCompositionSpec, ScenePlacementPatch } from "../src/authoring.js";

test("ScenePlacementViewer exposes read-only scene instances and selected entity state", () => {
  const registry = createSceneInstanceHandleRegistry();
  registry.set("turret_left", { entityId: 7, entityGeneration: 2 });

  const viewer = createScenePlacementViewer({
    document: scenePlacementDocument(),
    viewport: { cssWidth: 320, cssHeight: 180 },
    selectedInstanceId: "turret_left",
    pointerScreen: { x: 16, y: 24 },
    instanceHandleRegistry: registry,
  });

  const state = viewer.state();
  equal(state.fragment, "main");
  equal(state.instances.length, 2);
  equal(state.pointerWorld?.x, 16);
  equal(state.pointerWorld?.y, 24);
  equal(state.selectedInstanceId, "turret_left");
  equal(state.selected?.role, "actor");
  equal(state.selected?.entity?.entityId, 7);
  deepEqual(state.selected?.behaviorProfiles, ["turretBrain"]);
  equal(viewer.exportPatch(), undefined);
});

test("ScenePlacementViewer selection, hover, pointer, and viewport updates are explicit", () => {
  const viewer = createScenePlacementViewer({
    sceneComposition: scenePlacementComposition(),
    viewport: { cssWidth: 320, cssHeight: 180 },
  });

  const selected = viewer.selectInstance("crate_a");
  equal(selected.selected?.role, "worldObject");
  equal(selected.selected?.transform.x, 10);

  const hovered = viewer.hoverInstance("turret_left");
  equal(hovered.hoveredInstanceId, "turret_left");

  const pointer = viewer.pointerAtScreen({ x: 32, y: 18 });
  equal(pointer.pointerWorld?.x, 32);
  equal(pointer.pointerWorld?.y, 18);

  const zoomed = viewer.updateViewport({
    cssWidth: 320,
    cssHeight: 180,
    cameraX: 160,
    cameraY: 90,
    zoom: 2,
  });
  equal(zoomed.viewport.worldWidth, 160);
  equal(viewer.pointerAtScreen({ x: 32, y: 18 }).pointerWorld?.x, 96);
  equal(viewer.selectInstance().selected, undefined);
  equal(viewer.hoverInstance().hoveredInstanceId, undefined);
});

test("ScenePlacementViewer picks scene instances from screen coordinates", () => {
  const viewer = createScenePlacementViewer({
    sceneComposition: scenePlacementComposition(),
    viewport: { cssWidth: 320, cssHeight: 180 },
  });

  const pickedCrate = viewer.pickInstanceAtScreen({ x: 10, y: 20 });
  equal(pickedCrate?.instanceId, "crate_a");
  equal(pickedCrate?.role, "worldObject");

  const hovered = viewer.hoverInstanceAtScreen({ x: 30, y: 40 });
  equal(hovered.hoveredInstanceId, "turret_left");
  equal(hovered.pointerWorld?.x, 30);
  equal(hovered.pointerWorld?.y, 40);

  const selected = viewer.selectInstanceAtScreen({ x: 30, y: 40 });
  equal(selected.selectedInstanceId, "turret_left");
  equal(selected.selected?.role, "actor");

  const clearedHover = viewer.hoverInstanceAtScreen({ x: 200, y: 120 });
  equal(clearedHover.hoveredInstanceId, undefined);
  equal(clearedHover.selectedInstanceId, "turret_left");

  const clearedSelection = viewer.selectInstanceAtScreen({ x: 200, y: 120 });
  equal(clearedSelection.selectedInstanceId, undefined);
  equal(viewer.hoverInstanceAtScreen().pointerWorld, undefined);
});

test("ScenePlacementViewer exports draft transform patches without mutating source instances", () => {
  const viewer = createScenePlacementViewer({
    sceneComposition: scenePlacementComposition(),
    viewport: { cssWidth: 320, cssHeight: 180 },
    selectedInstanceId: "crate_a",
  });

  const draft = viewer.updateInstanceTransform("crate_a", { x: 64, y: 72 });
  equal(draft.selected?.transform.x, 64);
  equal(draft.selected?.transform.y, 72);
  deepEqual(draft.draftPatch, {
    format: "ferrum2d.scene-placement.patch",
    version: 1,
    operations: [
      {
        kind: "updateTransform",
        instanceId: "crate_a",
        transform: { x: 64, y: 72 },
      },
    ],
  });
  equal(viewer.pickInstanceAtScreen({ x: 10, y: 20 })?.instanceId, undefined);
  equal(viewer.pickInstanceAtScreen({ x: 64, y: 72 })?.instanceId, "crate_a");

  const reverted = viewer.updateInstanceTransform("crate_a", { x: 10, y: 20 });
  equal(reverted.selected?.transform.x, 10);
  equal(reverted.draftPatch, undefined);
  equal(viewer.exportPatch(), undefined);

  viewer.updateInstanceTransform("turret_left", { scale: 2, rotationRadians: 0.5 });
  const cleared = viewer.clearDraftPatch();
  equal(cleared.draftPatch, undefined);
  equal(cleared.instances.find((instance) => instance.instanceId === "turret_left")?.transform.scale, 1);
});

test("ScenePlacementViewer drafts rename, add, and remove operations without mutating source instances", () => {
  const composition = scenePlacementComposition();
  const viewer = createScenePlacementViewer({
    sceneComposition: composition,
    viewport: { cssWidth: 320, cssHeight: 180 },
    selectedInstanceId: "turret_left",
  });

  const renamed = viewer.renameInstance("turret_left", "turret_north");
  equal(renamed.selectedInstanceId, "turret_north");
  equal(renamed.selected?.instanceId, "turret_north");
  equal(renamed.selected?.sourceId, "turret_left");

  const moved = viewer.updateInstanceTransform("turret_north", { x: 48 });
  equal(moved.selected?.transform.x, 48);

  const added = viewer.addInstance("main", {
    id: "crate_b",
    prefab: "crate",
    x: 96,
    y: 104,
  });
  equal(added.selectedInstanceId, "crate_b");
  equal(added.selected?.role, "worldObject");
  equal(added.instances.length, 3);

  const removed = viewer.removeInstance("crate_a");
  equal(removed.instances.some((instance) => instance.instanceId === "crate_a"), false);
  deepEqual(viewer.exportPatch(), {
    format: "ferrum2d.scene-placement.patch",
    version: 1,
    operations: [
      {
        kind: "removeInstance",
        instanceId: "crate_a",
      },
      {
        kind: "renameInstance",
        instanceId: "turret_left",
        nextInstanceId: "turret_north",
      },
      {
        kind: "updateTransform",
        instanceId: "turret_north",
        transform: { x: 48 },
      },
      {
        kind: "addInstance",
        fragment: "main",
        instance: {
          id: "crate_b",
          prefab: "crate",
          x: 96,
          y: 104,
        },
      },
    ],
  });
  equal(composition.fragments?.main?.instances?.[1]?.id, "turret_left");

  throwsMatching(
    () => viewer.renameInstance("turret_north", "crate_b"),
    /already exists/u,
  );

  const cleared = viewer.clearDraftPatch();
  equal(cleared.draftPatch, undefined);
  equal(cleared.instances.length, 2);
  equal(cleared.instances.some((instance) => instance.instanceId === "turret_left"), true);
});

test("ScenePlacementPatchStore keeps export-only patch state", () => {
  const patch = {
    format: "ferrum2d.scene-placement.patch" as const,
    version: 1 as const,
    operations: [
      {
        kind: "updateTransform" as const,
        instanceId: "crate_a",
        transform: { x: 42 },
      },
    ],
  };
  const store = createScenePlacementPatchStore();
  equal(store.state().dirty, false);
  equal(store.state().operationCount, 0);

  const state = store.replacePatch(patch);
  equal(state.dirty, true);
  equal(state.operationCount, 1);
  deepEqual(store.exportPatch(), patch);

  const exported = store.exportPatch();
  if (exported?.operations[0]?.kind === "updateTransform") {
    exported.operations[0].transform.x = 99;
  }
  deepEqual(store.exportPatch(), patch);

  const addPatch = {
    format: "ferrum2d.scene-placement.patch",
    version: 1,
    operations: [
      {
        kind: "addInstance",
        fragment: "main",
        instance: {
          id: "crate_b",
          prefab: "crate",
          props: {
            tags: ["crate", "draft"],
            component: { sprite: "crate" },
          },
        },
      },
    ],
  } satisfies ScenePlacementPatch;
  store.replacePatch(addPatch);
  const exportedAdd = store.exportPatch();
  const exportedAddOperation = exportedAdd?.operations[0];
  if (exportedAddOperation?.kind === "addInstance") {
    const mutableProps = exportedAddOperation.instance.props as Record<string, unknown>;
    (mutableProps.tags as string[]).push("mutated");
    (mutableProps.component as Record<string, string>).sprite = "mutated";
  }
  deepEqual(store.exportPatch(), addPatch);
  equal(store.clear().dirty, false);
});

test("ScenePlacementViewer validates input surface", () => {
  throwsMatching(
    () => createScenePlacementViewer({
      viewport: { cssWidth: 320, cssHeight: 180 },
    }),
    /must provide document or sceneComposition/u,
  );
  throwsMatching(
    () => createScenePlacementViewer({
      sceneComposition: scenePlacementComposition(),
      viewport: { cssWidth: 320, cssHeight: 180 },
      selectedInstanceId: "missing",
    }),
    /references unknown scene instance .*missing/u,
  );
  throwsMatching(
    () => createScenePlacementViewer({
      sceneComposition: scenePlacementComposition(),
      viewport: { cssWidth: 0, cssHeight: 180 },
    }),
    /scenePlacementViewport\.cssWidth must be greater than 0/u,
  );
  throwsMatching(
    () => createScenePlacementViewer({
      sceneComposition: scenePlacementComposition(),
      viewport: { cssWidth: 320, cssHeight: 180 },
    }).updateInstanceTransform("missing", { x: 1 }),
    /references unknown scene instance .*missing/u,
  );
  throwsMatching(
    () => createScenePlacementViewer({
      sceneComposition: scenePlacementComposition(),
      viewport: { cssWidth: 320, cssHeight: 180 },
    }).updateInstanceTransform("crate_a", { scale: 0 }),
    /scale.*must be a positive finite number/u,
  );
});

function scenePlacementDocument(): SceneAuthoringDocumentSpec {
  return {
    format: SCENE_AUTHORING_DOCUMENT_FORMAT,
    version: SCENE_AUTHORING_DOCUMENT_VERSION,
    sceneComposition: scenePlacementComposition(),
    behaviorRecipes: {
      entities: {
        turretBrain: {
          recipes: [{ kind: "health", max: 3 }],
        },
      },
    },
  };
}

function scenePlacementComposition(): SceneCompositionSpec {
  return {
    initialFragment: "main",
    prefabs: {
      crate: {
        props: {
          components: {
            sprite: { texture: "crate", width: 16, height: 16 },
            collider: { type: "aabb", halfWidth: 8, halfHeight: 8 },
            layer: "wall",
          },
        },
      },
      turret: {
        props: {
          behaviorRecipes: "turretBrain",
          components: {
            sprite: { texture: "turret", width: 16, height: 24 },
            collider: { type: "aabb", halfWidth: 8, halfHeight: 12 },
            layer: "enemy",
          },
        },
      },
    },
    fragments: {
      main: {
        instances: [
          { id: "crate_a", prefab: "crate", x: 10, y: 20 },
          { id: "turret_left", prefab: "turret", x: 30, y: 40 },
        ],
      },
    },
  };
}

function throwsMatching(action: () => void, pattern: RegExp): void {
  try {
    action();
  } catch (error) {
    if (!(error instanceof Error)) {
      throw new Error("expected thrown value to be an Error");
    }
    ok(pattern.test(error.message), `expected ${JSON.stringify(error.message)} to match ${pattern}`);
    return;
  }
  throw new Error(`expected function to throw ${pattern}`);
}
