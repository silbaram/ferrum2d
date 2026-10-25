import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  createScenePlacementViewer,
  createScenePlacementPatchStore,
  mergeScenePlacementPatch,
  resolveSceneAuthoringDocument,
  saveScenePlacementPatch,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementPatch,
} from "../src/authoring.js";
import { applySceneSpatialPatch } from "../src/sceneSpatialPatch.js";

function document(): SceneAuthoringDocumentSpec {
  return {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    behaviorRecipes: { entities: {} },
    sceneComposition: {
      initialFragment: "main",
      prefabs: {
        object: {
          props: {
            components: {
              visual: {
                kind: "primitive",
                shape: "rect",
                width: 16,
                height: 24,
              },
              collider: { type: "aabb", halfWidth: 4, halfHeight: 4 },
              layer: "wall",
              body: {
                type: "static",
                heightSpan: { elevation: 4, height: 24, floorId: 0 },
              },
            },
          },
        },
      },
      fragments: {
        main: {
          instances: [
            { id: "sprite", prefab: "object", x: 10, y: 20 },
            { id: "model", prefab: "object", x: 50, y: 20 },
            { id: "proxy", prefab: "object", x: 80, y: 20 },
          ],
        },
      },
    },
    spatial: {
      camera: {
        projection: "orthographic",
        position: { x: 0, y: -100, elevation: 100 },
        target: { x: 0, y: 0, elevation: 0 },
        height: 200,
      },
      terrain: [
        {
          id: "ground",
          x: -100,
          y: -100,
          width: 200,
          depth: 200,
          elevation: 0,
        },
      ],
      billboards: { sprite: {} },
      models: { model: { asset: "rock", contentId: "a".repeat(64) } },
      attachments: { proxy: { parent: "model", x: 30 } },
    },
  };
}
function subject() {
  return createScenePlacementViewer({
    document: document(),
    viewport: { cssWidth: 640, cssHeight: 480 },
    selectedInstanceId: "sprite",
  });
}

test("spatial v3 rename and remove migrate visual identity atomically and preserve metadata", () => {
  const source = document();
  delete source.spatial!.attachments;
  source.spatial!.billboards = {
    sprite: { alphaCutoff: 0.3, normalTextureId: 2, elevation: 4 },
  };
  let validations = 0;
  const viewer = createScenePlacementViewer({
    document: source,
    viewport: { cssWidth: 640, cssHeight: 480 },
    validateDraft: () => {
      validations++;
    },
  });
  viewer.renameInstance("sprite", "renamed");
  equal(validations, 1);
  equal(viewer.historyState().undoCount, 1);
  const renamed = viewer.exportPatch()!;
  equal(renamed.spatial?.version, 3);
  deepEqual(
    mergeScenePlacementPatch(source, renamed).document.spatial!.billboards
      .renamed,
    source.spatial!.billboards.sprite,
  );
  viewer.undo();
  equal(viewer.exportPatch(), undefined);
  viewer.redo();
  deepEqual(viewer.exportPatch(), renamed);
  viewer.removeInstance("renamed");
  const deleted = mergeScenePlacementPatch(
    source,
    viewer.exportPatch()!,
  ).document;
  equal(deleted.spatial!.billboards.sprite, undefined);
  equal(deleted.spatial!.billboards.renamed, undefined);
  equal(
    deleted.sceneComposition.fragments!.main.instances!.some(
      (instance) => instance.id === "sprite" || instance.id === "renamed",
    ),
    false,
  );
  viewer.undo();
  deepEqual(viewer.exportPatch(), renamed);
  deepEqual(source.spatial!.billboards.sprite, {
    alphaCutoff: 0.3,
    normalTextureId: 2,
    elevation: 4,
  });
});

