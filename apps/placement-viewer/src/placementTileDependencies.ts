/** Explicit local file bindings only. Source paths are never read from disk or fetched. */
export interface PlacementTileDependency {
  source: string;
  name: string;
  json: ArrayBuffer;
  sha256: string;
}
type RawDependency = Pick<PlacementTileDependency, "name" | "json">;
function fail(message: string): never {
  throw Error("Tile import: " + message);
}
export function tileJson(bytes: ArrayBuffer): Record<string, unknown> {
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, ""),
  );
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("expected a JSON object");
  return value as Record<string, unknown>;
}
export function tileDependencySource(source: unknown): string {
  if (
    typeof source !== "string" ||
    !source.length ||
    new TextEncoder().encode(source).byteLength > 1024 ||
    source.startsWith("/") ||
    /[\\:?#%\x00-\x1f\x7f-\x9f]/u.test(source) ||
    source.split("/").some((part) => !part.length) ||
    !source.toLowerCase().endsWith(".tsj")
  )
    fail(
      "external tileset source requires a relative .tsj path; TSX is unsupported",
    );
  return source;
}
export function resolveTileDependencies(
  root: Record<string, unknown>,
  kind: "tiled" | "ldtk",
  files: readonly RawDependency[],
) {
  if (files.length > 8) fail("external TSJ budget exceeds 8");
  const byName = new Map<string, RawDependency>();
  for (const file of files) {
    if (
      !file.name.length ||
      new TextEncoder().encode(file.name).byteLength > 256 ||
      /[\\/\x00-\x1f\x7f-\x9f]/u.test(file.name) ||
      byName.has(file.name)
    )
      fail("duplicate or invalid TSJ filename");
    byName.set(file.name, file);
  }
  const dependencies: (RawDependency & { source: string })[] = [];
  if (kind === "ldtk") {
    if (files.length) fail("external TSJ files require a Tiled map");
    return { input: root, dependencies };
  }
  if (
    !Array.isArray(root.tilesets) ||
    !root.tilesets.length ||
    root.tilesets.length > 8
  )
    fail("choose a document with 1..8 tilesets");
  const sources = new Set<string>(),
    names = new Set<string>();
  const tilesets = root.tilesets.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      fail("invalid tileset entry");
    const set = entry as Record<string, unknown>;
    if (set.source === undefined) return set;
    const source = tileDependencySource(set.source),
      name = source.split("/").at(-1)!;
    if (sources.has(source) || names.has(name))
      fail("duplicate or ambiguous TSJ source paths");
    sources.add(source);
    names.add(name);
    const file = byName.get(name);
    if (!file)
      fail(`missing external TSJ: ${source}; choose the matching filename`);
    const raw = tileJson(file.json);
    if (
      raw.source !== undefined ||
      raw.type === "map" ||
      raw.tilesets !== undefined
    )
      fail("nested external tilesets or map JSON are unsupported as TSJ");
    dependencies.push({ ...file, source });
    return { ...raw, firstgid: set.firstgid };
  });
  if (dependencies.length !== files.length)
    fail("TSJ filename differs from map source or an unused file was selected");
  dependencies.sort((a, b) =>
    a.source < b.source ? -1 : a.source > b.source ? 1 : 0,
  );
  return { input: { ...root, tilesets }, dependencies };
}
export async function readTileDependencies(
  map: File,
  files: readonly File[],
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (
    files.length > 8 ||
    map.size + files.reduce((n, f) => n + f.size, 0) > 1_048_576
  )
    fail("map + TSJ JSON byte budget exceeds 1 MiB");
  const json = await map.arrayBuffer();
  const dependencies: RawDependency[] = [];
  for (const file of files) {
    signal.throwIfAborted();
    dependencies.push({ name: file.name, json: await file.arrayBuffer() });
  }
  signal.throwIfAborted();
  if (
    json.byteLength + dependencies.reduce((n, f) => n + f.json.byteLength, 0) >
    1_048_576
  )
    fail("map + TSJ JSON byte budget exceeds 1 MiB");
  return { json, dependencies };
}
