/**
 * Every key is versioned. Bump VERSION (or a per-namespace suffix like
 * promptVersion) to invalidate entries after changing their shape or how
 * they're produced. GitHub owner/repo names are case-insensitive, so they're
 * lowercased; refs and paths are case-sensitive and kept as-is.
 */
const VERSION = "v1";

/** Bump when classify.ts or build-tree.ts output changes, so old snapshots are ignored. */
const TREE_FORMAT = 2;

/** Bump when the entry-point heuristics change. */
const ENTRY_FORMAT = 1;

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

  /** "Start here" report. Immutable per commit (unless it was a partial read). */
  entryPoints: (owner: string, repo: string, sha: string) =>
    `${VERSION}:entry${ENTRY_FORMAT}:${repoId(owner, repo)}@${sha}`,

  /** Raw file contents. */
  file: (owner: string, repo: string, sha: string, filePath: string) =>
    `${VERSION}:file:${repoId(owner, repo)}@${sha}:${filePath}`,

  /** AI summary of a file or folder. `variant` = prompt version + model, so either change regenerates. */
  summary: (owner: string, repo: string, sha: string, filePath: string, variant: string) =>
    `${VERSION}:sum:${repoId(owner, repo)}@${sha}:${variant}:${filePath}`,

  /** AI project overview. */
  overview: (owner: string, repo: string, sha: string, variant: string) =>
    `${VERSION}:overview:${repoId(owner, repo)}@${sha}:${variant}`,
};
