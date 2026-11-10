import {validateSpriteLightMasks} from "./spriteLightMasks.js";
import type { LightingScene2D, ResolvedLightingScene2D } from "./lightingTypes.js";
import type { SpriteLightingMaterialSpec } from "./spriteLighting.js";
import { validateSpriteLighting, resolveSpriteLightingMaterial } from "./spriteLighting.js";
import type { RenderCommandBufferView } from "./renderCommandDecoder.js";
import type { ResolvedSpriteMaterialPreset } from "./spriteMaterial.js";
import { SPRITE_NORMAL_NONE } from "./spriteNormals.js";
import { flatHdrOptions } from "./flatHdr.js";
import { resolveSpriteSurfaceMaterial,validateSpriteSurface,SPRITE_SURFACE_TEXTURE_NONE,type SpriteSurfaceMaterialSpec } from "./spriteSurface.js";

export interface FlatLightingAsset {
  textureId: number; normalTextureId?: number; lighting: SpriteLightingMaterialSpec;surface?:SpriteSurfaceMaterialSpec;
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
export function validateFlatLitAsset(source: FlatLitTextureSource, asset: FlatLightingAsset, hdr = false): void {
  const lighting = resolveSpriteLightingMaterial(asset.lighting, "sprite.lighting");
  if(asset.surface!==undefined&&lighting.mode==="unlit")throw Error("Sprite surfaces require opaque/cutout receivers");
  if (lighting.mode === "unlit" && !hdr) return;
  validateFlatLitTextureIds(source, asset.textureId, lighting.mode === "unlit" ? undefined : asset.normalTextureId);
  if(asset.surface!==undefined){
    const surface=resolveSpriteSurfaceMaterial(asset.surface,"sprite.surface");
    validateFlatSurfaceTextures(source,asset.textureId,surface.emissionTextureId,surface.specularTextureId,surface.roughnessTextureId);
  }
}
function validateFlatSurfaceTextures(source:FlatLitTextureSource,colorId:number,emission?:number,specular?:number,roughness?:number):void{
  const color=source.textureInfo?.(colorId);
  validateFlatSurfaceMap(source,color,emission,false);validateFlatSurfaceMap(source,color,specular,true);validateFlatSurfaceMap(source,color,roughness,true);
}
function validateFlatSurfaceMap(source:FlatLitTextureSource,color:{width:number;height:number}|undefined,id:number|undefined,data:boolean):void{
  if(id===undefined||id===SPRITE_SURFACE_TEXTURE_NONE)return;
  const texture=source.textureInfo?.(id);
  if(!color||!texture||texture.width!==color.width||texture.height!==color.height||texture.alphaMode!=="straight"||data&&texture.colorSpace==="srgb")throw Error("Surface maps require same-size straight-alpha color/data textures");
}
function validateFlatLitTextureIds(source: FlatLitTextureSource, textureId: number, normalTextureId?: number): void {
  const color = source.textureInfo?.(textureId);
  if (!color || color.alphaMode !== "straight") throw Error("Lit receivers and HDR world textures require known straight-alpha data; load with alphaMode: straight");
  if (normalTextureId !== undefined && normalTextureId !== SPRITE_NORMAL_NONE) {
    const normal = source.textureInfo?.(normalTextureId);
    if (!normal || normal.colorSpace === "srgb" || normal.width !== color.width || normal.height !== color.height)
      throw Error("Lit receiver normals require a same-size linear/data texture");
  }
}
/** Validate before any render target is bound/cleared. No game-state inference from texture IDs. */
export function validateFlatLitCommands(commands: RenderCommandBufferView, scene: ResolvedLightingScene2D, source: FlatLitTextureSource, material: ResolvedSpriteMaterialPreset,surfaceState?:{active:boolean;masksActive?:boolean}): boolean {
  const active = validateSpriteLighting(commands);
  const masks=validateSpriteLightMasks(commands,scene.profile??"legacy");if(surfaceState)surfaceState.masksActive=masks;
  const surface=validateSpriteSurface(commands,scene.profile??"legacy");if(surfaceState)surfaceState.active=surface;
  if (scene.profile !== "lit") return false;
  if (commands.spatial) throw Error("The flat lit profile cannot render a Spatial scene");
  validateFlatLitMaterial(material);
  const hdr = flatHdrOptions(scene) !== undefined;
  if (!active && !hdr) return false;
  if (commands.floatsPerCommand !== 15 || commands.buffer.length < commands.commandCount * 15) throw Error("Lit receivers require the 15-float command layout");
  const view = commands.spriteLightingMaterials;
  for (let i = 0; i < commands.commandCount; i++) {
    const mode = view?.words[i * 2] ?? 0; if (mode === 0 && !hdr) continue;
    const offset = i * 15, flags = commands.buffer[offset + 13]!;
    for (let k = 0; k < 15; k++) if (!Number.isFinite(commands.buffer[offset + k])) throw Error("Nonfinite lit sprite command");
    if (!Number.isInteger(flags) || flags < 0 || mode !== 0 && (flags & 56) !== 0) throw Error("Lit receivers currently require sprite commands, not primitives or shadow commands");
    for (let k = 8; k <= 11; k++) if (commands.buffer[offset + k]! < 0 || commands.buffer[offset + k]! > 1) throw Error("Lit sprite tint must be in 0..1");
    if (mode !== 0 || (flags & 56) === 0) validateFlatLitTextureIds(source, Math.trunc(commands.buffer[offset + 12]!), mode === 0 ? undefined : commands.spriteNormalMaterials?.buffer[i * 2]);
    const surface=commands.spriteSurfaceMaterials;
    if(surface?.words[i*10+3]===1)validateFlatSurfaceTextures(source,Math.trunc(commands.buffer[offset+12]),surface.words[i*10],surface.words[i*10+1],surface.words[i*10+2]);
  }
  return active;
}
