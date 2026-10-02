/** Max tree entries returned to the client. Shallow entries are kept first. */
export const MAX_TREE_NODES = 25_000;

/** Files larger than this are shown on the map but not sent to the AI. */
export const MAX_ANALYZABLE_FILE_BYTES = 200_000;

/** How long a public repo's ref → commit SHA resolution is reused. */
export const REF_CACHE_TTL_SECONDS = 300;

/** Per-folder row cap in the file list before "Show more". */
export const TREE_LIST_PAGE_SIZE = 200;

/** Timeout for a single GitHub API request. */
export const GITHUB_TIMEOUT_MS = 20_000;

/** Children shown per folder on the graph before a "+N more" node. */
export const GRAPH_PAGE_SIZE = 30;

/** Above this many visible graph nodes, RepoMap suggests collapsing folders. */
export const LARGE_GRAPH_THRESHOLD = 800;

/** Most manifest/config files read per commit to find entry points. */
export const MAX_ENTRY_POINT_READS = 16;

/** Manifests larger than this aren't read for entry-point detection. */
export const MAX_MANIFEST_BYTES = 256_000;

/** Wall-clock budget for reading manifests before entry points are computed without the rest. */
export const ENTRY_POINT_READ_BUDGET_MS = 5_000;

/** Minimum score for a "Start here" badge. */
export const ENTRY_POINT_MIN_SCORE = 0.5;

/** Most "Start here" badges shown for one commit. */
export const MAX_ENTRY_POINTS = 8;

/** Entry points computed from a partial read are retried after this long instead of cached forever. */
export const INCOMPLETE_ENTRY_POINTS_TTL_SECONDS = 600;

/** Claude model for summaries and the overview. Override with REPOMAP_AI_MODEL. */
export const DEFAULT_AI_MODEL = "claude-opus-5-5";

/** Characters of a file shown to the model; longer files are cut and the summary says so. */
export const SUMMARY_MAX_FILE_CHARS = 24_000;

/** Folder summaries: how many child files without summaries get an excerpt, and how long. */
export const FOLDER_EXCERPT_FILES = 6;
export const FOLDER_EXCERPT_CHARS = 2_000;

/** Paths per POST /api/summaries request (keeps each request well under serverless time limits). */
export const SUMMARY_PATHS_PER_REQUEST = 8;

/** Summaries generated up front for the top two levels of the tree. */
export const SUMMARY_PREFETCH_LIMIT = 30;

/** Overview inputs. */
export const OVERVIEW_README_CHARS = 8_000;
export const OVERVIEW_MANIFEST_CHARS = 3_000;
export const OVERVIEW_ENTRY_FILE_CHARS = 5_000;
export const OVERVIEW_MAX_LISTED_PATHS = 400;

/** Per-visitor AI generation limits (in-memory, per server instance). */
export const AI_LIMIT_WINDOW_SECONDS = 600;
export const AI_LIMIT_SUMMARIES = 150;
export const AI_LIMIT_OVERVIEWS = 15;
