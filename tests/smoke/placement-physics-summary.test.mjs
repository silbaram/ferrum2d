import assert from "node:assert/strict";
import { test } from "node:test";
import { studioSourceModule } from "./placement-physics-summary-source.mjs";

const { installPlacementDiagnostics, createPlacementPhysicsSummary, createScenePlacementViewer, PHYSICS, CHARACTER } = await studioSourceModule(`
 export {installPlacementDiagnostics} from './apps/studio/src/placementDiagnostics.ts';
 export {createPlacementPhysicsSummary} from './apps/studio/src/placementPhysicsSummary.ts';
 export {UNIFIED_PHYSICS_STATE_LAYOUT as PHYSICS,UNIFIED_PHYSICS_CHARACTER_LAYOUT as CHARACTER} from '@ferrum2d/ferrum-web/core';
 export {createScenePlacementViewer} from '@ferrum2d/ferrum-web/authoring';
`);

class TextNode { constructor(data) { this.data = data; } get textContent() { return this.data; } }
class ElementNode extends EventTarget {
  constructor(tag) { super(); this.tagName = tag; this.dataset = {}; this.childNodes = []; }
  append(...nodes) { this.childNodes.push(...nodes); }
  replaceChildren(...nodes) { this.childNodes = nodes; }
  get firstChild() { return this.childNodes[0]; }
  get textContent() { return this.childNodes.map(node => node.textContent).join(""); }
  set textContent(value) { this.replaceChildren(new TextNode(value)); }
}
class ButtonNode extends ElementNode {}
function dom() {
  globalThis.Text = TextNode;
  globalThis.HTMLButtonElement = ButtonNode;
  globalThis.window = new EventTarget();
  globalThis.document = { createElement: tag => tag === "button" ? new ButtonNode(tag) : new ElementNode(tag), createTextNode: text => new TextNode(text) };
}
function rows(element, output = new Map()) {
  for (let i = 0; i < (element.childNodes?.length ?? 0); i++) {
    const child = element.childNodes[i];
    if (child.tagName === "dt") output.set(child.textContent, element.childNodes[i + 1].textContent);
    rows(child, output);
  }
  return output;
}
function nativeRow(layout, handle) {
  const words = new Uint32Array(layout.stride), floats = new Float32Array(words.buffer);
  words[layout.entityId] = handle.entityId; words[layout.entityGeneration] = handle.entityGeneration;
  return { count: 1, stride: layout.stride, words, floats };
}
function fixture(body, overrides = {}) {
  dom(); let now = 1000, reads = 0;
  Object.defineProperty(performance, "now", { configurable: true, value: () => now });
  const handle = { entityId: 7, entityGeneration: 3 };
  const engine = {
    gameplayEntityExists: () => true, getPhysicsEntity: () => undefined,
    gameplayEntityDiagnostics: () => undefined,
    queryUnifiedPhysicsBodyStates(handles) {
      assert.deepEqual([...handles], [7, 3]); reads++;
      const row = nativeRow(PHYSICS, handle);
      row.floats.set([10, 20, 30], PHYSICS.position);
      row.floats.set([0.5, 0.5, 0.5, 0.5], PHYSICS.rotation);
      row.floats.set([1, 2, 3], PHYSICS.linearVelocity);
      row.floats.set([4, 5, 6], PHYSICS.angularVelocity);
      row.words[PHYSICS.flags] = PHYSICS.sleepingFlag;
      engine.borrowedBody = row; return row;
    },
    queryUnifiedPhysicsColliders() {
      // A later native call can replace or invalidate every earlier borrowed view.
      engine.borrowedBody.floats.fill(-999); return [{}, {}];
    },
    queryUnifiedPhysicsCharacterStates(handles) {
      assert.deepEqual([...handles], [7, 3]);
      const row = nativeRow(CHARACTER, handle);
      row.words[CHARACTER.flags] = CHARACTER.groundedFlag | CHARACTER.slidingFlag;
      row.floats[CHARACTER.verticalSpeed] = 1.25; engine.borrowedCharacter = row; return row;
    },
    ...overrides,
  };
  const instance = { instanceId: "ball", sourceId: "ball", body };
  const state = { selectedInstanceId: "ball", selectedInstanceIds: ["ball"], selected: instance, instances: [instance], fragment: "main" };
  const scene = { format: "ferrum2d.consumer.scene-authoring", version: 1, behaviorRecipes: { entities: {} }, sceneComposition: { prefabs: { object: {} }, fragments: { main: { instances: [{ id: "ball", prefab: "object", props: { components: { visual: { kind: "primitive", shape: "rect", width: 2, height: 2 }, collider: { type: "aabb", halfWidth: 1, halfHeight: 1, isTrigger: false }, layer: "wall", body } } }] } } } };
  const diagnostics = installPlacementDiagnostics({ root: new ElementNode("root"), runtime: { engine }, handle: () => handle, select() {}, reloadAssets: async () => {}, canReloadAssets: () => true });
  diagnostics.sync(state, scene, "scene.json", []); diagnostics.panels.runtime.open = true;
  const frame = () => diagnostics.frame({ frame: { gameplayEvents: [] } });
  return { diagnostics, engine, frame, state, scene, reads: () => reads, time: value => { now = value; } };
}

