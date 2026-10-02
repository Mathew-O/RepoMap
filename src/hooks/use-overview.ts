"use client";

import { useCallback, useEffect, useState } from "react";

import { aiEnabled } from "@/lib/ai/prefetch";
import { streamOverview } from "@/lib/client/ai";
import { toApiError } from "@/lib/client/api";
import type { ApiError, ProjectOverview, RepoTree } from "@/lib/types";

export type OverviewState =
  | { status: "off" }
  | { status: "loading"; what: string }
  | { status: "done"; overview: ProjectOverview }
  | { status: "error"; error: ApiError };

/** Streams the AI overview for the commit being viewed (served from cache after the first time). */
export function useOverview(tree: RepoTree) {
  const [state, setState] = useState<OverviewState>(() =>
    !aiEnabled(tree) ? { status: "off" } : { status: "loading", what: "" },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!aiEnabled(tree)) {
      setState({ status: "off" });
      return;
    }
    const controller = new AbortController();
    let settled = false;
    setState({ status: "loading", what: "" });

    streamOverview(
      { repo: tree.meta.fullName, sha: tree.meta.commitSha },
      (event) => {
        if (event.type === "partial") {
          setState({ status: "loading", what: event.what });
          return;
        }
        settled = true;
        setState(event.type === "overview" ? { status: "done", overview: event.overview } : { status: "error", error: event.error });
      },
      controller.signal,
    ).then(
      () => {
        if (!settled && !controller.signal.aborted) {
          setState({ status: "error", error: { code: "AI_ERROR", message: "The overview stopped before it finished.", hint: "Try again." } });
        }
      },
      (err) => {
        if (!controller.signal.aborted) setState({ status: "error", error: toApiError(err) });
      },
    );
    return () => controller.abort();
  }, [tree, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
