import {
  equal,
  readonlySnapshotTypeAssertions,
  test,
} from "./publicApiTypes.shared.js";

test("public API readonly snapshot type assertions are importable", () => {
  equal(readonlySnapshotTypeAssertions.length, 5);
});
