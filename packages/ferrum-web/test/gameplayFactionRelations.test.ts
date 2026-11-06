import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";

// Use the SDK entrypoint to keep its reexports and the direct command path covered.
import { applyFactionRelationTable, applyGameplayBehaviorCommands } from "../src/authoring.js";
import type { BehaviorRecipeCommand } from "../src/behaviorRecipes.js";
import type { GameplayBehaviorRuntimeEngine } from "../src/gameplayAuthoring.js";
import type { FactionRelationTableSpec } from "../src/gameplayFactionRelations.js";

const inheritedNames = ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"];
const handles = { actor: { entityId: 12, entityGeneration: 4 } };
const command = {
  type: "configureFaction", entity: "actor", recipe: "test", tags: [],
  faction: "player", damages: ["enemy"],
} as const;

function fixture() {
  const calls: unknown[][] = [];
  const engine = {
    set_gameplay_faction(...args: number[]): boolean {
      calls.push(["faction", ...args]);
      return true;
    },
    clear_gameplay_faction_relations(): void { calls.push(["clear"]); },
    set_gameplay_faction_default_relation(code: number): boolean {
      calls.push(["default", code]);
      return true;
    },
    set_gameplay_faction_relation(source: number, target: number, relation: number): boolean {
      calls.push(["relation", source, target, relation]);
      return true;
    },
  };
  return { calls, engine, gameplay: engine as unknown as GameplayBehaviorRuntimeEngine };
}

function expectDiagnostic(run: () => void, path: string): void {
  try {
    run();
  } catch (error) {
    ok(error instanceof Error);
    equal((error as Error & { context?: { path?: string } }).context?.path, path);
    return;
  }
  throw new Error("Expected a gameplay authoring diagnostic.");
}

test("public configureFaction rejects inherited faction names before calling the runtime", () => {
  const { calls, gameplay } = fixture();
  for (const faction of inheritedNames) {
    // JSON represents the untrusted direct-command input without claiming a valid enum.
    const invalid: BehaviorRecipeCommand = JSON.parse(JSON.stringify({ ...command, faction }));
    expectDiagnostic(() => applyGameplayBehaviorCommands(gameplay, [invalid], handles, {
      path: "custom",
    }), "custom.commands.0.faction");
    deepEqual(calls, []);
  }
});

test("public configureFaction rejects inherited damage-mask names before numeric bit shifts", () => {
  const { calls, gameplay } = fixture();
  for (const name of inheritedNames) {
    const invalid: BehaviorRecipeCommand = JSON.parse(JSON.stringify({ ...command, damages: [name] }));
    expectDiagnostic(() => applyGameplayBehaviorCommands(gameplay, [invalid], handles, {
      path: "custom",
    }), "custom.commands.0.damages.0");
    deepEqual(calls, []);
  }
});

test("public faction relation tables reject inherited names before clearing live relations", () => {
  const { calls, engine } = fixture();
  const valid = { source: "player", target: "enemy", relation: "hostile" };
  for (const name of inheritedNames) {
    const cases = [
      { table: { defaultRelation: name, relations: [] }, path: "defaultRelation" },
      { table: { relations: [{ ...valid, source: name }] }, path: "relations.0.source" },
      { table: { relations: [{ ...valid, target: name }] }, path: "relations.0.target" },
      { table: { relations: [valid, { ...valid, relation: name }] }, path: "relations.1.relation" },
    ];
    for (const { table, path } of cases) {
      const invalid: FactionRelationTableSpec = JSON.parse(JSON.stringify(table));
      expectDiagnostic(() => applyFactionRelationTable(engine, invalid, { path: "custom" }), `custom.${path}`);
      deepEqual(calls, []);
    }
  }
});

test("public configureFaction preserves named codes, numeric endpoints and unsigned damage masks", () => {
  const { calls, gameplay } = fixture();
  const cases = [["neutral", 0], ["player", 1], ["enemy", 2], [0, 0], [31, 31]] as const;
  for (const [faction] of cases) {
    const valid: BehaviorRecipeCommand = { ...command, faction, damages: [0, 31, 31] };
    applyGameplayBehaviorCommands(gameplay, [valid], handles);
  }
  deepEqual(calls, cases.map(([, code]) => ["faction", 12, 4, code, 0x80000001]));
});

test("public faction relation tables preserve valid named and numeric codes", () => {
  const { calls, engine } = fixture();
  deepEqual(applyFactionRelationTable(engine, {
    defaultRelation: "friendly",
    relations: [
      { source: 0, target: 31, relation: "hostile" },
      { source: "enemy", target: "player", relation: "neutral" },
    ],
  }), { applied: true, defaultRelation: "friendly", relationCount: 2 });
  deepEqual(calls, [
    ["clear"], ["default", 1], ["relation", 0, 31, 2], ["relation", 2, 1, 0],
  ]);
});