test("spatial duplicate copies immutable visual metadata and removing the draft leaves no patch", () => {
  const source = document();
  delete source.spatial!.attachments;
  source.spatial!.billboards = {
    sprite: { alphaCutoff: 0.25, normalTextureId: 2 },
  };
  const viewer = createScenePlacementViewer({
    document: source,
    viewport: { cssWidth: 640, cssHeight: 480 },
  });
  const state = viewer.duplicateInstances(["sprite"]),
    id = state.selectedInstanceId!;
  equal(state.selected!.transform.x, 26);
  equal(state.selected!.transform.y, 36);
  equal(viewer.historyState().undoCount, 1);
  const patch = viewer.exportPatch()!;
  equal(patch.spatial?.version, 3);
  ok(patch.spatial!.operations.some((op) => op.kind === "copyReference"));
  deepEqual(
    mergeScenePlacementPatch(source, patch).document.spatial!.billboards[id],
    source.spatial!.billboards.sprite,
  );
  viewer.removeInstance(id);
  equal(viewer.exportPatch(), undefined);
  viewer.undo();
  equal(viewer.state().selectedInstanceId, id);
  viewer.setInstancesLocked([id], true);
  throws(() => viewer.duplicateInstances([id]), /locked/);
});

test("imported migrations require exact composition pairs and reject protected attachment identities", () => {
  const source = document();
  for (const operations of [
    [
      {
        kind: "renameReference",
        id: "sprite",
        changes: { target: "billboard", nextId: "proxy" },
      },
    ],
    [
      {
        kind: "removeReference",
        id: "sprite",
        changes: { target: "billboard" },
      },
    ],
    [
      {
        kind: "copyReference",
        id: "new",
        changes: { target: "billboard", sourceId: "sprite" },
      },
    ],
  ])
    throws(
      () =>
        mergeScenePlacementPatch(source, {
          format: "ferrum2d.scene-placement.patch",
          version: 3,
          operations: [],
          spatial: {
            format: "ferrum2d.scene-spatial.patch",
            version: 3,
            operations: operations as never,
          },
        }),
      /matching composition/,
    );
  throws(
    () =>
      mergeScenePlacementPatch(source, {
        format: "ferrum2d.scene-placement.patch",
        version: 3,
        operations: [{ kind: "removeInstance", instanceId: "model" }],
        spatial: {
          format: "ferrum2d.scene-spatial.patch",
          version: 3,
          operations: [
            {
              kind: "removeReference",
              id: "model",
              changes: { target: "model" },
            },
          ],
        },
      }),
    /agent-owned reference/,
  );
  throws(
    () =>
      mergeScenePlacementPatch(source, {
        format: "ferrum2d.scene-placement.patch",
        version: 3,
        operations: [
          {
            kind: "renameInstance",
            instanceId: "sprite",
            nextInstanceId: "new",
          },
        ],
        spatial: {
          format: "ferrum2d.scene-spatial.patch",
          version: 1,
          operations: [
            {
              kind: "updateBillboard",
              id: "sprite",
              changes: { elevation: 4 },
            },
          ],
        },
      }),
    /matching spatial/,
  );
});

test("GLB reimport preserves asset IDs and LOD metadata, and duplicates retain replacement contents", () => {
  const source = document();
  delete source.spatial!.attachments;
  source.spatial!.models = {
    model: {
      asset: "rock",
      contentId: "a".repeat(64),
      lods: [
        { asset: "rock_far", contentId: "b".repeat(64), minDistance: 128 },
      ],
    },
  };
  const viewer = createScenePlacementViewer({
    document: source,
    viewport: { cssWidth: 640, cssHeight: 480 },
  });
  viewer.updateSpatial([
    {
      kind: "replaceModelAsset",
      id: "model",
      changes: { asset: "rock", contentId: "c".repeat(64) },
    },
    {
      kind: "replaceModelAsset",
      id: "model",
      changes: { asset: "rock_far", contentId: "d".repeat(64) },
    },
  ]);
  equal(viewer.historyState().undoCount, 1);
  equal(viewer.exportPatch()!.spatial!.version, 3);
  const state = viewer.duplicateInstances(["model"]),
    copy = state.selectedInstanceId!;
  const merged = mergeScenePlacementPatch(
    source,
    viewer.exportPatch()!,
  ).document;
  equal(merged.spatial!.models![copy].asset, "rock");
  equal(merged.spatial!.models![copy].contentId, "c".repeat(64));
  deepEqual(merged.spatial!.models![copy].lods, [
    { asset: "rock_far", contentId: "d".repeat(64), minDistance: 128 },
  ]);
  viewer.undo();
  viewer.undo();
  equal(viewer.exportPatch(), undefined);
  throws(
    () =>
      viewer.updateSpatial([
        {
          kind: "replaceModelAsset",
          id: "model",
          changes: { asset: "other", contentId: "c".repeat(64) },
        },
      ]),
    /unrelated asset/,
  );
  equal(viewer.exportPatch(), undefined);
  equal(source.spatial!.models.model.contentId, "a".repeat(64));
});

