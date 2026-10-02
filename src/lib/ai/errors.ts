import Anthropic from "@anthropic-ai/sdk";

import { RepoMapError } from "@/lib/github/errors";

/** Maps SDK failures to errors that are safe to show visitors. Most specific first. */
export function toAiError(err: unknown): RepoMapError {
  if (err instanceof RepoMapError) return err;

  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new RepoMapError("AI_UNAVAILABLE", "The server's Anthropic credentials were rejected, so AI summaries are off.", {
      hint: "The site owner needs to check ANTHROPIC_API_KEY.",
    });
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfter = Number(err.headers?.get("retry-after"));
    return new RepoMapError("AI_RATE_LIMITED", "The AI service is busy right now.", {
      hint: "Summaries will work again shortly.",
      resetAt: Number.isFinite(retryAfter) && retryAfter > 0 ? new Date(Date.now() + retryAfter * 1000).toISOString() : undefined,
    });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new RepoMapError("AI_ERROR", "Couldn't reach the AI service.", { hint: "Try again in a moment." });
  }
  if (err instanceof Anthropic.APIError) {
    const overloaded = err.status === 529 || (err.status !== undefined && err.status >= 500);
    if (!overloaded) console.error("[ai] request rejected:", err.status, err.message);
    return new RepoMapError(
      "AI_ERROR",
      overloaded ? "The AI service is overloaded." : "The AI service couldn't process this request.",
      { hint: "Try again in a moment." },
    );
  }
  // The SDK raises a plain Error (no subclass) when it finds no credentials at request time.
  if (err instanceof Error && err.message.startsWith("Could not resolve authentication method")) {
    return new RepoMapError("AI_UNAVAILABLE", "AI summaries aren't configured on this server.", {
      hint: "Set ANTHROPIC_API_KEY to turn them on.",
    });
  }

  console.error("[ai] unexpected error:", err instanceof Error ? err.message : err);
  return new RepoMapError("AI_ERROR", "Something went wrong while generating this summary.", { hint: "Try again in a moment." });
}

/** Errors that will fail every following request too, so batches should stop. */
export function isFatalAiError(err: RepoMapError): boolean {
  return err.code === "AI_UNAVAILABLE" || err.code === "AI_RATE_LIMITED";
}
