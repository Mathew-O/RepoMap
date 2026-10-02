import { describe, expect, it } from "vitest";

import { type SummaryFetcher, SummaryStore } from "@/lib/client/summary-store";
import type { Summary, SummaryEvent } from "@/lib/types";

const target = { repo: "acme/widget", sha: "a".repeat(40) };

const summary = (path: string): Summary => ({ path, target: "file", text: `About ${path}`, status: "ok", model: "m", createdAt: "" });

/** A fetcher whose requests the test resolves by hand. */
function controllableFetcher() {
  const calls: { paths: string[]; emit: (e: SummaryEvent) => void; finish: () => void; fail: (err: unknown) => void }[] = [];
  const fetcher: SummaryFetcher = (_target, paths, onEvent) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ paths, emit: onEvent, finish: resolve, fail: reject });
    });
  return { calls, fetcher };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("SummaryStore", () => {
  it("sends paths in batches of 8, at most two requests at a time", () => {
    const { calls, fetcher } = controllableFetcher();
    const store = new SummaryStore(target, fetcher);
    store.request(Array.from({ length: 20 }, (_, i) => `f${i}`));
    expect(calls.map((c) => c.paths.length)).toEqual([8, 8]);
    expect(store.get("f0")).toEqual({ status: "streaming", text: "" });
    expect(store.get("f19")).toEqual({ status: "queued" });
  });

  it("accumulates deltas, then stores the final summary, then starts the next batch", async () => {
    const { calls, fetcher } = controllableFetcher();
    const store = new SummaryStore(target, fetcher);
    store.request(Array.from({ length: 17 }, (_, i) => `f${i}`));
    const first = calls[0]!;
    first.emit({ type: "delta", path: "f0", text: "About " });
    first.emit({ type: "delta", path: "f0", text: "f0" });
    expect(store.get("f0")).toEqual({ status: "streaming", text: "About f0" });
    for (const path of first.paths) first.emit({ type: "summary", summary: summary(path) });
    first.finish();
    await tick();
    expect(store.get("f0")).toEqual({ status: "done", summary: summary("f0") });
    expect(calls).toHaveLength(3);
    expect(calls[2]!.paths).toEqual(["f16"]);
  });

  it("puts urgent requests first and doesn't request loaded paths again", async () => {
    const { calls, fetcher } = controllableFetcher();
    const store = new SummaryStore(target, fetcher);
    store.request(Array.from({ length: 24 }, (_, i) => `f${i}`));
    store.request(["f23", "clicked"], { urgent: true });
    const first = calls[0]!;
    for (const path of first.paths) first.emit({ type: "summary", summary: summary(path) });
    first.finish();
    await tick();
    expect(calls[2]!.paths.slice(0, 2)).toEqual(["f23", "clicked"]);
    store.request(["f0"], { urgent: true });
    expect(calls).toHaveLength(3);
  });

  it("marks a path failed on an error event and lets it be retried", async () => {
    const { calls, fetcher } = controllableFetcher();
    const store = new SummaryStore(target, fetcher);
    store.request(["a", "b"]);
    calls[0]!.emit({ type: "error", path: "a", error: { code: "AI_ERROR", message: "boom" } });
    calls[0]!.emit({ type: "summary", summary: summary("b") });
    calls[0]!.finish();
    await tick();
    expect(store.get("a")).toEqual({ status: "error", error: { code: "AI_ERROR", message: "boom" } });
    store.retry("a");
    expect(calls[1]!.paths).toEqual(["a"]);
  });

  it("stops everything on a fatal error and drops the queue", async () => {
    const { calls, fetcher } = controllableFetcher();
    const store = new SummaryStore(target, fetcher);
    store.request(Array.from({ length: 30 }, (_, i) => `f${i}`));
    calls[0]!.emit({ type: "error", path: "f0", error: { code: "AI_UNAVAILABLE", message: "off" } });
    calls[0]!.finish();
    await tick();
    expect(store.fatal?.code).toBe("AI_UNAVAILABLE");
    // No new batch starts after a fatal error.
    expect(calls).toHaveLength(2);
    expect(store.get("f29")).toBeUndefined();
    store.request(["new"]);
    expect(store.get("new")).toBeUndefined();
  });

  it("fails paths the stream never answered", async () => {
    const { calls, fetcher } = controllableFetcher();
    const store = new SummaryStore(target, fetcher);
    store.request(["a"]);
    calls[0]!.finish();
    await tick();
    expect(store.get("a")).toMatchObject({ status: "error", error: { code: "AI_ERROR" } });
  });

  it("notifies subscribers and stops after dispose", async () => {
    const { calls, fetcher } = controllableFetcher();
    const store = new SummaryStore(target, fetcher);
    let notified = 0;
    store.subscribe(() => notified++);
    store.request(["a"]);
    expect(notified).toBeGreaterThan(0);
    store.dispose();
    const before = notified;
    calls[0]!.emit({ type: "summary", summary: summary("a") });
    expect(notified).toBe(before);
  });
});
