import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FerrumDiagnosticError } from "../src/diagnostics.js";
import { test } from "node:test";
import {
  applyDataSceneAuthoringDocument, createScenePlacementViewer, mergeScenePlacementPatch,
  createScenePlacementAgentHandoff, saveScenePlacementPatch, resolveSceneAuthoringDocument,
  resolveDataSceneInstanceComponents, type SceneAuthoringDocumentSpec, type DataSceneComponentsSpec,
  type ScenePlacementPatch,
} from "../src/authoring.js";
import { createEngine, initializeFerrumWasm, UNIFIED_PHYSICS_STATE_LAYOUT as B } from "../src/core.js";

const components: DataSceneComponentsSpec = {
  visual: { kind: "sprite", texture: 0, width: 20, height: 24 }, collider: "none", layer: "wall",
  body: { kind: "dynamic", gravityScale: 0, collider: { shape: { type: "box", halfExtents: [1, 2, 0.1] } } },
};
function fixture(): SceneAuthoringDocumentSpec {
  return {
    format: "ferrum2d.consumer.scene-authoring", version: 1,
    componentTemplates: { solid: structuredClone(components) },
    physics: { space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1 },
    sceneComposition: { initialFragment: "main", prefabs: { object: { props: { components: { template: "solid" } } } },
      fragments: { main: { instances: [{ id: "a", prefab: "object", x: 50, y: 50 }, { id: "b", prefab: "object", x: 100, y: 50 }] } } },
    behaviorRecipes: { entities: {} },
  };
}
const viewport = { cssWidth: 200, cssHeight: 100 };

test("local catalogs resolve strictly while returned JSON retains authored refs and omission", () => {
  const source = fixture(), before = structuredClone(source);
  const resolved = resolveSceneAuthoringDocument(source, { validateBindings: true, validateComponents: true });
  deepEqual(resolved.componentTemplates, source.componentTemplates);
  deepEqual(resolved.bindingPlan!.instances[0].props.components, { template: "solid" });
  const inline = resolveDataSceneInstanceComponents(resolved.bindingPlan!.instances[0], { componentTemplates: resolved.componentTemplates });
  equal(inline.mode, "inline");
  if (inline.mode === "inline") equal(inline.visual.width, 20);
  (resolved.componentTemplates!.solid.visual as { width: number }).width = 500;
  deepEqual(source, before);
  const legacy = fixture(); delete legacy.componentTemplates;
  throws(() => resolveSceneAuthoringDocument(legacy, { validateComponents: true }), /not supported/);
  // Prefab names do not implicitly define a component-template catalog.
  throws(() => createScenePlacementViewer({ document: legacy, viewport }), /catalog|not supported/);
});

test("viewer picking, transform/layer/save/handoff preserve catalog ownership and independent snapshots", async () => {
  const source = fixture(), before = structuredClone(source), viewer = createScenePlacementViewer({ document: source, viewport });
  equal(viewer.pickInstanceAtScreen({ x: 50, y: 50 })?.instanceId, "a");
  viewer.selectInstance("a");
  equal(viewer.state().selected?.componentTemplate, "solid");
  equal(viewer.state().selected?.visual?.width, 20);
  equal(viewer.state().objectDefinitions[0].componentTemplate, "solid");
  throws(() => viewer.updateInstanceComponents("a", components as never), /read-only/);
  throws(() => viewer.updateInstanceRenderLayers([{ instanceId: "a", sortOrder: 5 }]), /read-only/);
  equal(viewer.exportPatch(), undefined);
  viewer.updateInstanceTransform("a", { x: 70 });
  viewer.updateInstanceRenderLayers([{ instanceId: "a", layer: 4 }]);
  equal(viewer.state().selected?.transform.layer, 4);
  equal(viewer.pickInstanceAtScreen({ x: 70, y: 50 })?.instanceId, "a");
  const merged = mergeScenePlacementPatch(source, viewer.exportPatch()!).document;
  deepEqual(merged.componentTemplates, source.componentTemplates);
  deepEqual(merged.sceneComposition.prefabs.object.props!.components, { template: "solid" });
  equal(merged.sceneComposition.fragments!.main.instances![0].x, 70);
  const handoff = createScenePlacementAgentHandoff({ document: source, state: viewer.state() });
  deepEqual(handoff.componentTemplates, source.componentTemplates);
  (handoff.componentTemplates!.solid.visual as { width: number }).width = 99;
  deepEqual(source, before);
  let written: SceneAuthoringDocumentSpec | undefined;
  await saveScenePlacementPatch(source, viewer.exportPatch()!, { allowSave: true, allowedAdapterIds: ["memory"], adapter: {
    id: "memory", saveScenePlacementPatch(request) { written = request.mergedDocument; return { saved: true }; },
  } });
  deepEqual(written!.componentTemplates, source.componentTemplates);
  deepEqual(written!.sceneComposition.prefabs.object.props!.components, { template: "solid" });
  viewer.undo(); viewer.undo(); equal(viewer.exportPatch(), undefined);
  deepEqual(source, before);
});

