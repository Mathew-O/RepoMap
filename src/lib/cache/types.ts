export interface CacheSetOptions {
  /** Omit for entries that never expire (anything keyed by commit SHA). */
  ttlSeconds?: number;
}

/**
 * Minimal key/value contract. The file store implements it today; a Redis
 * (GET/SET EX/DEL) or Postgres (upsert into a kv table) store can drop in
 * without touching callers. Implementations must never throw: a failing cache
 * should degrade to a miss, not break the request.
 */
export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  /** Epoch ms, or null for no expiry. */
  expiresAt: number | null;
}

export function expiryFrom(options?: CacheSetOptions): number | null {
  return options?.ttlSeconds ? Date.now() + options.ttlSeconds * 1000 : null;
}

export function isExpired(entry: Pick<CacheEntry, "expiresAt">): boolean {
  return entry.expiresAt !== null && entry.expiresAt <= Date.now();
}
