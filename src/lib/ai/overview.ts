import "server-only";

import type { AiContext } from "@/lib/ai/context";
import {
  OVERVIEW_SCHEMA,
  buildOverviewPrompt,
  extractPartialString,
  listOverviewPaths,
  mockOverviewJson,
  parseOverview,
} from "@/lib/ai/overview-format";
import { OVERVIEW_PROMPT_VERSION, OVERVIEW_SYSTEM, inspectContent, prepareContent } from "@/lib/ai/prompts";
import { cacheKeys, getCache } from "@/lib/cache";
import {
  OVERVIEW_ENTRY_FILE_CHARS,
  OVERVIEW_MANIFEST_CHARS,
  OVERVIEW_MAX_LISTED_PATHS,
  OVERVIEW_README_CHARS,
} from "@/lib/config";
import { readRepoFile } from "@/lib/github/files";
import { RepoMapError } from "@/lib/github/errors";
import { runShared } from "@/lib/jobs";
import type { ProjectOverview } from "@/lib/types";

const OVERVIEW_MAX_TOKENS = 16_000;
const MAX_MANIFESTS = 6;
const MAX_ENTRY_FILES = 4;

/**
 * The project overview: what it is, tech stack, where to start, and a reading
 * order, grounded in the README, manifests, entry-point files and the real
 * path list. `onPartial` receives the "what" paragraph as it streams.
 */
export async function generateOverview(ctx: AiContext, onPartial: (what: string) => void): Promise<ProjectOverview> {
  const { meta } = ctx;
  const key = cacheKeys.overview(meta.owner, meta.repo, meta.commitSha, `${OVERVIEW_PROMPT_VERSION}:${ctx.provider.model}`);
  const cached = await getCache().get<ProjectOverview>(key);
  if (cached) return cached;

  return runShared<ProjectOverview, string>(
    key,
    async (emit) => {
      if (!ctx.allowGeneration()) {
        throw new RepoMapError("AI_RATE_LIMITED", "You've generated a lot of overviews in a short time.", {
          hint: "Wait a few minutes and reload.",
        });
      }
      const evidence = await gatherEvidence(ctx);
      let buffer = "";
      let lastWhat = "";
      const result = await ctx.provider.stream(
        {
          system: OVERVIEW_SYSTEM,
          prompt: buildOverviewPrompt(evidence),
          effort: "medium",
          maxTokens: OVERVIEW_MAX_TOKENS,
          jsonSchema: OVERVIEW_SCHEMA,
          mock: mockOverviewJson(evidence),
        },
        (delta) => {
          buffer += delta;
          const what = extractPartialString(buffer, "what");
          if (what !== null && what !== lastWhat) {
            lastWhat = what;
            emit(what);
          }
        },
      );
      const overview = parseOverview(result.text, ctx.nodes, result.model);
      if (!overview.what) throw new RepoMapError("AI_ERROR", "The AI overview came back empty.", { hint: "Reload to try again." });
      await getCache().set(key, overview);
      return overview;
    },
    onPartial,
  );
}

async function gatherEvidence(ctx: AiContext) {
  const read = async (path: string, maxChars: number) => {
    const raw = await readRepoFile(ctx.meta, path, ctx.auth).catch(() => null);
    return raw !== null && inspectContent(raw) === "text" ? { path, content: prepareContent(raw, maxChars) } : null;
  };
  const present = <T>(items: (T | null)[]) => items.filter((x): x is T => x !== null);

  const points = ctx.entryPoints.points;
  const manifestPaths = ctx.entryPoints.filesRead
    .filter((p) => p !== ctx.readmePath && !p.startsWith(".github/"))
    .slice(0, MAX_MANIFESTS);
  const entryFilePaths = points
    .filter((p) => ctx.nodes[p.path]?.type === "file" && ctx.nodes[p.path]?.kind === "source")
    .slice(0, MAX_ENTRY_FILES)
    .map((p) => p.path);

  const [readme, manifests, entryFiles] = await Promise.all([
    ctx.readmePath ? read(ctx.readmePath, OVERVIEW_README_CHARS) : Promise.resolve(null),
    Promise.all(manifestPaths.map((p) => read(p, OVERVIEW_MANIFEST_CHARS))).then(present),
    Promise.all(entryFilePaths.map((p) => read(p, OVERVIEW_ENTRY_FILE_CHARS))).then(present),
  ]);

  const mustInclude = [...(ctx.readmePath ? [ctx.readmePath] : []), ...manifestPaths, ...points.map((p) => p.path)];
  return {
    meta: ctx.meta,
    nodes: ctx.nodes,
    stats: ctx.stats,
    entryPoints: points,
    readme,
    manifests,
    entryFiles,
    paths: listOverviewPaths(ctx.nodes, mustInclude, OVERVIEW_MAX_LISTED_PATHS),
  };
}
