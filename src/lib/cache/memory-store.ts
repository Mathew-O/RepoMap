import { type CacheSetOptions, type CacheStore, expiryFrom, isExpired } from "@/lib/cache/types";

/** Small in-process LRU that sits in front of the durable store. */
export class MemoryStore implements CacheStore {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number | null }>();

  constructor(private readonly maxEntries = 64) {}

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (isExpired(entry)) {
      this.entries.delete(key);
      return undefined;
    }
    // Re-insert to mark as most recently used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: expiryFrom(options) });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}
