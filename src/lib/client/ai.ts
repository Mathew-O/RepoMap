import { ApiClientError } from "@/lib/client/api";
import { readNdjson } from "@/lib/client/ndjson";
import { getStoredToken } from "@/lib/client/token";
import type { ApiError, OverviewEvent, SummaryEvent } from "@/lib/types";

export interface CommitTarget {
  /** "owner/name" */
  repo: string;
  sha: string;
}

export function streamSummaries(
  target: CommitTarget,
  paths: string[],
  onEvent: (event: SummaryEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return postStream("/api/summaries", { ...target, paths }, onEvent, signal);
}

export function streamOverview(target: CommitTarget, onEvent: (event: OverviewEvent) => void, signal?: AbortSignal) {
  return postStream("/api/overview", target, onEvent, signal);
}

/** POSTs JSON and reads an NDJSON stream back. Non-2xx answers throw ApiClientError. */
async function postStream<E>(url: string, body: unknown, onEvent: (event: E) => void, signal?: AbortSignal) {
  const token = getStoredToken();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "x-github-token": token } : {}) },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiClientError({ code: "NETWORK", message: "Couldn't reach the RepoMap server.", hint: "Check your connection." });
  }

  if (!res.ok || !res.body) {
    const payload = (await res.json().catch(() => null)) as { error?: ApiError } | null;
    throw new ApiClientError(
      payload?.error ?? { code: "UPSTREAM", message: `The server returned an error (${res.status}).`, hint: "Try again in a moment." },
    );
  }
  await readNdjson(res.body, onEvent);
}
