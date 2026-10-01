import { describe, expect, it } from "vitest";

import { type GitTreeEntry, buildTree } from "@/lib/github/build-tree";

const blob = (path: string, size = 100): GitTreeEntry => ({ path, mode: "100644", type: "blob", sha: `sha-${path}`, size });
const dir = (path: string): GitTreeEntry => ({ path, mode: "040000", type: "tree", sha: `sha-${path}` });

const ENTRIES: GitTreeEntry[] = [
  blob("README.md"),
  dir("src"),
  blob("src/index.ts", 500),
  blob("src/util.ts", 300),
  dir("src/__tests__"),
  blob("src/__tests__/index.test.ts"),
  dir("node_modules"),
  dir("node_modules/left-pad"),
  blob("node_modules/left-pad/index.js"),
  blob("package.json"),
  blob("package-lock.json", 90_000),
  dir("Zeta"),
  blob("Zeta/a.go"),
  { path: "libs/shared", mode: "160000", type: "commit", sha: "abc" },
  { path: "link", mode: "120000", type: "blob", sha: "def", size: 10 },
];

describe("buildTree", () => {
  const { nodes, stats, truncation } = buildTree(ENTRIES, { maxNodes: 1000, truncatedByGitHub: false });

  it("creates a root and parent links", () => {
    expect(nodes[""]?.children).toBeDefined();
    expect(nodes["src/index.ts"]).toMatchObject({ parent: "src", depth: 2, name: "index.ts", type: "file" });
    expect(nodes["libs/shared"]?.type).toBe("submodule");
    expect(nodes["link"]?.type).toBe("symlink");
  });

  it("synthesizes missing parent directories", () => {
    expect(nodes["libs"]).toMatchObject({ type: "dir", parent: "" });
  });

  it("sorts children folders-first, case-insensitively", () => {
    expect(nodes[""]!.children).toEqual([
      "libs",
      "node_modules",
      "src",
      "Zeta",
      "link",
      "package-lock.json",
      "package.json",
      "README.md",
    ]);
  });

  it("rolls up file counts and kinds", () => {
    expect(nodes["src"]).toMatchObject({ fileCount: 3, kind: "source" });
    expect(nodes["src/__tests__"]?.kind).toBe("test");
    expect(nodes[""]?.fileCount).toBe(stats.files);
  });

  it("inherits vendored skip to descendants", () => {
    expect(nodes["node_modules/left-pad"]?.skip).toBe("vendored");
    expect(nodes["node_modules/left-pad/index.js"]?.skip).toBe("vendored");
    expect(nodes["package-lock.json"]?.skip).toBe("lockfile");
  });

  it("computes stats", () => {
    // README, index.ts, util.ts, index.test.ts, left-pad/index.js, package.json, lock, a.go, link
    expect(stats.files).toBe(9);
    expect(stats.skipped).toBe(2);
    expect(stats.byKind.test).toBe(1);
    expect(truncation).toMatchObject({ capped: false, github: false, totalEntries: ENTRIES.length });
  });
});

describe("buildTree node cap", () => {
  it("keeps shallow entries and reports hidden children", () => {
    const entries = [dir("a"), blob("a/1"), blob("a/2"), dir("a/deep"), blob("a/deep/x"), blob("top")];
    const { nodes, truncation } = buildTree(entries, { maxNodes: 4, truncatedByGitHub: true });

    // depth 1: a, top · depth 2 (sorted): a/1, a/2 → a/deep and a/deep/x dropped
    expect(Object.keys(nodes).sort()).toEqual(["", "a", "a/1", "a/2", "top"]);
    expect(nodes["a"]?.hiddenChildren).toBe(1);
    expect(truncation).toMatchObject({ capped: true, github: true, limit: 4, returnedEntries: 4, totalEntries: 6 });
  });
});
