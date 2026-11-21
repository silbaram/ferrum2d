import { resolveDataSceneComponentsSpec, type DataSceneComponentsSpec } from "./dataSceneComponents.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { DataSceneRuntimeComponentTemplates, DataSceneRuntimeComponentTemplateCatalog } from "./dataSceneRuntimeTarget.js";

const snapshots = new WeakMap<object, { source: unknown; local?: DataSceneRuntimeComponentTemplateCatalog; cached: Map<string, DataSceneComponentsSpec | undefined> }>();
const documentCatalogs = new WeakMap<object, DataSceneRuntimeComponentTemplates>();
// Valid component specs are much shallower; bound JSON inspection before recursive parser/clone work.
const MAX_COMPONENT_TEMPLATE_JSON_DEPTH = 32;
const fields = new Set(["visual", "sprite", "collider", "layer", "body"]);

/** Cold, detached JSON catalog. Local declarations are strict inline specs, including unused entries. */
export function snapshotDataSceneComponentTemplates(local: unknown, external: DataSceneRuntimeComponentTemplates | undefined, path: string): {
  local?: DataSceneRuntimeComponentTemplateCatalog;
  templates?: DataSceneRuntimeComponentTemplates;
} {
  if (typeof external === "function") {
    const previous = snapshots.get(external);
    if (previous && (local === previous.source || local === previous.local))
      return { ...(previous.local === undefined ? {} : { local: previous.local }), templates: external };
  }
  let catalog: Record<string, DataSceneComponentsSpec> | undefined;
  if (local !== undefined) {
    if (!local || typeof local !== "object" || Array.isArray(local))
      throw sceneCompositionDiagnosticError(path, "must be a map of inline component specs");
    catalog = {};
    for (const [name, value] of Object.entries(local)) {
      const location = `${path}.${name}`;
      if (!name.trim()) throw sceneCompositionDiagnosticError(location, "template name must not be empty");
      assertJson(value, location, new WeakSet());
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw sceneCompositionDiagnosticError(location, "must be an inline component spec");
      for (const key of Object.keys(value)) if (!fields.has(key))
        throw sceneCompositionDiagnosticError(`${location}.${key}`, "is not an inline component field");
      const copy = structuredClone(value) as DataSceneComponentsSpec;
      resolveDataSceneComponentsSpec(copy, { allowTemplate: false, path: location });
      Object.defineProperty(catalog, name, { value: copy, enumerable: true });
    }
  }
  if (catalog === undefined && external === undefined) return {};
  // Already detached apply-time snapshots are shared through resolver/preflight/spawn.
  if (typeof external === "function" && snapshots.has(external)) return { ...(catalog === undefined ? {} : { local: catalog }), templates: external };
  const cached = new Map<string, DataSceneComponentsSpec | undefined>();
  const templates = (name: string): DataSceneComponentsSpec | undefined => {
    if (!cached.has(name)) {
      const provided = typeof external === "function" ? external(name)
        : external && Object.prototype.hasOwnProperty.call(external, name) ? external[name] : undefined;
      const value = provided === undefined ? (catalog && Object.prototype.hasOwnProperty.call(catalog, name) ? catalog[name] : undefined) : provided;
      const copy = provided === undefined ? value : structuredClone(value);
      if (copy !== undefined) resolveDataSceneComponentsSpec(copy, { allowTemplate: false, path: `${path}.${name}` });
      cached.set(name, copy);
    }
    return cached.get(name);
  };
  snapshots.set(templates, { source: local, local: catalog, cached });
  return { ...(catalog === undefined ? {} : { local: catalog }), templates };
}

export function registerSceneAuthoringComponentTemplates(document: object, templates: DataSceneRuntimeComponentTemplates | undefined): void {
  if (templates !== undefined) documentCatalogs.set(document, templates);
}
export function resolvedSceneAuthoringComponentTemplates(document: object): DataSceneRuntimeComponentTemplates | undefined {
  return documentCatalogs.get(document);
}

function assertJson(value: unknown, path: string, seen: WeakSet<object>, depth = 0): void {
  if (depth > MAX_COMPONENT_TEMPLATE_JSON_DEPTH)
    throw sceneCompositionDiagnosticError(path, `JSON nesting must not exceed ${MAX_COMPONENT_TEMPLATE_JSON_DEPTH}`);
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return;
  if (!value || typeof value !== "object" || seen.has(value) || !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw sceneCompositionDiagnosticError(path, "must contain finite JSON data");
  seen.add(value);
  for (const [key, child] of Object.entries(value)) assertJson(child, `${path}.${key}`, seen, depth + 1);
  seen.delete(value);
}

/** @internal Success-time projection of the SDK snapshot's already evaluated
 * entries. Never calls an external template provider or resolves new names. */
export function fileMaterializedComponentTemplates(document: object): Readonly<Record<string, DataSceneComponentsSpec>> {
  const templates = documentCatalogs.get(document), state = typeof templates === "function" ? snapshots.get(templates) : undefined;
  const result: Record<string, DataSceneComponentsSpec> = Object.create(null);
  if (state) for (const [name, value] of state.cached) if (value !== undefined)
    result[name] = structuredClone(value);
  return result;
}
