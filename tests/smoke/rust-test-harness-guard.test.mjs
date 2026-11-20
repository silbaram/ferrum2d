import assert from "node:assert/strict";
import test from "node:test";
import {
  findForbiddenStorageAccess,
  isExternalRustTestFile,
} from "../../scripts/validate/check-rust-test-harness.mjs";

test("World-owned storage fixtures stay inside the owning module", () => {
  for (const path of [
    "crates/ferrum-core/src/world/tests.rs",
    "crates/ferrum-core/src/world/tests/joints.rs",
    "crates/ferrum-core/src/world/persistence_admission/tests.rs",
    "crates\\ferrum-core\\src\\world\\persistence_admission\\tests.rs",
  ]) {
    assert.equal(isExternalRustTestFile(path), false, path);
  }
});

test("Engine and other external test modules retain the storage guard", () => {
  for (const path of [
    "crates/ferrum-core/src/engine/tests.rs",
    "crates/ferrum-core/src/engine/tests/data_scene.rs",
    "crates/ferrum-core/src/engine/unified_physics/file_admission/tests.rs",
    "crates/ferrum-core/src/world_adapter/tests.rs",
    "crates/ferrum-core/src/tests/world/tests.rs",
    "crates\\ferrum-core\\src\\engine\\tests\\data_scene.rs",
  ]) {
    assert.equal(isExternalRustTestFile(path), true, path);
  }
  assert.equal(isExternalRustTestFile("crates/ferrum-core/src/world.rs"), false);
});

test("External direct fields are reported with their original location", () => {
  const filePath = "crates/ferrum-core/src/engine/tests/candidate.rs";
  const source = "// fixture\n  engine.world.transforms.reserve_exact(19);\nworld.alive[0] = true;";
  assert.deepEqual(findForbiddenStorageAccess(filePath, source), [
    { filePath, line: 2, column: 3, match: "engine.world.transforms" },
    { filePath, line: 3, column: 1, match: "world.alive" },
  ]);
  assert.deepEqual(findForbiddenStorageAccess(filePath,
    "world.set_transform(entity, transform);\nworld.is_alive(entity);"), []);
});
