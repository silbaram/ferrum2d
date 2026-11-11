import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { normalizeLightingScene } from "../src/lightingNormalize.js";
import { resolveSceneLighting } from "../src/sceneLighting.js";
import { resolveFlatHdr, validateFlatHdrTransition } from "../src/flatHdr.js";
import { resolveDirectionalLight2D } from "../src/dataSceneSun.js";
import { expandLitSpriteCommands } from "../src/spriteLighting.js";
import { WebGL2HdrPass } from "../src/webgl2HdrPass.js";
import { WebGpuHdrPass } from "../src/webgpuHdrPass.js";
import { webGpuResources } from "../src/webgpuResources.js";
import { createScenePlacementViewer, mergeScenePlacementPatch, resolveSceneAuthoringDocument } from "../src/authoring.js";
import { validateFlatLitCommands } from "../src/flatLit.js";
import { resolveSpriteMaterialPreset } from "../src/spriteMaterial.js";
import { attachDataSceneRuntimeEngineAdapter, preflightDataSceneLighting } from "../src/dataSceneRuntimeTarget.js";
import type { FerrumEngine } from "../src/engineTypes.js";

test("HDR is explicit, validates inactive settings and round-trips authored disabled choices", () => {
  equal(normalizeLightingScene({ profile: "lit" }).hdr, undefined);
  const input = { profile: "lit" as const, enabled: false, hdr: { enabled: false, exposure: -3, toneMapping: "aces" as const },
    directionalLight: { directionX: 1, directionY: 0, intensity: 4 } };
  const resolved = normalizeLightingScene(input);
  deepEqual(resolved.hdr, input.hdr); equal(resolved.directionalLight!.intensity, 4);
  deepEqual(normalizeLightingScene(JSON.parse(JSON.stringify(resolved))), resolved);
  deepEqual(resolveSceneLighting(resolved), resolved);
  for (const hdr of [null, true, [], { enabled: 0 }, { exposure: null }, { exposure: NaN }, { exposure: Infinity }, { exposure: -11 }, { exposure: 11 }, { toneMapping: null }, { toneMapping: "other" }, { unknown: true }]) {
    throws(() => normalizeLightingScene({ profile: "lit", enabled: false, hdr } as never), /hdr/);
    throws(() => resolveSceneLighting({ profile: "lit", enabled: false, hdr }), /hdr/);
  }
  throws(() => normalizeLightingScene({ enabled: false, hdr: false }), /lit/);
  throws(() => resolveDirectionalLight2D({ directionX: 1, directionY: 0, intensity: 2 }), /intensity/);
  throws(() => normalizeLightingScene({ profile: "lit", directionalLight: { directionX: 1, directionY: 0, intensity: 65 } }), /intensities/);
  const document = resolveSceneAuthoringDocument({ format: "ferrum2d.consumer.scene-authoring", version: 1, lighting: input, behaviorRecipes: { entities: {} },
    sceneComposition: { initialFragment: "main", prefabs: {}, fragments: { main: { instances: [] } } } });
  const viewer = createScenePlacementViewer({ document, viewport: { cssWidth: 96, cssHeight: 64 } });
  viewer.updateLighting({ ...input, hdr: { ...input.hdr, exposure: 2 } });
  const merged = mergeScenePlacementPatch(document, JSON.parse(JSON.stringify(viewer.exportPatch())));
  deepEqual(merged.document.lighting!.hdr, { enabled: false, exposure: 2, toneMapping: "aces" });
  viewer.undo(); equal(viewer.exportPatch(), undefined);
  viewer.redo(); const hdr = viewer.state().lighting!.hdr; if (!hdr) throw Error("Missing HDR state"); equal(hdr.exposure, 2);
});

test("HDR transition guard preserves one world transform and rejects late activation", () => {
  const settings = resolveFlatHdr({ exposure: -1 });
  validateFlatHdrTransition(settings, undefined, false);
  validateFlatHdrTransition({ ...settings }, settings, true);
  validateFlatHdrTransition(undefined, settings, true);
  throws(() => validateFlatHdrTransition(settings, undefined, true), /before world drawing/);
  throws(() => validateFlatHdrTransition({ ...settings, exposure: 2 }, settings, true), /before world drawing/);
  throws(() => validateFlatHdrTransition({ ...settings, toneMapping: "none" }, settings, true), /before world drawing/);
});

test("HDR staging keeps source transfer independent from float output and native command layout", () => {
  const commands = { commandCount: 1, floatsPerCommand: 15, buffer: new Float32Array(15) };
  for (const [space, decoded, expected] of [["srgb", false, 12], ["srgb", true, 8], ["none", false, 8], ["linear", false, 8]] as const) {
    const data = new Float32Array(17); data.set(commands.buffer);
    expandLitSpriteCommands(data, commands, 0, 1, { textureInfo: () => ({ colorSpace: space }) }, decoded, true);
    equal(data[15], expected); deepEqual(data.slice(0, 15), commands.buffer);
  }
});

