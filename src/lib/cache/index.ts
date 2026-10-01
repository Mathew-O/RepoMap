import "server-only";

import path from "node:path";

import { FileStore } from "@/lib/cache/file-store";
import { MemoryStore } from "@/lib/cache/memory-store";
import type { CacheSetOptions, CacheStore } from "@/lib/cache/types";

export { cacheKeys } from "@/lib/cache/keys";
export type { CacheStore } from "@/lib/cache/types";

const PROMOTED_TTL_SECONDS = 60;

/** Reads hit memory first, then disk. Writes go to both. */
class TieredStore implements CacheStore {
  constructor(
    private readonly fast: CacheStore,
    private readonly durable: CacheStore,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const hot = await this.fast.get<T>(key);
    if (hot !== undefined) return hot;
    const cold = await this.durable.get<T>(key);
    // The original TTL isn't known here, so promote with a short one. The
    // durable store stays the source of truth for expiry.
    if (cold !== undefined) await this.fast.set(key, cold, { ttlSeconds: PROMOTED_TTL_SECONDS });
    return cold;
  }

  async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    await Promise.all([this.fast.set(key, value, options), this.durable.set(key, value, options)]);
  }

  async delete(key: string): Promise<void> {
    await Promise.all([this.fast.delete(key), this.durable.delete(key)]);
  }
}

// Survives Next.js dev hot reloads.
const globalForCache = globalThis as unknown as { __repomapCache?: CacheStore };

/** To move to Redis/Postgres, swap the durable store constructed here. */
export function getCache(): CacheStore {
  if (!globalForCache.__repomapCache) {
    const dir = process.env.REPOMAP_CACHE_DIR?.trim() || path.join(process.cwd(), ".cache", "repomap");
    globalForCache.__repomapCache = new TieredStore(new MemoryStore(64), new FileStore(dir));
  }
  return globalForCache.__repomapCache;
}
