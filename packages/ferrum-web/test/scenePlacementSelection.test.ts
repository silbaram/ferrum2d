import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { createScenePlacementViewer } from "../src/authoring.js";

function viewer(
  count = 3,
  validateDraft?: Parameters<
    typeof createScenePlacementViewer
  >[0]["validateDraft"],
) {
  return createScenePlacementViewer({
    validateDraft,
    viewport: { cssWidth: 320, cssHeight: 180 },
    sceneComposition: {
      initialFragment: "main",
      prefabs: {
        object: {
          props: {
            components: {
              visual: {
                kind: "primitive",
                shape: "rect",
                width: 20,
                height: 20,
                color: "#ffffff",
              },
              collider: "none",
              layer: "wall",
            },
          },
        },
      },
      fragments: {
        main: {
          instances: Array.from({ length: count }, (_, index) => ({
            id: `object_${index}`,
            prefab: "object",
            x: 40 + index * 40,
            y: 80,
          })),
        },
      },
    },
  });
}

test("placement selection is ordered, isolated, compatible with single selection and does not create edits", () => {
  const subject = viewer();
  const state = subject.selectInstances(["object_2", "object_0", "object_2"]);
  deepEqual(state.selectedInstanceIds, ["object_2", "object_0"]);
  equal(state.selectedInstanceId, "object_0");
  Reflect.set(state.selectedInstanceIds, 0, "object_1");
  deepEqual(subject.state().selectedInstanceIds, ["object_2", "object_0"]);
  throws(() => subject.selectInstances(["object_1", "missing"]), /unknown/);
  deepEqual(subject.state().selectedInstanceIds, ["object_2", "object_0"]);
  deepEqual(subject.selectInstance("object_1").selectedInstanceIds, [
    "object_1",
  ]);
  deepEqual(subject.selectInstance().selectedInstanceIds, []);
  equal(subject.historyState().undoCount, 0);
  equal(subject.exportPatch(), undefined);
});

test("batch transform validates every member before applying and records one deterministic undo", () => {
  const subject = viewer();
  subject.selectInstances(["object_0", "object_1"]);
  subject.updateInstanceTransforms([
    { instanceId: "object_1", transform: { x: 100 } },
    { instanceId: "object_0", transform: { x: 60 } },
  ]);
  deepEqual(
    subject
      .exportPatch()
      ?.operations.map((operation) =>
        "instanceId" in operation ? operation.instanceId : undefined,
      ),
    ["object_0", "object_1"],
  );
  equal(subject.historyState().undoCount, 1);
  const before = JSON.stringify([
    subject.exportPatch(),
    subject.historyState(),
  ]);
  for (const updates of [
    [
      { instanceId: "object_0", transform: { x: 200 } },
      { instanceId: "missing", transform: { x: 1 } },
    ],
    [
      { instanceId: "object_0", transform: { x: 200 } },
      { instanceId: "object_1", transform: { scale: -1 } },
    ],
    [
      { instanceId: "object_0", transform: { x: 200 } },
      { instanceId: "object_1", transform: { y: NaN } },
    ],
    [
      { instanceId: "object_0", transform: { x: 200 } },
      { instanceId: "object_0", transform: { x: 1 } },
    ],
  ]) {
    throws(() => subject.updateInstanceTransforms(updates));
    equal(
      JSON.stringify([subject.exportPatch(), subject.historyState()]),
      before,
    );
  }
  equal(subject.undo().draftPatch, undefined);
  deepEqual(subject.state().selectedInstanceIds, ["object_0", "object_1"]);
  equal(subject.redo().instances[0].transform.x, 60);
});

test("a batch gesture cancels all changes and removes no-op edits without changing the redo branch", () => {
  const subject = viewer();
  subject.selectInstances(["object_0", "object_1"]);
  subject.beginEdit("Group Drag");
  subject.updateInstanceTransforms([
    { instanceId: "object_0", transform: { x: 60 } },
    { instanceId: "object_1", transform: { x: 100 } },
  ]);
  subject.updateInstanceTransforms([
    { instanceId: "object_0", transform: { x: 70 } },
    { instanceId: "object_1", transform: { x: 110 } },
  ]);
  subject.cancelEdit();
  equal(subject.exportPatch(), undefined);
  equal(subject.historyState().undoCount, 0);
  subject.updateInstanceTransform("object_0", { x: 60 });
  subject.undo();
  subject.updateInstanceTransforms([]);
  subject.updateInstanceTransform("object_0", { x: 40 });
  equal(subject.historyState().redoCount, 1);
  subject.beginEdit("Invalid Group");
  subject.updateInstanceTransform("object_0", { x: 90 });
  throws(() =>
    subject.updateInstanceTransforms([
      { instanceId: "missing", transform: { x: 1 } },
    ]),
  );
  equal(subject.exportPatch(), undefined);
  equal(subject.historyState().transactionLabel, undefined);
});

