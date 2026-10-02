import "server-only";

import { type NextRequest, NextResponse } from "next/server";

import { RepoMapError } from "@/lib/github/errors";

// Responses depend on the caller's token, so they must never be shared.
export const NO_STORE = { "Cache-Control": "private, no-store" };

export function errorResponse(err: unknown, tag: string) {
  let error: RepoMapError;
  if (err instanceof RepoMapError) {
    error = err;
  } else {
    console.error(`[${tag}] unexpected error:`, err instanceof Error ? err.message : err);
    error = new RepoMapError("UPSTREAM", "Something went wrong on RepoMap's side.", { status: 500, hint: "Try again in a moment." });
  }
  return NextResponse.json({ error: error.toJSON() }, { status: error.status, headers: NO_STORE });
}

/**
 * Streams newline-delimited JSON. `run` sends events until it resolves. If the
 * client goes away, later sends are dropped quietly and `run` keeps going, so
 * work that finishes still lands in the cache.
 */
export function ndjsonResponse<E>(run: (send: (event: E) => void) => Promise<void>, tag: string): Response {
  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: E) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        await run(send);
      } catch (err) {
        console.error(`[${tag}] stream failed:`, err instanceof Error ? err.message : err);
      } finally {
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
    cancel() {
      open = false;
    },
  });
  return new Response(stream, {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Ask proxies not to buffer, so deltas arrive as they're generated.
      "X-Accel-Buffering": "no",
    },
  });
}

/** Best-effort visitor identity for rate limiting. */
export function clientKey(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{40}$/i;

/** `{ repo: "owner/name", sha }` from an AI request body. */
export function parseCommitTarget(body: unknown): { owner: string; repo: string; sha: string } {
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const [owner, repo, extra] = typeof obj.repo === "string" ? obj.repo.split("/") : [];
  if (!owner || !repo || extra !== undefined || !OWNER_RE.test(owner) || !REPO_RE.test(repo)) {
    throw new RepoMapError("BAD_REQUEST", 'Expected "repo" as "owner/name".');
  }
  if (typeof obj.sha !== "string" || !SHA_RE.test(obj.sha)) {
    throw new RepoMapError("BAD_REQUEST", 'Expected "sha" as a full 40-character commit SHA.');
  }
  return { owner, repo, sha: obj.sha.toLowerCase() };
}

export async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new RepoMapError("BAD_REQUEST", "The request body isn't valid JSON.");
  }
}
