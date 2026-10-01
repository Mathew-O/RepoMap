# RepoMap architecture

## Folder structure

Paths marked `(M2)`–`(M6)` are planned for later milestones and don't exist yet.

```
src/
├─ app/
│  ├─ layout.tsx                      GitHub-style shell (header, footer, theme tokens)
│  ├─ globals.css                     Primer-derived color tokens (light + dark) → Tailwind theme
│  ├─ page.tsx                        Landing page: URL input, examples
│  ├─ [owner]/[repo]/[[...rest]]/     Explorer. Mirrors github.com URLs, so
│  │  └─ page.tsx                     /vercel/next.js/tree/canary/packages works
│  └─ api/
│     ├─ repo/route.ts                GET  repo metadata + normalized file tree
│     ├─ file/route.ts           (M4) GET  file contents on demand (size-capped)
│     ├─ summary/route.ts        (M4) POST streamed file/folder summary
│     ├─ overview/route.ts       (M4) POST streamed project overview + reading order
│     └─ details/route.ts        (M5) GET  symbols, imports, imported-by for a file
├─ components/
│  ├─ layout/                         SiteHeader, SiteFooter
│  ├─ repo-input/                     RepoUrlForm (hero + compact), TokenSettings
│  ├─ repo/                           RepoExplorer/Workspace (shared view state), RepoHeader (Map/Files tabs),
│  │                                  TreeList, NodeIcon, ErrorState, skeletons
│  ├─ graph/                          RepoGraph (React Flow canvas), custom entry/"more" nodes
│  ├─ panel/                          DetailsPanel, Breadcrumbs, mobile BottomSheet (AI summary lands here in M4)
│  └─ ui/                             Small Primer-style primitives (Flash, Label, Counter…)
├─ hooks/                             useRepoTree (+ later useSummary, useReadingPath)
└─ lib/
   ├─ types.ts                        ★ Shared data model (client + server)
   ├─ config.ts                       Limits: node cap, file size cap, TTLs
   ├─ format.ts                       Number/byte formatting
   ├─ classify.ts                     File kind (source/test/config/docs/build) + skip rules
   ├─ language-colors.ts              GitHub linguist colors for the repo header
   ├─ tree-utils.ts                   ancestors, breadcrumbs chain, kind roll-ups, GitHub permalinks
   ├─ graph/layout.ts                 Visible tree → left-to-right tidy tree (d3-hierarchy); pure
   ├─ github/
   │  ├─ parse-url.ts                 Accepts many URL shapes; pure, shared with client
   │  ├─ client.ts                    REST calls + error mapping (server only)
   │  ├─ build-tree.ts                git tree entries → normalized TreeNode map; pure
   │  └─ repo-service.ts              Orchestrates resolve → cache → fetch → build
   ├─ cache/
   │  ├─ types.ts                     CacheStore interface (get/set/delete)
   │  ├─ memory-store.ts              LRU in front of the durable store
   │  ├─ file-store.ts                JSON files on disk (swap for Redis/Postgres here)
   │  ├─ keys.ts                      Versioned key builders
   │  └─ index.ts                     getCache() singleton
   ├─ client/                         Browser-only: token storage, API fetchers
   ├─ analysis/                  (M3/M5) entry-points.ts, imports/{js,py,go,rust}.ts, symbols
   └─ ai/                        (M4) anthropic.ts, prompts.ts, grounding helpers
```

## Data model (`src/lib/types.ts`)

The tree is a **flat map keyed by path** rather than a nested object. Every later
feature (graph expansion, summaries, import edges, reading path, search) looks
things up by path, and a flat map serializes and caches cleanly.

```ts
RepoMeta      owner, repo, description, defaultBranch, ref, commitSha, requestedPath, focusPath,
              isPrivate, stars, forks, language, license, topics, htmlUrl
TreeNode      path ('' = root), name, type (dir|file|submodule|symlink), parent, depth,
              kind (source|test|config|docs|build|asset|other), sha, size,
              skip? (binary|asset|lockfile|vendored|generated|too-large),
              children? (sorted dirs-first), fileCount?, hiddenChildren?
RepoTree      meta + nodes: Record<path, TreeNode> + stats + truncation + cached flag
ApiError      code (INVALID_URL | NOT_FOUND | RATE_LIMITED | BAD_TOKEN | …), message, hint, resetAt
```

Planned shapes, already declared in `types.ts` so later milestones plug in:

```ts
EntryPoint       (M3) path, reasons[], source (heuristic|llm), score
Summary          (M4) path, target (file|folder|overview), text, status, model, createdAt
ProjectOverview  (M4) what, techStack[], whereToStart, readingOrder[{path, why}]
FileDetails      (M5) path, language, symbols[], imports[{specifier, resolved, external}], importedBy[]
```

## Caching

Interface: `CacheStore { get, set(ttl?), delete }`. Today it's `MemoryStore → FileStore`.
A Redis or Postgres store only has to implement the same three methods.

| Key | Value | TTL |
|---|---|---|
| `v1:ref:{owner}/{repo}:{treeish}` | resolved meta + commit SHA (**public repos only**) | 5 min |
| `v1:tree2:{owner}/{repo}@{sha}` | normalized tree snapshot (the number is `TREE_FORMAT`, bumped when classification changes) | ∞ (immutable per SHA) |
| `v1:file:{owner}/{repo}@{sha}:{path}` (M4) | file contents | ∞ |
| `v1:sum:{owner}/{repo}@{sha}:{path}:{promptVersion}` (M4) | summary | ∞ |

Access control: every request re-checks repo access with the caller's own credentials
before it reads any SHA-keyed cache entry. The only exception is the short-lived ref cache,
and that one is only written for public repos. Private repos are never served with the
server's `GITHUB_TOKEN`; they need the visitor's own token.

## Request flow (milestone 1)

```
/[owner]/[repo]/…  →  RepoExplorer (client)  →  GET /api/repo?url=…  (x-github-token header, optional)
   parseRepoUrl → resolve repo + ref → commit SHA   (2 GitHub calls, or 0 on ref-cache hit)
   cache.get(tree@sha) ─ miss → GET git/trees/{sha}?recursive=1 → buildTree() → cache.set
   → RepoTree JSON
```

## Map (milestone 2)

- **One state, two views.** `RepoWorkspace` owns the selection, the set of expanded folders and
  "reveal" requests. The Map and the Files list both read and update that same state, so expanding or
  selecting in one shows up in the other.
- **Layout.** `layoutTree()` lays out only what's visible: the root, its children and the children of
  expanded folders. It's a left-to-right tidy tree with fixed node sizes, so layout runs before React Flow
  measures anything. Large folders show `GRAPH_PAGE_SIZE` children and then a "+N more" node, and folders
  that lost entries to the server-side cap get a "not loaded" node.
- **Stable clicks.** Expanding a folder reflows the tree. The viewport shifts by however much the clicked
  node moved, so it stays under the pointer.
- **Reveal.** Deep links, breadcrumbs and the panel's contents list expand the target's ancestors and
  center the map on it once React Flow has initialized.
