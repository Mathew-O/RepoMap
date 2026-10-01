import {
  type Signal,
  isComposeName,
  isDockerfileName,
  isReadmeName,
  parserFor,
  rootScriptsFrom,
} from "@/lib/analysis/manifests";
import { type Nodes, baseName, dirOf, isFile, joinPath } from "@/lib/analysis/resolve";
import { ENTRY_POINT_MIN_SCORE, MAX_ENTRY_POINT_READS, MAX_ENTRY_POINTS, MAX_MANIFEST_BYTES } from "@/lib/config";
import type { EntryPoint, TreeNode } from "@/lib/types";

/**
 * "Start here" detection, in two passes:
 *
 * 1. Path conventions that need no file contents: cmd/<name>/main.go,
 *    src/main.rs next to a Cargo.toml, __main__.py, manage.py, Dockerfiles…
 * 2. Manifests and configs (package.json bin/main/exports/scripts, pyproject
 *    scripts, Cargo [[bin]], Dockerfile CMD, Procfile, CI steps, README usage),
 *    read by the caller following `planEntryPointReads`.
 *
 * Each piece of evidence is a weighted signal. A path's score combines its
 * signals like independent probabilities (1 − Π(1 − w)), so corroborating
 * hints add up but never pass 1. Pure: no I/O.
 */

/** When nothing clears ENTRY_POINT_MIN_SCORE, show this many of the best weaker candidates. */
const FALLBACK_COUNT = 3;
const FALLBACK_MIN_SCORE = 0.25;
const MAX_REASONS = 4;
/** Candidates in example/demo/template folders count half. */
const EXAMPLE_PENALTY = 0.5;

const EXAMPLE_DIRS = new Set([
  "example", "examples", "sample", "samples", "demo", "demos", "benchmark", "benchmarks",
  "bench", "benches", "playground", "playgrounds", "sandbox", "template", "templates", "starter",
  "starters", "website", "fixtures", "__fixtures__", "fuzz", "xtask", "eval", "evals",
]);
/** Packages named like dev tooling: "next-build-test", "turbo-tasks-fuzz", "persistence-tools". */
const TOOLING_SEGMENT_RE = /(^|[-_.])(tests?|testing|e2e|fuzz|bench(es|mark|marks)?|examples?|demo|mocks?|tools?)([-_.]|$)/i;

/** Extra weight for candidates inside the package the repo is named after (packages/next in vercel/next.js). */
const MAIN_PACKAGE_WEIGHT = 0.35;

export interface DetectOptions {
  /** Repository name, used to recognize the main package of a monorepo. */
  repoName?: string;
}

/** Go commands that build docs, generate code or lint are real binaries, but not where a reader starts. */
const TOOLING_COMMAND_RE = /^(gen|gen-.+|.+-gen|generate|codegen|.*docs?|tools?|lint|fmt|bench(mark)?s?|release|mock(gen|s)?|scripts?)$/i;

const MAIN_EXTS = "go|py|rs|c|cc|cpp|cxx|swift|kt|java|scala|ts|tsx|mts|js|jsx|mjs|cjs|dart|zig|nim|cr|odin|hs|ml|rb|php|lua|ex|exs|jl|v|gleam";
const JS_EXTS = "ts|tsx|mts|js|jsx|mjs|cjs";
const ROOTISH_DIRS = new Set(["", "src", "source", "app"]);

// ─── Path conventions ────────────────────────────────────────────────────

interface PathRule {
  match: (path: string, node: TreeNode, nodes: Nodes) => boolean;
  weight: number | ((path: string) => number);
  reason: string | ((path: string) => string);
}

