import { describe, expect, it } from "vitest";

import { buildOverviewPrompt, extractPartialString, listOverviewPaths, parseOverview } from "@/lib/ai/overview-format";
import { prepareContent } from "@/lib/ai/prompts";
import { type GitTreeEntry, buildTree } from "@/lib/github/build-tree";
import { RepoMapError } from "@/lib/github/errors";
import type { RepoMeta } from "@/lib/types";

function snapshotOf(paths: string[]) {
  const entries: GitTreeEntry[] = paths.map((path) => ({ path, mode: "100644", type: "blob", sha: `sha-${path}`, size: 100 }));
  return buildTree(entries, { maxNodes: 10_000, truncatedByGitHub: false });
}

const { nodes, stats } = snapshotOf(["README.md", "package.json", "src/index.ts", "src/core/engine.ts", "logo.png", "yarn.lock"]);

describe("parseOverview", () => {
  const now = new Date("2026-10-02T00:00:00Z");

  it("keeps only real paths, normalizes them, dedupes and caps the lists", () => {
    const json = JSON.stringify({
      what: " A widget toolkit. ",
      techStack: ["TypeScript", "TypeScript", "", "x".repeat(60), "Node.js"],
      whereToStart: "Open `src/index.ts`.",
      startHere: [
        { path: "./src/index.ts", why: "Public API." },
        { path: "src/made-up.ts", why: "Hallucinated." },
        { path: "src/index.ts", why: "Duplicate." },
      ],
      readingOrder: Array.from({ length: 12 }, () => ({ path: "README.md", why: "x" })).concat([
        { path: "src/core/", why: "Core." },
        { path: "/package.json", why: "Deps." },
      ]),
    });
    const overview = parseOverview(json, nodes, "claude-opus-5-5", now);
    expect(overview).toEqual({
      what: "A widget toolkit.",
      techStack: ["TypeScript", "Node.js"],
      whereToStart: "Open `src/index.ts`.",
      startHere: [{ path: "src/index.ts", why: "Public API." }],
      readingOrder: [
        { path: "README.md", why: "x" },
        { path: "src/core", why: "Core." },
        { path: "package.json", why: "Deps." },
      ],
      model: "claude-opus-5-5",
      createdAt: "2026-10-02T00:00:00.000Z",
    });
  });

  it("treats missing fields as empty and rejects non-JSON", () => {
    expect(parseOverview("{}", nodes, "m")).toMatchObject({ what: "", techStack: [], startHere: [], readingOrder: [] });
    expect(() => parseOverview("not json", nodes, "m")).toThrow(RepoMapError);
  });
});

describe("extractPartialString", () => {
  it("returns null until the field starts", () => {
    expect(extractPartialString('{"wh', "what")).toBeNull();
  });

  it("reads a string that is still streaming", () => {
    expect(extractPartialString('{"what": "A tool kit for', "what")).toBe("A tool kit for");
  });

  it("stops at the closing quote and decodes escapes", () => {
    expect(extractPartialString('{"what":"Say \\"hi\\"\\nthen \\u00e9","techStack":[]}', "what")).toBe('Say "hi"\nthen é');
  });

  it("waits on an escape that was cut mid-way", () => {
    expect(extractPartialString('{"what":"abc\\', "what")).toBe("abc");
    expect(extractPartialString('{"what":"abc\\u00', "what")).toBe("abc");
  });
});

describe("listOverviewPaths", () => {
  it("lists analyzable files shallowest first, guarantees the must-haves, and caps", () => {
    expect(listOverviewPaths(nodes, ["src/core/engine.ts"], 3)).toEqual(["src/core/engine.ts", "package.json", "README.md"]);
    expect(listOverviewPaths(nodes, [], 100)).not.toContain("logo.png");
    expect(listOverviewPaths(nodes, [], 100)).not.toContain("yarn.lock");
  });
});

describe("buildOverviewPrompt", () => {
  it("includes the evidence blocks and the allowed paths", () => {
    const prompt = buildOverviewPrompt({
      meta: { fullName: "acme/widget", description: null, language: "TypeScript", topics: [] } as unknown as RepoMeta,
      nodes,
      stats,
      entryPoints: [{ path: "src/index.ts", reasons: ['package.json "main"'], source: "heuristic", score: 0.7 }],
      readme: { path: "README.md", content: prepareContent("# Widget", 100) },
      manifests: [{ path: "package.json", content: prepareContent('{"name":"widget"}', 100) }],
      entryFiles: [],
      paths: ["README.md", "src/index.ts"],
    });
    expect(prompt).toContain("Description: (none)");
    expect(prompt).toContain('- src/index.ts: package.json "main"');
    expect(prompt).toContain('<file path="README.md">\n# Widget\n</file>');
    expect(prompt).toContain("PATHS (2 of 6 files, shallowest first):\nREADME.md\nsrc/index.ts");
  });
});
