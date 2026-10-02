import "server-only";

import { buildRepoContext } from "@/lib/ai/prompts";
import type { AiProvider } from "@/lib/ai/provider";
import { loadEntryPoints } from "@/lib/analysis/entry-service";
import type { GitHubAuth } from "@/lib/github/client";
import { readRepoFile } from "@/lib/github/files";
import { loadSnapshot, resolveRepoAtCommit } from "@/lib/github/repo-service";
import type { EntryPointReport, RepoMeta, TreeNode, TreeStats } from "@/lib/types";

/** Everything an AI request needs about one commit, loaded once per HTTP request. */
export interface AiContext {
  meta: RepoMeta;
  nodes: Record<string, TreeNode>;
  stats: TreeStats;
  entryPoints: EntryPointReport;
  auth: GitHubAuth;
  provider: AiProvider;
  /** Root README path, if there is one. */
  readmePath: string | null;
  /** The prompt-cached repository block; built on first use (it reads the README). */
  repoContext(): Promise<string>;
  /** Called before each model call; false means this visitor hit their limit. */
  allowGeneration(): boolean;
}

/** Checks access with the caller's credentials before touching any SHA-keyed cache entry. */
export async function loadAiContext(input: {
  owner: string;
  repo: string;
  sha: string;
  auth: GitHubAuth;
  provider: AiProvider;
  allowGeneration: () => boolean;
}): Promise<AiContext> {
  const { auth } = input;
  const meta = await resolveRepoAtCommit(input.owner, input.repo, input.sha, auth);
  const { snapshot } = await loadSnapshot(meta, auth);
  const entryPoints = await loadEntryPoints(meta, snapshot.nodes, auth);
  const readmePath = findReadme(snapshot.nodes);

  let repoContext: Promise<string> | null = null;
  return {
    meta,
    nodes: snapshot.nodes,
    stats: snapshot.stats,
    entryPoints,
    auth,
    provider: input.provider,
    readmePath,
    allowGeneration: input.allowGeneration,
    repoContext() {
      repoContext ??= (async () => {
        const readme = readmePath ? await readRepoFile(meta, readmePath, auth).catch(() => null) : null;
        return buildRepoContext({
          meta,
          nodes: snapshot.nodes,
          entryPoints: entryPoints.points,
          readme: readme && readmePath ? { path: readmePath, text: readme } : null,
        });
      })();
      return repoContext;
    },
  };
}

function findReadme(nodes: Record<string, TreeNode>): string | null {
  const children = (nodes[""]?.children ?? []).map((p) => nodes[p]).filter((n): n is TreeNode => n?.type === "file");
  return (
    children.find((n) => /^readme\.(md|markdown)$/i.test(n.name))?.path ??
    children.find((n) => /^readme(\.|$)/i.test(n.name) && !n.skip)?.path ??
    null
  );
}
