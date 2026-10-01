import "server-only";

import { loadEntryPoints } from "@/lib/analysis/entry-service";
import { type CacheStore, cacheKeys, getCache } from "@/lib/cache";
import { MAX_TREE_NODES, REF_CACHE_TTL_SECONDS } from "@/lib/config";
import { buildTree } from "@/lib/github/build-tree";
import {
  type GitHubAuth,
  getCommitSha,
  getRecursiveTree,
  getRepository,
} from "@/lib/github/client";
import { RepoMapError } from "@/lib/github/errors";
import type { ParsedRepoUrl, RepoMeta, RepoTree, TreeSnapshot } from "@/lib/types";

/** Longest ref prefix tried when splitting "<ref>/<path>". */
const MAX_REF_SEGMENTS = 6;

/**
 * Repo URL → normalized tree.
 *
 * Access is always checked with the caller's own credentials before anything
 * SHA-keyed is read from cache (the short-lived ref cache only ever holds
 * public repos), so one visitor's cached data never leaks to another.
 */
export async function loadRepoTree(input: ParsedRepoUrl, auth: GitHubAuth): Promise<RepoTree> {
  const cache = getCache();
  const meta = await resolveRepo(input, auth, cache);

  const key = cacheKeys.tree(meta.owner, meta.repo, meta.commitSha);
  let snapshot = await cache.get<TreeSnapshot>(key);
  const cached = snapshot !== undefined;

  if (!snapshot) {
    const raw = await getRecursiveTree(meta.owner, meta.repo, meta.commitSha, auth);
    snapshot = buildTree(raw.tree, { maxNodes: MAX_TREE_NODES, truncatedByGitHub: raw.truncated });
    await cache.set(key, snapshot);
  }

  const focusPath = meta.requestedPath && snapshot.nodes[meta.requestedPath] ? meta.requestedPath : null;
  const entryPoints = await loadEntryPoints(meta, snapshot.nodes, auth);

  return {
    ...snapshot,
    meta: { ...meta, focusPath },
    entryPoints,
    fetchedAt: new Date().toISOString(),
    cached,
  };
}

async function resolveRepo(input: ParsedRepoUrl, auth: GitHubAuth, cache: CacheStore): Promise<RepoMeta> {
  const refKey = cacheKeys.ref(input.owner, input.repo, input.treeish);
  const hit = await cache.get<RepoMeta>(refKey);
  if (hit) return hit;

  const gh = await getRepository(input.owner, input.repo, auth);

  // Never use the deployer's token to expose their private repos to visitors.
  if (gh.private && auth.source !== "user") {
    throw new RepoMapError("PRIVATE_REPO", `${gh.full_name} is a private repository.`, {
      hint: "Add a GitHub token that can access it. The token is stored only in your browser.",
    });
  }

  const owner = gh.owner.login;
  const repo = gh.name;

  let ref = gh.default_branch;
  let commitSha: string;
  let requestedPath: string | null = null;

  if (input.treeish) {
    const resolved = await resolveTreeish(owner, repo, input.treeish, auth);
    ref = resolved.ref;
    commitSha = resolved.sha;
    requestedPath = resolved.path || null;
  } else {
    commitSha = await getCommitSha(owner, repo, ref, auth);
  }

  const meta: RepoMeta = {
    owner,
    repo,
    fullName: gh.full_name,
    description: gh.description,
    htmlUrl: gh.html_url,
    homepage: gh.homepage || null,
    defaultBranch: gh.default_branch,
    ref,
    refIsDefault: ref === gh.default_branch,
    commitSha,
    requestedPath,
    focusPath: null,
    isPrivate: gh.private,
    isFork: gh.fork,
    isArchived: gh.archived,
    stars: gh.stargazers_count,
    forks: gh.forks_count,
    language: gh.language,
    license: gh.license?.spdx_id && gh.license.spdx_id !== "NOASSERTION" ? gh.license.spdx_id : (gh.license?.name ?? null),
    topics: gh.topics ?? [],
  };

  if (!meta.isPrivate) await cache.set(refKey, meta, { ttlSeconds: REF_CACHE_TTL_SECONDS });
  return meta;
}

/**
 * "feature/login/src/app" could be ref "feature" + path "login/src/app" or
 * ref "feature/login" + path "src/app". Git forbids a branch "a" coexisting
 * with "a/b", so the shortest prefix that resolves is the right one.
 */
async function resolveTreeish(owner: string, repo: string, treeish: string, auth: GitHubAuth) {
  const segments = treeish.split("/").filter(Boolean);
  const limit = Math.min(segments.length, MAX_REF_SEGMENTS);

  for (let i = 1; i <= limit; i++) {
    const ref = segments.slice(0, i).join("/");
    try {
      const sha = await getCommitSha(owner, repo, ref, auth);
      return { ref, sha, path: segments.slice(i).join("/") };
    } catch (err) {
      if (err instanceof RepoMapError && err.code === "REF_NOT_FOUND") continue;
      throw err;
    }
  }

  throw new RepoMapError(
    "REF_NOT_FOUND",
    `Couldn't find a branch, tag or commit named "${segments[0] ?? treeish}" in ${owner}/${repo}.`,
    { hint: "Check the branch name, or remove /tree/… from the URL to use the default branch." },
  );
}