const re = (pattern: string) => new RegExp(pattern, "i");
const rootish = (path: string) => ROOTISH_DIRS.has(dirOf(path).toLowerCase());
/** For crate-relative layouts: "crates/x/src/main.rs" → "crates/x". */
const crateDir = (path: string) => dirOf(dirOf(path).replace(/\/bin$/, ""));
const hasCargo = (path: string, nodes: Nodes) => isFile(nodes, joinPath(crateDir(path), "Cargo.toml"));
/** Root crate, a workspace member (crates/x), or something deeper (turbopack/crates/x). */
const byCrateDepth = (path: string, root: number, member: number, deep: number) => {
  const dir = crateDir(path);
  if (dir === "") return root;
  return dir.split("/").length <= 2 ? member : deep;
};

/**
 * Next.js root layout, home page (possibly inside a route group) and pages/ entry.
 * They only count in an app with a next.config, at most two folders deep (apps/web/).
 */
const NEXT_ROUTES = {
  layout: /^((?:[^/]+\/){0,2}?)(?:src\/)?app\/layout\.[cm]?[jt]sx?$/,
  page: /^((?:[^/]+\/){0,2}?)(?:src\/)?app\/(?:\([^/]+\)\/)?page\.[cm]?[jt]sx?$/,
  pages: /^((?:[^/]+\/){0,2}?)(?:src\/)?pages\/(?:_app|index)\.[cm]?[jt]sx?$/,
};
const isNextRoute = (path: string, nodes: Nodes, kind: keyof typeof NEXT_ROUTES) => {
  const appRoot = NEXT_ROUTES[kind].exec(path)?.[1];
  if (appRoot === undefined) return false;
  return ["js", "mjs", "ts", "cjs"].some((ext) => isFile(nodes, `${appRoot}next.config.${ext}`));
};

