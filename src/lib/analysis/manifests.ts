import { resolveCommand } from "@/lib/analysis/commands";
import { type Nodes, dirOf, isFile, joinPath, resolveJsTarget, resolvePyModule } from "@/lib/analysis/resolve";

/** One piece of evidence that `path` is somewhere to start reading. */
export interface Signal {
  path: string;
  /** 0–1. Signals for the same path combine (see entry-points.ts). */
  weight: number;
  reason: string;
}

export interface ManifestContext {
  nodes: Nodes;
  /** Root package.json scripts + deno.json tasks, for following `npm start` in READMEs, CI and Docker. */
  rootScripts: Readonly<Record<string, string>>;
}

type Parser = (path: string, content: string, ctx: ManifestContext) => Signal[];

const MAX_BINS = 6;

/**
 * Manifests below the root usually describe one package of a monorepo, so
 * what they declare counts for less than the repo's own manifest.
 */
function weightFor(manifestPath: string, root: number, nested: number): number {
  return dirOf(manifestPath) === "" ? root : nested;
}

// ─── JavaScript / TypeScript ─────────────────────────────────────────────

export function packageJsonSignals(path: string, content: string, { nodes }: ManifestContext): Signal[] {
  const pkg = parseJson(content);
  if (!pkg) return [];
  const dir = dirOf(path);
  const where = dir === "" ? "package.json" : `${dir}/package.json`;
  const signals: Signal[] = [];

  const add = (target: unknown, weight: number, field: string) => {
    if (typeof target !== "string") return;
    const resolved = resolveJsTarget(target, dir, nodes);
    if (!resolved) return;
    const shown = resolved.mapped ? ` → ${target.replace(/^\.\//, "")}` : "";
    signals.push({ path: resolved.path, weight, reason: `${where} "${field}"${shown}` });
  };

  const binWeight = weightFor(path, 0.85, 0.7);
  if (typeof pkg.bin === "string") add(pkg.bin, binWeight, "bin");
  else if (isObject(pkg.bin)) {
    for (const [name, target] of Object.entries(pkg.bin).slice(0, MAX_BINS)) add(target, binWeight, `bin: ${name}`);
  }

  // exports, main and module usually name the same file. That's one piece of evidence, not three,
  // so only the first field that resolves to a given file counts.
  const libraryFields: [string, unknown, number][] = [
    ["exports", exportsRoot(pkg.exports), weightFor(path, 0.7, 0.55)],
    ["main", pkg.main, weightFor(path, 0.7, 0.55)],
    ["module", pkg.module, weightFor(path, 0.6, 0.5)],
  ];
  const before = signals.length;
  for (const [field, target, weight] of libraryFields) {
    const seen = new Set(signals.slice(before).map((s) => s.path));
    const resolved = typeof target === "string" ? resolveJsTarget(target, dir, nodes) : null;
    if (resolved && !seen.has(resolved.path)) add(target, weight, field);
  }
  // With no main/exports, Node and npm fall back to index.js.
  if (pkg.main === undefined && pkg.exports === undefined && isFile(nodes, joinPath(dir, "index.js"))) {
    signals.push({ path: joinPath(dir, "index.js")!, weight: weightFor(path, 0.7, 0.55), reason: `${where} (default "main": index.js)` });
  }

  const scripts = stringRecord(pkg.scripts);
  signals.push(...scriptSignals(scripts, dir, nodes, where, "script"));
  return signals;
}

export function denoJsonSignals(path: string, content: string, { nodes }: ManifestContext): Signal[] {
  const deno = parseJson(content.replace(/^\s*\/\/.*$/gm, ""));
  if (!deno) return [];
  const dir = dirOf(path);
  const signals: Signal[] = [];
  const root = exportsRoot(deno.exports);
  if (typeof root === "string") {
    const resolved = resolveJsTarget(root, dir, nodes);
    if (resolved) signals.push({ path: resolved.path, weight: 0.65, reason: `${path} "exports"` });
  }
  signals.push(...scriptSignals(stringRecord(deno.tasks), dir, nodes, path, "task"));
  return signals;
}