test("legacy spatial v1 updates preserve valid whitespace terrain IDs", () => {
  const source = document();
  source.spatial!.terrain[0].id = " ";
  const viewer = createScenePlacementViewer({
    document: source,
    viewport: { cssWidth: 640, cssHeight: 480 },
  });
  viewer.updateSpatial([
    { kind: "updateTerrainSurface", id: " ", changes: { x: -90 } },
  ]);
  const patch = viewer.exportPatch();
  equal(patch?.spatial?.version, 1);
  equal(
    mergeScenePlacementPatch(source, patch!).document.spatial!.terrain[0].x,
    -90,
  );
  equal(source.spatial!.terrain[0].x, -100);
});

test("spatial placement uses sparse v3 operations, isolated snapshots, common undo and deterministic merge", () => {
  const viewer = subject(),
    original = document();
  equal(viewer.exportPatch(), undefined);
  viewer.beginEdit("Elevation");
  viewer.updateInstanceTransform("sprite", { x: 25 });
  viewer.updateSpatial([
    { kind: "updateBillboard", id: "sprite", changes: { elevation: 8 } },
  ]);
  viewer.updateSpatial([
    { kind: "updateBillboard", id: "sprite", changes: { elevation: 12 } },
  ]);
  viewer.commitEdit();
  const patch = viewer.exportPatch();
  if (!patch) throw new Error("patch missing");
  throws(
    () =>
      mergeScenePlacementPatch(document(), {
        ...patch,
        spatial: null,
      } as never),
    /spatial patch/,
  );
  equal(patch.version, 3);
  equal(patch.operations.length, 1);
  equal(patch.spatial?.operations.length, 1);
  const store = createScenePlacementPatchStore({ patch });
  equal(store.state().operationCount, 2);
  const copy = store.exportPatch();
  if (!copy?.spatial) throw new Error("spatial copy missing");
  Reflect.set(copy.spatial.operations[0].changes, "elevation", 99);
  equal(
    Reflect.get(
      store.exportPatch()!.spatial!.operations[0].changes,
      "elevation",
    ),
    12,
  );
  const merged = mergeScenePlacementPatch(original, patch);
  equal(merged.operationCount, 2);
  equal(merged.document.spatial?.billboards.sprite.elevation, 12);
  equal(merged.document.sceneComposition.fragments?.main.instances?.[0].x, 25);
  deepEqual(original, document());
  resolveSceneAuthoringDocument(merged.document, { validateComponents: true });
  equal(viewer.historyState().undoCount, 1);
  viewer.undo();
  equal(viewer.exportPatch(), undefined);
  viewer.redo();
  deepEqual(viewer.exportPatch(), patch);
  const state = viewer.state();
  if (!state.spatial) throw new Error("spatial state missing");
  state.spatial.billboards.sprite.elevation = 88;
  equal(viewer.state().spatial?.billboards.sprite.elevation, 12);
  viewer.beginEdit("Cancel");
  viewer.updateSpatial([
    { kind: "updateBillboard", id: "sprite", changes: { elevation: 30 } },
  ]);
  viewer.cancelEdit();
  deepEqual(viewer.exportPatch(), patch);
  viewer.clearDraftPatch();
  equal(viewer.exportPatch(), undefined);
  viewer.undo();
  deepEqual(viewer.exportPatch(), patch);
});

