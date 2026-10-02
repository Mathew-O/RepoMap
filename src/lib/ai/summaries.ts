import "server-only";

import type { AiContext } from "@/lib/ai/context";
import {
  SUMMARY_PROMPT_VERSION,
  SUMMARY_SYSTEM,
  buildFilePrompt,
  buildFolderPrompt,
  inspectContent,
  mockFileSummary,
  mockFolderSummary,
  parseSummaryText,
  pickFolderExcerpts,
  prepareContent,
  staticSummary,
} from "@/lib/ai/prompts";
import { cacheKeys, getCache } from "@/lib/cache";
import { FOLDER_EXCERPT_CHARS, FOLDER_EXCERPT_FILES, SUMMARY_MAX_FILE_CHARS } from "@/lib/config";
import { readRepoFile } from "@/lib/github/files";
import { RepoMapError } from "@/lib/github/errors";
import { runShared } from "@/lib/jobs";
import type { Summary, TreeNode } from "@/lib/types";

/** Thinking at low effort plus a two-sentence answer fits comfortably. */
const SUMMARY_MAX_TOKENS = 4_000;

function summaryKey(ctx: AiContext, path: string): string {
  return cacheKeys.summary(ctx.meta.owner, ctx.meta.repo, ctx.meta.commitSha, path, `${SUMMARY_PROMPT_VERSION}:${ctx.provider.model}`);
}

/**
 * A file or folder summary: from cache, without a model when there's nothing
 * to read (skipped, empty, binary), or streamed from the model and cached per
 * commit. Concurrent requests for the same path share one model call.
 */
export async function summarizePath(ctx: AiContext, path: string, onDelta: (text: string) => void): Promise<Summary> {
  const node = ctx.nodes[path];
  if (!node || path === "") {
    throw new RepoMapError("BAD_REQUEST", `There's no file or folder at "${path}" in this commit.`);
  }

  const fixed = staticSummary(node);
  if (fixed) return fixed;

  const key = summaryKey(ctx, path);
  const cached = await getCache().get<Summary>(key);
  if (cached) return cached;

  return runShared<Summary, string>(
    key,
    async (emit) => {
      const summary = node.type === "dir" ? await summarizeFolder(ctx, node, emit) : await summarizeFile(ctx, node, emit);
      // Only model-written results are worth caching; the rest are free to recompute.
      if (summary.model !== null) await getCache().set(key, summary);
      return summary;
    },
    onDelta,
  );
}

async function summarizeFile(ctx: AiContext, node: TreeNode, emit: (text: string) => void): Promise<Summary> {
  const raw = await readRepoFile(ctx.meta, node.path, ctx.auth);
  if (raw === null) throw new RepoMapError("NOT_FOUND", `${node.path} couldn't be read at this commit.`);

  const kind = inspectContent(raw);
  if (kind !== "text") {
    return {
      path: node.path,
      target: "file",
      text: kind === "binary" ? "Binary file; binaries aren't summarized." : "This file is empty.",
      status: kind === "binary" ? "skipped" : "empty",
      model: null,
      createdAt: new Date().toISOString(),
    };
  }

  const content = prepareContent(raw, SUMMARY_MAX_FILE_CHARS);
  const entryPoint = ctx.entryPoints.points.find((p) => p.path === node.path);
  const prompt = buildFilePrompt({ node, nodes: ctx.nodes, content, entryPoint });
  return generate(ctx, node, prompt, mockFileSummary(node, content), emit, content.truncated);
}

async function summarizeFolder(ctx: AiContext, node: TreeNode, emit: (text: string) => void): Promise<Summary> {
  const cache = getCache();
  const children = node.children ?? [];

  // Roll up from whatever children are already summarized (prefetch does the deeper level first).
  const childSummaries = new Map<string, Summary>();
  await Promise.all(
    children.map(async (child) => {
      const summary = await cache.get<Summary>(summaryKey(ctx, child));
      if (summary) childSummaries.set(child, summary);
    }),
  );

  const entryPaths = new Set(ctx.entryPoints.points.map((p) => p.path));
  const excerptPaths = pickFolderExcerpts(node, ctx.nodes, new Set(childSummaries.keys()), entryPaths, FOLDER_EXCERPT_FILES);
  const excerpts = (
    await Promise.all(
      excerptPaths.map(async (path) => {
        const raw = await readRepoFile(ctx.meta, path, ctx.auth).catch(() => null);
        if (raw === null || inspectContent(raw) !== "text") return null;
        return { path, content: prepareContent(raw, FOLDER_EXCERPT_CHARS) };
      }),
    )
  ).filter((e): e is NonNullable<typeof e> => e !== null);

  const prompt = buildFolderPrompt({ node, nodes: ctx.nodes, childSummaries, excerpts });
  return generate(ctx, node, prompt, mockFolderSummary(node, ctx.nodes), emit, false);
}

async function generate(
  ctx: AiContext,
  node: TreeNode,
  prompt: string,
  mock: string,
  emit: (text: string) => void,
  truncated: boolean,
): Promise<Summary> {
  if (!ctx.allowGeneration()) {
    throw new RepoMapError("AI_RATE_LIMITED", "You've generated a lot of summaries in a short time.", {
      hint: "Wait a few minutes; summaries that are already generated still load.",
    });
  }

  const result = await ctx.provider.stream(
    {
      system: SUMMARY_SYSTEM,
      context: await ctx.repoContext(),
      prompt,
      effort: "low",
      maxTokens: SUMMARY_MAX_TOKENS,
      mock,
    },
    emit,
  );

  const { text, status } = parseSummaryText(result.text);
  if (!text) throw new RepoMapError("AI_ERROR", "The AI returned an empty summary.", { hint: "Try again." });
  return {
    path: node.path,
    target: node.type === "dir" ? "folder" : "file",
    text,
    status,
    ...(truncated ? { truncated } : {}),
    model: result.model,
    createdAt: new Date().toISOString(),
  };
}
