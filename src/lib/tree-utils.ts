import type { EntryPoint, FileKind, RepoMeta, TreeNode } from "@/lib/types";

type Nodes = Record<string, TreeNode>;

/** Folders that must be expanded for `path` to be visible (excludes the root). */
export function ancestorsOf(path: string | null, nodes: Nodes): string[] {
  const result: string[] = [];
  let current = path ? nodes[path] : undefined;
  while (current?.parent) {
    result.push(current.parent);
    current = nodes[current.parent];
  }
  return result.reverse();
}

/** Root → … → path, for breadcrumbs. */
export function pathChain(path: string, nodes: Nodes): TreeNode[] {
  const chain: TreeNode[] = [];
  let current: TreeNode | undefined = nodes[path];
  while (current) {
    chain.push(current);
    current = current.parent !== null ? nodes[current.parent] : undefined;
  }
  return chain.reverse();
}

/** Kind counts for every file beneath a folder. */
export function descendantKindCounts(path: string, nodes: Nodes): Record<FileKind, number> {
  const counts: Record<FileKind, number> = { source: 0, test: 0, config: 0, docs: 0, build: 0, asset: 0, other: 0 };
  const stack = [path];
  while (stack.length) {
    const node = nodes[stack.pop()!];
    if (!node) continue;
    if (node.type === "dir") stack.push(...(node.children ?? []));
    else if (node.type !== "submodule") counts[node.kind]++;
  }
  return counts;
}

/** Direct children split into folders and files. */
export function childCounts(node: TreeNode, nodes: Nodes): { dirs: number; files: number } {
  let dirs = 0;
  let files = 0;
  for (const child of node.children ?? []) {
    if (nodes[child]?.type === "dir") dirs++;
    else files++;
  }
  return { dirs, files };
}

/** Permalink on github.com, pinned to the commit being viewed. */
export function githubUrl(meta: RepoMeta, path: string, view: "tree" | "blob"): string {
  if (!path) return `${meta.htmlUrl}/tree/${meta.commitSha}`;
  return `${meta.htmlUrl}/${view}/${meta.commitSha}/${encodePath(path)}`;
}

export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export interface EntryIndex {
  byPath: ReadonlyMap<string, EntryPoint>;
  /** Folders (not the root) with a "Start here" entry somewhere beneath them. */
  containers: ReadonlySet<string>;
}

export function indexEntryPoints(points: EntryPoint[], nodes: Nodes): EntryIndex {
  const containers = new Set<string>();
  for (const point of points) for (const dir of ancestorsOf(point.path, nodes)) containers.add(dir);
  return { byPath: new Map(points.map((p) => [p.path, p])), containers };
}

/** Entry points inside a folder ("" = the whole repo). */
export function entryPointsUnder(dir: string, points: EntryPoint[]): EntryPoint[] {
  return dir === "" ? points : points.filter((p) => p.path.startsWith(`${dir}/`));
}

/** Names that say little on their own (index.ts, main.go), so labels add the parent folder. */
const GENERIC_NAME_RE = /^(index|main|__main__|__init__|mod|lib|page|layout|program)\.[a-z0-9]+$/i;

/** Short, unambiguous label for a path among `siblings`: "cli.ts", or "gh/main.go" when the name alone is vague. */
export function shortLabel(path: string, siblings: readonly string[]): string {
  const segments = path.split("/");
  const name = segments[segments.length - 1]!;
  const duplicate = siblings.some((other) => other !== path && other.slice(other.lastIndexOf("/") + 1) === name);
  if (segments.length > 1 && (duplicate || GENERIC_NAME_RE.test(name))) return segments.slice(-2).join("/");
  return name;
}
