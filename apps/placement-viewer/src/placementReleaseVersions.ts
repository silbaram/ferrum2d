export const UPDATE_REPOSITORY = "silbaram/ferrum2d";
export interface UpdateRelease { version: string; tag: string; pageUrl: string; assets: string[] }
export function compareUpdateVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/u.exec(value);
    if (!match || match.slice(1).some(part => part !== undefined && !Number.isSafeInteger(Number(part)))) throw Error("Unsupported version");
    return match.slice(1).map((part, index) => part === undefined && index === 3 ? Infinity : Number(part));
  };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
export function updateReleases(value: unknown): UpdateRelease[] {
  if (!Array.isArray(value) || value.length > 100) throw Error("Invalid release list");
  return value.flatMap(row => {
    if (!row || row.draft !== false || typeof row.tag_name !== "string" || !/^ferrum-web-v\d+\.\d+\.\d+-beta\.\d+$/u.test(row.tag_name) || !Array.isArray(row.assets)) return [];
    const version = row.tag_name.slice("ferrum-web-v".length);
    try { compareUpdateVersions(version, version); } catch { return []; }
    return [{ version, tag: row.tag_name, pageUrl: `https://github.com/${UPDATE_REPOSITORY}/releases/tag/${row.tag_name}`, assets: row.assets.filter((asset: { name?: unknown; state?: unknown }) => asset?.state === "uploaded" && typeof asset.name === "string").map((asset: { name: string }) => asset.name) }];
  }).sort((a, b) => compareUpdateVersions(b.version, a.version));
}
export async function fetchUpdateReleases(signal: AbortSignal): Promise<UpdateRelease[]> {
  let all: UpdateRelease[] = [];
  for (let page = 1; page <= 5; page++) {
    const response = await fetch(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=100&page=${page}`, { signal, headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (!response.ok) throw Error(`Version check failed: HTTP ${response.status}`);
    if (!response.body || Number(response.headers.get("content-length")) > 2 * 1024 * 1024) throw Error("Release list is too large");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength; if (bytes > 2 * 1024 * 1024) throw Error("Release list is too large"); chunks.push(value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    const data = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    const value: unknown = JSON.parse(new TextDecoder().decode(data));
    const rows = updateReleases(value); all = all.concat(rows);
    if ((value as unknown[]).length < 100) break;
  }
  return all.sort((a, b) => compareUpdateVersions(b.version, a.version));
}
export function safeReleasePage(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/tag\/ferrum-web-v\d+\.\d+\.\d+-beta\.\d+$/u.test(url.pathname) || url.username || url.password || url.search || url.hash) throw Error("Invalid release link");
  return url.href;
}
