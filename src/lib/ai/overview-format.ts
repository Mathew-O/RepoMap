import type { PreparedContent } from "@/lib/ai/prompts";
import { RepoMapError } from "@/lib/github/errors";
import { formatNumber } from "@/lib/format";
import type { EntryPoint, ProjectOverview, ReadingStep, RepoMeta, TreeNode, TreeStats } from "@/lib/types";

type Nodes = Readonly<Record<string, TreeNode>>;

const MAX_TECH = 12;
const MAX_START_HERE = 4;
const MAX_READING_STEPS = 8;

const STEP_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string", description: "Exact path from the PATHS list." },
    why: { type: "string", description: "One sentence." },
  },
  required: ["path", "why"],
  additionalProperties: false,
};

/** Structured-output schema. `what` comes first so it can be shown while the rest streams. */
export const OVERVIEW_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    what: { type: "string", description: "Two or three sentences: what the project is and does, and for whom." },
    techStack: { type: "array", items: { type: "string" }, description: "Languages, frameworks and major tools the evidence shows." },
    whereToStart: { type: "string", description: "One or two sentences telling a newcomer what to open first and why." },
    startHere: { type: "array", items: STEP_SCHEMA, description: "One to four entry points." },
    readingOrder: { type: "array", items: STEP_SCHEMA, description: "Five to eight files in reading order." },
  },
  required: ["what", "techStack", "whereToStart", "startHere", "readingOrder"],
  additionalProperties: false,
};

// ─── Prompt ──────────────────────────────────────────────────────────────

export interface OverviewEvidence {
  meta: RepoMeta;
  nodes: Nodes;
  stats: TreeStats;
  entryPoints: EntryPoint[];
  readme: { path: string; content: PreparedContent } | null;
  manifests: { path: string; content: PreparedContent }[];
  entryFiles: { path: string; content: PreparedContent }[];
  paths: string[];
}

export function buildOverviewPrompt(e: OverviewEvidence): string {
  const { meta, stats } = e;
  const lines = [
    `Repository: ${meta.fullName}`,
    meta.description ? `Description: ${meta.description}` : "Description: (none)",
    [meta.language && `Primary language: ${meta.language}`, meta.topics.length > 0 && `Topics: ${meta.topics.join(", ")}`]
      .filter(Boolean)
      .join(" · "),
    `Size: ${formatNumber(stats.files)} files in ${formatNumber(stats.dirs)} folders (source ${formatNumber(stats.byKind.source)}, tests ${formatNumber(stats.byKind.test)}, config ${formatNumber(stats.byKind.config)}, docs ${formatNumber(stats.byKind.docs)}).`,
  ].filter(Boolean);

  if (e.entryPoints.length) {
    lines.push("", "Entry-point candidates found by heuristics (confirm or replace them):");
    for (const point of e.entryPoints) lines.push(`- ${point.path}: ${point.reasons.join("; ")}`);
  }
  if (e.readme) lines.push("", block(e.readme.path, e.readme.content));
  for (const m of e.manifests) lines.push("", block(m.path, m.content));
  for (const f of e.entryFiles) lines.push("", block(f.path, f.content));

  lines.push("", `PATHS (${formatNumber(e.paths.length)} of ${formatNumber(stats.files)} files, shallowest first):`, ...e.paths);
  lines.push(
    "",
    "Write the orientation notes as JSON with these fields:",
    "- what: two or three sentences on what the project is and does, and for whom.",
    "- techStack: the languages, frameworks and major tools the evidence shows, as short names (at most 10).",
    "- whereToStart: one or two sentences telling a newcomer what to open first and why.",
    "- startHere: one to four entry points, where execution or the public API begins, each with a one-sentence why.",
    "- readingOrder: five to eight files (fewer if the repository is tiny) in the order a newcomer should read them, from the big picture (README, manifest) to the entry point and then the core modules, each with a one-sentence why.",
  );
  return lines.join("\n");
}

