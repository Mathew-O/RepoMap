"use client";

import { type ReactNode, createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

import { aiEnabled, needsModelSummary, prefetchOrder } from "@/lib/ai/prefetch";
import { streamSummaries } from "@/lib/client/ai";
import { type SummaryEntry, SummaryStore } from "@/lib/client/summary-store";
import { SUMMARY_PREFETCH_LIMIT } from "@/lib/config";
import type { RepoTree } from "@/lib/types";

const StoreContext = createContext<SummaryStore | null>(null);

/**
 * One SummaryStore per commit. On mount it queues the top two levels of the
 * tree (the "batch up front" pass); everything else is requested on click.
 * Renders children unchanged when AI is off.
 */
export function SummaryProvider({ tree, children }: { tree: RepoTree; children: ReactNode }) {
  const [store, setStore] = useState<SummaryStore | null>(null);

  useEffect(() => {
    if (!aiEnabled(tree)) return;
    const created = new SummaryStore({ repo: tree.meta.fullName, sha: tree.meta.commitSha }, streamSummaries);
    setStore(created);
    created.request(prefetchOrder(tree.nodes, SUMMARY_PREFETCH_LIMIT));
    return () => created.dispose();
  }, [tree]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useSummaryStore(): SummaryStore | null {
  return useContext(StoreContext);
}

const noopSubscribe = () => () => {};

/** This path's summary state; re-renders only when it changes. */
export function useSummary(path: string | null): SummaryEntry | undefined {
  const store = useContext(StoreContext);
  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    () => (store && path !== null ? store.get(path) : undefined),
    () => undefined,
  );
}

/** Asks for a summary of the selected path (jumping the queue) whenever the selection changes. */
export function useRequestSummary(tree: RepoTree, path: string) {
  const store = useContext(StoreContext);
  useEffect(() => {
    if (store && needsModelSummary(tree.nodes[path])) store.request([path], { urgent: true });
  }, [store, tree, path]);
}
