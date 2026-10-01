import { getStoredToken } from "@/lib/client/token";
import type { ApiError, RepoTree } from "@/lib/types";

export class ApiClientError extends Error {
  constructor(readonly error: ApiError) {
    super(error.message);
    this.name = "ApiClientError";
  }
}

export async function fetchRepoTree(input: string, signal?: AbortSignal): Promise<RepoTree> {
  const token = getStoredToken();
  let res: Response;
  try {
    res = await fetch(`/api/repo?url=${encodeURIComponent(input)}`, {
      headers: token ? { "x-github-token": token } : {},
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiClientError({
      code: "NETWORK",
      message: "Couldn't reach the RepoMap server.",
      hint: "Check your connection and try again.",
    });
  }

  const body = (await res.json().catch(() => null)) as RepoTree | ErrorBody | null;
  if (res.ok && body && !isErrorBody(body)) return body;

  const error = body && isErrorBody(body) ? body.error : undefined;
  throw new ApiClientError(
    error ?? { code: "UPSTREAM", message: `The server returned an error (${res.status}).`, hint: "Try again in a moment." },
  );
}

type ErrorBody = { error?: ApiError };

function isErrorBody(body: RepoTree | ErrorBody): body is ErrorBody {
  return "error" in body;
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiClientError) return err.error;
  return { code: "UPSTREAM", message: "Something unexpected went wrong.", hint: "Try again in a moment." };
}
