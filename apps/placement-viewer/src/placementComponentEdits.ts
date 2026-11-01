import {
  instantiateSceneFragment,
  resolveSceneAuthoringDocument,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementViewer,
} from "@ferrum2d/ferrum-web/authoring";

type Json = Parameters<ScenePlacementViewer["updateInstanceComponents"]>[1];
type Components = { [key: string]: Json };
const record = (value: unknown): value is Components =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Resolve only at an explicit action or gesture start, never on pointer frames. */
export function readPlacementAuthoredComponents(
  document: SceneAuthoringDocumentSpec,
  fragment: string,
  id: string,
): Components | undefined {
  const resolved = resolveSceneAuthoringDocument(document, { missingBehavior: "ignore" });
  const instances = resolved.bindingPlan?.fragment === fragment
    ? resolved.bindingPlan.instances
    : instantiateSceneFragment(resolved.sceneComposition, { fragment });
  const value = instances.find(instance => instance.id === id)?.props.components;
  return record(value) ? structuredClone(value) : undefined;
}

// These fields are represented by the existing component controls/serializers.
// Copying only their output used to discard normal maps, animation sets, shadows,
// projection and dynamic-body settings that have no control in this inspector.
const visualFields = [
  "kind", "shape", "asset", "texture", "width", "height", "radius", "frame",
  "animation", "originX", "originY", "layer", "sortOrder", "depthSort", "tint", "color",
];

export function preservePlacementComponentMetadata(
  authored: Components | undefined,
  edit: Json,
): Json {
  if (!authored || !record(edit)) return structuredClone(edit);
  const result = { ...structuredClone(authored), ...structuredClone(edit) };
  if (record(edit.visual)) {
    const original = record(authored.visual) ? authored.visual : authored.sprite;
    const oldKind = record(authored.visual) ? authored.visual.kind : "sprite";
    const metadata: Components = record(original) && oldKind === edit.visual.kind
      ? structuredClone(original) : {};
    for (const key of visualFields) delete metadata[key];
    // Shape changes still retain shared projection/shadow authoring.
    if (record(original)) {
      for (const key of ["projection", "shadow"]) {
        if (Object.hasOwn(original, key)) metadata[key] = structuredClone(original[key]!);
      }
    }
    result.visual = { ...metadata, ...structuredClone(edit.visual) };
    delete result.sprite;
  }
  if (record(authored.collider) && record(edit.collider) && authored.collider.type === edit.collider.type) {
    result.collider = { ...structuredClone(authored.collider), ...structuredClone(edit.collider) };
  }
  // These editors do not edit a body. Keep omission and optional fields exact.
  if (Object.hasOwn(authored, "body")) result.body = structuredClone(authored.body!);
  else delete result.body;
  return result;
}
