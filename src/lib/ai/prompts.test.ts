import { describe, expect, it } from "vitest";

import {
  buildFilePrompt,
  buildFolderPrompt,
  buildRepoContext,
  inspectContent,
  mockFileSummary,
  parseSummaryText,
  pickFolderExcerpts,
  prepareContent,
  staticSummary,
} from "@/lib/ai/prompts";
import { type GitTreeEntry, buildTree } from "@/lib/github/build-tree";
import type { RepoMeta, Summary } from "@/lib/types";

function treeOf(paths: string[], sizes: Record<string, number> = {}) {
  const entries: GitTreeEntry[] = paths.map((path) => ({ path, mode: "100644", type: "blob", sha: `sha-${path}`, size: sizes[path] ?? 100 }));
  return buildTree(entries, { maxNodes: 10_000, truncatedByGitHub: false }).nodes;
}

const meta = {
  owner: "acme",
  repo: "widget",
  fullName: "acme/widget",
  description: "Widgets for everyone",
  language: "TypeScript",
  topics: ["ui", "widgets"],
  license: "MIT",
} as RepoMeta;

const nodes = treeOf(
  ["README.md", "package.json", "src/index.ts", "src/render.ts", "src/util/math.ts", "package-lock.json", "logo.png", "empty.txt"],
  { "empty.txt": 0, "src/render.ts": 4_000 },
);

describe("prepareContent / inspectContent", () => {
  it("leaves short text alone", () => {
    expect(prepareContent("a\nb\n", 100)).toEqual({ text: "a\nb\n", truncated: false, shownLines: 2, totalLines: 2 });
  });

  it("cuts long text at a line boundary and counts what was kept", () => {
    const raw = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const prepared = prepareContent(raw, 50);
    expect(prepared.truncated).toBe(true);
    expect(prepared.text.endsWith("\n")).toBe(false);
    expect(prepared.text.split("\n").every((l) => /^line \d+$/.test(l))).toBe(true);
    expect(prepared.totalLines).toBe(100);
    expect(prepared.shownLines).toBe(prepared.text.split("\n").length);
  });

  it("normalizes CRLF", () => {
    expect(prepareContent("a\r\nb", 100).text).toBe("a\nb");
  });

  it("detects binary and empty content", () => {
    expect(inspectContent("abc\u0000def")).toBe("binary");
    expect(inspectContent("  \n\t")).toBe("empty");
    expect(inspectContent("const x = 1;")).toBe("text");
  });
});

describe("buildRepoContext", () => {
  const input = {
    meta,
    nodes,
    entryPoints: [{ path: "src/index.ts", reasons: ['package.json "main"'], source: "heuristic" as const, score: 0.8 }],
    readme: { path: "README.md", text: "# Widget\nMakes widgets." },
  };

  it("includes metadata, layout, entry points and the README", () => {
    const context = buildRepoContext(input);
    expect(context).toContain("Repository: acme/widget");
    expect(context).toContain("Description: Widgets for everyone");
    expect(context).toContain("Primary language: TypeScript · Topics: ui, widgets · License: MIT");
    expect(context).toContain("- src/ (folder, 3 files, mostly source)");
    expect(context).toContain("- package-lock.json (config, 100 B, not analyzed: lockfile)");
    expect(context).toContain('- src/index.ts: package.json "main"');
    expect(context).toContain('"""\n# Widget\nMakes widgets.\n"""');
  });

  it("is byte-identical across calls, so the prompt cache can hit", () => {
    expect(buildRepoContext(input)).toBe(buildRepoContext(input));
  });
});

describe("buildFilePrompt", () => {
  it("shows the path, size, siblings, entry-point evidence and the content", () => {
    const content = prepareContent("export function render() {}\n", 1_000);
    const prompt = buildFilePrompt({
      node: nodes["src/render.ts"]!,
      nodes,
      content,
      entryPoint: { path: "src/render.ts", reasons: ["a", "b"], source: "heuristic", score: 0.6 },
    });
    expect(prompt).toContain("Path: src/render.ts");
    expect(prompt).toContain("Size: 3.9 KB, 1 lines. Category: source.");
    expect(prompt).toContain("Detected entry point: a; b");
    expect(prompt).toContain("Also in src/: util/, index.ts");
    expect(prompt).toContain('<file path="src/render.ts">\nexport function render() {}\n\n</file>');
    expect(prompt).not.toContain("Only the first");
  });

  it("says when the file was cut", () => {
    const content = prepareContent("x\n".repeat(500), 100);
    const prompt = buildFilePrompt({ node: nodes["src/render.ts"]!, nodes, content });
    expect(prompt).toMatch(/\[Only the first \d+ of 500 lines are shown\.\]$/);
  });
});

describe("buildFolderPrompt / pickFolderExcerpts", () => {
  it("rolls up existing child summaries and lists the rest", () => {
    const summary: Summary = {
      path: "src/index.ts",
      target: "file",
      text: "Exports the public API.",
      status: "ok",
      model: "m",
      createdAt: "",
    };
    const prompt = buildFolderPrompt({
      node: nodes.src!,
      nodes,
      childSummaries: new Map([["src/index.ts", summary]]),
      excerpts: [{ path: "src/render.ts", content: prepareContent("render()", 100) }],
    });
    expect(prompt).toContain("Folder: src/ (3 files in total)");
    expect(prompt).toContain("- index.ts (source, 100 B): Exports the public API.");
    expect(prompt).toContain("- util/ (folder, 1 file, mostly source) — contains math.ts");
    expect(prompt).toContain('<file path="src/render.ts">\nrender()\n</file>');
  });

  it("prefers entry points and conventional names, skips summarized and skipped files", () => {
    const tree = treeOf(["lib/a.ts", "lib/index.ts", "lib/readme.md", "lib/big.ts", "lib/yarn.lock", "lib/done.ts"], { "lib/big.ts": 9_000 });
    const picked = pickFolderExcerpts(tree.lib!, tree, new Set(["lib/done.ts"]), new Set(["lib/a.ts"]), 3);
    expect(picked).toEqual(["lib/a.ts", "lib/index.ts", "lib/readme.md"]);
  });
});

describe("parseSummaryText", () => {
  it("reads the Unclear: convention", () => {
    expect(parseSummaryText("Unclear: the file only re-exports symbols.")).toEqual({
      text: "The file only re-exports symbols.",
      status: "unclear",
    });
  });

  it("strips wrapping quotes and whitespace", () => {
    expect(parseSummaryText('  "Renders widgets."\n')).toEqual({ text: "Renders widgets.", status: "ok" });
  });
});

describe("staticSummary", () => {
  it("explains skipped and empty files without a model", () => {
    expect(staticSummary(nodes["package-lock.json"]!)).toMatchObject({ status: "skipped", model: null });
    expect(staticSummary(nodes["logo.png"]!)?.text).toContain("Binary file");
    expect(staticSummary(nodes["empty.txt"]!)).toMatchObject({ status: "empty", text: "This file is empty." });
  });

  it("returns null for files and folders that need the model", () => {
    expect(staticSummary(nodes["src/index.ts"]!)).toBeNull();
    expect(staticSummary(nodes.src!)).toBeNull();
  });
});

describe("mockFileSummary", () => {
  it("is labeled as mock and grounded in declarations it can see", () => {
    const content = prepareContent("export function render() {}\nexport class Widget {}\n", 1_000);
    expect(mockFileSummary(nodes["src/render.ts"]!, content)).toBe(
      "[Mock] `render.ts` is a 2-line source file that declares `render`, `Widget`. Real summaries need ANTHROPIC_API_KEY on the server.",
    );
  });
});
