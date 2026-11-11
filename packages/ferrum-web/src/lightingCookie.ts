import type { LightingScene2D, PointLightCookie2D, ResolvedLightingScene2D, ResolvedPointLightCookie2D } from "./lightingTypes.js";

export function resolvePointLightCookie(value: PointLightCookie2D, path: string, target?: ResolvedPointLightCookie2D): ResolvedPointLightCookie2D {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["texture", "textureId", "rotationRadians", "uv"].includes(key)))
    throw Error(`${path} must contain texture or textureId, optional rotationRadians and uv`);
  if ((value.texture === undefined) === (value.textureId === undefined)) throw Error(`${path} requires exactly one of texture or textureId`);
  const texture = value.texture ?? value.textureId;
  if (typeof texture === "string" ? !texture.length || texture.length > 256 || texture.trim() !== texture : !Number.isInteger(texture) || texture! < 0 || texture! > 16777214)
    throw Error(`${path}.texture must be an asset name or integer ID in 0..16777214`);
  const rotation = value.rotationRadians === undefined ? 0 : value.rotationRadians, uv = value.uv === undefined ? [0, 0, 1, 1] : value.uv;
  if (typeof rotation !== "number" || !Number.isFinite(rotation) || Math.abs(rotation) > 1e6) throw Error(`${path}.rotationRadians must be finite in -1e6..1e6`);
  if (!Array.isArray(uv) || uv.length !== 4 || ![uv[0], uv[1], uv[2], uv[3]].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1) || Math.fround(uv[0]) === Math.fround(uv[2]) || Math.fround(uv[1]) === Math.fround(uv[3]))
    throw Error(`${path}.uv must be a nondegenerate rectangle in 0..1`);
  const out = target ?? { texture: 0, rotationRadians: 0, uv: [0, 0, 1, 1] };
  out.texture = texture!; out.rotationRadians = rotation;
  for (let i = 0; i < 4; i++) out.uv[i] = Math.fround(uv[i]);
  return out;
}

export function pointLightCookieTextureId(cookie: ResolvedPointLightCookie2D): number {
  if (typeof cookie.texture !== "number") throw Error("Named cookie references require view.lighting() or a resolved numeric textureId");
  return cookie.texture;
}

/** Cold/static asset mapping, retaining authored names in the source document. */
export function resolveLightingCookieReferences(scene: LightingScene2D, textureId: (name: string) => number): LightingScene2D {
  if (!scene.pointLights?.some(light => light.cookie !== undefined)) return scene;
  return { ...scene, pointLights: scene.pointLights.map((light, i) => {
    if (light.cookie === undefined) return light;
    const cookie = resolvePointLightCookie(light.cookie, `lighting.pointLights[${i}].cookie`);
    if (typeof cookie.texture === "string") cookie.texture = textureId(cookie.texture);
    // Validate resolver results too; an unresolved/missing asset cannot become a fallback ID.
    return { ...light, cookie: resolvePointLightCookie(cookie, `lighting.pointLights[${i}].cookie`) };
  }) };
}

export interface LightingCookieTextureSource {
  textureInfo?(id: number): { colorSpace: "srgb" | "linear" | "none"; alphaMode?: "straight" | "premultiplied"; width: number; height: number } | undefined;
}
/** Includes OFF declarations; call before setter swap, scene replacement or framebuffer work. */
export function validateLightingCookies(scene: ResolvedLightingScene2D, source: LightingCookieTextureSource): void {
  for (const light of scene.pointLights) if (light.cookie) {
    const id = pointLightCookieTextureId(light.cookie), texture = source.textureInfo?.(id);
    if (!texture || texture.colorSpace === "srgb" || texture.alphaMode !== "straight") throw Error(`Cookie texture ${id} requires a loaded straight-alpha linear/data image`);
  }
}