test("spatial batches validate the final terrain configuration and roll back every member and the open gesture", () => {
  const doc = document();
  if (!doc.spatial) throw new Error("spatial source missing");
  doc.spatial.terrain = [
    { id: "a", x: 0, y: 0, width: 10, depth: 10, elevation: 0 },
    { id: "b", x: 10, y: 0, width: 10, depth: 10, elevation: 0 },
  ];
  const viewer = createScenePlacementViewer({
    document: doc,
    viewport: { cssWidth: 320, cssHeight: 180 },
  });
  throws(
    () =>
      viewer.updateSpatial([
        { kind: "updateTerrainSurface", id: "a", changes: { x: 10 } },
      ]),
    /overlap/,
  );
  equal(viewer.exportPatch(), undefined);
  viewer.updateSpatial([
    { kind: "updateTerrainSurface", id: "a", changes: { x: 10 } },
    { kind: "updateTerrainSurface", id: "b", changes: { x: 20 } },
  ]);
  equal(viewer.historyState().undoCount, 1);
  equal(viewer.exportPatch()?.spatial?.operations.length, 2);
  const before = viewer.exportPatch();
  viewer.beginEdit("Invalid gesture");
  viewer.updateInstanceTransform("sprite", { x: 40 });
  throws(
    () =>
      viewer.updateSpatial([
        { kind: "updateBillboard", id: "sprite", changes: { elevation: 9 } },
        { kind: "updateModel", id: "model", changes: { scale: -1 } },
      ]),
    /scale/,
  );
  deepEqual(viewer.exportPatch(), before);
  equal(viewer.historyState().transactionLabel, undefined);
});

test("spatial references protect attachment child or parent identity", () => {
  const viewer = subject();
  for (const id of ["model", "proxy"]) {
    throws(
      () => viewer.renameInstance(id, "renamed"),
      /explicit reference migration/,
    );
    throws(() => viewer.removeInstances([id]), /explicit reference migration/);
  }
  viewer.setInstancesLocked(["sprite"], true);
  throws(
    () =>
      viewer.updateSpatial([
        { kind: "updateBillboard", id: "sprite", changes: { elevation: 2 } },
      ]),
    /locked/,
  );
  equal(viewer.exportPatch(), undefined);
  equal(viewer.historyState().undoCount, 0);
});

test("spatial patch rejects older envelopes, unknown fields/targets, non-finite values and narrowed scope atomically", () => {
  const viewer = subject();
  for (const operation of [
    { kind: "updateModel", id: "model", changes: { asset: "other" } },
    { kind: "updateModel", id: "missing", changes: { scale: 2 } },
    { kind: "updateBillboard", id: "sprite", changes: { elevation: NaN } },
    { kind: "updateBillboard", id: "sprite", changes: { castShadow: 1 } },
    { kind: "updateTerrainSurface", id: "ground", changes: { floorId: -1 } },
    {
      kind: "updateBillboard",
      id: "sprite",
      changes: { elevation: 1 },
      extra: true,
    },
  ])
    throws(() => viewer.updateSpatial([operation as never]));
  equal(viewer.exportPatch(), undefined);
  viewer.updateSpatial([
    { kind: "updateModel", id: "model", changes: { yawDegrees: 45, scale: 2 } },
  ]);
  const patch = viewer.exportPatch();
  if (!patch) throw new Error("patch missing");
  throws(
    () => mergeScenePlacementPatch(document(), { ...patch, version: 2 }),
    /version 3/,
  );
  throws(
    () =>
      mergeScenePlacementPatch(document(), { ...patch, spatial: undefined }),
    /version 3/,
  );
  throws(
    () =>
      mergeScenePlacementPatch(document(), patch, {
        allowedFragments: ["main"],
      }),
    /document-wide/,
  );
  const flat = document();
  delete flat.spatial;
  throws(() => mergeScenePlacementPatch(flat, patch), /requires a spatial/);
  const bad: ScenePlacementPatch = {
    format: patch.format,
    version: 2,
    operations: [{ kind: "removeInstance", instanceId: "model" }],
  };
  throws(
    () => mergeScenePlacementPatch(document(), bad),
    /applied|instance|agent-owned reference/,
  );
});

