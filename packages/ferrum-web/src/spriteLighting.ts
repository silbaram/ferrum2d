import type { Engine } from "../pkg/ferrum_core.js";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";
import type { RenderCommandBufferView } from "./renderCommandDecoder.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import { writeSpriteSurfaceStaging } from "./spriteSurface.js";
import { supportsSpriteLightMasks,requestsSpriteLightMasks } from "./spriteLightMasks.js";
import { isLightingChannelMask } from "./lightingMasks.js";

export const MAX_SPRITE_LIGHTING_UPDATES = 65_536;

/** Explicit flat-light receiver, independent of the legacy sprite material preset name. */
export interface SpriteLightingMaterialSpec {
  mode: "unlit" | "opaque" | "cutout";
  /** Only cutout accepts a cutoff, default 0.5. Compared after texture and tint alpha. */
  alphaCutoff?: number;
  /** Eight channel bits, default255. Opaque/cutout receivers only. */
  lightMask?: number;
  /** Independent shadow reception; zero retains unshadowed direct light. Default255. */
  shadowMask?: number;
}
export interface SpriteLightingBufferView {
  version: 1; stride: 2;
  /** Command-aligned mode u32, cutoff f32 over the same 8-byte record. */
  words: Uint32Array; values: Float32Array;
}
type LightingExports = {
  sprite_lighting_material_abi_version(): number; sprite_lighting_material_size(): number;
  sprite_lighting_material_ptr(): number; sprite_lighting_material_len(): number;
  configure_sprite_lighting_materials(records: Uint32Array): boolean;
};
const names = ["sprite_lighting_material_abi_version", "sprite_lighting_material_size", "sprite_lighting_material_ptr", "sprite_lighting_material_len", "configure_sprite_lighting_materials"] as const;
export function resolveSpriteLightingMaterial(value: unknown, path: string): SpriteLightingMaterialSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw sceneCompositionDiagnosticError(path, "must be a receiver object");
  const o = value as Record<string, unknown>;
  for (const key of Object.keys(o)) if (!["mode","alphaCutoff","lightMask","shadowMask"].includes(key)) throw sceneCompositionDiagnosticError(`${path}.${key}`, "is not supported");
  if (o.mode !== "unlit" && o.mode !== "opaque" && o.mode !== "cutout") throw sceneCompositionDiagnosticError(`${path}.mode`, "must be unlit, opaque or cutout");
  if (o.alphaCutoff !== undefined && (o.mode !== "cutout" || typeof o.alphaCutoff !== "number" || !Number.isFinite(Math.fround(o.alphaCutoff)) || o.alphaCutoff < 0 || o.alphaCutoff > 1))
    throw sceneCompositionDiagnosticError(`${path}.alphaCutoff`, "requires cutout mode and a finite value in 0..1");
  for(const key of ["lightMask","shadowMask"] as const)if(o[key]!==undefined&&(o.mode==="unlit"||!isLightingChannelMask(o[key])))throw sceneCompositionDiagnosticError(`${path}.${key}`,"requires an opaque/cutout receiver and an integer in 0..255");
  return { mode: o.mode, ...(o.alphaCutoff === undefined ? {} : { alphaCutoff: o.alphaCutoff as number }),
    ...(o.lightMask===undefined?{}:{lightMask:o.lightMask as number}),...(o.shadowMask===undefined?{}:{shadowMask:o.shadowMask as number}) };
}
export function supportsSpriteLighting(engine: Engine): engine is Engine & LightingExports {
  const e = engine as Engine & Partial<LightingExports>;
  return names.every(n => typeof e[n] === "function") && e.sprite_lighting_material_abi_version!() === 1 && e.sprite_lighting_material_size!() === 8;
}
export function readSpriteLighting(engine: Engine, memory: WebAssembly.Memory, count: number): SpriteLightingBufferView | undefined {
  const e = engine as Engine & Partial<LightingExports>;
  if (names.every(n => e[n] === undefined)) return undefined;
  if (!supportsSpriteLighting(engine)) throw Error("Unsupported sprite lighting material ABI");
  const length = engine.sprite_lighting_material_len(); if (length === 0) return undefined;
  const ptr = engine.sprite_lighting_material_ptr();
  if (!Number.isSafeInteger(count) || count < 0 || length !== count || !Number.isSafeInteger(ptr) || ptr < 0 || ptr % 4 || ptr + length * 8 > memory.buffer.byteLength) throw Error("Misaligned sprite lighting material buffer");
  const view: SpriteLightingBufferView = { version: 1, stride: 2, words: new Uint32Array(memory.buffer, ptr, count * 2), values: new Float32Array(memory.buffer, ptr, count * 2) };
  validateSpriteLighting({ commandCount: count, spriteLightingMaterials: view }); return view;
}
export function configureSpriteLighting(engine: Engine, updates: readonly { entity: GameplayEntityHandle; lighting?: SpriteLightingMaterialSpec }[]): boolean {
  if (!supportsSpriteLighting(engine) || updates.length > MAX_SPRITE_LIGHTING_UPDATES) return false;
  const masks=updates.some(update=>requestsSpriteLightMasks(update.lighting));
  if(masks&&!supportsSpriteLightMasks(engine))return false;
  const stride=masks?6:4;
  const words = new Uint32Array(updates.length * stride), values = new Float32Array(words.buffer), seen = new Set<number>();
  for (const [i, update] of updates.entries()) {
    const { entityId, entityGeneration } = update.entity;
    if (![entityId, entityGeneration].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 0xffffffff) || seen.has(entityId)) return false;
    let material: SpriteLightingMaterialSpec;
    try { material = resolveSpriteLightingMaterial(update.lighting ?? { mode: "unlit" }, "sprite.lighting"); } catch { return false; }
    seen.add(entityId); words.set([entityId, entityGeneration, material.mode === "opaque" ? 1 : material.mode === "cutout" ? 2 : 0, 0], i * stride);
    values[i * stride + 3] = material.mode === "cutout" ? material.alphaCutoff ?? .5 : 0;
    if(masks){words[i*stride+4]=material.lightMask??255;words[i*stride+5]=material.shadowMask??255;}
  }
  return masks?engine.configure_sprite_lighting_materials_v2(words):engine.configure_sprite_lighting_materials(words);
}
export function validateSpriteLighting(commands: Pick<RenderCommandBufferView, "commandCount" | "spriteLightingMaterials">): boolean {
  const view = commands.spriteLightingMaterials; if (!view) return false;
  if (view.version !== 1 || view.stride !== 2 || !(view.words instanceof Uint32Array) || !(view.values instanceof Float32Array)
    || view.words.length !== commands.commandCount * 2 || view.values.length !== view.words.length
    || view.words.buffer !== view.values.buffer || view.words.byteOffset !== view.values.byteOffset) throw Error("Invalid sprite lighting material sidecar");
  let active = false;
  for (let i = 0; i < view.words.length; i += 2) {
    const mode = view.words[i]!, cutoff = view.values[i + 1]!;
    if (mode > 2 || !Number.isFinite(cutoff) || cutoff < 0 || cutoff > 1 || (mode !== 2 && cutoff !== 0)) throw Error("Invalid sprite lighting material record");
    active ||= mode !== 0;
  }
  return active;
}

