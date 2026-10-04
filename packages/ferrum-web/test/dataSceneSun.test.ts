import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { resolveDirectionalLight2D, resolveDataSceneGroundShadow } from "../src/core.js";
import { resolveDataSceneComponentsSpec } from "../src/authoring.js";
import { normalizeLightingScene } from "../src/lighting.js";

test("directional light validates direction, illumination and bounded caster budget", () => {
  const sun = resolveDirectionalLight2D({ directionX: 3, directionY: 4 });
  equal(sun.directionX, 0.6); equal(sun.directionY, 0.8); equal(sun.maxCasters, 512);
  for (const input of [{ directionX: 0, directionY: 0 }, { directionX: NaN, directionY: 1 },
    { directionX: 1, directionY: 1, intensity: -1 }, { directionX: 1, directionY: 1, maxCasters: 1.5 }]) throws(() => resolveDirectionalLight2D(input));
  equal(normalizeLightingScene({ directionalLight: sun }).directionalLight?.maxCasters, 512);
});

test("shadow authoring keeps geometry separate from body and normalizes inherited dimensions", () => {
  const components = resolveDataSceneComponentsSpec({ visual: { kind: "sprite", texture: "tree", width: 40, height: 80,
    projection: "upright", shadow: { shape: "box", opacity: 0.5 } }, collider: "none", layer: "wall" });
  if (components.mode !== "inline") throw new Error("Expected inline");
  deepEqual(components.visual.shadow, { shape: "box", width: 40, height: 80, opacity: 0.5 });
  deepEqual(components.collider, { type: "none" });
  deepEqual(resolveDataSceneGroundShadow({ shape: "alpha" }, 40, 80), { shape: "alpha", width: 40, height: 80, opacity: 1 });
  throws(() => resolveDataSceneGroundShadow({ shape: "contour" }, 40, 80), /ellipse, box or alpha/);
  throws(() => resolveDataSceneGroundShadow({ shape: "ellipse", opacity: 2 }, 40, 80), /opacity/);
  throws(() => resolveDataSceneComponentsSpec({ visual: { kind: "sprite", texture: 1, width: 10, height: 10, projection: "perspective" }, collider: "none", layer: "wall" }), /projection/);
  throws(() => resolveDataSceneComponentsSpec({ visual: { kind: "sprite", texture: 1, width: 10, height: 10, shadow: { shape: "box", width: -1 } }, collider: "none", layer: "wall" }), /components.visual.shadow.width/);
});
