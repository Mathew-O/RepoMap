import { type NextRequest, NextResponse } from "next/server";

import { resolveAuth } from "@/lib/github/client";
import { RepoMapError } from "@/lib/github/errors";
import { parseRepoUrl } from "@/lib/github/parse-url";
import { loadRepoTree } from "@/lib/github/repo-service";

// Needs the Node runtime for the file cache.
export const runtime = "nodejs";

// Responses depend on the caller's token, so they must never be shared.
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/repo?url=<github url | owner/repo[/tree/ref/path]>
 * Optional header: x-github-token (the visitor's own token).
 */
export async function GET(request: NextRequest) {
  const parsed = parseRepoUrl(request.nextUrl.searchParams.get("url") ?? "");
  if (!parsed.ok) return errorResponse(new RepoMapError("INVALID_URL", parsed.error));

  try {
    const auth = resolveAuth(request.headers.get("x-github-token"));
    const tree = await loadRepoTree(parsed.value, auth);
    return NextResponse.json(tree, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  let error: RepoMapError;
  if (err instanceof RepoMapError) {
    error = err;
  } else {
    console.error("[api/repo] unexpected error:", err instanceof Error ? err.message : err);
    error = new RepoMapError("UPSTREAM", "Something went wrong while loading this repository.", {
      status: 500,
      hint: "Try again in a moment.",
    });
  }
  return NextResponse.json({ error: error.toJSON() }, { status: error.status, headers: NO_STORE });
}