/** First match wins, so a file gets at most one path-convention signal. */
const PATH_RULES: PathRule[] = [
  {
    match: (p) => /(^|\/)cmd\/[^/]+\/main\.go$/.test(p),
    weight: (p) => (TOOLING_COMMAND_RE.test(baseName(dirOf(p))) ? 0.55 : 0.8),
    reason: (p) => `Go command "${baseName(dirOf(p))}" (cmd/)`,
  },
  { match: (p) => p === "main.go", weight: 0.75, reason: "Go main package at the repo root" },
  // Workspace member crates are usually supporting crates; the root crate is the product.
  {
    match: (p, _, n) => /(^|\/)src\/main\.rs$/.test(p) && hasCargo(p, n),
    weight: (p) => byCrateDepth(p, 0.8, 0.6, 0.45),
    reason: "Rust binary crate root (src/main.rs)",
  },
  {
    match: (p, _, n) => /(^|\/)src\/bin\/[^/]+\.rs$/.test(p) && hasCargo(p, n),
    weight: (p) => byCrateDepth(p, 0.7, 0.5, 0.4),
    reason: "Rust binary (src/bin/)",
  },
  {
    match: (p, _, n) => /(^|\/)src\/lib\.rs$/.test(p) && hasCargo(p, n),
    weight: (p) => byCrateDepth(p, 0.55, 0.45, 0.35),
    reason: "Rust library crate root (src/lib.rs)",
  },
  { match: (p, n) => n.name === "__main__.py" && n.depth <= 3, weight: 0.6, reason: (p) => runAsModuleReason(p) },
  { match: (p, n) => n.name === "manage.py" && n.depth <= 2, weight: 0.65, reason: "Django management script (manage.py)" },
  { match: (p) => re(`^Sources/[^/]+/main\\.swift$`).test(p), weight: 0.65, reason: "Swift executable target (main.swift)" },
  { match: (p) => p === "lib/main.dart", weight: 0.7, reason: "Dart/Flutter app entry (lib/main.dart)" },
  { match: (p, n) => n.name === "Program.cs" && n.depth <= 3, weight: 0.6, reason: ".NET program entry (Program.cs)" },
  { match: (p) => /(^|\/)src\/main\/(java|kotlin)\/.+Application\.(java|kt)$/.test(p), weight: 0.65, reason: "Spring Boot application class" },
  { match: (p, n) => rootish(p) && re(`^main\\.(${MAIN_EXTS})$`).test(n.name), weight: 0.6, reason: "Conventional entry file name (main)" },
  { match: (p, n) => rootish(p) && re(`^cli\\.(${MAIN_EXTS})$`).test(n.name), weight: 0.5, reason: "Conventional CLI entry (cli)" },
  { match: (p, n) => rootish(p) && re(`^index\\.(${JS_EXTS})$`).test(n.name), weight: 0.45, reason: "Conventional entry file name (index)" },
  { match: (p, n) => rootish(p) && /^(app|server)\.(py|js|ts|mjs|cjs|rb|go)$/i.test(n.name), weight: 0.45, reason: "Conventional app/server entry" },
  { match: (p, n) => /^(wsgi|asgi)\.py$/.test(n.name) && n.depth <= 3, weight: 0.4, reason: "WSGI/ASGI server entry" },
  { match: (p, _, n) => isNextRoute(p, n, "layout"), weight: 0.55, reason: "Next.js root layout" },
  { match: (p, _, n) => isNextRoute(p, n, "page"), weight: 0.5, reason: "Next.js home page" },
  { match: (p, _, n) => isNextRoute(p, n, "pages"), weight: 0.5, reason: "Next.js pages entry" },
  { match: (p) => /^src\/App\.(tsx|jsx|vue|svelte)$/.test(p), weight: 0.4, reason: "Root UI component" },
  { match: (p) => p === "config.ru", weight: 0.5, reason: "Rack app entry (config.ru)" },
  { match: (p) => p === "config/routes.rb", weight: 0.45, reason: "Rails routes" },
  { match: (p) => /^exe\/[^/]+$/.test(p), weight: 0.6, reason: "Gem executable (exe/)" },
  { match: (p, n) => /^bin\/[^/]+$/.test(p) && n.kind === "source", weight: 0.45, reason: "Executable in bin/" },
  { match: (p, n) => isDockerfileName(n.name), weight: (p) => (dirOf(p) === "" ? 0.5 : 0.35), reason: "Builds the container image (Dockerfile)" },
  { match: (p, n) => dirOf(p) === "" && isComposeName(n.name), weight: 0.4, reason: "Starts the stack (docker compose)" },
  { match: (p) => p === "index.html", weight: 0.35, reason: "Web page entry (index.html)" },
  { match: (p) => /^(makefile|gnumakefile|cmakelists\.txt|justfile)$/i.test(p), weight: 0.3, reason: "Top-level build file" },
];