test("catalog-owned visual layers and component patches reject detaching inherited refs", () => {
  const source = fixture();
  (source.componentTemplates!.solid.visual as { layer?: number }).layer = 8;
  const viewer = createScenePlacementViewer({ document: source, viewport });
  throws(() => viewer.updateInstanceRenderLayers([{ instanceId: "a", layer: 2 }]), /read-only/);
  throws(() => viewer.updateInstanceTransform("a", { layer: 2 }), /read-only/);
  viewer.updateInstanceTransform("a", { x: 80 });
  const patch: ScenePlacementPatch = { format: "ferrum2d.scene-placement.patch", version: 2,
    operations: [{ kind: "updateComponents", instanceId: "a", components: components as never }] };
  throws(() => mergeScenePlacementPatch(source, patch), /read-only/);
  equal(viewer.state().instances[0].visual?.kind, "sprite");
  equal(viewer.state().instances[0].transform.x, 80);
});

test("explicit external override resolves once and never overwrites the authored local catalog", async () => {
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
  const engine = await createEngine();
  try {
    const source = fixture(), before = structuredClone(source), override = structuredClone(components);
    (override.visual as { width: number }).width = 40;
    let calls = 0;
    const applied = applyDataSceneAuthoringDocument(engine, source, { componentTemplates: name => {
      calls++; return name === "solid" ? override : undefined;
    } });
    equal(calls, 1);
    equal(engine.entityCount(), 2);
    deepEqual(applied.document.componentTemplates, before.componentTemplates);
    deepEqual(applied.document.sceneComposition.prefabs.object.props.components, { template: "solid" });
    const local = applyDataSceneAuthoringDocument(engine, source);
    const h = local.entityHandles.a;
    equal(engine.queryUnifiedPhysicsBodyStates(new Uint32Array([h.entityId, h.entityGeneration])).count, 1);
    const beforeState = engine.queryUnifiedPhysicsBodyStates(new Uint32Array([h.entityId, h.entityGeneration]));
    for (const modify of [
      (d: SceneAuthoringDocumentSpec) => { delete (d.componentTemplates as Record<string, unknown>).solid; },
      (d: SceneAuthoringDocumentSpec) => { (d.componentTemplates as Record<string, unknown>).unused = { template: "solid" }; },
      (d: SceneAuthoringDocumentSpec) => { (d.componentTemplates as Record<string, unknown>).unused = { ...components, unknown: true }; },
    ]) {
      const bad = structuredClone(source); modify(bad);
      throws(() => applyDataSceneAuthoringDocument(engine, bad), /template|component|inline/);
      equal(engine.entityCount(), 2);
      const state = engine.queryUnifiedPhysicsBodyStates(new Uint32Array([h.entityId, h.entityGeneration]));
      equal(state.count, 1); equal(state.floats[B.position], beforeState.floats[B.position]);
    }
    deepEqual(source, before);
  } finally { engine.destroy(); }
});

