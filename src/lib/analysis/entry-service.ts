import "server-only";

import { detectEntryPoints, planEntryPointReads } from "@/lib/analysis/entry-points";
import { cacheKeys, getCache } from "@/lib/cache";
import { ENTRY_POINT_READ_BUDGET_MS, INCOMPLETE_ENTRY_POINTS_TTL_SECONDS } from "@/lib/config";
import type { GitHubAuth } from "@/lib/github/client";
import { readRepoFile } from "@/lib/github/files";
import type { EntryPointReport, RepoMeta, TreeNode } from "@/lib/types";

const READ_CONCURRENCY = 6;

/**
 * "Start here" candidates for a commit. Never throws: if manifests can't be
 * read (rate limit, timeout), entry points are computed from paths and
 * whatever was read, flagged `incomplete`, and only cached briefly.
 *
 * Callers must have checked repo access for this request (see readRepoFile).
 */
export async function loadEntryPoints(
  meta: RepoMeta,
  nodes: Record<string, TreeNode>,
  auth: GitHubAuth,
): Promise<EntryPointReport> {
  const cache = getCache();
  const key = cacheKeys.entryPoints(meta.owner, meta.repo, meta.commitSha);
  const hit = await cache.get<EntryPointReport>(key);
  if (hit) return hit;

  const options = { repoName: meta.repo };
  const plan = planEntryPointReads(nodes, options);
  const deadline = AbortSignal.timeout(ENTRY_POINT_READ_BUDGET_MS);
  const files = new Map<string, string>();
  const failed: string[] = [];

  await forEachConcurrently(plan, READ_CONCURRENCY, async (path) => {
    try {
      const text = await readRepoFile(meta, path, auth, deadline);
      if (text !== null) files.set(path, text);
    } catch {
      failed.push(path);
    }
  });
  if (failed.length) {
    console.warn(`[entry-points] ${meta.fullName}@${meta.commitSha.slice(0, 7)}: couldn't read ${failed.length} of ${plan.length} files`);
  }

  let report: EntryPointReport;
  try {
    report = {
      points: detectEntryPoints(nodes, files, options),
      filesRead: plan.filter((p) => files.has(p)),
      incomplete: failed.length > 0,
    };
  } catch (err) {
    // A heuristic bug shouldn't take the whole map down with it.
    console.error("[entry-points] detection failed:", err instanceof Error ? err.message : err);
    return { points: [], filesRead: [], incomplete: true };
  }

  await cache.set(key, report, report.incomplete ? { ttlSeconds: INCOMPLETE_ENTRY_POINTS_TTL_SECONDS } : undefined);
  return report;
}

async function forEachConcurrently<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