function runAsModuleReason(path: string): string {
  const pkg = dirOf(path).replace(/^src\//, "").replace(/\//g, ".");
  return pkg ? `Runs with python -m ${pkg}` : "Python __main__ module";
}

function pathSignals(nodes: Nodes): Signal[] {
  const signals: Signal[] = [];
  for (const node of Object.values(nodes)) {
    if (node.type !== "file" && node.type !== "symlink") continue;
    if (!eligible(node)) continue;
    const rule = PATH_RULES.find((r) => r.match(node.path, node, nodes));
    if (!rule) continue;
    signals.push({
      path: node.path,
      weight: typeof rule.weight === "function" ? rule.weight(node.path) : rule.weight,
      reason: typeof rule.reason === "function" ? rule.reason(node.path) : rule.reason,
    });
  }
  return signals;
}

// ─── What to read ────────────────────────────────────────────────────────

const ROOT_MANIFESTS = new Set([
  "package.json", "pyproject.toml", "setup.py", "setup.cfg", "cargo.toml",
  "deno.json", "deno.jsonc", "composer.json", "procfile",
]);
const NESTED_MANIFESTS = new Set(["package.json", "pyproject.toml", "setup.py", "cargo.toml", "deno.json", "procfile"]);
/** Folders whose children are usually separate packages in a monorepo. */
const WORKSPACE_DIRS = new Set(["packages", "apps", "crates", "libs", "services", "plugins", "modules", "projects"]);
const MAX_DOCKERFILES = 2;
const MAX_WORKFLOWS = 2;

/**
 * The manifests worth fetching for this tree, most informative first:
 * root manifests and Dockerfiles, the README, manifests one level down (and
 * in packages/*, apps/*, crates/* …) with the package named after the repo
 * first, then a couple of CI workflows.
 */
export function planEntryPointReads(nodes: Nodes, options: DetectOptions = {}, max = MAX_ENTRY_POINT_READS): string[] {
  const readable = (path: string) => {
    const node = nodes[path];
    return node?.type === "file" && !node.skip && (node.size ?? 0) <= MAX_MANIFEST_BYTES;
  };
  const childrenOf = (dir: string) => (nodes[dir]?.children ?? []).map((p) => nodes[p]!).filter(Boolean);

  const root: string[] = [];
  const dockerfiles: string[] = [];
  let compose: string | null = null;
  let readme: string | null = null;
  for (const child of childrenOf("")) {
    if (!readable(child.path)) continue;
    const lower = child.name.toLowerCase();
    if (ROOT_MANIFESTS.has(lower)) root.push(child.path);
    else if (isDockerfileName(child.name)) dockerfiles.push(child.path);
    else if (!compose && isComposeName(child.name)) compose = child.path;
    else if (isReadmeName(child.name) && (!readme || /\.md$/i.test(child.name))) readme = child.path;
  }

  const mainDirs = mainPackageDirs(nodes, options.repoName);
  const nested = new Set<string>();
  const visit = (dir: TreeNode) => {
    for (const child of childrenOf(dir.path)) {
      if (!readable(child.path)) continue;
      if (NESTED_MANIFESTS.has(child.name.toLowerCase()) || isDockerfileName(child.name)) nested.add(child.path);
    }
  };
  for (const dir of mainDirs) visit(nodes[dir]!);
  for (const dir of childrenOf("")) {
    if (dir.type !== "dir" || !browsable(dir)) continue;
    visit(dir);
    if (WORKSPACE_DIRS.has(dir.name.toLowerCase())) {
      for (const pkg of childrenOf(dir.path)) if (pkg.type === "dir" && browsable(pkg)) visit(pkg);
    }
  }
  const inMain = (path: string) => (mainDirs.some((d) => path.startsWith(`${d}/`)) ? 0 : 1);
  const nestedOrdered = [...nested].sort(
    (a, b) => inMain(a) - inMain(b) || nodes[a]!.depth - nodes[b]!.depth || a.localeCompare(b),
  );

  const workflows = childrenOf(".github/workflows")
    .filter((n) => readable(n.path) && /\.ya?ml$/i.test(n.name))
    .sort((a, b) => Number(isDeployish(b.name)) - Number(isDeployish(a.name)) || a.name.localeCompare(b.name))
    .slice(0, MAX_WORKFLOWS)
    .map((n) => n.path);

  return [
    ...root,
    ...dockerfiles.slice(0, MAX_DOCKERFILES),
    ...(compose ? [compose] : []),
    ...(readme ? [readme] : []),
    ...nestedOrdered,
    ...workflows,
  ].slice(0, max);
}

function isDeployish(name: string): boolean {
  return /release|deploy|publish|docker|cd\b/i.test(name);
}

/** Folders worth looking inside for manifests: not vendored, generated, tests, docs, examples, tooling or dot-folders. */
function browsable(dir: TreeNode): boolean {
  if (dir.skip || dir.kind === "test" || dir.kind === "docs" || dir.name.startsWith(".")) return false;
  return !isExampleOrTooling(dir.name);
}

function isExampleOrTooling(segment: string): boolean {
  return EXAMPLE_DIRS.has(segment.toLowerCase()) || TOOLING_SEGMENT_RE.test(segment);
}

/** "next.js" → "next", "fast-api" → "fastapi". */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\.(js|ts|py|rs|go|rb)$/, "").replace(/[^a-z0-9]/g, "");
}

