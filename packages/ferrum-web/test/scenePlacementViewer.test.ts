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
  deepEqual(state.objectDefinitions.map((definition) => definition.id), ["crate", "turret"]);
  equal(state.objectDefinitions.find((definition) => definition.id === "turret")?.variants.length, 0);
  equal(state.objectDefinitions.find((definition) => definition.id === "crate")?.visual?.kind, "sprite");
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

test("ScenePlacementViewer exposes primitive visual summaries and picks from visual bounds", () => {
  const viewer = createScenePlacementViewer({
    sceneComposition: scenePlacementPrimitiveComposition(),
    viewport: { cssWidth: 320, cssHeight: 180 },
  });

  const picked = viewer.pickInstanceAtScreen({ x: 80, y: 90 });
  equal(picked?.instanceId, "rect_1");
  equal(picked?.visual?.kind, "primitive");
  if (picked?.visual?.kind !== "primitive") {
    throw new Error("expected primitive visual");
  }
  equal(picked.visual.shape, "rect");
  equal(picked.visual.bounds.width, 40);
  equal(picked.visual.bounds.height, 24);
  equal(picked.collider?.type, "aabb");
  equal(picked.componentLayer?.name, "wall");
  equal(viewer.pickInstanceAtScreen({ x: 101, y: 90 })?.instanceId, undefined);

  const selected = viewer.selectInstanceAtScreen({ x: 60, y: 78 });
  equal(selected.selected?.instanceId, "rect_1");
  equal(selected.selected?.visual?.kind, "primitive");
});

test("ScenePlacementViewer drafts component patches and updates visual picking bounds", () => {
  const viewer = createScenePlacementViewer({
    sceneComposition: scenePlacementPrimitiveComposition(),
    viewport: { cssWidth: 320, cssHeight: 180 },
    selectedInstanceId: "rect_1",
  });

  const updated = viewer.updateInstanceComponents("rect_1", {
    visual: {
      kind: "primitive",
      shape: "circle",
      radius: 18,
      color: "#60a5fa",
    },
    collider: {
      type: "circle",
      radius: 18,
    },
    layer: "enemy",
  });

  equal(updated.selected?.visual?.kind, "primitive");
  if (updated.selected?.visual?.kind !== "primitive") {
    throw new Error("expected primitive visual");
  }
  equal(updated.selected.visual.shape, "circle");
  equal(updated.selected.visual.bounds.width, 36);
  equal(updated.selected.collider?.type, "circle");
  equal(updated.selected.componentLayer?.name, "enemy");
  equal(viewer.pickInstanceAtScreen({ x: 98, y: 90 })?.instanceId, "rect_1");
  equal(viewer.pickInstanceAtScreen({ x: 99, y: 90 })?.instanceId, undefined);
  deepEqual(viewer.exportPatch(), {
    format: "ferrum2d.scene-placement.patch",
    version: 1,
    operations: [
      {
        kind: "updateComponents",
        instanceId: "rect_1",
        components: {
          visual: {
            kind: "primitive",
            shape: "circle",
            radius: 18,
            color: "#60a5fa",
          },
          collider: {
            type: "circle",
            radius: 18,
          },
          layer: "enemy",
        },
      },
    ],
  });

  const reverted = viewer.updateInstanceComponents("rect_1", {
    visual: {
      kind: "primitive",
      shape: "rect",
      width: 40,
      height: 24,
      color: "#7ddc9d",
    },
    collider: { type: "aabb", halfWidth: 20, halfHeight: 12 },
    layer: "wall",
  });
  equal(reverted.draftPatch, undefined);
});

