import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { AssetLoader, assetManifestFingerprint, linearToSrgb, srgbToLinear } from "../src/core.js";
import { resolveColorManagementMode, resolveTextureColorSpace } from "../src/colorManagement.js";
import { resolveAssetPreloadPlan } from "../src/assetPreload.js";
import { WebGPURenderer } from "../src/webgpuRenderer.js";

async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try { await promise; } catch (error) {
    ok(error instanceof Error && pattern.test(error.message), String(error));
    return;
  }
  throw new Error(`Expected rejection: ${pattern}`);
}

test("sRGB transfer functions handle dark channels, middle gray, boundaries and invalid numbers", () => {
  equal(srgbToLinear(0), 0);
  equal(srgbToLinear(1), 1);
  ok(Math.abs(srgbToLinear(0.5) - 0.21404114048223255) < 1e-12);
  ok(Math.abs(linearToSrgb(0.5) - 0.7353569830524495) < 1e-12);
  for (let byte = 0; byte <= 255; byte++) {
    ok(Math.abs(linearToSrgb(srgbToLinear(byte / 255)) - byte / 255) < 1e-6);
  }
  for (const invalid of [-1, 2, NaN, Infinity]) {
    throws(() => srgbToLinear(invalid), /Color channel/);
    throws(() => linearToSrgb(invalid), /Color channel/);
  }
});

test("color metadata defaults preserve legacy output and validate unknown runtime input", () => {
  equal(resolveColorManagementMode(), "legacy");
  equal(resolveTextureColorSpace(), "srgb");
  throws(() => resolveColorManagementMode("display-p3"), /colorManagement/);
  throws(() => resolveTextureColorSpace({ colorSpace: "bad" as "srgb" }), /colorSpace/);
  throws(() => resolveTextureColorSpace(null as unknown as {}), /object/);
});

test("asset metadata is validated before loading and forwarded without changing string manifests", async () => {
  const calls: unknown[][] = [];
  const loader = new AssetLoader({ loadTexture: async (...args) => { calls.push(args); } });
  await rejects(loader.loadAssets({ textures: { gray: "gray.png" }, textureOptions: { missing: { colorSpace: "none" } } }), /matching texture/);
  await rejects(loader.loadAssets({ textures: { gray: "gray.png" }, textureOptions: { gray: { colorSpace: "bad" as "srgb" } } }), /colorSpace/);
  equal(calls.length, 0);
  await loader.loadAssets({ textures: { gray: "gray.png", mask: "mask.png" }, textureOptions: { mask: { colorSpace: "none" } } });
  deepEqual(calls, [[1, "gray.png"], [2, "mask.png", { colorSpace: "none" }]]);
  const base = { textures: { gray: "gray.png" } };
  equal(assetManifestFingerprint(base), assetManifestFingerprint({ ...base, textureOptions: { gray: { colorSpace: "srgb" } } }));
  ok(assetManifestFingerprint(base) !== assetManifestFingerprint({ ...base, textureOptions: { gray: { colorSpace: "linear" } } }));
  throws(() => resolveAssetPreloadPlan({ ...base, textureOptions: { missing: {} } }), /matching texture/);
});

test("WebGPU rejects managed output before acquiring a canvas context", async () => {
  let acquired = false;
  const canvas = { getContext: () => { acquired = true; return null; } } as unknown as HTMLCanvasElement;
  await rejects(WebGPURenderer.create(canvas, { colorManagement: "linear-srgb" }), /WebGPU linear-srgb/);
  equal(acquired, false);
});
