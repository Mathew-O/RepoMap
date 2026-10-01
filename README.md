# RepoMap

Understand an unfamiliar GitHub repository: paste a URL and get a map of the codebase, where to start reading,
and grounded AI explanations of every folder and file.

> **Status:** milestone 1 of 6. URL input, GitHub tree fetching, caching and a GitHub-style file browser are done.
> The interactive graph, entry-point detection, AI summaries and import graph come next.
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
