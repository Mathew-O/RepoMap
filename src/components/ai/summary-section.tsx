"use client";

import { AlertIcon, SparkleFillIcon, SyncIcon } from "@primer/octicons-react";
import { useId } from "react";

import { useRequestSummary, useSummary, useSummaryStore } from "@/components/ai/summary-context";
import { SummarySkeleton, SummaryText } from "@/components/ai/summary-text";
import { aiEnabled, needsModelSummary } from "@/lib/ai/prefetch";
import { staticSummary } from "@/lib/ai/prompts";
import type { RepoTree, TreeNode } from "@/lib/types";

/** The selected file's or folder's AI summary in the details panel; requested on selection. */
export function SummarySection({ tree, node }: { tree: RepoTree; node: TreeNode }) {
  const headingId = useId();
  useRequestSummary(tree, node.path);
  const entry = useSummary(node.path);
  const store = useSummaryStore();
  const fixed = needsModelSummary(node) ? null : staticSummary(node);

  let body: React.ReactNode;
  if (!aiEnabled(tree)) {
    body = <p className="text-sm text-fg-muted">AI summaries are turned off on this server.</p>;
  } else if (fixed) {
    body = <SummaryText text={fixed.text} className="text-fg-muted" />;
  } else if (!entry || entry.status === "queued") {
    body = <SummarySkeleton label="Waiting for a summary…" />;
  } else if (entry.status === "streaming") {
    body = entry.text ? (
      <SummaryText text={entry.text} streaming />
    ) : (
      <SummarySkeleton label={node.type === "dir" ? "Reading the folder…" : "Reading the file…"} />
    );
  } else if (entry.status === "error") {
    const canRetry = entry.error.code !== "AI_UNAVAILABLE" && entry.error.code !== "AI_REFUSED";
    body = (
      <div className="flex items-start gap-2 text-sm">
        <AlertIcon size={16} className="mt-0.5 shrink-0 text-attention" />
        <div className="min-w-0 space-y-1">
          <p>{entry.error.message}</p>
          {entry.error.hint && <p className="text-fg-muted">{entry.error.hint}</p>}
          {canRetry && store && (
            <button type="button" className="btn btn-sm mt-1" onClick={() => store.retry(node.path)}>
              <SyncIcon />
              Try again
            </button>
          )}
        </div>
      </div>
    );
  } else {
    const { summary } = entry;
    body = (
      <div className="space-y-1.5">
        {summary.status === "unclear" && <span className="Label Label--attention">Unclear</span>}
        <SummaryText text={summary.text} />
        {summary.truncated && <p className="text-xs text-fg-muted">Based on the first part of this long file.</p>}
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} aria-busy={entry?.status === "streaming" || entry?.status === "queued"} className="space-y-2">
      <h3 id={headingId} className="flex items-center gap-1.5 text-sm font-semibold">
        <SparkleFillIcon size={14} className="text-done" />
        Summary
        {tree.ai === "mock" && <span className="Label py-0! text-[11px]! leading-4!">mock</span>}
      </h3>
      {body}
    </section>
  );
}
