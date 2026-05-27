export interface JsonCacheSetOptions {
  version?: string;
  ttlMs?: number;
  etag?: string;
  lastModified?: string;
}

export type BinaryCacheSetOptions = JsonCacheSetOptions;

export interface JsonAssetCache {
  getJson(url: string, options?: { version?: string }): Promise<unknown | null>;
  setJson(url: string, value: unknown, options?: JsonCacheSetOptions): Promise<void>;
  invalidateJson(url: string, options?: { version?: string }): Promise<void>;
}

export interface BinaryAssetCache {
  getBinary(url: string, options?: { version?: string }): Promise<ArrayBuffer | null>;
  setBinary(url: string, value: ArrayBuffer, options?: BinaryCacheSetOptions): Promise<void>;
  invalidateBinary(url: string, options?: { version?: string }): Promise<void>;
}

export interface IndexedDbAssetCacheOptions {
  databaseName?: string;
  storeName?: string;
  binaryStoreName?: string;
  indexedDB?: IDBFactory;
}

interface JsonCacheRecord {
  key: string;
  url: string;
  version: string;
  value: unknown;
  expiresAt?: number;
  etag?: string;
  lastModified?: string;
}

interface BinaryCacheRecord {
  key: string;
  url: string;
  version: string;
  value: ArrayBuffer;
  expiresAt?: number;
  etag?: string;
  lastModified?: string;
}

const DEFAULT_DATABASE_NAME = "ferrum2d-assets";
const DEFAULT_STORE_NAME = "json";
const DEFAULT_BINARY_STORE_NAME = "binary";
const DEFAULT_VERSION = "v1";

export class IndexedDbAssetCache implements JsonAssetCache, BinaryAssetCache {
  private dbPromise?: Promise<IDBDatabase | undefined>;
  private readonly databaseName: string;
  private readonly storeName: string;
  private readonly binaryStoreName: string;
  private readonly indexedDB?: IDBFactory;

  constructor(options: IndexedDbAssetCacheOptions = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
    this.storeName = options.storeName ?? DEFAULT_STORE_NAME;
    this.binaryStoreName = options.binaryStoreName ?? DEFAULT_BINARY_STORE_NAME;
    this.indexedDB = options.indexedDB ?? globalThis.indexedDB;
  }

  async getJson(url: string, options: { version?: string } = {}): Promise<unknown | null> {
    const db = await this.openDatabase();
    if (!db) {
      return null;
    }
    const key = cacheKey(url, options.version);
    const record = await this.request<JsonCacheRecord | undefined>(
      db.transaction(this.storeName, "readonly").objectStore(this.storeName).get(key),
    );
    if (!record) {
      return null;
    }
    if (record.expiresAt !== undefined && record.expiresAt <= Date.now()) {
      await this.invalidateJson(url, options);
      return null;
    }
    return record.value;
  }

  async setJson(url: string, value: unknown, options: JsonCacheSetOptions = {}): Promise<void> {
    const db = await this.openDatabase();
    if (!db) {
      return;
    }
    const version = options.version ?? DEFAULT_VERSION;
    const record: JsonCacheRecord = {
      key: cacheKey(url, version),
      url,
      version,
      value,
      ...(options.ttlMs === undefined ? {} : { expiresAt: Date.now() + options.ttlMs }),
      ...(options.etag === undefined ? {} : { etag: options.etag }),
      ...(options.lastModified === undefined ? {} : { lastModified: options.lastModified }),
    };
    await this.request(db.transaction(this.storeName, "readwrite").objectStore(this.storeName).put(record));
  }

  async invalidateJson(url: string, options: { version?: string } = {}): Promise<void> {
    const db = await this.openDatabase();
    if (!db) {
      return;
    }
    await this.request(
      db.transaction(this.storeName, "readwrite").objectStore(this.storeName).delete(cacheKey(url, options.version)),
    );
  }

  async getBinary(url: string, options: { version?: string } = {}): Promise<ArrayBuffer | null> {
    const db = await this.openDatabase();
    if (!db) {
      return null;
    }
    const key = cacheKey(url, options.version);
    const record = await this.request<BinaryCacheRecord | undefined>(
      db.transaction(this.binaryStoreName, "readonly").objectStore(this.binaryStoreName).get(key),
    );
    if (!record) {
      return null;
    }
    if (record.expiresAt !== undefined && record.expiresAt <= Date.now()) {
      await this.invalidateBinary(url, options);
      return null;
    }
    return record.value.slice(0);
  }

  async setBinary(url: string, value: ArrayBuffer, options: BinaryCacheSetOptions = {}): Promise<void> {
    const db = await this.openDatabase();
    if (!db) {
      return;
    }
    const version = options.version ?? DEFAULT_VERSION;
    const record: BinaryCacheRecord = {
      key: cacheKey(url, version),
      url,
      version,
      value: value.slice(0),
      ...(options.ttlMs === undefined ? {} : { expiresAt: Date.now() + options.ttlMs }),
      ...(options.etag === undefined ? {} : { etag: options.etag }),
      ...(options.lastModified === undefined ? {} : { lastModified: options.lastModified }),
    };
    await this.request(db.transaction(this.binaryStoreName, "readwrite").objectStore(this.binaryStoreName).put(record));
  }

  async invalidateBinary(url: string, options: { version?: string } = {}): Promise<void> {
    const db = await this.openDatabase();
    if (!db) {
      return;
    }
    await this.request(
      db.transaction(this.binaryStoreName, "readwrite")
        .objectStore(this.binaryStoreName)
        .delete(cacheKey(url, options.version)),
    );
  }

  private async openDatabase(): Promise<IDBDatabase | undefined> {
    if (!this.indexedDB) {
      return undefined;
    }
    this.dbPromise ??= new Promise((resolve, reject) => {
      const request = this.indexedDB!.open(this.databaseName, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(this.binaryStoreName)) {
          db.createObjectStore(this.binaryStoreName, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
    });
    return await this.dbPromise;
  }

  private async request<T = unknown>(request: IDBRequest<T>): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    });
  }
}

function cacheKey(url: string, version = DEFAULT_VERSION): string {
  return `${version}:${url}`;
}