test("ScenePlacementViewer drafts behavior binding patches without editing recipe bodies", () => {
  const viewer = createScenePlacementViewer({
    document: scenePlacementDocument(),
    viewport: { cssWidth: 320, cssHeight: 180 },
    selectedInstanceId: "crate_a",
  });

  const attached = viewer.updateBehaviorBinding(
    { kind: "instance", instanceId: "crate_a" },
    "turretBrain",
  );
  equal(attached.selected?.role, "actor");
  deepEqual(attached.selected?.behaviorProfiles, ["turretBrain"]);
  deepEqual(viewer.exportPatch(), {
    format: "ferrum2d.scene-placement.patch",
    version: 1,
    operations: [
      {
        kind: "updateBehaviorBinding",
        target: {
          kind: "instance",
          instanceId: "crate_a",
        },
        behaviorRecipes: "turretBrain",
      },
    ],
  });

  const reverted = viewer.updateBehaviorBinding(
    { kind: "instance", instanceId: "crate_a" },
    null,
  );
  equal(reverted.selected?.role, "worldObject");
  equal(reverted.draftPatch, undefined);

  viewer.selectInstance("turret_left");
  const detachedInherited = viewer.updateBehaviorBinding(
    { kind: "instance", instanceId: "turret_left" },
    null,
  );
  equal(detachedInherited.selected?.role, "worldObject");
  deepEqual(detachedInherited.selected?.behaviorProfiles, []);
  deepEqual(viewer.exportPatch(), {
    format: "ferrum2d.scene-placement.patch",
    version: 1,
    operations: [
      {
        kind: "updateBehaviorBinding",
        target: {
          kind: "instance",
          instanceId: "turret_left",
        },
        behaviorRecipes: null,
      },
    ],
  });
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

test("ScenePlacementViewer keeps add patches separate from behavior binding patches", () => {
  const viewer = createScenePlacementViewer({
    sceneComposition: scenePlacementPrimitiveComposition(),
    viewport: { cssWidth: 320, cssHeight: 180 },
  });

  viewer.addObjectDefinition("actor_template", {
    props: {
      components: {
        visual: {
          kind: "primitive",
          shape: "rect",
          width: 32,
          height: 32,
          color: "#60a5fa",
        },
        collider: { type: "aabb", halfWidth: 16, halfHeight: 16 },
        layer: "enemy",
      },
    },
  });
  const definitionBound = viewer.updateBehaviorBinding(
    { kind: "objectDefinition", id: "actor_template" },
    ["turretBrain"],
  );
  equal(
    definitionBound.objectDefinitions.find((definition) => definition.id === "actor_template")
      ?.behaviorProfiles[0],
    "turretBrain",
  );

  viewer.addInstance("main", {
    id: "actor_1",
    prefab: "actor_template",
    x: 112,
    y: 96,
  });
  const instanceBound = viewer.updateBehaviorBinding(
    { kind: "instance", instanceId: "actor_1" },
    null,
  );
  equal(instanceBound.selected?.role, "worldObject");
  deepEqual(viewer.exportPatch(), {
    format: "ferrum2d.scene-placement.patch",
    version: 1,
    operations: [
      {
        kind: "addObjectDefinition",
        id: "actor_template",
        definition: {
          props: {
            components: {
              visual: {
                kind: "primitive",
                shape: "rect",
                width: 32,
                height: 32,
                color: "#60a5fa",
              },
              collider: { type: "aabb", halfWidth: 16, halfHeight: 16 },
              layer: "enemy",
            },
          },
        },
      },
      {
        kind: "updateBehaviorBinding",
        target: {
          kind: "objectDefinition",
          id: "actor_template",
        },
        behaviorRecipes: ["turretBrain"],
      },
      {
        kind: "addInstance",
        fragment: "main",
        instance: {
          id: "actor_1",
          prefab: "actor_template",
          x: 112,
          y: 96,
        },
      },
      {
        kind: "updateBehaviorBinding",
        target: {
          kind: "instance",
          instanceId: "actor_1",
        },
        behaviorRecipes: [],
      },
    ],
  });
});

test("ScenePlacementViewer folds component edits for added instances into add patches", () => {
  const viewer = createScenePlacementViewer({
    sceneComposition: scenePlacementPrimitiveComposition(),
    viewport: { cssWidth: 320, cssHeight: 180 },
  });

  viewer.addInstance("main", {
    id: "rect_2",
    prefab: "primitive",
    x: 120,
    y: 90,
  });
  const updated = viewer.updateInstanceComponents("rect_2", {
    visual: {
      kind: "primitive",
      shape: "rect",
      width: 64,
      height: 28,
      color: "#facc15",
    },
    collider: {
      type: "aabb",
      halfWidth: 32,
      halfHeight: 14,
    },
    layer: "wall",
  });

  equal(updated.selected?.instanceId, "rect_2");
  equal(updated.selected?.visual?.bounds.width, 64);
  deepEqual(viewer.exportPatch(), {
    format: "ferrum2d.scene-placement.patch",
    version: 1,
    operations: [
      {
        kind: "addInstance",
        fragment: "main",
        instance: {
          id: "rect_2",
          prefab: "primitive",
          x: 120,
          y: 90,
          props: {
            components: {
              visual: {
                kind: "primitive",
                shape: "rect",
                width: 64,
                height: 28,
                color: "#facc15",
              },
              collider: {
                type: "aabb",
                halfWidth: 32,
                halfHeight: 14,
              },
              layer: "wall",
            },
          },
        },
      },
    ],
  });
});

test("ScenePlacementViewer drafts object definitions and allows draft prefab placement", () => {
  const viewer = createScenePlacementViewer({
    sceneComposition: scenePlacementPrimitiveComposition(),
    viewport: { cssWidth: 320, cssHeight: 180 },
    selectedInstanceId: "rect_1",
  });

  const state = viewer.addObjectDefinition("rect_template", {
    props: {
      components: {
        visual: {
          kind: "primitive",
          shape: "circle",
          radius: 18,
          color: "#60a5fa",
        },
        collider: {
          type: "circle",
          radius: 18,
        },
        layer: "enemy",
      },
    },
  });

  equal(state.objectDefinitions.some((definition) => definition.id === "rect_template"), true);
  equal(state.objectDefinitions.find((definition) => definition.id === "rect_template")?.visual?.kind, "primitive");
  const added = viewer.addInstance("main", {
    id: "rect_template_1",
    prefab: "rect_template",
    x: 144,
    y: 96,
  });

  equal(added.selectedInstanceId, "rect_template_1");
  equal(added.selected?.prefab, "rect_template");
  equal(added.selected?.visual?.kind, "primitive");
  deepEqual(viewer.exportPatch(), {
    format: "ferrum2d.scene-placement.patch",
    version: 1,
    operations: [
      {
        kind: "addObjectDefinition",
        id: "rect_template",
        definition: {
          props: {
            components: {
              visual: {
                kind: "primitive",
                shape: "circle",
                radius: 18,
                color: "#60a5fa",
              },
              collider: {
                type: "circle",
                radius: 18,
              },
              layer: "enemy",
            },
          },
        },
      },
      {
        kind: "addInstance",
        fragment: "main",
        instance: {
          id: "rect_template_1",
          prefab: "rect_template",
          x: 144,
          y: 96,
        },
      },
    ],
  });

  throwsMatching(
    () => viewer.addObjectDefinition("rect_template", { props: {} }),
    /already exists/u,
  );
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
  throwsMatching(
    () => createScenePlacementViewer({
      sceneComposition: scenePlacementComposition(),
      viewport: { cssWidth: 320, cssHeight: 180 },
    }).addInstance("main", {
      id: "agent_owned",
      prefab: "crate",
      props: {
        behaviorRecipes: ["agentProfile"],
      },
    }),
    /only write UI-owned props\.components/u,
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

function scenePlacementPrimitiveComposition(): SceneCompositionSpec {
  return {
    initialFragment: "main",
    prefabs: {
      primitive: {
        props: {
          components: {
            visual: {
              kind: "primitive",
              shape: "rect",
              width: 40,
              height: 24,
              color: "#7ddc9d",
            },
            collider: { type: "aabb", halfWidth: 20, halfHeight: 12 },
            layer: "wall",
          },
        },
      },
    },
    fragments: {
      main: {
        instances: [
          { id: "rect_1", prefab: "primitive", x: 80, y: 90 },
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