test("edit locks skip canvas picking and reject direct and batch edits without changing history", () => {
  const subject = viewer();
  subject.setInstancesLocked(["object_0"], true);
  equal(subject.pickInstanceAtScreen({ x: 40, y: 80 }), undefined);
  deepEqual(
    subject.selectInstanceAtScreen({ x: 40, y: 80 }).selectedInstanceIds,
    [],
  );
  equal(subject.selectInstance("object_0").selectedInstanceId, "object_0");
  const before = JSON.stringify([
    subject.exportPatch(),
    subject.historyState(),
  ]);
  for (const action of [
    () => subject.updateInstanceTransform("object_0", { x: 5 }),
    () => subject.updateInstanceComponents("object_0", {}),
    () =>
      subject.updateBehaviorBinding(
        { kind: "instance", instanceId: "object_0" },
        null,
      ),
    () => subject.renameInstance("object_0", "renamed"),
    () => subject.removeInstance("object_0"),
    () =>
      subject.updateInstanceTransforms([
        { instanceId: "object_1", transform: { x: 5 } },
        { instanceId: "object_0", transform: { x: 1 } },
      ]),
    () => subject.removeInstances(["object_1", "object_0"]),
  ]) {
    throws(action, /locked/);
    equal(
      JSON.stringify([subject.exportPatch(), subject.historyState()]),
      before,
    );
  }
  throws(
    () => subject.setInstancesLocked(["object_1", "missing"], true),
    /unknown/,
  );
  deepEqual(subject.state().lockedInstanceIds, ["object_0"]);
  subject.setInstancesLocked(["object_0"], false);
  equal(subject.pickInstanceAtScreen({ x: 40, y: 80 })?.instanceId, "object_0");
  equal(subject.historyState().undoCount, 0);
  subject.updateInstanceTransform("object_1", { x: 40 });
  subject.setInstancesLocked(["object_1"], true);
  equal(subject.pickInstanceAtScreen({ x: 40, y: 80 })?.instanceId, "object_0");
});

test("locks follow source and added identities through rename undo, but do not enter history", () => {
  const subject = viewer();
  subject.renameInstance("object_0", "renamed");
  subject.setInstancesLocked(["renamed"], true);
  deepEqual(subject.undo().lockedInstanceIds, ["object_0"]);
  deepEqual(subject.redo().lockedInstanceIds, ["renamed"]);
  subject.addInstance("main", { id: "added", prefab: "object", x: 10, y: 10 });
  subject.renameInstance("added", "added_renamed");
  subject.setInstancesLocked(["added_renamed"], true);
  deepEqual(subject.undo().lockedInstanceIds, ["renamed", "added"]);
  subject.clearDraftPatch();
  deepEqual(subject.state().lockedInstanceIds, ["object_0"]);
  subject.undo();
  // A discarded object's lock is UI state, not a historical document edit.
  deepEqual(subject.state().lockedInstanceIds, ["renamed"]);
  subject.beginEdit("Gesture");
  throws(() => subject.setInstancesLocked(["object_1"], true), /Finish/);
  subject.cancelEdit();
});

test("cancel and failed revert retain transient locks without putting them in undo history", () => {
  for (const finish of ["cancel", "failure", "undo"] as const) {
    const subject = viewer();
    subject.addInstance("main", { id: "added", prefab: "object" });
    subject.setInstancesLocked(["added"], true);
    subject.selectInstance("added");
    const before = JSON.stringify([
      subject.exportPatch(),
      subject.historyState(),
    ]);
    subject.beginEdit("Revert");
    subject.clearDraftPatch();
    if (finish === "cancel") subject.cancelEdit();
    else if (finish === "undo") subject.undo();
    else
      throws(
        () => subject.updateInstanceTransform("missing", { x: 1 }),
        /unknown/,
      );
    equal(
      JSON.stringify([subject.exportPatch(), subject.historyState()]),
      before,
    );
    deepEqual(subject.state().lockedInstanceIds, ["added"]);
    throws(() => subject.updateInstanceTransform("added", { x: 2 }), /locked/);
    subject.beginEdit("Committed Revert");
    subject.clearDraftPatch();
    subject.commitEdit();
    deepEqual(subject.undo().lockedInstanceIds, []);
  }
});

