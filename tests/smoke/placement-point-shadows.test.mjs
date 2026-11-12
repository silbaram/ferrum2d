import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../apps/studio/package.json", import.meta.url));
const ts = require("typescript");
async function load(name) {
  const source = await readFile(new URL(`../../apps/studio/src/${name}.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}
const { placementPointShadow, removePlacementPointShadowSource, setPlacementPointShadow } = await load("placementPointShadows");
const { lightingQuality, lightingMood } = await load("placementLightingPresets");

test("checking a second owner preserves the first settings and raises an insufficient active budget", () => {
  const light = { lights: [], maxActiveLights: 1, shadows: { lightIndex: 2, resolution: 512, bias: .2, normalBias: .4 } };
  const first = structuredClone(light.shadows);
  setPlacementPointShadow(light, 0, true);
  assert.deepEqual(light.pointShadows, [first, { lightIndex: 0 }]);
  assert.equal(light.shadows, undefined);
  assert.equal(light.maxActiveLights, 2);
  const saved = structuredClone(light);
  setPlacementPointShadow(light, 1, true);
  assert.deepEqual(light, saved, "A third owner cannot silently replace either checked owner");
  placementPointShadow(light, 2).normalBias = .6;
  assert.deepEqual(light.pointShadows[1], { lightIndex: 0 });
  setPlacementPointShadow(light, 2, false);
  assert.deepEqual(light.pointShadows, [{ lightIndex: 0 }]);
  setPlacementPointShadow(light, 0, false);
  assert.equal(light.pointShadows, undefined, "The source contract forbids an empty array");
});
test("deleting owners and nonowners remaps authored indices without losing per-owner settings", () => {
  for (const [removed, expected] of [[0, [2, 0]], [1, [2]], [2, [2, 1]], [3, [1]]]) {
    const light = { lights: [], pointShadows: [{ lightIndex: 3, bias: .3 }, { lightIndex: 1, normalBias: .4 }] };
    removePlacementPointShadowSource(light, removed);
    assert.deepEqual(light.pointShadows.map(shadow => shadow.lightIndex), expected);
    for (const shadow of light.pointShadows) assert.equal(shadow.bias ?? shadow.normalBias, shadow.bias ? .3 : .4);
  }
  const legacy = { lights: [], shadows: { lightIndex: 2, normalBias: .6 } };
  removePlacementPointShadowSource(legacy, 0);
  assert.deepEqual(legacy.shadows, { lightIndex: 1, normalBias: .6 });
  removePlacementPointShadowSource(legacy, 1);
  assert.equal(legacy.shadows, undefined);
});
test("quality changes keep both owners active, scale both resolutions and preserve authored input", () => {
  const environment = { lighting: { lights: [], pointShadows: [{ lightIndex: 3, bias: .3 }, { lightIndex: 1, normalBias: .4 }] } };
  const saved = structuredClone(environment);
  for (const [quality, budget, resolution] of [["Low", 2, 128], ["Balanced", 2, 512], ["High", 4, 1024]]) {
    const result = lightingQuality(environment, quality);
    assert.equal(result.lighting.maxActiveLights, budget);
    assert.deepEqual(result.lighting.pointShadows, saved.lighting.pointShadows.map(shadow => ({ ...shadow, resolution })));
  }
  assert.deepEqual(environment, saved);
  const legacy = lightingQuality({ lighting: { lights: [], shadows: { lightIndex: 0 } } }, "Low");
  assert.equal(legacy.lighting.maxActiveLights, 1);
  assert.deepEqual(legacy.lighting.shadows, { lightIndex: 0, resolution: 128 });
});

test("mood presets preserve wide Bloom and channel routing; Interior removes dependent shafts atomically", () => {
  const environment = { composition: "separated", bloom: { mode: "wide", quality: "high", radius: 64 },
    lightShafts: { intensity: .7 }, lighting: { lights: [], directional: { direction: { x: 1, y: 1, elevation: 2 },
      lightMask: 3, shadowMask: 5, shadows: { pcss: { angularRadius: 1 }, resolution: 256 } }, probes: [{ position: { x: 0, y: 0, elevation: 0 }, radius: 20 }] } };
  const saved = structuredClone(environment);
  for (const mood of ["Day", "Sunset", "Night", "Interior"]) {
    const next = lightingMood(environment, mood);
    assert.equal(next.bloom.mode, "wide"); assert.equal(next.bloom.quality, "high"); assert.equal(next.bloom.radius, 64);
    assert.equal(next.lighting.directional.lightMask, 3); assert.equal(next.lighting.directional.shadowMask, 5);
    assert.deepEqual(next.lighting.probes, environment.lighting.probes);
    if (mood === "Interior") { assert.equal(next.lightShafts, undefined); assert.equal(next.lighting.directional.shadows, undefined); }
    else { assert.deepEqual(next.lightShafts, environment.lightShafts); assert.deepEqual(next.lighting.directional.shadows, environment.lighting.directional.shadows); }
  }
  assert.deepEqual(environment, saved);
  assert.equal(lightingMood({ bloom: { mode: "wide" } }, "Day").bloom.radius, 48);
});

test("quality presets bound PCSS work for each owner and tune shafts without changing emitter sizes", () => {
  const environment = { lighting: { lights: [], directional: { direction: { x: 1, y: 1, elevation: 2 }, shadows: { pcss: { angularRadius: 2, maxRadiusTexels: 24 } } },
    pointShadows: [{ lightIndex: 0, pcss: { sourceRadius: 10, maxRadiusTexels: 32 } }, { lightIndex: 1, pcss: { sourceRadius: 4, maxRadiusTexels: 6 } }] }, lightShafts: { quality: "high", intensity: .8 } };
  const low = lightingQuality(environment, "Low");
  assert.deepEqual(low.lighting.directional.shadows.pcss, { angularRadius: 2, maxRadiusTexels: 8 });
  assert.deepEqual(low.lighting.pointShadows.map(s => s.pcss), [{ sourceRadius: 10, maxRadiusTexels: 8 }, { sourceRadius: 4, maxRadiusTexels: 6 }]);
  assert.deepEqual(low.lightShafts, { quality: "low", intensity: .8 });
  assert.equal(environment.lighting.pointShadows[0].pcss.maxRadiusTexels, 32);
});
