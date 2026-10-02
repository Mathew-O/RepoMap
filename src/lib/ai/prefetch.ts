import type { TreeNode } from "@/lib/types";

type Nodes = Readonly<Record<string, TreeNode>>;

/** Nodes that get a model-written summary; skipped files, links and submodules have fixed text. */
export function needsModelSummary(node: TreeNode | undefined): node is TreeNode {
  if (!node || node.path === "" || node.skip) return false;
  if (node.type === "dir") return (node.children?.length ?? 0) > 0;
  return node.type === "file" && node.size !== 0;
}

/**
 * The top two levels of the tree, generated up front, in the order that makes
 * folder roll-ups useful: second-level files, second-level folders, then
 * top-level files and finally top-level folders, so each folder is summarized
 * after its children. When over `limit`, every top-level entry is kept first.
 */
export function prefetchOrder(nodes: Nodes, limit: number): string[] {
  const top = (nodes[""]?.children ?? []).map((p) => nodes[p]).filter(needsModelSummary);
  const second = top
    .filter((n) => n.type === "dir")
    .flatMap((dir) => (dir.children ?? []).map((p) => nodes[p]))
    .filter(needsModelSummary);

  const chosen = new Set([...top, ...second].slice(0, limit).map((n) => n.path));
  const rank = (n: TreeNode) => (n.depth === 2 ? 0 : 2) + (n.type === "dir" ? 1 : 0);
  return [...second, ...top]
    .filter((n) => chosen.has(n.path))
    .sort((a, b) => rank(a) - rank(b))
    .map((n) => n.path);
}

/** Whether the server said it can generate summaries (anything unexpected counts as off). */
export function aiEnabled(tree: { ai?: string }): boolean {
  return tree.ai === "on" || tree.ai === "mock";
}
