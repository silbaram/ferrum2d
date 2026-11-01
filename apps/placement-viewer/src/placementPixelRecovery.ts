import { PIXEL_LIMITS, readPixelDocument } from "./placementPixelDocument";

export const PIXEL_RECOVERY_LIMITS = { entries: 8, bytes: 32 * 1024 * 1024, age: 7 * 86400000, delay: 600 } as const;
export const PIXEL_RECOVERY_DATABASE = "ferrum-pixel-recovery";
export interface PixelCheckpoint {
  id: string; scope: string; updatedAt: number; name: string; bytes: number; source: string;
}
export type PixelCheckpointInfo = Omit<PixelCheckpoint, "source">;
export interface PixelRecoveryStore {
  list(scope: string): Promise<PixelCheckpointInfo[]>;
  read(scope: string, id: string): Promise<PixelCheckpoint>;
  put(checkpoint: PixelCheckpoint): Promise<void>;
  remove(scope: string, id: string): Promise<void>;
  close(): void;
}
export function pixelRecoveryScope(project: string | undefined, source: string, location: string): string {
  return JSON.stringify([project === undefined ? "browser" : "project", project ?? location, source]);
}
function checkpointInfo(value: unknown): PixelCheckpointInfo | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v.id) ||
      typeof v.scope !== "string" || v.scope.length > 8192 ||
      typeof v.name !== "string" || v.name.length > 64 ||
      typeof v.updatedAt !== "number" || !Number.isSafeInteger(v.updatedAt) || v.updatedAt < 0 || v.updatedAt > 8_640_000_000_000_000 ||
      typeof v.bytes !== "number" || !Number.isSafeInteger(v.bytes) || v.bytes < 1 || v.bytes > PIXEL_LIMITS.sourceBytes ||
      typeof v.source !== "string" || v.source.length > PIXEL_LIMITS.sourceBytes || new TextEncoder().encode(v.source).length !== v.bytes) return;
  return { id: v.id, scope: v.scope, updatedAt: v.updatedAt, name: v.name, bytes: v.bytes };
}
export function readPixelCheckpoint(value: unknown): PixelCheckpoint {
  const info = checkpointInfo(value);
  if (!info || !value || typeof value !== "object" || !("source" in value) || typeof value.source !== "string")
    throw Error("Invalid pixel recovery data");
  let source: ReturnType<typeof readPixelDocument>;
  try { source = readPixelDocument(value.source); } catch { throw Error("Invalid pixel recovery data"); }
  if (source.name !== info.name || new TextEncoder().encode(value.source).length !== info.bytes)
    throw Error("Invalid pixel recovery data");
  return { ...info, source: value.source };
}
/** Newest valid metadata within the origin's retention budget. No source parsing on listing. */
export function retainedPixelCheckpoints(values: unknown[], now: number, keepId?: string): PixelCheckpointInfo[] {
  const rows = values.map(checkpointInfo).filter((v): v is PixelCheckpointInfo => !!v && now - v.updatedAt <= PIXEL_RECOVERY_LIMITS.age)
    .sort((a, b) => Number(b.id === keepId) - Number(a.id === keepId) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  let bytes = 0;
  return rows.filter((row, index) => index < PIXEL_RECOVERY_LIMITS.entries && (bytes += row.bytes) <= PIXEL_RECOVERY_LIMITS.bytes);
}
/** All completion promises resolve on transaction commit, never on request success. */
export function createPixelRecoveryStore(factory: () => IDBFactory = () => indexedDB): PixelRecoveryStore {
  let connection: Promise<IDBDatabase> | undefined, closed = false;
  function database() {
    if (closed) return Promise.reject(Error("Pixel recovery closed"));
    return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory().open(PIXEL_RECOVERY_DATABASE, 1);
      let settled = false;
      const fail = (error: unknown) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } };
      const timer = setTimeout(() => fail(Error("Pixel recovery storage unavailable")), 10000);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("checkpoints")) request.result.createObjectStore("checkpoints", { keyPath: "id" });
      };
      request.onblocked = () => fail(Error("Pixel recovery storage unavailable"));
      request.onerror = () => fail(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (settled || closed) { db.close(); fail(Error("Pixel recovery closed")); return; }
        settled = true; clearTimeout(timer);
        db.onversionchange = () => { db.close(); connection = undefined; };
        resolve(db);
      };
    }).catch(error => { connection = undefined; throw error; });
  }
  async function transaction<T>(run: (store: IDBObjectStore, result: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
    const db = await database();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction("checkpoints", "readwrite");
      let result: T, failure: unknown;
      const fail = (error: unknown) => { failure = error; try { tx.abort(); } catch { reject(error); } };
      const timer = setTimeout(() => fail(Error("Pixel recovery storage unavailable")), 10000);
      tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(failure ?? tx.error ?? Error("Pixel recovery storage unavailable")); };
      try { run(tx.objectStore("checkpoints"), value => { result = value; }, fail); }
      catch (error) { fail(error); }
    });
  }
  function prune(store: IDBObjectStore, rows: unknown[], keepId?: string) {
    const retained = retainedPixelCheckpoints(rows, Date.now(), keepId), ids = new Set(retained.map(row => row.id));
    for (const row of rows) if (row && typeof row === "object" && "id" in row && typeof row.id === "string" && !ids.has(row.id)) store.delete(row.id);
    return retained;
  }
  return {
    list: scope => transaction<PixelCheckpointInfo[]>((store, result, fail) => {
      const request = store.getAll();
      request.onsuccess = () => { try { result(prune(store, request.result).filter(row => row.scope === scope)); } catch (error) { fail(error); } };
    }),
    read: (scope, id) => transaction<PixelCheckpoint>((store, result, fail) => {
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          const row = readPixelCheckpoint(request.result);
          if (row.scope !== scope || Date.now() - row.updatedAt > PIXEL_RECOVERY_LIMITS.age) throw Error("Pixel recovery not found");
          result(row);
        } catch (error) { fail(error); /* Read never changes the current editor. */ }
      };
    }),
    async put(value) {
      const checked = readPixelCheckpoint(value);
      return transaction<void>((store, result, fail) => {
        const request = store.getAll();
        request.onsuccess = () => {
          try {
            const rows = request.result.filter(row => row.id !== checked.id); rows.push(checked);
            prune(store, rows, checked.id); store.put(checked); result();
          } catch (error) { fail(error); }
        };
      });
    },
    remove: (scope, id) => transaction<void>((store, result, fail) => {
      const request = store.get(id);
      request.onsuccess = () => { try { if (request.result?.scope === scope) store.delete(id); result(); } catch (error) { fail(error); } };
    }),
    close() { closed = true; void connection?.then(db => db.close(), () => {}); },
  };
}
