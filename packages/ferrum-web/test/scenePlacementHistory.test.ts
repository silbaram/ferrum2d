import { equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { ScenePlacementHistory } from "../src/scenePlacementHistory.js";

test("placement history bounds entry count and byte retention, including oversized edits", () => {
  let value = "0";
  const history = new ScenePlacementHistory(() => value, snapshot => { value = snapshot; }, snapshot => snapshot);
  for (let i = 1; i <= 110; i++) history.edit("Edit", () => { value = String(i); });
  equal(history.state().undoCount, 100);
  for (let i = 0; i < 100; i++) history.undo();
  equal(value, "10");
  history.edit("Large edit", () => { value = "x".repeat(5 * 1024 * 1024); });
  equal(history.state().undoCount, 1);
  ok(history.state().bytes <= 8 * 1024 * 1024);
  history.edit("Oversized edit", () => { value = "y".repeat(5 * 1024 * 1024); });
  equal(history.state().undoCount, 0);
  equal(history.state().redoCount, 0);
  equal(history.state().bytes, 0);
  equal(value[0], "y");
});

test("placement history rejects ambiguous transactions and rolls back failed edits", () => {
  let value = 0;
  const history = new ScenePlacementHistory(() => value, snapshot => { value = snapshot; }, String);
  throws(() => history.begin(" "), /requires a label/);
  history.begin("Drag");
  throws(() => history.begin("Nested"), /already in progress/);
  history.edit("Move", () => { value = 10; });
  history.commit();
  equal(history.state().undoCount, 1);
  throws(() => history.edit("Fail", () => { value = 99; throw new Error("invalid"); }), /invalid/);
  equal(value, 10);
  equal(history.state().undoCount, 1);
});
