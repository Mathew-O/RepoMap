import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type CacheEntry,
  type CacheSetOptions,
  type CacheStore,
  expiryFrom,
  isExpired,
} from "@/lib/cache/types";

/**
 * Durable cache as one JSON file per key: `<dir>/<ab>/<sha256(key)>.json`.
 * Writes go to a temp file and are then renamed into place, so readers never
 * see a half-written entry.
 */
export class FileStore implements CacheStore {
  constructor(private readonly dir: string) {}

  async get<T>(key: string): Promise<T | undefined> {
    const file = this.fileFor(key);
    try {
      const entry = JSON.parse(await readFile(file, "utf8")) as CacheEntry<T>;
      if (entry.key !== key) return undefined;
      if (isExpired(entry)) {
        await rm(file, { force: true }).catch(() => {});
        return undefined;
      }
      return entry.value;
    } catch (err) {
      if (!isNotFound(err)) console.warn(`[cache] read failed for ${key}:`, (err as Error).message);
      return undefined;
    }
  }

  async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    const file = this.fileFor(key);
    const tmp = `${file}.${randomUUID()}.tmp`;
    const entry: CacheEntry<T> = { key, value, expiresAt: expiryFrom(options) };
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(tmp, JSON.stringify(entry), "utf8");
      await rename(tmp, file);
    } catch (err) {
      console.warn(`[cache] write failed for ${key}:`, (err as Error).message);
      await rm(tmp, { force: true }).catch(() => {});
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.fileFor(key), { force: true }).catch(() => {});
  }

  private fileFor(key: string): string {
    const hash = createHash("sha256").update(key).digest("hex");
    return path.join(this.dir, hash.slice(0, 2), `${hash}.json`);
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "ENOENT";
}
