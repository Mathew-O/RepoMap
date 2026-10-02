import { formatBytes, formatNumber } from "@/lib/format";
import type { EntryPoint, FileKind, RepoMeta, Summary, TreeNode } from "@/lib/types";

/**
 * Everything the model sees is built here, from data RepoMap already has.
 * Pure, so prompts are unit-tested and deterministic: the same repo yields a
 * byte-identical context block, which is what makes prompt caching work.
 * Bump a version when its prompt changes so cached results regenerate.
 */
export const SUMMARY_PROMPT_VERSION = "s1";
export const OVERVIEW_PROMPT_VERSION = "o1";

type Nodes = Readonly<Record<string, TreeNode>>;

const README_CONTEXT_CHARS = 4_000;
const MAX_LISTED_CHILDREN = 60;
const MAX_LISTED_SIBLINGS = 30;
const MAX_CONTEXT_ENTRY_POINTS = 8;

// ─── System prompts ──────────────────────────────────────────────────────

export const SUMMARY_SYSTEM = `You help developers understand an unfamiliar GitHub repository by summarizing one file or folder at a time.

Write one or two plain sentences, at most about 50 words, that say:
1. what the file or folder does, and
2. how it fits into the rest of the project.

Rules:
- Base every statement on the content and repository context you are given. Never describe behavior, features or files you can't see.
- Put important function, class, file and folder names in backticks, for example \`parseConfig\`.
- If the content doesn't make the purpose clear, start your answer with "Unclear:" and say what is missing.
- If you were shown only the beginning of a file, say that the summary covers the part shown.
- No headings, lists or Markdown other than backticks.`;

export const OVERVIEW_SYSTEM = `You write the orientation notes a developer reads right after opening an unfamiliar GitHub repository.

Use only the evidence you are given: repository metadata, the README, manifest files, the beginning of a few entry-point files, and a list of file paths. Do not claim features, technologies or files the evidence doesn't show. If the evidence is thin, say so plainly.

Every path you return must be copied exactly from the PATHS list.`;

// ─── File contents ───────────────────────────────────────────────────────

export interface PreparedContent {
  text: string;
  truncated: boolean;
  shownLines: number;
  totalLines: number;
}

export function inspectContent(raw: string): "binary" | "empty" | "text" {
  if (raw.slice(0, 8_000).includes("\u0000")) return "binary";
  return raw.trim() === "" ? "empty" : "text";
}