test("external-only viewer catalog and patch consumers retain raw refs", () => {
  const source = fixture(); delete source.componentTemplates;
  let calls = 0;
  const external = () => { calls++; return components; };
  const viewer = createScenePlacementViewer({ document: source, componentTemplates: external, viewport });
  equal(calls, 1);
  equal(viewer.state().instances[0].visual?.width, 20);
  viewer.updateInstanceTransform("a", { x: 70 });
  const merged = mergeScenePlacementPatch(source, viewer.exportPatch()!, { componentTemplates: { solid: components } });
  equal(merged.document.componentTemplates, undefined);
  deepEqual(merged.document.sceneComposition.prefabs.object.props!.components, { template: "solid" });
  const handoff = createScenePlacementAgentHandoff({ document: source, state: viewer.state(), componentTemplates: { solid: components } });
  equal(handoff.componentTemplates, undefined);
});

test("catalog keys are literal JSON names, including prototype names", () => {
  const source = fixture();
  source.componentTemplates = Object.fromEntries([["__proto__", components]]);
  source.sceneComposition = { ...source.sceneComposition, prefabs: { object: { props: { components: { template: "__proto__" } } } } };
  const resolved = resolveSceneAuthoringDocument(source, { validateComponents: true });
  ok(Object.prototype.hasOwnProperty.call(resolved.componentTemplates, "__proto__"));
  const viewer = createScenePlacementViewer({ document: source, viewport });
  equal(viewer.state().instances[0].visual?.width, 20);
});


test("undefined external entries fall back to local names; malformed overrides never silently fall back", () => {
  const source = fixture();
  let calls = 0;
  const viewer = createScenePlacementViewer({ document: source, componentTemplates: () => { calls++; return undefined; }, viewport });
  equal(viewer.state().instances[0].visual?.width, 20);
  equal(calls, 1);
  throws(() => resolveSceneAuthoringDocument(source, { componentTemplates: { solid: null } as never }), /object/);
});

test("authored native Studio fixture admits local body, controller, joint and registered graphical tile refs", async () => {
  const source = JSON.parse(new TextDecoder().decode(await readFile(new URL("../../../../tests/fixtures/placement.native-templates.scene-authoring.json", import.meta.url))));
  await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
  const engine = await createEngine();
  try {
    const applied = applyDataSceneAuthoringDocument(engine, source, { textureId: () => 0 });
    equal(engine.entityCount(), 3);
    ok(applied.physicsJoints?.link);
    for (const h of Object.values(applied.entityHandles))
      equal(engine.queryUnifiedPhysicsBodyStates(new Uint32Array([h.entityId, h.entityGeneration])).count, 1);
    deepEqual(applied.document.componentTemplates, source.componentTemplates);
    const viewer = createScenePlacementViewer({ document: source, viewport });
    equal(viewer.state().instances[2].body?.type, undefined);
    equal(viewer.state().instances[2].componentTemplate, "runner");
  } finally { engine.destroy(); }
});


function invalidJsonDiagnostic(value: unknown, detail: RegExp): void {
  const source = fixture();
  const visual = source.componentTemplates!.solid.visual as unknown as Record<string, unknown>;
  visual.unsupported = value;
  let thrown: unknown;
  try { resolveSceneAuthoringDocument(source); } catch (error) { thrown = error; }
  if (!(thrown instanceof FerrumDiagnosticError)) throw new Error("Expected typed component JSON diagnostic");
  equal(thrown.code, "FERRUM_SCENE_COMPOSITION_INVALID");
  equal(thrown.context.kind, "scene-composition");
  ok(thrown.context.path?.startsWith("sceneAuthoring.componentTemplates.solid.visual.unsupported"));
  ok(detail.test(thrown.context.detail));
}

test("deep acyclic local template JSON rejects with a typed diagnostic before exhausting the JS stack", () => {
  let deep: unknown = null;
  for (let index = 0; index < 5000; index++) deep = { child: deep };
  invalidJsonDiagnostic(deep, /nesting must not exceed 32/);
});

test("cyclic local template JSON rejects with the existing typed authoring diagnostic", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  invalidJsonDiagnostic(cyclic, /finite JSON data/);
});

test("nonfinite local template JSON rejects with the existing typed authoring diagnostic", () => {
  for (const value of [NaN, Infinity, -Infinity]) invalidJsonDiagnostic(value, /finite JSON data/);
});
