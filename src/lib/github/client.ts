import "server-only";

import { GITHUB_TIMEOUT_MS } from "@/lib/config";
import type { GitTreeEntry } from "@/lib/github/build-tree";
import { RepoMapError } from "@/lib/github/errors";

const GITHUB_API = "https://api.github.com";

export type AuthSource = "user" | "server" | "none";

export interface GitHubAuth {
  token?: string;
  /** Who the token belongs to. Changes error wording and private-repo rules. */
  source: AuthSource;
}

/** Subset of `GET /repos/{owner}/{repo}` that RepoMap uses. */
export interface GitHubRepo {
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  html_url: string;
  homepage: string | null;
  default_branch: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  license: { spdx_id: string | null; name: string } | null;
  topics?: string[];
}

export interface GitHubTree {
  sha: string;
  truncated: boolean;
  tree: GitTreeEntry[];
}

/**
 * Picks credentials: the visitor's own token if they sent one, otherwise the
 * server's optional GITHUB_TOKEN, otherwise anonymous (60 requests/hour).
 */
export function resolveAuth(userToken: string | null | undefined): GitHubAuth {
  const token = userToken?.trim();
  if (token) {
    if (token.length > 255 || !/^[\x21-\x7e]+$/.test(token)) {
      throw new RepoMapError("BAD_TOKEN", "That GitHub token isn't in a valid format.", {
        hint: "Paste the token exactly as GitHub showed it, with no spaces or line breaks.",
      });
    }
    return { token, source: "user" };
  }
  const serverToken = process.env.GITHUB_TOKEN?.trim();
  if (serverToken) return { token: serverToken, source: "server" };
  return { source: "none" };
}

export async function getRepository(owner: string, repo: string, auth: GitHubAuth): Promise<GitHubRepo> {
  try {
    const res = await ghFetch(`/repos/${enc(owner)}/${enc(repo)}`, auth);
    return (await res.json()) as GitHubRepo;
  } catch (err) {
    if (err instanceof RepoMapError && err.code === "NOT_FOUND") {
      throw new RepoMapError("NOT_FOUND", `Couldn't find the repository ${owner}/${repo}.`, {
        hint:
          auth.source === "user"
            ? "Check the spelling, and make sure your token has access to this repository."
            : "Check the spelling. If it's a private repository, add a GitHub token that can access it.",
      });
    }
    throw err;
  }
}

/** Resolves a branch, tag or (partial) SHA to a full commit SHA. */
export async function getCommitSha(owner: string, repo: string, ref: string, auth: GitHubAuth): Promise<string> {
  try {
    const res = await ghFetch(
      `/repos/${enc(owner)}/${enc(repo)}/commits/${enc(ref)}`,
      auth,
      "application/vnd.github.sha",
    );
    const sha = (await res.text()).trim();
    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      throw new RepoMapError("UPSTREAM", "GitHub returned an unexpected response while resolving the branch.");
    }
    return sha;
  } catch (err) {
    if (err instanceof RepoMapError && (err.code === "NOT_FOUND" || err.status === 422)) {
      throw new RepoMapError("REF_NOT_FOUND", `Couldn't find a branch, tag or commit named "${ref}" in ${owner}/${repo}.`);
    }
    throw err;
  }
}

export async function getRecursiveTree(owner: string, repo: string, sha: string, auth: GitHubAuth): Promise<GitHubTree> {
  const res = await ghFetch(`/repos/${enc(owner)}/${enc(repo)}/git/trees/${enc(sha)}?recursive=1`, auth);
  return (await res.json()) as GitHubTree;
}

// ─── Transport ───────────────────────────────────────────────────────────

async function ghFetch(path: string, auth: GitHubAuth, accept = "application/vnd.github+json"): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "RepoMap",
  };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;

  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}${path}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new RepoMapError(
      "NETWORK",
      timedOut ? "GitHub took too long to respond." : "Couldn't reach GitHub.",
      { hint: "Check your connection and try again in a moment." },
    );
  }

  if (res.ok) return res;
  throw await errorFromResponse(res, auth);
}

async function errorFromResponse(res: Response, auth: GitHubAuth): Promise<RepoMapError> {
  let message = "";
  try {
    message = ((await res.json()) as { message?: string }).message ?? "";
  } catch {
    // Body wasn't JSON; status code is enough.
  }

  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  const retryAfter = res.headers.get("retry-after");
  const isRateLimit =
    (res.status === 403 || res.status === 429) &&
    (remaining === "0" || retryAfter !== null || /rate limit/i.test(message));

  if (isRateLimit) {
    const resetAt = reset
      ? new Date(Number(reset) * 1000).toISOString()
      : retryAfter
        ? new Date(Date.now() + Number(retryAfter) * 1000).toISOString()
        : undefined;
    const copy: Record<AuthSource, [string, string]> = {
      none: [
        "GitHub's anonymous rate limit (60 requests per hour) has been reached.",
        "Add a GitHub token to raise the limit to 5,000 requests per hour.",
      ],
      server: [
        "RepoMap's shared GitHub quota is used up for now.",
        "Add your own GitHub token to keep going right away.",
      ],
      user: [
        "Your GitHub token has hit its rate limit.",
        "Wait for the limit to reset, then try again.",
      ],
    };
    const [msg, hint] = copy[auth.source];
    return new RepoMapError("RATE_LIMITED", msg, { hint, resetAt });
  }

  switch (res.status) {
    case 401:
      return new RepoMapError(
        "BAD_TOKEN",
        auth.source === "user"
          ? "GitHub rejected your token. It may have expired or been revoked."
          : "GitHub rejected the server's token.",
        { hint: auth.source === "user" ? "Update or remove the token in GitHub token settings." : undefined },
      );
    case 404:
      return new RepoMapError("NOT_FOUND", "GitHub couldn't find that resource.");
    case 409:
      return new RepoMapError("EMPTY_REPO", "This repository is empty.", {
        hint: "There are no commits yet, so there's nothing to map.",
      });
    case 422:
      return new RepoMapError("UPSTREAM", message || "GitHub couldn't process the request.", { status: 422 });
    case 451:
      return new RepoMapError("BLOCKED", "GitHub has blocked access to this repository (for example, a DMCA takedown).");
    case 403:
      return new RepoMapError("FORBIDDEN", "GitHub denied access to this repository.", {
        hint: /saml|sso/i.test(message)
          ? "This organization requires SAML SSO. Authorize your token for the organization on GitHub."
          : auth.source === "user"
            ? "Your token may be missing the permissions needed to read this repository."
            : undefined,
      });
    default:
      return new RepoMapError(
        "UPSTREAM",
        res.status >= 500 ? "GitHub is having trouble right now." : `GitHub returned an error (${res.status}).`,
        { hint: "Try again in a moment." },
      );
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}