/** Folders (depth 1–3) named after the repo: packages/next in vercel/next.js, src/flask in pallets/flask. */
function mainPackageDirs(nodes: Nodes, repoName: string | undefined): string[] {
  const target = repoName ? normalizeName(repoName) : "";
  if (target.length < 2) return [];
  return Object.values(nodes)
    .filter((n) => n.type === "dir" && n.depth >= 1 && n.depth <= 3 && !n.skip && normalizeName(n.name) === target)
    .map((n) => n.path);
}

// ─── Scoring ─────────────────────────────────────────────────────────────

export function detectEntryPoints(
  nodes: Nodes,
  files: ReadonlyMap<string, string>,
  options: DetectOptions = {},
): EntryPoint[] {
  const ctx = { nodes, rootScripts: rootScriptsFrom(files) };
  const signals = pathSignals(nodes);
  for (const [path, content] of files) {
    const parser = parserFor(path);
    if (parser) signals.push(...parser(path, content, ctx));
  }

  // In a monorepo, the package named after the repo is usually the product. Boost
  // candidates already found there; never create new ones from the name alone.
  const mainDirs = mainPackageDirs(nodes, options.repoName);
  const boosted = new Set<string>();
  for (const signal of [...signals]) {
    if (boosted.has(signal.path)) continue;
    const dir = mainDirs.find((d) => signal.path.startsWith(`${d}/`));
    if (!dir) continue;
    boosted.add(signal.path);
    signals.push({ path: signal.path, weight: MAIN_PACKAGE_WEIGHT, reason: `In ${dir}/, named after the repository` });
  }

  return rankSignals(signals, nodes);
}

export function rankSignals(signals: Signal[], nodes: Nodes): EntryPoint[] {
  // path → reason → strongest weight seen for that reason.
  const byPath = new Map<string, Map<string, number>>();
  for (const signal of signals) {
    const node = nodes[signal.path];
    if (!node || !eligible(node)) continue;
    const reasons = byPath.get(signal.path) ?? new Map<string, number>();
    reasons.set(signal.reason, Math.max(reasons.get(signal.reason) ?? 0, signal.weight));
    byPath.set(signal.path, reasons);
  }

  const ranked: EntryPoint[] = [...byPath].map(([path, reasons]) => {
    const ordered = [...reasons].sort((a, b) => b[1] - a[1]);
    let score = 1 - ordered.reduce((miss, [, w]) => miss * (1 - clamp(w)), 1);
    if (inExampleDir(path)) score *= EXAMPLE_PENALTY;
    return {
      path,
      reasons: ordered.slice(0, MAX_REASONS).map(([reason]) => reason),
      source: "heuristic",
      score: Math.round(score * 100) / 100,
    };
  });

  ranked.sort(
    (a, b) => b.score - a.score || nodes[a.path]!.depth - nodes[b.path]!.depth || a.path.localeCompare(b.path),
  );

  const strong = ranked.filter((e) => e.score >= ENTRY_POINT_MIN_SCORE).slice(0, MAX_ENTRY_POINTS);
  if (strong.length) return strong;
  return ranked.filter((e) => e.score >= FALLBACK_MIN_SCORE).slice(0, FALLBACK_COUNT);
}

/** Tests, docs, assets and skipped files (vendored, generated, binary…) are never entry points. */
function eligible(node: TreeNode): boolean {
  if (node.skip || node.path === "") return false;
  return node.kind !== "test" && node.kind !== "docs" && node.kind !== "asset";
}

function inExampleDir(path: string): boolean {
  return dirOf(path).split("/").some(isExampleOrTooling);
}

function clamp(weight: number): number {
  return Math.min(0.99, Math.max(0, weight));
}