test("batch remove restores source and added instances, components and ordered selection in one undo", () => {
  const subject = viewer();
  subject.addInstance("main", { id: "added_a", prefab: "object" });
  subject.addInstance("main", { id: "added_b", prefab: "object" });
  subject.selectInstances(["added_b", "object_0", "added_a"]);
  const before = JSON.stringify(subject.exportPatch());
  const count = subject.historyState().undoCount;
  throws(() => subject.removeInstances(["added_a", "missing"]), /unknown/);
  equal(JSON.stringify(subject.exportPatch()), before);
  subject.removeInstances(["added_a", "object_0", "added_b"]);
  equal(subject.historyState().undoCount, count + 1);
  equal(subject.state().instances.length, 2);
  deepEqual(subject.state().selectedInstanceIds, []);
  equal(JSON.stringify(subject.undo().draftPatch), before);
  deepEqual(subject.state().selectedInstanceIds, [
    "added_b",
    "object_0",
    "added_a",
  ]);
  equal(subject.redo().instances.length, 2);
});

test("host rejection preserves edits, undo/redo cursor and open gesture state atomically", () => {
  let reject = false;
  let nativeX = 40;
  const subject = viewer(3, (state) => {
    nativeX = state.instances[0].transform.x;
    if (reject) {
      reject = false;
      throw new Error("Native preview rejected");
    }
  });
  subject.updateInstanceTransform("object_0", { x: 60 });
  const checkRejected = (action: () => unknown) => {
    const before = JSON.stringify([
      subject.exportPatch(),
      subject.historyState(),
    ]);
    const beforeX = nativeX;
    reject = true;
    throws(action, /Native preview rejected/);
    equal(
      JSON.stringify([subject.exportPatch(), subject.historyState()]),
      before,
    );
    equal(nativeX, beforeX);
  };
  checkRejected(() => subject.undo());
  subject.undo();
  checkRejected(() => subject.redo());
  subject.redo();
  subject.beginEdit("Drag");
  subject.updateInstanceTransform("object_0", { x: 70 });
  checkRejected(() => subject.cancelEdit());
  checkRejected(() => subject.undo());
  subject.cancelEdit();
  equal(nativeX, 60);
  subject.undo();
  checkRejected(() => subject.updateInstanceTransform("object_0", { x: 80 }));
  equal(subject.historyState().redoCount, 1);
});

test("draft validators cannot reenter document mutations or history", () => {
  let nested: (() => void) | undefined;
  const subject = viewer(3, () => {
    const action = nested;
    nested = undefined;
    action?.();
  });
  for (const action of [
    () => {
      subject.updateInstanceTransform("object_0", { x: 99 });
    },
    () => {
      subject.undo();
    },
    () => {
      subject.beginEdit("Nested");
    },
    () => {
      subject.commitEdit();
    },
  ]) {
    nested = action;
    throws(
      () => subject.updateInstanceTransform("object_0", { x: 60 }),
      /cannot reenter/,
    );
    equal(subject.state().instances[0].transform.x, 40);
    equal(subject.historyState().undoCount, 0);
    equal(subject.historyState().transactionLabel, undefined);
  }
});

test("failed edit recovery never revives a rejected candidate", () => {
  for (const transaction of [false, true]) {
    let rejectedCalls = 0;
    let nativeX = 40;
    const subject = viewer(3, (state) => {
      nativeX = state.instances[0].transform.x;
      if (rejectedCalls > 0) {
        rejectedCalls--;
        throw new Error("Native preview rejected");
      }
    });
    if (transaction) {
      subject.beginEdit("Drag");
      subject.updateInstanceTransform("object_0", { x: 50 });
    }
    const before = JSON.stringify([
      subject.exportPatch(),
      subject.historyState(),
    ]);
    rejectedCalls = 2;
    throws(
      () => subject.updateInstanceTransform("object_0", { x: 60 }),
      /Native preview rejected/,
    );
    equal(
      JSON.stringify([subject.exportPatch(), subject.historyState()]),
      before,
    );
    equal(subject.state().instances[0].transform.x, transaction ? 50 : 40);
    equal(nativeX, transaction ? 50 : 40);
    if (transaction) subject.cancelEdit();
    subject.updateInstanceTransform("object_0", { x: 70 });
    equal(subject.historyState().undoCount, 1);
    equal(subject.undo().instances[0].transform.x, 40);
  }
});

test("a thousand selected transforms use one batch history entry and fully roll back", () => {
  const subject = viewer(1024);
  const initial = subject.state();
  subject.selectInstances(
    initial.instances.map((instance) => instance.instanceId),
  );
  subject.updateInstanceTransforms(
    initial.instances.map((instance) => ({
      instanceId: instance.instanceId,
      transform: { x: instance.transform.x + 16 },
    })),
  );
  equal(subject.exportPatch()?.operations.length, 1024);
  equal(subject.historyState().undoCount, 1);
  equal(subject.undo().draftPatch, undefined);
  equal(subject.state().selectedInstanceIds.length, 1024);
});