function block(path: string, content: PreparedContent): string {
  const note = content.truncated ? ` (first ${formatNumber(content.shownLines)} of ${formatNumber(content.totalLines)} lines)` : "";
  return `<file path="${path}"${note}>\n${content.text.trim()}\n</file>`;
}

/** Paths the model may cite: everything analyzable, shallowest first, with entry points and the README guaranteed. */
export function listOverviewPaths(nodes: Nodes, mustInclude: string[], max: number): string[] {
  const files = Object.values(nodes)
    .filter((n) => n.type === "file" && !n.skip && n.kind !== "asset")
    .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path))
    .map((n) => n.path);
  const picked = new Set(mustInclude.filter((p) => nodes[p]));
  for (const path of files) {
    if (picked.size >= max) break;
    picked.add(path);
  }
  return [...picked];
}

// ─── Parsing ─────────────────────────────────────────────────────────────

/** Validates the model's JSON against the tree: unknown paths are dropped, lists are capped. */
export function parseOverview(text: string, nodes: Nodes, model: string, now = new Date()): ProjectOverview {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RepoMapError("AI_ERROR", "The AI overview came back malformed.", { hint: "Reload to try again." });
  }
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const techStack = [
    ...new Set((Array.isArray(obj.techStack) ? obj.techStack : []).map(str).filter((t) => t && t.length <= 40)),
  ].slice(0, MAX_TECH);

  return {
    what: str(obj.what),
    techStack,
    whereToStart: str(obj.whereToStart),
    startHere: steps(obj.startHere, nodes, MAX_START_HERE),
    readingOrder: steps(obj.readingOrder, nodes, MAX_READING_STEPS),
    model,
    createdAt: now.toISOString(),
  };
}

function steps(value: unknown, nodes: Nodes, max: number): ReadingStep[] {
  const out: ReadingStep[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item !== "object") continue;
    const { path, why } = item as Record<string, unknown>;
    if (typeof path !== "string") continue;
    const normalized = path.trim().replace(/^\.?\//, "").replace(/\/$/, "");
    if (!normalized || !nodes[normalized] || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({ path: normalized, why: typeof why === "string" ? why.trim() : "" });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Reads a string field out of JSON that is still streaming in, e.g. the
 * `what` paragraph before the rest of the overview arrives. Null until the
 * field starts.
 */
export function extractPartialString(buffer: string, key: string): string | null {
  const start = new RegExp(`"${key}"\\s*:\\s*"`).exec(buffer);
  if (!start) return null;
  let out = "";
  let i = start.index + start[0].length;
  while (i < buffer.length) {
    const c = buffer[i]!;
    if (c === '"') return out;
    if (c !== "\\") {
      out += c;
      i++;
      continue;
    }
    const next = buffer[i + 1];
    if (next === undefined) break;
    if (next === "u") {
      const hex = buffer.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 6;
      continue;
    }
    out += ESCAPES[next] ?? next;
    i += 2;
  }
  return out;
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };

// ─── Mock (dev-only provider) ────────────────────────────────────────────

export function mockOverviewJson(e: OverviewEvidence): string {
  const step = (path: string, why: string): ReadingStep => ({ path, why });
  const start = e.entryPoints.slice(0, 3).map((p) => step(p.path, p.reasons[0] ?? "Detected entry point."));
  const reading = [
    ...(e.readme ? [step(e.readme.path, "Explains what the project is for.")] : []),
    ...e.manifests.slice(0, 1).map((m) => step(m.path, "Lists the dependencies and scripts.")),
    ...start,
  ].slice(0, 6);
  return JSON.stringify({
    what: `[Mock] ${e.meta.fullName}${e.meta.description ? `: ${e.meta.description.replace(/[.!\s]+$/, "")}` : " has no description"}. This overview is a placeholder; real ones need ANTHROPIC_API_KEY on the server.`,
    techStack: [e.meta.language, ...e.meta.topics.slice(0, 3)].filter(Boolean),
    whereToStart: start.length ? `Open \`${start[0]!.path}\` first.` : "Start with the README.",
    startHere: start,
    readingOrder: reading,
  });
}