test("selected native diagnostics copy actual quaternion/angular velocity before later queries and stay bounded at 4 Hz", () => {
  const h = fixture({ kind: "kinematic-position", character: {}, collider: { shape: { type: "capsule" } } });
  h.frame(); const snapshot = window.ferrumPlacementSelectedRuntime;
  assert.equal(h.reads(), 1);
  assert.deepEqual(snapshot.shapePhysics, { kind: "kinematic-position", position: [10, 20, 30], rotation: [0.5, 0.5, 0.5, 0.5], velocity: [1, 2, 3], angularVelocity: [4, 5, 6], sleeping: true, colliderCount: 2, character: { grounded: true, sliding: true, verticalSpeed: 1.25 } });
  h.engine.borrowedCharacter.floats.fill(-999); assert.equal(snapshot.shapePhysics.character.verticalSpeed, 1.25);
  assert.equal(Object.hasOwn(snapshot.shapePhysics.character, "enabled"), false, "the current bulk ABI does not report enablement");
  const rendered = rows(h.diagnostics.panels.runtime);
  assert.equal(rendered.get("Quaternion"), "X 0.500 · Y 0.500 · Z 0.500 · W 0.500");
  assert.equal(rendered.get("Angular Velocity"), "X 4.00 · Y 5.00 · Z 6.00");
  h.time(1100); h.frame(); assert.equal(h.reads(), 1);
  h.time(1250); h.frame(); assert.equal(h.reads(), 2);
  h.diagnostics.panels.runtime.open = false; h.time(1750); h.frame(); assert.equal(h.reads(), 2);
});
test("a live entity alone never supplies native physics or controller evidence", () => {
  const h = fixture({ kind: "dynamic", collider: { shape: { type: "sphere", radius: 1 } } }, {
    queryUnifiedPhysicsBodyStates() { throw Error("body not admitted"); },
    queryUnifiedPhysicsColliders() { assert.fail("no collider query after a rejected body read"); },
  });
  assert.doesNotThrow(h.frame);
  assert.equal(window.ferrumPlacementSelectedRuntime.shapePhysics, undefined);
  assert.match(rows(h.diagnostics.panels.runtime).get("Body"), /authored.*unavailable/);
  assert.match(rows(h.diagnostics.panels.runtime).get("Physics Read"), /body not admitted/);
});
test("generation mismatches discard native body/character rows without presenting stale state", () => {
  const wrongBody = fixture({ kind: "dynamic", collider: {} }, { queryUnifiedPhysicsBodyStates() { return nativeRow(PHYSICS, { entityId: 7, entityGeneration: 4 }); } });
  wrongBody.frame(); assert.equal(window.ferrumPlacementSelectedRuntime.shapePhysics, undefined);
  assert.match(window.ferrumPlacementSelectedRuntime.physicsAuthoring.runtimeError, /did not match/);
  const wrongCharacter = fixture({ kind: "kinematic-position", character: {}, collider: {} }, { queryUnifiedPhysicsCharacterStates() { return nativeRow(CHARACTER, { entityId: 7, entityGeneration: 4 }); } });
  wrongCharacter.frame(); assert.equal(window.ferrumPlacementSelectedRuntime.shapePhysics.character, undefined);
  assert.match(window.ferrumPlacementSelectedRuntime.physicsAuthoring.characterRuntimeError, /did not match/);
});
test("legacy controller diagnostics retain exact authored JSON and make runtime application unknown", () => {
  const settings = { solidMaskBits: 0, maxIterations: 8, maxStepHeight: 0, maxDropHeight: 3.25, allowLedgeDrop: false };
  const h = fixture({ type: "kinematic", kinematicController: settings }); h.frame();
  const snapshot = window.ferrumPlacementSelectedRuntime, rendered = rows(h.diagnostics.panels.runtime);
  assert.equal(h.reads(), 0); assert.deepEqual(snapshot.physicsAuthoring.kinematicController, settings);
  assert.equal(rendered.get("Kinematic Controller"), "Authored · runtime application unknown");
  assert.deepEqual(JSON.parse(rendered.get("JSON Settings")), settings);
  settings.maxDropHeight = 999; assert.equal(snapshot.physicsAuthoring.kinematicController.maxDropHeight, 3.25);
  const summary = createPlacementPhysicsSummary(); summary.update(undefined, [], 0, undefined, { kinematicController: {} });
  assert.equal(rows(summary.element).get("JSON Settings"), "{}");
  summary.update(undefined); assert.equal(rows(summary.element).has("Kinematic Controller"), false);
});
test("a viewer's resolved defaults never masquerade as authored controller JSON", () => {
  const h = fixture({ type: "kinematic", kinematicController: {} });
  const viewer = createScenePlacementViewer({ document: h.scene, viewport: { cssWidth: 640, cssHeight: 480 } }); viewer.selectInstance("ball");
  assert.equal(viewer.state().selected.body.kinematicController.maxIterations, 4, "the viewer carries resolved defaults");
  h.diagnostics.sync(viewer.state(), h.scene, "other-scene.json", []); h.frame();
  assert.deepEqual(window.ferrumPlacementSelectedRuntime.physicsAuthoring.kinematicController, {});
  assert.equal(rows(h.diagnostics.panels.runtime).get("JSON Settings"), "{}");
  const next = structuredClone(h.scene.sceneComposition.fragments.main.instances[0].props.components);
  next.body.kinematicController = { maxStepHeight: 0.1000000001 };
  viewer.updateInstanceComponents("ball", next); h.diagnostics.sync(viewer.state(), h.scene, "other-scene.json", []); h.time(1250); h.frame();
  assert.deepEqual(window.ferrumPlacementSelectedRuntime.physicsAuthoring.kinematicController, { maxStepHeight: 0.1000000001 });
  viewer.undo(); h.diagnostics.sync(viewer.state(), h.scene, "other-scene.json", []); h.time(1500); h.frame();
  assert.deepEqual(window.ferrumPlacementSelectedRuntime.physicsAuthoring.kinematicController, {});
});
