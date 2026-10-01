import { describe, expect, it } from "vitest";

import { type GitTreeEntry, buildTree } from "@/lib/github/build-tree";
import { entryId, layoutTree } from "@/lib/graph/layout";

const blob = (path: string): GitTreeEntry => ({ path, mode: "100644", type: "blob", sha: path, size: 10 });
const dir = (path: string): GitTreeEntry => ({ path, mode: "040000", type: "tree", sha: path });

const { nodes } = buildTree(
  [dir("src"), blob("src/a.ts"), blob("src/b.ts"), blob("src/c.ts"), dir("docs"), blob("docs/x.md"), blob("README.md")],
  { maxNodes: 100, truncatedByGitHub: false },
);

describe("layoutTree", () => {
  it("starts with the root and its direct children only", () => {
    const { items, edges } = layoutTree(nodes, new Set(), {}, 50);
    expect(items.map((i) => i.id)).toEqual([entryId(""), entryId("docs"), entryId("src"), entryId("README.md")]);
    expect(edges).toHaveLength(3);
    expect(edges.every((e) => e.source === entryId(""))).toBe(true);
  });

  it("lays out left to right by depth", () => {
    const { items } = layoutTree(nodes, new Set(["src"]), {}, 50);
    const x = (id: string) => items.find((i) => i.id === id)!.x;
    expect(x(entryId(""))).toBe(0);
    expect(x(entryId("src"))).toBeGreaterThan(0);
    expect(x(entryId("src/a.ts"))).toBeGreaterThan(x(entryId("src")));
  });

  it("keeps siblings from overlapping", () => {
    const { items } = layoutTree(nodes, new Set(["src", "docs"]), {}, 50);
    const byColumn = new Map<number, number[]>();
    for (const i of items) byColumn.set(i.x, [...(byColumn.get(i.x) ?? []), i.y]);
    for (const ys of byColumn.values()) {
      const sorted = ys.sort((a, b) => a - b);
      for (let k = 1; k < sorted.length; k++) expect(sorted[k]! - sorted[k - 1]!).toBeGreaterThanOrEqual(40);
    }
  });

  it("pages large folders with a 'more' node", () => {
    // Root has 3 children too, so give it room and page only src.
    const { items } = layoutTree(nodes, new Set(["src"]), { "": 10 }, 2);
    const more = items.find((i) => i.item.type === "more");
    expect(more?.item).toEqual({ type: "more", parent: "src", remaining: 1 });
    expect(items.some((i) => i.id === entryId("src/c.ts"))).toBe(false);

    const paged = layoutTree(nodes, new Set(["src"]), { "": 10, src: 4 }, 2);
    expect(paged.items.some((i) => i.id === entryId("src/c.ts"))).toBe(true);
    expect(paged.items.some((i) => i.item.type === "more")).toBe(false);
  });
});
