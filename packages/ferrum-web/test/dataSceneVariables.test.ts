import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  resolveDataSceneVariableDeclarations,
  synchronizeDataSceneVariableStore,
} from "../src/dataSceneVariables.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import { FerrumDiagnosticError } from "../src/diagnostics.js";

test("data scene variable declarations resolve integer, real, and bool defaults", () => {
  const resolved = resolveDataSceneVariableDeclarations([
    { name: "campaign.coins", scope: "global", type: "integer", default: 0 },
    { name: "player.speed", scope: "global", type: "real", default: 1.25 },
    { name: "wave.complete", scope: "scene", type: "bool", default: false },
  ]);

  equal(resolved.length, 3);
  deepEqual(resolved[0], {
    name: "campaign.coins",
    scope: "global",
    type: "integer",
    default: 0,
  });
  equal(resolved[1]?.default, 1.25);
  equal(resolved[2]?.default, false);
});

test("data scene variable resolver rejects invalid defaults and duplicate declarations", () => {
  throws(
    () => resolveDataSceneVariableDeclarations([
      { name: "coins", scope: "global", type: "integer", default: 0 },
      { name: "coins", scope: "scene", type: "integer", default: 1 },
    ]),
    /duplicates variable/,
  );
  throws(
    () => resolveDataSceneVariableDeclarations([
      { name: "coins", scope: "global", type: "integer", default: 0.5 },
    ]),
    /default.*safe integer/,
  );
  throws(
    () => resolveDataSceneVariableDeclarations([
      { name: "ready", scope: "scene", type: "bool", default: 0 },
    ]),
    /default.*boolean/,
  );
  throws(
    () => resolveDataSceneVariableDeclarations([
      { name: "speed", scope: "runtime", type: "real", default: 1 },
    ]),
    /scope.*global.*scene/,
  );
  throws(
    () => resolveDataSceneVariableDeclarations([
      { name: "speed", scope: "global", type: "number", default: 1 },
    ]),
    /type.*integer.*real.*bool/,
  );
});

test("data scene variable resolver reports a gameplay-authoring diagnostic path", () => {
  const error = capturedError(() => resolveDataSceneVariableDeclarations([
    { name: "coins", scope: "global", type: "integer", default: 0.5 },
  ], { path: "document.variables" }));

  if (!(error instanceof FerrumDiagnosticError)) {
    throw new Error("Expected FerrumDiagnosticError.");
  }
  equal(error.code, "FERRUM_GAMEPLAY_AUTHORING_INVALID");
  equal(error.context.path, "document.variables.0.default");
});

test("data scene variable store rejects undeclared and type-invalid access", () => {
  const store = synchronizeDataSceneVariableStore(
    {} as FerrumEngine,
    resolveDataSceneVariableDeclarations([
      { name: "coins", scope: "global", type: "integer", default: 1 },
      { name: "ready", scope: "scene", type: "bool", default: false },
    ]),
  );

  equal(store.get("coins"), 1);
  store.set("coins", 4);
  store.set("ready", true);
  deepEqual(store.values("global"), { coins: 4 });
  deepEqual(store.values("scene"), { ready: true });
  throws(() => store.get("missing"), /undeclared variable/);
  throws(() => store.set("missing", 1), /undeclared variable/);
  throws(() => store.set("coins", 1.5), /must be a safe integer/);
  throws(() => store.set("ready", 1), /must be a boolean/);
});

test("data scene reapply preserves compatible global values and resets scene values", () => {
  const engine = {} as FerrumEngine;
  const first = synchronizeDataSceneVariableStore(
    engine,
    resolveDataSceneVariableDeclarations([
      { name: "coins", scope: "global", type: "integer", default: 1 },
      { name: "wave", scope: "scene", type: "integer", default: 2 },
      { name: "difficulty", scope: "global", type: "integer", default: 3 },
    ]),
  );
  first.set("coins", 9);
  first.set("wave", 7);
  first.set("difficulty", 8);

  const second = synchronizeDataSceneVariableStore(
    engine,
    resolveDataSceneVariableDeclarations([
      { name: "coins", scope: "global", type: "integer", default: 100 },
      { name: "wave", scope: "scene", type: "integer", default: 4 },
      { name: "difficulty", scope: "global", type: "real", default: 1.5 },
      { name: "unlocked", scope: "global", type: "bool", default: false },
    ]),
  );

  equal(second, first);
  equal(second.get("coins"), 9);
  equal(second.get("wave"), 4);
  equal(second.get("difficulty"), 1.5);
  equal(second.get("unlocked"), false);
});

test("data scene variable restore is strict and transactional", () => {
  const store = synchronizeDataSceneVariableStore(
    {} as FerrumEngine,
    resolveDataSceneVariableDeclarations([
      { name: "coins", scope: "global", type: "integer", default: 1 },
      { name: "ready", scope: "global", type: "bool", default: false },
    ]),
  );

  throws(() => store.restore("global", { coins: 8 }), /must provide declared global variable/);
  equal(store.get("coins"), 1);
  throws(
    () => store.restore("global", { coins: 8, ready: true, unknown: 1 }),
    /undeclared global variable/,
  );
  equal(store.get("coins"), 1);
  store.restore("global", { coins: 8, ready: true });
  deepEqual(store.values("global"), { coins: 8, ready: true });
});

function capturedError(callback: () => unknown): unknown {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error("Expected callback to throw.");
}
