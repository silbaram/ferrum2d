import type { LightingScene2D, ResolvedLightingScene2D } from "./lightingTypes.js";
import type { SpriteLightingMaterialSpec } from "./spriteLighting.js";
import { validateSpriteLighting, resolveSpriteLightingMaterial } from "./spriteLighting.js";
import type { RenderCommandBufferView } from "./renderCommandDecoder.js";
import type { ResolvedSpriteMaterialPreset } from "./spriteMaterial.js";
import { SPRITE_NORMAL_NONE } from "./spriteNormals.js";

export interface FlatLightingAsset {
  textureId: number; normalTextureId?: number; lighting: SpriteLightingMaterialSpec;
}
/** Cold renderer capability and asset check, performed before replacing an authored scene. */
export interface FlatLightingPreparer {
  prepareFlatLighting(scene: LightingScene2D, assets: readonly FlatLightingAsset[]): void;
}
export interface FlatLitTextureSource {
  textureInfo?(id: number): { width: number; height: number; colorSpace: "srgb" | "linear" | "none"; alphaMode?: "straight" | "premultiplied" } | undefined;
}
export function validateFlatLitMaterial(material: ResolvedSpriteMaterialPreset): void {
  if (material.blendMode !== "alpha" || material.colorMix || material.outline || material.paletteSwap)
    throw Error("The lit profile currently requires the base alpha sprite material; use explicit unlit receivers for HUD");
}
export function validateFlatLitAsset(source: FlatLitTextureSource, asset: FlatLightingAsset): void {
  const lighting = resolveSpriteLightingMaterial(asset.lighting, "sprite.lighting"); if (lighting.mode === "unlit") return;
  validateFlatLitTextureIds(source, asset.textureId, asset.normalTextureId);
}
function validateFlatLitTextureIds(source: FlatLitTextureSource, textureId: number, normalTextureId?: number): void {
  const color = source.textureInfo?.(textureId);
  if (!color || color.alphaMode !== "straight") throw Error("Lit receiver textures require known straight-alpha data; load with alphaMode: straight");
  if (normalTextureId !== undefined && normalTextureId !== SPRITE_NORMAL_NONE) {
    const normal = source.textureInfo?.(normalTextureId);
    if (!normal || normal.colorSpace === "srgb" || normal.width !== color.width || normal.height !== color.height)
      throw Error("Lit receiver normals require a same-size linear/data texture");
  }
}
/** Validate before any render target is bound/cleared. No game-state inference from texture IDs. */
export function validateFlatLitCommands(commands: RenderCommandBufferView, scene: ResolvedLightingScene2D, source: FlatLitTextureSource, material: ResolvedSpriteMaterialPreset): boolean {
  const active = validateSpriteLighting(commands);
  if (scene.profile !== "lit") return false;
  if (commands.spatial) throw Error("The flat lit profile cannot render a Spatial scene");
  validateFlatLitMaterial(material);
  if (!active) return false;
  if (commands.floatsPerCommand !== 15 || commands.buffer.length < commands.commandCount * 15) throw Error("Lit receivers require the 15-float command layout");
  const view = commands.spriteLightingMaterials!;
  for (let i = 0; i < commands.commandCount; i++) {
    const mode = view.words[i * 2]!; if (mode === 0) continue;
    const offset = i * 15, flags = commands.buffer[offset + 13]!;
    for (let k = 0; k < 15; k++) if (!Number.isFinite(commands.buffer[offset + k])) throw Error("Nonfinite lit sprite command");
    if (!Number.isInteger(flags) || flags < 0 || (flags & 56) !== 0) throw Error("Lit receivers currently require sprite commands, not primitives or shadow commands");
    for (let k = 8; k <= 11; k++) if (commands.buffer[offset + k]! < 0 || commands.buffer[offset + k]! > 1) throw Error("Lit sprite tint must be in 0..1");
    validateFlatLitTextureIds(source, Math.trunc(commands.buffer[offset + 12]!), commands.spriteNormalMaterials?.buffer[i * 2]);
  }
  return true;
}
