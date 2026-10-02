import type { NextRequest } from "next/server";

import { type AiContext, loadAiContext } from "@/lib/ai/context";
import { toAiError } from "@/lib/ai/errors";
import { generateOverview } from "@/lib/ai/overview";
import { getAiProvider } from "@/lib/ai/provider";
import { AI_LIMIT_OVERVIEWS, AI_LIMIT_WINDOW_SECONDS } from "@/lib/config";
import { resolveAuth } from "@/lib/github/client";
import { RepoMapError } from "@/lib/github/errors";
import { clientKey, errorResponse, ndjsonResponse, parseCommitTarget, readJson } from "@/lib/http";
import { SlidingWindowLimiter } from "@/lib/rate-limit";
import type { OverviewEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 180;

const limiter = new SlidingWindowLimiter(AI_LIMIT_OVERVIEWS, AI_LIMIT_WINDOW_SECONDS * 1000);

/**
 * POST /api/overview  { repo: "owner/name", sha }
 * Optional header: x-github-token.
 * Streams NDJSON OverviewEvents: "partial" (the what-it-is paragraph so far),
 * then "overview" or "error".
 */
export async function POST(request: NextRequest) {
  let ctx: AiContext;
  try {
    const target = parseCommitTarget(await readJson(request));
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
    return errorResponse(err, "api/overview");
  }

  return ndjsonResponse<OverviewEvent>(async (send) => {
    try {
      const overview = await generateOverview(ctx, (what) => send({ type: "partial", what }));
      send({ type: "overview", overview });
    } catch (err) {
      send({ type: "error", error: toAiError(err).toJSON() });
    }
  }, "api/overview");
}
