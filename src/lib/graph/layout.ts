import { hierarchy, tree as d3Tree } from "d3-hierarchy";

import type { TreeNode } from "@/lib/types";

/** Fixed node box. Fixed sizes let the layout run before React Flow measures anything. */
export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 40;
export const ROOT_WIDTH = 260;
const COLUMN_SPACING = NODE_WIDTH + 72;
const ROW_SPACING = NODE_HEIGHT + 12;

export type GraphItem =
  | { type: "entry"; path: string }
  | { type: "more"; parent: string; remaining: number }
  | { type: "hidden"; parent: string; count: number };

export interface PositionedItem {
  id: string;
  item: GraphItem;
  /** Top-left corner, in flow coordinates. */
  x: number;
  y: number;
  depth: number;
  parentId: string | null;
}

export interface GraphLayout {
  items: PositionedItem[];
  edges: { id: string; source: string; target: string }[];
}

interface Datum {
  id: string;
  item: GraphItem;
  children?: Datum[];
}

/** Stable React Flow id for a tree path. Prefixed so a file named "more" can't collide. */
export function entryId(path: string): string {
  return `n:${path}`;
}

/**
 * Left-to-right tidy tree of the visible part of the repo: the root, its
 * children, and the children of every expanded folder. Large folders are
 * paged (`pageSize` children, then a "+N more" node). Folders that lost
 * entries to the server-side node cap get a "not loaded" node.
 */
export function layoutTree(
  nodes: Record<string, TreeNode>,
  expanded: ReadonlySet<string>,
  pageLimits: Readonly<Record<string, number>>,
  pageSize: number,
): GraphLayout {
  const build = (path: string): Datum => {
    const node = nodes[path]!;
    const datum: Datum = { id: entryId(path), item: { type: "entry", path } };
    const isOpen = path === "" || expanded.has(path);
    if (node.type !== "dir" || !isOpen) return datum;

    const all = (node.children ?? []).filter((c) => nodes[c]);
    const limit = pageLimits[path] ?? pageSize;
    const kids: Datum[] = all.slice(0, limit).map(build);
    if (all.length > limit) {
      kids.push({ id: `more:${path}`, item: { type: "more", parent: path, remaining: all.length - limit } });
    }
    if (node.hiddenChildren) {
      kids.push({ id: `hidden:${path}`, item: { type: "hidden", parent: path, count: node.hiddenChildren } });
    }
    if (kids.length) datum.children = kids;
    return datum;
  };

  const root = hierarchy(build(""));
  d3Tree<Datum>()
    .nodeSize([ROW_SPACING, COLUMN_SPACING])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.35))(root);

  const items: PositionedItem[] = [];
  const edges: GraphLayout["edges"] = [];

  for (const d of root.descendants()) {
    // d3 lays out top-down; swap axes for left-to-right.
    items.push({
      id: d.data.id,
      item: d.data.item,
      x: d.y ?? 0,
      y: (d.x ?? 0) - NODE_HEIGHT / 2,
      depth: d.depth,
      parentId: d.parent ? d.parent.data.id : null,
    });
    if (d.parent) edges.push({ id: `e:${d.data.id}`, source: d.parent.data.id, target: d.data.id });
  }

  return { items, edges };
}
