"use client";

import {
  AlertIcon,
  DatabaseIcon,
  FileDirectoryIcon,
  FileIcon,
  GitBranchIcon,
  GitCommitIcon,
  InfoIcon,
  SkipIcon,
} from "@primer/octicons-react";

import { ErrorState } from "@/components/repo/error-state";
import { RepoHeader } from "@/components/repo/repo-header";
import { RepoSkeleton } from "@/components/repo/repo-skeleton";
import { TreeList, githubUrl } from "@/components/repo/tree-list";
import { useRepoTree } from "@/hooks/use-repo-tree";
import { formatBytes, formatNumber, shortSha } from "@/lib/format";
import type { RepoTree } from "@/lib/types";

export function RepoExplorer({ input }: { input: string }) {
  const { state, retry } = useRepoTree(input);

  if (state.status === "loading") return <RepoSkeleton />;
  if (state.status === "error") return <ErrorState error={state.error} input={input} onRetry={retry} />;

  const tree = state.data;
  return (
    <>
      <RepoHeader tree={tree} />
      <div className="mx-auto w-full max-w-[1280px] space-y-4 px-4 py-6 md:px-6 lg:px-8">
        <Toolbar tree={tree} />
        <TruncationNotice tree={tree} />
        <TreeList tree={tree} />
      </div>
    </>
  );
}

function Toolbar({ tree }: { tree: RepoTree }) {
  const { meta, stats } = tree;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`${meta.htmlUrl}/tree/${encodeURIComponent(meta.ref)}`}
        target="_blank"
        rel="noreferrer"
        className="btn max-w-[240px]"
        title={meta.refIsDefault ? `${meta.ref} (default branch)` : meta.ref}
      >
        <GitBranchIcon />
        <span className="truncate font-semibold">{meta.ref}</span>
        {meta.refIsDefault && <span className="Label hidden sm:inline-flex">default</span>}
      </a>
      <a
        href={`${meta.htmlUrl}/commit/${meta.commitSha}`}
        target="_blank"
        rel="noreferrer"
        className="btn btn-invisible text-fg-muted!"
        title={meta.commitSha}
      >
        <GitCommitIcon />
        <span className="font-mono text-xs">{shortSha(meta.commitSha)}</span>
      </a>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted sm:ml-auto">
        <li className="inline-flex items-center gap-1">
          <FileDirectoryIcon size={16} />
          <strong className="font-semibold text-fg">{formatNumber(stats.dirs)}</strong> folders
        </li>
        <li className="inline-flex items-center gap-1">
          <FileIcon size={16} />
          <strong className="font-semibold text-fg">{formatNumber(stats.files)}</strong> files
          <span className="text-fg-subtle">· {formatBytes(stats.totalBytes)}</span>
        </li>
        {stats.skipped > 0 && (
          <li
            className="inline-flex items-center gap-1"
            title="Binaries, lockfiles, vendored or generated code and very large files are shown on the map but not sent to the AI."
          >
            <SkipIcon size={16} />
            <strong className="font-semibold text-fg">{formatNumber(stats.skipped)}</strong> skipped for analysis
          </li>
        )}
        {tree.cached && (
          <li className="inline-flex items-center gap-1" title="This commit's tree was served from RepoMap's cache.">
            <DatabaseIcon size={16} />
            cached
          </li>
        )}
      </ul>
    </div>
  );
}

function TruncationNotice({ tree }: { tree: RepoTree }) {
  const { truncation, meta } = tree;
  const focusMissing = meta.requestedPath !== null && meta.focusPath === null;

  if (!truncation.github && !truncation.capped && !focusMissing) return null;

  return (
    <div className="space-y-2">
      {(truncation.github || truncation.capped) && (
        <div className="flash flash-warn" role="status">
          <AlertIcon size={16} />
          <div className="text-sm">
            <p className="font-semibold">This is a very large repository, so only part of it is shown.</p>
            <p className="mt-0.5 text-fg-muted">
              {truncation.github &&
                "GitHub returned a partial file list because the repository is too big to list in one request. "}
              {truncation.capped &&
                `RepoMap is showing ${formatNumber(truncation.returnedEntries)} of ${formatNumber(truncation.totalEntries)} entries, keeping the shallowest so the top-level structure is complete. `}
              Folders marked <span className="Label">partial</span> have contents you can{" "}
              <a href={githubUrl(meta, "", "tree")} target="_blank" rel="noreferrer" className="Link">
                browse on GitHub
              </a>
              .
            </p>
          </div>
        </div>
      )}
      {focusMissing && (
        <div className="flash flash-info" role="status">
          <InfoIcon size={16} />
          <p className="text-sm">
            <code className="font-mono">{meta.requestedPath}</code> wasn&apos;t found at this commit, so the whole
            repository is shown.
          </p>
        </div>
      )}
    </div>
  );
}