/** Private GPU staging extension; the public command remains 15 floats. Expand backwards in-place. */
export function expandLitSpriteCommands(data: Float32Array, commands: RenderCommandBufferView, first: number, count: number,
  source: { textureInfo?(id: number): { colorSpace: "srgb" | "linear" | "none" } | undefined; textureFlipY?(id: number): boolean }, linearWorking: boolean, hdr = false, surface = false,surfaceColorDecoded=false,masks=false): void {
  const material = commands.spriteLightingMaterials;
  const stride = masks?19:surface ? 24 : 17;
  for (let i = count - 1; i >= 0; i--) {
    data.copyWithin(i * stride, i * 15, i * 15 + 15);
    const index = first + i, mode = material?.words[index * 2] ?? 0;
    const srgb = !linearWorking && source.textureInfo?.(Math.trunc(data[i * stride + 12]!))?.colorSpace === "srgb";
    data[i * stride + 15] = mode + (srgb ? 4 : 0) + (hdr ? 8 : 0); data[i * stride + 16] = material?.values[index * 2 + 1] ?? 0;
    if (surface) writeSpriteSurfaceStaging(data, i * stride + 17, commands, index, source,surfaceColorDecoded);
    if(masks){data[i*stride+17]=commands.spriteLightMasks?.buffer[index*2]??255;data[i*stride+18]=commands.spriteLightMasks?.buffer[index*2+1]??255;}
  }
}
