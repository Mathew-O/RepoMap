import { classifyDir, classifyFile } from "@/lib/classify";
import type {
  FileKind,
  NodeType,
  TreeNode,
  TreeSnapshot,
  TreeStats,
} from "@/lib/types";

/** One entry from GitHub's `GET /repos/{o}/{r}/git/trees/{sha}?recursive=1`. */
export interface GitTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

export interface BuildTreeOptions {
  maxNodes: number;
  truncatedByGitHub: boolean;
}

const KIND_PRIORITY: FileKind[] = ["source", "test", "docs", "config", "build", "asset", "other"];

/**
 * Turns GitHub's flat tree listing into RepoMap's path-keyed node map.
 *
 * If the repo has more than `maxNodes` entries, the shallowest ones are kept,
 * so the top of the map is always complete and only deep folders lose
 * children. Those folders get `hiddenChildren` so the UI can say so.
 */
export function buildTree(entries: GitTreeEntry[], options: BuildTreeOptions): TreeSnapshot {
  const sorted = [...entries].sort(
    (a, b) => depthOf(a.path) - depthOf(b.path) || compareStrings(a.path, b.path),
  );
  const kept = sorted.slice(0, options.maxNodes);
  const dropped = sorted.slice(options.maxNodes);

  const root: TreeNode = {
    path: "",
    name: "",
    type: "dir",
    parent: null,
    depth: 0,
    kind: "other",
    sha: "",
    children: [],
    fileCount: 0,
  };
  const nodes: Record<string, TreeNode> = { "": root };
  /** Name-based kind for dirs; undefined means "derive from contents". */
  const namedDirKind = new Map<string, FileKind | undefined>();

  const ensureDir = (path: string): TreeNode => {
    const existing = nodes[path];
    if (existing) return existing;
    // GitHub lists a directory before its contents, so this only happens
    // with odd truncated responses. Create the missing parent.
    const parent = ensureDir(parentOf(path));
    const node = makeNode(path, "dir", "", parent);
    nodes[path] = node;
    parent.children!.push(path);
    applyDirClassification(node, parent, namedDirKind);
    return node;
  };

  for (const entry of kept) {
    if (!entry.path || nodes[entry.path]) continue;
    const parent = ensureDir(parentOf(entry.path));
    const type = nodeTypeOf(entry);
    const node = makeNode(entry.path, type, entry.sha, parent);

    if (type === "dir") {
      applyDirClassification(node, parent, namedDirKind);
    } else {
      if (entry.size !== undefined) node.size = entry.size;
      if (type === "submodule") {
        node.kind = "other";
      } else {
        const { kind, skip } = classifyFile(entry.path, entry.size);
        node.kind = kind;
        const inherited = inheritedSkip(parent);
        const finalSkip = inherited ?? skip;
        if (finalSkip) node.skip = finalSkip;
      }
    }

    nodes[entry.path] = node;
    parent.children!.push(entry.path);
  }

  for (const entry of dropped) {
    // Only direct children of kept folders count. Deeper dropped entries
    // live inside a dropped folder, which is itself already counted.
    const parent = nodes[parentOf(entry.path)];
    if (parent) parent.hiddenChildren = (parent.hiddenChildren ?? 0) + 1;
  }

  const stats = finalize(nodes, namedDirKind);

  return {
    nodes,
    stats,
    truncation: {
      github: options.truncatedByGitHub,
      capped: dropped.length > 0,
      limit: options.maxNodes,
      totalEntries: entries.length,
      returnedEntries: kept.length,
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeNode(path: string, type: NodeType, sha: string, parent: TreeNode): TreeNode {
  const node: TreeNode = {
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    type,
    parent: parent.path,
    depth: parent.depth + 1,
    kind: "other",
    sha,
  };
  if (type === "dir") {
    node.children = [];
    node.fileCount = 0;
  }
  return node;
}

function applyDirClassification(
  node: TreeNode,
  parent: TreeNode,
  namedDirKind: Map<string, FileKind | undefined>,
) {
  const { kind, skip } = classifyDir(node.name, node.path);
  namedDirKind.set(node.path, kind);
  const finalSkip = inheritedSkip(parent) ?? skip;
  if (finalSkip) node.skip = finalSkip;
}

/** vendored/generated folders mark everything beneath them. */
function inheritedSkip(parent: TreeNode) {
  return parent.skip === "vendored" || parent.skip === "generated" ? parent.skip : undefined;
}

/** Bottom-up pass: sort children, roll up file counts and folder kinds. */
function finalize(nodes: Record<string, TreeNode>, namedDirKind: Map<string, FileKind | undefined>): TreeStats {
  const byKind = emptyKindCounts();
  const kindCounts = new Map<string, Record<FileKind, number>>();
  let files = 0;
  let dirs = 0;
  let skipped = 0;
  let totalBytes = 0;

  const ordered = Object.values(nodes).sort((a, b) => b.depth - a.depth);

  for (const node of ordered) {
    if (node.type === "dir") {
      if (node.path !== "") dirs++;
      const counts = kindCounts.get(node.path) ?? emptyKindCounts();
      node.kind = namedDirKind.get(node.path) ?? dominantKind(counts);
      node.children!.sort((a, b) => compareChildren(nodes[a]!, nodes[b]!));
      if (node.parent !== null) {
        const parentCounts = kindCounts.get(node.parent) ?? emptyKindCounts();
        for (const k of KIND_PRIORITY) parentCounts[k] += counts[k];
        kindCounts.set(node.parent, parentCounts);
        nodes[node.parent]!.fileCount! += node.fileCount ?? 0;
      }
      continue;
    }

    if (node.type === "submodule") continue;

    files++;
    byKind[node.kind]++;
    totalBytes += node.size ?? 0;
    if (node.skip) skipped++;
    if (node.parent !== null) {
      const parentCounts = kindCounts.get(node.parent) ?? emptyKindCounts();
      parentCounts[node.kind]++;
      kindCounts.set(node.parent, parentCounts);
      nodes[node.parent]!.fileCount! += 1;
    }
  }

  return { files, dirs, skipped, totalBytes, byKind };
}

function dominantKind(counts: Record<FileKind, number>): FileKind {
  const pick = (candidates: FileKind[]) => {
    let best: FileKind | null = null;
    for (const k of candidates) {
      if (counts[k] > 0 && (best === null || counts[k] > counts[best])) best = k;
    }
    return best;
  };
  // Prefer meaningful kinds; only call a folder "assets" if that's all it holds.
  return pick(["source", "test", "docs", "config", "build"]) ?? pick(["asset", "other"]) ?? "other";
}

function emptyKindCounts(): Record<FileKind, number> {
  return { source: 0, test: 0, config: 0, docs: 0, build: 0, asset: 0, other: 0 };
}

function nodeTypeOf(entry: GitTreeEntry): NodeType {
  if (entry.type === "tree") return "dir";
  if (entry.type === "commit") return "submodule";
  if (entry.mode === "120000") return "symlink";
  return "file";
}

/** GitHub file-list order: folders first, then case-insensitive A→Z. */
function compareChildren(a: TreeNode, b: TreeNode): number {
  const aDir = a.type === "dir" || a.type === "submodule" ? 0 : 1;
  const bDir = b.type === "dir" || b.type === "submodule" ? 0 : 1;
  return aDir - bDir || compareStrings(a.name, b.name);
}

function compareStrings(a: string, b: string): number {
  const ai = a.toLowerCase();
  const bi = b.toLowerCase();
  if (ai !== bi) return ai < bi ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function depthOf(path: string): number {
  let depth = 1;
  for (let i = 0; i < path.length; i++) if (path.charCodeAt(i) === 47) depth++;
  return depth;
}