test("spatial save preserves model resource identity, body height/floor and non-placement authoring", async () => {
  const doc = document(),
    viewer = createScenePlacementViewer({
      document: doc,
      viewport: { cssWidth: 320, cssHeight: 180 },
    });
  viewer.updateInstanceComponents("sprite", {
    visual: { kind: "primitive", shape: "rect", width: 16, height: 24 },
    collider: { type: "aabb", halfWidth: 4, halfHeight: 4 },
    layer: "wall",
    body: {
      type: "static",
      heightSpan: { elevation: 32, height: 24, floorId: 1 },
    },
  });
  viewer.updateSpatial([
    {
      kind: "updateModel",
      id: "model",
      changes: { elevation: 5, yawDegrees: 30, scale: 1.5 },
    },
  ]);
  const patch = viewer.exportPatch();
  if (!patch) throw new Error("patch missing");
  const result = await saveScenePlacementPatch(doc, patch, {
    allowSave: true,
    adapter: {
      id: "test",
      saveScenePlacementPatch: (request) => ({
        saved: true,
        document: JSON.parse(JSON.stringify(request.mergedDocument)),
      }),
    },
  });
  equal(result.document.spatial?.models?.model.asset, "rock");
  equal(result.document.spatial?.models?.model.contentId, "a".repeat(64));
  deepEqual(result.document.spatial?.attachments, doc.spatial?.attachments);
  deepEqual(result.changedInstanceIds, ["sprite", "model"]);
  const reopened = createScenePlacementViewer({
    document: result.document,
    viewport: { cssWidth: 320, cssHeight: 180 },
  });
  deepEqual(reopened.state().instances[0].body?.heightSpan, {
    elevation: 32,
    height: 24,
    floorId: 1,
  });
  equal(reopened.state().spatial?.models?.model.scale, 1.5);
  equal(reopened.exportPatch(), undefined);
});

test("spatial instance creation validates composition and reference together in one undo entry", () => {
  const source = document();
  const seen: ScenePlacementPatch[] = [];
  const viewer = createScenePlacementViewer({
    document: source,
    viewport: { cssWidth: 640, cssHeight: 480 },
    validateDraft(state) {
      if (state.draftPatch) {
        const merged = mergeScenePlacementPatch(source, state.draftPatch);
        resolveSceneAuthoringDocument(merged.document, {
          validateComponents: true,
        });
        seen.push(state.draftPatch);
      }
    },
  });
  viewer.addInstance(
    "main",
    { id: "placed_sprite", prefab: "object", x: 24, y: 32 },
    { kind: "addBillboard", changes: {} },
  );
  equal(seen.length, 1);
  equal(viewer.historyState().undoCount, 1);
  const patch = viewer.exportPatch()!;
  equal(patch.version, 3);
  equal(patch.spatial?.version, 2);
  deepEqual(patch.spatial?.operations, [
    { kind: "addBillboard", id: "placed_sprite", changes: {} },
  ]);
  const merged = mergeScenePlacementPatch(source, patch);
  equal(merged.operationCount, 2);
  deepEqual(merged.changedInstanceIds, ["placed_sprite"]);
  ok(
    Object.prototype.hasOwnProperty.call(
      merged.document.spatial!.billboards,
      "placed_sprite",
    ),
  );
  equal(viewer.undo().draftPatch, undefined);
  deepEqual(viewer.redo().draftPatch, patch);
  const before = viewer.exportPatch();
  viewer.addInstance(
    "main",
    { id: "placed_model", prefab: "object", x: 40, y: 48 },
    {
      kind: "addModel",
      changes: {
        asset: "rock",
        contentId: "a".repeat(64),
        elevation: 8,
        yawDegrees: 30,
        scale: 1,
      },
    },
  );
  equal(viewer.historyState().undoCount, 2);
  equal(viewer.state().spatial?.models?.placed_model.asset, "rock");
  deepEqual(viewer.undo().draftPatch, before);
  deepEqual(source, document());
});