/** Cuts long text at a line boundary, so the model never sees half a line. */
export function prepareContent(raw: string, maxChars: number): PreparedContent {
  const normalized = raw.replace(/\r\n/g, "\n");
  const totalLines = countLines(normalized);
  if (normalized.length <= maxChars) return { text: normalized, truncated: false, shownLines: totalLines, totalLines };
  const cut = normalized.lastIndexOf("\n", maxChars);
  const text = normalized.slice(0, cut > maxChars / 2 ? cut : maxChars);
  return { text, truncated: true, shownLines: countLines(text), totalLines };
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

function fileBlock(path: string, content: PreparedContent): string {
  const note = content.truncated
    ? `\n[Only the first ${formatNumber(content.shownLines)} of ${formatNumber(content.totalLines)} lines are shown.]`
    : "";
  return `<file path="${path}">\n${content.text}\n</file>${note}`;
}

// ─── Shared repository context (prompt-cached) ───────────────────────────

export interface RepoContextInput {
  meta: RepoMeta;
  nodes: Nodes;
  entryPoints: EntryPoint[];
  readme: { path: string; text: string } | null;
}

export function buildRepoContext({ meta, nodes, entryPoints, readme }: RepoContextInput): string {
  const lines = [`Repository: ${meta.fullName}`];
  if (meta.description) lines.push(`Description: ${meta.description}`);
  const facts = [
    meta.language && `Primary language: ${meta.language}`,
    meta.topics.length > 0 && `Topics: ${meta.topics.join(", ")}`,
    meta.license && `License: ${meta.license}`,
  ].filter(Boolean);
  if (facts.length) lines.push(facts.join(" · "));

  lines.push("", "Top-level contents:", ...listChildren("", nodes, MAX_LISTED_CHILDREN));

  if (entryPoints.length) {
    lines.push("", "Detected entry points (from manifests and file names):");
    for (const point of entryPoints.slice(0, MAX_CONTEXT_ENTRY_POINTS)) lines.push(`- ${point.path}: ${point.reasons[0]}`);
  }

  if (readme) {
    const excerpt = prepareContent(readme.text, README_CONTEXT_CHARS);
    lines.push("", `README (${readme.path}${excerpt.truncated ? ", beginning only" : ""}):`, '"""', excerpt.text.trim(), '"""');
  }
  return lines.join("\n");
}

/** "- src/ (folder, 120 files, mostly source)" / "- package.json (config, 2.3 KB)". */
function listChildren(dir: string, nodes: Nodes, max: number): string[] {
  const children = (nodes[dir]?.children ?? []).map((p) => nodes[p]).filter((n): n is TreeNode => Boolean(n));
  const lines = children.slice(0, max).map((child) => `- ${describeNode(child)}`);
  if (children.length > max) lines.push(`- … and ${formatNumber(children.length - max)} more`);
  return lines;
}

function describeNode(node: TreeNode): string {
  if (node.type === "dir") {
    const files = node.fileCount ?? 0;
    return `${node.name}/ (folder, ${formatNumber(files)} ${files === 1 ? "file" : "files"}, mostly ${KIND_WORD[node.kind]})`;
  }
  if (node.type === "submodule") return `${node.name} (git submodule)`;
  const parts = [KIND_WORD[node.kind]];
  if (node.size !== undefined) parts.push(formatBytes(node.size));
  if (node.skip) parts.push(`not analyzed: ${node.skip}`);
  return `${node.name} (${parts.join(", ")})`;
}

const KIND_WORD: Record<FileKind, string> = {
  source: "source",
  test: "tests",
  config: "config",
  docs: "docs",
  build: "build/CI",
  asset: "assets",
  other: "other",
};

// ─── File and folder prompts ─────────────────────────────────────────────

export function buildFilePrompt(input: {
  node: TreeNode;
  nodes: Nodes;
  content: PreparedContent;
  entryPoint?: EntryPoint;
}): string {
  const { node, nodes, content, entryPoint } = input;
  const dir = node.parent ?? "";
  const siblings = (nodes[dir]?.children ?? []).filter((p) => p !== node.path);

  const lines = ["Summarize this file.", "", `Path: ${node.path}`];
  lines.push(
    `Size: ${node.size !== undefined ? `${formatBytes(node.size)}, ` : ""}${formatNumber(content.totalLines)} lines. Category: ${KIND_WORD[node.kind]}.`,
  );
  if (entryPoint) lines.push(`Detected entry point: ${entryPoint.reasons.join("; ")}`);
  if (siblings.length) {
    const names = siblings.slice(0, MAX_LISTED_SIBLINGS).map((p) => {
      const sibling = nodes[p];
      return sibling?.type === "dir" ? `${sibling.name}/` : (sibling?.name ?? p);
    });
    const more = siblings.length > MAX_LISTED_SIBLINGS ? ` and ${formatNumber(siblings.length - MAX_LISTED_SIBLINGS)} more` : "";
    lines.push(`Also in ${dir ? `${dir}/` : "the repository root"}: ${names.join(", ")}${more}`);
  }
  lines.push("", fileBlock(node.path, content));
  return lines.join("\n");
}

export interface FolderEvidence {
  node: TreeNode;
  nodes: Nodes;
  /** Existing summaries of direct children, by path. */
  childSummaries: ReadonlyMap<string, Summary>;
  /** Openings of a few children that have no summary yet. */
  excerpts: { path: string; content: PreparedContent }[];
}

export function buildFolderPrompt({ node, nodes, childSummaries, excerpts }: FolderEvidence): string {
  const children = (node.children ?? []).map((p) => nodes[p]).filter((n): n is TreeNode => Boolean(n));
  const lines = [
    "Summarize this folder from its contents.",
    "",
    `Folder: ${node.path}/ (${formatNumber(node.fileCount ?? 0)} files in total)`,
    "",
    "Direct contents:",
  ];
  for (const child of children.slice(0, MAX_LISTED_CHILDREN)) {
    const summary = childSummaries.get(child.path);
    let line = `- ${describeNode(child)}`;
    if (summary && summary.model !== null) line += `: ${summary.text}`;
    else if (child.type === "dir") {
      const names = (child.children ?? []).slice(0, 8).map((p) => nodes[p]?.name ?? p);
      if (names.length) line += ` — contains ${names.join(", ")}${(child.children?.length ?? 0) > 8 ? ", …" : ""}`;
    }
    lines.push(line);
  }
  if (children.length > MAX_LISTED_CHILDREN) lines.push(`- … and ${formatNumber(children.length - MAX_LISTED_CHILDREN)} more`);
  if (node.hiddenChildren) lines.push(`- (${formatNumber(node.hiddenChildren)} more entries weren't loaded because the repository is very large)`);

  if (excerpts.length) {
    lines.push("", "Beginnings of some files that have no summary yet:");
    for (const excerpt of excerpts) lines.push("", fileBlock(excerpt.path, excerpt.content));
  }
  return lines.join("\n");
}

const EXCERPT_NAME_RE = /^(readme|index|main|mod|lib|__init__|app|server|cli)(\.|$)/i;

/** Which unsummarized children of a folder are most worth showing the model. */
export function pickFolderExcerpts(
  node: TreeNode,
  nodes: Nodes,
  summarized: ReadonlySet<string>,
  entryPaths: ReadonlySet<string>,
  limit: number,
): string[] {
  const score = (child: TreeNode) =>
    (entryPaths.has(child.path) ? 4 : 0) +
    (EXCERPT_NAME_RE.test(child.name) ? 3 : 0) +
    (child.kind === "source" ? 2 : child.kind === "docs" || child.kind === "config" ? 1 : 0);
  return (node.children ?? [])
    .map((p) => nodes[p])
    .filter((n): n is TreeNode => n?.type === "file" && !n.skip && !summarized.has(n.path))
    .sort((a, b) => score(b) - score(a) || (b.size ?? 0) - (a.size ?? 0) || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((n) => n.path);
}

// ─── Answers ─────────────────────────────────────────────────────────────

/** Normalizes a model answer and reads the "Unclear:" convention from SUMMARY_SYSTEM. */
export function parseSummaryText(raw: string): { text: string; status: "ok" | "unclear" } {
  let text = raw.trim().replace(/^["“](.*)["”]$/s, "$1").trim();
  const unclear = /^unclear\s*[:—-]\s*/i.exec(text);
  if (unclear) {
    text = text.slice(unclear[0].length);
    return { text: text.charAt(0).toUpperCase() + text.slice(1), status: "unclear" };
  }
  return { text, status: "ok" };
}

/** Summaries that need no model: skipped, vendored, submodules, links, empty folders. */
export function staticSummary(node: TreeNode, now = new Date()): Summary | null {
  const make = (text: string, status: Summary["status"]): Summary => ({
    path: node.path,
    target: node.type === "dir" ? "folder" : "file",
    text,
    status,
    model: null,
    createdAt: now.toISOString(),
  });

  if (node.type === "submodule") return make("Git submodule: a pointer to another repository, so there's nothing here to summarize.", "skipped");
  if (node.type === "symlink") return make("Symbolic link to another path; links aren't summarized.", "skipped");

  if (node.type === "dir") {
    if (node.skip === "vendored") return make("Third-party code copied into the repository; vendored folders aren't summarized.", "skipped");
    if (node.skip === "generated") return make("Generated or build output; it isn't summarized because it isn't hand-written source.", "skipped");
    if ((node.children?.length ?? 0) === 0) return make("This folder is empty.", "empty");
    return null;
  }

  switch (node.skip) {
    case "lockfile":
      return make("Dependency lockfile that pins exact package versions; lockfiles aren't summarized.", "skipped");
    case "binary":
      return make("Binary file; binaries aren't summarized.", "skipped");
    case "asset":
      return make("Image or media asset; assets aren't summarized.", "skipped");
    case "vendored":
      return make("Third-party code copied into the repository; vendored files aren't summarized.", "skipped");
    case "generated":
      return make("Generated or build output; it isn't summarized because it isn't hand-written source.", "skipped");
    case "too-large":
      return make(`At ${formatBytes(node.size ?? 0)}, this file is too large to summarize.`, "too-large");
    default:
      return node.size === 0 ? make("This file is empty.", "empty") : null;
  }
}

// ─── Mock text (dev-only provider) ───────────────────────────────────────

const DECLARATION_RE =
  /^\s*(?:export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|interface|type|enum)|def|class|func|fn|pub\s+fn|pub\s+struct|struct)\s+([A-Za-z_$][\w$]*)/gm;

export function mockFileSummary(node: TreeNode, content: PreparedContent): string {
  const names = [...new Set([...content.text.matchAll(DECLARATION_RE)].map((m) => m[1]!))].slice(0, 3);
  const defines = names.length ? ` that declares ${names.map((n) => `\`${n}\``).join(", ")}` : "";
  return `[Mock] \`${node.name}\` is a ${formatNumber(content.totalLines)}-line ${KIND_WORD[node.kind]} file${defines}. Real summaries need ANTHROPIC_API_KEY on the server.`;
}

export function mockFolderSummary(node: TreeNode, nodes: Nodes): string {
  const names = (node.children ?? []).slice(0, 4).map((p) => `\`${nodes[p]?.name ?? p}\``);
  return `[Mock] \`${node.name}/\` holds ${formatNumber(node.fileCount ?? 0)} files, mostly ${KIND_WORD[node.kind]}, including ${names.join(", ")}. Real summaries need ANTHROPIC_API_KEY on the server.`;
}
