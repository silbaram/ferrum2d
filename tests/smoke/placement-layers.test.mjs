import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/placement-viewer/package.json", import.meta.url));
const ts = require("typescript");
const code = ts.transpileModule(await readFile(new URL("../../apps/placement-viewer/src/placementLayerState.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { placementLayerGroups, placementSoloPolicy } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
const instance = (id, layer) => ({ instanceId: id, transform: { layer }, visual: { kind: "sprite" } });
const state = instances => ({ instances, selectedInstanceIds: [], lockedInstanceIds: [], layerEditing: { hiddenLayers: [], lockedLayers: [] } });

test("layer grouping classifies each instance once and retains effective-layer selection and locks", () => {
  let reads = 0;
  const value = state(Array.from({ length: 512 }, (_, layer) => ({ instanceId: `sprite_${layer}`, transform: { get layer() { reads++; return layer; } } })));
  value.instances.push({ ...instance("override", -1), visual: { kind: "sprite", layer: 3 } });
  value.selectedInstanceIds = ["override"]; value.lockedInstanceIds = ["sprite_3"];
  const groups = placementLayerGroups(value);
  assert.equal(reads, 512);
  assert.equal(groups.size, 512);
  assert.deepEqual(groups.get(3), { ids: ["sprite_3", "override"], selected: true, locked: true });
  assert.equal(groups.has(-1), false);
});

test("solo reconciles new numeric layers, preserves locks and restores prior visibility when removed", () => {
  const value = state([instance("front", 0), instance("back", -1)]), view = { solo: 0, beforeSolo: [-2] };
  value.layerEditing = { hiddenLayers: [-1], lockedLayers: [0] };
  assert.equal(placementSoloPolicy(value, view), undefined);
  value.instances.push(instance("new", 2));
  assert.deepEqual(placementSoloPolicy(value, view), { hiddenLayers: [-1, 2], lockedLayers: [0] });
  value.instances.shift();
  assert.deepEqual(placementSoloPolicy(value, view), { hiddenLayers: [-2], lockedLayers: [0] });
  assert.equal(view.solo, undefined);
  assert.deepEqual(view.beforeSolo, [-2]);
});
