import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { normalizeLightingScene, createResolvedLightingScene, resolveLightingSceneInto } from "../src/lightingNormalize.js";
import { resolveLightingCookieReferences, validateLightingCookies } from "../src/lightingCookie.js";
import { resolveSceneLighting } from "../src/sceneLighting.js";

test("cookie source preserves named/numeric references and OFF UV/rotation through JSON, with explicit cold mapping", () => {
  const input = { profile: "lit" as const, enabled: false, pointLights: [{ x: 0, y: 0, radius: 100, cookie: { texture: "pattern", rotationRadians: 0, uv: [1, 0, 0, 1] as const } }] };
  const scene = resolveSceneLighting(input);
  deepEqual(resolveSceneLighting(JSON.parse(JSON.stringify(scene))), scene);
  equal(scene.pointLights[0].cookie!.texture, "pattern"); equal(scene.enabled, false);
  throws(() => validateLightingCookies(scene, { textureInfo: () => undefined }), /Named cookie/);
  const mapped = normalizeLightingScene(resolveLightingCookieReferences(input, name => { equal(name, "pattern"); return 7; }));
  equal(mapped.pointLights[0].cookie!.texture, 7); equal(input.pointLights[0].cookie.texture, "pattern");
  validateLightingCookies(mapped, { textureInfo: () => ({ width: 4, height: 4, colorSpace: "none", alphaMode: "straight" }) });
  throws(() => validateLightingCookies(mapped, { textureInfo: () => ({ width: 4, height: 4, colorSpace: "srgb", alphaMode: "straight" }) }), /linear\/data/);
  throws(() => validateLightingCookies(mapped, { textureInfo: () => undefined }), /loaded/);
  throws(() => resolveLightingCookieReferences(input, () => NaN), /texture/);
  const alias = normalizeLightingScene({ profile: "lit", pointLights: [{ x: 0, y: 0, radius: 1, cookie: { textureId: 0 } }] });
  equal(alias.pointLights[0].cookie!.texture, 0);
  const reused = createResolvedLightingScene(); resolveLightingSceneInto(reused, input); resolveLightingSceneInto(reused, { profile: "lit", pointLights: [{ x: 0, y: 0, radius: 1 }] });
  equal(reused.pointLights[0].cookie, undefined);
});

test("invalid cookies reject even OFF, including mixed references, null fields and float32-degenerate atlas rectangles", () => {
  for (const cookie of [null, {}, { texture: " " }, { textureId: -1 }, { textureId: 16777215 }, { texture: 1, textureId: 2 }, { texture: 1, rotationRadians: null }, { texture: 1, uv: null }, { texture: 1, uv: [0, 0, 0, 1] }, { texture: 1, uv: [.5, 0, .50000000001, 1] }, { texture: 1, uv: [0, 0, 2, 1] }, { texture: 1, arbitrary: true }])
    throws(() => resolveSceneLighting({ profile: "lit", enabled: false, pointLights: [{ x: 0, y: 0, radius: 1, cookie }] }), /cookie/);
  throws(() => resolveSceneLighting({ enabled: false, pointLights: [{ x: 0, y: 0, radius: 1, cookie: { texture: 1 } }] }), /lit profile/);
  // Array.every skips holes; the public renderer normalizer must reject them too.
  for (const uv of [new Array(4), Object.assign(new Array(4), { 0: 0, 2: 1, 3: 1 })])
    throws(() => normalizeLightingScene({ profile: "lit", pointLights: [{ x: 0, y: 0, radius: 1, cookie: { textureId: 7, uv } }] } as never), /cookie.uv/);
});
