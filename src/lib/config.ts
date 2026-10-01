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
