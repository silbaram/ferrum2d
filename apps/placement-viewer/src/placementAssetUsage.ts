import { MAX_SCENE_BYTES, isPlacementSceneReadLimit, type PlacementSceneCatalog } from "./placementSceneCatalog";
import { resolveSceneCompositionSpec, resolveDataSceneComponentsSpec, resolveDataSceneSpatialSpec, type SceneCompositionSpec } from "@ferrum2d/ferrum-web/authoring";

export interface UsageAsset { kind: "sprite" | "model"; id: string }
export interface UsageDocument { scene: string; source: "saved" | "draft"; document: unknown }
export interface UsageSnapshot { open: UsageDocument[]; omittedScene?: string }
/** Snapshot at most 64 inputs, before clone/merge work can grow with every open tab. */
export function capturePlacementUsageDocuments(documents: Iterable<UsageDocument>): UsageSnapshot {
  const open: UsageDocument[] = [];
  for (const doc of documents) {
    if (open.length === 64) return { open, omittedScene: doc.scene };
    open.push(structuredClone(doc));
  }
  return { open };
}
export interface AssetReference {
  scene: string;
  source: "disk" | "saved" | "draft";
  pointer: string;
  owner?: string;
}
export interface AssetUsage extends UsageAsset { registered: boolean; references: AssetReference[] }
export interface UsageIssue { scene: string; pointer?: string; code: "read" | "document" | "limit" | "unresolved" }
export interface AssetUsageReport {
  label: string;
  snapshot: "hosted" | "folder" | "project";
  scanned: number;
  total: number;
  limited: boolean;
  issues: UsageIssue[];
  assets: AssetUsage[];
}
const MAX_NODES = 65_536, MAX_REFERENCES = 8192, MAX_ASSETS = 2048;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const escape = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
// Raw authored references, including inactive fragments, variants and unused definitions.
// These are evidence of a reference, not a claim that an instance is currently rendered.
const component = /^\/sceneComposition\/(?:prefabs\/[^/]*(?:\/variants\/[^/]*)?|fragments\/[^/]*\/(?:instances|include)\/\d+)\/props\/components\/(?:visual|sprite)\/(?:asset|texture|normalTexture|surface\/(?:emissionTexture|specularTexture|roughnessTexture))$/u;
const template = /^\/sceneComposition\/(?:prefabs\/[^/]*(?:\/variants\/[^/]*)?|fragments\/[^/]*\/(?:instances|include)\/\d+)\/props\/components\/template$/u;
const components = /^\/sceneComposition\/(?:prefabs\/[^/]*(?:\/variants\/[^/]*)?|fragments\/[^/]*\/(?:instances|include)\/\d+)\/props\/components$/u;
function kindAt(pointer: string): UsageAsset["kind"] | undefined {
  if (/^\/lighting\/pointLights\/\d+\/cookie\/(?:texture|textureId)$/u.test(pointer) || component.test(pointer) || /^\/spatial\/billboards\/[^/]*\/(?:normalTexture|normalTextureId)$/u.test(pointer) ||
      /^\/spatial\/terrain\/\d+\/textureId$/u.test(pointer)) return "sprite";
  if (/^\/spatial\/models\/[^/]*\/(?:asset|lods\/\d+\/asset)$/u.test(pointer)) return "model";
  return undefined;
}

/** Native/file decoders may not abort. Their late completion must not retain this scan's snapshots. */
export function awaitPlacementAssetRead<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => { cleanup(); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    pending.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}