test("spatial additions reject duplicate, invalid and orphaned references without partial edits", () => {
  const viewer = subject();
  const snapshot = () =>
    JSON.stringify([
      viewer.exportPatch(),
      viewer.historyState(),
      viewer.state().selectedInstanceId,
    ]);
  const before = snapshot();
  for (const action of [
    () =>
      viewer.addInstance(
        "main",
        { id: "sprite", prefab: "object" },
        { kind: "addBillboard", changes: {} },
      ),
    () =>
      viewer.updateSpatial([
        { kind: "addBillboard", id: "model", changes: {} },
      ]),
    () =>
      viewer.updateSpatial([
        {
          kind: "addModel",
          id: "sprite",
          changes: { asset: "rock", contentId: "a".repeat(64) },
        },
      ]),
    () =>
      viewer.updateSpatial([
        { kind: "addBillboard", id: "missing", changes: {} },
      ]),
    () =>
      viewer.addInstance(
        "main",
        { id: "bad", prefab: "object" },
        { kind: "addModel", changes: { asset: "rock", contentId: "invalid" } },
      ),
    () =>
      viewer.addInstance(
        "main",
        { id: "bad", prefab: "object" },
        {
          kind: "addModel",
          changes: { asset: "rock", contentId: "a".repeat(64), scale: -1 },
        },
      ),
    () =>
      viewer.addInstance("main", { id: "bad", prefab: "object" }, {
        kind: "addBillboard",
        changes: { actor: true },
      } as never),
  ]) {
    throws(action);
    equal(snapshot(), before);
  }
  const patch = {
    format: "ferrum2d.scene-spatial.patch" as const,
    version: 2 as const,
    operations: [{ kind: "addBillboard" as const, id: "new", changes: {} }],
  };
  throws(
    () => applySceneSpatialPatch(document().spatial, { ...patch, version: 1 }),
    /version 2/,
  );
  throws(
    () =>
      applySceneSpatialPatch(document().spatial, {
        ...patch,
        operations: [{ ...patch.operations[0], id: " " }],
      }),
    /Invalid/,
  );
  const added = applySceneSpatialPatch(document().spatial, patch);
  throws(() => applySceneSpatialPatch(added, patch), /already exists/);
  equal(
    Object.prototype.hasOwnProperty.call(document().spatial!.billboards, "new"),
    false,
  );
});

test("host rejection of a spatial add restores the whole document, selection and redo branch", () => {
  let reject = false;
  const viewer = createScenePlacementViewer({
    document: document(),
    viewport: { cssWidth: 640, cssHeight: 480 },
    selectedInstanceId: "sprite",
    validateDraft() {
      if (reject) {
        reject = false;
        throw new Error("Model resource rejected");
      }
    },
  });
  viewer.updateInstanceTransform("sprite", { x: 20 });
  viewer.undo();
  const before = JSON.stringify([viewer.exportPatch(), viewer.historyState()]);
  reject = true;
  throws(
    () =>
      viewer.addInstance(
        "main",
        { id: "new", prefab: "object" },
        {
          kind: "addModel",
          changes: { asset: "rock", contentId: "a".repeat(64) },
        },
      ),
    /resource rejected/,
  );
  equal(JSON.stringify([viewer.exportPatch(), viewer.historyState()]), before);
  equal(viewer.state().selectedInstanceId, "sprite");
  equal(
    viewer.state().instances.some((instance) => instance.instanceId === "new"),
    false,
  );
  equal(viewer.state().spatial?.models?.new, undefined);
  viewer.redo();
  equal(viewer.state().instances[0].transform.x, 20);
});

