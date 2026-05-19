/** @deprecated IndexedDB asset cache는 현재 MVP 범위 밖입니다. 호환 타입으로만 유지합니다. */
export interface JsonCacheSetOptions {
  version?: string;
  ttlMs?: number;
  etag?: string;
  lastModified?: string;
}

/** @deprecated IndexedDB asset cache는 현재 MVP 범위 밖입니다. 사용자 주입 cache 계약 호환용입니다. */
export interface JsonAssetCache {
  getJson(url: string, options?: { version?: string }): Promise<unknown | null>;
  setJson(url: string, value: unknown, options?: JsonCacheSetOptions): Promise<void>;
  invalidateJson(url: string, options?: { version?: string }): Promise<void>;
}

/**
 * @deprecated IndexedDB asset cache는 현재 MVP 범위 밖입니다.
 * 이 shim은 browser storage를 사용하지 않고 항상 cache miss를 반환합니다.
 */
export class IndexedDbAssetCache implements JsonAssetCache {
  async getJson(_url: string, _options: { version?: string } = {}): Promise<unknown | null> {
    return null;
  }

  async setJson(_url: string, _value: unknown, _options: JsonCacheSetOptions = {}): Promise<void> {}

  async invalidateJson(_url: string, _options: { version?: string } = {}): Promise<void> {}
}
