import type { TreeNode } from "@/lib/types";

/**
 * Turns references found in manifests and commands into paths that exist in
 * the tree. Every function returns null rather than guessing, so a heuristic
 * can only ever point at a real file.
 */

export type Nodes = Readonly<Record<string, TreeNode>>;

export function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Joins a repo-relative base with a relative path, resolving "." and "..". Null if it escapes the repo. */
export function joinPath(base: string, rel: string): string | null {
  const out = base ? base.split("/") : [];
  for (const segment of rel.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(segment);
    }
  }
  return out.join("/");
}

export function isFile(nodes: Nodes, path: string | null): path is string {
  if (path === null) return false;
  const type = nodes[path]?.type;
  return type === "file" || type === "symlink";
}

export function isDir(nodes: Nodes, path: string | null): path is string {
  return path !== null && nodes[path]?.type === "dir";
}

// ─── JavaScript / TypeScript ─────────────────────────────────────────────

const JS_EXTS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];
const JS_EXT_RE = /\.(d\.ts|[cm]?[jt]sx?)$/;

/** Folders packages compile into. Manifests point here; the source usually lives in src/. */
const OUTPUT_DIRS = new Set([
  "dist", "distribution", "build", "lib", "out", "esm", "cjs", "es", "module", "umd", "types", "_esm", "_cjs",
]);
/** Where that source usually lives, most common first. */
const SOURCE_DIRS = ["src", "source", "lib"];

export interface Resolved {
  path: string;
  /** True if the manifest named a build output (or bare path) and this is the source it most likely comes from. */
  mapped: boolean;
}

/**
 * Resolves a package.json-style target ("./dist/index.js", "bin/cli", "src")
 * relative to the package folder. Build output that isn't committed is mapped
 * back to its likely source: dist/index.js → src/index.ts.
 */
export function resolveJsTarget(target: string, packageDir: string, nodes: Nodes): Resolved | null {
  const exact = joinPath(packageDir, target);
  if (exact === null) return null;
  if (isFile(nodes, exact)) return { path: exact, mapped: false };

  const relative = joinPath("", target);
  if (relative === null) return null;
  const stem = relative.replace(JS_EXT_RE, "");
  const segments = stem.split("/").filter(Boolean);
  const stems = [segments.join("/")];
  // Strip every leading output folder (dist/cjs/index → index), then try it under src/ and bare.
  let i = 0;
  while (i < segments.length - 1 && OUTPUT_DIRS.has(segments[i]!.toLowerCase())) i++;
  if (i > 0) {
    const rest = segments.slice(i).join("/");
    stems.push(...SOURCE_DIRS.map((dir) => `${dir}/${rest}`), rest);
  }

  for (const s of stems) {
    const base = joinPath(packageDir, s);
    if (base === null) continue;
    for (const ext of JS_EXTS) {
      if (isFile(nodes, `${base}.${ext}`)) return { path: `${base}.${ext}`, mapped: true };
    }
    if (isDir(nodes, base)) {
      for (const ext of JS_EXTS) {
        if (isFile(nodes, `${base}/index.${ext}`)) return { path: `${base}/index.${ext}`, mapped: true };
      }
    }
  }
  return null;
}

// ─── Python ──────────────────────────────────────────────────────────────

const PY_MODULE_RE = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/;

/**
 * "pkg.cli" → pkg/cli.py or pkg/cli/__init__.py, searched under `baseDir`,
 * the repo root, and the common src/ layout. With `runAsMain` (python -m),
 * a package's __main__.py wins.
 */
export function resolvePyModule(module: string, baseDir: string, nodes: Nodes, runAsMain = false): string | null {
  if (!PY_MODULE_RE.test(module)) return null;
  const rel = module.replace(/\./g, "/");
  const roots = unique([baseDir, joinPath(baseDir, "src"), "", "src"]);
  const files = runAsMain
    ? [`${rel}/__main__.py`, `${rel}.py`, `${rel}/__init__.py`]
    : [`${rel}.py`, `${rel}/__init__.py`, `${rel}/__main__.py`];

  for (const root of roots) {
    for (const file of files) {
      const path = joinPath(root, file);
      if (isFile(nodes, path)) return path;
    }
  }
  return null;
}

// ─── Command-line tokens ─────────────────────────────────────────────────

/**
 * A token from a command line ("server.js", "./bin/run", "/app/dist/main.js")
 * → a file in the repo. Absolute container paths are matched by dropping
 * leading segments (WORKDIR is usually /app or /usr/src/app).
 */
export function resolvePathToken(token: string, baseDir: string, nodes: Nodes): string | null {
  const t = token.replace(/^['"]|['"]$/g, "").replace(/[;,]$/, "");
  if (!t || t.startsWith("-") || t.includes("://") || /[$*?{}<>|=@]/.test(t)) return null;
  // Bare words ("serve", "app") are commands or arguments, not paths.
  if (!t.includes("/") && !t.includes(".")) return null;

  // Longest suffix first, so /usr/src/app/dist/server.js tries dist/server.js before server.js.
  const segments = t.split("/").filter(Boolean);
  const tails = t.startsWith("/") ? segments.map((_, i) => segments.slice(i).join("/")) : [t];
  const bases = unique([baseDir, ""]);

  for (const tail of tails) {
    for (const base of bases) {
      const path = joinPath(base, tail);
      if (isFile(nodes, path)) return path;
    }
    // node dist/server.js → src/server.ts when the build output isn't committed.
    if (JS_EXT_RE.test(tail)) {
      for (const base of bases) {
        const mapped = resolveJsTarget(tail, base, nodes);
        if (mapped) return mapped.path;
      }
    }
  }
  return null;
}

function unique<T>(items: (T | null)[]): T[] {
  return [...new Set(items.filter((x): x is T => x !== null))];
}
