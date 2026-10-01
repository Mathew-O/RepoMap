"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchRepoTree, toApiError } from "@/lib/client/api";
import { TOKEN_CHANGED_EVENT } from "@/lib/client/token";
import type { ApiError, RepoTree } from "@/lib/types";

export type RepoTreeState =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "success"; data: RepoTree };

/** Loads a repo tree and refetches when the input or saved token changes. */
export function useRepoTree(input: string) {
  const [state, setState] = useState<RepoTreeState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchRepoTree(input, controller.signal).then(
      (data) => setState({ status: "success", data }),
      (err) => {
        if (!controller.signal.aborted) setState({ status: "error", error: toApiError(err) });
      },
    );
    return () => controller.abort();
  }, [input, attempt]);

  // A newly saved token (e.g. after hitting a rate limit) retries automatically.
  useEffect(() => {
    const onTokenChange = () => setAttempt((n) => n + 1);
    window.addEventListener(TOKEN_CHANGED_EVENT, onTokenChange);
    return () => window.removeEventListener(TOKEN_CHANGED_EVENT, onTokenChange);
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
