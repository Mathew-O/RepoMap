# RepoMap

Understand an unfamiliar GitHub repository: paste a URL and get a map of the codebase, where to start reading,
and grounded AI explanations of every folder and file.

> **Status:** milestone 4 of 6. Done so far: URL input, GitHub tree fetching with caching, an interactive
> map with expand/collapse, pan/zoom, minimap, a details panel (a bottom sheet on mobile), a GitHub-style
> file list, **Start here** badges on detected entry points, and streamed **AI summaries** of files and
> folders plus a project overview. The import graph and polish come next.
> See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Getting started

```bash
npm install
cp .env.example .env.local   # optional: add GITHUB_TOKEN
npm run dev                  # http://localhost:3000
```

App URLs mirror github.com, so you can swap the domain:
`http://localhost:3000/vercel/next.js/tree/canary/packages`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript check |

## GitHub rate limits

Anonymous requests get 60 GitHub API calls per hour, and opening an uncached repo takes about 3.
To raise the limit:

- **Per visitor:** use **Add token** in the header. The token stays in the browser and is sent with each request; it is never stored on the server.
- **Server-wide:** set `GITHUB_TOKEN` in `.env.local`. For safety it is only used for **public** repos.

Trees are cached per commit SHA in `.cache/repomap/` (gitignored), so repeat visits make 0–2 GitHub calls.
Entry-point detection reads a few manifests (package.json, pyproject.toml, Dockerfile, README…) per commit.
For public repos those come from `raw.githubusercontent.com`, which doesn't count against the API limit.

## AI summaries

Set `ANTHROPIC_API_KEY` (in `.env.local`, or in Vercel's environment variables) to turn on:

- **Overview** at the top of each repo: what it is, tech stack, where to start, and a 5–8 file reading order.
  Its start-here picks refine the heuristic badges.
- **File and folder summaries** (1–2 sentences) in the details panel, the Files list and map tooltips.
  The top two levels are generated when a repo opens; everything else on click. Folder summaries roll up
  their children's summaries.

Every summary is grounded in the file's actual contents. Long files are cut at 24,000 characters and the
summary says so; binaries, lockfiles, vendored/generated code and files over 200 KB aren't sent at all.
Results are cached per commit, so each file is summarized once per commit.

The model is `claude-opus-5-5` by default (`REPOMAP_AI_MODEL` changes it). Requests opt into Anthropic's
server-side refusal fallback, so a declined request is retried on the recommended fallback model.
Opening a new repo costs one overview plus up to 30 summaries; each visitor is limited to 150 summaries
and 15 overviews per 10 minutes per server instance.

Without a key, the AI features show as off and everything else works. For UI work without a key,
`REPOMAP_AI_MOCK=1 npm run dev` streams placeholder "[Mock]" summaries.

## Deploying to Vercel

1. Go to [vercel.com/new](https://vercel.com/new), sign in with GitHub, and import `Mathew-O/RepoMap`.
   Vercel detects Next.js, so no build settings are needed.
2. Under **Environment Variables**, add `GITHUB_TOKEN`: a fine-grained token with read-only access to public repos.
   This matters on Vercel because serverless functions share outbound IPs, and GitHub's anonymous
   60 requests/hour limit runs out quickly there. Add `ANTHROPIC_API_KEY` too, for the AI features.
3. Click **Deploy**. Every push to `main` redeploys automatically.

On Vercel the file cache lives in the function's temp directory, so it's per-instance and short-lived.
For a shared cache, implement `CacheStore` with Redis or Postgres (see `src/lib/cache/`).
