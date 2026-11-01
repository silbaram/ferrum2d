/** Discovery metadata only; opening still goes through the workspace's full document validation. */
export interface PlacementSceneEntry {
  id: string;
  source: string;
  relativePath: string;
  mode: "2d" | "hd2d" | "invalid";
  diagnostic?: string;
  read(): Promise<unknown>;
  /** Native hosts use this path to inspect without authorizing document writes. */
  inspect?(maxBytes?: number, signal?: AbortSignal): Promise<PlacementSceneRead>;
}
export interface PlacementSceneRead { document: unknown; bytes: number }
export interface PlacementSceneCatalog {
  label: string;
  scenes: PlacementSceneEntry[];
  truncated: boolean;
  folderSnapshot?: boolean;
  hosted?: boolean;
  diagnostics?: SceneScanDiagnostic[];
}
export interface SceneScanDiagnostic { relativePath: string; code: string }
export function readSceneScanDiagnostics(value: unknown): SceneScanDiagnostic[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) throw new Error("Invalid scene scan diagnostics");
  return value.map(item => {
    if (!item || typeof item.relativePath !== "string" || item.relativePath.length > 4096 || typeof item.code !== "string" || item.code.length > 64)
      throw new Error("Invalid scene scan diagnostic");
    return { relativePath: item.relativePath, code: item.code };
  });
}
export const MAX_SCENE_BYTES = 2 * 1024 * 1024;
export class PlacementSceneReadLimitError extends Error {
  constructor() { super("Document exceeds scene read budget"); this.name = "PlacementSceneReadLimitError"; }
}
export const isPlacementSceneReadLimit = (error: unknown) => error instanceof PlacementSceneReadLimitError || error === "placement scene read limit exceeded";
const FORMAT = "ferrum2d.consumer.scene-authoring";

export function safeSceneRelativePath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1024 && !/[\\\u0000-\u001f?#%:]/u.test(value) &&
    value.endsWith(".json") && value.split("/").every(part => part !== "" && part !== "." && part !== "..");
}

/** Bounded streaming protects both manifest and lazy document reads. */
export async function fetchSceneJson(url: URL, signal?: AbortSignal): Promise<unknown> {
  return (await fetchSceneRead(url, MAX_SCENE_BYTES, signal)).document;
}

/** Actual UTF-8 response bytes, including whitespace; never infer IO cost from reserialized JSON. */
export async function fetchSceneRead(url: URL, maxBytes = MAX_SCENE_BYTES, signal?: AbortSignal): Promise<PlacementSceneRead> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_SCENE_BYTES) throw new PlacementSceneReadLimitError();
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url.pathname}`);
  // Fetch exposes a decoded body; Content-Length describes the encoded transfer when compressed.
  const encoding = response.headers.get("content-encoding");
  if ((!encoding || encoding.toLowerCase() === "identity") && Number(response.headers.get("content-length")) > maxBytes) {
    try { await response.body?.cancel(); } catch { /* Cleanup cannot replace the quota diagnostic. */ }
    throw new PlacementSceneReadLimitError();
  }
  if (!response.body) throw new Error("Response body is unavailable");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new PlacementSceneReadLimitError();
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); } catch { /* Preserve the original read/quota failure. */ }
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { document: JSON.parse(new TextDecoder().decode(bytes)) as unknown, bytes: size };
}

export async function hostedSceneCatalog(base: URL, signal?: AbortSignal): Promise<PlacementSceneCatalog> {
  const value = await fetchSceneJson(new URL("placement-scenes.json", base), signal) as {
    version?: unknown; scenes?: unknown; truncated?: unknown; diagnostics?: unknown;
  };
  if (value?.version !== 1 || !Array.isArray(value.scenes) || value.scenes.length > 256)
    throw new Error("Invalid scene catalog");
  const seen = new Set<string>();
  const scenes = value.scenes.map((entry: unknown): PlacementSceneEntry => {
    const item = entry as Record<string, unknown>;
    if (!item || !safeSceneRelativePath(item.relativePath) || !["2d", "hd2d", "invalid"].includes(String(item.mode)) || seen.has(item.relativePath))
      throw new Error("Invalid scene catalog entry");
    seen.add(item.relativePath);
    const url = new URL(item.relativePath.split("/").map(encodeURIComponent).join("/"), base);
    return {
      id: url.href, source: url.href, relativePath: item.relativePath,
      mode: item.mode as PlacementSceneEntry["mode"],
      diagnostic: typeof item.diagnostic === "string" ? item.diagnostic.slice(0, 1024) : undefined,
      read: () => fetchSceneJson(url),
      inspect: (maxBytes, signal) => fetchSceneRead(url, maxBytes, signal),
    };
  });
  return { label: base.pathname, scenes, truncated: value.truncated === true, hosted: true, diagnostics: readSceneScanDiagnostics(value.diagnostics) };
}

/** Files are snapshots selected by the user. No host paths or write authority are inferred. */
export async function folderSceneCatalog(files: readonly File[], selection: string): Promise<PlacementSceneCatalog> {
  const scenes: PlacementSceneEntry[] = [];
  let candidates = 0, bytes = 0, truncated = files.length > 4096;
  const paths = files.slice(0, 4096).map(file => ({ file, path: file.webkitRelativePath || file.name }))
    .filter(({ path }) => {
      if (!path.endsWith(".json") || path.split("/").some(part => part.startsWith(".") || ["assets", "node_modules", "dist", "target"].includes(part))) return false;
      if (!safeSceneRelativePath(path) || path.split("/").length > 10) { truncated = true; return false; }
      return true;
    })
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
  for (const { file, path } of paths) {
    if (++candidates > 512 || scenes.length >= 256 || bytes >= 32 * 1024 * 1024) { truncated = true; break; }
    const known = /(?:^|\.)scene-authoring\.json$/u.test(path.split("/").pop()!);
    let mode: PlacementSceneEntry["mode"] = "invalid", diagnostic: string | undefined, recognized = false;
    try {
      if (file.size > MAX_SCENE_BYTES || bytes + file.size > 32 * 1024 * 1024) {
        truncated = true; throw new Error("Document exceeds catalog read budget");
      }
      bytes += file.size;
      const value = JSON.parse(await file.text());
      recognized = value?.format === FORMAT;
      if (value?.format !== FORMAT) { if (!known) continue; throw new Error("Not a Scene Authoring document"); }
      if (value.version !== 1) throw new Error("Unsupported Scene Authoring version");
      mode = value.spatial ? "hd2d" : "2d";
    } catch (error) {
      if (!known && !recognized) continue;
      diagnostic = error instanceof Error ? error.message : String(error);
    }
    scenes.push({
      id: `folder:${selection}:${path}`, source: path, relativePath: path, mode, diagnostic,
      read: async () => JSON.parse(await file.text()) as unknown,
      inspect: async (maxBytes = MAX_SCENE_BYTES) => {
        if (file.size > maxBytes) throw new PlacementSceneReadLimitError();
        return { document: JSON.parse(await file.text()) as unknown, bytes: file.size };
      },
    });
  }
  return { label: files[0]?.webkitRelativePath.split("/")[0] || "Selected folder", scenes, truncated, folderSnapshot: true };
}
