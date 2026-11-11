import type { Engine } from "../pkg/ferrum_core.js";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";
import type { RenderCommandBufferView } from "./renderCommandDecoder.js";
import type { SpriteLightingBufferView } from "./spriteLighting.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";

export const SPRITE_SURFACE_TEXTURE_NONE = 16_777_215;
export function spriteSurfaceTextureId(commands: RenderCommandBufferView, index: number, map: number): number {
  const surface=commands.spriteSurfaceMaterials,at=index*10;
  return surface?.words[at+3]===1 ? surface.words[at+map] : SPRITE_SURFACE_TEXTURE_NONE;
}
export interface SpriteSurfaceMaterialSpec {
  /** Linear emission before HDR output; defaults to black. */
  emission?: readonly [number, number, number];
  emissionTextureId?: number;
  /** Bounded non-metallic direct specular, default 0. */
  specular?: number;
  specularTextureId?: number;
  /** Authored 0..1, default 1; shader floor is .12. */
  roughness?: number;
  roughnessTextureId?: number;
}
export interface SpriteSurfaceBufferView {
  version: 1; stride: 10;
  /** Same 40-byte record as native; flags/reserved/texture IDs use the u32 alias. */
  words: Uint32Array; values: Float32Array;
}
type SurfaceExports = {
  configure_sprite_surface_materials(records: Uint32Array): boolean;
  sprite_surface_material_abi_version(): number;
  sprite_surface_material_size(): number;
  sprite_surface_material_ptr(): number;
  sprite_surface_material_len(): number;
};
const names = ["configure_sprite_surface_materials", "sprite_surface_material_abi_version", "sprite_surface_material_size", "sprite_surface_material_ptr", "sprite_surface_material_len"] as const;
export function supportsSpriteSurface(engine: Engine): engine is Engine & SurfaceExports {
  const e = engine as Engine & Partial<SurfaceExports>;
  return names.every(name => typeof e[name] === "function") && e.sprite_surface_material_abi_version!() === 1 && e.sprite_surface_material_size!() === 40;
}
export function resolveSpriteSurfaceMaterial(value: unknown, path: string): SpriteSurfaceMaterialSpec {
  const fail = (at: string, message: string): never => { throw sceneCompositionDiagnosticError(at, message); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(path, "must be a surface object");
  const o = value as Record<string, unknown>, result: SpriteSurfaceMaterialSpec = {};
  for (const key of Object.keys(o)) if (!["emission", "emissionTextureId", "specular", "specularTextureId", "roughness", "roughnessTextureId"].includes(key)) fail(`${path}.${key}`, "is not supported");
  const scalar = (key: "specular" | "roughness") => {
    const v = o[key];
    if (typeof v !== "number" || !Number.isFinite(Math.fround(v)) || v < 0 || v > 1) return fail(`${path}.${key}`, "must be finite in 0..1");
    result[key] = v;
  };
  if (o.specular !== undefined) scalar("specular");
  if (o.roughness !== undefined) scalar("roughness");
  if (o.emission !== undefined) {
    const v = o.emission;
    if (!Array.isArray(v) || v.length !== 3 || !Array.from(v).every(n => typeof n === "number" && Number.isFinite(Math.fround(n)) && n >= 0 && n <= 64)) return fail(`${path}.emission`, "must be linear RGB in 0..64");
    result.emission = [...v] as [number, number, number];
  }
  for (const key of ["emissionTextureId", "specularTextureId", "roughnessTextureId"] as const) {
    const v = o[key];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= SPRITE_SURFACE_TEXTURE_NONE) return fail(`${path}.${key}`, "must be a valid texture ID");
    result[key] = v;
  }
  return result;
}
export function configureSpriteSurface(engine: Engine, updates: readonly { entity: GameplayEntityHandle; surface?: SpriteSurfaceMaterialSpec }[]): boolean {
  if (!supportsSpriteSurface(engine) || updates.length > 65_536) return false;
  const words = new Uint32Array(updates.length * 12), values = new Float32Array(words.buffer), seen = new Set<number>();
  for (let i = 0; i < updates.length; i++) {
    const { entity, surface } = updates[i], { entityId, entityGeneration } = entity;
    if (![entityId, entityGeneration].every(n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff) || seen.has(entityId)) return false;
    seen.add(entityId);
    let material: SpriteSurfaceMaterialSpec;
    try { material = surface === undefined ? {} : resolveSpriteSurfaceMaterial(surface, "sprite.surface"); } catch { return false; }
    const at = i * 12;
    words.set([entityId, entityGeneration, material.emissionTextureId ?? SPRITE_SURFACE_TEXTURE_NONE,
      material.specularTextureId ?? SPRITE_SURFACE_TEXTURE_NONE, material.roughnessTextureId ?? SPRITE_SURFACE_TEXTURE_NONE,
      Number(surface !== undefined)], at);
    values.set([...(material.emission ?? [0, 0, 0]), material.specular ?? 0, material.roughness ?? 1], at + 6);
  }
  return engine.configure_sprite_surface_materials(words);
}
export function readSpriteSurface(engine: Engine, memory: WebAssembly.Memory, count: number, lighting?: SpriteLightingBufferView): SpriteSurfaceBufferView | undefined {
  const e = engine as Engine & Partial<SurfaceExports>;
  if (names.every(name => e[name] === undefined)) return undefined;
  if (!supportsSpriteSurface(engine)) throw Error("Unsupported sprite surface material ABI");
  const length = engine.sprite_surface_material_len();
  if (length === 0) return undefined;
  const ptr = engine.sprite_surface_material_ptr();
  if (!Number.isSafeInteger(count) || count < 0 || length !== count || !Number.isSafeInteger(ptr) || ptr < 0 || ptr % 4 || ptr + length * 40 > memory.buffer.byteLength) throw Error("Misaligned sprite surface material buffer");
  const view: SpriteSurfaceBufferView = { version: 1, stride: 10, words: new Uint32Array(memory.buffer, ptr, count * 10), values: new Float32Array(memory.buffer, ptr, count * 10) };
  validateSpriteSurface({ commandCount: count, spriteSurfaceMaterials: view, spriteLightingMaterials: lighting });
  return view;
}
export function validateSpriteSurface(commands: Pick<RenderCommandBufferView, "commandCount" | "spriteSurfaceMaterials" | "spriteLightingMaterials">, profile?:string): boolean {
  const view = commands.spriteSurfaceMaterials;
  if (!view) return false;
  if (view.version !== 1 || view.stride !== 10 || !(view.words instanceof Uint32Array) || !(view.values instanceof Float32Array)
    || view.words.length !== commands.commandCount * 10 || view.values.length !== view.words.length
    || view.words.buffer !== view.values.buffer || view.words.byteOffset !== view.values.byteOffset) throw Error("Invalid sprite surface material sidecar");
  let active = false;
  for (let i = 0; i < view.words.length; i += 10) {
    const flags = view.words[i + 3], values = view.values, words = view.words;
    if (flags > 1 || words[i + 9] !== 0 || words[i] > SPRITE_SURFACE_TEXTURE_NONE || words[i + 1] > SPRITE_SURFACE_TEXTURE_NONE || words[i + 2] > SPRITE_SURFACE_TEXTURE_NONE
      || !Number.isFinite(values[i + 4]) || values[i + 4] < 0 || values[i + 4] > 64
      || !Number.isFinite(values[i + 5]) || values[i + 5] < 0 || values[i + 5] > 64
      || !Number.isFinite(values[i + 6]) || values[i + 6] < 0 || values[i + 6] > 64
      || !Number.isFinite(values[i + 7]) || values[i + 7] < 0 || values[i + 7] > 1
      || !Number.isFinite(values[i + 8]) || values[i + 8] < 0 || values[i + 8] > 1) throw Error("Invalid sprite surface material record");
    if (flags === 0) {
      if (words[i] !== SPRITE_SURFACE_TEXTURE_NONE || words[i + 1] !== SPRITE_SURFACE_TEXTURE_NONE || words[i + 2] !== SPRITE_SURFACE_TEXTURE_NONE
        || values[i + 4] !== 0 || values[i + 5] !== 0 || values[i + 6] !== 0 || values[i + 7] !== 0 || values[i + 8] !== 1) throw Error("Noncanonical disabled sprite surface material");
    } else {
      if(profile!==undefined && profile!=="lit")throw Error("Sprite surfaces require the lit lighting profile");
      const mode = commands.spriteLightingMaterials?.words[(i / 10) * 2];
      if (mode !== 1 && mode !== 2) throw Error("Sprite surfaces require an opaque/cutout receiver");
      active ||= values[i + 4] > 0 || values[i + 5] > 0 || values[i + 6] > 0 || values[i + 7] > 0;
    }
  }
  return active;
}

/** Private 24-float staging tail: emission RGB/specular, roughness/map flags/padding. */
export function writeSpriteSurfaceStaging(data: Float32Array, at: number, commands: RenderCommandBufferView, index: number,
  source: { textureInfo?(id: number): { colorSpace: "srgb" | "linear" | "none" } | undefined; textureFlipY?(id: number): boolean },colorDecoded=false): void {
  const surface = commands.spriteSurfaceMaterials, record = index * 10;
  if (!surface || surface.words[record + 3] === 0) {
    for (let k = 0; k < 7; k++) data[at + k] = k === 4 ? 1 : 0;
    return;
  }
  let flags = 128;
  for (let map = 0; map < 3; map++) {
    const id = surface.words[record + map];
    if (id === SPRITE_SURFACE_TEXTURE_NONE) continue;
    flags |= 1 << (map * 2);
    if (source.textureFlipY?.(id)) flags |= 2 << (map * 2);
    if (map === 0 && !colorDecoded && source.textureInfo?.(id)?.colorSpace === "srgb") flags |= 64;
  }
  for (let k = 0; k < 5; k++) data[at + k] = surface.values[record + 4 + k];
  data[at + 5] = flags;data[at + 6] = 0;
}
