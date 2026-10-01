import "server-only";

import { cacheKeys, getCache } from "@/lib/cache";
import { type GitHubAuth, getFileText } from "@/lib/github/client";
import type { RepoMeta } from "@/lib/types";

/**
 * A file's text at the commit being viewed, cached forever per commit SHA.
 * Returns null if the file doesn't exist at that commit.
 *
 * Callers must have checked access for this request first (`loadRepoTree`
 * does), because the cache is shared between visitors.
 */
export async function readRepoFile(
  meta: RepoMeta,
  path: string,
  auth: GitHubAuth,
  signal?: AbortSignal,
): Promise<string | null> {
  const cache = getCache();
  const key = cacheKeys.file(meta.owner, meta.repo, meta.commitSha, path);
  const hit = await cache.get<string>(key);
  if (hit !== undefined) return hit;

  const text = await getFileText(meta.owner, meta.repo, meta.commitSha, path, {
    auth,
    isPrivate: meta.isPrivate,
    signal,
  });
  if (text !== null) await cache.set(key, text);
  return text;
}
