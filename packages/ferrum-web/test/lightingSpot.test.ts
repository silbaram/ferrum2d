import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { normalizeLightingScene, createResolvedLightingScene, resolveLightingSceneInto } from "../src/lightingNormalize.js";
import { writePointLightSpot } from "../src/lightingSpot.js";
import { resolveSceneLighting } from "../src/sceneLighting.js";

test("point cones preserve disabled authoring and explicit penumbra0 through JSON, with legacy rejection", () => {
  const input = { profile: "lit" as const, enabled: false, pointLights: [{ x: 10, y: 20, radius: 100, spot: { directionX: 3, directionY: 4, angleDegrees: 90, penumbra: 0 } }] };
  const resolved = resolveSceneLighting(input);
  equal(resolved.enabled, false);
  deepEqual(resolved.pointLights[0].spot, { directionX: .6, directionY: .8, angleDegrees: 90, penumbra: 0 });
  deepEqual(resolveSceneLighting(JSON.parse(JSON.stringify(resolved))), resolved);
  input.pointLights[0].spot.directionX = 100;
  equal(resolved.pointLights[0].spot!.directionX, .6);
  throws(() => normalizeLightingScene({ enabled: false, pointLights: input.pointLights }), /require the flat lit profile/);
  const reused = createResolvedLightingScene();
  resolveLightingSceneInto(reused, { ...input, enabled: true });
  resolveLightingSceneInto(reused, { profile: "lit", pointLights: [{ x: 0, y: 0, radius: 100 }] });
  equal(reused.pointLights[0].spot, undefined);
});

test("invalid cone vectors, opening, penumbra, fields and float32 aspects fail even while OFF", () => {
  const spot = { directionX: 1, directionY: 0, angleDegrees: 90 };
  for (const invalid of [null, [], { ...spot, directionX: 0 }, { ...spot, directionX: Infinity }, { ...spot, angleDegrees: 0 }, { ...spot, angleDegrees: 361 }, { ...spot, penumbra: null }, { ...spot, penumbra: -1 }, { ...spot, penumbra: 1.01 }, { ...spot, unexpected: true }]) {
    throws(() => resolveSceneLighting({ profile: "lit", enabled: false, pointLights: [{ x: 0, y: 0, radius: 100, spot: invalid }] }), /spot/);
  }
  throws(() => normalizeLightingScene({ profile: "lit", enabled: false, pointLights: [{ x: 0, y: 0, radius: 1e-40, radiusY: 1e30, spot }] }), /float32 radii and aspect/);
});

test("private cone parameters follow the elliptical metric and full-circle hard cones are exactly radial", () => {
  const output = new Float32Array(4), resolved = normalizeLightingScene({ profile: "lit", pointLights: [{ x: 0, y: 0, radius: 100, spot: { directionX: 3, directionY: 4, angleDegrees: 90, penumbra: .5 } }] });
  writePointLightSpot(output, 0, resolved.pointLights[0].spot, 2);
  ok(Math.abs(output[0] - 3 / Math.sqrt(13)) < 1e-7);
  ok(Math.abs(output[1] - 2 / Math.sqrt(13)) < 1e-7);
  ok(Math.abs(output[2] - Math.SQRT1_2) < 1e-7);
  ok(Math.abs(output[3] - Math.sqrt((1 + Math.SQRT1_2) / 2)) < 1e-7);
  writePointLightSpot(output, 0, { directionX: 1, directionY: 0, angleDegrees: 360, penumbra: 0 });
  deepEqual(Array.from(output), [0, 0, -2, -2]);
  writePointLightSpot(output, 0);
  deepEqual(Array.from(output), [0, 0, -2, -2]);
});
