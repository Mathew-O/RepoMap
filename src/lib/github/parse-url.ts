import type { ParsedRepoUrl } from "@/lib/types";

export type ParseResult =
  | { ok: true; value: ParsedRepoUrl }
  | { ok: false; error: string };

// Lenient on purpose: some legacy GitHub accounts have doubled hyphens.
const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;

/** First path segments on github.com that are site pages, not owners. */
const RESERVED_OWNERS = new Set([
  "about", "apps", "codespaces", "collections", "contact", "customer-stories",
  "enterprise", "events", "explore", "features", "issues", "login", "join",
  "marketplace", "new", "notifications", "orgs", "organizations", "pricing",
  "pulls", "search", "security", "settings", "site", "sponsors", "topics",
  "trending", "users",
]);

const EXAMPLE = "https://github.com/owner/repo";

/**
 * Accepts the shapes people actually paste:
 *   owner/repo · github.com/owner/repo · https://github.com/owner/repo.git
 *   git@github.com:owner/repo.git · …/tree/<ref>/<path> · …/blob/<ref>/<file>
 *   …/commit/<sha> · any other repo sub-page (issues, pulls…) → default branch
 */
export function parseRepoUrl(raw: string): ParseResult {
  const input = raw.trim();
  if (!input) return fail(`Paste a GitHub repository URL, like ${EXAMPLE}.`);

  let pathPart: string;

  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/](.+)$/i.exec(input);
  if (ssh) {
    pathPart = ssh[1]!;
  } else {
    let candidate = input;
    // GitHub owner names can't contain dots, so "x.y/…" is a hostname without a scheme.
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(candidate)) candidate = `https://${candidate}`;

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
      let url: URL;
      try {
        url = new URL(candidate);
      } catch {
        return fail(`That doesn't look like a valid URL. Try something like ${EXAMPLE}.`);
      }
      const host = url.hostname.toLowerCase();
      if (host !== "github.com" && host !== "www.github.com") {
        if (host.endsWith("github.com") || host.endsWith("githubusercontent.com")) {
          return fail(`${host} links aren't supported. Use the repository's github.com URL instead.`);
        }
        return fail(`RepoMap only works with GitHub repositories (that link points to ${host}).`);
      }
      pathPart = url.pathname;
    } else if (/\s/.test(candidate)) {
      return fail(`That doesn't look like a repository. Try something like ${EXAMPLE}.`);
    } else {
      pathPart = candidate.replace(/[?#].*$/, "");
    }
  }

  const segments = pathPart.split("/").filter(Boolean).map(safeDecode);

  if (segments.length === 0) {
    return fail(`That URL doesn't include a repository. Try something like ${EXAMPLE}.`);
  }
  if (segments.length === 1) {
    const only = segments[0]!;
    return fail(
      `"${only}" looks like a user or organization, not a repository. Add the repo name, e.g. ${only}/<repo>.`,
    );
  }

  const [owner, rawRepo, view, ...rest] = segments as [string, string, ...string[]];
  const repo = rawRepo.replace(/\.git$/i, "");

  if (RESERVED_OWNERS.has(owner.toLowerCase())) {
    return fail(`That's a GitHub page, not a repository. Try something like ${EXAMPLE}.`);
  }
  if (!OWNER_RE.test(owner)) {
    return fail(`"${owner}" isn't a valid GitHub user or organization name.`);
  }
  if (!REPO_RE.test(repo) || repo === "." || repo === "..") {
    return fail(`"${rawRepo}" isn't a valid repository name.`);
  }

  const value: ParsedRepoUrl = { owner, repo };

  if ((view === "tree" || view === "blob") && rest.length > 0) {
    value.view = view;
    value.treeish = rest.join("/");
  } else if (view === "commit" && rest[0] && SHA_RE.test(rest[0])) {
    value.view = "commit";
    value.treeish = rest[0];
  }

  return { ok: true, value };
}

/** App route for a parsed URL. Mirrors github.com so links are guessable. */
export function explorerPath(parsed: ParsedRepoUrl): string {
  const base = `/${parsed.owner}/${parsed.repo}`;
  if (!parsed.view || !parsed.treeish) return base;
  const tail = parsed.treeish.split("/").map(encodeURIComponent).join("/");
  return `${base}/${parsed.view}/${tail}`;
}

/** Canonical "owner/repo[/view/treeish]" string, used as the API input. */
export function toRepoInput(parsed: ParsedRepoUrl): string {
  const base = `${parsed.owner}/${parsed.repo}`;
  return parsed.view && parsed.treeish ? `${base}/${parsed.view}/${parsed.treeish}` : base;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function fail(error: string): ParseResult {
  return { ok: false, error };
}
