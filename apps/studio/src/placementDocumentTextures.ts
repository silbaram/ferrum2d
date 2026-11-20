import type { SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";

export interface PlacementDocumentTextureReference {
  texture: string | number;
  path: string;
  role: "color" | "data";
  normal?: boolean;
}
const escape = (name: string) => name.replace(/~/g, "~0").replace(/\//g, "~1");
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Original JSON pointers for catalog-owned and tile visuals, including inactive local entries. */
export function placementDocumentTextures(document: SceneAuthoringDocumentSpec): PlacementDocumentTextureReference[] {
  const refs: PlacementDocumentTextureReference[] = [];
  function add(texture: unknown, path: string, role: "color" | "data", normal = false) {
    if (typeof texture === "string" || typeof texture === "number") refs.push({ texture, path, role, ...(normal ? { normal: true } : {}) });
  }
  for (const [name, component] of Object.entries(document.componentTemplates ?? {})) {
    const key = component.visual === undefined ? "sprite" : "visual";
    const visual: unknown = component[key];
    if (!record(visual)) continue;
    const path = `/componentTemplates/${escape(name)}/${key}`;
    for (const field of ["asset", "texture"]) add(visual[field], `${path}/${field}`, "color");
    add(visual.normalTexture, `${path}/normalTexture`, "data", true);
    if (record(visual.surface)) {
      for (const field of ["emissionTexture", "specularTexture", "roughnessTexture"]) {
        add(visual.surface[field], `${path}/surface/${field}`, field === "emissionTexture" ? "color" : "data");
      }
    }
  }
  for (const [index, definition] of (document.physics?.collisionTilemap?.definitions ?? []).entries()) {
    add(definition.visual?.texture, `/physics/collisionTilemap/definitions/${index}/visual/texture`, "color");
  }
  return refs;
}
