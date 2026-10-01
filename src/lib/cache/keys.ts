/**
 * Every key is versioned. Bump VERSION (or a per-namespace suffix like
 * promptVersion) to invalidate entries after changing their shape or how
 * they're produced. GitHub owner/repo names are case-insensitive, so they're
 * lowercased; refs and paths are case-sensitive and kept as-is.
 */
const VERSION = "v1";

/** Bump when classify.ts or build-tree.ts output changes, so old snapshots are ignored. */
const TREE_FORMAT = 2;

function repoId(owner: string, repo: string): string {
  return `${owner}/${repo}`.toLowerCase();
}

export const cacheKeys = {
  /** treeish → RepoMeta (incl. commit SHA). Short TTL; public repos only. */
  ref: (owner: string, repo: string, treeish: string | undefined) =>
    `${VERSION}:ref:${repoId(owner, repo)}:${treeish ?? "@default"}`,

  /** Normalized tree snapshot. Immutable per commit. */
  tree: (owner: string, repo: string, sha: string) =>
    `${VERSION}:tree${TREE_FORMAT}:${repoId(owner, repo)}@${sha}`,

  /** M4: raw file contents. */
  file: (owner: string, repo: string, sha: string, filePath: string) =>
    `${VERSION}:file:${repoId(owner, repo)}@${sha}:${filePath}`,

  /** M4: AI summary of a file, folder ("path/") or the overview (""). */
  summary: (owner: string, repo: string, sha: string, filePath: string, promptVersion: string) =>
    `${VERSION}:sum:${repoId(owner, repo)}@${sha}:${filePath}:${promptVersion}`,
};
