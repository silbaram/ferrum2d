const DB_NAME = "ferrum2d-asset-cache";
const DB_VERSION = 2;
const STORE_NAME = "assets";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface JsonCacheSetOptions {
  version?: string;
  ttlMs?: number;
  etag?: string;
  lastModified?: string;
}

export interface JsonAssetCache {
  getJson(url: string, options?: { version?: string }): Promise<unknown | null>;
  setJson(url: string, value: unknown, options?: JsonCacheSetOptions): Promise<void>;
  invalidateJson(url: string, options?: { version?: string }): Promise<void>;
}

interface CachedAssetRecord {
  key: string;
  url: string;
  kind: "json";
  version: string;
  etag?: string;
  lastModified?: string;
  payload: string;
  cachedAt: number;
  expiresAt: number;
}

export class IndexedDbAssetCache implements JsonAssetCache {
  private dbPromise?: Promise<IDBDatabase | null>;

  async getJson(url: string, options: { version?: string } = {}): Promise<unknown | null> {
    const db = await this.openDb();
    if (!db) return null;

    const version = options.version ?? "v1";
    const key = this.recordKey("json", version, url);
    const record = await this.readRecord(db, key);
    if (!record) return null;

    if (record.expiresAt <= Date.now()) {
      await this.deleteRecord(db, key);
      return null;
    }

    try {
      return JSON.parse(record.payload);
    } catch {
      await this.deleteRecord(db, key);
      return null;
    }
  }

  async setJson(url: string, value: unknown, options: JsonCacheSetOptions = {}): Promise<void> {
    const db = await this.openDb();
    if (!db) return;

    const ttlMs = Math.max(1000, Math.floor(options.ttlMs ?? DEFAULT_TTL_MS));
    const version = options.version ?? "v1";
    const payload = JSON.stringify(value);
    const now = Date.now();
    const record: CachedAssetRecord = {
      key: this.recordKey("json", version, url),
      url,
      kind: "json",
      version,
      etag: options.etag,
      lastModified: options.lastModified,
      payload,
      cachedAt: now,
      expiresAt: now + ttlMs,
    };
    await this.writeRecord(db, record);
  }

  async invalidateJson(url: string, options: { version?: string } = {}): Promise<void> {
    const db = await this.openDb();
    if (!db) return;

    const version = options.version ?? "v1";
    await this.deleteRecord(db, this.recordKey("json", version, url));
  }

  private recordKey(kind: "json", version: string, url: string): string {
    return `${kind}:${version}:${url}`;
  }

  private async openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return null;
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: "key" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
    }
    return this.dbPromise;
  }

  private async readRecord(db: IDBDatabase, key: string): Promise<CachedAssetRecord | null> {
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as CachedAssetRecord | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
  }

  private async writeRecord(db: IDBDatabase, record: CachedAssetRecord): Promise<void> {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  }

  private async deleteRecord(db: IDBDatabase, key: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  }
}
