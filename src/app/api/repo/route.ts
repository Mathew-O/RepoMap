import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { resolveAuth } from "@/lib/github/client";
import { RepoMapError } from "@/lib/github/errors";
import { parseRepoUrl } from "@/lib/github/parse-url";
import { loadRepoTree } from "@/lib/github/repo-service";
import { NO_STORE, errorResponse } from "@/lib/http";

// Needs the Node runtime for the file cache.
export const runtime = "nodejs";

/**
 * GET /api/repo?url=<github url | owner/repo[/tree/ref/path]>
 * Optional header: x-github-token (the visitor's own token).
 */
export async function GET(request: NextRequest) {
  const parsed = parseRepoUrl(request.nextUrl.searchParams.get("url") ?? "");
  if (!parsed.ok) return errorResponse(new RepoMapError("INVALID_URL", parsed.error), "api/repo");

  try {
    const auth = resolveAuth(request.headers.get("x-github-token"));
    const tree = await loadRepoTree(parsed.value, auth);
    return NextResponse.json(tree, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, "api/repo");
  }
}
