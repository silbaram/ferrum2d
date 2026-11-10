import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../apps/placement-viewer/package.json", import.meta.url));
const ts = require("typescript");
let code = ts.transpileModule(await readFile(new URL("../../apps/placement-viewer/src/placementFlatLighting.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
code = code.replace('"@ferrum2d/ferrum-web/authoring"', JSON.stringify(new URL("../../packages/ferrum-web/dist/authoring.js", import.meta.url).href));
const { placementFlatTextureRoles, placementFlatTextureOptions } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
const source = (surface = {}) => ({ format: "ferrum2d.consumer.scene-authoring", version: 1, lighting: { profile: "lit", enabled: false }, sceneComposition: { initialFragment: "main", prefabs: { object: { props: { components: { visual: { kind: "sprite", texture: "color", width: 16, height: 16, lighting: { mode: "opaque", lightMask: 0 }, surface }, collider: "none", layer: "wall" } } } }, fragments: { main: { instances: [{ id: "sprite", prefab: "object" }] } } }, behaviorRecipes: { entities: {} } });

test("viewer derives map data roles from inherited authored components even with lighting OFF", () => {
  const roles = placementFlatTextureRoles([source({ emissionTexture: "glow", specularTexture: "spec", roughnessTexture: "rough" })]);
  assert.deepEqual([...roles], [["color", "color"], ["glow", "color"], ["spec", "data"], ["rough", "data"]]);
  const signal = new AbortController().signal;
  assert.deepEqual(placementFlatTextureOptions(["color", "spec", "unused"], roles, signal), {
    color: { alphaMode: "straight", colorSpace: "srgb", signal },
    spec: { alphaMode: "straight", colorSpace: "none", signal },
    unused: { alphaMode: "straight", colorSpace: "srgb", signal },
  });
});
test("viewer refuses to reinterpret color as data in one scene or another open tab", () => {
  assert.throws(() => placementFlatTextureRoles([source({ specularTexture: "color" })]), /both color and lighting data/);
  const second = source(); second.sceneComposition.prefabs.object.props.components.visual.texture = "spec";
  assert.throws(() => placementFlatTextureRoles([source({ specularTexture: "spec" }), second]), /both color and lighting data/);
});
test("numeric map IDs resolve after registration and cannot conflict with named references", () => {
  const roles = placementFlatTextureRoles([source({ specularTexture: 7 })]);
  assert.equal(placementFlatTextureOptions(["spec"], roles, undefined, () => 7).spec.colorSpace, "none");
  assert.throws(() => placementFlatTextureOptions(["color"], roles, undefined, () => 7), /conflicting named\/numeric/);
});
test("open Spatial albedo and normal roles prevent another Flat tab from reinterpreting them", async () => {
  const spatial = JSON.parse(await readFile(new URL("../fixtures/placement.hd2d.scene-authoring.json", import.meta.url), "utf8"));
  const billboard = Object.values(spatial.spatial.billboards)[0];
  billboard.normalTexture = "spatial-normal";
  spatial.spatial.terrain[0].textureId = 7;
  const roles = placementFlatTextureRoles([spatial]);
  assert.equal(roles.get("crate"), "color");
  assert.equal(roles.get("spatial-normal"), "data");
  assert.equal(roles.get(7), "color");
  assert.throws(() => placementFlatTextureRoles([spatial, source({ specularTexture: "crate" })]), /both color and lighting data/);
  assert.throws(() => placementFlatTextureRoles([spatial, source({ roughnessTexture: 7 })]), /both color and lighting data/);
});
test("inactive legacy normal aliases remain editable without reinterpreting their color asset", () => {
  const legacy = source();
  delete legacy.lighting;
  const sprite = legacy.sceneComposition.prefabs.object.props.components.visual;
  delete sprite.lighting; delete sprite.surface; sprite.normalTexture = "color";
  assert.deepEqual([...placementFlatTextureRoles([legacy])], [["color", "color"]]);
  legacy.lighting = { enabled: true };
  assert.throws(() => placementFlatTextureRoles([legacy]), /both color and lighting data/);
});
test("OFF point cookies are data assets, including numeric IDs and cross-tab color conflicts", () => {
  const document = source();
  document.lighting.pointLights = [{ x: 0, y: 0, radius: 1, cookie: { texture: "pattern" } }];
  const roles = placementFlatTextureRoles([document]);
  assert.equal(roles.get("pattern"), "data");
  assert.equal(placementFlatTextureOptions(["pattern"], roles).pattern.colorSpace, "none");
  assert.throws(() => placementFlatTextureRoles([document, source({ emissionTexture: "pattern" })]), /both color and lighting data/);
  document.lighting.pointLights[0].cookie = { textureId: 7 };
  const numeric = placementFlatTextureRoles([document]);
  assert.equal(placementFlatTextureOptions(["pattern"], numeric, undefined, () => 7).pattern.colorSpace, "none");
  assert.throws(() => placementFlatTextureOptions(["color"], numeric, undefined, () => 7), /conflicting named\/numeric/);
});