export function composerJsonSignals(path: string, content: string, { nodes }: ManifestContext): Signal[] {
  const composer = parseJson(content);
  const bins = Array.isArray(composer?.bin) ? composer.bin : [];
  const dir = dirOf(path);
  return bins
    .slice(0, MAX_BINS)
    .map((bin) => (typeof bin === "string" ? joinPath(dir, bin) : null))
    .filter((p): p is string => isFile(nodes, p))
    .map((p) => ({ path: p, weight: 0.8, reason: `${path} "bin"` }));
}

/** "start" and "dev"-style scripts usually launch the app. */
function scriptSignals(
  scripts: Record<string, string>,
  dir: string,
  nodes: Nodes,
  where: string,
  noun: "script" | "task",
): Signal[] {
  const signals: Signal[] = [];
  for (const [name, weight] of [["start", 0.6], ["dev", 0.45], ["serve", 0.45], ["server", 0.45]] as const) {
    const body = scripts[name];
    if (!body) continue;
    for (const path of resolveCommand(body, { nodes, baseDir: dir, scripts })) {
      signals.push({ path, weight, reason: `"${name}" ${noun} in ${where}` });
    }
  }
  return signals;
}

/** The "." entry of an exports map, preferring runtime conditions over types. */
function exportsRoot(exports: unknown): unknown {
  if (typeof exports === "string") return exports;
  if (!isObject(exports)) return undefined;
  const keys = Object.keys(exports);
  // Subpath map ({ ".": …, "./utils": … }) vs. conditions map ({ import: …, require: … }).
  const root = keys.some((k) => k.startsWith(".")) ? exports["."] : exports;
  return firstCondition(root, 0);
}