test("new spatial references stay sparse after edits and survive checked save/reopen", async () => {
  const source = document(),
    viewer = subject();
  viewer.addInstance(
    "main",
    { id: "new", prefab: "object", x: 30, y: 40 },
    {
      kind: "addModel",
      changes: { asset: "rock", contentId: "a".repeat(64), scale: 1 },
    },
  );
  viewer.updateSpatial([
    { kind: "updateModel", id: "new", changes: { scale: 2, yawDegrees: 45 } },
  ]);
  const patch = viewer.exportPatch()!;
  equal(patch.spatial!.operations.length, 1);
  equal(patch.spatial!.operations[0].kind, "addModel");
  const result = await saveScenePlacementPatch(source, patch, {
    allowSave: true,
    adapter: {
      id: "test",
      saveScenePlacementPatch: (request) => ({
        saved: true,
        document: request.mergedDocument,
      }),
    },
  });
  const reopened = createScenePlacementViewer({
    document: result.document,
    viewport: { cssWidth: 640, cssHeight: 480 },
  });
  equal(reopened.state().spatial?.models?.new.scale, 2);
  equal(reopened.state().spatial?.models?.new.yawDegrees, 45);
  equal(reopened.exportPatch(), undefined);
  deepEqual(source, document());
});

test("identity protection cannot be bypassed by omitting a spatial envelope", () => {
  const source = document();
  delete source.spatial!.attachments;
  for (const id of ["sprite", "model"]) {
    const patch: ScenePlacementPatch = {
      format: "ferrum2d.scene-placement.patch",
      version: 2,
      operations: [
        { kind: "removeInstance", instanceId: id },
        {
          kind: "addInstance",
          fragment: "main",
          instance: { id, prefab: "object", x: 999 },
        },
      ],
    };
    throws(() => mergeScenePlacementPatch(source, patch), /matching spatial/);
  }
  source.gameplay = { primaryActor: "proxy" } as never;
  throws(
    () =>
      mergeScenePlacementPatch(source, {
        format: "ferrum2d.scene-placement.patch",
        version: 2,
        operations: [{ kind: "removeInstance", instanceId: "proxy" }],
      }),
    /agent-owned/,
  );
});

test("spatial copies retain their explicit origin across identical metadata, rename and undo", () => {
  const source = document();
  delete source.spatial!.attachments;
  source.spatial!.billboards = {
    sprite: { normalTextureId: 2 },
    proxy: { normalTextureId: 2 },
  };
  source.gameplay = { primaryActor: "sprite" } as never;
  const viewer = createScenePlacementViewer({
    document: source,
    viewport: { cssWidth: 640, cssHeight: 480 },
  });
  viewer.duplicateInstances(["proxy"]);
  viewer.renameInstance("proxy_copy_1", "copy");
  const patch = viewer.exportPatch()!;
  deepEqual(
    patch.spatial!.operations.find((op) => op.kind === "copyReference"),
    {
      kind: "copyReference",
      id: "copy",
      changes: { target: "billboard", sourceId: "proxy" },
    },
  );
  deepEqual(
    mergeScenePlacementPatch(source, patch).document.spatial!.billboards.copy,
    source.spatial!.billboards.proxy,
  );
  viewer.undo();
  viewer.redo();
  deepEqual(viewer.exportPatch(), patch);
  viewer.duplicateInstances(["copy"]);
  equal(
    viewer
      .exportPatch()!
      .spatial!.operations.filter((op) => op.kind === "copyReference").length,
    2,
  );
});

test("deleted or renamed source IDs stay reserved until save; failed reuse preserves the draft", () => {
  const source = document();
  delete source.spatial!.attachments;
  source.spatial!.billboards = { sprite: { normalTextureId: 2 } };
  const viewer = createScenePlacementViewer({
    document: source,
    viewport: { cssWidth: 640, cssHeight: 480 },
  });
  viewer.removeInstance("sprite");
  const patch = viewer.exportPatch(),
    history = viewer.historyState();
  throws(
    () =>
      viewer.addInstance(
        "main",
        { id: "sprite", prefab: "object" },
        { kind: "addBillboard", changes: {} },
      ),
    /reserved/,
  );
  deepEqual(viewer.exportPatch(), patch);
  deepEqual(viewer.historyState(), history);
  equal(
    mergeScenePlacementPatch(source, patch!).document.spatial!.billboards
      .sprite,
    undefined,
  );
  viewer.undo();
  viewer.renameInstance("sprite", "renamed");
  throws(
    () => viewer.addInstance("main", { id: "sprite", prefab: "object" }),
    /reserved/,
  );
});

