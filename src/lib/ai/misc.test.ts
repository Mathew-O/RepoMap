import { describe, expect, it } from "vitest";

import { prefetchOrder } from "@/lib/ai/prefetch";
import { readNdjson } from "@/lib/client/ndjson";
import { type GitTreeEntry, buildTree } from "@/lib/github/build-tree";
import { activeJobCount, dedupe, runShared } from "@/lib/jobs";
import { SlidingWindowLimiter } from "@/lib/rate-limit";
import { mergeEntryPoints } from "@/lib/tree-utils";

function treeOf(paths: string[], sizes: Record<string, number> = {}) {
  const entries: GitTreeEntry[] = paths.map((path) => ({ path, mode: "100644", type: "blob", sha: `sha-${path}`, size: sizes[path] ?? 100 }));
  return buildTree(entries, { maxNodes: 10_000, truncatedByGitHub: false }).nodes;
}

describe("prefetchOrder", () => {
  const nodes = treeOf(
    ["README.md", "yarn.lock", "src/index.ts", "src/lib/a.ts", "docs/guide.md", "empty.txt", "node_modules/x/index.js"],
    { "empty.txt": 0 },
  );

  it("does second-level files, then second-level folders, then top-level files, then top-level folders", () => {
    expect(prefetchOrder(nodes, 100)).toEqual(["docs/guide.md", "src/index.ts", "src/lib", "README.md", "docs", "src"]);
  });

  it("keeps top-level entries first when over the limit", () => {
    expect(prefetchOrder(nodes, 3)).toEqual(["README.md", "docs", "src"]);
  });
});

describe("readNdjson", () => {
  it("handles lines and multi-byte characters split across chunks", async () => {
    const bytes = new TextEncoder().encode('{"a":"é"}\n{"b":2}\n{"c":3}');
    const chunks = [bytes.slice(0, 7), bytes.slice(7, 13), bytes.slice(13)];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const events: unknown[] = [];
    await readNdjson(body, (e) => events.push(e));
    expect(events).toEqual([{ a: "é" }, { b: 2 }, { c: 3 }]);
  });
});

describe("runShared", () => {
  it("runs one job per key, replays past events to late joiners, and cleans up", async () => {
    let starts = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const start = async (emit: (e: string) => void) => {
      starts++;
      emit("a");
      await gate;
      emit("b");
      return "done";
    };
    const first: string[] = [];
    const second: string[] = [];
    const p1 = runShared("k", start, (e) => first.push(e));
    const p2 = runShared("k", start, (e) => second.push(e));
    release();
    expect(await Promise.all([p1, p2])).toEqual(["done", "done"]);
    expect(starts).toBe(1);
    expect(first).toEqual(["a", "b"]);
    expect(second).toEqual(["a", "b"]);
    expect(activeJobCount()).toBe(0);
  });

  it("shares failures and lets the next call start fresh", async () => {
    let calls = 0;
    const failing = () => {
      calls++;
      return Promise.reject(new Error("nope"));
    };
    await expect(Promise.all([dedupe("f", failing), dedupe("f", failing)])).rejects.toThrow("nope");
    expect(calls).toBe(1);
    await expect(dedupe("f", failing)).rejects.toThrow("nope");
    expect(calls).toBe(2);
  });
});

describe("SlidingWindowLimiter", () => {
  it("allows `limit` hits per window per key", () => {
    const limiter = new SlidingWindowLimiter(2, 1_000);
    expect([limiter.take("a", 0), limiter.take("a", 10), limiter.take("a", 20)]).toEqual([true, true, false]);
    expect(limiter.take("b", 20)).toBe(true);
    expect(limiter.take("a", 1_011)).toBe(true);
  });
});

describe("mergeEntryPoints", () => {
  const nodes = treeOf(["a.ts", "b.ts", "c.ts"]);
  const heuristic = [
    { path: "a.ts", reasons: ["h-a"], source: "heuristic" as const, score: 0.8 },
    { path: "b.ts", reasons: ["h-b"], source: "heuristic" as const, score: 0.6 },
  ];

  it("puts the AI's picks first with its reason leading, then the rest", () => {
    expect(mergeEntryPoints(heuristic, [{ path: "b.ts", why: "AI says so" }, { path: "c.ts", why: "Also" }, { path: "zzz.ts", why: "x" }], nodes, 8)).toEqual([
      { path: "b.ts", reasons: ["AI says so", "h-b"], source: "llm", score: 0.9 },
      { path: "c.ts", reasons: ["Also"], source: "llm", score: 0.9 },
      heuristic[0],
    ]);
  });

  it("returns the heuristic list untouched without AI picks", () => {
    expect(mergeEntryPoints(heuristic, undefined, nodes, 8)).toBe(heuristic);
  });
});
