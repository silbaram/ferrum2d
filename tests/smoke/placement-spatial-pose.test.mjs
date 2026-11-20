import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../apps/studio/package.json", import.meta.url));
const ts = require("typescript");
const { placementSpatialPose, placementLightAnchor, placementBodyElevation, placementSpatialModelPose, placementSpatialModelBounds } = await import("data:text/javascript;base64," + Buffer.from(ts.transpileModule(
  await readFile("apps/studio/src/placementSpatialPose.ts", "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText).toString("base64"));

test("light anchors follow nested attached bodies, adding only the target visual elevation", () => {
  const state = {
    instances: [
      { instanceId: "base", transform: { x: 100, y: -50, rotationRadians: 1, scale: 3 }, body: { type: "static", heightSpan: { elevation: 20 } } },
      { instanceId: "arm", transform: { x: 999, y: 999 }, body: { type: "static", heightSpan: { elevation: 999 } } },
      { instanceId: "lamp", transform: { x: -999, y: -999 }, body: { type: "static", heightSpan: { elevation: 999 } } },
    ],
    spatial: {
      models: { base: { elevation: 200 }, arm: { elevation: 90 }, lamp: { elevation: 7 } }, billboards: {},
      attachments: { arm: { parent: "base", x: 10, y: 0, elevation: 5, yawDegrees: 90 }, lamp: { parent: "arm", x: 10, y: 4, elevation: 3 } },
    },
  };
  assert.deepEqual(placementSpatialPose(state, "lamp"), { x: 106, y: -40, elevation: 28, yaw: Math.PI / 2 });
  assert.deepEqual(placementLightAnchor(state, "lamp"), { x: 106, y: -40, elevation: 35 });
  assert.deepEqual(placementLightAnchor(state), { x: 0, y: 0, elevation: 0 });
  assert.deepEqual(placementLightAnchor(state, "base"), { x: 100, y: -50, elevation: 220 });
  state.spatial.attachments.base = { parent: "lamp" };
  assert.throws(() => placementLightAnchor(state, "lamp"), /cycle/);
  assert.throws(() => placementLightAnchor(state, "missing"), /Unknown/);
});

test("shape-body overlays use authored anchor height, retaining visual offset and default height", () => {
  const instance = {instanceId: "ball", transform: {x: 2, y: 3}, body: {
    elevation: 64, renderOffset: [0, -8, 0], collider: {shape: {type: "sphere", radius: 8}},
  }};
  const state = {instances: [instance], spatial: {billboards: {ball: {elevation: 4}}}};
  assert.equal(placementBodyElevation(instance), 64);
  assert.deepEqual(placementSpatialPose(state, "ball"), {x: 2, y: 3, elevation: 64, yaw: 0});
  assert.deepEqual(placementLightAnchor(state, "ball"), {x: 2, y: 3, elevation: 68});
  delete instance.body.elevation;
  assert.equal(placementBodyElevation(instance), 0);
  assert.equal(placementBodyElevation(undefined), undefined);
});

function modelFixture() {
  const h = Math.SQRT1_2;
  return {
    instances: [{ instanceId: "model", transform: { x: 10, y: 30, rotationRadians: Math.PI / 2, scale: 7 }, body: {
      kind: "dynamic", rotation: [h, 0, 0, h], elevation: 20, renderOffset: [100, -200, 300], collider: { shape: { type: "sphere", radius: 2 } },
    } }],
    spatial: { billboards: {}, models: { model: { yawDegrees: 90, scale: 2, elevation: 3 } } },
  };
}
function near(actual, expected, epsilon = 1e-10) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert(Math.abs(actual[i] - expected[i]) < epsilon, `${i}: ${actual[i]} != ${expected[i]}`);
}
function nearPoints(actual, expected) {
  assert.equal(actual.length, 8);
  actual.forEach((point, i) => near([point.x, point.elevation, point.y], [expected[i].x, expected[i].elevation, expected[i].y]));
}

test("native authored model bounds compose placement Y, body tilt and model-local yaw once, across all eight corners", async () => {
  const state = modelFixture(), physics = { space: "spatial" }, bounds = [-1, -2, -3, 4, 5, 6];
  const pose = placementSpatialModelPose(state, "model", physics);
  assert.equal(pose.source, "authoring", "initial JSON geometry makes no runtime observation claim");
  near(pose.matrix, [0, 2, 0, 0, 2, 0, 0, 0, 0, 0, -2, 0, 10, 23, -30, 1]);
  const expected = [
    { x: 6, elevation: 21, y: 24 }, { x: 6, elevation: 21, y: 42 },
    { x: 20, elevation: 21, y: 24 }, { x: 20, elevation: 21, y: 42 },
    { x: 6, elevation: 31, y: 24 }, { x: 6, elevation: 31, y: 42 },
    { x: 20, elevation: 31, y: 24 }, { x: 20, elevation: 31, y: 42 },
  ];
  const actual = placementSpatialModelBounds(state, "model", bounds, physics);
  nearPoints(actual, expected);
  const changed = structuredClone(state); changed.instances[0].body.renderOffset = [-900, 800, -700]; changed.instances[0].transform.scale = 11;
  near(placementSpatialModelPose(changed, "model", physics).matrix, pose.matrix);
  const directory = new URL("../../artifacts/studio/", import.meta.url); await mkdir(directory, { recursive: true });
  await writeFile(new URL("orientation-native-model.json", directory), JSON.stringify({ geometrySource: pose.source, physics, authored: state, localBounds: bounds, matrix: pose.matrix, corners: actual, expectedCorners: expected, runtimePoseObserved: false }, null, 2) + "\n");
});

test("arbitrary authored quaternion bounds match independent sequential vector rotations", () => {
  const state = modelFixture(), instance = state.instances[0], angle = 0.83, axisLength = Math.sqrt(14);
  instance.transform.rotationRadians = 0.37;
  instance.body.rotation = [1, 2, 3].map(value => value / axisLength * Math.sin(angle / 2)).concat(Math.cos(angle / 2));
  state.spatial.models.model.yawDegrees = -29;
  const bounds = [-2, -3, -5, 7, 11, 13], actual = placementSpatialModelBounds(state, "model", bounds, { space: "spatial" });
  // Independent Rodrigues axis-angle rotation, applied in model → body → placement order.
  const rotateY = ([x, y, z], a) => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
  const axis = [1, 2, 3].map(value => value / axisLength), expected = [];
  for (const x of [-2, 7]) for (const y of [-3, 11]) for (const z of [-5, 13]) {
    const v = rotateY([x * 2, y * 2, z * 2], -29 * Math.PI / 180), c = Math.cos(angle), s = Math.sin(angle);
    const dot = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
    const cross = [axis[1] * v[2] - axis[2] * v[1], axis[2] * v[0] - axis[0] * v[2], axis[0] * v[1] - axis[1] * v[0]];
    const body = v.map((value, i) => value * c + cross[i] * s + axis[i] * dot * (1 - c));
    const world = rotateY(body, 0.37);
    expected.push({ x: 10 + world[0], elevation: 23 + world[1], y: 30 - world[2] });
  }
  nearPoints(actual, expected);
});

test("legacy and attached model yaw semantics remain separate from native root orientation", () => {
  const state = modelFixture(), bounds = [0, 0, 0, 1, 2, 3];
  const expectedLegacy = [
    { x: 10, elevation: 23, y: 30 }, { x: 16, elevation: 23, y: 30 },
    { x: 10, elevation: 27, y: 30 }, { x: 16, elevation: 27, y: 30 },
    { x: 10, elevation: 23, y: 32 }, { x: 16, elevation: 23, y: 32 },
    { x: 10, elevation: 27, y: 32 }, { x: 16, elevation: 27, y: 32 },
  ];
  nearPoints(placementSpatialModelBounds(state, "model", bounds), expectedLegacy);
  nearPoints(placementSpatialModelBounds(state, "model", bounds, { space: "planar-xy" }), expectedLegacy);
  state.instances[0].body = { type: "static", heightSpan: { elevation: 20, height: 10 } };
  nearPoints(placementSpatialModelBounds(state, "model", bounds, { space: "spatial" }), expectedLegacy);
  state.instances.push({ instanceId: "base", transform: { x: 100, y: 200, rotationRadians: 9 }, body: { type: "static", heightSpan: { elevation: 7 } } });
  state.spatial.attachments = { model: { parent: "base", x: 5, y: 6, elevation: 8, yawDegrees: 90 } };
  const attached = placementSpatialModelPose(state, "model", { space: "spatial" });
  near(attached.matrix, [-2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -2, 0, 105, 18, -206, 1]);
});

test("workspace model geometry uses all LOD bounds and caches authored orientation until state or space changes", async () => {
  // Execute the actual nested bounds function without mounting unrelated editor UI.
  const source = ts.createSourceFile("placementSpatialWorkspace.ts", await readFile("apps/studio/src/placementSpatialWorkspace.ts", "utf8"), ts.ScriptTarget.ES2022, true);
  let geometry;
  const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === "worldGeometry") geometry = node.getText(source); ts.forEachChild(node, visit); };
  visit(source); assert(geometry);
  const code = ts.transpileModule(geometry, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  let reads = 0;
  const workspace = new Function("placementSpatialModelBounds", "placementSpatialPose", `
    let state, models, options, modelGeometryState, modelGeometrySpace;
    const modelGeometry = new Map();
    function pose(id) { return placementSpatialPose(state, id); }
    ${code}
    return (next, assets, physics) => { state = next; models = assets; options = { document: () => ({ physics }) }; return worldGeometry({kind: 'model', id: 'model'}); };
  `)((...args) => { reads++; return placementSpatialModelBounds(...args); }, placementSpatialPose);
  const state = modelFixture();
  Object.assign(state.spatial.models.model, { contentId: "base", lods: [{ contentId: "lod" }] });
  const assets = new Map([["base", { bounds: [-1, -2, -3, 1, 2, 3] }], ["lod", { bounds: [-1, -2, -3, 4, 5, 6] }]]);
  const first = workspace(state, assets, { space: "spatial" });
  nearPoints(first, [
    { x: 6, elevation: 21, y: 24 }, { x: 6, elevation: 21, y: 42 },
    { x: 20, elevation: 21, y: 24 }, { x: 20, elevation: 21, y: 42 },
    { x: 6, elevation: 31, y: 24 }, { x: 6, elevation: 31, y: 42 },
    { x: 20, elevation: 31, y: 24 }, { x: 20, elevation: 31, y: 42 },
  ]);
  assert.equal(workspace(state, assets, { space: "spatial" }), first); assert.equal(reads, 1);
  const changed = structuredClone(state); changed.instances[0].transform.rotationRadians = 0.37;
  const second = workspace(changed, assets, { space: "spatial" }); assert.notDeepEqual(second, first); assert.equal(reads, 2);
  const planar = workspace(changed, assets, { space: "planar-xy" }); assert.notDeepEqual(planar, second); assert.equal(reads, 3);
});
