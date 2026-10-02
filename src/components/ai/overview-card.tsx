"use client";

import { AlertIcon, ChevronDownIcon, InfoIcon, SparkleFillIcon, SyncIcon } from "@primer/octicons-react";
import { useEffect, useState } from "react";

import { SummarySkeleton, SummaryText } from "@/components/ai/summary-text";
import { NodeIcon } from "@/components/repo/node-icon";
import type { OverviewState } from "@/hooks/use-overview";
import type { RepoTree } from "@/lib/types";

const COLLAPSED_KEY = "repomap:overview-collapsed";

/** "About this repository": the AI overview at the top of the explorer. */
export function OverviewCard({
  tree,
  state,
  onRetry,
  onSelect,
}: {
  tree: RepoTree;
  state: OverviewState;
  onRetry: () => void;
  onSelect: (path: string, options?: { reveal?: boolean }) => void;
}) {
  const [collapsed, setCollapsed] = useCollapsed();

  if (state.status === "off") {
    return (
      <div className="flash flash-info" role="note">
        <InfoIcon size={16} />
        <p className="text-sm">
          AI overviews and summaries are turned off on this server. The map, entry points and file details still work.
          <span className="text-fg-muted"> To turn them on, set <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> on the server.</span>
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="overview-heading" className="Box overflow-hidden">
      <div className="Box-header flex items-center gap-2 py-2!">
        <SparkleFillIcon size={16} className="text-done" />
        <h2 id="overview-heading" className="text-sm font-semibold">
          Overview
        </h2>
        <span className="Label py-0! text-[11px]! leading-4!">{tree.ai === "mock" ? "mock AI" : "AI generated"}</span>
        <button
          type="button"
          className="btn btn-sm btn-invisible ml-auto text-fg-muted!"
          aria-expanded={!collapsed}
          aria-controls="overview-body"
          onClick={() => setCollapsed(!collapsed)}
        >
          <ChevronDownIcon className={`transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`} />
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>

      {!collapsed && (
        <div id="overview-body" className="p-4" aria-busy={state.status === "loading"}>
          {state.status === "loading" &&
            (state.what ? (
              <SummaryText text={state.what} streaming />
            ) : (
              <SummarySkeleton label="Reading the README, manifests and entry points…" />
            ))}

          {state.status === "error" && (
            <div className="flex items-start gap-2 text-sm">
              <AlertIcon size={16} className="mt-0.5 shrink-0 text-attention" />
              <div className="space-y-1">
                <p>{state.error.message}</p>
                {state.error.hint && <p className="text-fg-muted">{state.error.hint}</p>}
                {state.error.code !== "AI_UNAVAILABLE" && (
                  <button type="button" className="btn btn-sm mt-1" onClick={onRetry}>
                    <SyncIcon />
                    Try again
                  </button>
                )}
              </div>
            </div>
          )}

          {state.status === "done" && <OverviewBody tree={tree} state={state} onSelect={onSelect} />}
        </div>
      )}
    </section>
  );
}

function OverviewBody({
  tree,
  state,
  onSelect,
}: {
  tree: RepoTree;
  state: Extract<OverviewState, { status: "done" }>;
  onSelect: (path: string, options?: { reveal?: boolean }) => void;
}) {
  const { overview } = state;
  return (
    <div className="space-y-4">
      <SummaryText text={overview.what} className="text-base! leading-7!" />

      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-4">
          {overview.techStack.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-fg-muted uppercase">Tech stack</h3>
              <ul className="flex flex-wrap gap-1.5">
                {overview.techStack.map((tech) => (
                  <li key={tech} className="topic-tag">
                    {tech}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {overview.whereToStart && (
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-fg-muted uppercase">Where to start</h3>
              <SummaryText text={overview.whereToStart} />
            </div>
          )}
        </div>

        {overview.readingOrder.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold text-fg-muted uppercase">Suggested reading order</h3>
            <ol className="Box divide-y divide-border-muted overflow-hidden">
              {overview.readingOrder.map((step, i) => {
                const node = tree.nodes[step.path];
                if (!node) return null;
                return (
                  <li key={step.path}>
                    <button
                      type="button"
                      onClick={() => onSelect(step.path, { reveal: true })}
                      className="flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left hover:bg-row-hover"
                    >
                      <span className="Counter mt-0.5 shrink-0 tabular-nums">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5 text-sm">
                          <NodeIcon node={node} />
                          <span className="truncate font-medium text-accent">{step.path}</span>
                        </span>
                        {step.why && <span className="mt-0.5 block text-xs text-fg-muted">{step.why}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>

      <p className="text-xs text-fg-muted">
        Written by {overview.model} from the README, manifests and entry-point files. It can be wrong, so check the code it points to.
      </p>
    </div>
  );
}

/** Per-viewer convenience; falls back to expanded when storage is unavailable. */
function useCollapsed(): [boolean, (value: boolean) => void] {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // Storage blocked; keep the default.
    }
  }, []);
  const update = (value: boolean) => {
    setCollapsed(value);
    try {
      localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
    } catch {
      // Storage blocked; the choice just won't persist.
    }
  };
  return [collapsed, update];
}
