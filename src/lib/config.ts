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
