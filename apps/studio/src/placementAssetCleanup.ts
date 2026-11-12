/** Private desktop authoring contract. Nothing here deletes files or owns scene state. */
export const cleanupDirectories = { pixel: ".ferrum-pixels", aseprite: ".ferrum-aseprite", tile: ".ferrum-tiles", normal: ".ferrum-normals" } as const;
export type CleanupKind = keyof typeof cleanupDirectories;
export interface CleanupFile {
  name: string;
  bytes: number;
  sha256: string;
}
export interface CleanupRevision {
  key: string;
  kind: CleanupKind;
  id: string;
  assets: string[];
  files: CleanupFile[];
  references: string[];
}
export interface CleanupBackup {
  id: string;
  kind: CleanupKind | null;
  selected: string[];
  createdAt: number;
  restored: boolean;
  problem: string | null;
}
export interface CleanupReport {
  format: "ferrum2d.asset-cleanup";
  version: 1;
  snapshot: string;
  deletionAllowed: false;
  revisions: CleanupRevision[];
  backups: CleanupBackup[];
  jsonFiles: number;
  jsonBytes: number;
  catalogs: {
    kind: CleanupKind;
    revisions: number;
    backupBytes: number;
  }[];
}
export interface CleanupResult {
  backupId: string;
  backupPath: string;
  removedFiles: number;
  removedBytes: number;
  requiresReload: true;
}
export type CleanupInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export interface CleanupHost {
  project: string;
  invoke: CleanupInvoke;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 4096): value is string => typeof value === "string" && !!value && value.length <= max;
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const count = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
const kind = (value: unknown): value is CleanupKind => typeof value === "string" && Object.hasOwn(cleanupDirectories, value);
function list(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max)
  throw Error("Invalid cleanup response"); return value; }
function strings(value: unknown, max: number): string[] { const values = list(value, max); if (!values.every(v => text(v)))
  throw Error("Invalid cleanup response"); return values as string[]; }
export function readCleanupReport(value: unknown): CleanupReport {
  if (!record(value) || value.format !== "ferrum2d.asset-cleanup" || value.version !== 1 || value.deletionAllowed !== false || !digest(value.snapshot) || !count(value.jsonFiles, 256) || !count(value.jsonBytes, 32 * 1024 * 1024))
    throw Error("Invalid cleanup response");
  const keys = new Set<string>();
  const counts = new Map<CleanupKind, number>();
  for (const raw of list(value.revisions, 32)) {
    if (!record(raw) || !kind(raw.kind) || !text(raw.id, 1024) || raw.key !== `${cleanupDirectories[raw.kind]}:${raw.id}` || keys.has(String(raw.key)))
      throw Error("Invalid cleanup revision");
    keys.add(String(raw.key));
    counts.set(raw.kind, (counts.get(raw.kind) ?? 0) + 1);
    if ((counts.get(raw.kind) ?? 0) > 8)
      throw Error("Invalid cleanup revision count");
    strings(raw.assets, 2);
    strings(raw.references, 1024);
    for (const file of list(raw.files, 512))
      if (!record(file) || !text(file.name, 1024) || !/^[A-Za-z0-9_.-]+$/.test(file.name) || !digest(file.sha256) || !count(file.bytes, 64 * 1024 * 1024))
        throw Error("Invalid cleanup source file");
  }
  const catalogs = new Set<CleanupKind>();
  for (const raw of list(value.catalogs, 4)) {
    if (!record(raw) || !kind(raw.kind) || catalogs.has(raw.kind) || raw.revisions !== (counts.get(raw.kind) ?? 0) || !count(raw.backupBytes, 65 * 1024 * 1024))
      throw Error("Invalid cleanup catalog summary");
    catalogs.add(raw.kind);
  }
  if ([...counts.keys()].some(value => !catalogs.has(value)))
    throw Error("Missing cleanup catalog summary");
  readCleanupBackups(value.backups);
  return structuredClone(value) as unknown as CleanupReport;
}
/** Can be read independently when malformed project JSON prevents cleanup analysis. */
export function readCleanupBackups(value: unknown): CleanupBackup[] {
  const values = list(value, 8);
  const ids = new Set<string>();
  for (const raw of values) {
    if (!record(raw) || !text(raw.id, 1024) || (raw.kind !== null && !kind(raw.kind)) || typeof raw.restored !== "boolean" || !count(raw.createdAt, Number.MAX_SAFE_INTEGER) || (raw.problem !== null && !text(raw.problem, 8192)))
      throw Error("Invalid cleanup backup");
    if (raw.problem === null && (!digest(raw.id) || !kind(raw.kind)))
      throw Error("Invalid cleanup backup identity");
    if (ids.has(raw.id)) throw Error("Duplicate cleanup backup");
    ids.add(raw.id);
    strings(raw.selected, 8);
  }
  return structuredClone(values) as unknown as CleanupBackup[];
}
export function readCleanupResult(value: unknown): CleanupResult {
  if (!record(value) || !digest(value.backupId) || !text(value.backupPath) || !count(value.removedFiles, 512) || !count(value.removedBytes, 64 * 1024 * 1024) || value.requiresReload !== true)
    throw Error("Cleanup result could not be verified. Reopen the project.");
  return value as unknown as CleanupResult;
}
/** Open documents are additional protection, never an authority to remove disk references. */
export function protectCleanupDocuments(report: CleanupReport, documents: Iterable<{
  scene: string;
  document: unknown;
}>) {
  const protectedKeys = new Set<string>();
  let bytes = 0;
  let count = 0;
  for (const document of documents) {
    if (++count > 64)
      throw Error("Close extra scene documents before cleanup");
    const source = JSON.stringify(document.document);
    if (typeof source !== "string" || (bytes += new TextEncoder().encode(source).byteLength) > 16 * 1024 * 1024)
      throw Error("Open document snapshot exceeds cleanup budget");
    const numericTexture = /"(?:texture|normalTexture|emissionTexture|specularTexture|roughnessTexture)"\s*:\s*-?\d/.test(source);
    for (const revision of report.revisions)
      if (numericTexture || source.includes(revision.id) || revision.assets.some(id => source.includes(id)) || revision.files.some(file => source.includes(file.name))) {
        protectedKeys.add(revision.key);
        const label = `Open: ${document.scene}${numericTexture ? ": unresolved numeric texture" : ""}`;
        if (!revision.references.includes(label))
          revision.references.push(label);
      }
  }
  return [...protectedKeys].sort();
}
export function cleanupSelection(report: CleanupReport, selected: ReadonlySet<string>, protectedKeys: readonly string[]) {
  const values = report.revisions.filter(value => selected.has(value.key));
  if (!values.length || values.length !== selected.size || values.length > 8 || values.some(value => value.kind !== values[0].kind || value.references.length || protectedKeys.includes(value.key)))
    throw Error("Choose unreferenced revisions from one catalog");
  return { expectedSnapshot: report.snapshot, selected: values.map(value => value.key).sort(), protectedKeys: [...protectedKeys] };
}