function firstCondition(value: unknown, depth: number): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return firstCondition(value[0], depth + 1);
  if (!isObject(value) || depth > 4) return undefined;
  for (const key of ["source", "development", "import", "node", "default", "require", "browser"]) {
    const hit = firstCondition(value[key], depth + 1);
    if (hit) return hit;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key === "types" || key === "typings") continue;
    const hit = firstCondition(nested, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

// ─── Python ──────────────────────────────────────────────────────────────

const PY_SCRIPT_SECTIONS = new Set(["project.scripts", "project.gui-scripts", "tool.poetry.scripts"]);

export function pyprojectSignals(path: string, content: string, { nodes }: ManifestContext): Signal[] {
  const dir = dirOf(path);
  const signals: Signal[] = [];
  for (const { header, body } of tomlSections(content)) {
    if (!PY_SCRIPT_SECTIONS.has(header)) continue;
    for (const m of body.matchAll(/^\s*["']?([\w.-]+)["']?\s*=\s*(?:\{[^}]*?)?["']([\w.]+):[\w.]+["']/gm)) {
      const file = resolvePyModule(m[2]!, dir, nodes);
      if (file) signals.push({ path: file, weight: weightFor(path, 0.85, 0.7), reason: `${path} script "${m[1]}"` });
    }
  }
  return signals;
}

export function setupPySignals(path: string, content: string, { nodes }: ManifestContext): Signal[] {
  const dir = dirOf(path);
  const signals: Signal[] = [];
  if (/console_scripts|gui_scripts/.test(content)) {
    for (const m of content.matchAll(/["']\s*([\w.-]+)\s*=\s*([\w.]+)\s*:\s*[\w.]+\s*["']/g)) {
      const file = resolvePyModule(m[2]!, dir, nodes);
      if (file) signals.push({ path: file, weight: weightFor(path, 0.85, 0.7), reason: `${path} console script "${m[1]}"` });
    }
  }
  const scripts = /\bscripts\s*=\s*\[([^\]]*)\]/.exec(content);
  if (scripts) {
    for (const m of scripts[1]!.matchAll(/["']([^"']+)["']/g)) {
      const file = joinPath(dir, m[1]!);
      if (isFile(nodes, file)) signals.push({ path: file, weight: weightFor(path, 0.7, 0.55), reason: `${path} "scripts"` });
    }
  }
  return signals;
}

export function setupCfgSignals(path: string, content: string, { nodes }: ManifestContext): Signal[] {
  const dir = dirOf(path);
  const section = /^\[options\.entry_points\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(content);
  if (!section) return [];
  const signals: Signal[] = [];
  for (const m of section[1]!.matchAll(/^\s+([\w.-]+)\s*=\s*([\w.]+)\s*:\s*[\w.]+/gm)) {
    const file = resolvePyModule(m[2]!, dir, nodes);
    if (file) signals.push({ path: file, weight: weightFor(path, 0.85, 0.7), reason: `${path} console script "${m[1]}"` });
  }
  return signals;
}

// ─── Rust ────────────────────────────────────────────────────────────────

/** Explicit [[bin]] / [lib] paths. Default layouts (src/main.rs) are matched by path in entry-points.ts. */
export function cargoTomlSignals(path: string, content: string, { nodes }: ManifestContext): Signal[] {
  const dir = dirOf(path);
  const signals: Signal[] = [];
  for (const { header, body, array } of tomlSections(content)) {
    if (!((header === "bin" && array) || header === "lib")) continue;
    const target = /^\s*path\s*=\s*["']([^"']+)["']/m.exec(body)?.[1];
    const name = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(body)?.[1];
    // Bins at Cargo's default locations (src/main.rs, src/bin/*.rs, src/lib.rs) are
    // scored by the path conventions; counting the declaration too would double-count.
    const file = target ? joinPath(dir, target) : null;
    if (!isFile(nodes, file)) continue;
    if (/^src\/(main\.rs|lib\.rs|bin\/[^/]+\.rs)$/.test(file.slice(dir ? dir.length + 1 : 0))) continue;
    signals.push(
      header === "bin"
        ? { path: file, weight: weightFor(path, 0.85, 0.7), reason: `${path} [[bin]]${name ? ` "${name}"` : ""}` }
        : { path: file, weight: weightFor(path, 0.55, 0.45), reason: `${path} [lib]` },
    );
  }
  return signals;
}

// ─── Containers, processes, CI ───────────────────────────────────────────

export function dockerfileSignals(path: string, content: string, { nodes, rootScripts }: ManifestContext): Signal[] {
  const dir = dirOf(path);
  const signals: Signal[] = [];
  const joined = content.replace(/\\\r?\n/g, " ");
  for (const m of joined.matchAll(/^\s*(ENTRYPOINT|CMD)\s+(.+)$/gim)) {
    const instruction = m[1]!.toUpperCase();
    const command = execForm(m[2]!.trim());
    for (const file of resolveCommand(command, { nodes, baseDir: dir, scripts: dir === "" ? rootScripts : undefined })) {
      signals.push({ path: file, weight: 0.6, reason: `Run by ${path} ${instruction}` });
    }
  }
  return signals;
}

export function composeSignals(path: string, content: string, { nodes, rootScripts }: ManifestContext): Signal[] {
  const dir = dirOf(path);
  const signals: Signal[] = [];
  for (const m of content.matchAll(/^\s*(command|entrypoint):\s*(\S.*)$/gm)) {
    const command = execForm(m[2]!.trim().replace(/^(["'])(.*)\1$/, "$2"));
    for (const file of resolveCommand(command, { nodes, baseDir: dir, scripts: dir === "" ? rootScripts : undefined })) {
      signals.push({ path: file, weight: 0.5, reason: `Run by ${path} ${m[1]}` });
    }
  }
  return signals;
}

export function procfileSignals(path: string, content: string, { nodes, rootScripts }: ManifestContext): Signal[] {
  const dir = dirOf(path);
  const signals: Signal[] = [];
  for (const m of content.matchAll(/^([\w-]+):\s*(.+)$/gm)) {
    const process = m[1]!;
    for (const file of resolveCommand(m[2]!, { nodes, baseDir: dir, scripts: dir === "" ? rootScripts : undefined })) {
      signals.push({ path: file, weight: process === "web" ? 0.7 : 0.5, reason: `Procfile "${process}" process` });
    }
  }
  return signals;
}

/** Commands in GitHub Actions `run:` steps. Weak on purpose: CI mostly builds and tests. */
export function workflowSignals(path: string, content: string, { nodes, rootScripts }: ManifestContext): Signal[] {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const signals: Signal[] = [];
  for (const command of workflowRunLines(content)) {
    for (const file of resolveCommand(command, { nodes, baseDir: "", scripts: rootScripts })) {
      signals.push({ path: file, weight: 0.25, reason: `Run in CI (${name})` });
    }
  }
  return signals;
}

function workflowRunLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const inline = m[2]!.trim();
    if (inline && !/^[|>][-+]?$/.test(inline)) {
      out.push(inline);
      continue;
    }
    const indent = m[1]!.length;
    while (i + 1 < lines.length) {
      const next = lines[i + 1]!;
      if (next.trim() && next.search(/\S/) <= indent) break;
      i++;
      if (next.trim()) out.push(next.trim());
    }
  }
  return out;
}

/** `["node", "server.js"]` (exec form) → `node server.js`; shell form passes through. */
function execForm(value: string): string {
  if (!value.startsWith("[")) return value;
  try {
    const parsed: unknown = JSON.parse(value.replace(/'/g, '"'));
    if (Array.isArray(parsed)) return parsed.filter((t) => typeof t === "string").join(" ");
  } catch {
    // Not valid JSON; fall through to treating it as shell form.
  }
  return value.replace(/^\[|\]$/g, "").replace(/["',]/g, " ");
}

// ─── README ──────────────────────────────────────────────────────────────

const START_WORDS = /\b(entry|entrypoint|entry point|start|starting|main|getting started|quick ?start|usage|architecture|overview|structure|layout|where)\b/i;
const SHELL_FENCES = new Set(["", "sh", "bash", "shell", "console", "zsh", "terminal", "powershell", "ps1", "cmd", "bat"]);
const COMMAND_START = /^(node|deno|bun|npm|npx|pnpm|yarn|python\d*|py|pip|uv|poetry|go|cargo|ruby|bundle|php|java|dotnet|docker|make|gunicorn|uvicorn|flask|django-admin|\.\/)/;
const MAX_README_WEIGHT = 0.35;

/**
 * Paths a README points readers at (inline code and links) and files its
 * usage commands run. Mentions near "getting started"/"architecture"-style
 * wording count more.
 */
export function readmeSignals(path: string, content: string, { nodes, rootScripts }: ManifestContext): Signal[] {
  const dir = dirOf(path);
  const mentions = new Map<string, number>();
  const commands = new Set<string>();
  let heading = "";
  let fence: string | null = null;

  const mention = (raw: string, line: string) => {
    const target = normalizeReadmeLink(raw);
    if (!target) return;
    const resolved = [joinPath(dir, target), joinPath("", target)].find((p) => p !== null && nodes[p] !== undefined);
    if (!resolved || resolved === path) return;
    const node = nodes[resolved]!;
    if (node.kind !== "source" && node.kind !== "build" && node.type !== "dir") return;
    const weight = START_WORDS.test(line) || START_WORDS.test(heading) ? 0.3 : 0.2;
    mentions.set(resolved, Math.min(MAX_README_WEIGHT, Math.max(mentions.get(resolved) ?? 0, weight)));
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const fenceMatch = /^(```|~~~)\s*([\w-]*)/.exec(line);
    if (fenceMatch) {
      fence = fence === null ? fenceMatch[2]!.toLowerCase() : null;
      continue;
    }
    if (fence !== null) {
      if (SHELL_FENCES.has(fence)) {
        const command = line.replace(/^(\$|>|PS>|%)\s*/, "");
        if (COMMAND_START.test(command)) commands.add(command);
      }
      continue;
    }
    if (/^#{1,6}\s/.test(line)) heading = line;

    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const code = m[1]!.trim();
      if (/\s/.test(code)) {
        if (COMMAND_START.test(code)) commands.add(code);
      } else {
        mention(code, line);
      }
    }
    for (const m of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) mention(m[1]!, line);
  }

  const signals: Signal[] = [];
  for (const [p, weight] of mentions) signals.push({ path: p, weight, reason: "Mentioned in the README" });
  for (const command of commands) {
    for (const file of resolveCommand(command, { nodes, baseDir: dir, scripts: rootScripts })) {
      signals.push({ path: file, weight: 0.3, reason: "Run by a README usage command" });
    }
  }
  return signals;
}

/** "./src/index.ts", "src/", "https://github.com/o/r/blob/main/src/x.ts#L10" → "src/x.ts". */
function normalizeReadmeLink(raw: string): string | null {
  let target = raw.trim();
  const github = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/(?:blob|tree)\/[^/]+\/(.+)$/.exec(target);
  if (github) target = github[1]!;
  else if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return null;
  target = target.replace(/[#?].*$/, "").replace(/^\.?\//, "").replace(/\/$/, "");
  try {
    target = decodeURIComponent(target);
  } catch {
    return null;
  }
  return target && !target.includes(" ") ? target : null;
}

// ─── Dispatch ────────────────────────────────────────────────────────────

/** Which parser handles a file, by name. Null for files that aren't manifests. */
export function parserFor(path: string): Parser | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const lower = name.toLowerCase();
  if (lower === "package.json") return packageJsonSignals;
  if (lower === "deno.json" || lower === "deno.jsonc") return denoJsonSignals;
  if (lower === "composer.json") return composerJsonSignals;
  if (lower === "pyproject.toml") return pyprojectSignals;
  if (lower === "setup.py") return setupPySignals;
  if (lower === "setup.cfg") return setupCfgSignals;
  if (lower === "cargo.toml") return cargoTomlSignals;
  if (lower === "procfile") return procfileSignals;
  if (isDockerfileName(name)) return dockerfileSignals;
  if (isComposeName(name)) return composeSignals;
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path)) return workflowSignals;
  if (isReadmeName(name)) return readmeSignals;
  return null;
}

export function isDockerfileName(name: string): boolean {
  return /^(docker|container)file(\.[\w.-]+)?$/i.test(name) || /\.dockerfile$/i.test(name);
}

export function isComposeName(name: string): boolean {
  return /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/i.test(name);
}

export function isReadmeName(name: string): boolean {
  return /^readme(\.(md|markdown|mdx|rst|txt|adoc))?$/i.test(name);
}

/** Scripts/tasks from the root package.json and deno.json, used to follow `npm start` elsewhere. */
export function rootScriptsFrom(files: ReadonlyMap<string, string>): Record<string, string> {
  const pkg = parseJson(files.get("package.json") ?? "");
  const deno = parseJson((files.get("deno.json") ?? files.get("deno.jsonc") ?? "").replace(/^\s*\/\/.*$/gm, ""));
  return { ...stringRecord(deno?.tasks), ...stringRecord(pkg?.scripts) };
}

// ─── Small parsers ───────────────────────────────────────────────────────

/** Just enough TOML: top-level `[section]` / `[[array]]` headers and the text under each. */
function tomlSections(content: string): { header: string; array: boolean; body: string }[] {
  const out: { header: string; array: boolean; body: string }[] = [];
  const re = /^\s*(\[\[?)\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/gm;
  const matches = [...content.matchAll(re)];
  matches.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : content.length;
    out.push({ header: m[2]!.replace(/["']/g, ""), array: m[1] === "[[", body: content.slice(start, end) });
  });
  return out;
}

function parseJson(content: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(content);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isObject(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === "string") out[k] = v;
  return out;
}