test("HDR unlit sprites require known straight alpha and cold preflight includes implicit unlit assets", () => {
  const scene = normalizeLightingScene({ profile: "lit", hdr: {} });
  const commands = { commandCount: 1, floatsPerCommand: 15, buffer: Float32Array.from([0, 0, 8, 8, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0]) };
  const source = (alphaMode?: "straight" | "premultiplied") => ({ textureInfo: () => ({ width: 1, height: 1, colorSpace: "srgb" as const, alphaMode }) });
  for (const mode of [undefined, "premultiplied"] as const) throws(() => validateFlatLitCommands(commands, scene, source(mode), resolveSpriteMaterialPreset(undefined)), /straight-alpha/);
  equal(validateFlatLitCommands(commands, scene, source("straight"), resolveSpriteMaterialPreset(undefined)), false);
  // Primitive commands do not read color pixels from their placeholder texture.
  commands.buffer[13] = 16; equal(validateFlatLitCommands(commands, scene, source(), resolveSpriteMaterialPreset(undefined)), false);
  const engine = {} as FerrumEngine;
  attachDataSceneRuntimeEngineAdapter(engine, { supportsSpriteLightingMaterials: () => true, textureId: () => 2,
    useDataScene: () => { throw Error("Preflight must not activate the scene"); },
    spawnDataSceneEntity: () => { throw Error("Preflight must not spawn an entity"); } });
  const document = { format: "ferrum2d.consumer.scene-authoring", version: 1, lighting: { profile: "lit", hdr: {} }, behaviorRecipes: { entities: {} },
    sceneComposition: { prefabs: { item: { props: { components: { sprite: { texture: "color", width: 8, height: 8 }, collider: "none", layer: "wall" } } } },
      fragments: { main: { instances: [{ id: "item", prefab: "item" }] } } } };
  let checked = false;
  preflightDataSceneLighting(engine, document, { flatLightingPreparer: { prepareFlatLighting: (_scene, assets) => {
    deepEqual(assets, [{ textureId: 2, normalTextureId: undefined, lighting: { mode: "unlit" } }]); checked = true;
  } } });
  ok(checked);
});

test("GL HDR target failure preserves old allocation, retries without warm churn and releases targets", () => {
  const textures = new Set<object>(), targets = new Set<object>(), constants = new Map<string, number>();
  let attempts = 0, fail = false;
  const methods: Record<string, unknown> = {
    getParameter: (key: number) => key === constants.get("MAX_TEXTURE_SIZE") ? 8192 : null,
    createProgram: () => ({}), createShader: () => ({}), createVertexArray: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: () => ({}),
    createTexture: () => { attempts++; if (fail) return null; const value = {}; textures.add(value); return value; },
    createFramebuffer: () => { const value = {}; targets.add(value); return value; },
    deleteTexture: (value: object) => textures.delete(value), deleteFramebuffer: (value: object) => targets.delete(value),
    checkFramebufferStatus: () => constants.get("FRAMEBUFFER_COMPLETE"),
  };
  const gl = new Proxy(methods, { get: (object, key: string) => {
    if (key in object) return object[key];
    if (/^[A-Z_0-9]+$/.test(key)) { if (!constants.has(key)) constants.set(key, constants.size + 1); return constants.get(key); }
    return () => {};
  } }) as unknown as WebGL2RenderingContext;
  void gl.FRAMEBUFFER_COMPLETE; void gl.MAX_TEXTURE_SIZE;
  const pass = new WebGL2HdrPass(gl);
  try {
    pass.prepare(96, 64); equal(pass.resourceStats().textureBytes, 96 * 64 * 8);
    const warm = attempts; pass.prepare(96, 64); equal(attempts, warm);
    fail = true; throws(() => pass.prepare(120, 80), /allocation failed/);
    equal(textures.size, 1); equal(targets.size, 1); equal(pass.resourceStats().textureBytes, 96 * 64 * 8); pass.bind();
    fail = false; pass.prepare(120, 80); equal(textures.size, 1); equal(targets.size, 1);
    pass.release(); equal(pass.resourceStats().textureBytes, 0); equal(pass.resourceStats().renderTargetCount, 0);
    pass.prepare(96, 64); equal(textures.size, 1);
  } finally { pass.destroy(); }
  equal(textures.size, 0); equal(targets.size, 0); equal(pass.resourceStats().programCount, 0);
});

test("GPU HDR target binding failure cleans the replacement, retains old target and retries", () => {
  Object.assign(globalThis, { GPUShaderStage: { FRAGMENT: 2 }, GPUBufferUsage: { UNIFORM: 64, COPY_DST: 8 }, GPUTextureUsage: { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4 } });
  let fail = false, attempts = 0;
  const resources: { destroyed: boolean }[] = [];
  const resource = () => { const value = { destroyed: false, destroy() { this.destroyed = true; }, createView: () => ({}) }; resources.push(value); return value; };
  const device = { limits: { maxTextureDimension2D: 8192 }, createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
    createShaderModule: () => ({}), createRenderPipeline: () => ({}), createBuffer: resource,
    createTexture: () => { attempts++; return resource(); }, createBindGroup: () => { if (fail) throw Error("binding failed"); return {}; },
  } as unknown as GPUDevice;
  const pass = new WebGpuHdrPass(device, "rgba8unorm");
  try {
    pass.prepare(96, 64); const texture = pass.texture(); equal(webGpuResources(device).stats().textureBytes, 96 * 64 * 8);
    pass.prepare(96, 64); equal(attempts, 1);
    fail = true; throws(() => pass.prepare(120, 80), /binding failed/);
    equal(pass.texture(), texture); equal(webGpuResources(device).stats().renderTargetCount, 1);
    fail = false; pass.prepare(120, 80); equal(webGpuResources(device).stats().renderTargetCount, 1);
    pass.release(); equal(webGpuResources(device).stats().textureCount, 0);
    pass.prepare(96, 64);
  } finally { pass.destroy(); }
  ok(resources.every(value => value.destroyed)); equal(webGpuResources(device).stats().estimatedBytes, 0); equal(webGpuResources(device).stats().programCount, 0);
});
