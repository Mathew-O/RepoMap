/**
 * Shared data model for RepoMap. Imported by both server and client code,
 * so keep this file free of runtime dependencies.
 */

// ─── Input ────────────────────────────────────────────────────────────────

/** Result of parsing whatever the user pasted into the URL box. */
export interface ParsedRepoUrl {
  owner: string;
  repo: string;
  /** Which github.com view the URL pointed at, if any. */
  view?: "tree" | "blob" | "commit";
  /**
   * Raw "<ref>/<path>" after /tree/ or /blob/. Branch names can contain
   * slashes, so the server decides where the ref ends and the path begins.
   */
  treeish?: string;
}

// ─── Repository + tree ───────────────────────────────────────────────────

export interface RepoMeta {
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  homepage: string | null;
  defaultBranch: string;
  /** Branch, tag or SHA being viewed. */
  ref: string;
  refIsDefault: boolean;
  /** Commit SHA that `ref` resolved to. Part of every cache key. */
  commitSha: string;
  /** Path inside the repo the URL pointed at (/tree/<ref>/<path>), if any. */
  requestedPath: string | null;
  /** `requestedPath` if it exists in the tree, otherwise null. */
  focusPath: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  stars: number;
  forks: number;
  language: string | null;
  license: string | null;
  topics: string[];
}

export type NodeType = "dir" | "file" | "submodule" | "symlink";

export type FileKind =
  | "source"
  | "test"
  | "config"
  | "docs"
  | "build"
  | "asset"
  | "other";

/** Why a file is excluded from AI analysis (it's still shown on the map). */
export type SkipReason =
  | "binary"
  | "asset"
  | "lockfile"
  | "vendored"
  | "generated"
  | "too-large";

export interface TreeNode {
  /** Repo-relative path. The root is "". */
  path: string;
  name: string;
  type: NodeType;
  /** Parent path; null only for the root. */
  parent: string | null;
  /** Root is 0, top-level entries are 1. */
  depth: number;
  kind: FileKind;
  /** Git object SHA (blob or tree). */
  sha: string;
  /** Bytes. Files only. */
  size?: number;
  skip?: SkipReason;
  /** Dirs only: child paths, directories first, then case-insensitive A→Z. */
  children?: string[];
  /** Dirs only: total files beneath this directory (among returned nodes). */
  fileCount?: number;
  /** Dirs only: direct children dropped by the node cap. */
  hiddenChildren?: number;
}

export interface TreeStats {
  files: number;
  dirs: number;
  /** Files excluded from AI analysis. */
  skipped: number;
  totalBytes: number;
  byKind: Record<FileKind, number>;
}

export interface TreeTruncation {
  /** GitHub's recursive tree API hit its own limit (~100k entries / 7 MB). */
  github: boolean;
  /** RepoMap dropped the deepest entries to stay under `limit`. */
  capped: boolean;
  limit: number;
  totalEntries: number;
  returnedEntries: number;
}

/** Immutable per commit SHA, which makes it safe to cache forever. */
export interface TreeSnapshot {
  nodes: Record<string, TreeNode>;
  stats: TreeStats;
  truncation: TreeTruncation;
}

export interface RepoTree extends TreeSnapshot {
  meta: RepoMeta;
  /** "Start here" candidates for this commit. */
  entryPoints: EntryPointReport;
  fetchedAt: string;
  /** True if the tree came from cache rather than GitHub. */
  cached: boolean;
}

// ─── Errors ──────────────────────────────────────────────────────────────

export type ApiErrorCode =
  | "INVALID_URL"
  | "NOT_FOUND"
  | "PRIVATE_REPO"
  | "REF_NOT_FOUND"
  | "EMPTY_REPO"
  | "RATE_LIMITED"
  | "BAD_TOKEN"
  | "FORBIDDEN"
  | "BLOCKED"
  | "UPSTREAM"
  | "NETWORK";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  hint?: string;
  /** ISO timestamp for rate-limit resets. */
  resetAt?: string;
}

// ─── Entry points ────────────────────────────────────────────────────────

/** A file (or occasionally a folder) worth reading first. */
export interface EntryPoint {
  path: string;
  /** Human-readable evidence, strongest first, e.g. `package.json "bin"`. */
  reasons: string[];
  /** Heuristics today; the LLM refines the list in milestone 4. */
  source: "heuristic" | "llm";
  /** 0–1. Independent signals combine, so two weak hints beat one. */
  score: number;
}

export interface EntryPointReport {
  /** Ranked, strongest first. Empty when nothing stood out. */
  points: EntryPoint[];
  /** Manifests and configs whose contents were read to find them. */
  filesRead: string[];
  /** Some files couldn't be fetched (rate limit, timeout), so the list may be missing items. */
  incomplete: boolean;
}

// ─── Planned (later milestones) ──────────────────────────────────────────

/** M4 */
export type SummaryTarget = "file" | "folder" | "overview";

export type SummaryStatus =
  | "ok"
  | "skipped"
  | "too-large"
  | "unclear"
  | "error";

export interface Summary {
  path: string;
  target: SummaryTarget;
  text: string;
  status: SummaryStatus;
  model: string;
  createdAt: string;
}

export interface ProjectOverview {
  what: string;
  techStack: string[];
  whereToStart: string;
  readingOrder: { path: string; why: string }[];
}

/** M5 */
export interface CodeSymbol {
  name: string;
  kind: "function" | "class" | "const" | "type" | "interface" | "default" | "other";
  line: number;
}

export interface ImportRef {
  /** As written in the source, e.g. "./utils" or "react". */
  specifier: string;
  /** Repo path if it resolved to a file in this repo. */
  resolved: string | null;
  external: boolean;
}

export interface FileDetails {
  path: string;
  language: string | null;
  symbols: CodeSymbol[];
  imports: ImportRef[];
  importedBy: string[];
}