/** Bounded, read-only evidence. No unreferenced result is permission to delete files. */
export async function collectPlacementAssetUsage(options: {
  catalog: PlacementSceneCatalog;
  assets: readonly UsageAsset[];
  open: readonly UsageDocument[];
  omittedScene?: string;
  signal?: AbortSignal;
  current(): boolean;
}): Promise<AssetUsageReport> {
  const { catalog } = options;
  const report: AssetUsageReport = {
    label: catalog.label, snapshot: catalog.hosted ? "hosted" : catalog.folderSnapshot ? "folder" : "project",
    scanned: 0, total: catalog.scenes.length, limited: catalog.truncated, issues: [], assets: [],
  };
  const assets = new Map<string, AssetUsage>();
  let references = 0, nodes = 0, bytes = 0;
  const issue = (value: UsageIssue) => {
    if (report.issues.length < 64) report.issues.push(value);
    else report.limited = true;
  };
  for (const value of options.assets) {
    if (assets.size >= MAX_ASSETS) { report.limited = true; break; }
    assets.set(value.kind + ":" + value.id, { ...value, registered: true, references: [] });
  }
  for (const diagnostic of catalog.diagnostics ?? []) issue({ scene: diagnostic.relativePath, code: "read" });
  if (catalog.truncated) issue({ scene: catalog.label, code: "limit" });
  if (options.omittedScene !== undefined) { report.limited = true; issue({ scene: options.omittedScene, code: "limit" }); }
  function scan(document: unknown, scene: string, source: AssetReference["source"]) {
    if (!record(document) || document.format !== "ferrum2d.consumer.scene-authoring" || document.version !== 1 || !record(document.sceneComposition)) {
      issue({ scene, code: "document" }); return;
    }
    const stack: { value: unknown; pointer: string; owner?: string }[] = [{ value: document, pointer: "" }];
    const seen = new WeakSet<object>();
    const componentInputs: { value: unknown; pointer: string }[] = [];
    let visited = 0, structuralLimit = false;
    const identify = (id: string, pointer: string) => {
      if (id.length <= 1024) return id;
      report.limited = true; issue({ scene, pointer, code: "limit" }); return undefined;
    };
    while (stack.length) {
      if (++visited > MAX_NODES || ++nodes > 1_048_576 || references >= MAX_REFERENCES) {
        report.limited = true; issue({ scene, code: "limit" }); return;
      }
      const { value, pointer, owner } = stack.pop()!;
      if (pointer.length > 4096) { report.limited = structuralLimit = true; issue({ scene, code: "limit" }); continue; }
      if (components.test(pointer)) componentInputs.push({ value, pointer });
      const kind = kindAt(pointer);
      if (kind) {
        if (typeof value === "string" && value.length > 0 && value.length <= 1024) {
          const key = kind + ":" + value;
          let asset = assets.get(key);
          if (!asset) {
            if (assets.size >= MAX_ASSETS) { report.limited = true; issue({ scene, code: "limit" }); continue; }
            asset = { kind, id: value, registered: false, references: [] }; assets.set(key, asset);
          }
          asset.references.push({ scene, source, pointer, ...(owner ? { owner } : {}) }); references++;
        } else if (typeof value === "string" && value.length > 1024) {
          report.limited = true; issue({ scene, pointer, code: "limit" });
        } else issue({ scene, pointer, code: "unresolved" });
      } else if (template.test(pointer)) issue({ scene, pointer, code: "unresolved" });
      if (value && typeof value === "object") {
        if (seen.has(value)) { report.limited = structuralLimit = true; issue({ scene, pointer, code: "limit" }); continue; }
        seen.add(value);
        const keys = Object.keys(value), count = Math.min(keys.length, MAX_NODES - visited - stack.length);
        if (count < keys.length) { report.limited = structuralLimit = true; issue({ scene, code: "limit" }); }
        const instanceOrSurface = /^\/sceneComposition\/fragments\/[^/]*\/instances\/\d+$/u.test(pointer) || /^\/spatial\/terrain\/\d+$/u.test(pointer);
        const target = instanceOrSurface && record(value) && typeof value.id === "string" ? identify(value.id, pointer) : owner;
        for (let index = count - 1; index >= 0; index--) {
          const key = keys[index];
          const named = pointer === "/sceneComposition/prefabs" || pointer === "/spatial/models" || pointer === "/spatial/billboards";
          stack.push({ value: Reflect.get(value, key), pointer: pointer + "/" + escape(key), owner: named ? identify(key, pointer) : target });
        }
      }
    }
    if (structuralLimit) return;
    const validate = (pointer: string, parse: () => unknown) => {
      try { parse(); } catch { issue({ scene, pointer, code: "document" }); }
    };
    // Reuse cold SDK parsers, never instantiate includes or run behavior/game logic.
    // The typed composition entry point performs its runtime validation at this boundary.
    validate("/sceneComposition", () => resolveSceneCompositionSpec(document.sceneComposition as SceneCompositionSpec));
    if (document.spatial !== undefined) validate("/spatial", () => resolveDataSceneSpatialSpec(document.spatial));
    for (const input of componentInputs) validate(input.pointer, () => resolveDataSceneComponentsSpec(input.value, { allowTemplate: true }));
  }
  for (const entry of catalog.scenes.slice(0, 256)) {
    if (!options.current()) throw new Error("Asset usage context changed");
    options.signal?.throwIfAborted();
    if (nodes > 1_048_576 || references >= MAX_REFERENCES) { report.limited = true; break; }
    if (entry.mode === "invalid") { issue({ scene: entry.relativePath, code: "document" }); continue; }
    const remaining = 32 * 1024 * 1024 - bytes;
    if (remaining < 1) { report.limited = true; issue({ scene: entry.relativePath, code: "limit" }); break; }
    // Opening a native document may register write authority. Only explicit read-only inspection is allowed.
    if (!entry.inspect) { issue({ scene: entry.relativePath, code: "read" }); continue; }
    try {
      const snapshot = await awaitPlacementAssetRead(entry.inspect(Math.min(MAX_SCENE_BYTES, remaining), options.signal), options.signal);
      if (!options.current()) throw new Error("Asset usage context changed");
      if (!snapshot || !Number.isInteger(snapshot.bytes) || snapshot.bytes < 1 || snapshot.bytes > Math.min(MAX_SCENE_BYTES, remaining))
        throw new Error("Invalid scene inspection byte count");
      bytes += snapshot.bytes;
      scan(snapshot.document, entry.relativePath, "disk"); report.scanned++;
    } catch (error) {
      if (!options.current()) throw error;
      if (options.signal?.aborted) throw error;
      if (isPlacementSceneReadLimit(error)) { report.limited = true; issue({ scene: entry.relativePath, code: "limit" }); break; }
      issue({ scene: entry.relativePath, code: "read" });
    }
  }
  if (catalog.scenes.length > 256) report.limited = true;
  for (const doc of options.open.slice(0, 64)) scan(doc.document, doc.scene, doc.source);
  if (options.open.length > 64) { report.limited = true; issue({ scene: options.open[64].scene, code: "limit" }); }
  report.assets = [...assets.values()].sort((a, b) => compare(a.kind, b.kind) || compare(a.id, b.id));
  return report;
}