test("empty optional model maps cancel cleanly and duplicate names skip reserved source IDs", () => {
  const source = document();
  delete source.spatial!.attachments;
  delete source.spatial!.models;
  const viewer = createScenePlacementViewer({
    document: source,
    viewport: { cssWidth: 640, cssHeight: 480 },
  });
  viewer.addInstance(
    "main",
    { id: "new", prefab: "object" },
    { kind: "addModel", changes: { asset: "rock", contentId: "a".repeat(64) } },
  );
  viewer.removeInstance("new");
  equal(viewer.exportPatch(), undefined);
  const reserved = document();
  delete reserved.spatial!.attachments;
  reserved.sceneComposition.fragments!.main.instances = [
    { id: "safe", prefab: "object" },
    { id: "safe_copy_1", prefab: "object" },
  ];
  reserved.spatial!.billboards = { safe: {}, safe_copy_1: {} };
  delete reserved.spatial!.models;
  const copies = createScenePlacementViewer({
    document: reserved,
    viewport: { cssWidth: 640, cssHeight: 480 },
  });
  copies.removeInstance("safe_copy_1");
  copies.duplicateInstances(["safe"]);
  equal(copies.state().selectedInstanceId, "safe_copy_2");
});

test("flat gameplay-owned identities also reject UI migration before history changes", () => {
  const source = document();
  delete source.spatial;
  source.gameplay = { primaryActor: "sprite" } as never;
  const viewer = createScenePlacementViewer({
    document: source,
    viewport: { cssWidth: 640, cssHeight: 480 },
  });
  for (const run of [
    () => viewer.renameInstance("sprite", "new"),
    () => viewer.removeInstance("sprite"),
    () => viewer.duplicateInstances(["sprite"]),
  ]) {
    throws(run, /agent-owned/);
    equal(viewer.exportPatch(), undefined);
    equal(viewer.historyState().undoCount, 0);
  }
});

test("duplication never silently drops agent-owned instance props", () => {
  const source = document();
  delete source.spatial!.attachments;
  delete source.spatial!.models;
  const customData = { score: 7, labels: ["first", "second"] };
  source.sceneComposition.fragments!.main.instances = [
    { id: "sprite", prefab: "object", props: { customData } },
  ];
  const viewer = createScenePlacementViewer({
    document: source,
    viewport: { cssWidth: 640, cssHeight: 480 },
  });
  throws(
    () => viewer.duplicateInstances(["sprite"]),
    /agent-owned duplication/,
  );
  equal(viewer.exportPatch(), undefined);
  equal(viewer.historyState().undoCount, 0);
  // Inherited data stays on the same prefab and requires no forbidden property write.
  source.sceneComposition.prefabs = {
    ...source.sceneComposition.prefabs,
    object: {
      props: { ...source.sceneComposition.prefabs.object.props, customData },
    },
  };
  const inherited = createScenePlacementViewer({
    document: source,
    viewport: { cssWidth: 640, cssHeight: 480 },
  });
  inherited.duplicateInstances(["sprite"]);
  const merged = mergeScenePlacementPatch(
    source,
    inherited.exportPatch()!,
  ).document;
  equal(merged.sceneComposition.fragments!.main.instances![1].prefab, "object");
  deepEqual(
    merged.sceneComposition.prefabs.object.props!.customData,
    customData,
  );
  equal(
    merged.sceneComposition.fragments!.main.instances![1].props?.customData,
    undefined,
  );
  inherited.undo();
  equal(inherited.exportPatch(), undefined);
});
