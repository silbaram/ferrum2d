import type { SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
/** Visit authored references, including inherited/unused prefabs, without scanning arbitrary gameplay payloads. */
export function visitNormalReferences(document: SceneAuthoringDocumentSpec, visit: (owner: Record<string, unknown>, key: string) => void) {
  function props(value: unknown) {
    const components = record(record(value)?.components);
    for (const candidate of [components?.visual, components?.sprite]) {
      const sprite = record(candidate);
      if (sprite && sprite.normalTexture !== undefined) visit(sprite, "normalTexture");
    }
  }
  // Opening a document checks asset scope before schema validation. Ignore invalid
  // containers here so the validator can report the original document path.
  const root = record(document), composition = record(root?.sceneComposition);
  for (const value of Object.values(record(composition?.prefabs) ?? {})) {
    const prefab = record(value);
    props(prefab?.props);
    for (const variant of Object.values(record(prefab?.variants) ?? {})) props(record(variant)?.props);
  }
  for (const value of Object.values(record(composition?.fragments) ?? {})) {
    const fragment = record(value);
    for (const key of ["instances", "include"]) {
      const entries = fragment?.[key];
      if (Array.isArray(entries)) for (const entry of entries) props(record(entry)?.props);
    }
  }
  for (const value of Object.values(record(record(root?.spatial)?.billboards) ?? {})) {
    const billboard = record(value);
    for (const key of ["normalTexture", "normalTextureId"])
      if (billboard?.[key] !== undefined) visit(billboard, key);
  }
}
export function normalReferences(document: SceneAuthoringDocumentSpec) {
  const references = new Set<unknown>();
  visitNormalReferences(document, (owner, key) => references.add(owner[key]));
  return references;
}
export function referencesNormal(references: ReadonlySet<unknown>, id: string, textureId: (name: string) => number) {
  if (references.has(id)) return true;
  if (![...references].some(value => typeof value === "number")) return false;
  try { return references.has(textureId(id)); } catch { return false; }
}
