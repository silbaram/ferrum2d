import type { Engine } from "../pkg/ferrum_core.js";
import type { RenderCommandBufferView } from "./renderCommandDecoder.js";
import type { SpriteLightingBufferView } from "./spriteLighting.js";

export function requestsSpriteLightMasks(lighting?:{lightMask?:number;shadowMask?:number}):boolean{
  return lighting?.lightMask!==undefined||lighting?.shadowMask!==undefined;
}

export interface SpriteLightMaskBufferView {
  version: 1;
  stride: 2;
  /** Command-aligned light/shadow u32 pairs. Default255/255, zero is explicit. */
  buffer: Uint32Array;
}
type MaskExports = {
  configure_sprite_lighting_materials_v2(records: Uint32Array): boolean;
  sprite_light_mask_abi_version(): number;
  sprite_light_mask_size(): number;
  sprite_light_mask_ptr(): number;
  sprite_light_mask_len(): number;
};
const names = ["configure_sprite_lighting_materials_v2", "sprite_light_mask_abi_version", "sprite_light_mask_size", "sprite_light_mask_ptr", "sprite_light_mask_len"] as const;
export function supportsSpriteLightMasks(engine: Engine): engine is Engine & MaskExports {
  const e = engine as Engine & Partial<MaskExports>;
  return names.every(name => typeof e[name] === "function") && e.sprite_light_mask_abi_version!() === 1 && e.sprite_light_mask_size!() === 8;
}
export function readSpriteLightMasks(engine: Engine, memory: WebAssembly.Memory, count: number, lighting?: SpriteLightingBufferView): SpriteLightMaskBufferView | undefined {
  const e = engine as Engine & Partial<MaskExports>;
  if (names.every(name => e[name] === undefined)) return undefined;
  if (!supportsSpriteLightMasks(engine)) throw Error("Unsupported sprite light mask ABI");
  const length = engine.sprite_light_mask_len();
  if (length === 0) return undefined;
  const ptr = engine.sprite_light_mask_ptr();
  if (!Number.isSafeInteger(count) || count < 0 || length !== count || !Number.isSafeInteger(ptr) || ptr < 0 || ptr % 4 || ptr + length * 8 > memory.buffer.byteLength) throw Error("Misaligned sprite light mask buffer");
  const result: SpriteLightMaskBufferView = { version: 1, stride: 2, buffer: new Uint32Array(memory.buffer, ptr, count * 2) };
  validateSpriteLightMasks({ commandCount: count, spriteLightMasks: result, spriteLightingMaterials: lighting });
  return result;
}
export function validateSpriteLightMasks(commands: Pick<RenderCommandBufferView, "commandCount" | "spriteLightMasks" | "spriteLightingMaterials">, profile?: string): boolean {
  const view = commands.spriteLightMasks;
  if (!view) return false;
  if (view.version !== 1 || view.stride !== 2 || !(view.buffer instanceof Uint32Array) || view.buffer.length !== commands.commandCount * 2) throw Error("Invalid sprite light mask sidecar");
  let active = false;
  for (let i = 0; i < view.buffer.length; i += 2) {
    const light = view.buffer[i], shadow = view.buffer[i + 1];
    if (light > 255 || shadow > 255) throw Error("Invalid sprite light mask channels");
    if (light === 255 && shadow === 255) continue;
    if (profile !== undefined && profile !== "lit") throw Error("Sprite light masks require the flat lit profile");
    const mode = commands.spriteLightingMaterials?.words[i];
    if (mode !== 1 && mode !== 2) throw Error("Sprite light masks require opaque/cutout receivers");
    active = true;
  }
  return active;
}
