"use client";

import {
  AlertIcon,
  CircleSlashIcon,
  type Icon,
  GitBranchIcon,
  KeyIcon,
  LinkIcon,
  LockIcon,
  RepoIcon,
  ShieldLockIcon,
  StopwatchIcon,
  SyncIcon,
} from "@primer/octicons-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { openTokenSettings } from "@/lib/client/token";
import { formatUntil } from "@/lib/format";
import type { ApiError, ApiErrorCode } from "@/lib/types";

const PRESENTATION: Record<ApiErrorCode, { icon: Icon; title: string; tokenAction?: string; retry?: boolean }> = {
  INVALID_URL: { icon: LinkIcon, title: "That isn't a repository link" },
  NOT_FOUND: { icon: RepoIcon, title: "Repository not found", tokenAction: "Add a token for private repos" },
  PRIVATE_REPO: { icon: LockIcon, title: "This repository is private", tokenAction: "Add a GitHub token" },
  REF_NOT_FOUND: { icon: GitBranchIcon, title: "Branch or tag not found" },
  EMPTY_REPO: { icon: RepoIcon, title: "This repository is empty" },
  RATE_LIMITED: { icon: StopwatchIcon, title: "GitHub rate limit reached", tokenAction: "Add a GitHub token", retry: true },
  BAD_TOKEN: { icon: KeyIcon, title: "Your GitHub token didn't work", tokenAction: "Update token", retry: true },
  FORBIDDEN: { icon: ShieldLockIcon, title: "Access denied", tokenAction: "Check token", retry: true },
  BLOCKED: { icon: CircleSlashIcon, title: "Repository unavailable" },
  UPSTREAM: { icon: AlertIcon, title: "Something went wrong", retry: true },
  NETWORK: { icon: AlertIcon, title: "Connection problem", retry: true },
};

/** Primer "blankslate"-style error panel with a clear next step. */
export function ErrorState({ error, input, onRetry }: { error: ApiError; input: string; onRetry: () => void }) {
  const { icon: IconComponent, title, tokenAction, retry } = PRESENTATION[error.code] ?? PRESENTATION.UPSTREAM;

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-10 md:px-6 lg:px-8">
      <div className="Box mx-auto max-w-[640px] px-6 py-12 text-center sm:px-10">
        <IconComponent size={32} className="mx-auto mb-4 text-fg-muted" />
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-base text-fg-muted">{error.message}</p>
        {error.hint && <p className="mt-1 text-sm text-fg-muted">{error.hint}</p>}
        {error.code === "RATE_LIMITED" && error.resetAt && <ResetCountdown resetAt={error.resetAt} />}

        <p className="mx-auto mt-4 max-w-full truncate font-mono text-xs text-fg-subtle" title={input}>
          {input}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {tokenAction && (
            <button type="button" className="btn btn-primary" onClick={openTokenSettings}>
              <KeyIcon />
              {tokenAction}
            </button>
          )}
          {retry && (
            <button type="button" className="btn" onClick={onRetry}>
              <SyncIcon />
              Try again
            </button>
          )}
          <Link href="/" className="btn">
            Try another repository
          </Link>
        </div>
      </div>
    </div>
  );
}

function ResetCountdown({ resetAt }: { resetAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const passed = new Date(resetAt).getTime() <= now;
  return (
    <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-canvas-subtle px-2.5 py-1 text-sm text-fg-muted">
      <StopwatchIcon size={14} />
      {passed ? "The limit has reset. Try again." : `Resets ${formatUntil(resetAt, now)}`}
    </p>
  );
}
