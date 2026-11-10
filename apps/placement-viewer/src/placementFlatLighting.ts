import {
  resolveDataSceneInstanceComponents,
  resolveSceneAuthoringDocument,
  type SceneAuthoringDocumentSpec,
} from "@ferrum2d/ferrum-web/authoring";
import type { TextureLoadOptions } from "@ferrum2d/ferrum-web/core";

type Role = "color" | "data";
type Roles = ReadonlyMap<string | number, Role>;

/** Cold asset roles come from authored references, never file-name guesses. */
export function placementFlatTextureRoles(documents: readonly SceneAuthoringDocumentSpec[]): Roles {
  const roles = new Map<string | number, Role>();
  function add(ref: { value: string | number } | undefined, role: Role) {
    if (!ref) return;
    const previous = roles.get(ref.value);
    if (previous && previous !== role)
      throw Error(`Texture '${ref.value}' is used as both color and lighting data. Use separate asset IDs.`);
    roles.set(ref.value, role);
  }
  for (const document of documents) {
    // Legacy documents may retain an inactive normal binding (including an
    // albedo alias). Do not reinterpret it until a lighting pass uses normals.
    const normalsActive = !!document.spatial || document.lighting?.profile === "lit"
      || document.lighting !== undefined && document.lighting.enabled !== false;
    const resolved = resolveSceneAuthoringDocument(document, { validateBindings: true, validateComponents: true, missingBehavior: "ignore" });
    for (const instance of resolved.bindingPlan?.instances ?? []) {
      const component = resolveDataSceneInstanceComponents(instance);
      if (component.mode !== "inline") continue;
      const sprite = component.sprite;
      add(sprite.texture, "color");
      if (normalsActive) add(sprite.normalTexture, "data");
      add(sprite.surface?.emissionTexture, "color");
      add(sprite.surface?.specularTexture, "data");
      add(sprite.surface?.roughnessTexture, "data");
    }
    for (const surface of document.spatial?.terrain ?? [])
      if (surface.render !== false && surface.textureId !== undefined) add({ value: surface.textureId }, "color");
    for (const billboard of Object.values(document.spatial?.billboards ?? {})) {
      if (billboard.normalTexture !== undefined) add({ value: billboard.normalTexture }, "data");
      if (billboard.normalTextureId !== undefined) add({ value: billboard.normalTextureId }, "data");
    }
  }
  return roles;
}

/** The viewer consistently uploads straight alpha, including legacy previews. */
export function placementFlatTextureOptions(
  names: readonly string[], roles: Roles, signal?: AbortSignal,
  textureId?: (name: string) => number,
): Record<string, TextureLoadOptions> {
  return Object.fromEntries(names.map(name => {
    const named = roles.get(name), numeric = textureId ? roles.get(textureId(name)) : undefined;
    if (named && numeric && named !== numeric)
      throw Error(`Texture '${name}' has conflicting named/numeric lighting roles. Use separate asset IDs.`);
    return [name, { alphaMode: "straight", colorSpace: (named ?? numeric) === "data" ? "none" : "srgb", ...(signal ? { signal } : {}) }];
  }));
}
