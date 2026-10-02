import type { NextRequest } from "next/server";

import { type AiContext, loadAiContext } from "@/lib/ai/context";
import { isFatalAiError, toAiError } from "@/lib/ai/errors";
import { getAiProvider } from "@/lib/ai/provider";
import { summarizePath } from "@/lib/ai/summaries";
import { AI_LIMIT_SUMMARIES, AI_LIMIT_WINDOW_SECONDS, SUMMARY_PATHS_PER_REQUEST } from "@/lib/config";
import { resolveAuth } from "@/lib/github/client";
import { RepoMapError } from "@/lib/github/errors";
import { clientKey, errorResponse, ndjsonResponse, parseCommitTarget, readJson } from "@/lib/http";
import { SlidingWindowLimiter } from "@/lib/rate-limit";
import type { SummaryEvent } from "@/lib/types";

export const runtime = "nodejs";
// A request carries at most SUMMARY_PATHS_PER_REQUEST paths; this is headroom for slow model responses.
export const maxDuration = 120;

const CONCURRENCY = 4;
const limiter = new SlidingWindowLimiter(AI_LIMIT_SUMMARIES, AI_LIMIT_WINDOW_SECONDS * 1000);

/**
 * POST /api/summaries  { repo: "owner/name", sha, paths: string[] }
 * Optional header: x-github-token.
 * Streams NDJSON SummaryEvents: "delta" text as it's generated, then one
 * "summary" or "error" per path. Access and configuration problems come back
 * as a plain JSON error before the stream starts.
 */
export async function POST(request: NextRequest) {
  let ctx: AiContext;
  let paths: string[];
  try {
    const body = await readJson(request);
    const target = parseCommitTarget(body);
    paths = parsePaths(body);

    const provider = getAiProvider();
    if (!provider) {
      throw new RepoMapError("AI_UNAVAILABLE", "AI summaries aren't configured on this server.", {
        hint: "Set ANTHROPIC_API_KEY to turn them on.",
      });
    }
    const visitor = clientKey(request);
    ctx = await loadAiContext({
      ...target,
      auth: resolveAuth(request.headers.get("x-github-token")),
      provider,
      allowGeneration: () => limiter.take(visitor),
    });
  } catch (err) {
    return errorResponse(err, "api/summaries");
  }

  return ndjsonResponse<SummaryEvent>(async (send) => {
    const queue = [...paths];
    let stopped: RepoMapError | null = null;

    const worker = async () => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        if (stopped) {
          send({ type: "error", path, error: stopped.toJSON() });
          continue;
        }
        try {
          const summary = await summarizePath(ctx, path, (text) => send({ type: "delta", path, text }));
          send({ type: "summary", summary });
        } catch (err) {
          const error = toAiError(err);
          if (isFatalAiError(error)) stopped = error;
          send({ type: "error", path, error: error.toJSON() });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker));
  }, "api/summaries");
}

function parsePaths(body: unknown): string[] {
  const raw = (body as { paths?: unknown }).paths;
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((p) => typeof p !== "string" || p.length > 1_000)) {
    throw new RepoMapError("BAD_REQUEST", 'Expected "paths" as a non-empty list of file or folder paths.');
  }
  const unique = [...new Set(raw as string[])];
  if (unique.length > SUMMARY_PATHS_PER_REQUEST) {
    throw new RepoMapError("BAD_REQUEST", `Ask for at most ${SUMMARY_PATHS_PER_REQUEST} paths per request.`);
  }
  return unique;
}
